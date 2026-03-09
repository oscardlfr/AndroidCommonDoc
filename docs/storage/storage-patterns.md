---
scope: [storage, data-persistence, architecture]
sources: [android-storage, ios-storage, sqldelight, datastore, mmkv]
targets: [android, desktop, ios, macos, jvm]
version: 2
last_updated: "2026-03"
assumes_read: storage-hub
token_budget: 788
description: "Hub doc: Generic KMP storage patterns -- platform models, encryption layers, key-value vs relational, expect/actual for storage"
slug: storage-patterns
status: active
layer: L0

monitor_urls:
  - url: "https://github.com/sqldelight/sqldelight/releases"
    type: github-releases
    tier: 1
  - url: "https://developer.android.com/jetpack/androidx/releases/datastore"
    type: doc-page
    tier: 1
  - url: "https://github.com/Tencent/MMKV/releases"
    type: github-releases
    tier: 2
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

# KMP Storage Patterns

---

## Overview

Storage in KMP requires understanding platform differences and choosing the right abstraction level. Define storage interfaces in `commonMain` -- platform implementations in `androidMain`/`iosMain`/`desktopMain`.

**Core Principles**:
1. Define storage interfaces in `commonMain` -- platform implementations in source sets
2. Choose the storage category (key-value, relational, secure, cache) before choosing a library
3. Encrypt at the storage boundary -- business logic should not know about encryption
4. All storage I/O must be async (suspend functions) -- never block the main thread

---

## Sub-documents

- **[storage-patterns-implementation](storage-patterns-implementation.md)**: Implementation details -- platform storage models (Android/iOS/Desktop), encryption layer patterns, KMP expect/actual, DI integration, migration patterns, anti-patterns

---

## References

- [Jetpack DataStore Guide](https://developer.android.com/topic/libraries/architecture/datastore)
- [SQLDelight Multiplatform](https://sqldelight.github.io/sqldelight/2.0/multiplatform_sqlite/)
- [KMP Architecture](../architecture/kmp-architecture.md) -- expect/actual pattern
- [DI Patterns](../di/di-patterns.md) -- Platform-specific storage provider injection
