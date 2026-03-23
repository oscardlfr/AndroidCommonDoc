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

> **Note:** This pattern is for **Android-only** SDKs. For KMP SDKs, see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md) — the Koin approach is implemented and validated with 100% test coverage.

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

### SDK entry point — optional umbrella OR per-feature init

Consumer can initialize features individually OR use an optional umbrella:

```kotlin
// Option 1: Per-feature init (recommended for modular SDKs)
val core = CoreApisImpl.create(context, SdkConfig(baseUrl = "...", apiKey = "..."))
FeatureSecurity.init(core)
FeatureObservability.init(core)
// Payments never initialized → never instantiated, not in binary

// Option 2: Umbrella init (convenience wrapper, optional)
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
}

// Consumer: MySdk.init(context, config, setOf(Feature.SECURITY, Feature.OBSERVABILITY))
```

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
| **Consumer isolation** | ❌ All impls compiled in | ✅ Only selected features |
| **Binary size** | ❌ Fat — all modules linked | ✅ Lean — only declared deps |
| **Compile-time safety** | ✅ Full graph validated | ⚠️ Per-feature only |
| **Singleton sharing** | ✅ `@Singleton` on single Component | ⚠️ Via CoreApis (manual) |
| **Adding a new feature** | Edit `@Component` annotation | New module, no central edit |
| **Multibindings (`@IntoMap`)** | ✅ Works — single graph | ❌ No global graph |
| **Publishing** | Monolithic artifact | Per-module Maven publishing |
| **Consumer init** | `MySdk.init(modules = ...)` | Per-feature or optional umbrella |
| **Feature coupling** | All features see each other | Features are isolated |
| **Complexity** | Lower — one Component | Higher — CoreApis + N Components |
| **Best for** | Small SDK, internal team | Large SDK, external consumers |

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
