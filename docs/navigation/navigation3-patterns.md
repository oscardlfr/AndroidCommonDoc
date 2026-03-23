---
scope: [navigation, ui, architecture]
sources: [androidx-navigation3, kotlinx-serialization]
targets: [android, desktop, ios, macos]
version: 1
last_updated: "2026-03"
assumes_read: navigation-hub
token_budget: 1793
description: "Navigation3 patterns for KMP: @Serializable routes, shared Compose graph for Android+Desktop, native NavigationStack for iOS/macOS"
slug: navigation3-patterns
status: active
layer: L0

monitor_urls:
  - url: "https://central.sonatype.com/artifact/androidx.navigation3/navigation3"
    type: maven-central
    tier: 1
  - url: "https://github.com/android/nav3-recipes"
    type: github-releases
    tier: 2
parent: navigation-patterns
category: navigation
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

validate_upstream:
  - url: "https://developer.android.com/develop/ui/compose/navigation"
    assertions:
      - type: api_present
        value: "NavHost"
        context: "Navigation container composable"
      - type: api_present
        value: "composable"
        context: "Route registration function"
      - type: deprecation_scan
        value: "navigation-compose"
        context: "Core navigation library we use"
    on_failure: MEDIUM
---

# Navigation3 Patterns for KMP

---

## Overview

Navigation3 (androidx.navigation3) provides type-safe, composable navigation for Kotlin Multiplatform projects. In a KMP setup, Android and Desktop share a single Compose navigation graph, while iOS and macOS use native SwiftUI NavigationStack with shared ViewModels.

**Core Principles**:
1. Navigation is state-driven -- never use Channels for navigation events
2. Routes are `@Serializable` data objects/classes implementing `NavKey` -- type-safe arguments, no hardcoded strings
3. One navigation graph serves Android + Desktop Compose; iOS/macOS use native navigation with shared KMP ViewModels

---

## Rules

### 1. Define Routes as @Serializable Types

Every route is a `@Serializable` data object (no arguments) or data class (with arguments) implementing `NavKey`. Place route definitions in the feature's `-api` module so other features can navigate to them without depending on the implementation.

```kotlin
// feature/auth-api (commonMain)
@Serializable data object AuthRoute : NavKey
@Serializable data object HomeRoute : NavKey

// feature/snapshot-api (commonMain)
@Serializable data class SnapshotDetailRoute(val snapshotId: String) : NavKey
```

**DON'T (Anti-pattern):**
```kotlin
// BAD: Hardcoded route strings are error-prone and not type-safe
navController.navigate("snapshot/detail/$id")
navController.navigate("auth/login?redirect=$path")
```

**DO (Correct):**
```kotlin
// Type-safe navigation with compile-time argument validation
backStack.add(SnapshotDetailRoute(snapshotId = id))
```

### 2. Register Screens with entryProvider DSL

Each feature module registers its screens using the `entryProvider` DSL. Implementations live in `-impl` modules, separate from the route definitions.

```kotlin
// feature/auth-impl (commonMain - Compose)
entryProvider {
    entry<AuthRoute> { key ->
        AuthScreen(
            onSuccess = { backStack.add(HomeRoute) },
            onRegister = { backStack.add(RegisterRoute) }
        )
    }
}
```

### 3. State-Driven Navigation for Async Outcomes

When navigation depends on an async operation (login, save, delete), use a state flag in UiState. The UI observes the state and triggers navigation when the flag changes.

```kotlin
// ViewModel
sealed interface AuthUiState {
    data object Idle : AuthUiState
    data object Loading : AuthUiState
    data class Success(val navigateToHome: Boolean = false) : AuthUiState
    data class Error(val message: UiText) : AuthUiState
}

// Screen composable
LaunchedEffect(uiState) {
    if ((uiState as? AuthUiState.Success)?.navigateToHome == true) {
        onNavigateToHome()
        viewModel.onNavigationHandled()
    }
}
```

**DON'T (Anti-pattern):**
```kotlin
// BAD: Channel buffers events -- stale navigation fires after config changes
private val _navChannel = Channel<NavigationEvent>()
val navigationEvents = _navChannel.receiveAsFlow()
```

**Key insight:** Navigation is a state transition, not a message. State-driven navigation survives configuration changes.

### 4. Callback-Based Navigation for Direct User Actions

For simple user-initiated navigation (list item tap, button click) that does not depend on async work, pass navigation callbacks directly from the NavHost to the screen.

```kotlin
// entryProvider setup
entryProvider {
    entry<SnapshotListRoute> { key ->
        SnapshotListScreen(
            onNavigateToDetail = { id -> backStack.add(SnapshotDetailRoute(id)) }
        )
    }
}

// Screen -- direct callback, no ViewModel involvement
SnapshotItem(
    onClick = { onNavigateToDetail(snapshot.id) }
)
```

### 5. App-Level Navigation Setup

```kotlin
@Composable
fun App() {
    val backStack = rememberNavBackStack(HomeRoute)
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        entryProvider = entryProvider {
            entry<AuthRoute> { key -> AuthScreen(/* ... */) }
            entry<HomeRoute> { key -> HomeScreen(/* ... */) }
            entry<SnapshotListRoute> { key -> SnapshotListScreen(/* ... */) }
        }
    )
}
```

---

## Platform-Specific Navigation

### Compose (Android + Desktop)

Android and Desktop share the same Navigation3 graph defined in `commonMain`. Both platforms use `NavDisplay` with `entryProvider`.

### SwiftUI (iOS / macOS)

iOS and macOS use native SwiftUI `NavigationStack` -- they do NOT use Navigation3. Shared KMP ViewModels provide the business logic; SwiftUI handles the navigation presentation.

```swift
// iOS/macOS: Native NavigationStack with shared KMP ViewModel
struct ContentView: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            HomeView(viewModel: KoinHelper.shared.homeViewModel())
                .navigationDestination(for: SnapshotRoute.self) { route in
                    SnapshotDetailView(
                        viewModel: KoinHelper.shared.snapshotDetailViewModel(id: route.id)
                    )
                }
        }
    }
}
```

**Key insight:** KMP ViewModels are shared via XCFramework. Only the navigation host and UI rendering are platform-native.

---

## Anti-Patterns Summary

| Anti-Pattern | Why It Fails | Correct Approach |
|---|---|---|
| Channel-based navigation | Buffers events, stale navigation after config changes | State-driven navigation |
| Hardcoded route strings | Typos, no compile-time safety, no argument validation | `@Serializable` route types |
| Navigation3 on iOS/macOS | Not supported; forces non-native UX | SwiftUI NavigationStack |
| Routes in `-impl` modules | Creates circular dependencies between features | Routes in `-api` modules |

---

## Related Patterns

- [ViewModel Navigation](../ui/viewmodel-navigation.md) -- State-driven navigation and Channel anti-pattern detail
- [UI Screen Patterns](../ui/ui-screen-patterns.md) -- Screen/Content split, navigation patterns
- [KMP Architecture](../architecture/kmp-architecture.md) -- Source set hierarchy, expect/actual for platform-specific code

---

## References

- [Nav3 Recipes](https://github.com/android/nav3-recipes) -- Official Navigation3 sample patterns
- [Androidify Sample](https://github.com/nicholasjackson/androidify) -- Navigation3 in a full app
- [Now in Android](https://github.com/android/nowinandroid) -- Architecture reference

---

**Status**: Active -- All KMP projects must use these navigation patterns.
**Last Validated**: March 2026 with Navigation3 / Compose Multiplatform 1.10.0
