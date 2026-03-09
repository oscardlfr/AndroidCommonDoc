---
scope: [architecture, modules, compose-resources]
sources: [kotlin-multiplatform, compose-resources, android-gradle-plugin]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: architecture-hub
token_budget: 989
monitor_urls:
  - url: "https://kotlinlang.org/docs/multiplatform.html"
    type: doc-page
    tier: 2
description: "Module structure: flat naming, Compose Resources configuration, module boundaries, Compose screens in commonMain"
slug: kmp-architecture-modules
status: active
layer: L0
parent: kmp-architecture
category: architecture
rules:
  - id: flat-module-names
    type: naming-convention
    message: "Module names must be flat kebab-case (core-json-api), not nested (core:json:api) -- AGP 9+ bug"
    detect:
      forbidden_pattern: ".*:.*:.*"
      prefer: "flat-kebab-case"
    hand_written: false

---

# KMP Module Structure

## Overview

Module naming conventions, Compose Resources configuration, and module boundaries for KMP projects.

**Core Principle**: Use flat, hyphen-separated module names to avoid AGP 9+ circular dependency bugs. Place Compose Resources in `commonMain/composeResources/` by project convention.

---

## 1. Module Naming (Flat Names)

### Anti-Pattern: Nested Module Names

```kotlin
// BAD: Nested module names trigger AGP 9+ circular dependency resolution bug
include(":core:json:api")
include(":core:network:ktor")
```

### Correct: Flat Names

```kotlin
// FLAT hyphen-separated names avoid the AGP bug
include(":core-json-api")
include(":core-network-ktor")
```

**Key insight:** AGP 9.0+ has a known circular dependency bug with nested module paths. Always use flat module names.

## 2. Compose Resources Configuration

### Resource Location - MANDATORY

Resources MUST be in `src/commonMain/composeResources/` as a **project convention**.

> **Note**: Since Compose Multiplatform 1.6.10+, resources CAN be placed in any source set (including `androidMain`, `iosMain`, etc.). We use `commonMain` only as a project convention for simplicity and consistency across modules.

**Correct:**
```
core/designsystem/
  src/
      commonMain/
          composeResources/        <-- Resources HERE (project convention)
              values/strings.xml
              drawable/*.png
          kotlin/
```

**Avoid:**
```
core/designsystem/
  src/
      composeMain/                  <-- Custom source set
          composeResources/         <-- Avoid: breaks our convention
```

### Build Configuration

Add to `build.gradle.kts` (AFTER the `kotlin {}` block):

```kotlin
compose.resources {
    generateResClass = always
    publicResClass = true
    packageOfResClass = "com.project.module.resources"
}
```

### Dependencies

```kotlin
kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(compose.components.resources)
        }
    }
}
```

### Usage

```kotlin
import org.jetbrains.compose.resources.stringResource
import com.project.core.designsystem.resources.Res
import com.project.core.designsystem.resources.string.*

@Composable
fun MyScreen() {
    Text(stringResource(Res.string.common_loading))
}
```

## 3. Compose Screens in commonMain with Native SwiftUI

For projects using Compose Multiplatform for Android/Desktop and native SwiftUI for iOS/macOS:

```
feature/snapshot-list/
  commonMain/
      kotlin/
          ViewModels.kt         <-- Shared across all platforms
          ScreensKt             <-- Compose screens (Android + Desktop)
      composeResources/         <-- Compose Resources (if needed)
  androidMain/                  <-- Platform-specific Android code
  desktopMain/                  <-- Platform-specific Desktop code
  iosMain/                      <-- Platform-specific iOS code (NO Compose screens used)
```

**Key points**:
- Compose screens live in `commonMain` alongside ViewModels
- iOS/macOS targets don't use Compose screens -- they use native SwiftUI
- No custom `composeMain` source set needed
- ViewModels in `commonMain` are shared via XCFramework to iOS/macOS

## 4. Validation

Run `/verify-kmp` skill to check for:
- Forbidden imports in commonMain
- Duplicate code in platform source sets
- Missing actual implementations

---

**See [compose-resources-patterns.md](../compose/compose-resources-patterns.md) for complete Compose Resources guide.**

**Parent doc**: [kmp-architecture.md](kmp-architecture.md)
