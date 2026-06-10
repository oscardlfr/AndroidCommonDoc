---
scope: [compose, multiplatform, tooling, preview]
sources: [compose-multiplatform]
targets: [android, desktop, ios]
version: 1
last_updated: "2026-06"
assumes_read: compose-hub
description: "CMP @Preview import — correct org.jetbrains namespace, uiToolingPreview accessor, and the androidx trap that compiles on desktop but breaks Android."
slug: compose-preview-multiplatform-import
status: active
layer: L0
category: compose
parent: compose-hub
sources_external:
  - "user-relayed L1 session finding 2026-06-10, verified against ComposePlugin.kt 1.10.3"
rules:
  - id: no-androidx-preview-in-commonmain
    type: banned-import
    message: "Use org.jetbrains.compose.ui.tooling.preview.Preview in commonMain, not androidx.compose.ui.tooling.preview.Preview — the androidx import compiles on desktop (CMP ships a transitive shim) but silently breaks Android builds."
    detect:
      in_source_set: commonMain
      banned_import_prefixes:
        - "androidx.compose.ui.tooling.preview"
      prefer: "org.jetbrains.compose.ui.tooling.preview.Preview via compose.components.uiToolingPreview dependency"
    hand_written: true
    candidate_detekt_rule: no-androidx-preview-in-common

---

# CMP @Preview Import Pattern

Compose Multiplatform requires the **JetBrains** `@Preview` annotation, not the AndroidX one, in shared source sets.

## The Trap: androidx in commonMain

```kotlin
// WRONG — compiles on desktop (CMP ships a transitive androidx shim)
// but silently breaks Android builds
import androidx.compose.ui.tooling.preview.Preview

@Preview
@Composable
fun MyComponentPreview() { ... }
```

This passes the desktop compiler because CMP 1.10.x ships a transitive shim for the androidx tooling namespace. The Android target does not receive the shim and fails at runtime or in the preview renderer.

## Correct Pattern

```kotlin
// CORRECT — works across all CMP targets
import org.jetbrains.compose.ui.tooling.preview.Preview

@Preview
@Composable
fun MyComponentPreview() { ... }
```

### Required Dependency

In the module's `build.gradle.kts`, add to `commonMain.dependencies`:

```kotlin
commonMain.dependencies {
    implementation(compose.components.uiToolingPreview)
}
```

### Coordinate Gotcha (CMP 1.10.x)

Do NOT use the raw Maven coordinate string directly:

```kotlin
// FRAGILE — no 1.10.3 artifact at this coordinate
// (only 1.10.0-beta01 / 1.11.0 published at this coordinate)
implementation("org.jetbrains.compose.ui:ui-tooling-preview:1.10.3")
```

Always use the **plugin-managed accessor** `compose.components.uiToolingPreview`. It is marked `@Deprecated` in ComposePlugin.kt 1.10.3 but resolves correctly for 1.10.x. The deprecation is a documentation migration artifact — the accessor remains the supported resolution path for 1.10.x consumers.

## Why This Matters (L0 Rule Candidate)

An L1 session found 44 accumulated files with the androidx import in commonMain. Root cause: desktop CI compiled cleanly (shim present), Android CI was deferred, so the rot went undetected across many PRs. A Detekt rule (`no-androidx-preview-in-common`) at the L0 layer catches this at lint time — see backlog entry `BL-L1-cmp-preview-detekt` filed 2026-06-10.

## Relationship to compose-layout-validation

[`compose-layout-validation`](compose-layout-validation.md) bans `androidx.compose.ui.tooling` imports broadly from production source sets (`no-compose-tooling-in-production` rule). This doc is complementary: it specifies the **correct JetBrains replacement** and documents the CMP 1.10.x coordinate gotcha for teams who have already adopted the JetBrains namespace.

---

*Source: user-relayed L1 session finding 2026-06-10, verified against ComposePlugin.kt 1.10.3.*
