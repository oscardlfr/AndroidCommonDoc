---
scope: [build, gradle, configuration]
sources: [gradle, android-gradle-plugin, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
version: 3
last_updated: "2026-03"
assumes_read: gradle-hub
token_budget: 674
description: "Hub doc: Gradle build configuration patterns for KMP projects"
slug: gradle-patterns
status: active
layer: L0

monitor_urls:
  - url: "https://github.com/gradle/gradle/releases"
    type: github-releases
    tier: 1
  - url: "https://maven.google.com/web/index.html?q=com.android.tools.build#com.android.tools.build:gradle"
    type: maven-central
    tier: 1
category: gradle
# Rules live in sub-docs (gradle-patterns-dependencies.md is authoritative)

---

# KMP Gradle Patterns

---

## Overview

Standard Gradle patterns for Kotlin Multiplatform projects. A shared version catalog is the single source of truth for dependency versions. Convention plugins reduce boilerplate by 37-70%.

**Core Principle**: Flat module names, convention plugins for common configuration, composite builds for cross-project sharing.

### Key Rules

- Single version catalog (in your shared library project) is the authority for all dependency versions
- FLAT module names (`core-json-api`, not `core:json:api`) -- AGP 9+ circular dependency bug
- Convention plugins in `build-logic/` for module boilerplate (37-70% reduction)
- Composite builds with `dependencySubstitution` for cross-project sharing
- Resources MUST be in `src/commonMain/composeResources/` (not custom source sets)

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[gradle-patterns-dependencies](gradle-patterns-dependencies.md)**: Dependency management -- version catalogs, imported catalogs, composite builds, enterprise API/impl split, anti-patterns
- **[gradle-patterns-conventions](gradle-patterns-conventions.md)**: Convention plugins -- build-logic structure, KmpLibraryConventionPlugin, AGP 9.0 patterns
- **[gradle-patterns-publishing](gradle-patterns-publishing.md)**: Kover coverage -- configuration, verification rules, task reference, integration with coverage skills

---

## Quick Reference

| Pattern | Use When |
|---------|----------|
| Version catalog | All dependency versions |
| Convention plugin | Shared module configuration |
| Composite build | Cross-project module sharing |
| Imported catalog | Consuming shared deps from composite build |
| Flat module names | Always (AGP 9+ bug with nested) |
| `commonMain/composeResources/` | All Compose resources |

---

## References

- [Gradle documentation](https://docs.gradle.org)
- [KMP Gradle plugin](https://kotlinlang.org/docs/multiplatform-dsl-reference.html)
- [AGP migration guide](https://developer.android.com/build/migrate-to-agp)

---

**Status**: Active -- All KMP projects must follow these Gradle patterns.
**Last Validated**: April 2026 with Gradle 8.x / AGP 9.0 / Kotlin 2.3.20
