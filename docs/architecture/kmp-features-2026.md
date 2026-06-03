---
scope: KMP platform capability matrix — 8 platforms × 10 features
sources:
  - docs/architecture/kmp-supported-platforms-reference.md
  - docs/architecture/kotlinx-io-reference.md
  - docs/architecture/kotlinx-coroutines-reference.md
targets: [arch-platform.md, kmp-architecture-sourceset.md]
category: architecture
slug: kmp-features-2026
last_verified: 2026-06-03
---

# KMP Features & Platform Capability Matrix (2026)

> Sources: ingested 2026-04-24 (user-approved) from kmp-supported-platforms-reference.md,
> kotlinx-io-reference.md, kotlinx-coroutines-reference.md.

## Platform Tier Summary

| Platform | KMP Tier | Compose MP Tier |
|----------|----------|-----------------|
| JVM | Stable | Stable |
| Android | Stable | Stable |
| iOS | Stable | Beta |
| macOS | Stable | Beta |
| Linux | Beta | Alpha |
| JS — Browser | Stable | Alpha |
| JS — Node.js | Stable | Alpha |
| Wasm | Beta | Alpha |

> **Linux** is Beta (not Stable) for KMP as of 2026-04-24.
> **Wasm** (`wasmJs`) KMP tier is **Beta** (promoted from Alpha — see kotlinlang.org/docs/wasm-overview.html). Compose Multiplatform on Wasm remains **Alpha** — do not use in production. Note: *incremental compilation* is Stable in Kotlin 2.4 (enabled by default) — separate from platform tier. *WebAssembly Component Model* support is **Experimental** in Kotlin 2.4.0 GA — enables Kotlin/Wasm beyond the browser (FaaS/serverless). Requires opt-in. Source: https://kotlinlang.org/docs/whatsnew24.html

---

## Feature Matrix

| Feature | JVM | Android | iOS | macOS | Linux | JS — Browser | JS — Node.js | Wasm |
|---------|-----|---------|-----|-------|-------|-------------|-------------|------|
| **File IO** (kotlinx-io) | Yes | Yes | Yes | Yes | Yes | No (sandbox) | Yes | Limited |
| **Sockets / Networking** | Yes | Yes | Yes | Yes | Yes | HTTP/WS only | Yes (raw TCP) | HTTP only |
| **Coroutines** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Serialization** (kotlinx.serialization) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Ktor Client** | Yes | Yes | Yes | Yes | Yes | Yes (fetch engine) | Yes | Yes (fetch engine) |
| **Ktor Server** | Yes | Yes | No | No | Yes | No (sandbox) | Yes | No |
| **kotlinx-datetime** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **kotlinx-io** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **UI (Compose MP)** | Stable | Stable | Beta | Beta | Alpha | Alpha | Alpha | Alpha |
| **Background Work** | Yes | Yes (WorkManager) | Yes (limited) | Yes | Yes | No | Yes | No |

### Notes

- **File IO**: JS-Browser has no filesystem access (browser sandbox). kotlinx-io covers all native + JVM targets including macOS (see Myths section).
- **Sockets/Networking**: JS-Browser is restricted to HTTP and WebSocket by the browser sandbox — raw TCP is not available. JS-Node.js supports raw TCP via Ktor CIO engine.
- **Ktor Server**: Cannot run in browser (JS-Browser) or iOS/macOS as a standalone server process.
- **Background Work**: iOS background execution is limited by OS constraints (BGTaskScheduler). Wasm/JS-Browser have no background thread primitives.
- **Compose MP UI tiers** come from kmp-supported-platforms-reference.md, not KMP core tier.

---

## Coroutines Version Notes

