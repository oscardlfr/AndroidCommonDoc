---
scope: [architecture, dependency-injection, sdk-design, research]
sources: [dagger2, koin, hilt, kotlin-inject, android-sdk, kmp]
targets: [android, jvm, ios, macos]
version: 6
last_updated: "2026-03"
description: "Framework comparison for modular SDK DI — Dagger 2 (3 approaches), Koin, Hilt, kotlin-inject. Requirements checklist, trade-off tables, decision matrix. Neutral."
slug: di-sdk-selective-init-comparison
status: archived
layer: L0
category: archive
---

# DI Framework Comparison for Modular SDKs

Side-by-side comparison of DI approaches for SDKs where consumers select which features to activate. Presents trade-offs — the right choice depends on your project constraints.

For Dagger 2 implementation details, see [dagger2-sdk-selective-init.md](dagger2-sdk-selective-init.md).
For DI concepts (isolation levels, DI vs Service Locator, cross-feature deps), see [di-sdk-consumer-isolation.md](di-sdk-consumer-isolation.md).

---

## Requirements Checklist

Use this to evaluate any approach. Not all requirements have equal weight — prioritize based on your constraints.

| # | Requirement | Question |
|---|-------------|----------|
| 1 | Selective init | Can the consumer activate only chosen features? |
| 2 | Consumer isolation | Does consumer code avoid importing impl classes? |
| 3 | Shared singletons | Are shared services (logger, config) single-instance? |
| 4 | Lazy instantiation | Are unselected features never instantiated? |
| 5 | SDK-core independence | Does the orchestrator avoid production deps on impl modules? |
| 6 | Auto-registration | Is adding a Gradle dependency sufficient? |
| 7 | Binary lean | Does the consumer binary exclude unselected features? |
| 8 | Cross-feature deps | Can Feature A inject a service from Feature B? |
| 9 | Compile-time safety | Are missing bindings caught at build time? |
| 10 | KMP support | Does it work on iOS, macOS, Desktop? |

---

## Requirements by Framework

### Dagger 2 — Monolithic (Approach A)

| # | Req | Status | Notes |
|---|-----|--------|-------|
| 1 | Selective init | ✅ | `Provider<>` laziness |
| 2 | Consumer isolation | ✅ | Consumer sees facade only |
| 3 | Shared singletons | ✅ | Single `@Singleton` scope |
| 4 | Lazy instantiation | ✅ | Via `Provider<>` |
| 5 | SDK-core independence | ❌ | `@Component` lists all modules |
| 6 | Auto-registration | ✅ | `@IntoMap` |
| 7 | Binary lean | ❌ | All feature code compiled in |
| 8 | Cross-feature deps | ✅ | Same graph resolves all |
| 9 | Compile-time safety | ✅ | Full graph validated |
| 10 | KMP | ❌ | JVM only |

### Dagger 2 — Per-Feature (Approach B)

| # | Req | Status | Notes |
|---|-----|--------|-------|
| 1 | Selective init | ✅ | Per-feature `init()` |
| 2 | Consumer isolation | ✅ | Consumer imports facade |
| 3 | Shared singletons | ⚠️ | Via CoreApis interface — grows with shared services |
| 4 | Lazy instantiation | ✅ | Uninited features don't exist |
| 5 | SDK-core independence | ✅ | Core has interfaces only |
| 6 | Auto-registration | ❌ | Manual `when` block or explicit init |
| 7 | Binary lean | ✅ | Only Gradle deps linked |
| 8 | Cross-feature deps | ❌ | CoreApis only — no cross-feature DI |
| 9 | Compile-time safety | ⚠️ | Per-feature graph only |
| 10 | KMP | ❌ | JVM only |

### Dagger 2 — ServiceLoader Discovery (Approach C)

| # | Req | Status | Notes |
|---|-----|--------|-------|
| 1 | Selective init | ✅ | `MySdk.init(setOf(...))` |
| 2 | Consumer isolation | ✅ | `MySdk.get<T>()` |
| 3 | Shared singletons | ⚠️ | CoreApis — same limitation as B |
| 4 | Lazy instantiation | ✅ | Undiscovered features not loaded |
| 5 | SDK-core independence | ✅ | Zero impl deps |
| 6 | Auto-registration | ✅ | META-INF/services |
| 7 | Binary lean | ✅ | Only Gradle deps linked |
| 8 | Cross-feature deps | ❌ | CoreApis only |
| 9 | Compile-time safety | ⚠️ | Per-feature + runtime discovery |
| 10 | KMP | ❌ | ServiceLoader is JVM only |

