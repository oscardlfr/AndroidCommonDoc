---
scope: [error-handling, viewmodel, ui, compose]
sources: [core-error, compose-runtime, lifecycle-viewmodel]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: error-handling-hub
token_budget: 975
description: "UI error patterns: ViewModel error states, UiText error messages, Compose error handling, testing error flows"
slug: error-handling-ui
status: active
layer: L0
parent: error-handling-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
category: error-handling
rules:
  - id: cancellation-exception-rethrow
    type: required-rethrow
    message: "CancellationException must always be rethrown in catch blocks"
    detect:
      catch_type: CancellationException
      required_action: rethrow
    hand_written: true
    source_rule: CancellationExceptionRethrowRule.kt
  - id: sealed-ui-state
    type: prefer-construct
    message: "UiState error state must be part of sealed interface, not boolean flag"
    detect:
      class_suffix: UiState
      must_be: sealed
    hand_written: true
    source_rule: SealedUiStateRule.kt

---

# UI Error Handling Patterns

## Overview

Patterns for presenting errors in the UI layer: mapping DomainException to UiText in ViewModels, sealed UiState.Error variants, Compose error screens, and testing error flows.

**Core Principle**: Never expose raw exception messages to users. Map errors to `UiText` at the ViewModel layer and display user-friendly messages in the UI.

---

## 1. ViewModel Layer Mapping

```kotlin
// In ViewModel: map DomainException to user-friendly UiText
private fun DomainException.toUiMessage(): UiText = when (this) {
    is DomainException.NetworkUnavailable ->
        UiText.StringResource(Res.string.error_no_connection)
    is DomainException.NotFound ->
        UiText.StringResource(Res.string.error_not_found, entity)
    is DomainException.Unauthorized ->
        UiText.StringResource(Res.string.error_auth_required)
    is DomainException.ServerError ->
        UiText.StringResource(Res.string.error_server, code)
    is DomainException.ValidationFailed ->
        UiText.DynamicString(reason)
    else ->
        UiText.StringResource(Res.string.error_generic)
}
```

---

## 2. Error States in UiState

### Sealed Interface Pattern

Every UiState sealed interface must include an Error variant:

```kotlin
sealed interface SettingsUiState {
    data object Loading : SettingsUiState
    data class Success(val settings: Settings) : SettingsUiState
    data class Error(val message: UiText) : SettingsUiState
}
```

### Handling in ViewModel

```kotlin
class SettingsViewModel(
    private val getSettings: GetSettingsUseCase
) : ViewModel() {

    val uiState: StateFlow<SettingsUiState> = flow {
        getSettings()
            .onSuccess { emit(SettingsUiState.Success(it)) }
            .onFailure { error ->
                val message = when (error) {
                    is DomainException -> error.toUiMessage()
                    else -> UiText.StringResource(Res.string.error_generic)
                }
                emit(SettingsUiState.Error(message))
            }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = SettingsUiState.Loading,
    )
}
```

---

## 3. Handling in Compose UI

```kotlin
@Composable
fun SettingsScreen(viewModel: SettingsViewModel = koinViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    when (val state = uiState) {
        is SettingsUiState.Loading -> LoadingIndicator()
        is SettingsUiState.Success -> SettingsContent(state.settings)
        is SettingsUiState.Error -> ErrorScreen(
            message = state.message.asString(),
            onRetry = { viewModel.retry() }
        )
    }
}
```

---

## 4. Testing Error States

### Testing ViewModel Error States

```kotlin
@Test
fun `uiState emits Error when use case fails`() = runTest {
    val fakeUseCase = FakeGetSettingsUseCase(
        result = Result.failure(DomainException.NetworkUnavailable())
    )
    val viewModel = SettingsViewModel(fakeUseCase)

    val states = mutableListOf<SettingsUiState>()
    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        viewModel.uiState.collect { states.add(it) }
    }

    assertThat(states.last()).isInstanceOf(SettingsUiState.Error::class.java)
}
```

---

**Parent doc**: [error-handling-patterns.md](error-handling-patterns.md)
