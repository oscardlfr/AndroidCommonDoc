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
last_updated: "2026-05"
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

validate_upstream:
  - url: "https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-multiplatform-resources-usage.html"
    assertions:
      - type: api_present
        value: "composeResources"
        context: "Compose Multiplatform resource system"
      - type: api_present
        value: "Res.string"
        context: "String resource access pattern"
      - type: deprecation_scan
        value: "painterResource"
        context: "Image resource API we teach"
    on_failure: MEDIUM
---

# Compose Patterns

Patterns for Compose Multiplatform development in KMP projects. Covers resource management (configuration, usage, troubleshooting), multi-module resource strategy, and platform-specific considerations for Android, Desktop, and iOS/macOS.

## Sub-documents

| Document | Description |
|----------|----------validate_upstream:
  - url: "https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-multiplatform-resources-usage.html"
    assertions:
      - type: api_present
        value: "composeResources"
        context: "Compose Multiplatform resource system"
      - type: api_present
        value: "Res.string"
        context: "String resource access pattern"
      - type: deprecation_scan
        value: "painterResource"
        context: "Image resource API we teach"
    on_failure: MEDIUM
---|
| [compose-resources-patterns](compose-resources-patterns.md) | Resource management hub: core principles, quick reference, related patterns |
| [compose-resources-configuration](compose-resources-configuration.md) | Build configuration: generateResClass, source sets, multi-module setup |
| [compose-resources-configuration-setup](compose-resources-configuration-setup.md) | Detailed setup: multi-module strategy, shared vs feature resources, cross-module access |
| [compose-resources-usage](compose-resources-usage.md) | Runtime usage: string resources, image loading, fonts, qualifiers, dual resource system |
| [compose-resources-troubleshooting](compose-resources-troubleshooting.md) | Common issues and solutions: missing Res, duplicate registration, CI failures |

## CMP 1.11.0 Highlights

Key additions in Compose Multiplatform 1.11.0 (KotlinConf'26, 2026-05-20):

- **Hot Reload**: bundled out of the box — no separate plugin required
- **iOS Liquid Glass interop**: native UIKit blur/glass effect composable bridge
- **Native text input**: full IME and selection handles on iOS and macOS
- **Test API v2**: Compose UI test package migrated to `androidx.compose.ui.test.v2`; dispatcher changed from `UnconfinedTestDispatcher` to `StandardTestDispatcher`. See [testing-compose-ui-test-v2](../testing/testing-compose-ui-test-v2.md) for migration guide.

## Related

- [UI Screen Patterns](../ui/ui-screen-patterns.md) -- How to use resources in screens
- [KMP Architecture](../architecture/kmp-architecture.md) -- Source set hierarchy
