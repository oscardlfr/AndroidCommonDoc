---
scope: [agents, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-runtime-ui-validation
category: agents
description: "quality-gater Step 9.5 — Runtime UI Validation protocol (platform-aware). Android Layout Diff (Branch A) and Compose Semantic Diff (Branch B) dispatch. Skip conditions and block/escalate/allow thresholds."
---

# quality-gater: Runtime UI Validation (Step 9.5)

Referenced from [quality-gater](../../setup/agent-templates/quality-gater.md) Step 9.5.

**Skip if**: no baseline present for any screen touched by the diff AND no adb device / no desktop test capture available. Also skip if `PROJECT_TYPE` is not `gradle` or `hybrid`. Document "[STEP 9.5 SKIP] PROJECT_TYPE=$PROJECT_TYPE — Gradle-only step".

```bash
if [[ "$PROJECT_TYPE" == "gradle" || "$PROJECT_TYPE" == "hybrid" ]]; then
```

Detect platform from committed baselines and dispatch:

- **`baselines/android/*.json` present** → branch A (Android layout diff)
- **`baselines/desktop/*.txt` present** → branch B (Compose semantic diff)
- Both present → run both (findings are dedupe_key-prefixed, no collision)

## Branch A — Android Layout Diff (requires authorized adb device)

1. Invoke the `android-layout-diff` MCP tool with `baseline_path` pointing at the committed baseline and `device_serial` if multiple devices are connected.
2. Read the `<!-- FINDINGS_START --> ... <!-- FINDINGS_END -->` block from the tool output.
3. **BLOCK** on any HIGH finding (`removed + resource-id`) — this is the "tests pass but app is broken" signature.
4. **Escalate** MEDIUM findings (text drift, modified interactions) as pending items in the Summary; do not auto-fix copy regressions.
5. **Allow** LOW findings (anonymous additions, transient content) unless the PR specifically targets that element.

If the tool reports `cli_missing` / `adb_offline` / `multi_device`: do NOT BLOCK on absence of validation — record it as a Summary note pointing at `docs/guides/getting-started/android-cli-windows.md`.

## Branch B — Compose Semantic Diff (desktop JVM — no device required)

1. Ensure `./gradlew verifyUiBaselines` ran in the test suite (Step 9) — a failing desktop baseline already blocks at test time.
2. For each touched screen with a baseline at `baselines/desktop/<screen>.txt`, invoke the `compose-semantic-diff` MCP tool with that path as `baseline_path` and `build/ui-snapshots/<screen>.current.txt` as `current_path`.
3. **BLOCK** on any HIGH finding (`removed + testTag`) — same signature, different capture path.
4. **Escalate** MEDIUM findings (text drift, added tagged elements) as pending Summary items.
5. **Allow** LOW findings.

If the tool reports `capture_missing` (no current capture exists because Gradle didn't run `verifyUiBaselines`): record a Summary note and do NOT BLOCK on absence — Step 9 still has the test-time assertion. `parse_error` / `unknown` kinds → same: Summary note, not block.

```bash
else
  echo "[STEP 9.5 SKIP] PROJECT_TYPE=$PROJECT_TYPE — Gradle-only step"
fi
```

Step 9.5 is additive; Step 9's test suite remains the primary gate. The purpose of Step 9.5 is to produce structured findings for `/full-audit` and to double-check platform-specific runtime shape, not to be a second stop-line.
