---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, koin, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 1
last_updated: "2026-03"
description: "Consumer isolation levels for modular SDKs — from zero isolation to full sealed-class discovery. What each DI framework can and cannot achieve."
slug: di-sdk-consumer-isolation
status: archived
layer: L0
category: archive
---

# SDK Consumer Isolation Levels

When building a modular SDK, a key decision is **how much the consumer app knows about implementation modules**. This document defines 4 isolation levels and documents honestly what each DI approach can achieve.

**Related docs:**
- [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md) — Dagger 2 implementation (Approach A, B, C)
- [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md) — Framework comparison (6 approaches × 12 criteria)

## The 4 Levels

| Level | What consumer sees | What consumer imports | Binary contains |
|-------|-------------------|----------------------|-----------------|
| **0 — None** | Impl classes directly | `SecurityServiceImpl`, `KtorClient` | Everything |
| **1 — Facade** | Feature facade object | `FeatureSecurity.init(core)` | Selected features |
| **2 — Interface** | API interface only | `SecurityApi`, impl injected by DI | Selected features |
| **3 — Enum** | Sealed class variant | `SdkModule.Security`, zero impl knowledge | Selected features |

### Level 0 — No isolation (anti-pattern)

```kotlin
// Consumer directly instantiates impl classes
import com.example.sdk.security.impl.SecurityServiceImpl
import com.example.sdk.network.impl.KtorNetworkClient

val security = SecurityServiceImpl(KtorNetworkClient())
```

**Problem:** If the SDK renames `SecurityServiceImpl` or replaces Ktor with OkHttp, every consumer breaks. No framework achieves this — it's always wrong.

### Level 1 — Facade isolation

```kotlin
// Consumer knows the feature exists, calls init on its facade
import com.example.sdk.security.FeatureSecurity

FeatureSecurity.init(core)
val service = FeatureSecurity.securityService()
```

The consumer imports `FeatureSecurity` from the `:security:integration` module. It doesn't see `SecurityServiceImpl`, `DaggerSecurityComponent`, or any internal wiring — but it does know that `FeatureSecurity` exists and lives in the integration artifact.

**Consumer Gradle:** `implementation("com.example.sdk:security-integration:1.0.0")`

**Trade-off:** Consumer is coupled to the integration module's public facade, not its internals. If the SDK replaces Dagger with Koin internally, the consumer code doesn't change — `FeatureSecurity.init(core)` stays the same. But the consumer does depend on `security-integration` as a Gradle artifact.

### Level 2 — Interface isolation

```kotlin
// Consumer depends only on the API module
import com.example.sdk.security.api.SecurityService

// Impl is injected — consumer never references integration module
val service: SecurityService = diContainer.get()
```

The consumer imports `SecurityService` from `:security:api`. The impl (`SecurityServiceImpl` in `:security:integration`) is provided by the DI container. The consumer's Gradle file references the API module; the integration module is a transitive or runtime-only dependency.

**Consumer Gradle:**
```kotlin
api("com.example.sdk:security-api:1.0.0")
runtimeOnly("com.example.sdk:security-integration:1.0.0")  // or transitive via core
```

**Trade-off:** Cleaner separation — consumer code only references interfaces. But someone must wire the integration module (either the SDK's init or the consumer's Gradle). The consumer still implicitly knows which integration exists via their dependency declaration.

### Level 3 — Enum/sealed-class isolation (full discovery)

```kotlin
// Consumer only knows a type-safe enum
import com.example.sdk.SdkModule

SharedSdk.init(
    modules = setOf(SdkModule.Security, SdkModule.Network.Ktor),
    config = SdkConfig(debug = false),
)

// Access via interface — consumer never touches Koin directly
val service: SecurityService = SharedSdk.get()
```

Internally, `SharedSdk.init()` uses `koinApplication {}` (isolated instance) to resolve modules. The consumer never sees Koin — only the sealed class and interface accessors.

