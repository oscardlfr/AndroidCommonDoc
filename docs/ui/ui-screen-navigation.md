---
scope: [ui, navigation, compose]
sources: [navigation3, compose-ui]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 589
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "Navigation patterns: callback-based, state-driven, Nav3, cross-platform notes"
slug: ui-screen-navigation
status: active
layer: L0
parent: ui-screen-patterns
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

# Screen Navigation Patterns

## Overview

Navigation patterns for Compose screens: callback-based navigation for simple clicks, state-driven navigation for async outcomes, and Nav3 modular patterns.

**Core Principle**: Navigation is a state transition, not a message. State-driven navigation survives configuration changes and aligns with Now in Android patterns.

---

## 1. Callback-Based Navigation (Default)

For simple user-initiated navigation (e.g., list item click), pass a callback from the NavHost:

```kotlin
// entryProvider
entryProvider {
    entry<SnapshotListRoute> { key ->
        SnapshotListScreen(
            onNavigateToDetail = { id -> backStack.add(SnapshotDetailRoute(id)) }
        )
    }
}

// Screen
SnapshotListContent(
    onSnapshotClick = { snapshot -> onNavigateToDetail(snapshot.id) }
)
```

## 2. State-Driven Navigation (Async Outcomes)

When navigation depends on an async operation (save, delete, login), use a state flag:

```kotlin
// UiState
data class Ready(
    val saveSuccess: Boolean = false
) : MyUiState

// Screen
LaunchedEffect(uiState) {
    if ((uiState as? MyUiState.Ready)?.saveSuccess == true) {
        onNavigateBack()
    }
}
```

### Anti-Pattern

```kotlin
// BAD: Channel-based navigation buffers events and causes stale navigation after config changes
val navigationEvents = Channel<NavEvent>()

LaunchedEffect(Unit) {
    navigationEvents.receiveAsFlow().collect { event ->
        navController.navigate(event.route)
    }
}
```

## 3. Nav3 Patterns

For modular navigation with Nav3:
- Define routes as `@Serializable data object` or `data class` implementing `NavKey`
- Place routes in a `-api` module; implementations in `-impl` module
- Use `entryProvider` DSL to register screens

```kotlin
// feature/auth-api
@Serializable data object AuthRoute : NavKey

// feature/auth-impl
entryProvider {
    entry<AuthRoute> { key -> AuthScreen(onSuccess = { backStack.add(HomeRoute) }) }
}
```

---

**Parent doc**: [ui-screen-patterns.md](ui-screen-patterns.md)
