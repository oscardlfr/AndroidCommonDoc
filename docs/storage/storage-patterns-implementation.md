---
scope: [storage, data-persistence, encryption, migration]
sources: [android-storage, ios-storage, sqldelight, datastore, mmkv]
targets: [android, desktop, ios, macos, jvm]
version: 1
last_updated: "2026-03"
assumes_read: storage-hub
token_budget: 1704
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/room"
    type: doc-page
    tier: 2
description: "Storage implementation details: platform models, encryption wrappers, KMP expect/actual, DI integration, migration patterns, anti-patterns"
slug: storage-patterns-implementation
status: active
layer: L0
parent: storage-patterns
category: storage
rules:
  - id: no-platform-storage-in-common
    type: banned-import
    message: "Never use platform-specific storage APIs in commonMain; use expect/actual"
    detect:
      in_source_set: commonMain
      banned_import_prefixes:
        - "android.content.SharedPreferences"
        - "android.database.sqlite"
      prefer: "expect/actual + multiplatform-settings / Room"
    hand_written: false

---

# KMP Storage: Implementation Details

## Overview

Platform-specific storage models, transparent encryption wrappers, KMP expect/actual patterns for storage factories, DI integration, migration strategies, and common anti-patterns.

---

## 1. Platform Storage Models

### Android

| Category | Legacy | Modern |
|----------|--------|--------|
| Key-value | SharedPreferences | Jetpack DataStore (Preferences) |
| Structured K-V | -- | Jetpack DataStore (Proto) |
| Relational | SQLite | Room / SQLDelight |
| Secure | -- | EncryptedSharedPreferences, Android Keystore |
| Caching | DiskLruCache | OkHttp Cache, Coil disk cache |

### iOS / macOS

| Category | Mechanism |
|----------|-----------|
| Key-value | UserDefaults |
| Relational | Core Data / SQLDelight |
| Secure | Keychain Services |
| Caching | URLCache, NSCache |

### Desktop / JVM

| Category | Mechanism |
|----------|-----------|
| Key-value | java.util.prefs.Preferences, file-based |
| Relational | SQLDelight, H2, SQLite |
| Secure | JVM KeyStore, file-based encryption |
| Caching | File-based, in-memory |

**Common pattern:** All platforms support key-value and relational models. SQLDelight works across all KMP targets.

---

## 2. Storage Category Interfaces

### Key-Value Storage

```kotlin
// commonMain
interface KeyValueStore {
    suspend fun getString(key: String, default: String = ""): String
    suspend fun putString(key: String, value: String)
    suspend fun getBoolean(key: String, default: Boolean = false): Boolean
    suspend fun putBoolean(key: String, value: Boolean)
    suspend fun remove(key: String)
    suspend fun clear()
}
```

### Relational Storage

```kotlin
// commonMain
interface SnapshotRepository {
    suspend fun getAll(): Result<List<Snapshot>>
    suspend fun getById(id: String): Result<Snapshot?>
    suspend fun search(query: String): Result<List<Snapshot>>
    suspend fun insert(snapshot: Snapshot): Result<Unit>
    suspend fun delete(id: String): Result<Unit>
}
```

### Secure / Encrypted Storage

```kotlin
// commonMain
interface SecureStore {
    suspend fun getSecret(key: String): String?
    suspend fun putSecret(key: String, value: String)
    suspend fun deleteSecret(key: String)
    suspend fun hasSecret(key: String): Boolean
}
```

---

## 3. Transparent Encryption Wrapper

Encrypt at the storage boundary. Business logic works with plain data; the storage implementation handles encryption/decryption transparently.

```kotlin
// commonMain: Business logic does not know about encryption
class SaveCredentialsUseCase(private val secureStore: SecureStore) {
    suspend operator fun invoke(token: String) {
        secureStore.putSecret("auth_token", token)  // Encryption happens inside
    }
}

// androidMain: Implementation encrypts transparently
class AndroidSecureStore(private val context: Context) : SecureStore {
    private val encryptedPrefs = EncryptedSharedPreferences.create(/* ... */)

    override suspend fun putSecret(key: String, value: String) {
        withContext(Dispatchers.IO) {
            encryptedPrefs.edit().putString(key, value).apply()
        }
    }
}
```

### Key Rotation

Design for key rotation from day one. Store a key version alongside encrypted data so the system can decrypt with old keys and re-encrypt with new keys during migration.

---

## 4. KMP expect/actual for Storage

### Interface in commonMain

```kotlin
interface StorageFactory {
    fun createKeyValueStore(): KeyValueStore
    fun createSecureStore(): SecureStore
    fun createDatabaseDriver(): SqlDriver
}
```

### Platform Implementations

```kotlin
// androidMain
class AndroidStorageFactory(private val context: Context) : StorageFactory {
    override fun createKeyValueStore(): KeyValueStore = DataStoreKeyValueStore(context)
    override fun createSecureStore(): SecureStore = AndroidSecureStore(context)
    override fun createDatabaseDriver(): SqlDriver = AndroidSqliteDriver(Schema, context, "app.db")
}

// iosMain
class IosStorageFactory : StorageFactory {
    override fun createKeyValueStore(): KeyValueStore = UserDefaultsKeyValueStore()
    override fun createSecureStore(): SecureStore = KeychainSecureStore()
    override fun createDatabaseDriver(): SqlDriver = NativeSqliteDriver(Schema, "app.db")
}
```

### Testing: In-Memory Fakes

```kotlin
// commonTest
class InMemoryKeyValueStore : KeyValueStore {
    private val store = mutableMapOf<String, Any>()
    override suspend fun getString(key: String, default: String) = store[key] as? String ?: default
    override suspend fun putString(key: String, value: String) { store[key] = value }
    // ...
}
```

---

## 5. Migration Patterns

### SharedPreferences to DataStore

Migrate incrementally: read from DataStore first, fall back to SharedPreferences, write to DataStore only. Once all keys are migrated, remove the SharedPreferences fallback.

### Unencrypted to Encrypted Storage

1. Read existing plain-text data
2. Write to new encrypted store
3. Delete plain-text data
4. Update the storage binding to point to encrypted store

**Rule:** Never leave plain-text copies after migration. The migration must be atomic per-key.

### Schema Versioning (Relational)

SQLDelight manages schema migrations via numbered `.sqm` files. Each migration file contains the SQL needed to transform the schema from version N to N+1. Run all pending migrations at app startup before any queries execute.

---

## 6. Anti-Patterns

| Anti-Pattern | Why It Fails | Correct Approach |
|---|---|---|
| Sensitive data in plain key-value stores | Data readable by other apps, backup extraction | Use platform secure storage (Keystore/Keychain) |
| Platform storage APIs in `commonMain` | Won't compile on other targets | Use expect/actual or interfaces |
| Synchronous I/O on main thread | ANR on Android, frozen UI everywhere | Use `suspend` functions, `withContext(Dispatchers.IO)` |
| Skipping schema migrations | Data loss or crashes on app update | Always version schemas, write migration scripts |
| Hardcoded encryption keys in source | Keys extractable from APK/IPA | Use platform key storage (Keystore/Keychain/JVM KeyStore) |
| Storing large blobs in key-value stores | Performance degradation, memory pressure | Use file storage or relational DB for large data |

---

Parent doc: [storage-patterns.md](storage-patterns.md)
