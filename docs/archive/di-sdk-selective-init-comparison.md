---
scope: [architecture, dependency-injection, sdk-design, research]
sources: [dagger2, koin, hilt, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 1
last_updated: "2026-03"
description: "DI framework comparison for SDK selective init — Dagger 2 vs Koin vs Hilt vs kotlin-inject. Sealed class pattern for impl-agnostic module selection."
slug: di-sdk-selective-init-comparison
status: active
layer: L0
category: archive
---

# DI SDK Selective Init — Framework Comparison

Research doc: comparison of DI frameworks for an SDK where consumers select which modules to initialize without knowing implementation classes.

## The Problem

An SDK with N feature modules (network, storage, io, json, firebase...) where:

1. Each feature has multiple implementations (Ktor vs Retrofit, MMKV vs DataStore vs Settings)
2. Consumers pick which implementations to use at init time
3. **Consumers never import implementation classes** — only a sealed class enum
4. Shared singletons (logger, config, id generator) must not duplicate
5. Modules not requested must not be instantiated

## Sealed Class — Common to All Solutions

Regardless of DI framework, consumers interact through a sealed class:

```kotlin
sealed class SdkModule(val key: String) {

    sealed class Io(key: String) : SdkModule(key) {
        data object KotlinxIo : Io("io-kotlinxio")
        data object Okio : Io("io-okio")
    }

    sealed class Json(key: String) : SdkModule(key) {
        data object KotlinxSerialization : Json("json-kotlinx")
    }

    sealed class Network(key: String) : SdkModule(key) {
        data object Ktor : Network("network-ktor")
        data object Retrofit : Network("network-retrofit")
    }

    sealed class Storage(key: String) : SdkModule(key) {
        data object Settings : Storage("storage-settings")
        data object DataStore : Storage("storage-datastore")
        data object Mmkv : Storage("storage-mmkv")
    }

    sealed class Firebase(key: String) : SdkModule(key) {
        data object Native : Firebase("firebase-native")
        data object Rest : Firebase("firebase-rest")
    }
}
```

Consumer sees:
```kotlin
Sdk.init(
    modules = setOf(SdkModule.Network.Ktor, SdkModule.Storage.Mmkv),
    config = SdkConfig(...)
)
```

Consumer never sees: `KtorClientAdapter`, `MmkvStorage`, `KotlinxIoFileSystemProvider`.

---

## Framework Comparison

### 1. Koin

**Type:** Runtime service locator / lightweight DI  
**KMP support:** Full (commonMain, all targets)  
**Annotation processing:** None  

#### How it works

Each impl module exports a `val xxxModule = module { ... }` that binds interfaces:

```kotlin
// core-network-ktor (impl module)
val ktorNetworkModule = module {
    single<ClientAdapter> { KtorClientAdapter(engine = createDefaultEngine()) }
    single<NetworkExecutor> {
        NetworkExecutorImpl(
            clientAdapter = get(),
            jsonConverter = get(),  // resolved from another module
            idGenerator = get(),    // resolved from foundation module
        )
    }
}
```

A registry maps sealed class → Koin module:

```kotlin
object SdkModuleRegistry {
    private val registry: Map<String, () -> Module> = mapOf(
        SdkModule.Network.Ktor.key to { ktorNetworkModule },
        SdkModule.Network.Retrofit.key to { retrofitNetworkModule },
        SdkModule.Storage.Mmkv.key to { mmkvStorageModule },
        // ...
    )

    fun resolve(module: SdkModule): Module =
        registry[module.key]?.invoke()
            ?: error("No Koin module for ${module.key}")
}
```

Init point:

```kotlin
object SharedSdk {
    fun init(modules: Set<SdkModule>, config: SdkConfig): KoinApplication {
        validateNoDuplicateCategories(modules)
        val resolved = modules.map { SdkModuleRegistry.resolve(it) }
        return startKoin {
            modules(listOf(foundationModule(config)) + resolved)
        }
    }
}
```

#### Singleton guarantee

`single<T> { ... }` = one instance per KoinApplication. Since there is one `startKoin`, there is one instance of `NetworkExecutor`, `KeyValueStorage`, etc.

#### Verification

```kotlin
@Test
fun `koin graph completeness`() {
    koinApplication {
        modules(foundationModule(testConfig), ktorNetworkModule, kotlinxJsonModule)
    }.checkModules()
}
```

#### Pros

- **No code generation** — no kapt/ksp, no annotation processing overhead
- **Full KMP** — works on iOS, macOS, JVM, JS, WASM
- **Runtime flexibility** — module composition is a `List<Module>`, trivially dynamic
- **Simple testing** — `koinApplication { }.checkModules()` verifies the graph
- **Hot-reload friendly** — modules can be loaded/unloaded at runtime
- **Tiny API surface** — `single`, `factory`, `get()`, `module {}` — that's most of it
- **No reflection on native** — Koin uses lambda factories, not reflection

#### Cons

- **Runtime failure** — missing bindings crash at runtime, not compile time
- **No compile-time graph validation** — `checkModules()` catches most issues, but it runs in test, not in the compiler
- **Scaling** — very large graphs (500+ bindings) can become hard to debug when something is missing
- **Type erasure on JVM** — `single<List<String>>` and `single<List<Int>>` collide without `named()` qualifiers
- **No inject into constructors** — everything goes through `get()` or `inject()`, no constructor injection pattern
- **Performance** — service location has marginal overhead vs compile-time generated code (negligible for most apps, measurable for startup-critical apps with 1000+ bindings)

---

### 2. Dagger 2

**Type:** Compile-time DI with code generation  
**KMP support:** None (requires JVM annotation processing — kapt/ksp)  
**Annotation processing:** kapt or ksp (dagger-compiler)  

#### How it works

A single `@Singleton @Component` owns all shared instances. Feature modules are Dagger `@Module` classes. Selection uses `@IntoMap` + `Provider<>`:

```kotlin
@Module
class KtorNetworkDaggerModule {
    @Provides @Singleton
    fun provideClientAdapter(): ClientAdapter = KtorClientAdapter(...)

    @Provides @Singleton
    fun provideNetworkExecutor(
        client: ClientAdapter,
        json: JsonConverter,
        idGen: IdGenerator,
    ): NetworkExecutor = NetworkExecutorImpl(client, json, idGen)

    @Provides @IntoMap @SdkModuleKey(SdkModule.Network.Ktor)
    fun provideInitializer(executor: Provider<NetworkExecutor>): ModuleInitializer =
        NetworkModuleInitializer(executor)
}
```

The Component declares ALL modules (compile-time):

```kotlin
@Singleton
@Component(modules = [
    CoreModule::class,
    KtorNetworkDaggerModule::class,
    RetrofitNetworkDaggerModule::class,
    MmkvStorageDaggerModule::class,
    SettingsStorageDaggerModule::class,
    // all impls listed here — they are ALL compiled in
])
interface SdkComponent {
    fun initializers(): Map<SdkModule, @JvmSuppressWildcards Provider<ModuleInitializer>>

    @Component.Builder
    interface Builder {
        @BindsInstance fun config(config: SdkConfig): Builder
        @BindsInstance fun context(context: Context): Builder
        fun build(): SdkComponent
    }
}
```

Init point selects which initializers to activate:

```kotlin
object MySdk {
    fun init(context: Context, config: SdkConfig, modules: Set<SdkModule>) {
        val comp = DaggerSdkComponent.builder()
            .context(context).config(config).build()

        val initializers = comp.initializers()
        for (module in modules) {
            initializers[module]?.get()?.initialize()  // .get() creates lazily
        }
    }
}
```

#### Singleton guarantee

`@Singleton` is per-component. One `SdkComponent` = one instance of each `@Singleton`-scoped binding. `Provider<>` ensures non-requested modules are never instantiated.

#### Important constraint

**All `@Module` classes must be declared in `@Component` at compile time.** Dagger cannot dynamically compose modules. The "selectivity" happens at initialization time (which `Provider.get()` calls are made), not at graph composition time.

This means: **all impl code is compiled into the binary even if the consumer only uses one impl.** The binary includes Ktor AND Retrofit, MMKV AND DataStore — unused code is dead but present. ProGuard/R8 can strip some of it, but not all.

#### Pros

- **Compile-time verification** — if a binding is missing, the build fails. Zero runtime surprises
- **Generated code** — no reflection, no runtime overhead. The generated `DaggerSdkComponent` is plain Java method calls
- **Excellent IDE support** — navigate from `@Inject` to `@Provides`, find usages of bindings
- **Mature ecosystem** — 10+ years of production use, extensive documentation
- **Scoping is explicit** — `@Singleton`, `@ActivityScoped`, custom scopes — clear lifetime boundaries
- **ProGuard/R8 friendly** — generated code works with minification out of the box

#### Cons

- **No KMP support** — Dagger requires JVM annotation processing (kapt or ksp). No iOS, no macOS, no WASM
- **All modules compiled in** — cannot exclude unused impl code from the binary (unlike Koin where you simply don't add the Gradle dependency)
- **kapt build overhead** — annotation processing adds significant build time (30-60s per module in large projects). ksp is faster but Dagger ksp support is still evolving
- **Steep learning curve** — Components, Subcomponents, Scopes, Qualifiers, Multibindings, Assisted Inject, @BindsInstance, @BindsOptionalOf — large conceptual surface
- **Verbose** — the ratio of boilerplate to business logic is high (Module class + Provides + MapKey + Initializer per feature)
- **No runtime flexibility** — graph is fixed at compile time. Dynamic module composition requires architectural workarounds
- **`@JvmSuppressWildcards`** — Kotlin-Java interop quirks (e.g. `Map<K, Provider<V>>` requires this annotation or Dagger won't compile)

---

### 3. Hilt

**Type:** Opinionated layer on top of Dagger 2 with Android lifecycle integration  
**KMP support:** None (Android-only, depends on Android framework classes)  
**Annotation processing:** kapt or ksp (hilt-compiler)  

#### How it works

Hilt provides predefined scopes tied to Android lifecycle (`@Singleton`, `@ActivityScoped`, `@ViewModelScoped`, `@FragmentScoped`). The entry point is `@HiltAndroidApp` on the Application class.

For SDK use, Hilt provides `@EntryPoint`:

```kotlin
@HiltAndroidApp
class MyApp : Application()

@Module
@InstallIn(SingletonComponent::class)
class NetworkModule {
    @Provides @Singleton
    fun provideNetworkExecutor(...): NetworkExecutor = ...
}

// SDK consumer accesses via EntryPoint
@EntryPoint
@InstallIn(SingletonComponent::class)
interface SdkEntryPoint {
    fun networkExecutor(): NetworkExecutor
}

// Usage
val entryPoint = EntryPointAccessors.fromApplication(context, SdkEntryPoint::class.java)
val executor = entryPoint.networkExecutor()
```

#### Selective init with Hilt

Hilt's `@InstallIn` automatically installs modules into components. There's **no built-in mechanism for selective module loading** — all `@InstallIn(SingletonComponent::class)` modules are always loaded.

To achieve selectivity, you'd need to fall back to raw Dagger patterns (custom component, `@IntoMap`, `Provider<>`) — at which point you're not really using Hilt's value-add.

#### Pros

- **Less boilerplate than Dagger** — no manual Component/Builder, `@InstallIn` auto-wires
- **Android lifecycle aware** — ViewModelScope, ActivityScope, FragmentScope out of the box
- **Standard for Android** — Google's recommended DI for Android apps
- **Testing support** — `@UninstallModules`, `@BindValue` for test overrides
- **Gradle plugin** — transforms bytecode to wire components automatically

#### Cons

- **Android-only** — depends on `android.app.Application`, `Activity`, `Fragment`. Not even plain JVM
- **No KMP support** — fundamentally tied to Android framework
- **No selective loading** — `@InstallIn` is all-or-nothing. Cannot skip modules at runtime
- **Opinionated scopes** — the predefined scope hierarchy doesn't map well to SDK module boundaries
- **Not designed for SDKs** — Hilt assumes you control the Application class. SDKs consumed by other apps face `@HiltAndroidApp` conflicts
- **Build overhead** — Hilt's bytecode transform + Dagger's annotation processing = significant build cost
- **Version coupling** — Hilt versions are tightly coupled to specific Dagger and AGP versions

**Verdict for SDK use case: Not recommended.** Hilt is designed for apps, not SDKs. The `@HiltAndroidApp` conflict alone disqualifies it when multiple SDKs need to coexist in one app.

---

### 4. kotlin-inject

**Type:** Compile-time DI with KSP code generation, Kotlin-native  
**KMP support:** Full (KSP runs on all targets)  
**Annotation processing:** KSP only  

#### How it works

kotlin-inject is the spiritual successor to Dagger for Kotlin. It uses KSP (not kapt), so it works on all KMP targets. Components are abstract classes:

```kotlin
@Singleton
@Component
abstract class SdkComponent(
    @get:Provides val config: SdkConfig,
) {
    abstract val networkExecutor: NetworkExecutor

    // Bindings
    val KtorClientAdapter.bind: ClientAdapter
        @Provides get() = this

    @Provides @Singleton
    fun provideNetworkExecutor(
        client: ClientAdapter,
        json: JsonConverter,
    ): NetworkExecutor = NetworkExecutorImpl(client, json)
}

// Generated: SdkComponent.create(config = myConfig)
```

#### Selective init with kotlin-inject

kotlin-inject supports `@Component` inheritance and multi-module composition. Selective loading can use a similar pattern to Dagger (map of providers), but with Kotlin-native syntax:

```kotlin
@Component
abstract class CoreComponent(@get:Provides val config: SdkConfig) {
    abstract val logger: EventLogger
    abstract val idGenerator: IdGenerator
}

// Each impl declares its own component extending core
@Component
abstract class KtorNetworkComponent(
    @Component val core: CoreComponent,
) {
    abstract val networkExecutor: NetworkExecutor

    @Provides @Singleton
    fun provideExecutor(client: KtorClientAdapter, ...): NetworkExecutor = ...
}
```

#### Pros

- **Compile-time verification** — like Dagger, missing bindings fail the build
- **KMP support** — KSP works on all Kotlin targets (JVM, iOS, macOS, JS, WASM)
- **Kotlin-native** — no Java annotation legacy, idiomatic Kotlin syntax
- **KSP is faster than kapt** — significant build speed improvement over Dagger/Hilt
- **No reflection** — generated code is plain Kotlin
- **Simpler than Dagger** — fewer concepts (no Subcomponents, no @BindsInstance workaround needed)
- **Component composition** — components can depend on other components naturally

#### Cons

- **Smaller ecosystem** — less documentation, fewer Stack Overflow answers, smaller community
- **Less mature** — v0.7.x as of 2025 (pre-1.0). API may change
- **No built-in Android lifecycle scopes** — no equivalent to Hilt's @ViewModelScoped, @ActivityScoped
- **No multibindings** — no `@IntoMap` / `@IntoSet` equivalent (workaround: manual collection in component)
- **KSP plugin required** — each module needs the KSP plugin configured in build.gradle.kts
- **Limited tooling** — IDE support is not as mature as Dagger's (no "find provider" navigation)

---

## Side-by-Side Comparison

| Criterion | Koin | Dagger 2 | Hilt | kotlin-inject |
|-----------|------|----------|------|---------------|
| **Graph validation** | Runtime (`checkModules()`) | Compile-time | Compile-time | Compile-time |
| **KMP support** | ✅ Full | ❌ JVM only | ❌ Android only | ✅ Full (KSP) |
| **Selective module loading** | ✅ Native (list of modules) | ⚠️ Via Provider + IntoMap | ❌ Not designed for it | ⚠️ Via component composition |
| **Binary size impact** | ✅ Only included impls | ❌ All impls compiled in | ❌ All impls compiled in | ✅ Only included impls |
| **Build speed** | ✅ No annotation processing | ❌ kapt is slow | ❌ kapt + bytecode transform | ⚠️ KSP (faster than kapt) |
| **Runtime overhead** | ⚠️ Service location (~μs) | ✅ Zero (generated code) | ✅ Zero (generated code) | ✅ Zero (generated code) |
| **Learning curve** | ✅ Low (~5 concepts) | ❌ High (~15 concepts) | ⚠️ Medium (~10 concepts) | ⚠️ Medium (~8 concepts) |
| **Ecosystem maturity** | ✅ Mature, large community | ✅ Mature, largest community | ✅ Google-backed | ⚠️ Pre-1.0, small community |
| **SDK friendliness** | ✅ No app-level requirements | ✅ Component is self-contained | ❌ Requires @HiltAndroidApp | ✅ Component is self-contained |
| **Testing** | ✅ checkModules + override | ✅ @Component.Builder mocks | ✅ @UninstallModules | ✅ Constructor params |
| **Android lifecycle** | ⚠️ Manual (koin-android) | ⚠️ Manual (custom scopes) | ✅ Built-in | ⚠️ Manual |
| **Constructor injection** | ❌ Uses get()/inject() | ✅ @Inject constructor | ✅ @Inject constructor | ✅ @Inject constructor |

### Key: What "binary size impact" means

With Koin or kotlin-inject, if the consumer doesn't add `core-network-retrofit` to their `build.gradle.kts`, Retrofit code is **not in the APK at all**. The Gradle dependency isn't there, so the classes don't exist.

With Dagger 2, all `@Module` classes must be listed in the `@Component` at compile time. Even if the consumer only uses Ktor, the Retrofit module is compiled into the component. R8/ProGuard can remove some dead code, but the Dagger-generated factory classes for unused modules will remain.

---

## Recommendation Matrix

| Scenario | Recommended | Why |
|----------|-------------|-----|
| **KMP SDK** (multi-platform, iOS+Android+Desktop) | **Koin** or **kotlin-inject** | Dagger/Hilt don't run on iOS/macOS. Koin for simplicity, kotlin-inject for compile-time safety |
| **Android-only SDK** (library consumed by Android apps) | **Dagger 2** | Compile-time safety, no runtime surprises, established pattern for Android SDKs |
| **Android app** (you own the Application class) | **Hilt** | Google-recommended, lifecycle-aware, less boilerplate than raw Dagger |
| **Android-only SDK, team prefers simplicity** | **Koin** | Lower learning curve, faster builds, but trade compile-time safety for runtime checks |
| **Large team, strict correctness requirements** | **Dagger 2** or **kotlin-inject** | Compile-time graph validation prevents entire classes of runtime errors |

---

## Impact on Existing Impl Modules

### What changes in impl modules (shared-kmp-libs)

**Nothing in the implementations themselves.** The classes `KtorClientAdapter`, `MmkvStorage`, `KotlinxIoFileSystemProvider` stay exactly as they are.

What each impl module needs to **add** (if not already present):

1. A Koin `module { }` definition that binds its implementations to API interfaces
2. That module registered in `SdkModuleRegistry`

Current state in shared-kmp-libs:

| Impl module | Has Koin module? | Has Factory? | Action needed |
|-------------|-----------------|--------------|---------------|
| core-io-kotlinxio | ✅ `kotlinxIoModule` | ❌ | Register in SdkModuleRegistry |
| core-io-okio | ❌ | ✅ `OkioFactory` | Create `okioModule`, register |
| core-json-kotlinx | ❌ | ❌ | Create `kotlinxJsonModule`, register |
| core-network-ktor | ❌ | ✅ `KtorNetworkFactory` | Create `ktorNetworkModule`, register |
| core-network-retrofit | ❌ | ❌ | Create `retrofitNetworkModule`, register |
| core-storage-settings | ❌ | ❌ | Create `settingsStorageModule`, register |
| core-storage-datastore | ❌ | ✅ `DataStoreFactory` | Create `dataStoreModule`, register |
| core-storage-mmkv | ❌ | ❌ | Create `mmkvStorageModule`, register |
| core-firebase-native | ❌ | ❌ | Create `nativeFirebaseModule`, register |
| core-firebase-rest | ❌ | ❌ | Create `restFirebaseModule`, register |

### What changes in consumer apps

**Only the init call.** Instead of manually composing Koin modules:

```kotlin
// BEFORE (current DawSync pattern)
// desktopApp/di/DataModule.desktop.kt
val dataModule = module {
    single<FileSystemProvider> { OkioFactory.createFileSystemProvider() }
    single<PathProvider> { OkioFactory.createPathProvider() }
    single<KeyValueStorage> { InMemoryKeyValueStorage() }
    // ... 100+ more bindings
}

startKoin {
    modules(dataModule, domainModule, viewModelModule, ...)
}
```

```kotlin
// AFTER (with SharedSdk.init)
val koin = SharedSdk.init(
    modules = setOf(
        SdkModule.Io.Okio,
        SdkModule.Json.KotlinxSerialization,
        SdkModule.Network.Ktor,
        SdkModule.Storage.Settings,
    ),
    config = SdkConfig(debug = true),
    appModules = listOf(
        dataModule,       // app-specific bindings (repositories, data sources)
        domainModule,     // app-specific use cases
        viewModelModule,  // app-specific ViewModels
    ),
)
```

The app's `dataModule` no longer needs `single<FileSystemProvider>` or `single<NetworkExecutor>` — those come from the SDK modules. The app only provides its own bindings (repositories, use cases, ViewModels).

### The Gradle dependency doesn't change

```kotlin
// DawSync build.gradle.kts — stays the same
implementation("com.grinx.shared:core-io-okio")
implementation("com.grinx.shared:core-network-ktor")
// consumer still picks which impl artifacts to pull in
```

The `api()` convention on impl modules (`core-io-okio` → `api(core-io-api)`) ensures the consumer transitively gets the API interfaces. This doesn't change.

---

## Appendix: Category Validation

The init function validates that consumers don't request conflicting impls:

```kotlin
private fun validateNoDuplicateCategories(modules: Set<SdkModule>) {
    // Group by sealed parent class (Io, Network, Storage, etc.)
    val byCategory = modules.groupBy { module ->
        when (module) {
            is SdkModule.Io -> "Io"
            is SdkModule.Json -> "Json"
            is SdkModule.Network -> "Network"
            is SdkModule.Storage -> "Storage"
            is SdkModule.Firebase -> "Firebase"
        }
    }
    val duplicates = byCategory.filter { it.value.size > 1 }
    require(duplicates.isEmpty()) {
        val conflicts = duplicates.entries.joinToString { (cat, impls) ->
            "$cat: [${impls.joinToString { it.key }}]"
        }
        "Multiple implementations for same category — pick one per category. Conflicts: $conflicts"
    }
}
```

> **Exception:** Storage could legitimately have multiple impls (KeyValueStorage via Settings + SecureStorage via Encryption). The validation can be relaxed per-category if the API interfaces are different.
