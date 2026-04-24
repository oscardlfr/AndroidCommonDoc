---
scope: [architecture, source-sets, hierarchy]
sources: [kotlin-multiplatform, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: architecture-hub
token_budget: 1484
monitor_urls:
  - url: "https://kotlinlang.org/docs/multiplatform.html"
    type: doc-page
    tier: 2
description: "Source set hierarchy: commonMain, jvmMain, appleMain, expect/actual, file naming, build.gradle.kts template"
slug: kmp-architecture-sourceset
status: active
layer: L0
parent: kmp-architecture
category: architecture
rules:
  - id: no-platform-deps-in-viewmodel
    type: banned-import
    message: "ViewModels must not import platform-specific APIs"
    detect:
      in_class_extending: ViewModel
      banned_import_prefixes:
        - "android."
        - "platform.UIKit"
        - "platform.Foundation"
    hand_written: true
    source_rule: NoPlatformDepsInViewModelRule.kt

---

# KMP Source Set Hierarchy

## Overview

Standard source set hierarchy for Kotlin Multiplatform projects. Relies on the automatic default hierarchy template (applied since Kotlin 1.9.20) with custom intermediate sets only when needed.

**Core Principle**: Never duplicate code across platform source sets. Use `jvmMain` for Android+Desktop shared JVM code and `appleMain` for iOS+macOS shared Apple code.

---

## 1. Source Set Hierarchy

```
CommonMain (pure Kotlin, interfaces, expects)
|
+-- JvmMain (Desktop + Android shared - java.* APIs)
|   +-- DesktopMain
|   +-- AndroidMain
|
+-- AppleMain (iOS + macOS shared - platform.Foundation.* APIs)
    +-- IosMain (optional, only if iOS-specific needed)
    |   +-- IosX64Main
    |   +-- IosArm64Main
    |   +-- IosSimulatorArm64Main
    +-- MacosMain (optional, only if macOS-specific needed)
        +-- MacosArm64Main
        +-- MacosX64Main
```

## 2. When to Use Each Source Set

| Source Set | Use When | Example APIs |
|------------|----------|--------------|
| `commonMain` | Pure Kotlin code, no platform APIs | `kotlinx.datetime`, `kotlinx.coroutines` |
| `jvmMain` | Shared JVM code (Android + Desktop) | `java.time.*`, `java.util.UUID`, `java.io.*` |
| `appleMain` | Shared Apple code (iOS + macOS) | `platform.Foundation.*`, `NSData`, `NSUUID` |
| `iosMain` | iOS-specific only (rare) | `platform.UIKit.*` |
| `macosMain` | macOS-specific only (rare) | `platform.AppKit.*` |
| `androidMain` | Android-only APIs | `android.*`, `androidx.*` |
| `desktopMain` | Desktop-only APIs | `javax.swing`, `java.awt` |

## 3. build.gradle.kts Template

Since Kotlin 1.9.20, the default hierarchy template is applied automatically when you declare targets. Source sets like `appleMain`, `iosMain`, `macosMain`, and their test counterparts are auto-created with the correct `dependsOn` relationships. You only need to `get` them to add dependencies.

> **Note on `jvmMain`**: The default hierarchy template creates `jvmMain` only for the `jvm()` target. When using `jvm("desktop")` alongside `androidLibrary`, both `desktopMain` and `androidMain` are direct children of `commonMain` by default. To share JVM code between Android and Desktop, you need a **custom intermediate source set** (shown below as `jvmSharedMain`).

```kotlin
kotlin {
    androidLibrary {
        namespace = "com.example.module"
        compileSdk = 36
        minSdk = 26
    }

    jvm("desktop") {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    iosX64()
    iosArm64()
    iosSimulatorArm64()
    macosArm64()
    macosX64()

    // appleMain, iosMain, macosMain and leaf source sets are auto-created
    // by the default hierarchy template. Only declare sourceSets you need
    // to configure (add deps or create custom intermediate sets).

    sourceSets {
        val commonMain by getting { /* pure Kotlin deps */ }
        val commonTest by getting { /* test deps */ }

        // Custom intermediate set: share JVM code between Android + Desktop.
        // The default template does NOT create this automatically because
        // jvm("desktop") and androidLibrary are separate target types.
        val jvmSharedMain by creating {
            dependsOn(commonMain)
        }
        val androidMain by getting {
            dependsOn(jvmSharedMain)
        }
        val desktopMain by getting {
            dependsOn(jvmSharedMain)
        }

        // appleMain, iosMain, macosMain are auto-created by the default
        // hierarchy template -- just `get` them if you need to add deps.
        val appleMain by getting { /* shared Apple deps */ }
        val iosMain by getting { /* iOS-specific deps, if any */ }
        val macosMain by getting { /* macOS-specific deps, if any */ }
    }
}
```

## 4. Expect/Actual Pattern

```kotlin
// commonMain: define the interface
expect fun createTempId(): String

// jvmMain: JVM implementation
actual fun createTempId(): String = java.util.UUID.randomUUID().toString()

// appleMain: Apple implementation
actual fun createTempId(): String = platform.Foundation.NSUUID().UUIDString()
```

## 5. File Naming Convention

| Source Set | File Suffix |
|------------|-------------|
| `commonMain` | `.kt` |
| `jvmMain` | `.jvm.kt` |
| `appleMain` | `.apple.kt` |
| `androidMain` | `.android.kt` |
| `desktopMain` | `.desktop.kt` |
| `iosMain` | `.ios.kt` |
| `macosMain` | `.macos.kt` |

## 6. Anti-Patterns

### Duplicate JVM Code (androidMain + desktopMain)

**DON'T:**
```
// BAD: Same JVM code duplicated -- maintenance burden and drift risk
androidMain/DateTimeUtils.android.kt  (uses java.time.*)
desktopMain/DateTimeUtils.desktop.kt  (identical code)
```

**DO:**
```
// jvmMain is shared by both androidMain and desktopMain
jvmMain/DateTimeUtils.jvm.kt  (single implementation)
```

### Duplicate Apple Code (iosMain + macosMain)

**DON'T:**
```
// BAD: Same Foundation code duplicated
iosMain/TimestampProvider.ios.kt     (uses platform.Foundation.*)
macosMain/TimestampProvider.macos.kt (identical code)
```

**DO:**
```
// appleMain is shared by both
appleMain/TimestampProvider.apple.kt (single implementation)
```

### Platform Code in CommonMain

**DON'T:**
```kotlin
// BAD: java.io.* imports in commonMain -- won't compile on iOS/macOS
import java.io.File
```

**DO:**
```kotlin
// commonMain: define interface; platform source sets: implement
expect fun createTempId(): String
```

---

**Parent doc**: [kmp-architecture.md](kmp-architecture.md)

## See Also

- [KMP Features & Platform Capability Matrix (2026)](kmp-features-2026.md) — per-platform support tiers for file IO, networking, coroutines, Compose UI, and more
