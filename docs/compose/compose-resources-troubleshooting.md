---
scope: [resources, compose, troubleshooting]
sources: [compose-resources, compose-multiplatform]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: compose-hub
token_budget: 1279
description: "Common issues and solutions for Compose Multiplatform resources: missing Res, duplicate registration, CI failures"
slug: compose-resources-troubleshooting
status: active
layer: L0
parent: compose-patterns

monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
category: compose
rules:
  - id: compose-resources-in-common-main
    type: naming-convention
    message: "Compose resources must be in commonMain/composeResources/"
    detect:
      resource_file_location: true
      required_parent_path: "commonMain/composeResources"
    hand_written: false

---

# Compose Resources: Troubleshooting

## Overview

Common issues, anti-patterns, and solutions when working with Compose Multiplatform resources. Each issue includes the root cause and a verified fix.

---

## 1. Anti-Patterns to Avoid

### 1.1 Resources in Custom Source Sets

**Wrong**:
```
feature/snapshot-list/
└── src/
    └── composeMain/
        └── composeResources/     <- NEVER!
```

**Right**:
```
feature/snapshot-list/
└── src/
    ├── commonMain/
    │   └── composeResources/     <- Always here
    └── composeMain/
        └── kotlin/               <- Only UI code
```

### 1.2 Static String Maps in desktopMain

**Wrong** (obsolete pattern):
```kotlin
// desktopMain/UiTextExtensions.desktop.kt
val stringMap = mapOf(
    "common_loading" to "Loading...",
    "error_network" to "Network error"
)
```

**Right**:
```kotlin
Text(stringResource(Res.string.common_loading))
```

### 1.3 generateResClass = auto in Multi-Module Projects

**Wrong**:
```kotlin
compose.resources {
    generateResClass = auto  // Unreliable in complex setups
}
```

**Right**:
```kotlin
compose.resources {
    generateResClass = always  // Reliable for multi-module + CI/CD
}
```

### 1.4 Mixing Android Resources with Compose Resources

**Wrong**:
```kotlin
// Android traditional resources in KMP module
android {
    sourceSets["main"].res.srcDirs("src/androidMain/res")
}
```

**Right**: Use ONLY Compose Resources in KMP modules

### 1.5 Missing publicResClass for Shared Resources

**DON'T:**
```kotlin
// core/designsystem/build.gradle.kts
compose.resources {
    publicResClass = false  // Other modules can't access!
}
```

**DO:**
```kotlin
compose.resources {
    publicResClass = true  // Shared resources must be public
}
```

### 1.6 Shared Resources Without Unique Packages

**DON'T:**
```kotlin
// Two modules with same default package causes Res class collision
compose.resources {
    generateResClass = always
    // No packageOfResClass -- collision!
}
```

**DO:**
```kotlin
// Each module gets a unique package for its Res class
compose.resources {
    generateResClass = always
    packageOfResClass = "com.project.core.designsystem.resources"
}
```

**Key insight:** Every module with Compose Resources must have a unique `packageOfResClass` to prevent Res class collision.

---

## 2. Common Issues and Solutions

### Issue 1: "Unresolved reference: Res"

**Cause**: Resources in wrong source set or build not executed

**Solution**:
1. Verify resources are in `commonMain/composeResources` (not `composeMain`)
2. Run clean build: `./gradlew clean :core:designsystem:build`
3. Invalidate IDE caches: Android Studio -> File -> Invalidate Caches / Restart
4. Check generated files exist: `build/generated/compose/resourceGenerator/`

### Issue 2: "Files can be a part of only one module" (Duplicate Registration)

**Cause**: Manually adding generated directory to custom source set

**Solution**: Remove manual source directory registration. Let plugin auto-register:

```kotlin
// Remove this if present
kotlin {
    sourceSets {
        val composeMain by getting {
            kotlin.srcDir("build/generated/compose/...")  // DELETE THIS
        }
    }
}
```

### Issue 3: Feature Module Can't Access Design System Resources

**Cause**: `publicResClass = false` or missing dependency

**Solution**:
```kotlin
// core/designsystem/build.gradle.kts
compose.resources {
    publicResClass = true  // Must be true
}

// feature/snapshot-list/build.gradle.kts
dependencies {
    implementation(project(":core:designsystem"))  // Add dependency
}
```

### Issue 4: Build Succeeds Locally But Fails in CI

**Cause**: `generateResClass = auto` + build cache issues

**Solution**: Always use `generateResClass = always` in production projects

---

## 3. Root build.gradle.kts Convention

Add this comment block to root `build.gradle.kts` for quick reference:

```kotlin
// Compose Resources Convention
// For modules with composeResources, add to build.gradle.kts:
//
//   compose.resources {
//     generateResClass = always
//     publicResClass = true          // For shared resources (core/designsystem)
//     packageOfResClass = "${namespace}.resources"
//   }
//
// Resources location: src/commonMain/composeResources/
// See androidCommonDoc/compose-resources-patterns.md for details
```

---

## References

- [Compose Multiplatform Resources](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-images-resources.html)
- Parent doc: [compose-resources-patterns.md](compose-resources-patterns.md)
