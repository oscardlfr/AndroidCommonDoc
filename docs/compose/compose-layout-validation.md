---
scope: [compose, ui, quality]
sources: [compose-multiplatform, jetpack-compose]
targets: [android, desktop, ios, jvm]
version: 1
last_updated: "2026-04"
assumes_read: compose-hub
token_budget: 420
description: "Compose layout validation — catch common structural anti-patterns at build time. Runtime layout diffing is handled by android-layout-diff (Plan 19-02)."
slug: compose-layout-validation
status: active
layer: L0
parent: compose-patterns
category: compose
rules:
  - id: no-compose-tooling-in-production
    type: banned-import
    message: "Compose UI Tooling imports (@Preview) must not appear in production source sets — keep them in commonTest or a dedicated `-previews` module"
    detect:
      in_source_set: commonMain
      banned_import_prefixes:
        - "androidx.compose.ui.tooling"
      prefer: "move @Preview composables to commonTest or a -previews module"
    hand_written: false
validate_upstream:
  - url: "kb://android/develop/ui/compose/tooling/previews"
    assertions:
      - type: api_present
        value: "@Preview"
        context: "Our rule enforces @Preview placement — the API must still exist"
      - type: keyword_present
        value: "androidx.compose.ui.tooling"
        context: "Package we forbid in production — must exist upstream"
    on_failure: MEDIUM
---

# Compose Layout Validation

Static layout validation complements runtime layout diffing (`android-layout-diff`, Plan 19-02). This doc defines the build-time rules that catch structural anti-patterns before they ship.

## Why this matters

Most Compose layout bugs that survive tests have one of two shapes:

1. **Production pollutes with tooling-only code** — `@Preview` annotations and the `androidx.compose.ui.tooling` package leak into production source sets. Previews slow APK size, pull in test scaffolding, and break non-Android targets of a KMP build (the tooling package is Android-only).
2. **Silent render divergence** — a Composable renders blank or wrong state while tests still pass because tests only assert `testTag` presence, not actual bounds or content. This second class is solved by the runtime layout diff pipeline; this doc deals with the first.

## Rule: `no-compose-tooling-in-production`

Any `import androidx.compose.ui.tooling.*` in `commonMain` (or any main source set) is a violation. Preview annotations and helpers belong in:

- `commonTest` — if the preview exercises the composable under test
- A dedicated `-previews` module — if previews are an IDE-only authoring aid
- An Android-only source set (`androidMain`) — **only** when the Composable is Android-specific and the preview cannot cross-compile

### ❌ Bad

```kotlin
// src/commonMain/kotlin/ui/LoadingScreen.kt
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview  // ← violation: tooling in commonMain

@Composable
fun LoadingScreen() { /* ... */ }

@Preview  // ← Android-only, won't compile on iOS target
@Composable
private fun LoadingScreenPreview() = LoadingScreen()
```

### ✅ Good

```kotlin
// src/commonMain/kotlin/ui/LoadingScreen.kt
import androidx.compose.runtime.Composable

@Composable
fun LoadingScreen() { /* ... */ }

// ---------------------------------------------------------
// src/commonTest/kotlin/ui/LoadingScreenPreviews.kt
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview  // ← allowed in commonTest

@Preview
@Composable
private fun LoadingScreenPreview() = LoadingScreen()
```

## Relationship to runtime layout diff

This rule is a **necessary but not sufficient** check. Passing Detekt does not guarantee your layout actually renders correctly — that's what `android-layout-diff` (Plan 19-02) validates at runtime. The two together form the layout validation pipeline:

| Stage | What it catches | When it runs |
|---|---|---|
| `no-compose-tooling-in-production` (this rule) | Structural pollution, cross-platform breakage | Every build (Detekt) |
| `android-layout-diff` (Plan 19-02) | Blank screens, wrong content, bounds regressions | CI + optional local with device |

Skipping either leaves a class of bugs undetected.

## References

- [compose-hub](compose-hub.md) — hub of Compose patterns
- [compose-patterns](compose-patterns.md) — core Compose conventions
- Plan 19-02 — runtime layout-diff MCP tool
- Android CLI KB: `kb://android/develop/ui/compose/tooling/previews`
