---
scope: [architecture, dependency-injection, sdk-design, kmp]
sources: [koin, dagger-hilt, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 1
last_updated: "2026-03"
description: "Hybrid architecture: Koin-powered KMP SDK consumed by Dagger/Hilt Android apps. Complete bridge pattern with lifecycle, testing, and production code."
slug: di-hybrid-koin-sdk-dagger-app
status: archived
layer: L0
category: archive
---

# Hybrid Architecture: Koin SDK + Dagger/Hilt App

How to build a KMP SDK with Koin internally, consumed by Android apps that use Dagger 2 or Hilt — without conflicts, without the app knowing Koin exists.

---

## Why This Pattern Exists

Two constraints create this situation:

1. **The SDK needs KMP** (iOS, macOS, Desktop, Android) → Dagger is JVM-only, ruled out for the SDK
2. **The consuming app is Android-only with existing Hilt** → not rewriting to Koin

They can coexist because:
- Dagger is pure codegen — no global runtime state, no singleton registry
- Koin 4.x supports `koinApplication {}` — isolated instance, NOT global `startKoin`

### Contrast with L2 (DawSync)

L2 passes `appModules` to `SharedSdk.init()` — app repositories, ViewModels, use cases, all as Koin modules. Everything resolves in ONE `koinApplication`:

```kotlin
// L2 approach — everything is Koin
SharedSdk.init(
    modules = setOf(SdkModule.Encryption.Default, SdkModule.Io.KotlinxIo),
    config = SdkConfig(debug = false),
    appModules = listOf(dataModule, domainModule, viewModelModule),  // ← app adds its own
)
val koin = SharedSdk.koin
val vm: SettingsViewModel = koin.get()  // resolved from same graph
```

A Dagger/Hilt app **cannot do this** — it has no Koin modules to pass. So `appModules` stays empty and the two worlds connect through a bridge.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Android App (Hilt)                      │
│                                                           │
│  @HiltAndroidApp                                          │
│  class MyApp : Application()                              │
│                                                           │
│  ┌───────────────────────────┐  ┌───────────────────────┐│
│  │    App's Hilt Graph        │  │   SdkBridgeModule     ││
│  │                            │  │   @Module @InstallIn  ││
│  │  AppRepository ────────────│──▸  @Provides encrypt()  ││
│  │  SettingsViewModel         │  │  @Provides hash()     ││
│  │  PaymentUseCase            │  │  @Provides http()     ││
│  └───────────────────────────┘  └──────────┬────────────┘│
│                                            │              │
│                                   SharedSdk.koin.get()    │
│                                            │              │
│  ┌─────────────────────────────────────────▼────────────┐│
│  │         SDK (Koin — isolated koinApplication)         ││
│  │                                                       ││
│  │  EncryptionModule ── NetworkModule ── StorageModule    ││
│  │  FoundationSingletons (logger, idGen)                 ││
│  │  SdkConfig                                            ││
│  │                                                       ││
│  │  appModules = emptyList()  ← no app modules here      ││
│  └───────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

Two completely separate DI containers. The bridge module is the only connection point.

---

## Step 1: SDK Init (no appModules)

```kotlin
@HiltAndroidApp
class MyApp : Application() {
    override fun onCreate() {
        super.onCreate()

        // SDK first — must exist before Hilt resolves bridge bindings
        SharedSdk.init(
            modules = setOf(
                SdkModule.Encryption.Default,
                SdkModule.Network.Ktor,
                SdkModule.Io.KotlinxIo,
            ),
            config = SdkConfig(debug = BuildConfig.DEBUG),
            // appModules NOT passed — app uses Hilt, not Koin
        )

        // Hilt auto-initializes via @HiltAndroidApp
        // When it creates SingletonComponent, it calls SdkBridgeModule providers
        // which call SharedSdk.koin.get() — works because SDK was initialized above
    }
}
```

**If init order is wrong:** `SharedSdk.koin` throws `IllegalStateException("SharedSdk not initialized")` during Hilt component creation. Immediate crash at startup — easy to diagnose.

---

## Step 2: The Bridge Module

One Hilt `@Module` that pulls SDK services into the app's Dagger graph:

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object SdkBridgeModule {

    @Provides @Singleton
    fun provideEncryptionService(): EncryptionService =
        SharedSdk.koin.get()

    @Provides @Singleton
    fun provideHashService(): HashService =
        SharedSdk.koin.get()

    @Provides @Singleton
    fun provideHttpClient(): HttpClient =
        SharedSdk.koin.get()
}
```

**What happens at runtime:**
1. Hilt creates `SingletonComponent`
2. Hilt calls `provideEncryptionService()` — one time (`@Singleton`)
3. That method calls `SharedSdk.koin.get<EncryptionService>()` — Koin resolves from its graph
4. Hilt caches the result in its Component
5. All subsequent `@Inject constructor(encryption: EncryptionService)` get the cached instance — Hilt serves it, Koin is never called again

---

## Step 3: App Code (Pure Hilt, Zero Koin Knowledge)

```kotlin
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val encryption: EncryptionService,   // from SdkBridgeModule
    private val repository: SettingsRepository,  // from app's own Hilt module
) : ViewModel() {

    fun encryptUserData(data: String) = viewModelScope.launch {
        val encrypted = encryption.encrypt(data)
        repository.saveEncrypted(encrypted)
    }
}
```

The ViewModel doesn't know `EncryptionService` comes from Koin. It's just a constructor parameter.

---

## The Key Difference From L2

| | L2 (DawSync) — all Koin | Hybrid — Koin SDK + Hilt app |
|---|---|---|
| **App modules** | Passed as `appModules` to `SharedSdk.init()` | Stay in Hilt, never touch Koin |
| **DI containers** | 1 (Koin) | 2 (Koin + Hilt) |
| **How app gets SDK services** | `koin.get<EncryptionService>()` or injected via Koin | `@Inject constructor(encryption: EncryptionService)` via Hilt |
| **How SDK gets app dependencies** | App modules in same graph — `get<AppConfig>()` works | ❌ SDK cannot see app bindings (see below) |
| **Cross-dep resolution** | Automatic — one graph | Bridge module only — one direction |
| **ViewModel DI** | `koinViewModel<SettingsVM>()` | `@HiltViewModel @Inject constructor(...)` |

### The Direction Constraint

The bridge is **one-directional: app ← SDK**.

```
   Hilt graph ←──bridge──── Koin graph
   (can inject SDK services)  (cannot inject app services)
