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
description: "Dependency management: version catalogs, imported catalogs, composite builds, build-time vs runtime complementarity, enterprise API/impl split, anti-patterns"
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
  - id: catalog-first
    type: workflow-rule
    message: "Check imported catalogs (sharedLibs) before adding deps to local libs.versions.toml"
    hand_written: true

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

## 1b. Importing Catalogs from Composite Builds

When consuming a shared library via composite build, import its version catalog to avoid duplicating dependency versions:

### settings.gradle.kts (consuming project)

```kotlin
includeBuild("../shared-kmp-libs") {
    dependencySubstitution {
        substitute(module("com.example.shared:core-result"))
            .using(project(":core-result"))
    }
}

dependencyResolutionManagement {
    versionCatalogs {
        create("sharedLibs") {
            from(files("../shared-kmp-libs/gradle/libs.versions.toml"))
        }
    }
}
```

This gives the consuming project two catalogs:
- `libs` — local `gradle/libs.versions.toml` (project-specific deps)
- `sharedLibs` — imported from the shared library (shared deps)

### Usage

```kotlin
// Module build.gradle.kts
dependencies {
    implementation(sharedLibs.kotlinx.coroutines.core)  // from shared catalog
    implementation(libs.app.specific.dep)                // from local catalog
}
```

### Catalog-First Rule

Before adding ANY dependency to local `libs.versions.toml`, check if it already exists in `sharedLibs`. Prefer the shared catalog to prevent version drift between projects sharing the same foundation.

> **Note**: `sharedLibs` is the L0 convention name (configurable per project). Plugin aliases from imported catalogs may not work in `plugins {}` blocks on some Gradle versions; library aliases work without issue.

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

### Build-Time vs Runtime (Complementarity)

Composite builds and `SharedSdk.init()` serve orthogonal roles that coexist without conflict:

| Layer | Mechanism | What it does |
|-------|-----------|-------------|
| **Build-time** (Gradle) | `includeBuild` + `dependencySubstitution` | Makes modules visible for compilation |
| **Runtime** (DI) | `SharedSdk.init(modules, config)` | Wires implementations, creates Koin DI graph |

A composite build makes `core-encryption` available to compile against. `SharedSdk.init()` creates the actual `EncryptionService` instance at app startup. Both are required; neither replaces the other.

> See also: [DI App Startup](../di/di-patterns-modules.md) for the runtime wiring pattern.

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

## 5. Enterprise Scale: API/Impl Split with runtimeOnly

For SDKs consumed by many apps, split each feature into API and impl modules:

```
core-encryption-api/    ← interfaces only (EncryptionService)
core-encryption-impl/   ← implementation (AesEncryptionService)
```

### Consumer's build.gradle.kts

```kotlin
dependencies {
    implementation(sharedLibs.core.encryption.api)       // compile against interface
    runtimeOnly(sharedLibs.core.encryption.impl)         // impl on classpath, invisible in code
}
```

**Why `runtimeOnly`**: The consumer's code never imports impl classes. If someone tries `import ...impl.AesEncryptionService`, the compiler fails. Only `SharedSdk.init()` discovers and wires `runtimeOnly` implementations at runtime via Koin.

**When to use**: Multiple consuming apps that need implementation swappability. For single-app projects, plain `implementation` is simpler.

> Deep dive: [SDK Consumer Isolation](../archive/di-sdk-consumer-isolation.md) -- Level 2 (Interface + auto-discovery).
> Runtime wiring: [DI App Startup](../di/di-patterns-modules.md) -- SharedSdk.init().

---

**Parent doc**: [gradle-patterns.md](gradle-patterns.md)
