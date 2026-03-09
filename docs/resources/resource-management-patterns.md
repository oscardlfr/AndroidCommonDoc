---
scope: [resources, lifecycle, memory]
sources: [android-lifecycle, compose-runtime]
targets: [android, desktop, ios]
version: 3
last_updated: "2026-03"
assumes_read: resources-hub
token_budget: 581
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 2
description: "Hub doc: Resource lifecycle and memory management patterns for desktop coexistence"
slug: resource-management-patterns
status: active
layer: L0
parent: resource-management
category: resources
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

---

# Resource-Intensive Application Coexistence Patterns

---

## Overview

Patterns for managing CPU/memory resources in Compose Desktop applications that coexist with external heavyweight processes (3D renderers, video editors, scientific computation tools).

**Core Principle**: Apps that coexist with resource-intensive external applications must back off when the user is working in those applications. Focus-based resource management ensures smooth coexistence.

### Key Rules

- Only run intensive tasks when app has window focus
- Detect when external heavyweight application is active and back off
- Use processing modes: SILENT (0% CPU), LOW_PRIORITY (2%), FULL_SPEED (20%)
- Use SupervisorJob + structured scopes for background tasks (never GlobalScope)
- Always add shutdown hooks with timeouts (5-30 seconds) for cleanup

---

## Sub-documents

This document is split into focused sub-docs for token-efficient loading:

- **[resource-management-lifecycle](resource-management-lifecycle.md)**: Lifecycle patterns -- window focus detection, process monitoring, processing mode state machine, coroutine scope management
- **[resource-management-memory](resource-management-memory.md)**: Resource management -- resource-aware file watching, graceful shutdown, anti-patterns, testing patterns

---

## Quick Reference

| Processing Mode | CPU Budget | When Active |
|-----------------|-----------|-------------|
| SILENT | 0% | External heavyweight app has focus |
| LOW_PRIORITY | 2% | App in background, no external app |
| FULL_SPEED | 20% | App has window focus |

---

## References

- [Compose Desktop documentation](https://www.jetbrains.com/lp/compose-multiplatform/)
- [Kotlin coroutines structured concurrency](https://kotlinlang.org/docs/coroutines-guide.html)

---

**Status**: Active -- Desktop apps coexisting with heavyweight processes must follow these patterns.
**Last Validated**: March 2026 with Compose Multiplatform 1.8.x / Java 17+