- **1.10.x** (Stable) — current production release; use in all production KMP projects
- **1.11.0** (paired with Kotlin 2.2.20) — verify stable status via [kotlinx.coroutines releases](https://github.com/Kotlin/kotlinx.coroutines/releases) before adopting in production

`Dispatchers.IO` is JVM/Android only. Apple/Linux/Native targets use `Dispatchers.Default` for IO work. Always inject dispatchers in commonMain — never hardcode `Dispatchers.*` in ViewModels or UseCases.

---

## Compose Multiplatform Version Notes

- **1.11.0 GA** (KotlinConf'26, 2026-05-20) — production ready
  - Kotlin pairing: **2.2+ baseline** (2.3.10 for native/web targets)
  - Key additions: Hot Reload bundled, iOS Liquid Glass interop, native text input, Compose UI test API v2
  - Test API: `androidx.compose.ui.test` deprecated → `androidx.compose.ui.test.v2` (package change only; `StandardTestDispatcher` default)
  - See [testing-compose-ui-test-v2.md](../testing/testing-compose-ui-test-v2.md) for migration guide

---

## Kotlin 2.4 Language & Runtime Changes

### Context Parameters (Stable, Kotlin 2.4)

- **Status**: Stable in 2.4.0 — replaces `@ExperimentalContextParameters` opt-in
- Exception: *explicit context arguments* (passing named context args at call sites) remain **Experimental** in 2.4 — opt in with the `-Xexplicit-context-arguments` compiler option.
- Replaces extension-receiver overloading (`Receiver.() -> Unit`) where a context parameter is semantically cleaner
- Example: `Logger.() -> Unit` → `context(Logger) () -> Unit` — avoids accidental receiver exposure at call sites
- See `kotlinx-coroutines-reference.md` for coroutine scope injection patterns
- Reference: https://kotlinlang.org/docs/context-parameters.html

### Collection Literals (Experimental, Kotlin 2.4)

- **Status**: Experimental in Kotlin 2.4.0 GA — opt in with `-Xcollection-literals` compiler flag
- Syntax: `val shapes: MutableList<String> = ["triangle", "square"]` — bracket syntax for list/set/array literals
- Custom types: implement `operator fun of(vararg elements: T)` companion to support literal construction
- Not a runtime change — desugars to existing collection factory calls
- Example:
  ```kotlin
  // freeCompilerArgs.add("-Xcollection-literals")
  val primes: List<Int> = [2, 3, 5, 7, 11]
  val lookup: Set<String> = ["alpha", "beta"]
  ```
- Reference: https://kotlinlang.org/docs/whatsnew24.html

### Swift Export (Alpha, Kotlin 2.4)

- **Status**: Alpha — promoted from Experimental in 2.4.0
- Supports: enums (true Swift enums with exhaustive switch), sealed classes, data classes, variadic functions, default parameters, `Flow<T> → AsyncSequence`
- Limitations: extension functions on external types not supported; certain generic bounds unsupported; `suspend` still requires SKIE or KMP-NativeCoroutines wrapper
- Opt-in block: `swiftExport {}` with `@OptIn(ExperimentalSwiftExportDsl::class)`
- **NOT production-ready as of 2026-05-26** — see `viewmodel-state-management-stateflow.md` for current guidance

### Swift Package Manager Import (Experimental, Kotlin 2.4)

- **Status**: Experimental in Kotlin 2.4
- Declare Swift package dependencies via `swiftPMDependencies {}` block in the module's Gradle dependency block
- Imports Obj-C APIs via Clang module discovery — pure-Swift APIs not accessible
- Reference: https://kotlinlang.org/docs/multiplatform/multiplatform-spm-import.html

### Kotlin/Native 2.4 Runtime: CMS GC Default

- **Default GC changed**: PMCS → CMS (Concurrent Mark and Sweep) in 2.4.0
- Performance: 25% faster build / half RAM (cumulative improvement from 2.2→2.4 baseline)
- CMS produces shorter but more frequent GC pauses — benchmark baselines **silently shift** after a 2.4 upgrade
- Rollback: add `kotlin.native.binary.gc=pmcs` in `gradle.properties` (only if regression confirmed)
- Re-record K/N benchmarks after upgrading — see `testing-patterns-benchmarks.md`
- Reference: https://kotlinlang.org/docs/native-memory-manager.html

---

## Myths & Common Misconceptions

- **"macOS file IO is unsupported"** — WRONG as of kotlinx-io 1.x. macOS has full Source/Sink/Buffer support via Native targets.
- **"JS has no networking"** — WRONG for Node.js target. JS-Node.js supports raw TCP via Ktor. JS-Browser target is sandbox-restricted (HTTP/WebSocket only — no raw TCP).
- **"Wasm is fully Beta"** — WRONG. KMP Wasm (`wasmJs`) is Beta as of 2026-05-26 — not production-recommended. Compose Multiplatform on Wasm remains Alpha — do not use in production CMP/Wasm apps. Source: https://kotlinlang.org/docs/wasm-overview.html

---

*Last verified: 2026-06-03 (Kotlin 2.4.0 GA). Refresh every 6 months or after major KMP release.*
