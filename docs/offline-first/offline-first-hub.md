---
scope: [offline-first, sync, caching, conflict-resolution]
sources: [room, kotlinx-coroutines, workmanager]
targets: [android, desktop, ios, jvm]
slug: offline-first-hub
status: active
layer: L0
category: offline-first
description: "Offline-first category hub: Repository pattern, sync strategies, conflict resolution, caching"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://developer.android.com/topic/architecture/data-layer/offline-first"
    type: doc-page
    tier: 2
  - url: "https://developer.android.com/jetpack/androidx/releases/room"
    type: doc-page
    tier: 2
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

# Offline-First

Repository-based offline-first patterns, sync strategies, and conflict resolution for KMP.

> Local-first: write to local DB immediately, sync to remote in background. Never block UI on network.

## Documents

| Document | Description |
|----------|-------------|
| [offline-first-patterns](offline-first-patterns.md) | Hub: architecture overview, core principles |
| [offline-first-architecture](offline-first-architecture.md) | Architecture layers — Repository, DataSource, outbox, Flow/StateFlow |
| [offline-first-architecture-layers](offline-first-architecture-layers.md) | Layer responsibilities and data flow |
| [offline-first-architecture-conflict](offline-first-architecture-conflict.md) | Conflict resolution strategies |
| [offline-first-sync](offline-first-sync.md) | Sync strategies — incremental, background sync |
| [offline-first-sync-queue](offline-first-sync-queue.md) | Outbox queue implementation |
| [offline-first-caching](offline-first-caching.md) | Caching strategies and UI offline patterns |

## Key Rules

- Outbox pattern for reliable sync: queue operations locally, process when online
- Timestamp-based conflict resolution as default; custom merge for domain-specific conflicts
- Expose `Flow<Resource<T>>` not `StateFlow` from repositories
