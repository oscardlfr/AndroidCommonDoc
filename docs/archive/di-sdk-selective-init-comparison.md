---
scope: [architecture, dependency-injection, sdk-design, research]
sources: [dagger2, koin, hilt, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 3
last_updated: "2026-03"
description: "DI framework comparison for SDK selective init — Dagger 2 vs Koin vs Hilt vs kotlin-inject. Sealed class pattern for impl-agnostic module selection. Updated with auto-discovery solution (Class.forName + @EagerInitialization) and Dagger 2 discovery trade-offs."
slug: di-sdk-selective-init-comparison
status: archived
layer: L0
category: archive
---

# DI SDK Selective Init — Framework Comparison

Research doc: comparison of DI frameworks for an SDK where consumers select which modules to initialize without knowing implementation classes.

**Status:** Koin implementation shipped and validated in shared-kmp-libs (M003). Auto-discovery via Class.forName (JVM) + @EagerInitialization (Native) added post-M003. See [Implementation Results](#implementation-results-koin-in-shared-kmp-libs) for real-world findings and [Auto-Discovery](#auto-discovery-class-loading-problem-and-solution) for the platform-specific solution.

## The Problem

An SDK with N feature modules (network, storage, io, json, firebase...) where:

1. Each feature has multiple implementations (Ktor vs Retrofit, MMKV vs DataStore vs Settings)
2. Consumers pick which implementations to use at init time
3. **Consumers never import implementation classes** — only a sealed class enum
4. Shared singletons (logger, config, id generator) must not duplicate
5. Modules not requested must not be instantiated
6. **Registration must happen automatically** — the consumer adding a Gradle dependency is sufficient; no manual `register()` calls or impl class imports

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
    // ... Firebase, OAuth, System
}
```

Consumer sees:
```kotlin
SharedSdk.init(
    modules = setOf(SdkModule.Network.Ktor, SdkModule.Storage.Mmkv),
    config = SdkConfig(debug = true),
)
```

Consumer never sees: `KtorClientAdapter`, `MmkvStorage`, `KotlinxIoFileSystemProvider`.

---

## Implementation Results: Koin in shared-kmp-libs

**Shipped in M003** — 14 impl modules, 58 total modules, 100% test coverage on core-sdk, 96.1% project-wide.

### Final API

```kotlin
SharedSdk.init(
    modules = setOf(
        SdkModule.Io.KotlinxIo,
        SdkModule.Json.KotlinxSerialization,
        SdkModule.Network.Ktor,
    ),
    config = SdkConfig(debug = true),
    appModules = listOf(myDataModule),
)
```

The consumer imports only `com.grinx.shared.core.sdk.*`. No impl class imports.

### Auto-Registration Pattern

Each impl module has an `object : SdkModuleRegistration` with an `init` block that registers in `SdkModuleRegistry`:

```kotlin
// In core-io-kotlinxio (impl module)
object KotlinxIoRegistration : SdkModuleRegistration {
    override val module = SdkModule.Io.KotlinxIo
    override val koinModule = module {
        single<FileSystemProvider> { KotlinxIoFileSystemProvider() }
        single<StreamingFileSystem> { KotlinxIoStreamingFileSystem() }
    }
    init { SdkModuleRegistry.register(module) { koinModule } }
}
```

Consumer doesn't call `register()` or reference `KotlinxIoRegistration`. The sealed class + Gradle dependency is enough.

### Auto-Discovery: Class-Loading Problem and Solution

**The Problem:** Kotlin `object` init blocks only execute when the JVM classloader touches the class. If nobody references `OkioRegistration`, the `init {}` never fires and `SdkModuleRegistry` is empty when `SharedSdk.init()` runs. On Kotlin/Native, object initialization is also lazy since K/N 1.7.20. This means auto-registration via `object init {}` alone is a dead pattern in KMP.

**The Solution:** Each platform has its own standard mechanism for this. `SharedSdk.init()` calls `expect fun discoverRegistrations(modules)` which delegates to the platform:

| Platform | Mechanism | How it works |
|----------|-----------|-------------|
| **JVM** (Android + Desktop) | `Class.forName(className)` | Triggers `<clinit>` (static initializer) → executes the object's `init {}` block → calls `SdkModuleRegistry.register()`. Only requested modules are loaded. |
| **Native** (iOS + macOS) | `@EagerInitialization` | Top-level `val` in `nativeMain/` forces object initialization **before main()**. `discoverRegistrations()` is a no-op. |

**JVM actual:**
```kotlin
internal actual fun discoverRegistrations(modules: Set<SdkModule>) {
    for (module in modules) {
        if (SdkModuleRegistry.isRegistered(module)) continue
        try {
            Class.forName(module.registrationClassName)
        } catch (_: ClassNotFoundException) {
            throw IllegalArgumentException(
                "Module '${module.key}' requested but its implementation is not on the classpath. " +
                    "Add the corresponding Gradle dependency. " +
                    "Expected class: ${module.registrationClassName}"
            )
        }
    }
}
```

**Native impl module (e.g. core-io-okio/nativeMain):**
```kotlin
@EagerInitialization
private val _okioInit = OkioRegistration
```

**`SdkModule.registrationClassName`** maps each sealed variant to its fully-qualified Registration class name via an exhaustive `when`. Adding a new `SdkModule` variant without updating the mapping is a compile error:

```kotlin
val registrationClassName: String
    get() = when (this) {
        is Io.KotlinxIo -> "com.grinx.shared.core.io.kotlinxio.KotlinxIoRegistration"
        is Io.Okio -> "com.grinx.shared.core.io.okio.OkioRegistration"
        is Network.Ktor -> "com.grinx.shared.core.network.ktor.KtorNetworkRegistration"
        // ... exhaustive
    }
```

This follows the same pattern used by Ktor (engine selection), SQLDelight (driver selection), and SLF4J (backend discovery). The consumer's Gradle dependency determines what's on the classpath; the consumer's Kotlin code never imports impl classes.

### Foundation Singletons Survive Reinit

`EventLogger` and `IdGenerator` are held in a `FoundationSingletons` object outside the Koin lifecycle. `shutdown() → init()` reuses the same logger instance — log destinations, correlation IDs, and cached state are preserved.

### Category Validation

`validateNoDuplicateCategories()` groups by `SdkModule.category` and rejects duplicates. OAuth modules use per-variant categories (`oauth:oauth-browser`, `oauth:oauth-native`) so they can coexist (different protocols).

### Real Issues Encountered

1. **KMP auto-discovery** — `object init` blocks don't fire on JVM unless something touches the class, and K/Native objects are lazy since 1.7.20. Solved with platform-specific discovery: `Class.forName()` on JVM (triggers `<clinit>` → `init {}`), `@EagerInitialization` on Native (forces init before `main()`). See [Auto-Discovery](#auto-discovery-class-loading-problem-and-solution).

2. **`Class.forName` only triggers `<clinit>` once per classloader.** Subsequent calls are no-ops. In tests, `SdkModuleRegistry.clear()` wipes registrations permanently — `Class.forName` won't re-register. Tests must manually re-register after `clear()`.

3. **Custom `jvmMain` intermediate source set** — breaks `desktopTest → commonMain` visibility. The test compiler can't see classes from commonMain when a custom intermediate sits between them. Fix: eliminated `jvmMain`, duplicated files to `androidMain` + `desktopMain`. (Note: core-sdk itself uses `jvmMain` for the JVM discovery actual — this is fine because the source set only contains the actual function, not the test-visible API.)

4. **Platform-specific impl modules** — Firebase Native, OAuth Native, System all have platform-specific constructors (Context, etc.). Their Koin modules are empty registration points — consumer provides bindings via `appModules`.

5. **JVM-only modules with native targets declared** — core-network-retrofit had iOS/macOS targets in its build.gradle.kts but zero native code (OkHttp is JVM-only). Cleaned up: native targets removed, no `@EagerInitialization` needed.

### Metrics

| Metric | Value |
|--------|-------|
| Impl modules with Koin registration | 14/14 |
| Sealed class variants | 14 |
| core-sdk test coverage | 100% |
| Project test coverage | 96.1% |
| Total modules compiling | 58/58 |
| Test tasks passing | 344/344 |
| Pre-existing test failures fixed | 3 |

---

## Framework Comparison

### 1. Koin

**Type:** Runtime service locator / lightweight DI
**KMP support:** Full (commonMain, all targets)
**Annotation processing:** None

#### Pros

- **No code generation** — no kapt/ksp, no annotation processing overhead
- **Full KMP** — works on iOS, macOS, JVM, JS, WASM
- **Runtime flexibility** — module composition is dynamic
- **Simple testing** — `checkModules()` verifies the graph
- **Tiny API surface** — `single`, `factory`, `get()`, `module {}` — that's most of it

#### Cons

- **Runtime failure** — missing bindings crash at runtime, not compile time
- **No compile-time graph validation** — `checkModules()` catches most issues in tests, not the compiler
- **Platform-specific discovery required** — `Class.forName` on JVM, `@EagerInitialization` on Native. Each new impl module needs a one-line nativeMain file and a className entry in SdkModule. Manageable but not zero-ceremony.

### 2. Dagger 2

**Type:** Compile-time DI with code generation
**KMP support:** None (requires JVM annotation processing)
**Annotation processing:** kapt or ksp

#### Pros

- **Compile-time verification** — missing bindings fail the build
- **Generated code** — no reflection, no runtime overhead
- **Mature ecosystem** — 10+ years of production use
- **No discovery problem** — Dagger's `@Component` explicitly lists all `@Module` classes. All impls are compiled in and graph-validated at build time. No class-loading tricks needed.

#### Cons

- **No KMP support** — JVM only
- **All modules compiled in** — the `@Component` must reference all possible `@Module` classes. Cannot exclude unused impl code from the binary. Consumer selection happens at init time via `Provider<ModuleInitializer>` laziness, but the code is still linked.
- **kapt build overhead** — significant build time
- **Steep learning curve** — Components, Subcomponents, Scopes, Qualifiers, Multibindings...
- **Discovery is eager, not lazy** — Adding a new SDK module requires editing the `@Component` annotation to include the new `@Module`. This is compile-time safe but means the SDK orchestrator module (equivalent to core-sdk) depends on ALL impl modules. This is the fat-umbrella trade-off: binary includes everything, consumer pays for unused impls.

### 3. Hilt

**Type:** Opinionated layer on Dagger 2 with Android lifecycle integration
**KMP support:** None (Android-only)

**Verdict for SDK use case: Not recommended.** Hilt is designed for apps, not SDKs. The `@HiltAndroidApp` conflict disqualifies it when multiple SDKs coexist.

### 4. kotlin-inject

**Type:** Compile-time DI with KSP, Kotlin-native
**KMP support:** Full (KSP runs on all targets)

#### Pros

- **Compile-time verification** + **KMP support** — best of both worlds
- **KSP is faster than kapt**
- **Kotlin-native syntax**

#### Cons

- **Pre-1.0** — smaller ecosystem, API may change
- **No multibindings** — no `@IntoMap` equivalent
- **Limited tooling** — IDE support not as mature as Dagger

---

## Side-by-Side Comparison

| Criterion | Koin | Dagger 2 | Hilt | kotlin-inject |
|-----------|------|----------|------|---------------|
| **Graph validation** | Runtime | Compile-time | Compile-time | Compile-time |
| **KMP support** | ✅ Full | ❌ JVM only | ❌ Android only | ✅ Full (KSP) |
| **Module discovery** | Class.forName (JVM) + @EagerInit (Native) | Explicit @Component listing | Explicit @Component listing | Explicit component composition |
| **Discovery ceremony per new module** | 1 className entry + 1 nativeMain line | 1 @Component edit | 1 @Component edit | 1 component edit |
| **Selective module loading** | ✅ Native | ⚠️ Via Provider + IntoMap | ❌ Not designed for it | ⚠️ Via component composition |
| **Binary size impact** | ✅ Only included impls | ❌ All impls compiled in | ❌ All impls compiled in | ✅ Only included impls |
| **Build speed** | ✅ No annotation processing | ❌ kapt is slow | ❌ kapt + bytecode transform | ⚠️ KSP (faster than kapt) |
| **Runtime overhead** | ⚠️ Service location (~μs) | ✅ Zero (generated code) | ✅ Zero (generated code) | ✅ Zero (generated code) |
| **SDK friendliness** | ✅ No app-level requirements | ✅ Component is self-contained | ❌ Requires @HiltAndroidApp | ✅ Component is self-contained |
| **Singleton survival across reinit** | ✅ Via external holder | ✅ Via component lifecycle | N/A | ✅ Via component lifecycle |

## Recommendation Matrix

| Scenario | Recommended | Why |
|----------|-------------|-----|
| **KMP SDK** (multi-platform) | **Koin** | Proven in shared-kmp-libs. Full platform support, simple API |
| **Android-only SDK** (library) | **Dagger 2** | Compile-time safety, no runtime surprises |
| **Android app** (you own Application) | **Hilt** | Google-recommended, lifecycle-aware |
| **Large team, strict correctness** | **kotlin-inject** | Compile-time + KMP, but less mature |
