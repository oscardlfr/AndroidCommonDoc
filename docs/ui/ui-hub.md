---
scope: [ui, viewmodel, compose, state-management]
sources: [jetpack-compose, kotlin-multiplatform, androidx-lifecycle]
targets: [android, desktop, ios]
slug: ui-hub
status: active
layer: L0
category: ui
description: "UI category hub: Screen composition, ViewModel state management, events, and navigation patterns"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
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

# UI

Screen composition, ViewModel state management, ephemeral events, and state-driven navigation.

> UiState is always a `sealed interface`. Never use `data class` with boolean flags.

## Documents

| Document | Description |
|----------|-------------|
| [ui-screen-patterns](ui-screen-patterns.md) | Hub: screen structure, accessibility, navigation hooks |
| [ui-screen-structure](ui-screen-structure.md) | Screen layout — slot API, scaffold, content padding |
| [ui-screen-components](ui-screen-components.md) | Reusable component patterns |
| [ui-screen-navigation](ui-screen-navigation.md) | Screen-level navigation callbacks |
| [viewmodel-state-patterns](viewmodel-state-patterns.md) | Hub: ViewModel state, sealed UiState, StateFlow |
| [viewmodel-state-management](viewmodel-state-management.md) | State management — sealed UiState, error states |
| [viewmodel-state-management-sealed](viewmodel-state-management-sealed.md) | Sealed interface deep dive |
| [viewmodel-state-management-stateflow](viewmodel-state-management-stateflow.md) | StateFlow — stateIn, WhileSubscribed(5000) |
| [viewmodel-events](viewmodel-events.md) | Ephemeral events — MutableSharedFlow(replay=0) |
| [viewmodel-events-consumption](viewmodel-events-consumption.md) | Consuming events in Compose |
| [viewmodel-navigation](viewmodel-navigation.md) | State-driven navigation from ViewModel |

## Key Rules

- `sealed interface UiState` — Loading, Success, Error only (no boolean flags)
- `stateIn(WhileSubscribed(5_000))` for StateFlow exposed from ViewModels
- `MutableSharedFlow(replay=0)` for one-shot ephemeral events — never Channel
