---
applyTo: "**/*Test.kt"
---

# Test Instructions

## Coroutine Tests

Always wrap coroutine tests in `runTest`. Never use `runBlocking` in tests.

```kotlin
@Test
fun `should load items`() = runTest {
    // arrange, act, assert
}
```

## Dispatcher Selection

- Use `StandardTestDispatcher` for ViewModels with `delay` loops or scheduled work. Call `advanceUntilIdle()` to flush pending coroutines.
- Use `UnconfinedTestDispatcher` when subscribing to `StateFlow` in `backgroundScope` — it ensures the collector is active immediately.

```kotlin
backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
    viewModel.uiState.toList(emissions)
}
```

## StateFlow Subscription

Always subscribe to `StateFlow` BEFORE triggering the action under test. Otherwise intermediate emissions are lost.

## Fakes Over Mocks

Prefer pure-Kotlin fakes (`FakeRepository`, `FakeClock`, `FakeDataSource`) over mocking libraries. Fakes are explicit, refactor-safe, and work across all KMP targets.

## Dispatcher Injection

Inject `testDispatcher` into UseCases and repositories. Never rely on `Dispatchers.Default` or `Dispatchers.IO` in tests.

```kotlin
val useCase = GetItemsUseCase(fakeRepository, testDispatcher)
```

## CancellationException

Always rethrow `CancellationException` in fake implementations, just like production code:

```kotlin
catch (e: Exception) {
    if (e is CancellationException) throw e
    Result.Error(e)
}
```

## Assertions

Use `advanceUntilIdle()` before asserting on state that depends on coroutine completion. For time-dependent tests, use `advanceTimeBy()` and `runCurrent()`.