```

The app can inject SDK services via the bridge. But the SDK **cannot** inject app-specific services — the Koin graph doesn't know about Hilt bindings.

**In L2 this isn't a problem** because `appModules` puts everything in the same Koin graph — the SDK's `get<EventLogger>()` resolves from foundation, and the app's `get<SettingsRepository>()` resolves from `dataModule`. All in one graph.

**In the hybrid, if the SDK needs app-provided config:**

```kotlin
// Option: pass it as SdkConfig, not as a DI binding
SharedSdk.init(
    modules = setOf(SdkModule.Encryption.Default),
    config = SdkConfig(
        debug = BuildConfig.DEBUG,
        apiBaseUrl = "https://api.example.com",  // app-specific, passed as config
    ),
)
```

Or provide a minimal Koin module for SDK-level app config:

```kotlin
// Minimal — only what the SDK needs from the app
val sdkAppConfig = module {
    single<ApiConfig> { ApiConfig(baseUrl = "https://api.example.com") }
}

SharedSdk.init(
    modules = setOf(SdkModule.Network.Ktor),
    config = SdkConfig(debug = true),
    appModules = listOf(sdkAppConfig),  // tiny module, not the whole app
)
```

This is NOT "the app uses Koin" — it's the app providing minimal config to the SDK in the SDK's language. The app's real DI stays in Hilt.

---

## Testing

### Unit tests — no DI at all

```kotlin
class SettingsViewModelTest {
    @Test
    fun `encrypt delegates to service`() = runTest {
        val vm = SettingsViewModel(
            encryption = FakeEncryptionService(),  // plain constructor
            repository = FakeSettingsRepository(),
        )
        vm.encryptUserData("secret")
        // assert...
    }
}
```

Constructor injection means testing never needs Hilt OR Koin.

### Integration tests — Hilt + SDK

```kotlin
@HiltAndroidTest
class EncryptionIntegrationTest {
    @get:Rule val hiltRule = HiltAndroidRule(this)
    @Inject lateinit var encryption: EncryptionService

    @Before fun setup() {
        SharedSdk.init(
            modules = setOf(SdkModule.Encryption.Default),
            config = SdkConfig(debug = true),
        )
        hiltRule.inject()
    }

    @After fun teardown() = SharedSdk.shutdown()

    @Test fun `round-trip`() = runTest {
        val plain = "hello"
        assertEquals(plain, encryption.decrypt(encryption.encrypt(plain)))
    }
}
```

---

## Gradle Dependencies

```kotlin
// App build.gradle.kts
dependencies {
    // Hilt
    implementation(libs.hilt.android)
    kapt(libs.hilt.compiler)

    // SDK — interface modules + impl modules
    implementation("com.example:sdk-core:1.0")           // SharedSdk, SdkModule, SdkConfig
    implementation("com.example:core-encryption:1.0")     // EncryptionService interface + impl
    implementation("com.example:core-network-ktor:1.0")   // HttpClient interface + impl

    // koin-core arrives transitively via sdk-core (it's `api`)
    // The app never calls Koin directly — only SdkBridgeModule does
}
```

**Hiding Koin from the app's classpath:** If you want zero Koin visibility:

```kotlin
// SDK provides a typed accessor — no Koin types exposed
object SharedSdk {
    inline fun <reified T : Any> get(): T = koin.get()
}

// Bridge — no import org.koin
@Provides @Singleton
fun provideEncryption(): EncryptionService = SharedSdk.get()
```

---

## Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| Two containers at runtime | ~100KB extra memory for Koin | Negligible |
| Bridge boilerplate | One `@Provides` per SDK service | 20 services = 20 one-liners |
| One-directional bridge | SDK can't inject app bindings | Pass app config via `SdkConfig` or minimal `appModules` |
| Init ordering | SDK must init before Hilt | Do it in `Application.onCreate()` — fails fast if wrong |
| Koin on classpath | `koin-core` transitive via SDK | Use `SharedSdk.get()` wrapper to hide |

---

## When To Use

| Scenario | Approach |
|----------|----------|
| SDK is KMP, app is Android Hilt | ✅ This pattern |
| SDK is Android-only | Consider Dagger for the SDK too |
| App already uses Koin | No bridge needed — pass `appModules`, like L2 |
| Multiple apps consume the SDK (some Hilt, some Koin) | ✅ Each app bridges differently |
| SDK needs heavy access to app internals | Reconsider — maybe SDK should expose extension points, not pull from app |

---

## Related Docs

- [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md) — Isolation levels, DI vs Service Locator
- [di-cross-feature-deps.md](di-cross-feature-deps.md) — Cross-feature dependencies in each approach
- [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md) — Pure Dagger approaches (when KMP not needed)
- [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md) — Framework comparison tables
