---
scope: [resources, compose, configuration]
sources: [compose-resources, compose-multiplatform]
targets: [android, desktop, ios]
version: 3
last_updated: "2026-03"
assumes_read: compose-hub
token_budget: 683
description: "Hub doc: Compose Multiplatform resource management patterns"
slug: compose-resources-patterns
status: active
layer: L0

monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
parent: compose-patterns
category: compose
rules:
  - id: compose-resources-in-common-main
    type: naming-convention
    message: "Compose resources must be in commonMain/composeResources/, not platform-specific source sets"
    detect:
      resource_file_location: true
      required_parent_path: "commonMain/composeResources"
    hand_written: false

---

# Compose Multiplatform Resources - Patterns and Best Practices

---

## Overview

This document defines the authoritative patterns for managing resources in Kotlin Multiplatform projects using Compose Multiplatform. These patterns have been validated through analysis of 8 official JetBrains Compose Multiplatform projects and implemented successfully in production KMP projects.

**Core Principles**:
1. Resources MUST be in `commonMain/composeResources` as a **project convention** (since Compose Multiplatform 1.6.10+, resources CAN be placed in any source set -- we use `commonMain` only for simplicity and consistency)
2. Use `generateResClass = always` for multi-module projects
3. Each module has its own resources with unique package names (SOLID principle)
4. Dual resource system for Compose (Android/Desktop) + Swift (iOS/macOS)

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[compose-resources-configuration](compose-resources-configuration.md)**: Build configuration -- generateResClass, source sets, multi-module setup, dependency configuration
- **[compose-resources-usage](compose-resources-usage.md)**: Runtime usage -- string resources, image loading, fonts, qualifiers, dual Compose+Swift resource system, naming conventions, UiText pattern
- **[compose-resources-troubleshooting](compose-resources-troubleshooting.md)**: Common issues and solutions -- missing Res, duplicate registration, CI failures, anti-patterns

---

## Quick Reference

Resources in `commonMain/composeResources/`, `generateResClass = always`, unique package per module. See [compose-resources-configuration](compose-resources-configuration.md) for full build setup.

---

## Related Documentation

- [KMP Source Set Architecture](../architecture/kmp-architecture.md) - Standard source set hierarchy
- [UI and Screen Patterns](../ui/ui-screen-patterns.md) - How to use resources in screens

---

## References

- [Compose Multiplatform Resources](https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-images-resources.html)
- [Kotlin Multiplatform](https://kotlinlang.org/docs/multiplatform.html)

---

**Status**: Active | **Last Validated**: April 2026 with Compose Multiplatform 1.10.0 / Kotlin 2.3.20
