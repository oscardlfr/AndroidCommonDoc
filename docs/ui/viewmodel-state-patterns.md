---
scope: [viewmodel, state, events, navigation]
sources: [lifecycle-viewmodel, kotlinx-coroutines, compose-runtime]
targets: [android, desktop, ios, jvm]
version: 3
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 955
description: "Hub doc: ViewModel state management, events, and navigation patterns"
slug: viewmodel-state-patterns
status: active
layer: L0
category: ui

monitor_urls:
  - url: "https://github.com/androidx/androidx/releases"
    type: github-releases
    tier: 1
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
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
  - id: no-channel-or-sharedflow-events
    type: banned-usage
    message: "Use state-based events (nullable UiState fields) instead of Channel or MutableSharedFlow for UI events in ViewModels"
    detect:
      in_class_extending: ViewModel
      banned_initializer: ["Channel<", "MutableSharedFlow<"]
      prefer: "nullable field in UiState + onEventConsumed() callback"
    hand_written: true
    source_rule: NoChannelOrSharedFlowForUiEventsRule.kt
  - id: while-subscribed-timeout
    type: required-call-arg
    message: "stateIn with WhileSubscribed must specify timeout (5_000ms recommended)"
    detect:
      call: stateIn
      required_arg: WhileSubscribed
      with_param: stopTimeoutMillis
    hand_written: true
    source_rule: WhileSubscribedTimeoutRule.kt
---

# ViewModel and State Patterns

---

## Overview

This document defines standard patterns for ViewModels in Android and Kotlin Multiplatform projects. ViewModels manage UI state and orchestrate business logic via use cases or repositories, exposing a single `StateFlow<UiState>` to the UI layer.

**Core Principle**: ViewModels are platform-agnostic. They never depend on Android `Context`, `Resources`, or any platform-specific API.

> These patterns apply to **both Android-only and KMP projects**.

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[viewmodel-state-management](viewmodel-state-management.md)**: State patterns -- sealed interface UiState, StateFlow with stateIn, MutableStateFlow, error handling, CancellationException, UiText, UseCase execution, iOS integration
- **[viewmodel-navigation](viewmodel-navigation.md)**: Navigation patterns -- state-driven navigation, Navigation3, why not Channel, when to use callbacks directly
- **[viewmodel-events](viewmodel-events.md)**: Event patterns -- state-based events (nullable UiState fields + onEventConsumed callback), why not Channel or SharedFlow, testing ViewModels, dispatcher setup, test checklist

---

## Quick Reference

- UiState: `sealed interface` (never data class with boolean flags)
- Expose via `StateFlow` with `stateIn(WhileSubscribed(5_000))`
- Events: nullable UiState field + `onEventConsumed()` callback
- Navigation: state-driven (not Channel-based)
- Always rethrow `CancellationException` in catch blocks

See sub-docs for code examples: [viewmodel-state-management](viewmodel-state-management.md), [viewmodel-events](viewmodel-events.md), [viewmodel-navigation](viewmodel-navigation.md).

---

## References

- [Now in Android - Architecture](https://github.com/android/nowinandroid/blob/main/docs/ArchitectureLearningJourney.md)
- [Android Architecture Guide](https://developer.android.com/topic/architecture)
- [UI and Screen Patterns](ui-screen-patterns.md) - Companion doc

validate_upstream:
  - url: "https://developer.android.com/kotlin/coroutines/coroutines-best-practices"
    assertions:
      - type: api_present
        value: "stateIn"
        context: "WhileSubscribed(5000) pattern depends on stateIn"
      - type: api_present
        value: "viewModelScope"
        context: "ViewModel coroutine scope management"
      - type: keyword_absent
        value: "Channel"
        qualifier: "recommended"
        context: "We teach SharedFlow over Channel for UI events"
      - type: deprecation_scan
        value: "StateFlow"
        context: "StateFlow is our core state primitive"
    on_failure: HIGH
---

**Status**: Active | **Last Validated**: March 2026 with Koin 4.1.1 / kotlinx-coroutines 1.10.x
