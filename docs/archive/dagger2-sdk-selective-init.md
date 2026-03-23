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

### Init pattern — per module, not global

```kotlin
// Consumer initializes each feature independently
object FeatureSecurity {
    private var component: SecurityComponent? = null

    fun init(core: CoreApis) {
        component = DaggerSecurityComponent.builder()
            .core(core)
            .build()
    }
}

// Consumer code:
val core = CoreApis.create(config)
FeatureSecurity.init(core)
FeatureObservability.init(core)
```

### Each feature has its own Component

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
```

### Shared state via CoreApis, not @Singleton graph

```kotlin
// In :core-apis (no Dagger)
interface CoreApis {
    val logger: Logger
    val config: SdkConfig
    val networkExecutor: NetworkExecutor
}
```

### Publishing

Each module publishes independently:
```kotlin
// feature/security/integration/build.gradle.kts
publishing {
    singleVariant("release") { withSourcesJar() }
}
```

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
