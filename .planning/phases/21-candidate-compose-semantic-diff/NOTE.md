# Phase 21 Candidate: Desktop Compose Runtime UI Validation (`compose-semantic-diff`)

**Status:** Candidate — not yet scoped
**Origin:** Phase 19 retrospective (2026-04-17) — `android-layout-diff` cannot target Compose Multiplatform JVM desktop apps.
**Motivating memory:** `feedback_ui_validation_broken.md`, `project_dawsync_desktop_primary.md`

## Problem

Phase 19 shipped `android-layout-diff` (MCP tool #40) to close the "tests pass but app is broken" UI bug class. The tool works against any adb-authorized Android device by wrapping `android layout --pretty`. However:

- DawSync's production UI lives in **desktopApp** (Compose Multiplatform JVM). The androidApp module is a stub.
- Desktop JVM has no adb bridge and no exposed accessibility dump — `android-layout-diff` cannot reach it.
- The bug class the tool targets (empty UiState.Loading rendering blank, text drift, etc.) exists equally on desktop Compose.

So DawSync gets zero runtime UI validation from Phase 19 until this gap closes.

## Proposed scope

New MCP tool `compose-semantic-diff` + a companion desktopTest pattern in consumer projects.

### Tool surface (MCP)

```
Inputs:
  baseline_path: absolute path to committed baseline (.txt)
  current_path:  absolute path to a freshly captured semantic tree (.txt)

Outputs: LayoutFinding[] in the same schema as android-layout-diff
  (dedupe_key, severity, category, source, title, suggestion)
```

### Companion test pattern (consumer side)

```kotlin
@Test
fun `loading screen renders spinner`() {
    composeTestRule.setContent { LoadingScreen(state = Loading) }
    val captured = composeTestRule.onRoot().printToString(maxDepth = Int.MAX_VALUE)
    Files.writeString(Path("build/ui-snapshots/loading.current.txt"), captured)
    // Via a build step / CI, compose-semantic-diff reads current vs baselines/desktop/loading.txt
}
```

### Baseline location convention

```
baselines/
  desktop/             ← Phase 21
    loading.txt
    snapshot-list.txt
    error-network.txt
  android/             ← Phase 19 (existing)
    loading.json
    ...
```

Parallel directory structure, same semver rules (baseline updates in the same PR as UI changes).

### Integration points

- `quality-gater.md` Step 9.5 already blocks on HIGH findings from `android-layout-diff`. Extend to also consume `compose-semantic-diff` findings when baselines/desktop/ exists.
- `ui-specialist.md` Rule 8 "Runtime UI Validation" — add a sub-rule for desktop invocation path.
- CI: new job in `ui-validation.yml` that runs desktop tests and invokes the tool (no device needed — JVM-only).

## Non-goals (explicitly out of scope)

- Pixel-level screenshot diffing (Roborazzi-style) — fragile due to font rendering / OS differences.
- iOS / native target support — Compose iOS has different semantic exposure.
- Replacing `android-layout-diff` — the two coexist for their respective targets.

## Prerequisites

1. Understand `AndroidComposeTest.onRoot().printToString()` output format on JVM desktop (needs spike similar to Phase 19-POC).
2. Confirm `printToString()` output is deterministic across JVM runs and OS platforms (or document the variance).
3. Decide baseline format — raw `printToString()` or a normalized parsed form.

## Estimate

- POC (1 plan): capture 3 real `printToString()` outputs from DawSync desktopApp, document schema. ~2h.
- Plan 1: MCP tool skeleton + parser + tests. ~3-4h.
- Plan 2: quality-gater / ui-specialist wiring + CI. ~2h.
- Plan 3: DawSync adoption — baselines for top 5 screens + one reproduced regression. ~3h.

Total: ~10-12h across 4 plans. Phase 21 could run after Phase 20 (if any) or be inserted as v1.4 milestone.

## Related

- Phase 19-02A / 19-02B — android-layout-diff (shipped, Android-only)
- DawSync `baselines/README.md` — lists the limitation + pointer to this phase
- `feedback_ui_validation_broken.md` — original bug class description
