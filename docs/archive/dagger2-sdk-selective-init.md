---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, android-sdk]
targets: [android]
version: 7
last_updated: "2026-03"
description: "Three Dagger 2 approaches for modular SDK initialization — A: monolithic, B: per-feature, C: ServiceLoader discovery. Enterprise-grade code with lifecycle management."
slug: dagger2-sdk-selective-init
status: archived
layer: L0
category: archive
---

# Dagger 2: Modular SDK Initialization

Three approaches for building an Android SDK where consumers select which features to activate. Each uses Dagger 2 for compile-time DI but solves the problem differently.

For framework comparison (Dagger vs Koin vs kotlin-inject), see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md).
For DI concepts (isolation levels, cross-feature deps), see [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md).

---

## The Problem

You're building an SDK with N features (auth, analytics, payments, etc.). Consumers should:
1. Pick which features to activate
2. Not see implementation classes
3. Not pay binary size for features they don't use

Dagger 2 solves (2) via compile-time codegen. But (1) and (3) conflict — Dagger needs to know all modules at compile time, and knowing them means compiling them. The three approaches navigate this tension differently.

---

## Approach A: One Component, All Features

```
┌─────────────────────────────────────────────────────────┐
│                   SdkComponent (@Singleton)              │
│                                                          │
│  CoreModule ─── AuthModule ─── PaymentsModule            │
│  (Logger)       (AuthService)  (PaymentService)          │
│  (Config)       can inject ←── can inject Logger,        │
│  (Network)      Logger,        Config, AuthService       │
│                 Config                                    │
└─────────────────────────────────────────────────────────┘
```

ONE `@Component` lists ALL feature modules. Dagger generates ONE factory that knows how to create everything. Any module can inject any service from any other module.

### Implementation

```kotlin
@Singleton
@Component(modules = [
    CoreModule::class,          // Logger, NetworkExecutor, Storage
    AuthDaggerModule::class,    // AuthService
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

Each feature module provides its service and a lazy initializer:

```kotlin
@Module
class AuthDaggerModule {
    @Provides @Singleton
    fun provideAuthService(
        network: NetworkExecutor,    // Dagger resolves from CoreModule — same graph
        logger: Logger,              // Dagger resolves from CoreModule — same graph
        config: SdkConfig,           // Dagger resolves from @BindsInstance
    ): AuthService = AuthServiceImpl(network, logger, config)

    @Provides @IntoMap @SdkModuleKey(SdkModule.AUTH)
    fun provideInitializer(service: Provider<AuthService>): ModuleInitializer =
        AuthModuleInitializer(service)
}
```

The SDK facade selectively initializes requested features:

```kotlin
object MySdk {
    private var _component: SdkComponent? = null
    private var _activeModules = emptySet<SdkModule>()

    fun init(context: Context, config: SdkConfig, modules: Set<SdkModule>) {
        check(_component == null) { "SDK already initialized. Call shutdown() first." }
        require(modules.isNotEmpty()) { "modules must not be empty." }

        val comp = DaggerSdkComponent.builder()
            .context(context.applicationContext)
            .config(config)
            .build()

        // Only initialize requested modules — others exist in the Component but are never called
        val initializers = comp.moduleInitializers()
        for (module in modules) {
            val init = initializers[module]
                ?: throw IllegalArgumentException("Unknown module: $module. Available: ${initializers.keys}")
            init.get().initialize()
        }

        _component = comp
        _activeModules = modules.toSet()
    }

    fun auth(): AuthService {
        check(SdkModule.AUTH in _activeModules) { "AUTH not initialized." }
        return _component!!.authService()
    }

