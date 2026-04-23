# Wave 30 Session Prompt

> Created: 2026-04-23
> Prerequisite: Wave 29 PR merged to L0 develop + L1 PR #28 merged + DawSync local FF complete

## Context

Wave 29 closed L0→L1/L2 propagation with manifest drift cleanup and CP-gate enforcement. Key deferred items now form the W30 backlog.

## Priority Order

### P1 — Critical infrastructure (do first)

**BL-W30-04**: `/sync-l0` does NOT propagate `setup/agent-templates/`. Every L0 wave leaves L1/L2 with stale team-lead, quality-gater, etc. Fix `sync-engine.ts` to include that directory OR add an explicit propagation step to the `/sync-l0` command.
- Memory: `project_sync_staleness_bug.md`
- Effort: ~1h

**BL-W30-05**: DawSync is local-only. Create GitHub remote, push develop + master + feature/sidebar-bug-sprint. Enables normal PR flow. User has 2 stashes to reapply first (`pre-wave29-wip-untracked` + `pre-wave29-wip`).
- Effort: ~30min (user action + agent assist)

### P2 — W17 MED simple-fixes (deferred from W29 Phase 4)

**BL-W30-06** (W17 MED #4): Add K/N stdlib interop `@Suppress` allowlist to `/pre-pr` SKILL.md. ~20min. File: `skills/pre-pr/SKILL.md`.

**BL-W30-07** (W17 MED #14): Git pre-commit hook template for mechanical compile-fail blocking.

**BL-W30-08** (W17 MED #16): Add `--module-paths` flag to `catalog-coverage-check.sh` so audit grep covers `core/audio`, `core/media-session`, `core/data`.

**BL-W30-09** (W17 MED #19): Add "raw output + [DEV NOTE]" guidance to specialist Summary section in dev templates to prevent diagnostic interpretation.

### P3 — Corrections and doc alignment

**BL-W30-02**: Update `feedback_cp_shutdown_bug.md` memory. CP DOES process `shutdown_request` with ~38s delay (observed W29). Current memory says "ignores" — incorrect. Bug #3 (TeamDelete-before-TeamCreate) remains the conservative workaround but the description needs correcting.

**BL-W30-03**: DI patterns drift check — verify no divergence between `docs/di/di-patterns-modules.md` and `~/.claude/CLAUDE.md` global DI guidance (KoinIsolatedContext, startKoin semantics).

### P4 — Tool fix

**BL-W30-01**: `mcp-server/src/tools/tool-use-analytics.ts` reports `our_mcp_calls: 0` when log has 16+ entries with `mcp_server: "androidcommondoc"`. Aggregation bug. ~15min fix.

### P5 — Process lesson codification (if needed)

**BL-W30-10**: W29 scope-creep lesson — L0 propagates only; L1/L2 consoles validate. Codify in planner template if pattern recurred.

## Out of Scope

- Plugin v0.2.1 (triggered-only, no target-wave)
- W17 MED complex (#11, #17 KMP features reference doc) — W30+ separate session
- WakeTheCave (paused)

## Completion Criteria

- [ ] BL-W30-04 sync-l0 staleness fix shipped + tested
- [ ] BL-W30-05 DawSync remote created (user gate)
- [ ] BL-W30-06..09 W17 MED simple-fixes applied
- [ ] BL-W30-02 memory corrected
- [ ] BL-W30-03 DI doc audit pass
- [ ] BL-W30-01 analytics tool fix
- [ ] 0 HIGH/MEDIUM without target-wave in backlog.md
- [ ] L0 PR merged to develop, L1/L2 synced
