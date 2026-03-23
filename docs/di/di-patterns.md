---
scope: [dependency-injection, architecture]
sources: [koin, dagger-hilt]
targets: [android, desktop, ios, jvm]
version: 2
last_updated: "2026-03"
assumes_read: di-hub
token_budget: 812
description: "Hub doc: Framework-agnostic DI patterns for KMP with Koin and Dagger/Hilt specifics"
slug: di-patterns
status: active
layer: L0

monitor_urls:
  - url: "https://github.com/InsertKoinIO/koin/releases"
    type: github-releases
    tier: 1
  - url: "https://github.com/google/dagger/releases"
    type: github-releases
    tier: 1
category: di
rules:
  - id: no-platform-deps-in-viewmodel
    type: banned-import
    message: "ViewModels must not import platform-specific APIs (android.*, UIKit.*)"
    detect:
      in_class_extending: ViewModel
      banned_import_prefixes:
        - "android."
        - "platform.UIKit"
        - "platform.Foundation"
    hand_written: true
    source_rule: NoPlatformDepsInViewModelRule.kt

validate_upstream:
  - url: "https://insert-koin.io/docs/reference/koin-mp/kmp"
    assertions:
      - type: api_present
        value: "koinApplication"
        context: "Koin isolated application — preferred for SDKs and testing"
      - type: api_present
        value: "module"
        context: "Koin module declaration"
      - type: keyword_present
        value: "Kotlin Multiplatform"
        context: "Koin must still support KMP"
    on_failure: MEDIUM
---

# Dependency Injection Patterns for KMP

---

## Overview

Dependency Injection in KMP projects follows framework-agnostic principles: constructor injection everywhere, module-scoped bindings in `di/` packages, platform-specific providers via `expect`/`actual`. The two most common frameworks are Koin (KMP-native, used in cross-platform projects) and Dagger/Hilt (Android-centric, used in enterprise Android projects).

**Core Principles**:
1. Constructor injection for ALL production classes — dependencies declared in constructor, resolved at the DI boundary (app init, module declarations)
2. Module declarations live in each module's `di/` package
3. Platform-specific bindings use `expect`/`actual` or framework-specific mechanisms
4. ViewModels get their dependencies via constructor -- never via manual DI lookups inside business logic

---

## Sub-documents

- **[di-patterns-modules](di-patterns-modules.md)**: Module declaration patterns -- Koin module declarations, koinViewModel, Dagger/Hilt ViewModel injection, app startup, KMP platform modules, Dagger @Module/@Binds/@Provides, KMP+Hilt hybrid pattern
- **[di-patterns-testing](di-patterns-testing.md)**: DI testing patterns — Koin test module setup, test lifecycle (koinApplication/close), anti-patterns table, interface-based binding, scoping rules

---

## References

- [Koin Documentation](https://insert-koin.io/docs/reference/introduction)
- [Dagger/Hilt Documentation](https://dagger.dev/hilt/)
- [KMP Architecture](../architecture/kmp-architecture.md) — expect/actual for platform bindings
- [Testing Patterns](../testing/testing-patterns.md) — Fake injection, Koin test lifecycle
- [SDK DI Concepts](../archive/di-sdk-consumer-isolation.md) — DI vs Service Locator, isolation levels, cross-feature deps
- [Framework Comparison](../archive/di-sdk-selective-init-comparison.md) — Dagger vs Koin vs kotlin-inject for SDKs
