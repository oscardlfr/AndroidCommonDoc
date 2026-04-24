---
slug: kotlinx-coroutines-reference
title: kotlinx.coroutines Reference
description: Citable reference for kotlinx.coroutines — multiplatform coroutines, Flow, and Dispatchers. Source material for kmp-features-2026.md.
category: architecture
layer: L0
scope: kotlinx.coroutines library API, coroutine builders, Flow, Dispatchers, structured concurrency
targets: [kmp-features-2026.md, any doc referencing kotlinx.coroutines APIs]
sources: [context7:kotlin/kotlinx.coroutines@2026-04-24]
status: reference
---

# kotlinx.coroutines Reference

Source: context7:kotlin/kotlinx.coroutines (ingested 2026-04-24, user-approved)

## Overview

kotlinx.coroutines is a rich library for Kotlin coroutines developed by JetBrains, providing multiplatform support for asynchronous programming. The library enables writing concurrent code in a clear, sequential style through suspending functions and coroutine builders. Unlike many other languages, `async` and `await` are not keywords in Kotlin but library functions.

## Coroutine Builders

| Builder | Returns | Use case |
|---------|---------|----------|
| `launch` | `Job` | Fire-and-forget; doesn't return a value |
| `async` | `Deferred<T>` | Concurrent computation with a result |
| `runBlocking` | `T` | Bridges blocking and coroutine worlds (avoid in production) |

## Dispatchers

| Dispatcher | Thread pool | Typical use |
|-----------|-------------|-------------|
| `Dispatchers.Default` | Shared CPU pool | CPU-intensive computation |
| `Dispatchers.IO` | Elastic IO pool | File/network IO (JVM/Android only) |
| `Dispatchers.Main` | UI thread | UI updates |
| `Dispatchers.Unconfined` | Caller thread | Testing / special cases |

**Note**: In commonMain, prefer injecting the dispatcher — never hardcode `Dispatchers.*` in ViewModels/UseCases (see testing-patterns-dispatcher-scopes.md).

## Structured Concurrency

- Every coroutine runs in a `CoroutineScope`; cancellation propagates to children
- `SupervisorJob` prevents sibling failure propagation
- Always rethrow `CancellationException` in catch blocks

## Flow

```kotlin
val flow: Flow<Int> = flow {
    emit(1)
    emit(2)
}

// StateFlow for state
val state: StateFlow<UiState> = _state.asStateFlow()

// Operators
flow
    .filter { it > 0 }
    .map { it * 2 }
    .collect { value -> println(value) }
```

## Testing Hooks

- `TestCoroutineDispatcher` / `StandardTestDispatcher` for virtual time
- `runTest { }` for coroutine tests (replaces `runBlocking` in tests)
- `advanceUntilIdle()` / `advanceTimeBy()` to control virtual clock

## Notes for kmp-features-2026.md Authors

- kotlinx.coroutines is universally available across all KMP targets
- `Dispatchers.IO` is JVM/Android only; Apple/Native use `Dispatchers.Default` for IO
- Multiplatform Flow support is stable across all targets since 1.7.x
