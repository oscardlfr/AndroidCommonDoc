---
scope: [data, architecture, offline, repository]
sources: [room, datastore, kotlinx-coroutines]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: offline-first-hub
token_budget: 1457
monitor_urls:
  - url: "https://developer.android.com/topic/architecture/data-layer/offline-first"
    type: doc-page
    tier: 2
description: "Offline-first layer implementation: multi-layer caching, repository pattern, data model with sync metadata, outbox pattern"
slug: offline-first-architecture-layers
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

# Offline-First Architecture: Layer Implementation

## Overview

Detailed implementation patterns for each layer in the offline-first architecture stack: multi-layer caching strategy, repository orchestration, data model with sync metadata, and the outbox pattern for write operations.

---

## 1. Multi-Layer Caching Strategy

```
Memory Cache -> Local Database -> Network Layer -> Sync Queue (Outbox)
     |              |                |                 |
   (Fast)      (Persistent)      (Remote)         (Pending Ops)
```

**Flow:**
1. UI reads from local database (instant)
2. Repository triggers background network fetch
3. Network response writes to local database
4. UI automatically updates via Flow emissions
5. Write operations go to outbox first, then sync

---

## 2. Repository Pattern (Orchestration Layer)

**Role:** Acts as gatekeeper between domain logic and data sources

**Key Principle:** UI always observes local database; network operations write to local storage

```kotlin
interface ArticleRepository {
    fun observeArticles(): Flow<List<Article>>
    fun observeArticle(id: String): Flow<Article?>
    suspend fun refreshArticles(): Result<Unit>
    suspend fun createArticle(article: Article): Result<Article>
    suspend fun updateArticle(article: Article): Result<Article>
    suspend fun deleteArticle(id: String): Result<Unit>
}

class ArticleRepositoryImpl(
    private val localDataSource: ArticleLocalDataSource,
    private val remoteDataSource: ArticleRemoteDataSource,
    private val outboxDao: OutboxDao,
    private val syncManager: SyncManager
) : ArticleRepository {

    private val _syncState = MutableStateFlow(SyncState.IDLE)
    val syncState: StateFlow<SyncState> = _syncState.asStateFlow()

    override fun observeArticles(): Flow<List<Article>> {
        return localDataSource.observeArticles()
    }

    override suspend fun refreshArticles(): Result<Unit> {
        return try {
            _syncState.value = SyncState.SYNCING
            syncManager.syncOutbox()
            val result = remoteDataSource.getArticles()
            result.fold(
                onSuccess = { data ->
                    localDataSource.upsertAll(data)
                    _syncState.value = SyncState.SUCCESS
                    Result.success(Unit)
                },
                onFailure = { error ->
                    _syncState.value = SyncState.ERROR(error)
                    Result.failure(error)
                }
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            _syncState.value = SyncState.ERROR(e)
            Result.failure(e)
        }
    }

    override suspend fun createArticle(article: Article): Result<Article> {
        return try {
            val localArticle = article.copy(
                id = Uuid.random().toString(),
                syncStatus = SyncStatus.PENDING_CREATE,
                createdAt = Clock.System.now().toEpochMilliseconds()
            )
            localDataSource.insert(localArticle)
            outboxDao.insert(OutboxEntry(
                entityType = "Article",
                entityId = localArticle.id,
                operation = Operation.CREATE,
                payload = Json.encodeToString(localArticle)
            ))
            syncManager.scheduleSyncWork()
            Result.success(localArticle)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
```

---

## 3. Data Model with Metadata

**Essential Fields for Offline-First:**

```kotlin
@Entity(tableName = "articles")
data class Article(
    @PrimaryKey
    val id: String = Uuid.random().toString(),
    val serverId: String? = null,

    // Business data
    val title: String,
    val body: String,
    val tags: List<String>,

    // Sync metadata
    val version: Int = 1,
    val createdAt: Long,
    val modifiedAt: Long,
    val syncedAt: Long? = null,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,

    // Soft delete support
    val isDeleted: Boolean = false
)

enum class SyncStatus {
    SYNCED,
    PENDING_CREATE,
    PENDING_UPDATE,
    PENDING_DELETE,
    CONFLICT
}
```

---

## 4. Outbox Pattern for Write Operations

**Purpose:** Store pending operations locally before network transmission

```kotlin
@Entity(tableName = "outbox")
data class OutboxEntry(
    @PrimaryKey
    val id: String = Uuid.random().toString(),
    val entityType: String,
    val entityId: String,
    val operation: Operation,
    val payload: String,
    val createdAt: Long = Clock.System.now().toEpochMilliseconds(),
    val retryCount: Int = 0,
    val lastError: String? = null,
    val nextRetryAt: Long? = null
)

enum class Operation {
    CREATE, UPDATE, DELETE
}

@Dao
interface OutboxDao {
    @Query("SELECT * FROM outbox ORDER BY createdAt ASC")
    fun observeAll(): Flow<List<OutboxEntry>>

    @Query("SELECT * FROM outbox WHERE nextRetryAt IS NULL OR nextRetryAt <= :now ORDER BY createdAt ASC")
    suspend fun getPendingEntries(now: Long = Clock.System.now().toEpochMilliseconds()): List<OutboxEntry>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(entry: OutboxEntry)

    @Delete
    suspend fun delete(entry: OutboxEntry)
}
```

---

Parent doc: [offline-first-architecture.md](offline-first-architecture.md)
