---
scope: [resources, memory, lifecycle, desktop]
sources: [kotlinx-coroutines, compose-multiplatform]
targets: [android, desktop, jvm]
slug: resources-hub
status: active
layer: L0
category: resources
description: "Resources category hub: Resource lifecycle, memory management, desktop coexistence patterns"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 2
rules:
  - id: no-platform-deps-in-viewmodel
    type: banned-import
    message: "ViewModels must not import platform-specific APIs (android.*, UIKit.*)"
    detect:
      in_class_extending: ViewModel
      banned_import_prefixes:
        - "android."
        - "platform.UIKit"
    hand_written: true
    source_rule: NoPlatformDepsInViewModelRule.kt

---

# Resources

Resource lifecycle and memory management patterns for multi-app KMP desktop environments.

> Release resources when the app loses focus on Desktop — multiple DAWs may share limited memory.

## Documents

| Document | Description |
|----------|-------------|
| [resource-management-patterns](resource-management-patterns.md) | Hub: lifecycle overview, core principles |
| [resource-management](resource-management.md) | Resource management architecture and patterns |
| [resource-management-lifecycle](resource-management-lifecycle.md) | Lifecycle-aware cleanup, coroutine scopes, window focus |
| [resource-management-memory](resource-management-memory.md) | Memory pressure handling, LRU caches, weak references |

## Key Rules

- Use `WindowFocusListener` on Desktop to release non-critical resources on focus loss
- Coroutine scopes tied to lifecycle — cancel on `onCleared()` / `onStop()`
- Never hold strong references to Composable lambdas in ViewModels
