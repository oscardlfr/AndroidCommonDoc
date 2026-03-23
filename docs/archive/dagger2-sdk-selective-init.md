---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, android-sdk]
targets: [android]
version: 4
last_updated: "2026-03"
description: "SDK initialization pattern with Dagger 2: selective module loading. Three approaches — A: monolithic Component, B: per-feature Component, C: per-feature with ServiceLoader discovery. Includes KAPT→KSP migration, version compatibility, and isolation analysis."
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
- **Approach B:** Level 1 (facade). Consumer calls `FeatureSecurity.init(core)` or `MySdk.init(setOf(...))` with delegating umbrella. Does NOT see `SecurityServiceImpl`. Only selected features are in the binary.
- **Approach C:** Level 1-2 (facade + discovery). Builds on B's per-feature Components but adds ServiceLoader discovery — no central edit when adding features.

Neither approach reaches Level 3 (sealed-class enum). Dagger's compile-time `@Component` annotation requires knowledge of impl modules at build time — there is no runtime class-loading discovery mechanism like Koin's.

## Three Architectural Approaches

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

### Approach C: Per-Feature + ServiceLoader Discovery (zero central edits)

Builds on B's per-feature architecture but adds `ServiceLoader` auto-discovery. Adding a new feature requires zero edits to the core module — only a new integration module with META-INF registration.

```
sdk-core/                → MySdk, CoreApis, FeatureInitializer contract, ServiceLoader discovery
feature/
  security/
    api/                 → SecurityApi interface
    integration/         → DaggerSecurityComponent + SecurityFeatureInitializer + META-INF
  payments/
    api/                 → PaymentsApi interface
    integration/         → DaggerPaymentsComponent + PaymentsFeatureInitializer + META-INF
```

**Pros:** Zero central edits on new feature, `MySdk.init(setOf(...))` consumer API, binary lean.
**Cons:** JVM-only (ServiceLoader not available on Kotlin/Native), runtime errors on missing deps, added complexity (META-INF, casting).

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

#### B option comparison

| | Option 1: Per-feature | Option 2: Umbrella |
|---|---|---|
| Consumer API | `Feature.init(core)` | `MySdk.init(setOf(...))` |
| Central orchestrator | None | `MySdk` (thin delegator) |
| Adding a feature | New module only | Edit `MySdk` when block |
| Global DaggerComponent | ❌ No | ❌ No |
| Best for | Independent SDKs | Single SDK, optional features |

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

## Approach C: Per-Feature with ServiceLoader Discovery

Builds on Approach B's per-feature architecture (each feature has its own DaggerComponent, no global graph) but adds automatic discovery via `ServiceLoader`. The SDK orchestrator does NOT need to know about features at compile time — adding a new feature requires zero edits to the core module.

### Architecture

```
sdk-core/                → MySdk, CoreApis, FeatureInitializer contract, ServiceLoader discovery
feature/
  security/
    api/                 → SecurityApi interface
    integration/         → DaggerSecurityComponent + SecurityFeatureInitializer
                           + META-INF/services/FeatureInitializer
  payments/
    api/                 → PaymentsApi interface
    integration/         → DaggerPaymentsComponent + PaymentsFeatureInitializer
                           + META-INF/services/FeatureInitializer
```

### FeatureInitializer contract

```kotlin
// In :sdk-core — defines the discovery contract
interface FeatureInitializer {
    val feature: Feature
    fun init(core: CoreApis)
    fun shutdown()
    fun <T> getService(serviceClass: Class<T>): T?
}
```

### Feature registration via META-INF

