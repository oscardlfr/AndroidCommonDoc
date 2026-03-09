---
scope: [data, sync, offline, background]
sources: [workmanager, kotlinx-coroutines]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 1436
monitor_urls:
  - url: "https://developer.android.com/topic/architecture/data-layer/offline-first"
    type: doc-page
    tier: 2
description: "Sync queue management: background sync (WorkManager, BGTaskScheduler), KMP adaptation, network state, adaptive sync"
slug: offline-first-sync-queue
status: active
layer: L0
parent: offline-first-sync
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

# Offline-First Sync: Queue Management and Background Sync

## Overview

Background synchronization implementation patterns for each KMP target platform, network state management, and adaptive sync behavior based on connectivity.

---

## 1. Incremental Sync Implementation

```kotlin
interface RemoteDataSource {
    suspend fun getArticles(since: String? = null): Result<ArticlesResponse>
}

data class ArticlesResponse(
    val articles: List<Article>,
    val nextToken: String?,
    val deletedIds: List<String>
)

// Repository incremental sync
suspend fun incrementalSync() {
    val lastToken = syncTokenDao.getToken("Article")?.token
    val response = remoteDataSource.getArticles(since = lastToken)
    response.onSuccess { data ->
        localDataSource.upsertAll(data.articles)
        localDataSource.deleteByIds(data.deletedIds)
        syncTokenDao.upsert(SyncToken(
            entityType = "Article",
            token = data.nextToken ?: "",
            lastSyncAt = Clock.System.now().toEpochMilliseconds()
        ))
    }
}
```

---

## 2. Stale-While-Revalidate Pattern

```kotlin
suspend fun getArticleWithRevalidate(id: String): Flow<Resource<Article>> = flow {
    // 1. Emit cached data immediately (stale)
    val cached = localDataSource.getArticle(id)
    if (cached != null) {
        emit(Resource.Success(cached, isStale = true))
    }

    // 2. Fetch fresh data in background (revalidate)
    try {
        val fresh = remoteDataSource.getArticle(id)
        fresh.fold(
            onSuccess = { data ->
                localDataSource.upsert(data)
                emit(Resource.Success(data, isStale = false))
            },
            onFailure = { error ->
                if (cached == null) emit(Resource.Error(error))
            }
        )
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        if (cached == null) emit(Resource.Error(e))
    }
}

sealed class Resource<out T> {
    data class Success<T>(val data: T, val isStale: Boolean = false) : Resource<T>()
    data class Error(val exception: Throwable) : Resource<Nothing>()
    object Loading : Resource<Nothing>()
}
```

---

## 3. Background Synchronization

### WorkManager Implementation (Android)

> **Android only** -- WorkManager requires Android context.

```kotlin
class SyncWorker(
    context: Context,
    params: WorkerParameters,
    private val syncManager: SyncManager
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            syncManager.sync()
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}

fun scheduleSyncWork() {
    val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .setRequiresBatteryNotLow(true)
        .build()

    val syncWork = PeriodicWorkRequestBuilder<SyncWorker>(
        repeatInterval = 15,
        repeatIntervalTimeUnit = TimeUnit.MINUTES
    )
        .setConstraints(constraints)
        .setBackoffCriteria(
            BackoffPolicy.EXPONENTIAL,
            WorkRequest.MIN_BACKOFF_MILLIS,
            TimeUnit.MILLISECONDS
        )
        .build()

    WorkManager.getInstance(context)
        .enqueueUniquePeriodicWork("sync_work", ExistingPeriodicWorkPolicy.KEEP, syncWork)
}
```

### KMP Adaptation (expect/actual)

```kotlin
// commonMain
expect class BackgroundSync {
    fun scheduleSync()
    fun cancelSync()
}

// androidMain -- WorkManager
actual class BackgroundSync(private val context: Context) {
    actual fun scheduleSync() { /* WorkManager implementation */ }
    actual fun cancelSync() { WorkManager.getInstance(context).cancelUniqueWork("sync_work") }
}

// iosMain -- BGTaskScheduler
actual class BackgroundSync {
    actual fun scheduleSync() { /* BGTaskScheduler implementation */ }
    actual fun cancelSync() { /* Cancel background tasks */ }
}

// desktopMain -- Coroutine-based periodic sync
actual class BackgroundSync {
    actual fun scheduleSync() { /* Coroutine-based periodic sync */ }
    actual fun cancelSync() { /* Cancel coroutine job */ }
}
```

---

## 4. Network State Management

```kotlin
sealed class NetworkState {
    object Unknown : NetworkState()
    data class Online(
        val type: NetworkType,
        val isMetered: Boolean,
        val bandwidth: Long?
    ) : NetworkState()
    object Offline : NetworkState()
    data class CaptivePortal(val portalUrl: String) : NetworkState()
}

interface NetworkMonitor {
    val networkState: StateFlow<NetworkState>
}

// Adaptive sync behavior based on network
class AdaptiveSyncManager(
    private val networkMonitor: NetworkMonitor,
    private val syncManager: SyncManager
) {
    fun observeAndSync() {
        networkMonitor.networkState
            .distinctUntilChanged()
            .onEach { state ->
                when (state) {
                    is NetworkState.Online -> {
                        if (!state.isMetered) syncManager.fullSync()
                        else syncManager.incrementalSync()
                    }
                    is NetworkState.Offline -> { /* Stop sync */ }
                }
            }
            .launchIn(scope)
    }
}
```

---

Parent doc: [offline-first-sync.md](offline-first-sync.md)
