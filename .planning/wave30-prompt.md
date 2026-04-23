# Wave 30 — Core Close (Pre-Split Cleanup)

> Created: 2026-04-23 (W29 closure)
> Prerequisite: W29 merged to L0 develop (50e055b) + L1 PR #28 merged + DawSync local FF
> Target: ~10-12h, firm scope. Part 1 of 2-wave pre-split cleanup plan (W30 + W31 → then monorepo split).

## Context

W29 closed L0→L1/L2 propagation with manifest drift cleanup + CP-gate enforcement. Surfaced items now form W30 backlog. This wave closes **backlog.md + high-priority memory items**, leaving W31 for complex knowledge docs + architectural hooks before we split the monorepo into independent tool repos.

## Scope Discipline (MANDATORY)

- **NO mid-wave expansions without Scope Immutability Gate**: architect quotes team-lead ruling verbatim before any expansion. Lesson from W29 (3 mid-wave expansions cost ~40% overhead).
- **L0 propagates only; L1/L2 consoles validate**: do NOT run `/pre-pr`, `/check-outdated`, `/audit-docs` in sibling repos from this session. Lesson from W29 A3 scope creep.
- **Test coverage mandatory for every code change** (see "Test Coverage Contract" below).

## Priority order

### P1 — Infrastructure (critical, do first)

**BL-W30-04** — `/sync-l0` propagates `setup/agent-templates/` (HIGH)
- Fix `mcp-server/src/sync/sync-engine.ts` to include `setup/agent-templates/` in sync scope
- Memory: `project_sync_staleness_bug.md`
- **Tests required**: Vitest test for sync-engine covering new dir propagation. Regression test: changed template in L0 → propagates to L1 on sync.
- Effort: 1-2h

~~**BL-W30-05** — DawSync GitHub remote setup~~ — **REMOVED FROM SCOPE 2026-04-23** per user directive: DawSync stays local-only (no GitHub remote). Not deferred to W31; permanently descoped.

### P2 — W17 MED simple-fixes (deferred from W29)

