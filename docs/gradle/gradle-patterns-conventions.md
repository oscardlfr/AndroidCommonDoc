---
scope: [build, gradle, convention-plugins]
sources: [gradle, android-gradle-plugin, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: gradle-hub
token_budget: 607
monitor_urls:
  - url: "https://github.com/gradle/gradle/releases"
    type: github-releases
    tier: 1
description: "Convention plugins: build-logic structure, KmpLibraryConventionPlugin (AGP 9.0 / KMP), AndroidLibraryConventionPlugin (AGP 8.x / Android-only)"
slug: gradle-patterns-conventions
status: active
layer: L0
parent: gradle-patterns
category: gradle
rules:
  - id: flat-module-names
    type: naming-convention
    message: "Module names must be flat kebab-case (core-json-api), not nested (core:json:api) -- AGP 9+ circular dependency bug. AGP 8.x projects are NOT affected by this bug."
    applies_to: [kmp, agp-9]
    detect:
      include_build_subproject_name: true
      forbidden_pattern: ".*:.*:.*"
      prefer: "flat-kebab-case"
    hand_written: false

---

# Gradle Convention Plugins

## Overview

Patterns for convention plugins in KMP and Android-only projects.

**Core Principle**: Convention plugins centralize configuration and reduce boilerplate by 37-70%. Every module applies the appropriate convention plugin instead of duplicating build config.

| Project type | AGP | Convention plugin | Doc |
|---|---|---|---|
| KMP (Android + Desktop + iOS) | 9.0+ | `KmpLibraryConventionPlugin` | this doc |
| Android-only | 8.x | `AndroidLibraryConventionPlugin` | [gradle-patterns-android-only.md](gradle-patterns-android-only.md) |

> **AGP migration is not required** to adopt L0. Android-only projects on AGP 8.x
> can use all L0 patterns, Detekt rules, skills, and agents without upgrading AGP.

---

## 1. Build-Logic Structure

```
build-logic/
  build.gradle.kts
  settings.gradle.kts
  src/main/kotlin/
      ProjectConfig.kt
      KmpLibraryConventionPlugin.kt
      KmpComposeConventionPlugin.kt
```

### Benefits

- 37-70% boilerplate reduction
- Centralized configuration
- Easy to update all modules
- Consistent patterns across projects

## 2. KmpLibraryConventionPlugin

```kotlin
class KmpLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            with(pluginManager) {
                apply("org.jetbrains.kotlin.multiplatform")
                apply("com.android.kotlin.multiplatform.library")
            }

            extensions.configure<KotlinMultiplatformExtension> {
                androidLibrary {
                    compileSdk = ProjectConfig.compileSdk
                    minSdk = ProjectConfig.minSdk
                }

                jvm("desktop")
                iosX64(); iosArm64(); iosSimulatorArm64()
                macosArm64(); macosX64()
            }
        }
    }
}
```

## 3. AGP 9.0 Plugin Pattern

### New: android.kotlin.multiplatform.library

```kotlin
plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("com.android.kotlin.multiplatform.library")  // AGP 9.0+
}

kotlin {
    androidLibrary {  // Was android {} in AGP 8.x
        namespace = "com.example.module"
        compileSdk = 36
        minSdk = 26
    }
}
```

**Key insight:** AGP 9.0 changed the plugin ID and DSL for KMP Android libraries. Use `com.android.kotlin.multiplatform.library` and `androidLibrary {}` block. **Android-only projects on AGP 8.x use `com.android.library` and `android {}` — see [gradle-patterns-android-only.md](gradle-patterns-android-only.md).**

---

**Parent doc**: [gradle-patterns.md](gradle-patterns.md)  
**Android-only / AGP 8.x**: [gradle-patterns-android-only.md](gradle-patterns-android-only.md)
