---
scope: [navigation, compose, swiftui]
sources: [navigation3, androidx-navigation, swiftui]
targets: [android, desktop, ios, macos]
slug: navigation-hub
status: active
layer: L0
category: navigation
description: "Navigation category hub: Navigation3 for Compose, SwiftUI NavigationStack for Apple"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/navigation"
    type: doc-page
    tier: 2
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 2
rules:
  - id: no-channel-for-navigation
    type: banned-usage
    message: "Navigation must be state-driven, not Channel-based"
    detect:
      in_class_extending: ViewModel
      banned_type_for_navigation: Channel
      prefer: "NavigationState sealed interface"
    hand_written: true
    source_rule: NoChannelForNavigationRule.kt

---

# Navigation

Navigation patterns for KMP — Navigation3 for Compose targets, SwiftUI NavigationStack for Apple.

> State-driven navigation only. Never use Channel for navigation events.

## Documents

| Document | Description |
|----------|-------------|
| [navigation-patterns](navigation-patterns.md) | Hub: navigation architecture, state-driven approach, quick reference |
| [navigation3-patterns](navigation3-patterns.md) | Navigation3 — backstack, deep links, platform differences |

## Key Rules

- State-driven navigation: ViewModel exposes sealed `NavigationState`, never `Channel<Route>`
- Use `MutableSharedFlow(replay=0)` for one-shot navigation events if needed
- No navigation logic in Composables — delegate to ViewModel
