---
scope: [architecture, dependency-injection, sdk-design, research]
sources: [dagger2, koin, hilt, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 4
last_updated: "2026-03"
description: "DI framework comparison for SDK selective init — Dagger 2 (monolithic + per-feature), Koin (KMP, validated), Hilt, kotlin-inject. Updated with real implementation data, KAPT→KSP status, and consumer isolation validation."
slug: di-sdk-selective-init-comparison
status: archived
layer: L0
category: archive
---

# DI SDK Selective Init — Framework Comparison

Comparison of DI frameworks for an SDK where consumers select which modules to initialize without importing implementation classes.

**Status:** Koin implementation shipped and validated (14 impl modules, 15 registrations, 100% core-sdk coverage). All 10 architecture requirements verified against a real consumer app. See [Validation Results](#validation-results).

## The Problem

An SDK with N feature modules where:

1. Each feature has multiple implementations (Ktor vs Retrofit, MMKV vs DataStore)
2. Consumers pick which implementations to use at init time
3. **Consumers never import implementation classes** — only a sealed class enum
4. Shared singletons must not duplicate
5. Modules not requested must not be instantiated
6. Registration must happen automatically — Gradle dependency is sufficient

## Sealed Class — Common to All Solutions

```kotlin
sealed class SdkModule(val key: String) {
    sealed class Io(key: String) : SdkModule(key) {
        data object KotlinxIo : Io("io-kotlinxio")
        data object Okio : Io("io-okio")
    }
    sealed class Network(key: String) : SdkModule(key) {
        data object Ktor : Network("network-ktor")
        data object Retrofit : Network("network-retrofit")
    }
    sealed class Encryption(key: String) : SdkModule(key) {
        data object Default : Encryption("encryption-default")
    }
    // ... Storage, Firebase, OAuth, System
}
```

Consumer: `SharedSdk.init(modules = setOf(SdkModule.Io.KotlinxIo, SdkModule.Encryption.Default))`

## Validation Results

Architecture requirements validated against real production consumer:

| # | Requirement | Result |
|---|-------------|--------|
| 1 | Selective init — consumer picks modules | ✅ |
| 2 | Consumer never imports impl classes (production) | ✅ 0 impl imports |
| 3 | Shared singletons — single lifecycle manager | ✅ |
| 4 | Lazy instantiation — unused modules not created | ✅ Class.forName only on requested |
| 5 | Zero SDK-core → impl dependencies (production) | ✅ |
| 6 | Auto-registration — Gradle dep is enough | ✅ 15 self-registering modules |
| 7 | Binary lean — only selected impls linked | ✅ |
| 8 | Platform-specific discovery | ✅ JVM + Native |
| 9 | Category validation — no duplicate impls | ✅ Enforced at init |
| 10 | New modules without central orchestrator edit | ✅ Exhaustive `when` on sealed class |

## Auto-Discovery: Class-Loading Solution

Each impl module has an `object : SdkModuleRegistration` with `init {}` that registers in `SdkModuleRegistry`. Platform-specific discovery triggers the registration:

| Platform | Mechanism | How |
|----------|-----------|-----|
| **JVM** | `Class.forName(className)` | Triggers `<clinit>` → `init {}` → register |
| **Native** | `@EagerInitialization` | Forces object init before `main()` |

`SdkModule.registrationClassName` maps each sealed variant to its FQ class name via exhaustive `when` — adding a new variant without mapping is a compile error.

## Framework Comparison

### 1. Koin (Recommended for KMP)

**Type:** Runtime service locator | **KMP:** Full | **Codegen:** None

| Aspect | Assessment |
|--------|-----------|
| Graph validation | Runtime (`checkModules()` in tests) |
| Consumer isolation | ✅ Consumer imports only sealed class |
| Module discovery | Class.forName (JVM) + @EagerInit (Native) |
| Ceremony per new module | 1 className entry + 1 nativeMain line |
| Binary size | ✅ Only selected impls |
| Build speed | ✅ No annotation processing |
| Runtime overhead | ~μs service location |

### 2. Dagger 2 — Monolithic Component

**Type:** Compile-time DI | **KMP:** None (JVM only) | **Codegen:** KAPT or KSP (alpha)

| Aspect | Assessment |
|--------|-----------|
| Graph validation | Compile-time ✅ |
| Consumer isolation | ❌ All impls compiled in `@Component` |
| Module discovery | Explicit `@Component` listing — no discovery needed |
| Ceremony per new module | 1 `@Component` edit |
| Binary size | ❌ All impls linked regardless of selection |
| Build speed | ❌ KAPT slow; KSP alpha |
| Runtime overhead | Zero (generated code) |

**KAPT → KSP:** Dagger KSP processors available since 2.48 (alpha). KAPT is in maintenance mode. Migration path exists but KSP support is not yet stable.

### 3. Dagger 2 — Per-Feature Component (Modern)

**Type:** Compile-time DI, per-feature isolation | **KMP:** None | **Codegen:** KAPT/KSP

| Aspect | Assessment |
|--------|-----------|
| Graph validation | Compile-time per-feature (not cross-feature) |
| Consumer isolation | ✅ Each feature is independent module |
| Module discovery | No global discovery — each feature inits independently |
| Ceremony per new module | New Component + Builder |
| Binary size | ✅ Only selected features linked |
| Build speed | ❌ KAPT/KSP per integration module |
| Singleton sharing | Via CoreApis interface (not @Singleton graph) |

**Trade-off vs monolithic:** Gains true modularity and binary leanness, but loses compile-time cross-feature graph validation and `@IntoMap` multibindings.

### 4. Hilt

**Type:** Opinionated Dagger layer | **KMP:** None (Android only)

**Not recommended for SDKs.** `@HiltAndroidApp` conflicts when multiple SDKs coexist. Designed for apps, not libraries.

### 5. kotlin-inject

**Type:** Compile-time DI with KSP | **KMP:** Full | **Codegen:** KSP

| Aspect | Assessment |
|--------|-----------|
| Graph validation | Compile-time ✅ |
| Consumer isolation | ✅ Via component composition |
| KMP support | ✅ Full (KSP runs on all targets) |
| Multibindings | Added in 0.7+ |
| Maturity | Pre-1.0, growing ecosystem |
| Build speed | KSP (faster than KAPT) |

**Best-of-both-worlds candidate** — compile-time safety + KMP. Still maturing.

## Side-by-Side Comparison

| Criterion | Koin | Dagger Monolithic | Dagger Per-Feature | kotlin-inject |
|-----------|------|-------------------|-------------------|---------------|
| **Graph validation** | Runtime | Compile-time | Compile-time (per-feature) | Compile-time |
| **KMP** | ✅ Full | ❌ JVM | ❌ JVM | ✅ Full |
| **Consumer impl isolation** | ✅ 0 imports | ❌ All linked | ✅ Per-feature | ✅ Per-component |
| **Binary lean** | ✅ | ❌ | ✅ | ✅ |
| **Build speed** | ✅ None | ❌ KAPT | ❌ KAPT/KSP | ⚠️ KSP |
| **Discovery** | Class.forName + @EagerInit | Explicit @Component | Per-feature init() | Explicit component |
| **Multibindings** | N/A (registry pattern) | ✅ @IntoMap | ❌ No global map | ✅ (0.7+) |
| **Singleton sharing** | ✅ Koin scope | ✅ @Singleton | ⚠️ CoreApis interface | ✅ Component scope |
| **SDK-friendliness** | ✅ No app deps | ✅ Self-contained | ✅ Self-contained | ✅ Self-contained |
| **Init model** | Umbrella (selective) | Umbrella (all linked) | Per-feature | Per-component |

## Recommendation Matrix

| Scenario | Recommended | Why |
|----------|-------------|-----|
| **KMP SDK** (multi-platform) | **Koin** | Proven, full platform support, 0 codegen |
| **Android SDK, modular publishing** | **Dagger Per-Feature** | True isolation, compile-time safety |
| **Android SDK, small, internal** | **Dagger Monolithic** | Simple, full graph validation |
| **KMP SDK, strict compile-time safety** | **kotlin-inject** | KMP + compile-time, but less mature |
| **Android app** (not SDK) | **Hilt** | Google-recommended for apps |

## Anti-Pattern: Consumer Imports Impl Classes

```kotlin
// ❌ WRONG — consumer is coupled to implementation
import com.example.sdk.io.kotlinxio.KotlinxIoFileSystemProvider
import com.example.sdk.encryption.JvmPasswordEncryptionService

val fs = KotlinxIoFileSystemProvider()  // direct instantiation
val enc = JvmPasswordEncryptionService()

// ✅ RIGHT — consumer uses interfaces via DI
// Impls provided by SDK module system (Koin, Dagger, etc.)
val fs: FileSystemProvider = get()  // from Koin
val enc: PasswordEncryptionService = get()  // from Koin
```

This applies regardless of DI framework. The consumer should only depend on API modules (interfaces), never implementation modules.
