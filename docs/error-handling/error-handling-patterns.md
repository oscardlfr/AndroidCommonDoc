---
scope: [error-handling, architecture, data, domain]
sources: [core-result, kotlinx-coroutines, core-error]
targets: [android, desktop, ios, jvm]
version: 2
last_updated: "2026-03"
assumes_read: error-handling-hub
token_budget: 838
description: "Hub doc: Error handling patterns using Result type, DomainException hierarchy, and CancellationException safety"
slug: error-handling-patterns
status: active
layer: L0

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 1

rules:
  - id: cancellation-exception-rethrow
    type: required-rethrow
    message: "CancellationException must be rethrown in catch blocks to preserve structured concurrency"
    detect:
      catch_type: CancellationException
      required_action: rethrow
    hand_written: true
    source_rule: CancellationExceptionRethrowRule.kt
category: error-handling
---

# Error Handling Patterns

---

## Overview

Error handling patterns for Kotlin Multiplatform projects. Covers Result type usage, DomainException hierarchy, CancellationException safety, and error mapping between architecture layers.

**Core Principle**: Use typed error hierarchies with `Result<T>` for all fallible operations. Never let raw exceptions escape layer boundaries. Always rethrow `CancellationException`.

### Key Rules

- All repository methods and use cases return `Result<T>` from `core-result`
- Always rethrow `CancellationException` in every `catch` block
- Use `DomainException` sealed hierarchy from `core-error` for typed errors
- Map errors at layer boundaries (DataSource -> Repository -> UseCase -> ViewModel)
- Every `UiState` sealed interface has an `Error` variant with `UiText`

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[error-handling-result](error-handling-result.md)**: Result type patterns -- Result<T> usage, fold/map/getOrNull, Flow integration, resultOf helper, anti-patterns
- **[error-handling-exceptions](error-handling-exceptions.md)**: Exception patterns -- DomainException hierarchy, CancellationException safety, error mapping between layers
- **[error-handling-ui](error-handling-ui.md)**: UI error patterns -- ViewModel error states, UiText error messages, Compose error handling, testing error flows

---

## Quick Reference

| Layer | Error Type | Propagation |
|-------|-----------|-------------|
| DataSource | Platform exceptions (IOException, HttpException) | Throw normally |
| Repository | DomainException (mapped from platform) | Return Result<T> |
| UseCase | DomainException (pass through) | Return Result<T> |
| ViewModel | UiText (mapped from DomainException) | Emit UiState.Error |
| UI | User-friendly string | Display error screen/snackbar |

**Non-negotiable rules:**
1. Always rethrow `CancellationException`
2. All repository methods return `Result<T>`
3. Every UiState sealed interface has an `Error` variant
4. Never expose raw exception messages to users -- use `UiText`
5. Map errors at layer boundaries, not in UI

---

## References

- [nowinandroid error handling](https://github.com/android/nowinandroid)
- [kotlinx-coroutines-test guide](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-test/)

validate_upstream:
  - url: "https://kotlinlang.org/docs/exception-handling.html"
    assertions:
      - type: api_present
        value: "CancellationException"
        context: "Must always rethrow in coroutine catch blocks"
      - type: keyword_present
        value: "structured concurrency"
        context: "Foundation of our error handling patterns"
      - type: deprecation_scan
        value: "runCatching"
        context: "We use runCatchingCancellable wrapper"
    on_failure: HIGH
---

**Status**: Active -- All KMP projects must follow these error handling patterns.
**Last Validated**: March 2026 with Kotlin 2.3.10 / kotlinx-coroutines 1.10.x
