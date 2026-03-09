---
scope: [data, architecture, offline]
sources: [room, datastore]
targets: [android, desktop, ios]
version: 2
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 718
description: "Offline-first architecture patterns: principles, data layer design, repository pattern, data model with metadata"
slug: offline-first-architecture
status: active
layer: L0
parent: offline-first-patterns

monitor_urls:
  - url: "https://github.com/Kotlin/kotlinx.coroutines/releases"
    type: github-releases
    tier: 2
category: offline-first
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

# Offline-First Architecture Patterns

## Overview

Architecture patterns for offline-first data layer design in Kotlin Multiplatform projects. The local database is the primary source of truth; network access is an optimization layer.

**Core Principle**: The best network request is the one you never have to make. Local-first means the UI always has data to show immediately.

Based on:
- https://androidengineers.substack.com/p/offline-first-android-system-design
- https://androidengineers.substack.com/p/offline-first-android-system-design-779

---

## Sub-documents

- **[offline-first-architecture-layers](offline-first-architecture-layers.md)**: Layer implementation -- multi-layer caching strategy, repository pattern (orchestration layer), data model with sync metadata, outbox pattern for write operations
- **[offline-first-architecture-conflict](offline-first-architecture-conflict.md)**: Anti-patterns and Flow usage -- synchronous-first loading, raw network calls, missing conflict resolution, Flow/StateFlow observable architecture

---

## Quick Reference

### Architecture Layers

```
Memory Cache -> Local Database -> Network Layer -> Sync Queue (Outbox)
     |              |                |                 |
   (Fast)      (Persistent)      (Remote)         (Pending Ops)
```

### Key Anti-Patterns

- **Network-first loading**: UI shows nothing until network responds -- use local DB as read source
- **Raw network calls**: Every screen load hits network -- observe local DB, refresh in background
- **Missing conflict resolution**: Any system with writes MUST have a conflict strategy

### Repository Pattern

```kotlin
class ArticleRepository(
    private val localDataSource: ArticleLocalDataSource,
    private val remoteDataSource: ArticleRemoteDataSource
) {
    fun observeArticles(): Flow<List<Article>> {
        return localDataSource.observeArticles()  // Instant from local DB
    }

    suspend fun refreshArticles(): Result<Unit> {
        // Network fetch writes to local DB, UI updates via Flow
    }
}
```

### Sync Metadata

```kotlin
enum class SyncStatus {
    SYNCED, PENDING_CREATE, PENDING_UPDATE, PENDING_DELETE, CONFLICT
}
```

---

## References

- [Offline-first Android System Design](https://androidengineers.substack.com/p/offline-first-android-system-design)
- Parent doc: [offline-first-patterns.md](offline-first-patterns.md)
