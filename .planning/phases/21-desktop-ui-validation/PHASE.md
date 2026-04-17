# Phase 21: Desktop Compose Runtime UI Validation (`compose-semantic-diff`)

## Intent

Close the "tests pass but app renders broken" bug class (memory
`feedback_ui_validation_broken.md`) on the **desktop Compose Multiplatform
JVM** target. Phase 19 shipped `android-layout-diff` for the Android CLI
path; Phase 19-02B revealed that DawSync's production UI lives in
`desktopApp`, not `androidApp` (memory `project_dawsync_desktop_primary.md`).

## Deliverables

- MCP tool #42 `compose-semantic-diff` + unit tests (structural diff +
  severity heuristics mirroring android-layout-diff).
- CLI wrappers for both `compose-semantic-diff` and retrofit
  `android-layout-diff` (Phase 19's `ui-validation.yml` referenced a CLI
  that did not yet exist).
- Consumer-side capture helper + Gradle task templates.
- Agent wiring: quality-gater Step 9.5 platform-aware, ui-specialist
  Rule 8.A / 8.B split.
- CI workflow extension: `desktop-semantic-diff` job alongside the
  existing android one.
- First L2 adoption in DawSync with regression repro.

## Plans

| # | Title | Blast | Status |
|---|---|---|---|
| 21-POC | `printToString()` schema + determinism | NONE | ✅ complete |
| 21-01 | MCP tool + CLI wrappers | LOW | ✅ complete |
| 21-02 | Capture template + Gradle task | LOW | 🔄 in progress |
| 21-03 | quality-gater Step 9.5 + ui-specialist Rule 8 | MEDIUM | pending |
| 21-04 | CI workflow extension | MEDIUM | pending |
| 21-05 | DawSync adoption + regression repro | HIGH | pending |

## Architectural Decisions (approved)

1. **Diff ownership** — in-test Kotlin assertion. The capture helper fails the
   test via JUnit when the current tree does not match the committed
   baseline. MCP tool is a diagnostic layer for structured findings, not a
   CI gatekeeper.
2. **Baseline format** — normalized text. `Node #N` and `@<hashcode>` are
   stripped at capture time (per 21-POC-FINDINGS.md) so the file is stable
   across JVM runs. Parser in the MCP tool decodes it into `SemanticNode[]`
   for severity heuristics.
3. **Template distribution** — `setup/templates/compose-semantic-diff/`
   ships the capture helper, Gradle task snippet, and baseline README.
   Propagation to consumers via manual copy or `/setup` in 21-02; deeper
   `/sync-l0` integration deferred to a follow-up phase.
4. **Schema parity** — `LayoutFinding` is shared between android-layout-diff
   and compose-semantic-diff. Dedupe keys prefixed by source so the two
   tools never collide under `/full-audit` deduplication.
5. **CLI wrappers retrofit** — built in 21-01 for BOTH tools. The retrofit
   closes Phase 19's aspirational `ui-validation.yml` reference.

## Residual Risks

See each plan's success criteria and the POC document's residual-risks
section. Key open items:

- Cross-OS (Linux CI) determinism — deferred to 21-04.
- Compose upgrade format churn — mitigation via pinned
  `libs.versions.toml` and a parser fixture test.
- `/sync-l0` template propagation — deferred to a follow-up; consumers
  adopt via `/setup` wizard or manual copy in the meantime.

## References

- `.planning/phases/21-desktop-ui-validation/21-POC-FINDINGS.md`
- `mcp-server/src/tools/compose-semantic-diff.ts`
- `mcp-server/src/tools/android-layout-diff.ts`
- memory `feedback_ui_validation_broken.md`
- memory `project_dawsync_desktop_primary.md`
