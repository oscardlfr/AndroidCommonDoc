# Phase 19: Android CLI Integration

**Milestone:** v1.3 Ecosystem Integration & UI Validation
**Depends on:** Phase 18 (GSD-2 migration complete)
**Planned:** 2026-04-17
**Approved plan:** `C:\Users\34645\.claude\plans\partitioned-hugging-grove.md`

## Goal

Integrate Google's Android CLI v0.7 (released 2026-04-16) into L0 AndroidCommonDoc and propagate capabilities via `/sync-l0` to L1 (shared-kmp-libs) and L2 (DawSync, WakeTheCave). Closes the DawSync "UI validation broken" gap (memory `feedback_ui_validation_broken.md`) via runtime layout diff validation.

## Motivation

- **DawSync #1 priority**: tests pass but app renders broken. Existing tests assert Compose tags, not visual rendering. `android screen capture --annotate` + `android layout --diff` are the canonical solution.
- **Upstream validation expansion**: `android docs search/fetch kb://...` becomes an additional official source alongside Context7/WebFetch.
- **Skills ecosystem**: Google's skills repo (`android/skills`, Apache 2.0) is discoverable via `android skills add` — L0 registry should know about them without fork debt.
- **Setup hardening**: `/setup` can detect Android CLI state on consumer projects.

## Architectural Decisions (approved 2026-04-17)

1. **Skills strategy — Option C (selective bridge)**: new skill `skills/android-skills-consume/SKILL.md` references Google's skills by slug. No content copy, no fork maintenance.
2. **MCP bridge — narrow mixto**: Bash direct invocation for read-only subcommands (`docs`, `screen`, `layout`, `skills:list`, `sdk:list`) via `.claude/settings.json` allowlist. Narrow MCP tool ONLY for stateful commands (`android run`, `android create`).
3. **Windows policy — physical device + CI Linux**: emulator disabled on Windows without official workaround. Dev uses USB-connected device via adb; CI Linux covers merge blocking.

## Requirements

- **AC-CLI-01**: `android docs` integrated as upstream validation source
- **AC-CLI-02**: `android screen/layout` integrated into `ui-specialist` + `quality-gater`
- **AC-CLI-03**: Google skills discoverable in L0 registry without fork
- **AC-CLI-04**: `android create` canonical path for new modules
- **AC-CLI-05**: `/setup` detects Android CLI state
- **AC-CLI-06**: Narrow MCP bridge for stateful `android` commands
- **AC-CLI-07**: CI Linux emulator workflow for UI validation
- **AC-CLI-08**: Ecosystem propagation to L1/L2 via `/sync-l0`

## Plans

- [ ] **19-POC**: `layout --diff` schema reverse engineering (no code, investigation only)
- [ ] **19-01**: Upstream Validation + Detekt Rules (LOW blast) — AC-CLI-01
- [ ] **19-02**: UI Validation Pipeline — DawSync Unblocker (MEDIUM blast) — AC-CLI-02 [depends on 19-POC]
- [ ] **19-03**: Skills Bridge + Module Lifecycle + Setup Wizard (MEDIUM blast) — AC-CLI-03, AC-CLI-04, AC-CLI-05 [depends on 19-02]
- [ ] **19-04**: MCP Narrow Bridge + CI Workflow + Ecosystem Propagation (HIGH blast) — AC-CLI-06, AC-CLI-07, AC-CLI-08 [depends on 19-01, 19-02, 19-03]

## Success Criteria (phase-level)

1. DawSync `/ui-specialist` on a broken-layout PR reports the failure in findings with category `ui-accessibility`, severity `HIGH`, and `file:line` of the broken Composable — closes memory `feedback_ui_validation_broken.md`.
2. `validate-all` MCP tool passes after all plan merges; CI workflow `ui-validation.yml` green.
3. `/sync-l0` propagates Phase 19 to DawSync + WakeTheCave with only deltas Phase 19 (no collateral churn).
4. `versions-manifest.json` tracks `android_cli: "0.7.0"` with compatibility window.
5. `CLAUDE.md:105` tool count matches `registerTools` count in `mcp-server/src/tools/index.ts`.

## Risks

See `C:\Users\34645\.claude\plans\partitioned-hugging-grove.md` § Residual Risks.

Top:
- Schema `layout --diff` churn on v0.8 (mitigation: version check + fallback)
- Windows dev without physical device (accepted: CI covers merge blocking)
- Dual-location agent drift (not solved here — spawn post-Phase 19 task)

## References

- [Android CLI overview](https://developer.android.com/tools/agents/android-cli)
- [Android Skills spec (agentskills.io)](https://agentskills.io/specification)
- [github.com/android/skills (Apache 2.0)](https://github.com/android/skills)
- [github.com/skydoves/android-skills-mcp](https://github.com/skydoves/android-skills-mcp)
- Memory: `feedback_ui_validation_broken.md`, `feedback_dev_test_gaming.md`
