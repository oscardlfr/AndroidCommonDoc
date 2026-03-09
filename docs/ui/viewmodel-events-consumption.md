---
scope: [viewmodel, events, testing]
sources: [lifecycle-viewmodel, kotlinx-coroutines]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: ui-hub
token_budget: 2164
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/lifecycle"
    type: doc-page
    tier: 2
description: "State-based event consumption: implementation details, why not Channel or SharedFlow, multiple event fields, testing ViewModel events"
slug: viewmodel-events-consumption
status: active
layer: L0
parent: viewmodel-events
category: ui
rules:
  - id: no-channel-for-ui-events
    type: banned-usage
    message: "Use MutableSharedFlow(replay=0) for ephemeral events, never Channel"
    detect:
      in_class_extending: ViewModel
      banned_type: Channel
      prefer: "MutableSharedFlow(replay=0)"
    hand_written: true
    source_rule: NoChannelForUiEventsRule.kt

---

# ViewModel Events: Consumption Patterns and Testing

## Overview

Detailed implementation of state-based event consumption, comparison with Channel and SharedFlow approaches, handling multiple independent event types, and comprehensive testing patterns for ViewModel events.

---

## 1. State-Based Events Implementation

```kotlin
// UiState with event field
sealed interface MyUiState {
    data object Loading : MyUiState
    data class Ready(
        val items: List<Item>,
        val userMessage: UiText? = null  // nullable = no event pending
    ) : MyUiState
}

// ViewModel -- set and clear events
class MyViewModel(
    private val deleteItemUseCase: DeleteItemUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow<MyUiState>(MyUiState.Loading)
    val uiState: StateFlow<MyUiState> = _uiState.asStateFlow()

    fun onItemDeleted(id: String) {
        viewModelScope.launch {
            try {
                deleteItemUseCase(id)
                _uiState.update { currentState ->
                    when (currentState) {
                        is MyUiState.Ready -> currentState.copy(
                            items = currentState.items.filter { it.id != id },
                            userMessage = UiText.StringResource("item_deleted")
                        )
                        else -> currentState
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update { currentState ->
                    when (currentState) {
                        is MyUiState.Ready -> currentState.copy(
                            userMessage = UiText.StringResource("error_delete_failed")
                        )
                        else -> currentState
                    }
                }
            }
        }
    }

    fun onUserMessageShown() {
        _uiState.update { currentState ->
            when (currentState) {
                is MyUiState.Ready -> currentState.copy(userMessage = null)
                else -> currentState
            }
        }
    }
}

// Composable -- consume event via LaunchedEffect
@Composable
fun MyScreen(viewModel: MyViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    when (val state = uiState) {
        is MyUiState.Loading -> LoadingIndicator()
        is MyUiState.Ready -> {
            ItemList(state.items)

            state.userMessage?.let { message ->
                LaunchedEffect(message) {
                    snackbarHostState.showSnackbar(message.asString())
                    viewModel.onUserMessageShown()
                }
            }
        }
    }
}
```

---

## 2. Why State-Based Events

### Why NOT Channel

`Channel` buffers events until consumed. This causes problems:

| Scenario | Channel Behavior | State-Based Behavior |
|----------|------------------|---------------------|
| Config change during event | Event may be lost or duplicated | Event survives (it's state) |
| User backgrounds app | Event waits in buffer, shows stale later | Event persists, shown on return (intentional) |
| Multiple collectors | Only one receives the event | All observers see the state |
| Semantics | "Task that must complete" | "State that includes a pending notification" |

### Why NOT MutableSharedFlow

`MutableSharedFlow` with `replay = 0` drops events when no collector is active:

| Scenario | SharedFlow (replay=0) Behavior | State-Based Behavior |
|----------|-------------------------------|---------------------|
| Config change during event | Event lost (no collector during recomposition) | Event survives in state |
| Rapid successive events | Later events may be dropped | Latest event always visible |
| Delivery guarantee | None -- fire and forget | Guaranteed -- event persists until consumed |

**Key insight**: Google's current guidance (2024+) recommends modeling events as state. The "fire and forget" philosophy of SharedFlow means events can be silently lost during configuration changes, which leads to poor UX.

---

## 3. Multiple Event Fields

When a screen has several independent event types, use multiple nullable fields:

```kotlin
sealed interface SettingsUiState {
    data class Ready(
        val settings: Settings,
        val snackbarMessage: UiText? = null,
        val confirmDialog: ConfirmDialogData? = null
    ) : SettingsUiState
}

data class ConfirmDialogData(
    val title: UiText,
    val message: UiText,
    val onConfirmAction: ConfirmAction
)

enum class ConfirmAction { DELETE_ACCOUNT, RESET_SETTINGS }

// ViewModel
fun onSnackbarShown() {
    _uiState.update { (it as? SettingsUiState.Ready)?.copy(snackbarMessage = null) ?: it }
}

fun onDialogDismissed() {
    _uiState.update { (it as? SettingsUiState.Ready)?.copy(confirmDialog = null) ?: it }
}
```

---

## 4. Testing ViewModel Events

### Test Dispatcher Setup

```kotlin
@OptIn(ExperimentalCoroutinesApi::class)
class MyViewModelTest {
    private val testDispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setup() { Dispatchers.setMain(testDispatcher) }

    @AfterTest
    fun tearDown() { Dispatchers.resetMain() }
}
```

### StandardTestDispatcher vs UnconfinedTestDispatcher

| Dispatcher | `delay()` Behavior | When to Use |
|------------|-------------------|-------------|
| `StandardTestDispatcher` | Advances virtual time (controlled) | ViewModels with loops, playback, timers |
| `UnconfinedTestDispatcher` | Returns immediately (no wait) | Simple tests without timing concerns |

**CRITICAL: UnconfinedTestDispatcher + delay() loops = INFINITE LOOP**

**Rule**: If your ViewModel has `while` loops with `delay()`, you MUST use `StandardTestDispatcher`.

### Testing State-Based Events

Since events are just state fields, testing is straightforward -- assert on `.value`:

```kotlin
@Test
fun `delete item shows success message`() = runTest(testDispatcher) {
    val viewModel = createViewModel(repository = FakeRepository(items))

    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        viewModel.uiState.collect()
    }
    advanceUntilIdle()

    viewModel.onItemDeleted("item-1")
    advanceUntilIdle()

    val state = viewModel.uiState.value
    assertTrue(state is MyUiState.Ready)
    assertNotNull((state as MyUiState.Ready).userMessage)
}

@Test
fun `event cleared after consumption`() = runTest(testDispatcher) {
    val viewModel = createViewModel(repository = FakeRepository(items))

    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        viewModel.uiState.collect()
    }
    advanceUntilIdle()

    viewModel.onItemDeleted("item-1")
    advanceUntilIdle()
    viewModel.onUserMessageShown()

    val state = viewModel.uiState.value as MyUiState.Ready
    assertNull(state.userMessage)
}
```

### Inject testDispatcher into UseCases

**DO:**
```kotlin
private fun createViewModel(repository: FakeRepository): MyViewModel {
    return MyViewModel(
        deleteItemUseCase = DeleteItemUseCase(repository, testDispatcher),
    )
}
```

**DON'T:**
```kotlin
// BAD: UseCase runs on real background thread, not controlled by test
private fun createViewModel(repository: FakeRepository): MyViewModel {
    return MyViewModel(
        deleteItemUseCase = DeleteItemUseCase(repository, Dispatchers.Default),
    )
}
```

### Test Checklist

- [ ] Use `StandardTestDispatcher` for ViewModels with `delay()` loops
- [ ] Inject `testDispatcher` into all UseCases (not `Dispatchers.Default`)
- [ ] Call `runTest(testDispatcher)` to share the test scheduler
- [ ] Subscribe to `StateFlow` before actions
- [ ] Use `advanceUntilIdle()` after async operations
- [ ] Assert on `.value` directly -- events are just nullable state fields
- [ ] Test event consumption by calling `onEventConsumed()` and asserting null
- [ ] Verify `CancellationException` is not swallowed

---

Parent doc: [viewmodel-events.md](viewmodel-events.md)
