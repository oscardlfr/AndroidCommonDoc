---
name: validate-patterns
description: "Validate code against pattern standards (ViewModel, UI, coroutines). Use when asked to check code quality or pattern compliance."
allowed-tools: [Read, Grep, Glob]
---

## Usage Examples

```
/validate-patterns HomeViewModel.kt
/validate-patterns feature:devices --strict
/validate-patterns core:domain --fix
```

## Parameters

Uses parameters from `params.json`:
- `module-path` -- File path or module to validate (e.g., `MyViewModel.kt`, `feature:home`).
- `strict-mode` -- Fail on warnings in addition to errors.
- `project-root` -- Path to the project root directory.

Additional skill-specific arguments (not in params.json):
- `--fix` -- Suggest or apply fixes for violations.

## Behavior

1. Read the target file(s) or discover files in the target module.
2. Check against `viewmodel-state-patterns.md`:
   - ViewModel has no platform dependencies (`Context`, `Resources`, UIKit).
   - UiState uses `sealed interface` (not Boolean flags).
   - StateFlow uses `stateIn(WhileSubscribed(5_000))`.
   - `CancellationException` is never swallowed in catch blocks.
   - Uses `MutableSharedFlow(replay = 0)` for ephemeral events (not `Channel`).
   - Uses `StandardTestDispatcher` in tests (not Unconfined with delay loops).
   - Injects `testDispatcher` into UseCases.
3. Check against `ui-screen-patterns.md`:
   - Separates Screen Composable (orchestration) from Content Composable (presentation).
   - Uses semantic components (`PrimaryButton`, `StateLayout`).
   - Uses callback-based or state-driven navigation (not Channel).
   - Accessibility: headings marked, touch targets >= 48dp, content descriptions present.
4. Report violations with severity, line numbers, and suggested fixes.

## Implementation

This skill is an orchestration workflow using the AI agent's built-in tools.

The agent performs the following steps:
1. Read the file(s) using `Read` tool.
2. Compare against patterns from `docs/viewmodel-state-patterns.md`.
3. Compare against patterns from `docs/ui-screen-patterns.md`.
4. Report findings with severity and suggested fixes.

## Expected Output

```
Validating: HomeViewModel.kt

ERRORS (must fix):
  [E1] Line 45: CancellationException being swallowed
       Pattern: catch (e: Exception) { ... }
       Fix: Add `if (e is CancellationException) throw e`

  [E2] Line 78: Using Channel for UI events
       Pattern: private val _events = Channel<UiEvent>()
       Fix: Use MutableSharedFlow(replay = 0) instead

WARNINGS (consider fixing):
  [W1] Line 23: UiState uses Boolean flags instead of sealed interface
       Fix: Convert to sealed interface with Loading, Error, Success subtypes

PASSED (following patterns):
  [OK] ViewModel has no platform dependencies
  [OK] Uses UiText for dynamic strings

Summary:
  Errors: 2
  Warnings: 1
  Passed: 2
```

## Cross-References

- Pattern: `docs/viewmodel-state-patterns.md`, `docs/ui-screen-patterns.md`
- Script: Uses agent built-in tools (Read, Grep) -- no external script
- Related: `/verify-kmp` (architecture validation)
