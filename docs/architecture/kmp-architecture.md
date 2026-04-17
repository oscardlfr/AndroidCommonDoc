---
scope: [architecture, source-sets, hierarchy]
sources: [kotlin-multiplatform, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
version: 3
last_updated: "2026-03"
assumes_read: architecture-hub
token_budget: 881
description: "Hub doc: KMP source set hierarchy, module structure, and architecture patterns"
slug: kmp-architecture
status: active
layer: L0
category: architecture

monitor_urls:
  - url: "https://kotlinlang.org/docs/multiplatform.html"
    type: doc-page
    tier: 2

rules:
  - id: no-platform-deps-in-viewmodel
    type: banned-import
    message: "ViewModels must not import platform-specific APIs (android.*, UIKit.*)"
    detect:
      in_class_extending: ViewModel
      banned_import_prefixes:
        - "android."
        - "platform.UIKit"
        - "platform.Foundation"
    hand_written: true
    source_rule: NoPlatformDepsInViewModelRule.kt
validate_upstream:
  - url: "https://kotlinlang.org/docs/multiplatform-expect-actual.html"
    assertions:
      - type: api_present
        value: "expect"
        context: "expect/actual is core KMP mechanism"
      - type: api_present
        value: "actual"
        context: "expect/actual is core KMP mechanism"
      - type: keyword_present
        value: "commonMain"
        context: "Primary shared source set"
    on_failure: HIGH
---

# KMP Source Set Architecture

---

## Overview

Standard source set organization and module structure for Kotlin Multiplatform projects. Relies on the automatic default hierarchy template (applied since Kotlin 1.9.20) with custom intermediate sets only when needed.

**Core Principle**: Never duplicate code across platform source sets when a shared intermediate source set exists (`jvmMain` for Android+Desktop, `appleMain` for iOS+macOS). Use flat module names.

### Key Rules

- Rely on the automatic default hierarchy template (applied since Kotlin 1.9.20); only call `applyDefaultHierarchyTemplate()` explicitly when reapplying after custom source set configuration
- `commonMain`: Pure Kotlin ONLY (no `android.*`, `java.*`, `platform.*` imports)
- `jvmMain`: Shared JVM code when Android + Desktop need same impl
- `appleMain`: Shared Apple code when iOS + macOS need same impl
- DO NOT duplicate code across `androidMain` + `desktopMain` -- use `jvmMain`
- FLAT module names: `core-json-api`, not `core:json:api` (AGP 9+ bug)

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[kmp-architecture-sourceset](kmp-architecture-sourceset.md)**: Source set hierarchy -- commonMain, jvmMain, appleMain, expect/actual, file naming, build.gradle.kts template
- **[kmp-architecture-modules](kmp-architecture-modules.md)**: Module structure -- flat naming, Compose Resources configuration, module boundaries, layer rules

---

## Quick Reference

| Source Set | Use When | Example APIs |
|------------|----------|--------------|
| `commonMain` | Pure Kotlin code, no platform APIs | `kotlinx.datetime`, `kotlinx.coroutines` |
| `jvmMain` | Shared JVM code (Android + Desktop) | `java.time.*`, `java.util.UUID` |
| `appleMain` | Shared Apple code (iOS + macOS) | `platform.Foundation.*`, `NSUUID` |
| `androidMain` | Android-only APIs | `android.*`, `androidx.*` |
| `desktopMain` | Desktop-only APIs | `javax.swing`, `java.awt` |

| File Source Set | Suffix |
|-----------------|--------|
| `commonMain` | `.kt` |
| `jvmMain` | `.jvm.kt` |
| `appleMain` | `.apple.kt` |
| `androidMain` | `.android.kt` |
| `desktopMain` | `.desktop.kt` |

---

## References

- [Kotlin Multiplatform docs](https://kotlinlang.org/docs/multiplatform.html)
- [KMP Gradle plugin reference](https://kotlinlang.org/docs/multiplatform-dsl-reference.html)
- Reference implementation: see your shared library's `core-error` module (if applicable)

---

**Status**: Active -- All KMP modules must follow this source set hierarchy.
**Last Validated**: April 2026 with Kotlin 2.3.20 / KMP Gradle Plugin 2.3.20
