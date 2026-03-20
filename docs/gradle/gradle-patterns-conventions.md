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

## 4. L0 Toolkit Plugin Distribution

The `androidcommondoc.toolkit` plugin applies Detekt rules, Compose rules, and test configuration. Every module that should be checked by Detekt needs this plugin — it's not inherited from the root project.

### Option A: Convention plugin (recommended — enterprise/clean)

Embed the toolkit in your project's convention plugin. Each module type gets the right config:

```kotlin
// build-logic/src/main/kotlin/KmpLibraryConventionPlugin.kt
class KmpLibraryConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("org.jetbrains.kotlin.multiplatform")
            pluginManager.apply("androidcommondoc.toolkit")  // ← Detekt for all KMP modules
            // ... rest of KMP config
        }
    }
}
```

```kotlin
// Each module just declares its convention plugin
// core/domain/build.gradle.kts
plugins {
    id("your-project.kmp-library")  // inherits toolkit automatically
}
```

**Benefits:**
- Granular: KMP modules get KMP config, Android-only get Android config
- No Detekt applied to modules without Kotlin sources (no warnings)
- Each convention plugin can customize `androidCommonDoc { }` DSL differently
- Standard enterprise pattern — passes code review

**Per-module customization:**
```kotlin
// Modules can override toolkit settings
androidCommonDoc {
    detektRules.set(true)        // default: true
    composeRules.set(true)       // default: true
    formattingRules.set(false)   // default: false (opt-in ktlint)
    testConfig.set(true)         // default: true
}
```

### Option B: subprojects (quick — dev/prototype)

Apply to all modules from root:

```kotlin
// root build.gradle.kts
subprojects {
    apply(plugin = "androidcommondoc.toolkit")
}
```

**Trade-offs:**
- Applies to EVERY subproject — including those without Kotlin sources
- No per-module customization
- May produce warnings on non-Kotlin modules
- Works immediately, no build-logic changes needed

**When to use:** prototyping, small projects (<10 modules), or as a quick fix before migrating to convention plugins.

### Migration path: subprojects → convention plugin

1. Create convention plugins in `build-logic/` for each module type
2. Add `pluginManager.apply("androidcommondoc.toolkit")` to each
3. Apply convention plugins to individual modules
4. Remove `subprojects { apply(...) }` from root
5. Verify with: `bash $ANDROID_COMMON_DOC/scripts/sh/check-detekt-coverage.sh --project-root .`

### Common mistake

Applying the toolkit only to the root project or only to JVM modules. Detekt 2.0 creates per-source-set tasks (`detektCommonMainSourceSet`, `detektDesktopMainSourceSet`, etc.) **per module**. A module without the plugin gets zero Detekt tasks.

Diagnostic: `bash $ANDROID_COMMON_DOC/scripts/sh/check-detekt-coverage.sh --project-root .`

---

**Parent doc**: [gradle-patterns.md](gradle-patterns.md)  
**Android-only / AGP 8.x**: [gradle-patterns-android-only.md](gradle-patterns-android-only.md)
