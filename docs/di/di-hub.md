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

Framework-agnostic DI patterns for Kotlin Multiplatform projects.

> Prefer Koin for KMP (pure Kotlin); use Hilt only for Android-only modules requiring Jetpack integration.

## Documents

| Document | Description |
|----------|-------------|
| [di-patterns](di-patterns.md) | Hub: core patterns, framework comparison, quick reference |
| [di-patterns-modules](di-patterns-modules.md) | Module organization — shared modules, platform-specific bindings |
| [di-patterns-testing](di-patterns-testing.md) | Testing DI — test modules, fakes, overriding bindings |

## Key Rules

- Use `expect/actual` for platform-specific DI module declarations
- Never inject Android `Context` into shared ViewModels
- Test modules replace production bindings — never use mocks at the DI level
