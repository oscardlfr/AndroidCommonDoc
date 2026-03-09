---
scope: [resources, lifecycle, memory]
sources: [android-lifecycle, compose-runtime, kotlinx-coroutines]
targets: [android, desktop, ios]
slug: resource-management
status: active
layer: L0
category: resources
description: "Hub doc: Resource management patterns for KMP -- lifecycle, memory, desktop coexistence"
version: "1.0"
last_updated: "2026-03-16"
assumes_read: resources-hub
token_budget: 362
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
        - "platform.Foundation"
    hand_written: true
    source_rule: NoPlatformDepsInViewModelRule.kt

---

# Resource Management Patterns

Patterns for managing CPU, memory, and lifecycle resources in KMP applications. Covers focus-based resource management for desktop apps coexisting with heavyweight processes, coroutine scope lifecycle, and graceful shutdown.

## Sub-documents

| Document | Description |
|----------|-------------|
| [resource-management-patterns](resource-management-patterns.md) | Core patterns: processing modes (SILENT/LOW_PRIORITY/FULL_SPEED), quick reference, overview |
| [resource-management-lifecycle](resource-management-lifecycle.md) | Lifecycle patterns: window focus detection, process monitoring, state machine, coroutine scopes |
| [resource-management-memory](resource-management-memory.md) | Memory management: resource-aware file watching, graceful shutdown, anti-patterns, testing |

## Related

- [KMP Architecture](../architecture/kmp-architecture.md) -- Source set hierarchy for platform-specific resource handling
- [Offline-First Patterns](../offline-first/offline-first-patterns.md) -- Background processing patterns