    fun shutdown() {
        _component?.let { comp ->
            val inits = comp.moduleInitializers()
            _activeModules.forEach { inits[it]?.get()?.shutdown() }
        }
        _component = null
        _activeModules = emptySet()
    }
}
```

### What the consumer sees

```kotlin
MySdk.init(context, config, setOf(SdkModule.AUTH, SdkModule.ANALYTICS))
val auth = MySdk.auth()     // works
val pay = MySdk.payments()  // crashes — PAYMENTS not in set
```

### Why choose A

- **Cross-feature injection works.** PaymentsModule can `@Inject AuthService` — same graph.
- **Simple.** One Component, one builder, one init call.
- **Full compile-time validation.** If any `@Provides` is missing, the build fails.

### Why NOT A

- **Binary bloat.** PaymentsDaggerModule is compiled into the APK even if the consumer never uses payments. Dagger generates the factory code for ALL modules.
- **Central coupling.** Adding a new feature = edit the `@Component` annotation. Everyone who depends on sdk-core recompiles.
- **Can't publish features independently.** `sdk-auth` can't be a separate Maven artifact because `SdkComponent` must see `AuthDaggerModule` at compile time.

---

## Approach B: Separate Component Per Feature

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ SecurityComp │    │ PaymentsComp │    │ AnalyticsComp│
│  @Singleton  │    │  @Singleton  │    │  @Singleton  │
│              │    │              │    │              │
│ SecuritySvc  │    │ PaymentsSvc  │    │ AnalyticsSvc │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └──────────┬────────┘───────────────────┘
                  ↓
          ┌──────────────┐
          │   CoreApis   │   ← plain Kotlin interface, NOT Dagger
          │              │
          │ .logger      │   created once before any feature init
          │ .config      │
          │ .network     │
          └──────────────┘
```

Each feature has its OWN `DaggerComponent`. There is NO global Component. Shared infrastructure passes through `CoreApis` — a plain Kotlin interface, not a Dagger construct.

### How CoreApis replaces the global graph

In Approach A, features share singletons because they're in the same `@Component`. In B, there's no shared Component. So how does SecurityService get the Logger?

**Step 1:** Create CoreApis before any feature:
```kotlin
// CoreApis is a plain interface — NO @Component, NO @Module
interface CoreApis {
    val logger: Logger
    val config: SdkConfig
    val networkExecutor: NetworkExecutor
}

// Implementation creates the shared objects
class CoreApisImpl private constructor(
    override val logger: Logger,
    override val config: SdkConfig,
    override val networkExecutor: NetworkExecutor,
) : CoreApis {
    companion object {
        fun create(context: Context, config: SdkConfig): CoreApis =
            CoreApisImpl(
                logger = FoundationSingletons.logger,
                config = config,
                networkExecutor = OkHttpNetworkExecutor(config),
            )
    }
}
```

**Step 2:** Each feature's DaggerComponent receives CoreApis as input:
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
    fun provideSecurityService(core: CoreApis): SecurityService =
        SecurityServiceImpl(core.logger, core.networkExecutor, core.config)
        //                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
        //    manually extracting deps from CoreApis — NOT Dagger resolution
}
```

**Key insight:** `core.logger` is NOT Dagger resolving a dependency. It's plain Kotlin property access. Dagger generates the code that calls `provideSecurityService(coreApis)`, and inside that method, you manually pull what you need from the interface. This is the fundamental trade-off: you lose Dagger's automatic resolution across features, but gain the ability to compile features independently.

### Feature facade

```kotlin
object FeatureSecurity {
    private var component: SecurityComponent? = null

    fun init(core: CoreApis) {
        check(component == null) { "Security already initialized." }
        component = DaggerSecurityComponent.builder().core(core).build()
    }

    fun securityService(): SecurityService =
        component?.securityService() ?: error("Security not initialized.")

    fun shutdown() { component = null }
}
```

### Consumer init

**Option 1: Per-feature** — most decoupled, consumer decides order:
```kotlin
val core = CoreApisImpl.create(context, config)
FeatureSecurity.init(core)
// FeaturePayments never imported, never in binary
```

**Option 2: Thin umbrella** — convenience, NOT a DaggerComponent:
```kotlin
object MySdk {
    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        val core = CoreApisImpl.create(context, config)
        for (feature in features) {
            when (feature) {
                Feature.SECURITY -> FeatureSecurity.init(core)
                Feature.PAYMENTS -> FeaturePayments.init(core)
            }
        }
    }
}
```

This `when` block is the trade-off: adding a new feature requires editing it.

### Why choose B

- **Binary lean.** Consumer only gets feature code they depend on in Gradle. FeaturePayments not in Gradle → not in APK.
- **Independent publishing.** `sdk-security` and `sdk-payments` are separate Maven artifacts. Teams can adopt features one at a time.
- **No central Component edit.** Adding a feature doesn't force recompilation of other features.

### Why NOT B

- **No cross-feature DI.** If PaymentsService needs SecurityService, Dagger can't help — they're in separate Components. You must either:
  - Add `SecurityService` to CoreApis (but at 15+ shared services, CoreApis becomes a God Object)
  - Initialize in order and pass manually (creates hidden coupling)
- **Manual singleton sharing.** `@Singleton` only scopes within one Component. Cross-feature singletons live in CoreApis (manually managed).
- **Umbrella needs editing.** New feature → edit `when` block.

---

## Approach C: Per-Feature + ServiceLoader Auto-Discovery

Same architecture as B (separate DaggerComponents, CoreApis bridge), but features register themselves via JVM's `ServiceLoader`. Adding a feature = add Gradle dependency + META-INF file. Zero edits to core.

### How it differs from B

In B, the umbrella has a `when` block that maps features to facades. In C, the SDK discovers features at runtime:

```kotlin
// Core defines a contract — features implement it
interface FeatureInitializer {
    val feature: Feature
    fun init(core: CoreApis)
    fun shutdown()
    fun <T> getService(serviceClass: Class<T>): T?
}
```

Each feature provides a META-INF registration:
```
// feature/security/integration/src/main/resources/META-INF/services/com.example.sdk.FeatureInitializer
com.example.sdk.security.SecurityFeatureInitializer
```

The SDK discovers all registered features at runtime:
```kotlin
object MySdk {
    private val _initializers = mutableMapOf<Feature, FeatureInitializer>()

