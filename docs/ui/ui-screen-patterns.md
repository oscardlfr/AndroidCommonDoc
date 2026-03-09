---
scope: [ui, compose, screens, navigation]
sources: [compose-ui, compose-material3, navigation3]
targets: [android, desktop, ios]
version: 3
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 670
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "Hub doc: UI screen composition, navigation, and component patterns"
slug: ui-screen-patterns
status: active
layer: L0
category: ui
rules:
  - id: sealed-ui-state
    type: prefer-construct
    message: "UiState must be sealed interface, not data class with boolean flags"
    detect:
      class_suffix: UiState
      must_be: sealed
    hand_written: true
    source_rule: SealedUiStateRule.kt
  - id: no-channel-for-ui-events
    type: banned-usage
    message: "Use MutableSharedFlow(replay=0) for ephemeral events, never Channel"
    detect:
      in_class_extending: ViewModel
      banned_type: Channel
      prefer: "MutableSharedFlow(replay=0)"
    hand_written: true
    source_rule: NoChannelForUiEventsRule.kt
  - id: while-subscribed-timeout
    type: required-call-arg
    message: "stateIn with WhileSubscribed must specify timeout (5_000ms recommended)"
    detect:
      method_call: stateIn
      arg: WhileSubscribed
      required_non_zero_timeout: true
    hand_written: true
    source_rule: WhileSubscribedTimeoutRule.kt
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

# UI and Screen Patterns

---

## Overview

Standard patterns for UI screens and components in Kotlin Multiplatform projects. Covers screen composition, navigation integration, component design, and cross-platform considerations.

**Core Principle**: UI layer handles presentation only. Business logic lives in ViewModels; navigation is driven by state or callbacks from the navigation host.

### Key Rules

- Split every screen into Screen (state collection) + Content (pure presentation) composables
- Use semantic components from the design system (never raw `Button`, `Text` for common patterns)
- All user-facing text via `stringResource()` (never hardcoded strings)
- Simple navigation: callback from NavHost. Async navigation: state flag, not Channel
- Screen results: pass via ViewModel state or navigation arguments

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[ui-screen-structure](ui-screen-structure.md)**: Screen structure -- Screen+Content split, design system components, string resources, state handling, accessibility, test tags
- **[ui-screen-navigation](ui-screen-navigation.md)**: Navigation patterns -- callback-based, state-driven, Nav3, cross-platform notes
- **[ui-screen-components](ui-screen-components.md)**: Component patterns -- semantic components, UiText, cross-platform resource strategies, checklists

---

## References

- [Now in Android - Architecture](https://github.com/android/nowinandroid/blob/main/docs/ArchitectureLearningJourney.md)
- [Nav3 Recipes](https://github.com/android/nav3-recipes)
- [Android Architecture Guide](https://developer.android.com/topic/architecture)
- [Compose Accessibility](https://developer.android.com/develop/ui/compose/accessibility)

---

**Status**: Active -- All screens must follow these patterns.
**Last Validated**: March 2026 with Compose Multiplatform 1.8.x / Navigation3
