---
scope: [storage, data-persistence, architecture]
sources: [sqldelight, datastore, mmkv, multiplatform-settings]
targets: [android, desktop, ios, macos, jvm]
version: 3
last_updated: "2026-03"
assumes_read: storage-hub
token_budget: 800
description: "Generic KMP storage patterns — storage categories, interface contracts, encryption boundaries, thin module architecture"
slug: storage-patterns
status: active
layer: L0
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
      prefer: "expect/actual + multiplatform-settings / SQLDelight"
    hand_written: false
---

# KMP Storage Patterns

## Storage Categories

Every storage decision starts with the category. Choose based on data characteristics:

| Category | When | KMP Libraries |
|----------|------|------------validate_upstream:
  - url: "https://developer.android.com/training/data-storage/room"
    assertions:
      - type: api_present
        value: "Room"
        context: "Room is primary database for KMP since 2.7"
      - type: keyword_present
        value: "Kotlin Multiplatform"
        context: "Room KMP support is critical"
      - type: deprecation_scan
        value: "Room"
        context: "Room must not be deprecated"
    on_failure: HIGH
---|
| **Key-value** | Preferences, flags, small primitives | multiplatform-settings, MMKV, DataStore |
| **Relational** | Structured queries, relationships, migrations | SQLDelight (all targets), Room (JVM only) |
| **Secure** | Tokens, passwords, API keys, encryption keys | Platform Keychain/KeyStore via expect/actual |
| **Cache** | Temporary data, evictable, in-memory | Pure Kotlin with eviction policies |
| **Encrypted KV** | Key-value + at-rest encryption | Decorator pattern over any KV store |

## Core Principles

1. **Interfaces in commonMain** — platform implementations in source sets
2. **Category-appropriate library** — don't use relational DB for key-value
3. **Encrypt at the storage boundary** — business logic works with plain data
4. **All I/O is async** — `suspend` functions, never block main thread
5. **Thin module pattern** — one module per storage backend, shared API interface

## Interface Contracts

```kotlin
// Key-value: simple typed get/put
interface KeyValueStorage {
    suspend fun getString(key: String, default: String = ""): String
    suspend fun putString(key: String, value: String)
    suspend fun remove(key: String)
    suspend fun clear()
}

// Secure: separate interface for sensitive data (NOT KeyValueStorage)
interface SecureStorage {
    suspend fun getSecret(key: String): String?
    suspend fun putSecret(key: String, value: String)
    suspend fun deleteSecret(key: String)
}

// Relational: domain repository pattern (not raw driver)
interface Repository<T> {
    suspend fun getAll(): Result<List<T>>
    suspend fun getById(id: String): Result<T?>
    suspend fun insert(item: T): Result<Unit>
    suspend fun delete(id: String): Result<Unit>
}
```

## Thin Module Architecture

Each storage backend is a separate module implementing a shared interface:

```
core-storage-api/       ← interfaces only (KeyValueStorage, SecureStorage)
core-storage-mmkv/      ← MMKV implementation of KeyValueStorage
core-storage-datastore/ ← DataStore implementation of KeyValueStorage
core-storage-secure/    ← Platform Keychain/KeyStore → SecureStorage
core-storage-sql/       ← SQLDelight driver factory
core-storage-cache/     ← In-memory cache with eviction (pure Kotlin)
core-storage-encryption/← Decorator: wraps any KeyValueStorage with encryption
```

Benefits: consumer picks only what they need, no transitive dependency bloat.

## Encryption Boundary Pattern

Business logic never sees encryption:

```kotlin
// Domain layer — no encryption awareness
class SaveTokenUseCase(private val secureStore: SecureStorage) {
    suspend operator fun invoke(token: String) = secureStore.putSecret("auth_token", token)
}
```

Platform secure storage handles encryption transparently via expect/actual.

For key-value encryption at rest, use the **decorator pattern**: wrap any `KeyValueStorage` with an encryption decorator that encrypts/decrypts values transparently.

## Related Documents

- **[storage-patterns-implementation](storage-patterns-implementation.md)**: Platform storage models (Android/iOS/Desktop), expect/actual factories, migration strategies, anti-patterns

## References

- [SQLDelight Multiplatform](https://sqldelight.github.io/sqldelight/)
- [Security Patterns](../security/security-patterns.md) — encryption, key management
- [KMP Architecture](../architecture/kmp-architecture.md) — expect/actual pattern
