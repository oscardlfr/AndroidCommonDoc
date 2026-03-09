---
scope: [data, caching, offline]
sources: [room, datastore, ktor-client]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 1290
description: "Caching patterns: testing strategies, UI patterns for offline state, KMP adaptation notes"
slug: offline-first-caching
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

# Offline-First Caching and Testing Patterns

## Overview

Testing strategies for offline-first data layers, UI patterns for offline state indication, and KMP adaptation notes for cross-platform offline-first architectures.

---

## 1. Testing Strategies

### Offline Scenario Testing

```kotlin
@Test
fun `create article offline - saves to outbox`() = runTest {
    // Given: Offline state
    networkMonitor.setState(NetworkState.Offline)

    // When: Create article
    val result = repository.createArticle(testArticle)

    // Then: Saved locally with PENDING_CREATE status
    assertTrue(result is Result.Success)
    val saved = localDataSource.getArticle(result.data.id)
    assertEquals(SyncStatus.PENDING_CREATE, saved?.syncStatus)

    // And: Outbox entry created
    val outboxEntries = outboxDao.getAll()
    assertEquals(1, outboxEntries.size)
    assertEquals(Operation.CREATE, outboxEntries[0].operation)
}

@Test
fun `sync when online - processes outbox entries`() = runTest {
    // Given: Outbox has pending entries
    outboxDao.insert(createTestOutboxEntry())

    // When: Come back online and sync
    networkMonitor.setState(NetworkState.Online)
    syncManager.sync()

    // Then: Outbox cleared and entity synced
    val outboxEntries = outboxDao.getAll()
    assertTrue(outboxEntries.isEmpty())

    val article = localDataSource.getArticle(testArticleId)
    assertEquals(SyncStatus.SYNCED, article?.syncStatus)
}
```

### Conflict Resolution Testing

```kotlin
@Test
fun `concurrent modifications - resolves with field merge`() = runTest {
    val local = testArticle.copy(
        title = "Local Title",
        body = "Local Body",
        tags = listOf("tag1", "tag2"),
        modifiedAt = 1000
    )
    val remote = testArticle.copy(
        title = "Remote Title",
        body = "Remote Body",
        tags = listOf("tag2", "tag3"),
        modifiedAt = 2000
    )

    val resolved = conflictResolver.resolveFieldLevelMerge(
        local, remote,
        rules = mapOf(
            "body" to MergeRule.PreferRemote,
            "tags" to MergeRule.Union
        )
    )

    assertEquals("Remote Body", resolved.body)
    assertEquals(listOf("tag1", "tag2", "tag3"), resolved.tags)
}
```

---

## 2. UI Patterns for Offline State

```kotlin
@Composable
fun OfflineIndicator(
    networkState: NetworkState,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(visible = networkState is NetworkState.Offline) {
        Surface(
            modifier = modifier.fillMaxWidth(),
            color = MaterialTheme.colorScheme.errorContainer
        ) {
            Row(
                modifier = Modifier.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.CloudOff, "Offline")
                Spacer(Modifier.width(8.dp))
                Text("You're offline. Changes will sync when connected.")
            }
        }
    }
}

@Composable
fun PendingSyncIndicator(
    outboxCount: Int,
    modifier: Modifier = Modifier
) {
    if (outboxCount > 0) {
        Chip(
            onClick = { /* Show pending changes */ },
            label = { Text("$outboxCount pending") },
            leadingIcon = { Icon(Icons.Default.CloudQueue, null) }
        )
    }
}
```

---

## 3. Best Practices Summary

- Local database as source of truth (Room, SQLite)
- Repository pattern for orchestration
- Outbox table for pending operations
- Incremental sync with tokens/cursors
- Version-based conflict detection
- Field-level conflict merging (complex domains)
- Exponential backoff retry logic
- WorkManager/BGTaskScheduler for background reliability
- Clear user communication about sync state
- Network state awareness with adaptive behavior
- Flow/StateFlow for reactive updates

---

## 4. KMP Adaptation Notes

For Kotlin Multiplatform projects:

1. **Shared Data Layer**: Implement repository pattern in `commonMain`
2. **Expect/Actual Pattern**: Database implementations vary (Room/Android, SQLite/iOS, SQLDelight/both)
3. **Coroutines/Flow**: Use common Kotlin Coroutines for reactive data flows
4. **Serialization**: Leverage kotlinx.serialization for cross-platform compatibility
5. **Network Layer**: Platform-specific HTTP clients with shared sync logic
6. **Outbox Pattern**: Implement in `commonMain` with platform-specific database interactions
7. **Background Sync**: Expect/actual for WorkManager (Android), BGTaskScheduler (iOS), Coroutines (Desktop)

---

## References

- [Offline-first Android System Design](https://androidengineers.substack.com/p/offline-first-android-system-design)
- Parent doc: [offline-first-patterns.md](offline-first-patterns.md)
