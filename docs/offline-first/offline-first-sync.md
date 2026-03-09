---
scope: [data, sync, offline]
sources: [ktor-client, kotlinx-coroutines, workmanager]
targets: [android, desktop, ios]
version: 2
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 573
description: "Synchronization patterns: conflict resolution, sync strategies, background sync, network state management"
slug: offline-first-sync
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

# Offline-First Synchronization Patterns

## Overview

Synchronization strategies for offline-first KMP applications: full vs incremental sync, conflict resolution approaches, background sync with WorkManager/BGTaskScheduler, and network state management.

---

## Sub-documents

- **[offline-first-sync-queue](offline-first-sync-queue.md)**: Queue management -- background sync (WorkManager, BGTaskScheduler, coroutine-based), KMP expect/actual adaptation, network state management, adaptive sync behavior

---

## Quick Reference

### Full vs Incremental Sync

| Strategy | Use Case | Bandwidth |
|----------|----------|-----------|
| Full Sync | Initial setup, extended offline | High |
| Incremental Sync | Regular updates, token-based | Low (recommended) |

### Conflict Resolution Approaches

| Approach | When to Use |
|----------|------------|
| Last-Write-Wins (LWW) | Simple data, acceptable data loss |
| Server-Wins | Authoritative server, client is secondary |
| Field-Level Merge | Complex domains, preserve all changes |

### Sync Token Pattern

```kotlin
@Entity(tableName = "sync_tokens")
data class SyncToken(
    @PrimaryKey val entityType: String,
    val token: String,
    val lastSyncAt: Long
)
```

### Conflict Detection

```kotlin
fun detectConflict(local: Article, remote: Article): Boolean {
    return local.version != remote.version &&
           local.modifiedAt > (local.syncedAt ?: 0)
}
```

### Stale-While-Revalidate

Emit cached data immediately (stale), then fetch fresh data in background (revalidate). If cache exists, UI never shows loading state.

---

## References

- [Offline-first Android System Design](https://androidengineers.substack.com/p/offline-first-android-system-design)
- Parent doc: [offline-first-patterns.md](offline-first-patterns.md)
