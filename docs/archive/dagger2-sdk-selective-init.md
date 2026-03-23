---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, android-sdk]
targets: [android]
version: 6
last_updated: "2026-03"
description: "Three Dagger 2 approaches for modular SDK initialization — A: monolithic, B: per-feature, C: ServiceLoader discovery. Enterprise-grade code with lifecycle management."
slug: dagger2-sdk-selective-init
status: archived
layer: L0
category: archive
---

# Dagger 2: Modular SDK Initialization

Three approaches for building an Android SDK where consumers select which features to activate. Each approach uses Dagger 2 for compile-time DI but differs in how features are organized, discovered, and initialized.

For framework comparison (Dagger vs Koin vs kotlin-inject), see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md).
For isolation levels and DI concepts, see [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md).

---

## Approach A: Monolithic Component

One `@Component` contains all feature modules. The consumer selects features at runtime but ALL feature code is compiled into the binary.

### Module structure

```
sdk-core/        → SdkComponent, SdkConfig, CoreModule (shared singletons)
sdk-auth/        → AuthDaggerModule, AuthService
sdk-analytics/   → AnalyticsDaggerModule, AnalyticsService  
sdk-payments/    → PaymentsDaggerModule, PaymentService
```

### How singletons work

All features share one `@Singleton` scope because they're in one `@Component`:

```kotlin
@Singleton
@Component(modules = [
    CoreModule::class,         // Logger, NetworkExecutor, Storage
    AuthDaggerModule::class,   // AuthService — always compiled in
    AnalyticsDaggerModule::class,
    PaymentsDaggerModule::class,
])
interface SdkComponent {
    fun moduleInitializers(): Map<SdkModule, @JvmSuppressWildcards Provider<ModuleInitializer>>
    fun authService(): AuthService

    @Component.Builder
    interface Builder {
        @BindsInstance fun config(config: SdkConfig): Builder
        @BindsInstance fun context(context: Context): Builder
        fun build(): SdkComponent
    }
}
```

When `AuthDaggerModule` needs `NetworkExecutor`, Dagger resolves it from `CoreModule` in the same graph. No manual wiring needed.

### Feature module example

```kotlin
@Module
class AuthDaggerModule {
    @Provides @Singleton
    fun provideAuthService(
        network: NetworkExecutor,    // resolved from CoreModule
        logger: Logger,              // resolved from CoreModule
        config: SdkConfig,           // resolved from @BindsInstance
    ): AuthService = AuthServiceImpl(network, logger, config)

    @Provides @IntoMap @SdkModuleKey(SdkModule.AUTH)
    fun provideInitializer(service: Provider<AuthService>): ModuleInitializer {
        return AuthModuleInitializer(service)
    }
}
```

### SDK entry point

```kotlin
object MySdk {
    private var _component: SdkComponent? = null
    private var _initialized = false
    private var _activeModules = emptySet<SdkModule>()

    val isInitialized: Boolean get() = _initialized

    fun init(context: Context, config: SdkConfig, modules: Set<SdkModule>) {
        check(!_initialized) { "SDK already initialized. Call shutdown() first." }
        require(modules.isNotEmpty()) { "modules must not be empty." }

        val comp = DaggerSdkComponent.builder()
            .context(context.applicationContext)
            .config(config)
            .build()

        val initializers = comp.moduleInitializers()
        for (module in modules) {
            val initializer = initializers[module]
                ?: throw IllegalArgumentException(
                    "Unknown module: $module. Available: ${initializers.keys}"
                )
            initializer.get().initialize()
        }

        _component = comp
        _initialized = true
        _activeModules = modules.toSet()
    }

    fun shutdown() {
        if (!_initialized) return
        val initializers = _component!!.moduleInitializers()
        for (module in _activeModules) {
            initializers[module]?.get()?.shutdown()
        }
        _component = null
        _initialized = false
        _activeModules = emptySet()
    }

    fun requireModule(module: SdkModule) {
        check(_initialized) { "SDK not initialized. Call init() first." }
        check(module in _activeModules) {
            "Module '${module.key}' not initialized. Add it to init(modules = ...)."
        }
    }

    fun auth(): AuthService {
        requireModule(SdkModule.AUTH)
        return _component!!.authService()
    }
}
```

### What the consumer sees

