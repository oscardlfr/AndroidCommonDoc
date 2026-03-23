---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, koin, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 3
last_updated: "2026-03"
description: "SDK DI concepts — isolation levels, DI vs Service Locator, cross-feature dependencies, singleton survival. Framework-agnostic principles with honest framework capabilities."
slug: di-sdk-consumer-isolation
status: archived
layer: L0
category: archive
---

# SDK DI Concepts

Foundational concepts for building modular SDKs with dependency injection. Framework-agnostic principles — applies to Dagger, Koin, kotlin-inject, or manual DI.

For Dagger 2 implementations, see [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md).
For framework comparison, see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md).

---

## DI vs Service Locator

Two paradigms for managing dependencies. Understanding this distinction is often the deciding factor for teams.

### Dependency Injection (Pure DI)

The framework **pushes** dependencies into the class. The class never asks for them.

```kotlin
class SecurityServiceImpl @Inject constructor(
    private val network: NetworkExecutor,   // framework provides this
    private val logger: Logger,             // framework provides this
) : SecurityService
```

The class has zero knowledge of any DI container. It works with `new SecurityServiceImpl(fakeNetwork, fakeLogger)` in tests — no container setup needed.

**Frameworks:** Dagger 2, Hilt, kotlin-inject

### Service Locator

The class **pulls** dependencies from a registry.

```kotlin
class SecurityServiceImpl(
    private val network: NetworkExecutor = get(),   // class asks Koin
    private val logger: Logger = get(),             // class asks Koin
) : SecurityService
```

The class knows about the DI container. It cannot work without the container being initialized.

**Frameworks:** Koin, kodein

### Trade-offs

| | Pure DI | Service Locator |
|---|---|---|
| **Compile-time safety** | ✅ Missing binding = build error | ❌ Missing binding = runtime crash |
| **Testability** | ✅ Constructor args, no container | ⚠️ Need container or override |
| **SOLID compliance** | ✅ True Dependency Inversion | ⚠️ Inverted control is partial |
| **KMP support** | ⚠️ Dagger JVM-only; kotlin-inject full | ✅ Koin full KMP |
| **Build speed** | ❌ Annotation processing (KAPT/KSP) | ✅ No codegen |
| **Runtime flexibility** | ❌ Graph fixed at compile time | ✅ Modules composable at runtime |
| **Auto-discovery** | ❌ Not possible with Dagger | ✅ Class.forName + @EagerInit |

Neither is universally better. Pure DI is architecturally stricter. Service Locator is pragmatically simpler and enables capabilities (auto-discovery, runtime composition) that pure DI cannot achieve.

---

## Consumer Isolation Levels

How much does the consuming app know about SDK implementation details?

### Level 0 — No isolation (anti-pattern)

Consumer directly instantiates impl classes:
```kotlin
import com.example.sdk.security.impl.SecurityServiceImpl
val service = SecurityServiceImpl(KtorNetworkClient())
```
If the SDK renames the class or changes constructors, every consumer breaks.

### Level 1 — Facade

Consumer calls a facade object. Does not see impl classes but does import the facade:
```kotlin
import com.example.sdk.security.FeatureSecurity
FeatureSecurity.init(core)
val service = FeatureSecurity.securityService()
```
The facade lives in the `:integration` module. Consumer's Gradle depends on it.

### Level 2 — Interface only

Consumer depends on the API module only. Impl is injected:
```kotlin
import com.example.sdk.security.api.SecurityService
val service: SecurityService = component.securityService()  // injected
```
Consumer's Gradle: `api("security-api")` + `runtimeOnly("security-integration")`.

### Level 3 — Sealed class / enum

Consumer knows only a type-safe selector. Zero impl module imports:
```kotlin
import com.example.sdk.SdkModule
SharedSdk.init(modules = setOf(SdkModule.Security))
val service: SecurityService = SharedSdk.koin.get()
```
Internally, `SharedSdk` uses `koinApplication {}` (isolated instance) and auto-discovery (`Class.forName` on JVM, `@EagerInitialization` on Native).

### What each framework achieves

| Framework | Max level | Why |
|-----------|----------|-----|
| Dagger Monolithic | 1 | Consumer doesn't see impls but all are compiled in |
| Dagger Per-Feature | 1 | Consumer imports facade from integration module |
| Dagger + ServiceLoader | 1-2 | ServiceLoader discovers, but consumer still declares Gradle dep |
| Koin | 3 | Sealed class + runtime discovery, consumer imports only SDK core |
| kotlin-inject | 2 | Consumer composes components, depends on API module |

