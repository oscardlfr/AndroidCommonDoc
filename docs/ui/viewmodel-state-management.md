---
scope: [viewmodel, state, compose]
sources: [lifecycle-viewmodel, kotlinx-coroutines, compose-runtime]
targets: [android, desktop, ios, jvm]
version: 2
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 743
description: "State patterns: sealed interface UiState, StateFlow, stateIn, MutableStateFlow, error handling, UiText"
slug: viewmodel-state-management
status: active
layer: L0
parent: viewmodel-state-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
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
  - id: no-hardcoded-strings-in-viewmodel
    type: banned-usage
    message: "Hardcoded string literals in ViewModels violate UiText contract — use StringResource or DynamicString"
    detect:
      in_class_extending: ViewModel
      banned_literal_type: string
      exclude: [empty, companion_object, log_tags]
    hand_written: true
    source_rule: NoHardcodedStringsInViewModelRule.kt

---

# ViewModel State Management Patterns

## Overview

Standard patterns for ViewModel state management in Android and Kotlin Multiplatform projects. ViewModels manage UI state and orchestrate business logic via use cases or repositories, exposing a single `StateFlow<UiState>` to the UI layer.

**Core Principle**: ViewModels are platform-agnostic. They never depend on Android `Context`, `Resources`, or any platform-specific API.

---

## Sub-documents

- **[viewmodel-state-management-sealed](viewmodel-state-management-sealed.md)**: Sealed interface UiState modeling -- sealed interface pattern, BaseUiState contract, UiText for user-facing strings, ViewModel boundaries (no platform deps), error handling with CancellationException, UseCase execution
- **[viewmodel-state-management-stateflow](viewmodel-state-management-stateflow.md)**: StateFlow exposure and iOS integration -- stateIn with WhileSubscribed, MutableStateFlow for imperative updates, injectable viewModelScope, SKIE and KMP-NativeCoroutines for iOS, Swift state wrappers

---

## Quick Reference

### UiState: Always Sealed Interface

```kotlin
sealed interface SnapshotListUiState {
    data object Loading : SnapshotListUiState
    data class Success(val snapshots: List<Snapshot>) : SnapshotListUiState
    data class Error(val message: UiText) : SnapshotListUiState
}
```

### StateFlow with stateIn

```kotlin
val uiState: StateFlow<SnapshotListUiState> =
    repository.getSnapshots()
        .asResult()
        .map { /* transform to UiState */ }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = SnapshotListUiState.Loading
        )
```

### UiText for User-Facing Strings

```kotlin
sealed interface UiText {
    data class StringResource(val key: String, val args: List<Any> = emptyList()) : UiText
    data class DynamicString(val value: String) : UiText
}
```

---

## References

- [Now in Android - Architecture](https://github.com/android/nowinandroid/blob/main/docs/ArchitectureLearningJourney.md)
- [Android Architecture Guide](https://developer.android.com/topic/architecture)
- Parent doc: [viewmodel-state-patterns.md](viewmodel-state-patterns.md)
