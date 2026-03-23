---
scope: [data, sync, caching, architecture]
sources: [room, datastore, ktor-client, kotlinx-coroutines]
targets: [android, desktop, ios]
version: 3
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 753
description: "Hub doc: Offline-first architecture and data synchronization patterns"
slug: offline-first-patterns
status: active
layer: L0

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

validate_upstream:
  - url: "https://developer.android.com/topic/architecture/data-layer/offline-first"
    assertions:
      - type: api_present
        value: "Flow"
        context: "Observable data pattern for offline-first"
      - type: keyword_present
        value: "source of truth"
        context: "SSOT principle we teach"
      - type: deprecation_scan
        value: "LiveData"
        context: "We teach Flow over LiveData"
    on_failure: MEDIUM
---
# Offline-First System Design Patterns (KMP)

---

## Overview

This document defines standard patterns for offline-first data architectures in Kotlin Multiplatform projects. The local database is the primary source of truth; network access is an optimization layer.

**Core Principle**: The best network request is the one you never have to make. Local-first means the UI always has data to show immediately.

Based on:
- https://androidengineers.substack.com/p/offline-first-android-system-design
- https://androidengineers.substack.com/p/offline-first-android-system-design-779

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[offline-first-architecture](offline-first-architecture.md)**: Architecture patterns -- offline-first principles, repository pattern, data model with sync metadata, outbox pattern, Flow/StateFlow usage
- **[offline-first-sync](offline-first-sync.md)**: Synchronization patterns -- full vs incremental sync, conflict resolution (LWW, server-wins, field-level merge), background sync (WorkManager, BGTaskScheduler), network state management
- **[offline-first-caching](offline-first-caching.md)**: Caching and testing -- offline scenario testing, conflict resolution testing, UI patterns for offline state, KMP adaptation notes

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

### Sync Metadata Model

```kotlin
enum class SyncStatus {
    SYNCED, PENDING_CREATE, PENDING_UPDATE, PENDING_DELETE, CONFLICT
}
```

---

**Status**: Active | **Last Validated**: March 2026 with kotlinx-serialization 1.8.x / kotlinx-coroutines 1.10.x