**Consumer Gradle:**
```kotlin
implementation("com.example.sdk:core-sdk:1.0.0")        // sealed class + init
implementation("com.example.sdk:security-integration:1.0.0")  // auto-registers
```

**Trade-off:** Maximum isolation — consumer code is fully decoupled from impl modules. But requires a discovery mechanism (class loading, annotation processing, or manual registry).

## What Each Framework Can Achieve

| Framework | Max isolation level | How | Limitation |
|-----------|-------------------|-----|------------|
| **Dagger Monolithic** | Level 1 | Consumer calls `MySdk.init()`, accesses via facade | All impls compiled in binary regardless |
| **Dagger Per-Feature** | Level 1 | Consumer calls `FeatureSecurity.init(core)` | Consumer imports facade from integration module |
| **Dagger Per-Feature + ServiceLoader** | Level 1-2 | `MySdk.init(setOf(...))` with auto-discovery | JVM-only, runtime errors on missing deps |
| **Koin** | Level 3 | Sealed class + `Class.forName` / `@EagerInitialization` | Runtime graph validation only |
| **kotlin-inject** | Level 2 | Component composition, API/impl split | Consumer composes components explicitly |
| **Manual DI** | Level 2 | Constructor injection, factory pattern | No codegen, no graph validation |

### Why Dagger cannot reach Level 2-3

Dagger's `@Component` annotation requires **compile-time knowledge** of all `@Module` classes in the graph. This is a fundamental design choice — it's what enables compile-time graph validation.

Consequences:
- **Level 2 blocked:** The `@Component` must reference the `@Module` that provides `SecurityService`. That module lives in `:security:integration`. So either the orchestrator module depends on `:security:integration` (monolithic, Level 1), or the consumer creates the component themselves (per-feature, still Level 1).
- **Level 3 blocked:** Auto-discovery via class loading (`Class.forName`) cannot feed Dagger's annotation processor. Dagger generates the wiring at compile time — it cannot discover modules at runtime.

This is not a bug — it's the trade-off for compile-time safety. Dagger catches missing bindings before the app runs. Koin catches them at runtime (or in test via `checkModules()`).

### Why Koin can reach Level 3

Koin's module registration is runtime: `module { single<SecurityService> { SecurityServiceImpl() } }`. The SDK can discover and register modules dynamically:

1. Consumer adds `implementation("com.example.sdk:security-integration")` to Gradle
2. The integration module contains an `object` with `init {}` that registers in a global registry
3. On JVM, `Class.forName()` triggers the `init {}` when `SharedSdk.init()` runs
4. On Native, `@EagerInitialization` forces init before `main()`

No compile-time wiring needed. The trade-off: if the consumer forgets the Gradle dependency, they get a `ClassNotFoundException` at runtime instead of a build error.

### kotlin-inject at Level 2

kotlin-inject can achieve Level 2 because its components are composed in Kotlin code (not annotations). The consumer can depend on an API module and receive impls via component injection:

```kotlin
// Consumer creates component, impls come from a separate module
@Component
abstract class AppComponent(
    @Component val sdkComponent: SdkSecurityComponent,
) {
    abstract val securityService: SecurityService
}
```

But the consumer must explicitly compose components — there's no auto-discovery. This keeps compile-time safety but requires ceremony per feature.

## Choosing Your Isolation Level

| If you need... | Level | Framework options |
|----------------|-------|-------------------|
| Quick internal SDK, team owns all code | 1 | Dagger (either), Koin, kotlin-inject |
| External SDK, stable API contract | 2 | Koin, kotlin-inject, Manual DI |
| Large SDK, many optional features, zero impl coupling | 3 | Koin |
| Compile-time safety above all else | 1-2 | Dagger, kotlin-inject |
| KMP support | 2-3 | Koin, kotlin-inject |

Level 3 is the gold standard for large, evolving SDKs — but it's only achievable with runtime DI. If compile-time safety is non-negotiable, Level 1-2 with Dagger or kotlin-inject is the honest answer.

## Hybrid: Koin Inside SDK + Dagger/Hilt in App

