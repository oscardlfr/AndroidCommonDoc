---
scope: [resources, compose, configuration, multi-module]
sources: [compose-resources, compose-multiplatform, gradle]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-03"
assumes_read: compose-hub
token_budget: 1266
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
description: "Detailed Compose resource setup: multi-module strategy, shared vs feature resources, cross-module access, source set patterns, new module template"
slug: compose-resources-configuration-setup
status: active
layer: L0
parent: compose-patterns
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

# Compose Resources: Detailed Setup and Multi-Module Strategy

## Overview

Detailed setup instructions for Compose Multiplatform resources in multi-module KMP projects, including SOLID-compliant resource strategy, cross-module resource access patterns, source set configuration, and new module templates.

---

## 1. Multi-Module Resource Strategy (SOLID Compliance)

### Shared Resources Pattern

**Structure**:
```
project/
├── core/designsystem/
│   └── commonMain/composeResources/
│       ├── values/strings.xml         # Common strings (loading, error, etc.)
│       └── drawable/ic_*.xml          # Shared icons
│
├── feature/snapshot-list/
│   └── commonMain/composeResources/
│       └── values/strings.xml         # Feature-specific strings only
│
└── feature/auth/
    └── commonMain/composeResources/
        └── values/strings.xml         # Auth-specific strings only
```

**Configuration**:

```kotlin
// core/designsystem/build.gradle.kts
compose.resources {
    generateResClass = always
    publicResClass = true  // Other modules can import
    packageOfResClass = "com.project.core.designsystem.resources"
}

// feature/snapshot-list/build.gradle.kts
compose.resources {
    generateResClass = always
    publicResClass = false  // Internal to this module
    packageOfResClass = "com.project.feature.snapshotlist.resources"
}
```

### Cross-Module Resource Access

```kotlin
// In feature/snapshot-list/

// Import from THIS module's resources
import com.project.feature.snapshotlist.resources.Res as FeatureRes
import com.project.feature.snapshotlist.resources.string.*

// Import from core/designsystem
import com.project.core.designsystem.resources.Res as DesignRes
import com.project.core.designsystem.resources.string.common_loading

@Composable
fun SnapshotListScreen() {
    Column {
        // Feature-specific string from THIS module
        Text(stringResource(FeatureRes.string.snapshot_list_title))

        // Common string from design system
        Text(stringResource(DesignRes.string.common_loading))
    }
}
```

**Key principle**: Each module owns its domain-specific resources. Don't put everything in core/designsystem.

---

## 2. Source Set Patterns with Compose Resources

### Standard Pattern (No Custom Source Sets)

For modules targeting only Compose platforms:

```kotlin
kotlin {
    androidLibrary { ... }
    jvm("desktop") { ... }

    sourceSets {
        commonMain.dependencies {
            implementation(compose.components.resources)
        }
    }
}
```

**Resource location**: `src/commonMain/composeResources/`

### Pattern for Compose + Native SwiftUI Projects

For projects using Compose for Android/Desktop and native SwiftUI for iOS/macOS:

```kotlin
kotlin {
    androidLibrary { ... }
    jvm("desktop") { ... }
    iosX64()
    iosArm64()
    iosSimulatorArm64()
    macosArm64()
    macosX64()

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(compose.components.resources)
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
            }
        }
    }
}
```

**Key principle**: Compose screens in `commonMain` are NOT used by iOS/macOS -- they use native SwiftUI screens that consume shared ViewModels via XCFramework.

---

## 3. Template: Adding Resources to New Module

```kotlin
// module/build.gradle.kts
plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.compose.multiplatform)
}

kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(compose.components.resources)
            implementation(project(":core:designsystem"))
        }
    }
}

// Add AFTER kotlin {} block
compose.resources {
    generateResClass = always
    publicResClass = true  // or false for feature modules
    packageOfResClass = "com.project.module.resources"
}
```

**Create directory structure**:
```bash
mkdir -p src/commonMain/composeResources/values
touch src/commonMain/composeResources/values/strings.xml
```

---

## 4. Verification Checklist

After configuration changes, verify:

```bash
# Clean and rebuild
./gradlew clean :core:designsystem:build

# Check generated files exist
ls -la core/designsystem/build/generated/compose/resourceGenerator/kotlin/

# Build feature modules that depend on resources
./gradlew :feature:snapshot-list:build
```

---

Parent doc: [compose-resources-configuration.md](compose-resources-configuration.md)