    fun init(context: Context, config: SdkConfig, features: Set<Feature>) {
        val core = CoreApisImpl.create(context, config)

        // ServiceLoader scans META-INF/services/ on the classpath
        val available = ServiceLoader.load(FeatureInitializer::class.java)
            .associateBy { it.feature }

        for (feature in features) {
            val initializer = available[feature]
                ?: throw IllegalArgumentException(
                    "Feature $feature not on classpath. Add its Gradle dependency."
                )
            initializer.init(core)
            _initializers[feature] = initializer
        }
    }

    inline fun <reified T> get(): T {
        for (init in _initializers.values) {
            init.getService(T::class.java)?.let { return it }
        }
        error("No service ${T::class.simpleName} found in initialized features.")
    }
}
```

### What the consumer sees

```kotlin
MySdk.init(context, config, setOf(Feature.SECURITY))
val security: SecurityService = MySdk.get()
```

### Why choose C over B

- **Zero-edit feature addition.** New feature = new Gradle module + META-INF. No umbrella `when` to maintain.
- **Good for 20+ features.** The `when` block in B becomes unmanageable at scale. C scales without central edits.

### Why NOT C

- **JVM-only.** `ServiceLoader` requires `META-INF/services/` — not available on Kotlin/Native or JS.
- **Runtime errors.** Missing Gradle dependency = crash at init, not build error. B would catch this as a compile error (unused import warning, at least).
- **`getService` casting.** Runtime type check, not compile-time.
- **Same CoreApis limitation as B.** Cross-feature deps still go through CoreApis.

---

## Comparison

|  | A: One Component | B: Per-Feature | C: Discovery |
|---|---|---|---|
| **Architecture** | 1 DaggerComponent with all modules | N separate DaggerComponents + CoreApis | Same as B + ServiceLoader |
| **Cross-feature deps** | ✅ Same graph, any module injects any other | ❌ Only through CoreApis (manual) | ❌ Only through CoreApis (manual) |
| **Singleton sharing** | ✅ `@Singleton` scope on the Component | ❌ Each Component has own scope. Shared = CoreApis | ❌ Same as B |
| **Binary includes** | ❌ ALL feature code, even unused | ✅ Only Gradle dependencies | ✅ Only Gradle dependencies |
| **Adding a feature** | Edit `@Component` + recompile core | New module + edit `when` block | New module + META-INF file |
| **Publishing** | ❌ Monolithic — one artifact | ✅ Per-feature Maven artifacts | ✅ Per-feature Maven artifacts |
| **Compile-time safety** | ✅ Full graph validated | ⚠️ Per-feature only | ⚠️ Per-feature + runtime discovery |
| **KMP** | ❌ JVM only | ❌ JVM only | ❌ JVM only (ServiceLoader) |
| **Complexity** | Low | Medium | High |

### When to use

| Scenario | Approach |
|----------|----------|
| Small SDK (≤5 features), one team, features share data | **A** |
| Modular SDK, per-feature publishing, features independent | **B** |
| 20+ features, frequent additions, JVM-only | **C** |
| Features heavily depend on each other | **A** (or consider Koin) |
| KMP needed | None of these — see [comparison doc](di-sdk-selective-init-comparison.md) |