**BL-W30-06** (W17 MED #4) — K/N stdlib interop `@Suppress` allowlist in `/pre-pr`
- File: `skills/pre-pr/SKILL.md`
- **Tests required**: bats test for the allowlist check (positive + negative cases)
- Effort: 20-30min

**BL-W30-07** (W17 MED #14) — Git pre-commit hook blocking compile-fail commits
- New hook template in `.claude/hooks/` or `scripts/hooks/`
- **Tests required**: bats test simulating compile-fail → hook blocks commit
- Effort: 45min-1h

**BL-W30-08** (W17 MED #16) — `catalog-coverage-check.sh --module-paths` flag
- File: `scripts/sh/catalog-coverage-check.sh`
- **Tests required**: bats test with fixture module paths
- Effort: 30-45min

**BL-W30-09** (W17 MED #19) — Specialist raw output + [DEV NOTE] template rule
- Update 4 core dev templates (`test-specialist`, `ui-specialist`, `data-layer-specialist`, `domain-model-specialist`) Summary section
- **Tests required**: registry rehash + agent-parity CI check must pass
- Effort: 20-30min + registry rehash

### P3 — #1 Priority Memory item (architectural)

**[memory] `feedback_enforcement_not_templates.md`** — Build hooks que BLOQUEEN mecánicamente
- User's stated #1 priority: templates aren't enforcing (PM ignores prose rules)
- **Scope**: identify top 3-5 rules that architects/devs bypass despite templates, convert to mechanical hooks (session hooks, pre-commit, CI)
- Examples to consider: scope expansion without gate, search-via-grep bypassing CP, architect self-editing files, missed registry rehash
- **Tests required**: bats tests for each new hook + integration test showing the bypassed action is now blocked
- Effort: 4-6h (scope-dependent; cap at 6h — excess → W31)

### P4 — Secondary memory items

**[memory] `project_command_portability.md` remanente**
- `skills/setup/SKILL.md:464` broken reference fix
- Hardcoded test path fix
- 20 agent mirrors missing in `setup/agent-templates/`
- **Tests required**: L2 portability CI check (if exists) or new bats test simulating L1/L2 consumption
- Effort: 2-3h

**[memory] `project_wave19_sprint2_deferred.md` housekeeping**
- `.gsd/agents/` mirror cleanup OR deprecation decision
- l0-manifest.json drift (if any on L0 itself)
- material-3-skill directory state
- **Tests required**: none beyond existing CI
- Effort: 1-2h

**[memory] `project_dgpv2_typed_config_queued.md`** — DGP v2 typed-config doc
- Create `docs/gradle/gradle-patterns-dgpv2-typed-config.md`
- Update hub pointer in `docs/gradle/gradle-hub.md`
- **Tests required**: `validate-doc-structure` MCP tool passes on new doc
- Effort: 1h

### P5 — Corrections + tool fix

**BL-W30-02** — Update `feedback_cp_shutdown_bug.md`. CP DOES process shutdown_request with ~38s delay. Current memory says "ignores" — incorrect.
- **Tests**: N/A (memory doc)
- Effort: 5-10min

**BL-W30-03** — DI patterns drift check between `docs/di/di-patterns-modules.md` and `~/.claude/CLAUDE.md` global DI guidance
- **Tests**: `validate-doc-structure` + `check-doc-patterns` MCP tools
- Effort: 30min

**BL-W30-01** — `mcp-server/src/tools/tool-use-analytics.ts` `our_mcp_calls: 0` aggregation bug
- **Tests required**: Vitest test covering aggregation with ≥10 entries with `mcp_server: "androidcommondoc"`
- Effort: 15-30min

### P6 — Process lesson codification

**BL-W30-10** — Codify W29 scope-creep lesson in planner template
- File: `setup/agent-templates/planner.md` — add "L0 propagates, L1/L2 consoles validate" guardrail for propagation waves
- **Tests**: N/A (template wording)
- Effort: 15-20min

**BL-W30-11** — Planner Search Dispatch Protocol violation (T-BUG-015) — HIGH
- Observed 2026-04-23: planner did `Searching for 4 patterns, reading 1 file… · 31 tool uses · 64.4k tokens` for pattern lookups that should have been a handful of `SendMessage(to="context-provider")` roundtrips.
- Root cause: template has `tools: Read, Write, Bash, SendMessage` and describes CP consultation as "get current state" guidance, but does NOT explicitly forbid direct Grep/Read/Bash for pattern/doc discovery. Planner interprets Read access as permission to grep patterns directly.
- Required fix in `setup/agent-templates/planner.md` (+ copy `.claude/agents/planner.md`):
  1. Add explicit **FORBIDDEN: direct Grep/Glob/Read/Bash for pattern lookups** rule in Process section with T-BUG-015 citation.
  2. Rewrite Process step 1 as mandatory "ALL pattern/doc/spec lookups MUST route via `SendMessage(to="context-provider")`". Read/Bash are reserved for writing the plan file (`.planning/PLAN.md`) and reading team config only.
  3. Add concrete example: wrong (direct `Grep` for a pattern) vs right (`SendMessage(to="context-provider", message="What patterns exist for X? File paths please.")`).
  4. Bump `template_version` from 1.6.0 → 1.7.0.
- **Tests required**: bats or vitest regression test asserting planner template contains the FORBIDDEN rule with T-BUG-015 tag. Registry rehash. Agent-parity CI.
- Cross-check: T-BUG-015 is the documented Search Dispatch Protocol — confirm exact ID with context-provider before editing (may be renamed). If ID missing, capture under a new bug number and update memory.
- Effort: 30-45min (template edit + test + rehash)
- Memory: new memory entry `feedback_planner_search_dispatch.md` summarizing the rule for future sessions.

## Out of Scope

- W17 MED #11/#17 KMP knowledge doc (deferred → W31)
- `project_sync_migration.md` migration registry implementation (deferred → W31)
- `project_wave18_backlog.md` triage (requires more /metrics data → W31 or later)
- `project_wave19_topology_debt.md` final review (→ W31)
- Plugin v0.2.1 (triggered-only)
- WakeTheCave (paused)
- `project_dawsync_product_alignment.md` (cross-project, separate dedicated session)

## Test Coverage Contract

Every code change in this wave ships with tests. Rules:

1. **MCP tool fixes** (BL-W30-01, BL-W30-04) → Vitest unit tests in `mcp-server/src/**/__tests__/`
2. **Shell scripts** (BL-W30-08) → bats test in `scripts/sh/tests/`
3. **Hooks** (BL-W30-07 + P3 enforcement hooks) → bats tests covering block/pass paths
4. **Agent template edits** → registry rehash + CI agent-parity checks must green
5. **Skill edits** (BL-W30-06) → bats test for the specific behavior (K/N allowlist)
6. **Doc edits** → `validate-doc-structure` MCP tool passes

Test-specialist dispatched proactively by arch-testing after every code change. Dev scope gate Opción B (architect-authorized override).

## 3-Phase Execution

- **Phase 1 (Planning)**: EnterPlanMode → planner writes `.planning/PLAN-W30.md` → user approves via ExitPlanMode.
- **Phase 2 (Execute)**: Bug #8 Phase 2 Topology Gate — spawn 4 core devs immediately after ExitPlanMode. Architects dispatch PREP → EXECUTE → APPROVE cycles per round.
- **Phase 3 (Quality Gate)**: quality-gater runs all validators. Full pass required before commit sequencing.

## Completion Criteria

- [ ] BL-W30-01..04 + BL-W30-06..11 shipped (10 backlog items; BL-W30-05 descoped) with tests
- [ ] `feedback_enforcement_not_templates.md` #1 priority item shipped (3-5 mechanical hooks) with tests
- [ ] `project_command_portability.md` remaining items resolved
- [ ] Housekeeping items closed (`.gsd/agents/`, DGPv2 doc, etc.)
- [ ] CI full green on L0 PR → develop
- [ ] Full Vitest suite + bats suite passing
- [ ] 0 HIGH/MEDIUM in backlog.md without target-wave
- [ ] W31 scope confirmed in `.planning/wave31-prompt.md`

## References

- `.planning/wave29-findings.md` — W29 findings (source of W30 backlog)
- `.planning/backlog.md` — BL-W30-01..11 entries (BL-W30-05 descoped 2026-04-23) + pending memory items
- Memory: `feedback_enforcement_not_templates.md`, `project_sync_staleness_bug.md`, `project_command_portability.md`, `project_wave19_sprint2_deferred.md`, `project_dgpv2_typed_config_queued.md`, `feedback_cp_shutdown_bug.md`

## Protocol

Session start:
1. `/work .planning/wave30-prompt.md` (this file)
2. team-lead TeamCreate + 6 session peers + CP gate ack
3. EnterPlanMode → planner writes PLAN-W30.md
4. User approval → ExitPlanMode → 4 core devs spawn
5. Round-by-round execution per PLAN-W30.md
6. Final quality-gater pass → PR → user merge approval
