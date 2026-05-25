---
scope: [architecture, agp9, module-boundary, android-kmp-library]
sources: [android-gradle-plugin, kotlin-multiplatform, webfetch:https://github.com/jetbrains/kotlin-multiplatform-dev-docs/blob/master/topics/development/multiplatform-project-agp-9-migration.md@2026-05-25]
targets: [android, desktop, ios]
slug: kmp-project-structure-agp9
status: active
layer: L0
category: architecture
description: "AGP 9 module boundary rule: Android-KMP library plugin migration (com.android.kotlin.multiplatform.library), structural split when entry point is in shared module, migration steps"
version: 1
last_updated: "2026-05"
parent: kmp-architecture-modules
monitor_urls:
  - url: "https://github.com/google/android-gradle-plugin/releases"
    type: github-releases
    tier: 1
---

# AGP 9 Module Boundary Rule

AGP 9 forbids using `com.android.application` plugin inside a multiplatform module. L1/L2 projects must migrate to the Android-KMP library plugin.

## Primary: Android-KMP Library Plugin Migration

KMP modules that previously used `kotlin.androidTarget {}` must migrate to the dedicated Android-KMP library plugin:

```kotlin
// build.gradle.kts — AGP 9 KMP library (replaces kotlin.androidTarget {})
plugins {
    alias(libs.plugins.androidMultiplatformLibrary)  // com.android.kotlin.multiplatform.library
    alias(libs.plugins.kotlinMultiplatform)
}

kotlin {
    androidLibrary {  // replaces androidTarget {}
        namespace = "com.example.mymodule"
        compileSdk = 35
        minSdk = 26
    }
    // ... other targets
}
```

Plugin ID: `com.android.kotlin.multiplatform.library` (alias: `androidMultiplatformLibrary`)
Block: `kotlin.androidLibrary {}` replaces `kotlin.androidTarget {}`

**Backport**: AGP 9 support is available in CMP 1.9.3+ and 1.10.0+. This is not exclusive to CMP 1.11.0+.

## Secondary: Structural Split (when entry point is in shared module)

When the Android application entry point (`@HiltAndroidApp`, `MainActivity`) lives inside the shared KMP module, AGP 9 requires a structural split:

**Before (monolith):**
```
composeApp/          ← Android app entry point + KMP shared code mixed
```

**After (split):**
```
shared/              ← Pure KMP (commonMain, jvmMain, appleMain, androidMain logic)
androidApp/          ← Android application plugin only (MainActivity, Application class)
desktopApp/          ← Desktop application only (main() entry point)
```

L0 flat naming applies to all new modules in this world: `shared`, `androidApp`, `desktopApp` (or `core-X` for library modules).

## Migration Steps

1. Audit current modules — identify any using `com.android.application` inside a KMP module
2. Extract the Android entry point (Activity, Application) into a standalone `androidApp` module with `com.android.application` plugin
3. Migrate the KMP library module to `com.android.kotlin.multiplatform.library` + `kotlin.androidLibrary {}`
4. Update `settings.gradle.kts` to include new flat-named modules
5. Adjust `dependencySubstitution` in composite build configuration if used

> **Reference**: [KMP AGP 9 Migration Guide](https://github.com/jetbrains/kotlin-multiplatform-dev-docs/blob/master/topics/development/multiplatform-project-agp-9-migration.md)

## See Also

- [kmp-architecture-modules](kmp-architecture-modules.md) — flat naming, Compose Resources, module boundaries
- [gradle-patterns-agp9](../gradle/gradle-patterns-agp9.md) — AGP 9 module templates, create-module.sh wrapper
- [kmp-architecture](kmp-architecture.md) — source set hierarchy and architecture patterns
