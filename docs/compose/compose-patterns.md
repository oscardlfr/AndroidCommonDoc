---
scope: [compose, resources, ui]
sources: [compose-multiplatform, compose-resources]
targets: [android, desktop, ios]
slug: compose-patterns
status: active
layer: L0
category: compose
description: "Hub doc: Compose Multiplatform patterns for resources, configuration, and usage"
version: "1.0"
last_updated: "2026-03-16"
assumes_read: compose-hub
token_budget: 411
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
rules:
  - id: sealed-ui-state
    type: prefer-construct
    message: "UiState must be sealed interface, not data class with boolean flags"
    detect:
      class_suffix: UiState
      must_be: sealed
    hand_written: true
    source_rule: SealedUiStateRule.kt

---

# Compose Patterns

Patterns for Compose Multiplatform development in KMP projects. Covers resource management (configuration, usage, troubleshooting), multi-module resource strategy, and platform-specific considerations for Android, Desktop, and iOS/macOS.

## Sub-documents

| Document | Description |
|----------|-------------|
| [compose-resources-patterns](compose-resources-patterns.md) | Resource management hub: core principles, quick reference, related patterns |
| [compose-resources-configuration](compose-resources-configuration.md) | Build configuration: generateResClass, source sets, multi-module setup |
| [compose-resources-configuration-setup](compose-resources-configuration-setup.md) | Detailed setup: multi-module strategy, shared vs feature resources, cross-module access |
| [compose-resources-usage](compose-resources-usage.md) | Runtime usage: string resources, image loading, fonts, qualifiers, dual resource system |
| [compose-resources-troubleshooting](compose-resources-troubleshooting.md) | Common issues and solutions: missing Res, duplicate registration, CI failures |

## Related

- [UI Screen Patterns](../ui/ui-screen-patterns.md) -- How to use resources in screens
- [KMP Architecture](../architecture/kmp-architecture.md) -- Source set hierarchy
