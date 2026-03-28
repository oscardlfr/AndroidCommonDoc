---
name: validate-patterns
description: "Validate code against pattern standards (ViewModel, UI, coroutines, DI, error handling, navigation). Use when asked to check code quality or pattern compliance."
allowed-tools: [Read, Grep, Glob]
copilot: true
copilot-template-type: behavioral
---

## Usage Examples

```
/validate-patterns HomeViewModel.kt
/validate-patterns feature:devices --strict
/validate-patterns core:domain --fix
/validate-patterns --category di
/validate-patterns --category error-handling
/validate-patterns --all
```

## Parameters

Uses parameters from `params.json`:
- `module-path` -- File path or module to validate (e.g., `MyViewModel.kt`, `feature:home`).
- `strict-mode` -- Fail on warnings in addition to errors.
- `project-root` -- Path to the project root directory.

Additional skill-specific arguments (not in params.json):
- `--fix` -- Suggest or apply fixes for violations.
- `--category <name>` -- Run only a specific check category (viewmodel, ui, di, error-handling, navigation, testing, coroutines).
- `--all` -- Run all categories (default when no category specified).

## Behavior

### Category 1: ViewModel Patterns (viewmodel-state-patterns.md)
- ViewModel has no platform dependencies (`Context`, `Resources`, UIKit).
- UiState uses `sealed interface` (not Boolean flags or data class with boolean fields).
- StateFlow uses `stateIn(WhileSubscribed(5_000))`.
- `CancellationException` is never swallowed in catch blocks.
- Uses `MutableSharedFlow(replay = 0)` for ephemeral events (not `Channel`).
- Injects `testDispatcher` into UseCases for testability.

### Category 2: UI/Compose Patterns (ui-screen-patterns.md)
- Separates Screen Composable (orchestration) from Content Composable (presentation).
- Uses semantic components (`PrimaryButton`, `StateLayout`).
- Callback-based or state-driven navigation (not Channel).
- Accessibility: headings marked, touch targets >= 48dp, content descriptions present.
- Preview annotations with light/dark, RTL, font scale variants.

### Category 3: DI Patterns (di-hub.md, koin)
- Koin `module {}` declarations use `single {}`, `factory {}`, not `get()` inside definitions.
- No `GlobalContext.get()` in production code — inject via constructor.
- Test modules use `koinTestModule {}` or `checkModules {}` for validation.
- No circular dependencies between module declarations.
- Platform-specific modules use `expect/actual` pattern, not runtime platform checks.

### Category 4: Error Handling (error-handling-patterns.md)
- Uses `com.example.shared.core.result.Result<T>` for all fallible operations.
- `DomainException` hierarchy is sealed — no catch-all `Exception` types.
- `CancellationException` always rethrown in catch blocks — NEVER swallowed.
- No `try/catch(Exception)` without explicit CancellationException check.
- Error messages include operation context (what was attempted, not just what failed).
- Repository operations return `Result<T>`, not throw — callers decide error handling.

### Category 5: Navigation Patterns (viewmodel-navigation.md)
- State-driven navigation: ViewModel exposes navigation state, UI observes.
- No `Channel<NavigationEvent>` — use `MutableSharedFlow(replay = 0)` or state-based.
- Deep links handled via sealed `Route` types with typed arguments.
- Navigation events consumed via `onEventConsumed` pattern (nullable field + callback).
- No direct `navController` references in ViewModels.

### Category 6: Testing Patterns (testing-patterns.md)
- Tests use `runTest {}` for coroutine testing (not `runBlocking`).
- `StandardTestDispatcher` injected (not `Dispatchers.Default` or `UnconfinedTestDispatcher`).
- Fakes over mocks — pure-Kotlin fakes implementing interfaces.
- Test naming: `function_condition_expectedResult` or descriptive backtick names.
- No `Thread.sleep()` or `delay()` in tests — use `advanceUntilIdle()`.
- Assertions on StateFlow via `turbine` or `.value` — no `collect {}` with timeouts.

### Category 7: Coroutine Patterns
- `Dispatchers.IO` for blocking I/O, `Dispatchers.Default` for CPU work — never hardcoded in UseCases.
- Inject dispatchers via constructor parameter (`coroutineDispatcher: CoroutineDispatcher`).
- No `GlobalScope` — use structured concurrency with `viewModelScope` or injected scope.
- `withContext(dispatcher)` for switching — not nested `launch {}`.
- `supervisorScope` when child failures should not cancel siblings.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

1. Read the target file(s) using `Read` tool.
2. For each applicable category, scan for violations using `Grep`.
3. Cross-reference against the corresponding pattern doc in `docs/`.
4. Report findings with severity (ERROR/WARNING), line numbers, and suggested fixes.

When `--category` is specified, run only that category. Otherwise run all 7.

## Expected Output

```
Validating: HomeViewModel.kt (categories: all)

ERRORS (must fix):
  [viewmodel] Line 45: CancellationException being swallowed
       Pattern: catch (e: Exception) { ... }
       Fix: Add `if (e is CancellationException) throw e`

  [navigation] Line 78: Using Channel for navigation events
       Pattern: private val _navEvents = Channel<NavEvent>()
       Fix: Use nullable StateFlow field + onEventConsumed

WARNINGS (consider fixing):
  [ui] Line 23: UiState uses Boolean flags instead of sealed interface
       Fix: Convert to sealed interface with Loading, Error, Success subtypes

  [error-handling] Line 92: Catching Exception without CancellationException check
       Fix: Use runCatchingCancellable or add explicit rethrow

PASSED:
  [di] No GlobalContext.get() calls found
  [testing] All tests use runTest
  [coroutines] No GlobalScope usage

Summary: 2 errors, 2 warnings, 3 passed (7 categories)
```

## Cross-References

- Pattern docs: `docs/viewmodel-state-patterns.md`, `docs/ui-screen-patterns.md`, `docs/error-handling-patterns.md`, `docs/testing-patterns.md`
- Hub docs: `docs/di/di-hub.md`, `docs/navigation/navigation-hub.md`
- Script: Uses agent built-in tools (Read, Grep) -- no external script
- Related: `/verify-kmp` (architecture validation), `/pre-pr` (pre-merge gate)
