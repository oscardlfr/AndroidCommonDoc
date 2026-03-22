---
scope: [architecture, dependency-injection, sdk-design]
sources: [dagger2, android-sdk]
targets: [android]
version: 3
last_updated: "2026-03"
description: "SDK initialization pattern with Dagger 2: selective module loading, shared singletons, zero-duplicate instances. For Android-only SDKs. Includes discovery trade-off analysis vs KMP/Koin approach. See di-sdk-selective-init-comparison.md for full framework comparison."
slug: dagger2-sdk-selective-init
status: archived
layer: L0
category: archive
---

# Dagger 2 SDK: Selective Module Initialization

Pattern for SDKs multi-módulo con Dagger 2 donde el consumidor elige qué módulos activar en runtime, manteniendo **un único grafo de dependencias** y **cero duplicados de singletons compartidos**.

> **Note:** This pattern is for **Android-only** SDKs using Dagger 2. For KMP SDKs, see [di-sdk-selective-init-comparison.md](di-sdk-selective-init-comparison.md) — the Koin approach was implemented and validated in shared-kmp-libs with 100% test coverage.

## Problema

Un SDK corporativo con N features (auth, analytics, payments...) necesita:

1. **Inicialización selectiva** — el consumidor decide qué módulos activar
2. **Singletons compartidos** — `NetworkExecutor`, `Storage`, `Logger` existen una sola vez
3. **Lazy instantiation** — features no solicitadas nunca se instancian
4. **Config unificado** — un solo `SdkConfig` para todos los módulos

## Principio clave

`@Singleton` en Dagger es **por componente**, no global. Dos `@Component` separados crean dos instancias de cada singleton. La solución: **un único componente raíz** que posee todos los singletons compartidos.

## Estructura de módulos Gradle

```
sdk-core/        → SdkComponent, SdkConfig, singletons compartidos
sdk-auth/        → AuthModuleInitializer, AuthService
sdk-analytics/   → AnalyticsModuleInitializer, AnalyticsService
sdk-payments/    → PaymentsModuleInitializer, PaymentService
```

## Implementación

### 1. Config y enumeración de módulos

```kotlin
// sdk-core

data class SdkConfig(
    val baseUrl: String,
    val apiKey: String,
    val environment: Environment = Environment.PRODUCTION,
    val debugMode: Boolean = false,
)

enum class Environment { DEVELOPMENT, STAGING, PRODUCTION }

enum class SdkModule {
    AUTH,
    ANALYTICS,
    PAYMENTS,
}
```

### 2. Contrato de inicialización

```kotlin
// sdk-core

interface ModuleInitializer {
    /** Qué módulo representa */
    val module: SdkModule

    /**
     * Inicialización del módulo.
     * Se llama SÓLO si el consumidor pidió este módulo en init().
     */
    fun initialize()

    /** Teardown limpio */
    fun shutdown() {}
}
```

### 3. MapKey para Dagger multibindings

```kotlin
// sdk-core

@MapKey
@Target(AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class SdkModuleKey(val value: SdkModule)
```

### 4. CoreModule — singletons compartidos

Usa `@BindsInstance` para los inputs (config, context) y un `object` module para los factory methods:

```kotlin
// sdk-core

@Module
object CoreModule {

    @Provides @Singleton
    fun provideNetworkExecutor(config: SdkConfig): NetworkExecutor {
        return NetworkExecutor(config.baseUrl, config.apiKey, config.debugMode)
    }

    @Provides @Singleton
    fun provideStorage(context: Context): Storage {
        return EncryptedStorageImpl(context)
    }

    @Provides @Singleton
    fun provideLogger(config: SdkConfig): Logger {
        return if (config.debugMode) DebugLogger() else NoOpLogger()
    }
}
```

### 5. Feature module — ejemplo Auth

```kotlin
// sdk-auth

/** Dagger @Module — provee las dependencias de Auth */
@Module
class AuthDaggerModule {

    @Provides @Singleton
    fun provideTokenStore(storage: Storage): TokenStore {
        // storage es el MISMO singleton de CoreModule
        return TokenStoreImpl(storage)
    }

    @Provides @Singleton
    fun provideAuthService(
        network: NetworkExecutor,
        tokenStore: TokenStore,
        config: SdkConfig,
        logger: Logger,
    ): AuthService {
        return AuthServiceImpl(network, tokenStore, config, logger)
    }

    @Provides
    @IntoMap
    @SdkModuleKey(SdkModule.AUTH)
    fun provideInitializer(authService: Provider<AuthService>): ModuleInitializer {
        // Provider<> = lazy — AuthService NO se crea hasta que se llame .get()
        return AuthModuleInitializer(authService)
    }
}

class AuthModuleInitializer(
    private val authServiceProvider: Provider<AuthService>,
) : ModuleInitializer {

    override val module = SdkModule.AUTH
    private var _service: AuthService? = null

    override fun initialize() {
        _service = authServiceProvider.get()
        _service!!.restoreSession()
    }

    override fun shutdown() {
        _service?.clearSession()
    }
}
```

### 6. Componente raíz

