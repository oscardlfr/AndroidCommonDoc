---
scope: [storage, database, encryption, key-value]
sources: [room, sqldelight, multiplatform-settings, kotlinx-serialization]
targets: [android, desktop, ios, jvm]
slug: storage-hub
status: active
layer: L0
category: storage
description: "Storage category hub: Platform storage models, encryption layers, key-value vs relational, expect/actual"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://developer.android.com/jetpack/androidx/releases/room"
    type: doc-page
    tier: 2
  - url: "https://github.com/russhwolf/multiplatform-settings/releases"
    type: github-releases
    tier: 2
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

# Storage

Generic KMP storage patterns — platform models, encryption layers, key-value vs relational, expect/actual adapters.

> Use `expect/actual` to select platform storage implementation; never leak platform-specific APIs into `commonMain`.

## Documents

| Document | Description |
|----------|-------------|
| [storage-patterns](storage-patterns.md) | Hub: storage architecture, platform models, quick reference |
| [storage-patterns-implementation](storage-patterns-implementation.md) | Implementation patterns — Room, SQLDelight, multiplatform-settings |

## Key Rules

- Key-value: `multiplatform-settings` for small primitives; avoid `SharedPreferences` in `commonMain`
- Relational: `Room` for Android/Desktop JVM; `SQLDelight` for native iOS/macOS
- Encryption layer via `expect/actual` — `EncryptedSharedPreferences` on Android, `Keychain` on Apple
