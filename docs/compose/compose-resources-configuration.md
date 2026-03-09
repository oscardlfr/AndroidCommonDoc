---
scope: [resources, compose, configuration]
sources: [compose-resources, compose-multiplatform, gradle]
targets: [android, desktop, ios]
version: 2
last_updated: "2026-03"
assumes_read: compose-hub
token_budget: 620
description: "Build configuration for Compose Multiplatform resources: generateResClass, source sets, multi-module setup"
slug: compose-resources-configuration
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

# Compose Resources: Build Configuration

## Overview

Build configuration patterns for Compose Multiplatform resources in multi-module KMP projects. Covers mandatory resource location, generateResClass settings, dependency configuration, and multi-module resource strategy.

**Core Principle**: Resources MUST be in `commonMain/composeResources` as a **project convention**. Use `generateResClass = always` for multi-module projects.

---

## Sub-documents

- **[compose-resources-configuration-setup](compose-resources-configuration-setup.md)**: Detailed setup -- multi-module resource strategy (SOLID compliance), shared vs feature resources, cross-module access, source set patterns, new module template, verification checklist

---

## Quick Reference

### Resource Location (Project Convention)

```
module/src/commonMain/composeResources/
├── values/strings.xml
├── drawable/*.png
└── font/*.ttf
```

### Required Build Configuration

```kotlin
compose.resources {
    generateResClass = always
    publicResClass = true  // or false for feature modules
    packageOfResClass = "com.yourproject.core.designsystem.resources"
}
```

### Configuration Values

| Property | Value | When to Use |
|----------|-------|-------------|
| `generateResClass` | `always` | Multi-module projects, composite builds (recommended) |
| `generateResClass` | `auto` | Simple single-module apps only |
| `publicResClass` | `true` | Shared resources (core/designsystem) |
| `publicResClass` | `false` | Feature-specific resources |

### Dependencies -- Must Be in commonMain

```kotlin
kotlin {
    sourceSets {
        commonMain.dependencies {
            implementation(compose.components.resources)
        }
    }
}
```

---

## References

- [Compose Multiplatform Resources](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-images-resources.html)
- Parent doc: [compose-resources-patterns.md](compose-resources-patterns.md)
