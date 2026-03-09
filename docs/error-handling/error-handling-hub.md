---
scope: [error-handling, result-type, exceptions]
sources: [kotlinx-coroutines, kotlin-stdlib]
targets: [android, desktop, ios, jvm]
slug: error-handling-hub
status: active
layer: L0
category: error-handling
description: "Error handling category hub: Result type, DomainException hierarchy, CancellationException safety"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 1
rules:
  - id: cancellation-exception-rethrow
    type: required-rethrow
    message: "CancellationException must always be rethrown in catch blocks"
    detect:
      catch_type: CancellationException
      required_action: rethrow
    hand_written: true
    source_rule: CancellationExceptionRethrowRule.kt

---

# Error Handling

Result type, DomainException hierarchy, and CancellationException safety patterns.

> Always rethrow `CancellationException`. Never swallow it in a `catch (e: Exception)` block.

## Documents

| Document | Description |
|----------|-------------|
| [error-handling-patterns](error-handling-patterns.md) | Hub: Result type usage, DomainException hierarchy, overview |
| [error-handling-result](error-handling-result.md) | Result<T> — wrapping, unwrapping, mapping, chaining |
| [error-handling-exceptions](error-handling-exceptions.md) | DomainException sealed hierarchy, error mapping between layers |
| [error-handling-ui](error-handling-ui.md) | UiState error states, Flow error handling, user-facing errors |

## Key Rules

- Use `com.example.shared.core.result.Result<T>` for all operations returning success/failure
- Always rethrow `CancellationException` (`is CancellationException -> throw e`)
- DomainException sealed hierarchy — never leak implementation exceptions to UI
- Map exceptions at layer boundaries (Data → Domain → ViewModel)