```kotlin
// sdk-core

@Singleton
@Component(modules = [
    CoreModule::class,
    AuthDaggerModule::class,
    AnalyticsDaggerModule::class,
    PaymentsDaggerModule::class,
])
interface SdkComponent {

    // Provider en el mapa → Dagger NO instancia los initializers hasta .get()
    fun moduleInitializers(): Map<SdkModule, @JvmSuppressWildcards Provider<ModuleInitializer>>

    // Singletons expuestos al consumidor
    fun networkExecutor(): NetworkExecutor
    fun authService(): AuthService

    @Component.Builder
    interface Builder {
        @BindsInstance fun config(config: SdkConfig): Builder
        @BindsInstance fun context(context: Context): Builder
        fun build(): SdkComponent
    }
}
```

### 7. Punto de entrada del SDK

```kotlin
object MySdk {

    private var component: SdkComponent? = null
    private val initializedModules = mutableSetOf<SdkModule>()

    /**
     * Inicializa el SDK con los módulos solicitados.
     *
     * ```
     * MySdk.init(
     *     context = applicationContext,
     *     config = SdkConfig(baseUrl = "https://api.corp.com", apiKey = "..."),
     *     modules = setOf(SdkModule.AUTH, SdkModule.ANALYTICS),
     * )
     * ```
     */
    fun init(context: Context, config: SdkConfig, modules: Set<SdkModule>) {
        check(component == null) { "SDK already initialized" }

        val comp = DaggerSdkComponent.builder()
            .context(context.applicationContext)
            .config(config)
            .build()

        component = comp

        val initializers = comp.moduleInitializers()
        for (module in modules) {
            val initializer = initializers[module]
                ?: throw IllegalArgumentException(
                    "Unknown module: $module. Available: ${initializers.keys}"
                )
            initializer.get().initialize()
            initializedModules += module
        }
    }

    fun auth(): AuthService {
        checkInitialized(SdkModule.AUTH)
        return requireComponent().authService()
    }

    fun shutdown() {
        val comp = component ?: return
        val initializers = comp.moduleInitializers()
        for (module in initializedModules) {
            initializers[module]?.get()?.shutdown()
        }
        initializedModules.clear()
        component = null
    }

    private fun checkInitialized(module: SdkModule) {
        check(component != null) { "SDK not initialized. Call MySdk.init() first." }
        check(module in initializedModules) {
            "Module $module not initialized. Add it to MySdk.init(modules = ...)"
        }
    }

    private fun requireComponent(): SdkComponent =
        component ?: error("SDK not initialized")
}
```

## Dependencias Gradle

```kotlin
// sdk-core/build.gradle.kts
dependencies {
    implementation("com.google.dagger:dagger:2.51.1")
    kapt("com.google.dagger:dagger-compiler:2.51.1")
}

// sdk-auth/build.gradle.kts — each feature module needs kapt too
dependencies {
    implementation(project(":sdk-core"))
    implementation("com.google.dagger:dagger:2.51.1")
    kapt("com.google.dagger:dagger-compiler:2.51.1")
}
```

## Discovery Trade-Off: Dagger vs Koin/KMP

Dagger sidesteps the module discovery problem entirely — but at a cost.

### Dagger: No Discovery Problem

The `@Component` annotation explicitly lists all `@Module` classes at compile time:

```kotlin
@Component(modules = [
    CoreModule::class,
    AuthDaggerModule::class,       // ← always compiled in
    AnalyticsDaggerModule::class,  // ← always compiled in
    PaymentsDaggerModule::class,   // ← always compiled in
])
interface SdkComponent { ... }
```

There's no class-loading mystery. No `init {}` blocks that may or may not fire. The generated `DaggerSdkComponent` hardcodes the full graph. Selective loading happens at runtime via `Provider<ModuleInitializer>` laziness — the module code is present but not instantiated until requested.

**The trade-off:** The SDK orchestrator (`sdk-core`) depends on ALL impl modules. Adding a new SDK module (e.g. `sdk-push`) requires editing the `@Component` annotation. Every consumer binary includes all impl code — even modules they never activate.

### Koin/KMP: Discovery Required, Binary Lean

In the Koin approach (implemented in shared-kmp-libs), `core-sdk` depends on ZERO impl modules. The consumer's Gradle dependencies determine what's on the classpath. `SharedSdk.init()` uses platform-specific discovery:

- **JVM:** `Class.forName(registrationClassName)` — triggers `<clinit>` → `init {}` → register
- **Native:** `@EagerInitialization` — forces object init before `main()`

Adding a new impl module requires NO changes to `core-sdk` (only a className entry in the exhaustive `when` on `SdkModule.registrationClassName`). The consumer binary includes only the impls they declared in Gradle.

### When Dagger's Approach Is Better

- **Android-only SDK** where binary size isn't critical
- **Small number of impl modules** where "include everything" is acceptable
- **Compile-time safety is paramount** — Dagger catches missing bindings at build time
- **Team prefers zero-risk module wiring** — no possibility of runtime `ClassNotFoundException`

### When Koin/KMP's Approach Is Better

- **Multi-platform SDK** targeting iOS, macOS, Desktop, Android
- **Large module matrix** where including everything bloats the binary
- **Consumer selection of impls is a core product feature** (not all consumers need all impls)
- **New modules added frequently** — no central orchestrator file to edit
