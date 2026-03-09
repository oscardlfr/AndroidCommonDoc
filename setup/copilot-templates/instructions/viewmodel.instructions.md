---
applyTo: "**/*ViewModel.kt"
---

# ViewModel Instructions

## UiState

Always define UiState as a sealed interface. Never use a single data class with boolean flags.

```kotlin
sealed interface UiState {
    data object Loading : UiState
    data class Success(val items: List<Item>) : UiState
    data class Error(val message: UiText) : UiState
}
```

## State Exposure

Expose state via `StateFlow` using `stateIn`:

```kotlin
val uiState: StateFlow<UiState> = combine(...)
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState.Loading)
```

Never expose `MutableStateFlow` directly.

## Events

Use `MutableSharedFlow` for one-shot UI events (snackbars, toasts). Never use `Channel`.

```kotlin
private val _events = MutableSharedFlow<UiEvent>()
val events: SharedFlow<UiEvent> = _events.asSharedFlow()
```

## Platform Independence

No platform dependencies in ViewModels. Never import `Context`, `Resources`, `Activity`, or `UIKit` types.

Use `UiText` for all user-facing strings:
- `UiText.StringResource(R.string.error_network)` for localized strings
- `UiText.DynamicString(message)` for dynamic content

## Error Handling

Always rethrow `CancellationException`:

```kotlin
catch (e: Exception) {
    if (e is CancellationException) throw e
    _uiState.value = UiState.Error(e.toUiText())
}
```

## Navigation

Drive navigation via state, not events. Use a navigation state field or callback, never a Channel.
