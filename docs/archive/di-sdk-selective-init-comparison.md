---
scope: [architecture, dependency-injection, sdk-design, research]
sources: [dagger2, koin, hilt, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 2
last_updated: "2026-03"
description: "DI framework comparison for SDK selective init — Dagger 2 vs Koin vs Hilt vs kotlin-inject. Sealed class pattern for impl-agnostic module selection. Updated with real Koin implementation results from shared-kmp-libs."
slug: di-sdk-selective-init-comparison
status: archived
layer: L0
category: archive
---

# DI SDK Selective Init — Framework Comparison

Research doc: comparison of DI frameworks for an SDK where consumers select which modules to initialize without knowing implementation classes.

**Status:** Koin implementation shipped and validated in shared-kmp-libs (M003). See [Implementation Results](#implementation-results-koin-in-shared-kmp-libs) for real-world findings.

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

Each impl module has an `object : SdkModuleRegistration` with an `init` block that registers in `SdkModuleRegistry`. Class-loading triggers registration when the consumer's Gradle dependency includes the impl module:

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

### Foundation Singletons Survive Reinit

`EventLogger` and `IdGenerator` are held in a `FoundationSingletons` object outside the Koin lifecycle. `shutdown() → init()` reuses the same logger instance — log destinations, correlation IDs, and cached state are preserved.

### Category Validation

`validateNoDuplicateCategories()` groups by `SdkModule.category` and rejects duplicates. OAuth modules use per-variant categories (`oauth:oauth-browser`, `oauth:oauth-native`) so they can coexist (different protocols).

### Real Issues Encountered

1. **KMP auto-registration** — `object init` blocks don't reliably fire on K/Native without explicit class-load. Solved by having the `val xxxModule` alias reference the registration object.

2. **Custom `jvmMain` intermediate source set** — breaks `desktopTest → commonMain` visibility. The test compiler can't see classes from commonMain when a custom intermediate sits between them. Fix: eliminated `jvmMain`, duplicated files to `androidMain` + `desktopMain`.

3. **Platform-specific impl modules** — Firebase Native, OAuth Native, System all have platform-specific constructors (Context, etc.). Their Koin modules are empty registration points — consumer provides bindings via `appModules`.

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
- **Object init registration** — requires care to ensure class-loading triggers registration on all platforms

### 2. Dagger 2

**Type:** Compile-time DI with code generation
**KMP support:** None (requires JVM annotation processing)
**Annotation processing:** kapt or ksp

#### Pros

- **Compile-time verification** — missing bindings fail the build
- **Generated code** — no reflection, no runtime overhead
- **Mature ecosystem** — 10+ years of production use

#### Cons

- **No KMP support** — JVM only
- **All modules compiled in** — cannot exclude unused impl code from the binary
- **kapt build overhead** — significant build time
- **Steep learning curve** — Components, Subcomponents, Scopes, Qualifiers, Multibindings...

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
