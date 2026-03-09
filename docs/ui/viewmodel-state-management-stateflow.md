---
scope: [viewmodel, state, stateflow, ios-integration]
sources: [lifecycle-viewmodel, kotlinx-coroutines, compose-runtime]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 1427
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "StateFlow exposure patterns: stateIn with WhileSubscribed, MutableStateFlow, injectable viewModelScope, iOS integration via SKIE and KMP-NativeCoroutines"
slug: viewmodel-state-management-stateflow
status: active
layer: L0
parent: viewmodel-state-management
category: ui
rules:
  - id: while-subscribed-timeout
    type: prefer-construct
    message: "Use stateIn(WhileSubscribed(5_000)) not WhileSubscribed() without timeout"
    detect:
      method_call: stateIn
      prefer_arg: "WhileSubscribed(5000)"
    hand_written: true
    source_rule: WhileSubscribedTimeoutRule.kt
  - id: mutable-state-flow-exposed
    type: banned-usage
    message: "MutableStateFlow must not be exposed as public property — expose as StateFlow via asStateFlow()"
    detect:
      in_class_extending: ViewModel
      banned_initializer: "MutableStateFlow("
      banned_type_prefix: "MutableStateFlow"
      require_private: true
    hand_written: true
    source_rule: MutableStateFlowExposedRule.kt

---

# ViewModel State: StateFlow Exposure and iOS Integration

## Overview

Patterns for exposing ViewModel state as StateFlow, including the standard `stateIn` pattern, MutableStateFlow for imperative updates, injectable viewModelScope, and bridging Kotlin StateFlow to Swift concurrency for iOS/macOS integration.

---

## 1. StateFlow Exposure

### Standard Pattern

Expose state as `StateFlow` using `stateIn`:

```kotlin
class SnapshotListViewModel(
    private val repository: SnapshotRepository
) : ViewModel() {

    val uiState: StateFlow<SnapshotListUiState> =
        repository.getSnapshots()
            .asResult()
            .map { result ->
                when (result) {
                    is Result.Loading -> SnapshotListUiState.Loading
                    is Result.Success -> SnapshotListUiState.Success(result.data)
                    is Result.Error -> SnapshotListUiState.Error(
                        message = UiText.DynamicString(result.exception.message ?: "Unknown error")
                    )
                }
            }
            .stateIn(
                scope = viewModelScope,
                started = SharingStarted.WhileSubscribed(5_000),
                initialValue = SnapshotListUiState.Loading
            )
}
```

### Injectable viewModelScope (Lifecycle 2.8.0+)

Since `androidx.lifecycle:lifecycle-viewmodel` 2.8.0, `viewModelScope` is a constructor parameter with a default value. You can inject a custom scope for testing without `Dispatchers.setMain`:

```kotlin
class MyViewModel(
    private val repository: MyRepository,
    // Injectable for testing -- defaults to standard viewModelScope
) : ViewModel() {
    // viewModelScope is already injectable via ViewModel constructor since 2.8.0
    // For KMP: lifecycle-viewmodel-compose 2.8.0+ supports all targets
}
```

> **Note**: While this is available, the `Dispatchers.setMain` + `StandardTestDispatcher` approach documented in [viewmodel-events.md](viewmodel-events.md) remains the recommended testing pattern for most cases. The injectable scope is useful when you need fine-grained control over the ViewModel's coroutine context.

### MutableStateFlow for Imperative Updates

When state changes are triggered by user actions:

```kotlin
private val _uiState = MutableStateFlow<AuthUiState>(AuthUiState.Idle())
val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

fun login(email: String, password: String) {
    val flowId = _uiState.value.flowId
    _uiState.value = AuthUiState.Loading(flowId)
    viewModelScope.launch { /* ... */ }
}
```

---

## 2. iOS Integration (KMP)

Collecting Kotlin `StateFlow` from Swift requires bridging Kotlin coroutines to Swift concurrency. Two established tools handle this:

### SKIE (Recommended)

[SKIE](https://skie.touchlab.co/) (by Touchlab) generates Swift-friendly wrappers automatically at compile time. Kotlin `StateFlow` becomes a Swift `AsyncSequence` with no manual wrapper code:

```swift
// With SKIE -- no wrapper needed, direct collection via Swift async/await
@MainActor
class SnapshotListScreen: ObservableObject {
    private let viewModel = SnapshotListViewModel()
    @Published var uiState: SnapshotListUiState = .loading

    func observe() async {
        for await state in viewModel.uiState {
            self.uiState = state
        }
    }
}
```

### KMP-NativeCoroutines (Alternative)

[KMP-NativeCoroutines](https://github.com/nicklockwood/KMP-NativeCoroutines) uses a KSP plugin to generate Swift-compatible `AsyncSequence` wrappers:

```swift
import KMPNativeCoroutinesAsync

@MainActor
class SnapshotListViewModelWrapper: ObservableObject {
    private let viewModel = SnapshotListViewModel()
    @Published var uiState: SnapshotListUiStateWrapper = .loading

    func observe() async {
        do {
            let stream = asyncSequence(for: viewModel.uiStateFlow)
            for try await state in stream {
                self.uiState = SnapshotListUiStateWrapper.from(state)
            }
        } catch {
            // Handle error
        }
    }
}
```

### Manual Wrapper (Not Recommended)

Manual wrappers using `viewModel.uiState.collect {}` from Kotlin are fragile -- they don't integrate with Swift structured concurrency and require careful lifecycle management. Prefer SKIE or KMP-NativeCoroutines.

### Swift State Wrapper

When not using SKIE (which maps types directly), map Kotlin sealed types to Swift enums:

```swift
enum SnapshotListUiStateWrapper {
    case loading
    case success(snapshots: [Snapshot])
    case error(message: String)

    static func from(_ kotlinState: SnapshotListUiState) -> Self {
        switch kotlinState {
        case is SnapshotListUiState.Loading: return .loading
        case let success as SnapshotListUiState.Success: return .success(snapshots: success.snapshots)
        case let error as SnapshotListUiState.Error: return .error(message: error.message.asPlainText())
        default: return .loading
        }
    }
}
```

---

Parent doc: [viewmodel-state-management.md](viewmodel-state-management.md)
