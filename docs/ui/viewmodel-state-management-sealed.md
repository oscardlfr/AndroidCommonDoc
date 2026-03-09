---
scope: [viewmodel, state, sealed-interface, uistate]
sources: [lifecycle-viewmodel, kotlinx-coroutines]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 1388
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "Sealed interface UiState modeling, BaseUiState contract, UiText, ViewModel boundaries, error handling, UseCase execution"
slug: viewmodel-state-management-sealed
status: active
layer: L0
parent: viewmodel-state-management
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

---

# ViewModel State: Sealed Interface and UiState Modeling

## Overview

UiState modeling patterns using sealed interfaces, the BaseUiState contract, UiText for platform-agnostic strings, ViewModel boundary rules, error handling with CancellationException, and UseCase execution patterns.

---

## 1. ViewModel Boundaries

### No Platform Dependencies

ViewModels must **never** depend on:
- `android.content.Context`
- `android.content.res.Resources`
- iOS `UIKit` classes

**DON'T (Anti-pattern):**
```kotlin
// BAD: Platform dependency makes ViewModel untestable and non-shareable across KMP targets
class MyViewModel(private val context: Context) : ViewModel()
```

**DO (Correct):**
```kotlin
class MyViewModel(
    private val repository: MyRepository,
    private val useCaseRunner: UseCaseRunner
) : ViewModel()
```

**Key insight:** If your ViewModel constructor has `Context`, `Resources`, or any `android.*` import, it cannot be shared across KMP targets.

### Use UiText for User-Facing Strings

ViewModels emit `UiText` instead of raw strings. The UI layer resolves `UiText` to a platform string.

```kotlin
// In commonMain for KMP
sealed interface UiText {
    data class StringResource(val key: String, val args: List<Any> = emptyList()) : UiText
    data class DynamicString(val value: String) : UiText
    data class Composite(val parts: List<UiText>) : UiText
}

// Usage in ViewModel
_uiState.value = MyUiState.Error(
    message = UiText.StringResource("error_network")
)

// Resolution in Compose
@Composable
fun UiText.asString(): String = when (this) {
    is UiText.DynamicString -> value
    is UiText.StringResource -> stringResource(Res.string.getByName(key), *args.toTypedArray())
    is UiText.Composite -> parts.joinToString("") { it.asString() }
}
```

---

## 2. UiState Modeling

### Sealed Interface

Model UI state as a `sealed interface` with distinct subtypes for each logical state.

**DO (Correct):**
```kotlin
sealed interface SnapshotListUiState {
    data object Loading : SnapshotListUiState
    data class Success(val snapshots: List<Snapshot>) : SnapshotListUiState
    data class Error(val message: UiText) : SnapshotListUiState
}
```

**DON'T (Anti-pattern):**
```kotlin
// BAD: Data class with boolean flags allows invalid states (isLoading=true AND error!=null)
data class SnapshotListUiState(
    val snapshots: List<Snapshot> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)
```

**Key insight:** Sealed interfaces make invalid states unrepresentable at compile time.

### BaseUiState Contract (Optional)

```kotlin
sealed interface BaseUiState<out T> {
    interface Loading : BaseUiState<Nothing>
    interface Success<T> : BaseUiState<T> { val data: T }
    interface Error : BaseUiState<Nothing> { val message: UiText }
}

sealed interface SnapshotListUiState : BaseUiState<List<Snapshot>> {
    data object Loading : SnapshotListUiState, BaseUiState.Loading
    data class Success(override val data: List<Snapshot>) : SnapshotListUiState, BaseUiState.Success<List<Snapshot>>
    data class Error(override val message: UiText) : SnapshotListUiState, BaseUiState.Error
}
```

---

## 3. Error Handling

### Always Rethrow CancellationException

```kotlin
viewModelScope.launch {
    try {
        repository.save(data)
    } catch (e: CancellationException) {
        throw e // ALWAYS rethrow
    } catch (e: Exception) {
        _uiState.value = MyUiState.Error(UiText.DynamicString(e.message ?: "Error"))
    }
}
```

### Centralized Error Mapping

```kotlin
object DomainExceptionMapper {
    fun toUiText(exception: Throwable?): UiText = when (exception) {
        is NetworkException -> UiText.StringResource("error_network")
        is AuthException -> UiText.StringResource("error_auth")
        else -> UiText.DynamicString(exception?.message ?: "Unknown error")
    }
}
```

---

## 4. UseCase Execution

### UseCase Base Class

```kotlin
abstract class UseCase<in P, R>(private val dispatcher: CoroutineDispatcher) {
    suspend operator fun invoke(params: P): Result<R> =
        withContext(dispatcher) {
            try {
                execute(params)
            } catch (e: CancellationException) {
                throw e  // ALWAYS rethrow -- swallowing breaks structured concurrency
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    protected abstract suspend fun execute(params: P): Result<R>
}
```

> **Warning**: Never use a bare `catch (e: Exception)` without first catching `CancellationException`. Swallowing `CancellationException` breaks structured concurrency -- coroutine cancellation silently fails, leading to leaked work.

### UseCaseRunner for Traceability

```kotlin
useCaseRunner.runInUserFlow(flowId) {
    val result = run(authenticateUseCase, AuthParams(email, password))
}
```

---

Parent doc: [viewmodel-state-management.md](viewmodel-state-management.md)
