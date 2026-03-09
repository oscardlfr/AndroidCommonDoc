---
scope: [resources, compose, configuration]
sources: [compose-resources, compose-multiplatform]
targets: [android, desktop, ios]
slug: compose-hub
status: active
layer: L0
category: compose
description: "Compose category hub: Compose Multiplatform resource management and UI patterns"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://github.com/JetBrains/compose-multiplatform/releases"
    type: github-releases
    tier: 1
  - url: "https://www.jetbrains.com/help/kotlin-multiplatform-dev/compose-images-resources.html"
    type: doc-page
    tier: 2
rules:
  - id: compose-resources-in-common-main
    type: naming-convention
    message: "Compose resources must be in commonMain/composeResources/, not platform-specific source sets"
    detect:
      resource_file_location: true
      required_parent_path: "commonMain/composeResources"
    hand_written: false

---

# Compose

Compose Multiplatform resource management and UI patterns.

> Resources in `commonMain/composeResources/`, `generateResClass = always`, unique package per module.

## Documents

| Document | Description |
|----------|-------------|
| [compose-resources-patterns](compose-resources-patterns.md) | Hub: overview, core principles, quick reference |
| [compose-patterns](compose-patterns.md) | Compose Multiplatform UI patterns and best practices |
| [compose-resources-configuration](compose-resources-configuration.md) | Build config — generateResClass, source sets, multi-module |
| [compose-resources-usage](compose-resources-usage.md) | Runtime usage — strings, images, fonts, dual system |
| [compose-resources-troubleshooting](compose-resources-troubleshooting.md) | Common issues: missing Res, duplicate registration, CI |
| [compose-resources-configuration-setup](compose-resources-configuration-setup.md) | Setup and initialization |

## Key Rules

- Resources MUST be in `commonMain/composeResources/` (project convention)
- `generateResClass = always` for multi-module projects
- Each module has its own resources with unique package names