```kotlin
// Consumer code — does NOT import AuthServiceImpl or any Dagger class
MySdk.init(context, config, setOf(SdkModule.AUTH, SdkModule.ANALYTICS))
val auth = MySdk.auth()
```

### Limitations

- **Binary bloat:** `AuthDaggerModule`, `AnalyticsDaggerModule`, `PaymentsDaggerModule` are ALL compiled into every consumer's APK — even if they only use AUTH.
- **Central coupling:** Adding a new feature requires editing the `@Component` annotation.
- **No per-feature publishing:** Can't publish `sdk-auth` as an independent Maven artifact because `SdkComponent` must see all modules at compile time.

---

## Approach B: Per-Feature Components

Each feature has its own `DaggerComponent`. No global graph. Shared state passes through a `CoreApis` interface.

### Module structure

```
sdk-core-apis/           → CoreApis interface, SdkConfig (NO Dagger)
sdk-core-impl/           → CoreApisImpl, FoundationSingletons
feature/
  security/
    api/                 → SecurityService interface (NO Dagger)
    integration/         → DaggerSecurityComponent, SecurityServiceImpl
  payments/
    api/                 → PaymentsService interface
    integration/         → DaggerPaymentsComponent, PaymentsServiceImpl
```

### How singletons work — the CoreApis trade-off

There is NO shared `@Singleton` scope across features. Each `DaggerComponent` has its own scope. Shared services pass through `CoreApis`:

```kotlin
// sdk-core-apis — NO Dagger dependency
interface CoreApis {
    val logger: Logger
    val config: SdkConfig
    val networkExecutor: NetworkExecutor
}
```

Each feature receives `CoreApis` at init and uses its services:

```kotlin
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
        return SecurityServiceImpl(core.logger, core.networkExecutor, core.config)
    }
}
```

**The cross-feature problem:** If `SecurityService` needs `PaymentsService`, there's no Dagger graph that contains both. Options:

1. **Add it to CoreApis** — but CoreApis grows into a God Object containing every shared service. At 20+ services it becomes unmanageable.
2. **Initialize in order and pass dependencies** — `PaymentsFeature.init(core)` first, then `SecurityFeature.init(core, payments.service())`. Creates implicit ordering and coupling.
3. **Accept the limitation** — design features to be truly independent. If they need to talk, do it through CoreApis-level abstractions, not direct service injection.

### Feature facade

```kotlin
object FeatureSecurity {
    private var component: SecurityComponent? = null

    fun init(core: CoreApis) {
        check(component == null) { "Security already initialized." }
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

### Consumer init — two options

**Option 1: Per-feature (most decoupled)**
```kotlin
val core = CoreApisImpl.create(context, config)
FeatureSecurity.init(core)
// FeaturePayments NOT imported, NOT in binary
```

**Option 2: Thin umbrella (convenience, NOT a DaggerComponent)**
```kotlin
object MySdk {
    private var _initialized = false
    private var _core: CoreApis? = null

    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        check(!_initialized) { "SDK already initialized." }
        val core = CoreApisImpl.create(context, config)
        _core = core
        for (feature in features) {
            when (feature) {
                Feature.SECURITY -> FeatureSecurity.init(core)
                Feature.PAYMENTS -> FeaturePayments.init(core)
            }
        }
        _initialized = true
    }
}
```

Note: this umbrella is a plain Kotlin `object` — it does NOT have a `@Component`. Each feature's `DaggerComponent` is independent.

### Limitations

- **CoreApis grows:** Every service shared between features must be in CoreApis. With 10+ shared services, this interface becomes unwieldy.
- **No cross-feature DI:** Feature A cannot `@Inject` a service from Feature B through Dagger. Only through CoreApis or manual passing.
- **Consumer knows integration module:** Consumer imports `FeatureSecurity` from `:feature:security:integration`.

---

## Approach C: Per-Feature with ServiceLoader Discovery

Same per-feature architecture as B, but the SDK discovers features automatically via `ServiceLoader`. Adding a new feature requires zero edits to the core module.

### Module structure

```
sdk-core/                → MySdk, CoreApis, FeatureInitializer contract
feature/
  security/integration/  → DaggerSecurityComponent + SecurityFeatureInitializer
                           + META-INF/services/com.example.sdk.FeatureInitializer
  payments/integration/  → DaggerPaymentsComponent + PaymentsFeatureInitializer
                           + META-INF/services/com.example.sdk.FeatureInitializer
