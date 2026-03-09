---
scope: [error-handling, result-type, data]
sources: [core-result, kotlinx-coroutines]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: error-handling-hub
token_budget: 968
description: "Result type patterns: Result<T> usage, fold/map/getOrNull, Flow integration, resultOf helper"
slug: error-handling-result
status: active
layer: L0
parent: error-handling-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
category: error-handling
rules:
  - id: no-raw-exception-propagation
    type: banned-supertype
    message: "Domain exceptions must extend DomainException, not raw Exception or Throwable"
    detect:
      in_package_suffix: domain
      banned_supertype: Exception
      prefer: DomainException
    hand_written: false
  - id: no-magic-numbers-in-usecase
    type: banned-usage
    message: "Magic numbers in UseCase business logic — extract as named constants or constructor parameters"
    detect:
      in_class_suffix: UseCase
      banned_literal_type: integer
      allowed_values: [0, 1, -1]
      exclude: companion_object
    hand_written: true
    source_rule: NoMagicNumbersInUseCaseRule.kt

---

# Result Type Patterns

## Overview

All repository methods and use cases return `Result<T>` from `core-result`. This replaces exception-based error propagation with explicit, type-safe error handling.

**Core Principle**: Result<T> makes fallibility explicit in the type signature. Callers are forced to handle both success and failure paths.

---

## 1. Core Pattern

```kotlin
// Repository interface (domain layer)
interface SnapshotRepository {
    suspend fun getById(id: String): Result<Snapshot>
    suspend fun save(snapshot: Snapshot): Result<Unit>
    fun observeAll(): Flow<Result<List<Snapshot>>>
}
```

## 2. Why Result Over Exceptions

| Approach | Problem |
|----------|---------|
| Throwing exceptions | Caller doesn't know what can fail; nothing in the signature indicates fallibility |
| Nullable return | Loses error context; caller can't distinguish "not found" from "network error" |
| Result<T> | Explicit in signature; carries error context; forces caller to handle both paths |

## 3. Repository Implementation

```kotlin
suspend fun getById(id: String): Result<Snapshot> {
    return try {
        val entity = dataSource.query(id)
            ?: return Result.failure(DomainException.NotFound("Snapshot", id))
        Result.success(entity.toDomain())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e.toDomainException())
    }
}
```

## 4. Helper Extension

```kotlin
/**
 * Wraps a suspending block in Result, rethrowing CancellationException.
 */
suspend inline fun <T> resultOf(block: () -> T): Result<T> {
    return try {
        Result.success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

## 5. Flow Error Handling

### Catching Flow Errors

```kotlin
// In repository: wrap Flow emissions in Result
fun observeAll(): Flow<Result<List<Item>>> = dataSource
    .observeAll()
    .map<List<ItemEntity>, Result<List<Item>>> { entities ->
        Result.success(entities.map { it.toDomain() })
    }
    .catch { e ->
        if (e is CancellationException) throw e
        emit(Result.failure(e.toDomainException()))
    }
```

### Flow Result Mapping in ViewModel

```kotlin
// GOOD: Flow already emits Result<T> -- handle in map
repository.observeAll()
    .map { result ->
        result.fold(
            onSuccess = { UiState.Success(it) },
            onFailure = { UiState.Error(it.toUiMessage()) }
        )
    }
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState.Loading)
```

## 6. Anti-Patterns

```kotlin
// BAD: Throwing from repository (caller has no idea this can fail)
suspend fun getById(id: String): Snapshot {
    return dataSource.query(id) ?: throw NotFoundException(id)
}

// BAD: Returning null (loses error context)
suspend fun getById(id: String): Snapshot? {
    return try { dataSource.query(id) } catch (e: Exception) { null }
}

// BAD: Catching in the collector (ViewModel) -- errors should be mapped in data layer
viewModelScope.launch {
    try {
        repository.observeAll().collect { items ->
            _state.value = UiState.Success(items)
        }
    } catch (e: Exception) {
        _state.value = UiState.Error(e.message ?: "Unknown")
    }
}
```

---

**Parent doc**: [error-handling-patterns.md](error-handling-patterns.md)
