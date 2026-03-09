---
scope: [data, architecture, offline, anti-patterns]
sources: [room, kotlinx-coroutines, compose-runtime]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 1184
monitor_urls:
  - url: "https://developer.android.com/topic/architecture/data-layer/offline-first"
    type: doc-page
    tier: 2
description: "Offline-first anti-patterns and Flow/StateFlow observable architecture patterns"
slug: offline-first-architecture-conflict
status: active
layer: L0
parent: offline-first-architecture
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

# Offline-First Architecture: Anti-Patterns and Flow Usage

## Overview

Common anti-patterns in offline-first architectures and the correct Flow/StateFlow observable patterns that replace them. Every anti-pattern shown here has been observed in production KMP projects.

---

## 1. Anti-Patterns

### Synchronous-First Data Loading

**DON'T (Anti-pattern):**
```kotlin
// BAD: Network-first approach -- UI shows nothing until network responds, fails completely when offline
class ArticleRepository(private val api: ArticleApi) {
    suspend fun getArticles(): List<Article> {
        return api.fetchArticles()  // UI blocked waiting for network
    }
}
```

**DO (Correct):**
```kotlin
// Offline-first: UI always has data from local DB, network updates arrive asynchronously
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

### Raw Network Calls Without Caching

**DON'T:**
```kotlin
// BAD: Every screen load makes a network call
@Composable
fun ArticleScreen(viewModel: ArticleViewModel) {
    LaunchedEffect(Unit) {
        viewModel.loadFromNetwork()  // Always hits network
    }
}
```

**DO:**
```kotlin
// Observe local DB (instant), trigger background refresh if stale
@Composable
fun ArticleScreen(viewModel: ArticleViewModel) {
    val articles by viewModel.articles.collectAsStateWithLifecycle()
}
```

### Missing Conflict Resolution

**DON'T:**
```kotlin
// BAD: Overwriting remote data without checking for conflicts
suspend fun sync(local: Article, remote: Article): Article {
    return local  // Always prefer local, ignoring remote changes entirely
}
```

**DO:**
```kotlin
// Version-based conflict detection with explicit resolution strategy
fun detectConflict(local: Article, remote: Article): Boolean {
    return local.version != remote.version &&
           local.modifiedAt > (local.syncedAt ?: 0)
}
```

**Key insight:** Any offline-first system with write operations MUST have a conflict resolution strategy.

### Conflict Resolution Strategies

**Last-Write-Wins (LWW)** -- Simple data, acceptable minor data loss:
```kotlin
fun resolveLastWriteWins(local: Article, remote: Article): Article {
    return if (local.modifiedAt > remote.modifiedAt) local else remote
}
```

**Server-Wins** -- Authoritative server, client is secondary:
```kotlin
fun resolveServerWins(local: Article, remote: Article): Article {
    return remote.copy(syncStatus = SyncStatus.SYNCED)
}
```

**Field-Level Merging** -- Complex domains, preserve all changes (recommended):
```kotlin
fun resolveFieldLevelMerge(
    local: Article, remote: Article, rules: Map<String, MergeRule>
): Article {
    return Article(
        id = local.id,
        title = if (rules["title"] == MergeRule.PreferLocal) local.title else remote.title,
        body = if (local.modifiedAt > remote.modifiedAt) local.body else remote.body,
        tags = (local.tags + remote.tags).distinct(),
        version = max(local.version, remote.version) + 1,
        syncStatus = SyncStatus.SYNCED
    )
}
```

---

## 2. Flow/StateFlow Observable Architecture

### Observable Pattern

```kotlin
// Repository exposes data as Flow
interface ArticleRepository {
    fun observeArticles(): Flow<List<Article>>
}

// ViewModel collects and converts to StateFlow
class ArticleViewModel(
    private val repository: ArticleRepository
) : ViewModel() {

    val articles: StateFlow<List<Article>> = repository
        .observeArticles()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )
}

// UI collects
@Composable
fun ArticleScreen(viewModel: ArticleViewModel) {
    val articles by viewModel.articles.collectAsStateWithLifecycle()
    LazyColumn {
        items(articles) { article -> ArticleItem(article) }
    }
}
```

**Key Benefit:** UI automatically reflects local database changes without imperative refresh calls.

---

Parent doc: [offline-first-architecture.md](offline-first-architecture.md)