```

### Discovery contract

```kotlin
// sdk-core defines this — feature modules implement it
interface FeatureInitializer {
    val feature: Feature
    fun init(core: CoreApis)
    fun shutdown()
    fun <T> getService(serviceClass: Class<T>): T?
}
```

### Feature implements the contract

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
```

Registration via `META-INF/services/com.example.sdk.FeatureInitializer`:
```
com.example.sdk.security.SecurityFeatureInitializer
```

### SDK entry point

```kotlin
object MySdk {
    private val _initializers = mutableMapOf<Feature, FeatureInitializer>()
    private var _initialized = false

    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        check(!_initialized) { "SDK already initialized." }
        require(features.isNotEmpty()) { "features must not be empty." }

        val core = CoreApisImpl.create(context, config)
        val available = ServiceLoader.load(FeatureInitializer::class.java)
            .associateBy { it.feature }

        for (feature in features) {
            val initializer = available[feature]
                ?: throw IllegalArgumentException(
                    "Feature $feature not found. Add its Gradle dependency."
                )
            initializer.init(core)
            _initializers[feature] = initializer
        }
        _initialized = true
    }

    inline fun <reified T> get(): T {
        check(_initialized) { "SDK not initialized." }
        for (init in _initializers.values) {
            init.getService(T::class.java)?.let { return it }
        }
        error("No service ${T::class.simpleName} found.")
    }

    fun shutdown() {
        if (!_initialized) return
        _initializers.values.forEach { it.shutdown() }
        _initializers.clear()
        _initialized = false
    }
}
```

### What the consumer sees

```kotlin
MySdk.init(context, config, setOf(Feature.SECURITY))
val security: SecurityService = MySdk.get()
```

### Limitations

- **JVM-only:** `ServiceLoader` requires `META-INF/services/` — not available on Kotlin/Native.
- **Runtime errors:** Missing Gradle dependency = `IllegalArgumentException` at runtime, not compile-time.
- **Same CoreApis problem as B:** Cross-feature dependencies must go through CoreApis.
- **`getService` casting:** Runtime type resolution, not compile-time safe.

---

## Comparison

| | A: Monolithic | B: Per-Feature | C: Discovery |
|---|---|---|---|
| **Consumer init** | `MySdk.init(setOf(...))` | `Feature.init(core)` or umbrella | `MySdk.init(setOf(...))` |
| **Global DaggerComponent** | Yes | No | No |
| **Binary includes** | All features | Only selected | Only selected |
| **Cross-feature deps** | ✅ Same graph | ❌ CoreApis only | ❌ CoreApis only |
| **Singleton sharing** | `@Singleton` graph | CoreApis manual | CoreApis manual |
| **Adding a feature** | Edit `@Component` | New module + edit umbrella | New module + META-INF |
| **Compile-time safety** | Full graph | Per-feature | Per-feature |
| **Publishing** | Monolithic | Per-module | Per-module |
| **KMP** | No | No | No (ServiceLoader JVM) |
| **Complexity** | Low | Medium | High |

### When to use

| Scenario | Approach |
|----------|----------|
| Small SDK (≤5 features), single team | A |
| Modular SDK, per-feature publishing, features mostly independent | B |
| Large SDK (20+ features), frequent additions, JVM-only | C |
| Features heavily depend on each other's services | A (or consider Koin) |
| KMP required | None — see [comparison doc](di-sdk-selective-init-comparison.md) |

## Version Compatibility (2026)

| Component | Version | Notes |
|-----------|---------|-------|
| Kotlin | 2.3+ | K2 compiler default since 2.0 |
| AGP | 9.0+ | Requires Kotlin 2.1+ |
| Dagger | 2.52+ | KSP alpha since 2.48, KAPT in maintenance |

### KAPT → KSP

```kotlin
// KAPT (legacy)
plugins { id("org.jetbrains.kotlin.kapt") }
dependencies { kapt("com.google.dagger:dagger-compiler:2.52") }

// KSP (alpha — validate before production use)
plugins { id("com.google.devtools.ksp") }
dependencies { ksp("com.google.dagger:dagger-compiler:2.52") }
```
