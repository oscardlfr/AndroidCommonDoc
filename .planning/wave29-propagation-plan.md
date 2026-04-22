# Wave 29 — L0 → L1/L2 Propagation Plan (OUTLINE)

> This is an OUTLINE scaffolded by Wave 28 planner. The W29 session owner fills in details during W29 planning phase.

## Context

Wave 28 closed all HIGH backlog items + 7 OBSOLETE W17 findings + documented 4 MED + 2 complex DEFERRED. L0 is shipping-ready. Wave 29 propagates the L0 surface to L1 (shared-kmp-libs) and L2 projects (DawSync, WakeTheCave), then validates each.

## Scope

- `/sync-l0` execution across 3 targets (shared-kmp-libs L1, DawSync L2, WakeTheCave L2)
- Per-target post-sync validation via `/pre-pr`, `/check-outdated`, `/audit-docs`
- Bug harvest from each L1/L2 run — track in structured findings template
- Absorb 4 MED simple-fix items from W17 triage (#4 K/N allowlist, #14 compile-fail hook, #16 module-paths flag, #19 raw output rule) if capacity permits

## Preservation Rules

- L1/L2 private agents MUST NOT be overwritten (cite memory `feedback_never_overwrite_l2_agents.md`)
- DawSync daw-guardian agent stays intact
- shared-kmp-libs custom agents (if any) preserved
- Only L0 generic agents + skills + docs propagate

## Per-target validation suite

Sequence per target:
1. `/sync-l0` with dry-run verify first
2. `/sync-l0` actual
3. `/pre-pr` in target project (must PASS)
4. `/check-outdated` (catalog check)
5. `/audit-docs` (structure + coherence)

## Findings Template

Each L1/L2 run produces structured findings. Schema:
- severity: HIGH | MEDIUM | LOW
- category: sync | validation | agent-bug | doc-drift
- target-project: shared-kmp-libs | DawSync | WakeTheCave
- evidence: file:line or command output excerpt
- proposed-fix: inline | W30 backlog

## Rollback Protocol

If any target breaks post-sync:
1. `git log HEAD~5..HEAD` in target repo to identify sync commit
2. `git revert <sync-commit>` in target repo
3. Report findings + rollback SHA
4. Do NOT attempt L0 patches inside target repos — fix at L0, re-sync

## Phases (to be fleshed in W29 planning)

- Phase 1 — L1 propagation + validation (shared-kmp-libs)
- Phase 2 — L2 propagation + validation (DawSync, WakeTheCave)
- Phase 3 — Findings consolidation + backlog update
- Phase 4 — MED simple-fix absorption if capacity (W17 #4, #14, #16, #19)

## Estimated Effort

~6-10h across all phases. More if HIGH findings surface from L1/L2 runs (in which case truncate MED absorption).

## Dependencies

- Wave 28 merged to develop (this happens at end of W28)
- L1/L2 projects on current commit of their own develop branches (verify freshness at session start)
- Full test suite + CI green on AndroidCommonDoc develop
