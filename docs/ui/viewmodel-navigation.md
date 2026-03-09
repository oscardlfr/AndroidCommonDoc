---
scope: [viewmodel, navigation]
sources: [navigation3, lifecycle-viewmodel, kotlinx-serialization]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 714
description: "Navigation patterns: state-driven navigation, Navigation3, route serialization, why not Channel"
slug: viewmodel-navigation
status: active
layer: L0
parent: viewmodel-state-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
category: ui
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

# ViewModel Navigation Patterns

## Overview

Navigation patterns for ViewModels in KMP projects. Navigation is state-driven -- the UI observes state and triggers navigation when appropriate. Channels must NOT be used for navigation events.

**Core Principle**: Navigation is a state transition, not a message. State-driven navigation survives configuration changes.

---

## 1. State-Driven Navigation (Recommended)

Navigation intent is part of state. The UI observes state and triggers navigation when appropriate.

```kotlin
// UiState includes navigation trigger
sealed interface AuthUiState {
    data class Success(val navigateToHome: Boolean = false) : AuthUiState
}

// Screen
LaunchedEffect(uiState) {
    if ((uiState as? AuthUiState.Success)?.navigateToHome == true) {
        onNavigateToHome()
    }
}
```

---

## 2. Do NOT Use Channel for Navigation

**DON'T (Anti-pattern):**
```kotlin
// BAD: Channel buffers navigation events -- user may see stale navigation after backgrounding the app
class MyViewModel : ViewModel() {
    private val _navigationChannel = Channel<NavigationEvent>()
    val navigationEvents = _navigationChannel.receiveAsFlow()

    fun onLoginSuccess() {
        viewModelScope.launch {
            _navigationChannel.send(NavigationEvent.GoToHome) // Buffered!
        }
    }
}
```

**DO (Correct):**
```kotlin
// State-driven navigation survives configuration changes and aligns with Now in Android
sealed interface AuthUiState {
    data class Success(val navigateToHome: Boolean = false) : AuthUiState
}
```

**Key insight:** Navigation is a state transition, not a task. Use state to represent "should navigate" and let the UI react to it.

---

## 3. When to Use Callbacks Directly

For simple user-initiated navigation (list item tap), the Screen can call the navigation callback directly without involving the ViewModel:

```kotlin
SnapshotItem(
    onClick = { onNavigateToDetail(snapshot.id) } // Direct callback
)
```

Use state-driven navigation only when the navigation depends on an async operation (save, delete, login).

---

## References

- [Now in Android - Architecture](https://github.com/android/nowinandroid/blob/main/docs/ArchitectureLearningJourney.md)
- [Nav3 Recipes](https://github.com/android/nav3-recipes)
- Parent doc: [viewmodel-state-patterns.md](viewmodel-state-patterns.md)
