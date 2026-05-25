---
scope: [testing, compose-multiplatform, test-dispatcher, ui-testing]
sources: [compose-multiplatform, kotlinx-coroutines-test]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-05"
description: "CMP 1.11.0 Compose UI test migration: v1 runComposeUiTest -> v2 runComposeUiTestWithContext, dispatcher swap UnconfinedTestDispatcher -> StandardTestDispatcher, advanceUntilIdle() requirements"
slug: testing-compose-ui-test-v2
status: active
layer: L0
parent: testing-hub
category: testing
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
---

# Compose UI Test API v2 (CMP 1.11.0)

Compose Multiplatform 1.11.0 ships a revised Compose UI test API. The migration is a **package change only** — function names are identical; only the import path changes from `androidx.compose.ui.test` to `androidx.compose.ui.test.v2`. The behavioral change (dispatcher swap) is documented in the `@Deprecated` WARNING shown at compile time.

> **Source**: [Compose Multiplatform 1.11.0 release notes](https://blog.jetbrains.com/kotlin/2026/05/compose-multiplatform-1-11-0/) (2026-05-25)

## Why Deprecated

CMP 1.11.0 deprecates the v1 test entry points (`runComposeUiTest`, `runSkikoComposeUiTest`, `runDesktopComposeUiTest`) because they use `UnconfinedTestDispatcher` by default, which causes Compose effects to execute eagerly in tests — differing from production behavior where coroutines are queued. The v2 package fixes this by defaulting to `StandardTestDispatcher`.

The deprecation WARNING text reads verbatim:
> _"Use `androidx.compose.ui.test.v2.runComposeUiTest` instead. The v2 APIs use `StandardTestDispatcher` by default to better simulate production behavior where coroutines are queued rather than executed immediately."_

## API Mapping: v1 → v2 (Package Change Only)

| v1 import (deprecated) | v2 import (replacement) |
|---|---|
| `import androidx.compose.ui.test.runComposeUiTest` | `import androidx.compose.ui.test.v2.runComposeUiTest` |
| `import androidx.compose.ui.test.runSkikoComposeUiTest` | `import androidx.compose.ui.test.v2.runSkikoComposeUiTest` |
| `import androidx.compose.ui.test.runDesktopComposeUiTest` | `import androidx.compose.ui.test.v2.runDesktopComposeUiTest` |

**Call sites remain identical** — only the import line changes. The function names do not change.

**No IDE quick-fix**: The `@Deprecated` annotation has no `replaceWith` parameter. The IDE will flag the usage but will NOT offer an automatic fix. Consumers must update the import manually.

Source: `@Deprecated` annotations in compose-multiplatform-core tag v1.11.0 (artifact-verified).

## Dispatcher Behavior Change

**v1 behavior (UnconfinedTestDispatcher)**: Coroutines launched inside the test block ran eagerly on the calling thread. `LaunchedEffect`, `produceState`, and `collectAsState` executed synchronously without explicit clock advancement.

**v2 behavior (StandardTestDispatcher)**: Coroutines are enqueued and require explicit advancement. Virtual time does not advance automatically. The behavioral change is documented at compile time via the `@Deprecated` WARNING — it is non-obvious even though visible.

```kotlin
// v1 (deprecated) — import from old package; eager execution
import androidx.compose.ui.test.runComposeUiTest

runComposeUiTest {
    setContent { MyScreen(viewModel) }
    onNodeWithTag("result").assertIsDisplayed() // may pass without advancement
}

// v2 (migration target) — import from .v2 package; explicit drain required
import androidx.compose.ui.test.v2.runComposeUiTest

runComposeUiTest {
    setContent { MyScreen(viewModel) }
    advanceUntilIdle()  // drain all pending coroutines
    onNodeWithTag("result").assertIsDisplayed()
}
```

## When to Call advanceUntilIdle()

Call `advanceUntilIdle()` after any operation that enqueues coroutines:

- Eager flow assertions (Path A multi-step state mutations from [testing-patterns-dispatcher-scopes](testing-patterns-dispatcher-scopes.md))
- Path B imperative observers after `startObserving()`
- `LaunchedEffect` or `SideEffect` triggered by composition
- `StateFlow` collection via `collectAsState`
- ViewModel operations triggered by user interaction (`performClick`, `performTextInput`)
- Animation timelines

```kotlin
import androidx.compose.ui.test.v2.runComposeUiTest

runComposeUiTest {
    setContent { SessionListScreen(viewModel) }

    onNodeWithTag("refresh_button").performClick()
    advanceUntilIdle()  // drain ViewModel + StateFlow update

    onNodeWithTag("session_list").assertIsDisplayed()
}
```

## effectContext and runTestContext Parameters

From `ComposeUiTest.skiko.kt:108`, compose-multiplatform-core v1.11.0 (artifact-verified):

```kotlin
effectContext: CoroutineContext = EmptyCoroutineContext   // controls Compose effect coroutines (LaunchedEffect, SideEffect)
runTestContext: CoroutineContext = EmptyCoroutineContext  // controls the test block coroutine itself
```

These are **distinct parameters** — do not conflate them.

- **`effectContext`**: The `CoroutineContext` injected into the Compose runtime for effects running inside the composition (`LaunchedEffect`, `produceState`). Use this to share a `TestCoroutineScheduler` between the test clock and Compose effects.
- **`runTestContext`**: The `CoroutineContext` for the test body block itself. Rarely needed unless you require custom context elements in the test scope.

**Recommended pattern** (when sharing scheduler with ViewModel):

```kotlin
import androidx.compose.ui.test.v2.runComposeUiTest

val scheduler = TestCoroutineScheduler()
val testDispatcher = StandardTestDispatcher(scheduler)

runComposeUiTest(
    effectContext = testDispatcher
) {
    setContent { MyScreen(viewModel) }
    testDispatcher.scheduler.advanceUntilIdle()
    onNodeWithTag("result").assertIsDisplayed()
}
```

## Migration Checklist

- [ ] Update import: replace `import androidx.compose.ui.test.runComposeUiTest` with `import androidx.compose.ui.test.v2.runComposeUiTest`
- [ ] Repeat for `runSkikoComposeUiTest` and `runDesktopComposeUiTest` if used
- [ ] Add `advanceUntilIdle()` after every user interaction or state-triggering step
- [ ] Verify tests that relied on eager coroutine execution still pass after adding `advanceUntilIdle()`
- [ ] If sharing a dispatcher with a ViewModel under test, pass it via `effectContext`
- [ ] Note: no IDE quick-fix — manual import update required in each test file

## Dependency

```toml
# libs.versions.toml
[versions]
compose-multiplatform = "1.11.0"

[libraries]
compose-ui-test = { module = "org.jetbrains.compose.ui:ui-test", version.ref = "compose-multiplatform" }
```

## See Also

- [testing-patterns-coroutines](testing-patterns-coroutines.md) — StandardTestDispatcher and virtual time patterns
- [testing-patterns-dispatcher-scopes](testing-patterns-dispatcher-scopes.md) — Path A/B dispatcher scope rules; advanceUntilIdle() trigger cases
- [testing-hub](testing-hub.md) — Testing category index
