---
scope: [storage, data-persistence, encryption, migration]
sources: [sqldelight, datastore, mmkv, multiplatform-settings]
targets: [android, desktop, ios, macos, jvm]
version: 2
last_updated: "2026-03"
assumes_read: storage-patterns
token_budget: 1700
description: "Storage implementation: platform models, expect/actual factories, DI, migration strategies, testing, anti-patterns"
slug: storage-patterns-implementation
status: active
layer: L0
parent: storage-patterns
category: storage
---

# KMP Storage: Implementation Details

## 1. Platform Storage Models

### Android

| Category | Library | Notes |
|----------|---------|-------|
| Key-value | MMKV, DataStore Preferences | MMKV for performance, DataStore for proto |
| Relational | SQLDelight, Room | SQLDelight for KMP, Room for Android-only |
| Secure | Android KeyStore | Hardware-backed on API 28+ |
| Cache | In-memory (pure Kotlin) | Eviction policies per use case |

### iOS / macOS

| Category | Library | Notes |
|----------|---------|-------|
| Key-value | multiplatform-settings (UserDefaults) | Or MMKV |
| Relational | SQLDelight (NativeSqliteDriver) | |
| Secure | Keychain Services | kSecClass queries |
| Cache | In-memory (pure Kotlin) | Shared with all targets |

### Desktop / JVM

| Category | Library | Notes |
|----------|---------|-------|
| Key-value | MMKV, DataStore, file-based | MMKV recommended for KMP parity |
| Relational | SQLDelight (JdbcSqliteDriver) | |
| Secure | JVM KeyStore + file encryption | No hardware backing |
| Cache | In-memory (pure Kotlin) | |

## 2. expect/actual Storage Factory

```kotlin
// commonMain — factory interface
expect class StorageFactory {
    fun createKeyValueStorage(): KeyValueStorage
    fun createSecureStorage(): SecureStorage
    fun createSqlDriver(schema: SqlSchema, name: String): SqlDriver
}

// androidMain
actual class StorageFactory(private val context: Context) {
    actual fun createKeyValueStorage() = MmkvKeyValueStorage()
    actual fun createSecureStorage() = AndroidKeystoreSecureStorage(context)
    actual fun createSqlDriver(schema, name) = AndroidSqliteDriver(schema, context, name)
}

// iosMain
actual class StorageFactory {
    actual fun createKeyValueStorage() = SettingsKeyValueStorage()
    actual fun createSecureStorage() = KeychainSecureStorage()
    actual fun createSqlDriver(schema, name) = NativeSqliteDriver(schema, name)
}
```

## 3. DI Integration

Storage modules register via Koin `module {}` declarations:

```kotlin
// Each thin module provides its own Koin module
val storageModule = module {
    single<KeyValueStorage> { MmkvKeyValueStorage() }
    single<SecureStorage> { get<StorageFactory>().createSecureStorage() }
    single<SqlDriver> { get<StorageFactory>().createSqlDriver(AppSchema, "app.db") }
}
```

Consumers pick which storage modules to include. The DI graph resolves the right implementation.

## 4. Testing Storage

```kotlin
// In-memory fakes for all storage interfaces
class InMemoryKeyValueStorage : KeyValueStorage {
    private val store = mutableMapOf<String, String>()
    override suspend fun getString(key: String, default: String) = store[key] ?: default
    override suspend fun putString(key: String, value: String) { store[key] = value }
    override suspend fun remove(key: String) { store.remove(key) }
    override suspend fun clear() { store.clear() }
}

// SQLDelight in-memory driver for tests
val testDriver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
    .also { AppSchema.create(it) }
```

E2E tests must cover the full chain: repository → datasource → driver → query → result.

## 5. Migration Strategies

### Schema Versioning (SQLDelight)
SQLDelight uses numbered `.sqm` files. Each migration transforms version N → N+1. Run all pending migrations at startup.

### Key-Value Migration
When switching backends (e.g., SharedPreferences → MMKV):
1. Read all keys from old store
2. Write to new store
3. Delete old store
4. Update DI binding

### Unencrypted → Encrypted
1. Read plain-text data
2. Write to encrypted store
3. Delete plain-text — **never leave plain copies**
4. Atomic per-key — crash-safe

## 6. Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|---|---|---|
| Platform APIs in `commonMain` | Won't compile on other targets | expect/actual or interfaces |
| Synchronous I/O on main thread | ANR/frozen UI | `suspend` + `withContext(Dispatchers.IO)` |
| Hardcoded encryption keys | Extractable from APK/IPA | Platform KeyStore/Keychain |
| Large blobs in key-value stores | Memory pressure, slow reads | File storage or relational DB |
| Skipping schema migrations | Data loss on update | Version schemas, write `.sqm` files |
| Single "god" storage module | Transitive dependency bloat | Thin modules: one per backend |

---

Parent doc: [storage-patterns.md](storage-patterns.md)
