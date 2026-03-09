---
scope: [error-handling, exceptions, architecture]
sources: [core-error, kotlinx-coroutines]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: error-handling-hub
token_budget: 1674
description: "Exception patterns: DomainException hierarchy, CancellationException safety, error mapping between layers"
slug: error-handling-exceptions
status: active
layer: L0
parent: error-handling-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
category: error-handling
rules:
  - id: cancellation-exception-rethrow
    type: required-rethrow
    message: "CancellationException must be rethrown in catch blocks"
    detect:
      catch_type: CancellationException
      required_action: rethrow
    hand_written: true
    source_rule: CancellationExceptionRethrowRule.kt
  - id: no-silent-catch
    type: required-rethrow
    message: "Silent catch(Exception/Throwable) swallows exceptions — at minimum log and rethrow"
    detect:
      catch_type_broad: [Exception, Throwable, RuntimeException, Error]
      required_action: rethrow_or_wrap
    hand_written: true
    source_rule: NoSilentCatchRule.kt
  - id: no-run-catching-in-coroutine-scope
    type: banned-usage
    message: "runCatching swallows CancellationException — do not use inside ViewModel or coroutine scope"
    detect:
      in_class_extending: ViewModel
      banned_call: runCatching
    hand_written: true
    source_rule: NoRunCatchingInCoroutineScopeRule.kt

---

# Exception Handling Patterns

## Overview

Typed error hierarchy using `DomainException` from `core-error`, CancellationException safety rules, and error mapping between architecture layers.

**Core Principle**: Use a sealed hierarchy for domain errors. Always rethrow `CancellationException`. Map platform exceptions to domain exceptions at layer boundaries.

---

## 1. DomainException Hierarchy

### Typed Error Hierarchy

```kotlin
sealed class DomainException(
    message: String,
    cause: Throwable? = null
) : Exception(message, cause) {

    // Data access errors
    class NotFound(val entity: String, val id: String) :
        DomainException("$entity not found: $id")

    class AlreadyExists(val entity: String, val id: String) :
        DomainException("$entity already exists: $id")

    // Network errors
    class NetworkUnavailable :
        DomainException("Network unavailable")

    class ServerError(val code: Int, message: String) :
        DomainException("Server error $code: $message")

    class Unauthorized :
        DomainException("Authentication required")

    // Validation errors
    class ValidationFailed(val field: String, val reason: String) :
        DomainException("Validation failed for $field: $reason")

    // Storage errors
    class StorageFull :
        DomainException("Storage full")

    class PermissionDenied(val resource: String) :
        DomainException("Permission denied: $resource")

    // Generic fallback
    class Unknown(cause: Throwable) :
        DomainException("Unknown error: ${cause.message}", cause)
}
```

### Why Sealed Hierarchy

- **Exhaustive `when`**: Compiler enforces handling all error types
- **Type-safe**: No string comparison or `instanceof` chains
- **Contextual**: Each error carries relevant data (entity name, field, HTTP code)
- **Testable**: Easy to assert specific error types in tests

---

## 2. CancellationException Safety

### The Rule

**Always rethrow `CancellationException` in every `catch` block.** Non-negotiable for structured concurrency correctness.

```kotlin
// CORRECT: CancellationException rethrown
try {
    val data = remoteDataSource.fetch()
    Result.success(data)
} catch (e: CancellationException) {
    throw e  // MUST rethrow -- structured concurrency requires this
} catch (e: Exception) {
    Result.failure(e.toDomainException())
}
```

### Why This Matters

Swallowing `CancellationException` breaks coroutine cancellation:
- Parent scope cancels child, child catches exception, child continues running
- ViewModel cleared but coroutine keeps executing network calls
- Memory leaks, wasted resources, incorrect state

### Common Violations

```kotlin
// BAD: Catches all exceptions including CancellationException
try {
    remoteDataSource.fetch()
} catch (e: Exception) {
    // CancellationException is caught here! Coroutine won't cancel properly
    log.error("Fetch failed", e)
    emptyList()
}

// BAD: Catches Throwable (even worse)
try {
    remoteDataSource.fetch()
} catch (t: Throwable) {
    Result.failure(t)
}
```

---

## 3. Error Mapping Between Layers

### Layer Boundaries

```
Data Source (IOException, ResponseException, SqlException)
    |
    v  [map to DomainException]
Repository (DomainException.NotFound, NetworkUnavailable, etc.)
    |
    v  [propagate as Result<T>]
UseCase (Result<T> with DomainException)
    |
    v  [map to UiText]
ViewModel (UiState.Error with user-friendly message)
```

### Data Layer Mapping

> **KMP note**: The JVM-specific exceptions below (`java.io.FileNotFoundException`, `java.net.UnknownHostException`) are only available in `jvmMain`/`androidMain`. In `commonMain`, use Ktor's exception types (`io.ktor.client.network.sockets.ConnectTimeoutException`, `io.ktor.client.plugins.ResponseException`) or define `expect fun Throwable.toDomainException()` with platform `actual` implementations.

```kotlin
// commonMain -- KMP-compatible mapping using Ktor exceptions
fun Throwable.toDomainException(): DomainException = when (this) {
    is io.ktor.client.plugins.ResponseException -> when (response.status.value) {
        401 -> DomainException.Unauthorized()
        404 -> DomainException.NotFound("Resource", message ?: "unknown")
        in 500..599 -> DomainException.ServerError(response.status.value, message ?: "")
        else -> DomainException.Unknown(this)
    }
    is io.ktor.client.network.sockets.ConnectTimeoutException ->
        DomainException.NetworkUnavailable()
    else -> DomainException.Unknown(this)
}

// jvmMain/androidMain -- extended mapping with JVM-specific exceptions
fun Throwable.toDomainException(): DomainException = when (this) {
    is java.io.FileNotFoundException -> DomainException.NotFound("File", message ?: "unknown")
    is java.net.UnknownHostException -> DomainException.NetworkUnavailable()
    is io.ktor.client.plugins.ResponseException -> when (response.status.value) {
        401 -> DomainException.Unauthorized()
        404 -> DomainException.NotFound("Resource", message ?: "unknown")
        in 500..599 -> DomainException.ServerError(response.status.value, message ?: "")
        else -> DomainException.Unknown(this)
    }
    else -> DomainException.Unknown(this)
}
```

---

## 4. Testing Exception Patterns

### Testing Repository Error Mapping

```kotlin
@Test
fun `getById returns NotFound when entity missing`() = runTest {
    val fakeDataSource = FakeDataSource(data = emptyMap())
    val repository = DefaultSnapshotRepository(fakeDataSource)

    val result = repository.getById("missing-id")

    assertThat(result.isFailure).isTrue()
    assertThat(result.exceptionOrNull())
        .isInstanceOf(DomainException.NotFound::class.java)
}
```

### Testing CancellationException Propagation

```kotlin
@Test
fun `repository rethrows CancellationException`() = runTest {
    val fakeDataSource = FakeDataSource(
        onQuery = { throw CancellationException("Job cancelled") }
    )
    val repository = DefaultSnapshotRepository(fakeDataSource)

    assertThrows<CancellationException> {
        repository.getById("any-id")
    }
}
```

---

**Parent doc**: [error-handling-patterns.md](error-handling-patterns.md)
