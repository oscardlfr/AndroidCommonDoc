---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, koin, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 1
last_updated: "2026-03"
description: "How cross-feature dependencies work in each DI approach — real examples showing what happens when Feature A needs Feature B's services."
slug: di-cross-feature-deps
status: archived
layer: L0
category: archive
---

# Cross-Feature Dependencies: Concrete Examples

What happens when features inside an SDK need each other? Each DI approach answers differently.

---

## The Scenario

An SDK has 4 features. Their dependencies:

```
Network ──needs──▸ Auth (to add auth headers to requests)
Storage ──needs──▸ Encryption (to encrypt data before writing)
Auth ───needs──▸ Network (to call the token refresh endpoint)
                ▲
                └── circular: Auth ↔ Network
```

This is realistic. In [shared-kmp-libs (L1)](../../README.md), the Ktor network module depends on json-api and logging, the encryption module depends on common utilities, and the consuming app (L2) wires everything through a single Koin graph.

---

## Single Graph: Everything Resolves Automatically

**Works in:** Dagger Monolithic (A), Koin, kotlin-inject

All services live in ONE container. Any service can request any other.

### Koin (how L1 actually works)

```kotlin
// Each module declares what it provides and what it needs.
// get() resolves at runtime from the shared graph.

val encryptionModule = module {
    single<EncryptionService> { DefaultEncryptionService(get<KeyProvider>()) }
}

val authModule = module {
    single<TokenStore> { SecureTokenStore(get<EncryptionService>()) }
    //                                    ^^^^^^^^^^^^^^^^^^^^^^^
    //                  resolved from encryptionModule — same graph
    single<AuthService> { AuthServiceImpl(get<TokenStore>()) }
}

val networkModule = module {
    single<AuthInterceptor> { AuthInterceptor(get<AuthService>()) }
    //                                        ^^^^^^^^^^^^^^^^^^
    //                      resolved from authModule — same graph
    single<HttpClient> { KtorHttpClient(get<AuthInterceptor>(), get<JsonSerializer>()) }
}

val storageModule = module {
    single<SecureStorage> { EncryptedStorage(get<EncryptionService>(), get<FileSystemProvider>()) }
    //                                       ^^^^^^^^^^^^^^^^^^^^^^^
    //                     resolved from encryptionModule — same graph
}
```

At init, all modules go into one `koinApplication`:

```kotlin
SharedSdk.init(
    modules = setOf(SdkModule.Encryption.Default, SdkModule.Network.Ktor, ...),
    config = SdkConfig(debug = false),
    appModules = listOf(authModule, storageModule),
)
```

Koin sees the complete set of `single<>` declarations and resolves the full chain: `SecureStorage` needs `EncryptionService` → found in `encryptionModule`. `AuthInterceptor` needs `AuthService` → found in `authModule`.

**Circular dependency (Auth ↔ Network):** Koin handles with lazy injection:

```kotlin
val authModule = module {
    single<AuthService> {
        AuthServiceImpl(
            tokenStore = get<TokenStore>(),
            httpClient = provider<HttpClient>(),  // deferred — resolved on first use
        )
    }
}
```

`provider<HttpClient>()` returns a `Lazy`-like wrapper. When `AuthService` needs to call the token refresh endpoint, it calls `httpClient.get()` which resolves `HttpClient` at that point — by then, `networkModule` has finished initializing.

### Dagger Monolithic (Approach A) — same concept, compile-time

```kotlin
@Singleton
@Component(modules = [CoreModule::class, AuthModule::class,
                       NetworkModule::class, EncryptionModule::class, StorageModule::class])
interface SdkComponent { ... }

@Module class StorageModule {
    @Provides @Singleton
    fun secureStorage(
        encryption: EncryptionService,  // Dagger resolves from EncryptionModule
        fs: FileSystemProvider,         // Dagger resolves from CoreModule
    ): SecureStorage = EncryptedStorage(encryption, fs)
}

@Module class NetworkModule {
    @Provides @Singleton
    fun httpClient(
        auth: AuthService,              // Dagger resolves from AuthModule
        json: JsonSerializer,           // Dagger resolves from CoreModule
    ): HttpClient = KtorHttpClient(AuthInterceptor(auth), json)
}
```

**Circular dependency:** Dagger resolves with `Lazy<>`:

```kotlin
@Module class AuthModule {
    @Provides @Singleton
    fun authService(
        tokenStore: TokenStore,
        httpClient: Lazy<HttpClient>,  // deferred
    ): AuthService = AuthServiceImpl(tokenStore, httpClient)
}
```