```kotlin
// In :feature:security:integration
class SecurityFeatureInitializer : FeatureInitializer {
    private var component: SecurityComponent? = null

    override val feature = Feature.SECURITY

    override fun init(core: CoreApis) {
        component = DaggerSecurityComponent.builder().core(core).build()
    }

    override fun shutdown() { component = null }

    @Suppress("UNCHECKED_CAST")
    override fun <T> getService(serviceClass: Class<T>): T? =
        when (serviceClass) {
            SecurityService::class.java -> component?.securityService() as? T
            else -> null
        }
}

// META-INF/services/com.example.sdk.FeatureInitializer
// → com.example.sdk.security.SecurityFeatureInitializer
```

### SDK entry point — discovery-based

```kotlin
object MySdk {
    private val initializers = mutableMapOf<Feature, FeatureInitializer>()

    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        val core = CoreApisImpl.create(context, config)

        // Discover all available features on classpath
        val available = ServiceLoader.load(FeatureInitializer::class.java)
            .associateBy { it.feature }

        for (feature in features) {
            val initializer = available[feature]
                ?: throw IllegalArgumentException(
                    "Feature $feature not found on classpath. " +
                    "Add the corresponding Gradle dependency."
                )
            initializer.init(core)
            initializers[feature] = initializer
        }
    }

    inline fun <reified T> get(): T {
        for (initializer in initializers.values) {
            initializer.getService(T::class.java)?.let { return it }
        }
        error("No service ${T::class.simpleName} found in initialized features")
    }

    fun shutdown() {
        initializers.values.forEach { it.shutdown() }
        initializers.clear()
    }
}

// Consumer:
MySdk.init(context, config, setOf(Feature.SECURITY, Feature.PAYMENTS))
val security: SecurityService = MySdk.get()
```

### Approach C limitations

- **JVM-only:** `ServiceLoader` requires `META-INF/services/` — standard JVM mechanism, NOT available on Kotlin/Native or iOS. For KMP, use Koin's `Class.forName` + `@EagerInitialization` approach instead.
- **Runtime errors:** If the consumer forgets the Gradle dependency, `ServiceLoader` won't find the initializer → runtime crash (not compile-time error).
- **Per-feature DaggerComponent:** Each feature still has its own `@Component` — compile-time graph validation is per-feature, not cross-feature.
- **Complexity:** META-INF files, ServiceLoader, and `getService` casting add ceremony compared to Approach B.

### When to use Approach C

- Large Android-only SDK with 20+ optional features
- New features added frequently without touching core module
- Team wants `MySdk.init(setOf(...))` consumer API
- Binary leanness required (only selected features linked)

## Approach Comparison

| Criterion | A: Monolithic | B: Per-Feature | C: Discovery |
|-----------|--------------|----------------|--------------|
| **Consumer sees impl classes** | ❌ No — but all in binary | ✅ No — selected only | ✅ No — selected only |
| **Global DaggerComponent** | ❌ Yes | ✅ No | ✅ No |
| **Binary size** | ❌ Fat | ✅ Lean | ✅ Lean |
| **Compile-time safety** | ✅ Full graph | ⚠️ Per-feature | ⚠️ Per-feature |
| **Singleton sharing** | ✅ @Singleton | ⚠️ CoreApis | ⚠️ CoreApis |
| **Adding a feature** | Edit @Component | Edit MySdk (umbrella) or nothing (per-feature) | Nothing — META-INF only |
| **Consumer init** | `MySdk.init(set)` | `Feature.init(core)` or `MySdk.init(set)` | `MySdk.init(set)` |
| **Discovery mechanism** | None needed | None | ServiceLoader (JVM) |
| **KMP support** | ❌ | ❌ | ❌ (ServiceLoader is JVM) |
| **Complexity** | Low | Medium | High |
| **Best for** | Small SDK, ≤10 modules | Modular SDK, per-module publish | Large SDK, 20+ features |

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
| Large SDK, 20+ features, no central edit on new feature | C (discovery) |
| Consumer must not see impl classes at all | B or C |
| Compile-time validation of full graph is critical | A (monolithic) |
| KMP support needed | Neither — see [comparison doc](di-sdk-selective-init-comparison.md) for Koin and kotlin-inject |
