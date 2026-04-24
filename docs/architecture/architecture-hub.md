---
scope: [architecture, source-sets, modules]
sources: [kotlin-multiplatform, kotlin-gradle-plugin]
targets: [android, desktop, ios, jvm]
slug: architecture-hub
status: active
layer: L0
category: architecture
description: "Architecture category hub: KMP source set hierarchy, module naming, and platform-specific patterns"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://kotlinlang.org/docs/multiplatform.html"
    type: doc-page
    tier: 2
  - url: "https://kotlinlang.org/docs/multiplatform-dsl-reference.html"
    type: doc-page
    tier: 3
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

# Architecture

KMP source set organization, module structure, and architecture enforcement patterns.

> **L0 Reference**: Core architecture patterns — use `kmp-architecture` as the canonical entry point.

## Documents

| Document | Description |
|----------|-------------|
| [kmp-architecture](kmp-architecture.md) | Hub: source set hierarchy, module structure, quick reference |
| [kmp-architecture-sourceset](kmp-architecture-sourceset.md) | Source sets — commonMain, jvmMain, appleMain, expect/actual, file naming |
| [kmp-architecture-modules](kmp-architecture-modules.md) | Module structure — flat naming, Compose Resources config, module boundaries |
| [layer-topology](layer-topology.md) | L0/L1/L2 layer model, flat vs chain topology, auto-sync setup |
| [kmp-supported-platforms-reference](kmp-supported-platforms-reference.md) | KMP + Compose MP platform stability matrix (2026) — citable reference |
| [kotlinx-io-reference](kotlinx-io-reference.md) | kotlinx-io Buffer/Source/Sink API reference — citable source for kmp-features-2026 |
| [kotlinx-coroutines-reference](kotlinx-coroutines-reference.md) | kotlinx.coroutines builders, Flow, Dispatchers reference — citable source for kmp-features-2026 |

## Key Rules

- Flat module names: `core-json-api` not `core:json:api` (AGP 9+ bug)
- `commonMain`: Pure Kotlin only — no `android.*`, `java.*`, `platform.*`
- Never duplicate across `androidMain`+`desktopMain` — use `jvmMain`
- No platform deps in ViewModels (enforced by `NoPlatformDepsInViewModelRule`)
