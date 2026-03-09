---
scope: [build, gradle, dependencies]
sources: [gradle, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-03"
assumes_read: gradle-hub
token_budget: 1034
monitor_urls:
  - url: "https://github.com/gradle/gradle/releases"
    type: github-releases
    tier: 1
description: "Dependency management: version catalogs, composite builds, default hierarchy template, anti-patterns"
slug: gradle-patterns-dependencies
status: active
layer: L0
parent: gradle-patterns
category: gradle
rules:
  - id: flat-module-names
    type: naming-convention
    message: "Module names must be flat kebab-case (core-json-api), not nested (core:json:api) -- AGP 9+ bug"
    detect:
      forbidden_pattern: ".*:.*:.*"
      prefer: "flat-kebab-case"
    hand_written: false

---

# Gradle Dependency Management

## Overview

Patterns for managing dependencies in KMP projects: version catalogs as single source of truth, composite builds for cross-project sharing, default hierarchy template, and module naming anti-patterns.

**Core Principle**: The shared library's version catalog is the single source of truth for all dependency versions. Composite builds enable cross-project module sharing without Maven publishing.

---

## 1. Version Catalogs (libs.versions.toml)

### Structure

```toml
[versions]
kotlin = "2.3.10"
agp = "9.0.0"
compose-multiplatform = "1.8.0"

[libraries]
# Group dependencies by category
kotlin-stdlib = { group = "org.jetbrains.kotlin", name = "kotlin-stdlib", version.ref = "kotlin" }

[plugins]
kotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }
```

### Best Practices

- Single source of truth for versions
- Group related dependencies
- Use version references (version.ref)
- Keep Android-specific deps in separate local catalog

## 2. Default Hierarchy Template

### Automatic Since Kotlin 1.9.20

The default hierarchy template is **applied automatically** since Kotlin 1.9.20 when you declare targets. You do NOT need to set any gradle.properties flag or call `applyDefaultHierarchyTemplate()` explicitly. Only call it if you need to reapply after custom source set configuration.

### Auto-Generated Source Sets

- nativeMain (all native targets)
- appleMain (iOS + macOS)
- iosMain (all iOS targets: iosX64, iosArm64, iosSimulatorArm64)
- macosMain (all macOS targets: macosArm64, macosX64)

### When to Use Custom Intermediate Sets

When business logic differs by platform category (e.g., producers vs consumers):

```kotlin
kotlin {
    sourceSets {
        val commonMain by getting

        // Custom intermediate set
        val producerMain by creating {
            dependsOn(commonMain)
        }

        val desktopMain by getting { dependsOn(producerMain) }
        val macosMain by getting { dependsOn(producerMain) }
    }
}
```

## 3. Composite Builds

### settings.gradle.kts

```kotlin
includeBuild("../your-shared-libs") {
    dependencySubstitution {
        substitute(module("com.example.shared:core-result"))
            .using(project(":core-result"))
    }
}
```

### Benefits

- Share modules across projects
- No need for Maven publishing during development
- Type-safe dependency resolution

## 4. Anti-Patterns

### Nested Module Names

**DON'T (Anti-pattern):**
```kotlin
// BAD: Nested module names cause AGP 9+ circular dependency bug
include(":core:json:api")    // Nested -- causes circular dependency
include(":core:json:impl")   // Nested -- causes circular dependency
```

**DO (Correct):**
```kotlin
// FLAT module names avoid the AGP 9+ circular dependency bug
include(":core-json-api")    // Flat -- safe
include(":core-json-impl")   // Flat -- safe
```

### Resources Outside commonMain (Convention Violation)

> **Note**: Since Compose Multiplatform 1.6.10+, resources CAN be placed in any source set. We use `commonMain` only as a project convention for simplicity.

**DON'T (Anti-pattern for our projects):**
```kotlin
// BAD: Breaks our project convention of keeping resources in commonMain
kotlin {
    sourceSets {
        val composeMain by creating {
            dependsOn(commonMain)
            // Resources here work technically (1.6.10+), but break our convention
        }
    }
}
```

**DO (Correct -- follow project convention):**
```kotlin
// Resources go in src/commonMain/composeResources/ by convention
kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(compose.components.resources)
        }
    }
}
```

---

**Parent doc**: [gradle-patterns.md](gradle-patterns.md)