### Koin

| # | Req | Status | Notes |
|---|-----|--------|-------|
| 1 | Selective init | ✅ | `SharedSdk.init(setOf(...))` |
| 2 | Consumer isolation | ✅ | Level 3 — sealed class only |
| 3 | Shared singletons | ✅ | Single `koinApplication` scope |
| 4 | Lazy instantiation | ✅ | Class.forName on requested only |
| 5 | SDK-core independence | ✅ | Zero impl deps |
| 6 | Auto-registration | ✅ | `init {}` + Class.forName / @EagerInit |
| 7 | Binary lean | ✅ | Only Gradle deps on classpath |
| 8 | Cross-feature deps | ✅ | Same koinApplication graph |
| 9 | Compile-time safety | ❌ | Runtime resolution |
| 10 | KMP | ✅ | Full (JVM + Native + JS) |

### kotlin-inject

| # | Req | Status | Notes |
|---|-----|--------|-------|
| 1 | Selective init | ✅ | Component composition |
| 2 | Consumer isolation | ✅ | API/impl split |
| 3 | Shared singletons | ✅ | Component scope |
| 4 | Lazy instantiation | ✅ | Uncomposed = not created |
| 5 | SDK-core independence | ✅ | Interfaces only |
| 6 | Auto-registration | ❌ | Manual component composition |
| 7 | Binary lean | ✅ | Only included components |
| 8 | Cross-feature deps | ⚠️ | Via parent component |
| 9 | Compile-time safety | ✅ | Full |
| 10 | KMP | ✅ | KSP on all targets |

### Hilt

**Not suitable for SDKs.** `@HiltAndroidApp` conflicts when multiple SDKs coexist. Designed for apps that own the `Application` class. Use for Android apps, not libraries.

---

## Side-by-Side

| Criterion | Koin | Dagger A | Dagger B | Dagger C | kotlin-inject |
|-----------|------|----------|----------|----------|---------------|
| **DI paradigm** | Service Locator | Pure DI | Pure DI | Pure DI | Pure DI |
| **Max isolation** | Level 3 | Level 1 | Level 1 | Level 1-2 | Level 2 |
| **Cross-feature** | ✅ | ✅ | ❌ | ❌ | ⚠️ |
| **Binary lean** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Compile-time** | ❌ | ✅ | ⚠️ | ⚠️ | ✅ |
| **KMP** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Auto-discovery** | ✅ | N/A | ❌ | ✅ | ❌ |
| **Build speed** | ✅ | ❌ KAPT | ❌ KAPT | ❌ KAPT | ⚠️ KSP |
| **Maturity** | Stable | Stable | Stable | Stable | Pre-1.0 |
| **Singleton sharing** | koinApplication | @Singleton | CoreApis ⚠️ | CoreApis ⚠️ | Component |

---

## Decision Matrix

| Your constraint | Best fit |
|-----------------|----------|
| Compile-time safety above all | Dagger A or kotlin-inject |
| Pure DI (no service locator) | Dagger (any) or kotlin-inject |
| Features depend on each other | Dagger A or Koin |
| Features are truly independent | Dagger B or C |
| KMP required | Koin or kotlin-inject |
| Android-only, small SDK | Dagger A |
| Android-only, modular publishing | Dagger B |
| Android-only, 20+ features | Dagger C |
| Zero codegen, fastest builds | Koin |
| KMP SDK consumed by Dagger app | Hybrid: Koin SDK + Dagger bridge |
| Binary size critical | Koin, Dagger B/C, kotlin-inject |
| Team has Dagger expertise | Dagger (any approach) |

---

## Anti-Pattern: Consumer Imports Impl Classes

Regardless of framework, consumers should never import implementation classes:

```kotlin
// ❌ Coupled to implementation
import com.example.sdk.security.impl.SecurityServiceImpl
val service = SecurityServiceImpl(network)

// ✅ Depends on interface
val service: SecurityService = sdk.get()           // Koin
val service = MySdk.auth()                          // Dagger A
val service = FeatureSecurity.securityService()     // Dagger B/C
val service = component.securityService()           // kotlin-inject
```
