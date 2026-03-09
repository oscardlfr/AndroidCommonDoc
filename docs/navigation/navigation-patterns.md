---
scope: [navigation, ui, architecture]
sources: [androidx-navigation3, kotlinx-serialization]
targets: [android, desktop, ios, macos]
slug: navigation-patterns
status: active
layer: L0
category: navigation
description: "Hub doc: Navigation patterns for KMP -- Navigation3 for Compose, SwiftUI NavigationStack for Apple"
version: "1.0"
last_updated: "2026-03-16"
assumes_read: navigation-hub
token_budget: 272
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/navigation"
    type: doc-page
    tier: 2
rules:
  - id: no-channel-for-navigation
    type: banned-usage
    message: "Navigation must be state-driven via sealed NavigationState, not Channel-based"
    detect:
      in_class_extending: ViewModel
      banned_type_for_nav: Channel
      prefer: "NavigationState sealed interface"
    hand_written: true
    source_rule: NoChannelForNavigationRule.kt

---

# Navigation Patterns

Navigation patterns for Kotlin Multiplatform projects. Android and Desktop share a Navigation3 Compose graph with @Serializable routes; iOS and macOS use native SwiftUI NavigationStack with shared KMP ViewModels.

## Sub-documents

| Document | Description |
|----------|-------------|
| [navigation3-patterns](navigation3-patterns.md) | Navigation3 implementation: @Serializable routes, entryProvider DSL, state-driven navigation, platform split |

## Related

- [ViewModel Navigation](../ui/viewmodel-navigation.md) -- State-driven navigation and Channel anti-pattern
- [UI Screen Patterns](../ui/ui-screen-patterns.md) -- Screen/Content split, navigation callbacks
