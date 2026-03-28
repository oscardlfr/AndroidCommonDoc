---
scope: [dependency-injection, koin, hilt, testing]
sources: [koin, dagger-hilt, kotlin-multiplatform]
targets: [android, desktop, ios, jvm]
slug: di-hub
status: active
layer: L0
category: di
description: "DI category hub: Framework-agnostic dependency injection patterns for KMP with Koin and Hilt"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://github.com/InsertKoinIO/koin/releases"
    type: github-releases
    tier: 2
  - url: "https://insert-koin.io/docs/quickstart/kmp"
    type: doc-page
    tier: 3
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

---

# Dependency Injection

DI patterns for Kotlin Multiplatform projects — framework-agnostic principles with framework-specific guidance.

> For SDK-specific DI patterns (modular init, auto-discovery, consumer isolation), see the [archive DI docs](../archive/dagger2-sdk-selective-init.md).

## Documents

| Document | Description |
|----------|-------------|
| [di-patterns](di-patterns.md) | Core patterns, framework comparison, quick reference |
| [di-patterns-modules](di-patterns-modules.md) | Module organization — shared modules, platform-specific bindings |
| [di-patterns-testing](di-patterns-testing.md) | Testing DI — test modules, fakes, overriding bindings |

## Related (Archive)

| Document | Description |
|----------|-------------|
| [dagger2-sdk-selective-init](../archive/dagger2-sdk-selective-init.md) | Dagger 2 SDK: 3 approaches (monolithic, per-feature, ServiceLoader) |
| [di-sdk-selective-init-comparison](../archive/di-sdk-selective-init-comparison.md) | Framework comparison for modular SDKs (5 approaches × 10 requirements) |
| [di-sdk-consumer-isolation](../archive/di-sdk-consumer-isolation.md) | Isolation levels, DI vs Service Locator, cross-feature deps |
| [di-cross-feature-deps](../archive/di-cross-feature-deps.md) | Cross-feature dependencies: real examples per approach |
| [di-hybrid-koin-sdk-dagger-app](../archive/di-hybrid-koin-sdk-dagger-app.md) | Koin SDK + Dagger/Hilt app bridge pattern |

## Key Rules

- Constructor injection for production classes — keep DI resolution at the edge (app init, DI modules)
- Use `expect/actual` for platform-specific DI module declarations
- Never inject Android `Context` into shared ViewModels
- Test modules replace production bindings — use fakes, not mocks at the DI level
- For SDKs: use `koinApplication {}` (isolated) instead of `startKoin {}` (global)
- **Desktop/Compose**: bridge isolated SDK into `GlobalContext.startKoin(app)` so `koinViewModel()` works — see [di-patterns-modules § GlobalContext Bridge](di-patterns-modules.md)
