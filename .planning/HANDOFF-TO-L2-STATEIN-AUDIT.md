# Handoff: DawSync stateIn Audit Findings

> **Source session**: L0 testing pattern clarity (2026-04-04)
> **Target**: DawSync L2 team
> **Reference doc**: `docs/testing/testing-patterns-dispatcher-scopes.md`

## Summary

L0 session audited DawSync's ViewModel and infrastructure coroutine patterns against official sources (nowinandroid, androidify, kotlinx-coroutines-test Context7 docs). Findings below.

## ViewModels: Already Correct

DawSync ViewModels use `combine() + stateIn(WhileSubscribed(5_000))` — the official pattern. No changes needed.

- No `init { launch {} }` blocks in ViewModels
- `stateIn` activates flows lazily on subscription
- Tests should use Path A (see below)

## Infrastructure: Justified startObserving() Classes

These classes legitimately use `startObserving()` for side-effect management. This is NOT the ViewModel pattern — it is the infrastructure pattern for state machines, sync orchestration, and platform bridges.

| Class | File | Justification |
|-------|------|---------------|
| PluginNudgeController | desktopApp/.../PluginNudgeController.kt | Timer-based nudge with conditional cancellation |
| SyncManagerImpl | core/data/.../sync/SyncManagerImpl.kt | Sync orchestration with side effects |
| DesktopSyncStatusIndicator | core/media-session/.../DesktopSyncStatusIndicator.kt | Platform bridge: Flow to native tray icon |
| MacOSSyncStatusIndicator | core/media-session/.../MacOSSyncStatusIndicator.kt | Platform bridge: Flow to native status bar |
| IOSSyncStatusIndicator | core/media-session/.../IOSSyncStatusIndicator.kt | Platform bridge: Flow to native UI |
| AndroidSyncStatusIndicator | core/media-session/.../AndroidSyncStatusIndicator.kt | Platform bridge: Flow to notification |

## 2 Potentially Refactorable

If any `startObserving()` call exists solely for logging (no state mutation, no side effects), it can be refactored to `.onEach { log(it) }.stateIn()` — eliminating the need for `startObserving()` and simplifying tests. DawSync team should audit for this.

## Testing Patterns

### Path A — ViewModel Tests (stateIn + WhileSubscribed)

```kotlin
@Test
fun `emits correct state`() = runTest {
    val viewModel = MyViewModel(
        useCase = fakeUseCase,
        ioDispatcher = UnconfinedTestDispatcher(testScheduler),
        defaultDispatcher = UnconfinedTestDispatcher(testScheduler)
    )

    val states = mutableListOf<UiState>()
    backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
        viewModel.uiState.toList(states)
    }

    assertEquals(UiState.Loading, states.first())
}
```

### Path B — Infrastructure Tests (startObserving)

```kotlin
@Test
fun `observes sync state changes`() = runTest {
    val controller = PluginNudgeController(
        scope = backgroundScope,
        syncStateFlow = fakeSyncState
    )

    controller.startObserving()
    advanceUntilIdle()

    fakeSyncState.value = SyncState.Syncing
    advanceUntilIdle()

    assertEquals(expected, controller.nudgeState.value)
}
```

## Action Items for DawSync Team

1. No ViewModel changes needed — already following official pattern
2. Review SyncStatusIndicator tests — ensure they use Path B
3. Audit for logging-only startObserving() — refactor to .onEach().stateIn()
4. Add L0 Detekt rules when available (NoUnconfinedTestDispatcherForClassScope, RequireAdvanceUntilIdleAfterStartObserving)
5. Write missing infrastructure tests for SyncStatusIndicator using Path B
6. All TestDispatchers in a test MUST share a single testScheduler

## References

- L0 sub-doc: docs/testing/testing-patterns-dispatcher-scopes.md
- Official sources: nowinandroid MainDispatcherRule, kotlinx-coroutines-test docs (via Context7)