**Key point:** In single-graph approaches, you declare dependencies, the framework figures out the creation order. You never manually wire Feature A to Feature B.

---

## Per-Feature Isolation: Manual Wiring Required

**Works in:** Dagger Per-Feature (B), Dagger + ServiceLoader (C)

Each feature has its OWN `DaggerComponent`. They can't see each other.

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ AuthComponent│    │StorageCompon.│    │NetworkCompon.│
│  @Singleton  │    │  @Singleton  │    │  @Singleton  │
│              │    │              │    │              │
│ AuthService  │    │SecureStorage │    │ HttpClient   │
│              │    │  needs EncSvc│    │  needs Auth  │
│              │    │  ← WHERE?   │    │  ← WHERE?    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └──────────┬────────┘───────────────────┘
                  ↓
          ┌──────────────┐
          │   CoreApis   │  ← plain Kotlin object, NOT Dagger
          │ .logger      │
          │ .config      │
          │ .network     │
          └──────────────┘
```

`StorageComponent` needs `EncryptionService`, but that lives in `EncryptionComponent`. Dagger can't cross the boundary — each Component is a separate compiled factory.

### Option 1: Expand CoreApis (simple, doesn't scale)

```kotlin
interface CoreApis {
    // Infrastructure
    val logger: Logger
    val config: SdkConfig
    val networkExecutor: NetworkExecutor

    // Cross-feature (added as needs arise)
    val encryptionService: EncryptionService
    val authService: AuthService
    val tokenStore: TokenStore
}
```

Now CoreApis must be built in order:

```kotlin
fun createCoreApis(context: Context, config: SdkConfig): CoreApis {
    val logger = FoundationSingletons.logger
    val network = OkHttpNetworkExecutor(config)

    // Must build Encryption first — Auth and Storage need it
    val encComp = DaggerEncryptionComponent.builder()...build()
    val encryption = encComp.encryptionService()

    // Then Auth — Network needs it
    val tokenStore = SecureTokenStore(encryption)
    val authComp = DaggerAuthComponent.builder()...build()
    val auth = authComp.authService()

    return CoreApisImpl(logger, config, network, encryption, auth, tokenStore)
}
```

**At 5 cross-feature services** this is manageable. **At 15+**, CoreApis becomes a God Object — a single interface that depends on everything, defeating per-feature isolation.

### Option 2: Ordered initialization (explicit, fragile)

```kotlin
val core = CoreApisImpl.create(context, config)       // 1. infrastructure
FeatureEncryption.init(core)                           // 2. no cross-deps
FeatureAuth.init(core, FeatureEncryption.service())    // 3. needs encryption
FeatureStorage.init(core, FeatureEncryption.service()) // 4. needs encryption
FeatureNetwork.init(core, FeatureAuth.service())       // 5. needs auth
```

**Problems:**
- Init order is architecture — reorder and things break silently
- Auth ↔ Network circular is impossible without `Lazy` hacks outside Dagger
- Each feature's `init()` has a different signature — no uniform contract

### Option 3: Accept independent features

Design features that DON'T cross-depend. Infrastructure (logger, config, http primitive) lives in CoreApis. Feature services never reference each other.

Works for SDKs with orthogonal features (Firebase: Auth, Firestore, Messaging — each standalone). Does NOT work when features are interconnected like auth+encryption+storage+network.

---

## Summary

| Approach | Cross-feature | How | Limitation |
|----------|--------------|-----|-----------|
| **Dagger A** (one Component) | ✅ Automatic | Same @Component graph | All features compiled in binary |
| **Koin** (one koinApplication) | ✅ Automatic | Same graph, `get()` resolves | Runtime resolution, no compile-time check |
| **kotlin-inject** (parent component) | ✅ Automatic | Parent component composes children | Consumer must compose manually |
| **Dagger B** (per-feature) | ⚠️ Manual | CoreApis or ordered init | God Object risk at scale |
| **Dagger C** (ServiceLoader) | ⚠️ Manual | Same as B + runtime discovery | Same God Object risk + JVM-only |

**Bottom line:** If features depend on each other, a single graph (Dagger A or Koin) resolves everything automatically. Per-feature Dagger (B, C) works when features are truly independent — otherwise you end up rebuilding a manual graph through CoreApis.

---

## Related Docs

- [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md) — The 3 Dagger approaches with full code
- [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md) — Isolation levels, CoreApis explained
- [di-hybrid-koin-sdk-dagger-app.md](di-hybrid-koin-sdk-dagger-app.md) — Koin SDK + Dagger app bridge
- [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md) — Framework comparison tables
