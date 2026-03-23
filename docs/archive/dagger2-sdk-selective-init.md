---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, android-sdk]
targets: [android]
version: 4
last_updated: "2026-03"
description: "SDK initialization pattern with Dagger 2: selective module loading. Covers monolithic Component (original) and per-feature Component (modern). Includes KAPT→KSP migration status, version compatibility notes, and comparison with Koin KMP approach."
slug: dagger2-sdk-selective-init
status: archived
layer: L0
category: archive
---

# Dagger 2 SDK: Selective Module Initialization

Pattern for Android-only SDKs with Dagger 2 where consumers choose which modules to activate at runtime.

> **Note:** This pattern is for **Android-only** SDKs. For KMP SDKs, see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md) for framework comparison. For consumer isolation analysis (what the app sees vs what's in the binary), see [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md).

## Consumer Isolation

Both approaches hide `*Impl` classes from the consumer. But the **isolation level** differs — see [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md) for full analysis.

- **Approach A:** Level 1 (facade). Consumer calls `MySdk.init()` and `MySdk.auth()`. Does NOT see `AuthServiceImpl`. BUT all impl code is in the binary.
- **Approach B:** Level 1 (facade). Consumer calls `FeatureSecurity.init(core)`. Does NOT see `SecurityServiceImpl`. Only selected features are in the binary.

Neither approach reaches Level 2+ (interface-only). Dagger's compile-time `@Component` annotation requires knowledge of impl modules at build time — there is no runtime discovery mechanism.

## Two Architectural Approaches

### Approach A: Monolithic Component (original pattern)

Single `@Component` owns all singletons. All impl modules compiled in. Consumer selection at init time via `Provider<ModuleInitializer>` laziness.

```
sdk-core/        → SdkComponent (lists ALL @Modules), SdkConfig, shared singletons
sdk-auth/        → AuthDaggerModule, AuthModuleInitializer
sdk-analytics/   → AnalyticsDaggerModule, AnalyticsModuleInitializer
```

**Pros:** Compile-time graph validation, simple singleton sharing.
**Cons:** All impls linked in binary, adding modules requires editing `@Component`, fat umbrella dependency.

### Approach B: Per-Feature Component (modern, modular)

Each feature has its own `DaggerComponent`. No global graph. Consumer initializes features independently.

```
core-apis/       → Shared interfaces, CoreApis provider
feature/
  security/
    api/         → SecurityApi interface (no Dagger)
    integration/ → DaggerSecurityComponent, SecurityImpl
  observability/
    api/         → ObservabilityApi interface
    integration/ → DaggerObservabilityComponent, ObservabilityImpl
```

**Pros:** Truly modular — no cross-feature coupling, per-module publishing, consumer binary includes only selected features.
**Cons:** No cross-feature singleton sharing via Dagger (must use external holder or pass core APIs manually).

## Approach A: Monolithic Implementation

### Init pattern

```kotlin
object MySdk {
    fun init(context: Context, config: SdkConfig, modules: Set<SdkModule>) {
        val comp = DaggerSdkComponent.builder()
            .context(context.applicationContext)
            .config(config)
            .build()
        // Only requested modules get initialized (Provider laziness)
        for (module in modules) {
            comp.moduleInitializers()[module]?.get()?.initialize()
        }
    }
}
```

### Component lists all modules

```kotlin
@Singleton
@Component(modules = [
    CoreModule::class,
    AuthDaggerModule::class,       // always compiled in
    AnalyticsDaggerModule::class,  // always compiled in
    PaymentsDaggerModule::class,   // always compiled in
])
interface SdkComponent { ... }
```

### Module registration via multibindings

```kotlin
@Module
class AuthDaggerModule {
    @Provides @IntoMap @SdkModuleKey(SdkModule.AUTH)
    fun provideInitializer(authService: Provider<AuthService>): ModuleInitializer {
        return AuthModuleInitializer(authService)
    }
}
```

**⚠️ Limitation:** `@IntoMap` requires a single `@Component` that sees all `@Module` classes. This prevents true modular isolation.

## Approach B: Per-Feature Implementation

### Gradle module structure

```
sdk-core-apis/           → CoreApis interface, SdkConfig, shared contracts (NO Dagger)
sdk-core-impl/           → CoreApisImpl with foundation singletons
feature/
  security/
    api/                 → SecurityApi interface (NO Dagger, NO impl deps)
    integration/         → DaggerSecurityComponent, SecurityImpl, SecurityModule
  observability/
    api/                 → ObservabilityApi interface
    integration/         → DaggerObservabilityComponent, ObservabilityImpl
  payments/
    api/                 → PaymentsApi interface
    integration/         → DaggerPaymentsComponent, PaymentsImpl
```

Consumer's `build.gradle.kts` only declares what they need:
```kotlin
implementation("com.example.sdk:core-apis:1.0.0")
implementation("com.example.sdk:security-api:1.0.0")
implementation("com.example.sdk:security-integration:1.0.0")
// Payments NOT included → not in binary, not instantiated
```

### CoreApis — shared state without global Dagger graph

```kotlin
// In :sdk-core-apis (NO Dagger dependency)
interface CoreApis {
    val logger: Logger
    val config: SdkConfig
    val networkExecutor: NetworkExecutor
}

data class SdkConfig(
    val baseUrl: String,
    val apiKey: String,
    val environment: Environment = Environment.PRODUCTION,
    val debugMode: Boolean = false,
)
```

```kotlin
// In :sdk-core-impl
class CoreApisImpl private constructor(
    override val config: SdkConfig,
    context: Context,
) : CoreApis {
    // Foundation singletons survive reinit (same pattern as Koin FoundationSingletons)
    override val logger: Logger = FoundationSingletons.logger
    override val networkExecutor: NetworkExecutor = NetworkExecutorImpl(config)

    companion object {
        fun create(context: Context, config: SdkConfig): CoreApis =
            CoreApisImpl(config, context.applicationContext)
    }
}
```

### Per-feature Component

Each feature has its own Dagger Component. No global graph — each feature is self-contained:

```kotlin
// In :feature:security:integration
@Singleton
@Component(modules = [SecurityModule::class])
interface SecurityComponent {
    fun securityService(): SecurityService

    @Component.Builder
    interface Builder {
        @BindsInstance fun core(core: CoreApis): Builder
        fun build(): SecurityComponent
    }
}

@Module
class SecurityModule {
    @Provides @Singleton
    fun provideSecurityService(core: CoreApis): SecurityService {
        // core.logger, core.networkExecutor → same instances across all features
        return SecurityServiceImpl(core.logger, core.networkExecutor, core.config)
    }
}
```

### SDK entry point — three options

Approach B supports three init patterns. The internal architecture (per-feature DaggerComponent) is the same in all three — the difference is how the consumer triggers init.

#### Option 1: Per-feature init (most decoupled)

Each feature is an independent SDK. No central orchestrator.

```kotlin
// Consumer initializes each feature independently
val core = CoreApisImpl.create(context, SdkConfig(baseUrl = "...", apiKey = "..."))
FeatureSecurity.init(core)
FeatureObservability.init(core)
// Payments NOT initialized → not in binary, not instantiated
```

**Best for:** Features published as independent Maven artifacts. Each consumer picks only what they need. No central SDK module exists.

#### Option 2: Umbrella with selective init (centralized entry, decoupled internals)

A central `MySdk.init(modules)` delegates to per-feature inits internally. Each feature still has its own DaggerComponent — there is NO global `@Component`.

```kotlin
// sdk-core — thin orchestrator, does NOT have a DaggerSdkComponent
object MySdk {
    private lateinit var core: CoreApis

    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        core = CoreApisImpl.create(context, config)
        for (feature in features) {
            when (feature) {
                Feature.SECURITY -> FeatureSecurity.init(core)
                Feature.OBSERVABILITY -> FeatureObservability.init(core)
                Feature.PAYMENTS -> FeaturePayments.init(core)
            }
        }
    }

    fun shutdown() {
        FeatureSecurity.shutdown()
        FeatureObservability.shutdown()
        FeaturePayments.shutdown()
    }
}

// Consumer:
MySdk.init(context, config, setOf(Feature.SECURITY, Feature.OBSERVABILITY))
val service = FeatureSecurity.securityService()
```

**Key difference from Approach A:** `MySdk` does NOT have a `@Component`. It's a plain Kotlin object that delegates. Each feature's DaggerComponent is created independently inside `FeatureX.init()`. There is no global Dagger graph.

**Trade-off:** `MySdk` depends on all feature integration modules (must know about `FeatureSecurity`, `FeatureObservability`, etc.). Adding a feature requires editing `MySdk`. But the consumer binary only includes features listed in Gradle — unlisted features are dead code eliminated by R8/ProGuard.

**Best for:** SDK distributed as a single artifact but with optional features. Consumer gets a familiar `MySdk.init(setOf(...))` API.

#### Option 3: Discovery-based umbrella (no central edit on new feature)

Combines Option 2's umbrella API with a registration mechanism so `MySdk` doesn't need to know about every feature at compile time. Uses `ServiceLoader` (JVM) or a manual registry.

```kotlin
// Each feature registers itself via ServiceLoader or META-INF
// sdk-core defines the contract:
interface FeatureInitializer {
    val feature: Feature
    fun init(core: CoreApis)
    fun shutdown()
}

// sdk-core discovers and initializes:
object MySdk {
    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        val core = CoreApisImpl.create(context, config)
        val available = ServiceLoader.load(FeatureInitializer::class.java)
        for (initializer in available) {
            if (initializer.feature in features) {
                initializer.init(core)
            }
        }
    }
}
```

**Trade-off:** `MySdk` no longer edits when a new feature is added — but `ServiceLoader` is JVM-only and adds runtime complexity. Not available on Kotlin/Native without custom implementation.

**Best for:** Large SDK (20+ features) where editing a central file per feature is unacceptable.

#### Option comparison

| | Option 1: Per-feature | Option 2: Umbrella | Option 3: Discovery |
|---|---|---|---|
| Consumer API | `Feature.init(core)` | `MySdk.init(setOf(...))` | `MySdk.init(setOf(...))` |
| Central orchestrator | None | `MySdk` (thin delegator) | `MySdk` + ServiceLoader |
| Adding a feature | New module only | Edit `MySdk` when block | New module + META-INF |
| Global DaggerComponent | ❌ No | ❌ No | ❌ No |
| Best for | Independent SDKs | Single SDK, optional features | Large SDK, many features |

### Per-feature facade

```kotlin
// In :feature:security:integration
object FeatureSecurity {
    private var component: SecurityComponent? = null

    fun init(core: CoreApis) {
        check(component == null) { "Security already initialized" }
        component = DaggerSecurityComponent.builder()
            .core(core)
            .build()
    }

    fun securityService(): SecurityService {
        return component?.securityService()
            ?: error("Security not initialized. Call FeatureSecurity.init(core) first.")
    }

    fun shutdown() {
        component = null
    }
}
```

### Publishing

Each module publishes independently — consumer picks only what they need:
```kotlin
// feature/security/integration/build.gradle.kts
publishing {
    singleVariant("release") { withSourcesJar() }
}
```

## Approach A vs B — Trade-off Comparison

| Criterion | A: Monolithic | B: Per-Feature |
|-----------|--------------|----------------|
| **Consumer sees impl classes** | ❌ No — but all impls in binary | ✅ No — only selected features in binary |
| **Global DaggerComponent** | ❌ Yes — `@Component` lists all | ✅ No — each feature has own Component |
| **Binary size** | ❌ Fat — all modules linked | ✅ Lean — only declared Gradle deps |
| **Compile-time safety** | ✅ Full cross-feature graph | ⚠️ Per-feature only (no cross-feature) |
| **Singleton sharing** | ✅ `@Singleton` on single Component | ⚠️ Via CoreApis interface (manual) |
| **Adding a new feature** | Edit `@Component` annotation | New module, no central file edit |
| **Multibindings (`@IntoMap`)** | ✅ Works — single graph | ❌ No global graph to collect into |
| **Publishing** | Monolithic artifact | Per-module Maven publishing |
| **Consumer init** | `MySdk.init(modules = ...)` umbrella | `Feature.init(core)` per-feature |
| **Feature coupling** | ⚠️ All features compiled together | ✅ Features are fully isolated |
| **Complexity** | Lower — one Component | Higher — CoreApis + N Components |
| **SDK umbrella pattern** | ✅ Natural fit | ❌ Anti-pattern (reintroduces coupling) |
| **Best for** | Small SDK, internal team, ≤10 modules | Large SDK, external consumers, modular publishing |

## Version Compatibility

| Component | Doc (original) | Current (2026) | Notes |
|-----------|---------------|----------------|-------|
| Kotlin | 1.8.x | 2.3+ | K2 compiler is default since 2.0 |
| AGP | 7.4 | 9.0+ | AGP 9 requires Kotlin 2.1+ |
| Dagger | 2.51.1 | 2.52+ | KSP processors in alpha since 2.48 |
| Annotation processing | KAPT | KSP (preferred) | KAPT in maintenance mode |

### KAPT → KSP Migration

Dagger added KSP processor support starting at 2.48 (alpha). Migration:

```kotlin
// Before (KAPT)
plugins { id("org.jetbrains.kotlin.kapt") }
dependencies { kapt("com.google.dagger:dagger-compiler:2.52") }

// After (KSP — alpha)
plugins { id("com.google.devtools.ksp") }
dependencies { ksp("com.google.dagger:dagger-compiler:2.52") }
```

**⚠️ Dagger KSP is alpha** — production use requires careful validation. KAPT still works with Kotlin 2.x but adds build overhead and is in maintenance mode.

## When to Use Each Approach

| Scenario | Approach |
|----------|----------|
| Small SDK, ≤5 modules, team owns all code | A (monolithic) |
| Large SDK, many consumers, per-module publishing | B (per-feature) |
| Consumer must not see impl classes at all | B (per-feature) |
| Compile-time validation of full graph is critical | A (monolithic) |
| KMP support needed | Neither — use Koin (see comparison doc) |
