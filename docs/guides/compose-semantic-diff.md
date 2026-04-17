---
slug: compose-semantic-diff
category: guides
scope: [L1, L2]
sources:
  - file://mcp-server/src/tools/compose-semantic-diff.ts
  - file://.planning/phases/21-desktop-ui-validation/21-POC-FINDINGS.md
targets:
  - setup/templates/compose-semantic-diff/*.template
description: "Setup guide for runtime UI validation on Compose Multiplatform desktop (JVM). Sibling of android-layout-diff — same finding schema, different capture path (no adb, no device)."
---

# Compose Semantic Diff — Setup Guide

## When you need this

Your app's production UI target is **Compose Multiplatform JVM** (desktop),
and you want to catch the "tests pass but the app renders broken"
regression class — empty-state branch bugs, string-resource regressions,
missing components — at CI time.

If your production UI is Android, use `android-layout-diff` instead —
same finding schema, different capture tool. Both are documented in
`ui-specialist.md` Rule 8.

## How it works

1. A Kotlin helper captures the semantic tree via
   `composeTestRule.onRoot().printToString(Int.MAX_VALUE)` and normalizes
   the two unstable fields observed in 21-POC (`Node #N`, `@<hashcode>`).
2. In `verify` mode (default), the helper diffs against a committed
   baseline and fails the test on any drift.
3. In `capture` mode (via `-Pbaseline.update=true`), the helper writes
   the baseline so the UI author can commit it.
4. CI invokes both Gradle (`./gradlew verifyUiBaselines`) AND the MCP
   tool's CLI (`node ...compose-semantic-diff.js`) to produce structured
   findings for agents, on top of the primary test-time gate.

## Installing in a consumer project

### 1. Drop the capture helper

Copy the helper template to your shared testing module:

```bash
cp "$ANDROID_COMMON_DOC/setup/templates/compose-semantic-diff/compose-semantic-capture.kt.template" \
   "<consumer>/core/testing/src/desktopMain/kotlin/<your-pkg>/ui/ComposeSemanticCapture.kt"
# Then replace {{PACKAGE}} with your actual package path.
```

The helper depends only on `androidx.compose.ui.test` (already transitive
via `compose.uiTest`) and `kotlin.test.fail`. No extra Gradle dependencies
required.

### 2. Wire the Gradle tasks

Append the content of
`setup/templates/compose-semantic-diff/capture-ui-baselines.gradle.kts.template`
to your root `build.gradle.kts` (or into a convention plugin under
`build-logic/`). This adds two tasks:

- `./gradlew captureUiBaselines` — refreshes committed baselines
- `./gradlew verifyUiBaselines` — verifies current trees, wired to `check`

### 3. Seed the baselines directory

Create `baselines/desktop/` at the repo root and seed it with the
README from
`setup/templates/compose-semantic-diff/baselines-desktop-README.md.template`.
Add `build/ui-snapshots/` to `.gitignore`.

### 4. Write your first capture

In any feature's `desktopTest`:

```kotlin
@Test
fun `sessions empty state matches baseline`() = runComposeUiTest {
    setContent {
        DawSyncTheme {
            SessionsScreen(uiState = emptyUiState, onEvent = {}, ... )
        }
    }
    captureSemanticBaseline(screenName = "sessions-empty")
}
```

Then run `./gradlew captureUiBaselines` once to create
`baselines/desktop/sessions-empty.txt` and commit it.

## Baseline stability

Baselines are **byte-stable** within a JVM run (confirmed in 21-POC on
Windows 11, JDK 17). Across JVM runs, `Node #N` numbers and object
`@<hashcode>` suffixes vary — the capture helper strips both at write
time so committed baselines diff cleanly in git.

### Cross-OS status

As of 21-POC, determinism was measured only on Windows host. Linux CI
determinism is validated in 21-04 via the `desktop-semantic-diff` job on
`ubuntu-latest`. If font-metric differences cause coordinate drift, the
parser can be extended to bucket-round or omit bounds — identity relies
on `testTag` first, so runtime shape drift is unlikely.

## Updating baselines (intentional UI change)

```bash
./gradlew captureUiBaselines
git add baselines/desktop/
git commit -m "chore(ui): refresh desktop baselines for <reason>"
```

Always include the baseline refresh in the SAME commit as the UI change
that caused it. A design-system PR that does not refresh baselines is
caught by CI, not by review.

## Relation to other tools

| Tool | Capture | Gate | Use when |
|---|---|---|---|
| `compose-semantic-diff` | `printToString()` text, committed `.txt` | Kotlin `fail()` in `verifyUiBaselines` + MCP findings | Production UI on Compose desktop |
| `android-layout-diff` | `android layout --pretty` JSON | MCP tool at PR time, no in-test assertion | Production UI on Android |
| `compose-preview-audit` | `@Preview` annotation discovery | Count-based report | Any Compose — structural preview coverage |
| Screenshot diff (future) | Rendered PNG | Pixel comparison | High-fidelity visual regression |

## Troubleshooting

**`captureUiBaselines` ran but no file appeared.**
Confirm the test reached `captureSemanticBaseline()` — a test failure
earlier in the body skips the capture. Also check the working directory:
the helper writes relative to the Gradle project root, not the module.

**`verifyUiBaselines` fails locally but baseline looks correct in git.**
Likely `Node #N` or `@hashcode` drift that the normalizer missed. Check
the `build/ui-snapshots/<screen>.current.txt` file and compare against
the baseline — any remaining difference is a new unstable field the
normalizer needs to handle. Open a follow-up against
`mcp-server/src/tools/compose-semantic-diff.ts`
(`normalizePrintToString`) and the Kotlin helper's `normalize()`.

**Tool reports `capture_missing` in CI.**
The `verifyUiBaselines` step did not run or did not write to
`build/ui-snapshots/`. Confirm the Gradle task is wired on the changed
module.