**Why Dagger cannot reach Level 3:** Dagger's `@Component` requires compile-time knowledge of all `@Module` classes. Auto-discovery via class loading cannot feed the annotation processor. This is the trade-off for compile-time graph validation.

---

## Cross-Feature Dependencies

When Feature A needs a service that Feature B provides.

### In a single DI graph (Approach A / Koin)

No problem. All services are in the same container:

```kotlin
// Dagger Monolithic: both in @Component
@Provides fun authService(network: NetworkExecutor): AuthService  // from CoreModule
@Provides fun paymentService(auth: AuthService): PaymentService   // from AuthModule — works

// Koin: all modules in one koinApplication
single<AuthService> { AuthServiceImpl(get()) }
single<PaymentService> { PaymentServiceImpl(get<AuthService>()) }  // works
```

### In per-feature isolation (Approach B, C)

Each feature has its own `DaggerComponent`. Feature B cannot inject from Feature A's component.

**Option 1: Put shared services in CoreApis**
```kotlin
interface CoreApis {
    val logger: Logger
    val config: SdkConfig
    val networkExecutor: NetworkExecutor
    val authService: AuthService       // ← added because Payments needs it
    val storageService: StorageService // ← added because Analytics needs it
    val idGenerator: IdGenerator       // ← added because everyone needs it
    // ... grows with every cross-feature dependency
}
```
CoreApis becomes a God Object — a single interface that knows about every shared service. At 15+ fields, it's unmanageable and defeats the purpose of per-feature isolation.

**Option 2: Initialize in order**
```kotlin
val core = CoreApisImpl.create(context, config)
FeatureAuth.init(core)               // first
FeaturePayments.init(core, FeatureAuth.authService())  // second, needs auth
```
Creates implicit initialization ordering. Features are not truly independent.

**Option 3: Accept truly independent features**

Design features that do NOT depend on each other. Shared capabilities live in CoreApis (logger, config, network). Feature-specific services are never cross-injected.

This is the honest architectural constraint: **per-feature Dagger is best when features are truly independent**. If they need each other's services, either use Approach A (monolithic) or Koin (single graph with runtime resolution).

---

## Singleton Survival Across Reinit

Some singletons must survive `shutdown() → init()` cycles — loggers with file handles, correlation IDs, buffered telemetry.

The pattern is framework-agnostic: hold process-lifetime state in a Kotlin `object` outside the DI lifecycle.

```kotlin
// Works identically in Dagger, Koin, kotlin-inject
internal object FoundationSingletons {
    val logger: EventLogger = EventLoggerImpl()     // created once, never recreated
    val idGenerator: IdGenerator = CommonIdGenerator()
}
```

The DI container references the existing instance — it doesn't create a new one:

```kotlin
// Koin
fun foundationModule(config: SdkConfig) = module {
    single<EventLogger> { FoundationSingletons.logger }   // survives reinit
    single<SdkConfig> { config }                           // recreated per init
}

// Dagger
@Module object CoreModule {
    @Provides @Singleton
    fun logger(): EventLogger = FoundationSingletons.logger  // survives reinit
    @Provides @Singleton
    fun config(config: SdkConfig): SdkConfig = config        // recreated
}

// kotlin-inject
@Component abstract class SdkComponent(@get:Provides val config: SdkConfig) {
    @Provides fun logger(): EventLogger = FoundationSingletons.logger
}
```

**What survives:** Logger, telemetry pipeline, credential cache, ID generator.
**What gets recreated:** Config (debug flags may change), API endpoints, environment.

---

## Hybrid: Koin SDK + Dagger App

A KMP SDK can use Koin internally while the consuming Android app uses Dagger/Hilt. No conflict because:
- Dagger has no global runtime state (pure codegen)
- Koin 4.x supports `koinApplication {}` — isolated instance, does NOT use global `startKoin`

```kotlin
// SDK (Koin isolated)
object SharedSdk {
    private var _koinApp: KoinApplication? = null
    val koin: Koin get() = _koinApp!!.koin

    fun init(modules: Set<SdkModule>, config: SdkConfig) {
        _koinApp = koinApplication {
            modules(foundationModule(config) + resolvedModules)
        }
    }
}

// App (Dagger/Hilt bridge)
@Module @InstallIn(SingletonComponent::class)
object SdkBridgeModule {
    @Provides @Singleton
    fun security(): SecurityService = SharedSdk.koin.get()
}
```

**Critical:** SDK must use `koinApplication {}` (isolated), not `startKoin {}` (global). If both SDK and app use `startKoin`, they conflict on `GlobalContext`.