A valid architecture is using **different DI frameworks** for the SDK and the consuming app. The SDK uses Koin internally (Level 3 discovery, KMP), while the app uses Dagger/Hilt (compile-time safety, team preference).

### Why this works

- **Dagger** generates code at compile time — no global runtime state. It doesn't care what else runs in the process.
- **Koin** since 4.x supports `koinApplication {}` — an isolated instance that does NOT use the global `startKoin()`. The SDK creates its own Koin context; the app's Dagger graph is unaffected.

```
┌─────────────────────────────────────────────┐
│ App (Dagger/Hilt)                           │
│                                             │
│  @Component → AppModule, ViewModelModule    │
│  Lifecycle managed by Hilt / @Singleton     │
│                                             │
│  ┌────────────────────────────────────────┐  │
│  │ SDK (Koin — isolated koinApplication)  │  │
│  │                                        │  │
│  │  SharedSdk.init(modules, config)       │  │
│  │  Internal: koinApplication { modules } │  │
│  │  Exposes: interfaces only              │  │
│  └────────────────────────────────────────┘  │
│                                             │
│  // App accesses SDK via interfaces         │
│  val security: SecurityService =            │
│      SharedSdk.get<SecurityService>()       │
│                                             │
│  // Optionally bridge into Dagger:          │
│  @Provides fun security(): SecurityService  │
│      = SharedSdk.get()                      │
└─────────────────────────────────────────────┘
```

### SDK side — isolated Koin (not global)

```kotlin
// SDK uses koinApplication (isolated), NOT startKoin (global)
object SharedSdk {
    private lateinit var koin: Koin

    fun init(modules: Set<SdkModule>, config: SdkConfig) {
        val app = koinApplication {
            modules(foundationModule(config) + resolvedModules)
        }
        koin = app.koin  // isolated instance, does not affect GlobalContext
    }

    inline fun <reified T> get(): T = koin.get()
}
```

**Critical:** `koinApplication {}` creates an isolated Koin instance. `startKoin {}` uses the global singleton. If the app also uses Koin (e.g. via `koin-android`), the SDK MUST use `koinApplication` to avoid conflicts.

### App side — Dagger bridge (optional)

```kotlin
// App's Dagger module provides SDK services to the Dagger graph
@Module
@InstallIn(SingletonComponent::class)
object SdkBridgeModule {
    @Provides @Singleton
    fun provideSecurityService(): SecurityService = SharedSdk.get()

    @Provides @Singleton
    fun provideStorageService(): StorageService = SharedSdk.get()
}

// Now app's ViewModels can @Inject SDK interfaces normally
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val security: SecurityService,  // comes from SDK via bridge
) : ViewModel()
```

### When to use hybrid

| Scenario | Fits? | Why |
|----------|-------|-----|
| SDK is KMP, app is Android-only | ✅ | SDK needs KMP DI (Koin), app uses Google-standard (Hilt) |
| SDK team ≠ app team | ✅ | Each team uses what they know — no forced migration |
| App is already Hilt, adding SDK later | ✅ | SDK doesn't require app to adopt Koin |
| Both SDK and app are same team, same codebase | ❌ | Simpler to use one framework everywhere |
| SDK is Android-only, no KMP needed | ❌ | Just use Dagger/Hilt everywhere |

### Caveats

1. **Two DI containers in memory** — minimal overhead (Koin is lightweight), but it's two systems to reason about during debugging.
2. **SDK must use `koinApplication`, not `startKoin`** — if the SDK uses `startKoin` and the app also uses Koin (e.g. via `koin-android`), they'll conflict on `GlobalContext`. L1 is migrating from `startKoin` to `koinApplication` for isolated instance support.
3. **Bridge module adds ceremony** — one `@Provides` per SDK interface exposed to Dagger. Manageable for 5-10 services, tedious for 50+.
4. **Testing** — SDK tests use Koin test utilities, app tests use Hilt test utilities. Integration tests need both.
