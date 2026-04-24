# Wave 31 — Execution Plan (Architect-Reviewed)

> Planner review: 2026-04-24. Architect amendments applied (A1-A11).
> Source: .planning/wave31-prompt.md + CP verification (7 checks) + 3 architect reviews + CP/arch-platform A10-A11.
> Base commit: 5aff166 (develop HEAD, W30 merged).

## Context

W30 shipped 10 backlog items + P3 enforcement hooks + BL-W30-11 planner T-BUG-015 fix (~3,956 expect() assertions green, PR #65). W31 is the second half of the 2-wave pre-split cleanup — tackling deeper architectural items before the monorepo split begins at W32.

**Why W31 now**: quality-gater T-BUG-015 gap still open (P0 deferral from W30), team-lead template has 3 pending hardening bugs (BL-W31-00), KMP knowledge doc needed to prevent stale capability claims, sync-l0 migration registry approved 26 days ago unimplemented, W18/W19 backlog items need data-driven triage or explicit deferral.

**What W31 closes**: BL-W31-00 (team-lead hardening Bugs 2-4), P0 quality-gater gap, P1 KMP docs + arch-platform gate, P2 migration registry, P3 W18 triage, P4 W19 debt audit.

**What defers to W32**: monorepo split itself, DawSync product alignment, plugin v0.2.1, WakeTheCave.

**Scope discipline (MANDATORY)**:
- Scope Immutability Gate: no scope extension without SendMessage + team-lead authorization
- No sibling-repo validation runs (L0-only session)
- Every code change ships with tests (Test Coverage Contract)
- Dual-location for all agent template edits: `setup/agent-templates/X.md` AND `.claude/agents/X.md`
- Registry rehash after EVERY template edit round (not session end only)

---

## CP Verification Findings (sourced this session)

**Bug 1 (subagent_type="Plan"→"planner")**: ALREADY FIXED this session. team-lead.md line 181 reads `subagent_type="planner"`. MARK DONE — not re-planned.

**quality-gater T-BUG-015**: NOT present in either `setup/agent-templates/quality-gater.md` or `.claude/agents/quality-gater.md`. Both locations unfixed — parity holds. P0 target confirmed.

**plan-context.js**: EXISTS at `.claude/hooks/plan-context.js` — PostToolUse hook only (injects context on EnterPlanMode). Does NOT block Write/Edit on `.planning/PLAN*.md`. BL-W31-00 Bug 2 confirmed pending.

**BL-W31-00 in backlog.md**: NOT yet an entry. Must be added.

**wave31-findings.md**: Does NOT exist — will be created in W31-04.

**Test baseline**: ~3,956 expect() assertions across 9 files in mcp-server/tests/. Target after W31: ~3,988+ (32-35 new assertions). (A3)

**W19 topology pre-assessment**: #4/5/6 SHIPPED (W20/W23) → OBSOLETE. #3 partially addressed (W24) but session-close hook unimplemented. Bug #7 CLOSED by W31-01.

---

## Scope Lock

**Modules**: mcp-server (sync/, tests/), setup/agent-templates/, .claude/agents/, .claude/hooks/, .claude/settings.json, docs/architecture/, skills/sync-l0/, skills/work/, .planning/

**Key files** (ALL changes must stay within this list):

| File | Wave | Action |
|------|------|--------|
| `setup/agent-templates/team-lead.md` | W31-00 | Update BL-W31-00 note to CLOSED |
| `.claude/agents/team-lead.md` | W31-00 | Exact mirror |
| `.claude/hooks/plan-context.js` | W31-00 | Extend: sentinel write/delete + PreToolUse Write/Edit block on PLAN*.md |
| `.claude/hooks/bash-cli-spawn-gate.js` | W31-00 | NEW: PreToolUse Bash gate (`--agent-id`, `--team-name`, `-p "you are`, `--print "you are`) |
| `.claude/settings.json` | W31-00 | Register bash-cli-spawn-gate.js in hooks array (A6) |
| `skills/work/SKILL.md` | W31-00 | Remove Agent(team-lead) spawn; inline playbook; MAIN-CONTEXT-ONLY header |
| `mcp-server/tests/integration/wave31-team-lead-hardening.test.ts` | W31-00 | NEW: 7 assertions |
| `setup/agent-templates/quality-gater.md` | W31-01 | T-BUG-015 FORBIDDEN block + version bump |
| `.claude/agents/quality-gater.md` | W31-01 | Exact mirror |
| `mcp-server/tests/integration/wave31-quality-gater-behaviors.test.ts` | W31-01 | NEW: 10 assertions |
| `docs/architecture/kmp-features-2026.md` | W31-02 | NEW: 8-platform matrix + JS split + Wasm Beta + Myths section |
| `docs/architecture/kmp-architecture-sourceset.md` | W31-02 | Add cross-ref pointer |
| `setup/agent-templates/arch-platform.md` | W31-02 | Knowledge Currency Gate section |
| `.claude/agents/arch-platform.md` | W31-02 | Exact mirror |
| `mcp-server/tests/integration/wave31-arch-platform-behaviors.test.ts` | W31-02 | NEW: 6 assertions |
| `skills/sync-l0/migrations.json` | W31-03 | NEW: registry with M001+M002 seeds |
| `skills/sync-l0/SKILL.md` | W31-03 | Add migration detection step |
| `mcp-server/src/sync/sync-engine.ts` | W31-03 | detectMigrations() + applyMigrations() (lowercase normalization) |
| `mcp-server/src/sync/sync-l0-cli.ts` | W31-03 | --auto-migrate flag |
| `mcp-server/src/sync/manifest-schema.ts` | W31-03 | ManifestSchemaV2 + `migrations_applied: z.array(z.string()).optional().default([])` (A9 HARD BLOCKER) |
| `mcp-server/tests/unit/sync-migration.test.ts` | W31-03 | NEW: 7 unit assertions |
| `mcp-server/tests/integration/sync-migration-integration.test.ts` | W31-03 | NEW: 2 integration scenarios |
| `.planning/backlog.md` | W31-00+04 | Add BL-W31-00; close W19 items; add BL-W32-04 |
| `.planning/wave31-findings.md` | W31-04 | NEW: triage verdicts (P3+P4) |
| `.planning/wave32-prompt.md` | W31-05 | NEW: monorepo split kickoff scope |

**Estimated file count**: ~25-28 files, ~6 new test files

---

## Wave W31-00: P0-prime — team-lead Template Hardening (BL-W31-00)

**Architect owner**: arch-integration (hooks) + arch-platform (skill routing)
**Dev owner**: data-layer-specialist (TypeScript), domain-model-specialist (SKILL.md)

### Bug 2 — plan-context.js Write/Edit block (sentinel mechanism — A7)

**Fix**:
- On `EnterPlanMode`: write `.planning/.plan-mode-active` sentinel file.
- On `ExitPlanMode`: delete sentinel file.
- Add PreToolUse on Write/Edit: if sentinel present AND target matches `.planning/PLAN*.md` → block. Otherwise allow.
- Do NOT use caller identity (hook payload lacks it — A7 constraint).
- Planner bypass: planner runs in separate subagent process; its Write calls are not subject to main-context PreToolUse hook. Sentinel is the shared gate. Test #5 validates this path (A1).

### Bug 3 — FORBIDDEN Bash CLI agent spawn gate (A6, A8)

**Fix**:
- NEW `.claude/hooks/bash-cli-spawn-gate.js` — PreToolUse on Bash.
- Detection regex: `--agent-id`, `--team-name`, `-p "you are`, `--print "you are` (A8).
- Block with: "FORBIDDEN: CLI agent spawn via Bash. Use Agent() with correct subagent_type (T-BUG-031-00)."
- `claude --help` must NOT be blocked — explicit false-positive test (A8).
- Register in `.claude/settings.json` hooks array (A6).

### Bug 4 — /work skill spawns team-lead subagent (root cause — T-BUG-010)

**Fix**:
- Remove `Agent(subagent_type="team-lead")` from `skills/work/SKILL.md`.
- /work executes team-lead playbook inline in main context.
- Add header: "WARNING (T-BUG-010): MUST run in main context only. Spawning as subagent causes Agent() tool loss (#31977)."

**Tests** (7 assertions in wave31-team-lead-hardening.test.ts):
1. plan-context.js contains sentinel write logic for `.planning/.plan-mode-active` on EnterPlanMode
2. plan-context.js contains PreToolUse Write/Edit block checking sentinel existence
3. bash-cli-spawn-gate.js exists and contains `--agent-id` detection
4. bash-cli-spawn-gate.js contains `--team-name` detection
5. plan-context.js PreToolUse allows Write when sentinel is absent (planner bypass — A1)
6. `.claude/settings.json` contains entry for `bash-cli-spawn-gate.js` (A6)
7. `skills/work/SKILL.md` does NOT contain `Agent(subagent_type="team-lead")` or `Agent(name="team-lead")`
+ false-positive sub-assertion: `claude --help` does NOT match bash-cli-spawn-gate regex (A8)

**Acceptance criteria**:
- [ ] Bug 1: ALREADY DONE
- [ ] Bug 2: sentinel mechanism live; PLAN*.md blocked during plan mode
- [ ] Bug 3: bash-cli-spawn-gate.js blocking + registered; `claude --help` not blocked
- [ ] Bug 4: /work inline; no team-lead subagent spawn; MAIN-CONTEXT-ONLY warning
- [ ] BL-W31-00 added to backlog.md (all 4 bugs, W31-00 target, CLOSED)
- [ ] team-lead dual-location updated
- [ ] 7/7 tests pass; registry rehashed

**Effort**: 1.5-2h

---

## Wave W31-01: P0 — quality-gater T-BUG-015 Gap Closure

**Architect owner**: arch-testing | **Dev owner**: test-specialist

**Files**: `setup/agent-templates/quality-gater.md`, `.claude/agents/quality-gater.md` (both), `wave31-quality-gater-behaviors.test.ts` (NEW)

**FORBIDDEN block to add**:
```
## Search Dispatch Protocol (MANDATORY — T-BUG-015)

FORBIDDEN at ALL times — using Grep, Glob, Read, or Bash to discover patterns, docs,
specs, or agent behaviors during quality gate execution. Route all such queries via
SendMessage(to="context-provider").

PERMITTED verification reads (not discovery):
- Reading diff output for @Suppress audit
- Reading test results for pass/fail counts
- Reading the specific file under review (when arch dispatched it)

T-BUG-015: context-provider is the discovery routing point. quality-gater's file
access is for VERIFICATION only — never for pattern-matching or knowledge discovery.
```

**Tests** (10 assertions):
1. Setup template contains "T-BUG-015"
2. Setup template contains "FORBIDDEN"
3. Setup template contains "context-provider" in FORBIDDEN block
4. Setup template contains "Grep" in FORBIDDEN list
5. Setup template contains "Glob" in FORBIDDEN list
6. Setup template distinguishes VERIFICATION (permitted) from discovery (forbidden)
7. `.claude/agents/quality-gater.md` matches setup template (parity)
8. template_version higher than W30 baseline
9. FORBIDDEN block appears before Phase 3 execution steps
10. T-BUG-015 identifier matches planner template (cross-template consistency)

**Acceptance criteria**: both locations updated; 10/10 pass; registry rehashed; parity CI green.

**Effort**: 45min-1h | **Dependency**: None — parallel with W31-00 and W31-02.

---

## Wave W31-02: P1 — KMP Knowledge Currency

**Architect owner**: arch-platform | **Dev owner**: domain-model-specialist

**CONTENT SOURCE GATE (MANDATORY)**: CP filed an ingestion request for Context7 sources (kotlinx-io, kotlinx.coroutines, kotlin-multiplatform-dev-docs) on 2026-04-24. team-lead MUST obtain user approval before arch-platform authors matrix content. Do not write matrix rows from training data alone.

**kmp-features-2026.md required structure**:
- YAML frontmatter: scope, sources, targets, category="architecture", slug="kmp-features-2026"
- **8 platform columns** (A4 + A11):
  - JVM (Stable), Android (Stable), iOS (Stable), macOS (Stable), Linux (Stable)
  - **JS — browser** (Stable; no raw TCP — browser sandbox)
  - **JS — Node.js** (Stable; raw TCP via Ktor available)
  - **Wasm (Beta)** — distinct column, explicitly marked Beta, NOT merged with JS
- **10 feature rows**: file IO, sockets/networking, coroutines, serialization, ktor client, ktor server, kotlinx-datetime, kotlinx-io, UI (Compose Multiplatform), background work
- **Coroutines versions (A10)**: document BOTH "1.10.x (Stable)" AND "1.11.0-rc01 (RC, paired Kotlin 2.2.20)"
- **Myths section (A2)** — header "## Myths & Common Misconceptions" with:
  - "macOS file IO unsupported — WRONG as of kotlinx-io 1.x"
  - "JS has no networking — WRONG for Node.js target; browser target sandbox restricts raw TCP (HTTP/WS only)" (A11 — browser vs Node.js split required)
- "Last verified: 2026-04-24" + 6-month refresh reminder
- Sources: kotlinx-io, kotlinx.coroutines, kotlin-multiplatform-dev-docs (pending user approval via ingestion loop 2026-04-24)
- ≤300 lines; split to sub-doc if JS split + Wasm detail pushes over limit

**Knowledge Currency Gate for arch-platform template**:
```
## Knowledge Currency Gate (MANDATORY — W31)

Before asserting ANY KMP platform constraint or capability claim:
1. SendMessage(to="context-provider", message="Verify KMP capability: {claim}. Load
   docs/architecture/kmp-features-2026.md and confirm platform support.")
2. Wait for CP response before including the claim in your dispatch or plan.
3. If CP doc contradicts your training data → trust the doc. Do not override.

Why: Pre-2024 training data has known false negatives (e.g. "macOS file IO
unsupported" — WRONG as of kotlinx-io 1.x). This gate prevents stale constraints.
```

**Tests** (6 assertions):
1. `kmp-features-2026.md` exists with valid YAML frontmatter
2. arch-platform template (setup) contains "Knowledge Currency Gate"
3. arch-platform template (setup) contains reference to "kmp-features-2026.md"
4. `.claude/agents/arch-platform.md` matches setup template (parity)
5. `kmp-architecture-sourceset.md` contains reference to `kmp-features-2026.md`
6. `kmp-features-2026.md` contains "Myths" section header + at least one myth entry (A2)

**Acceptance criteria**:
- [ ] Doc exists: 8 columns (incl. JS-browser, JS-Node.js, Wasm-Beta), Coroutines 1.10.x + 1.11.0-rc01, Myths section with JS split
- [ ] arch-platform Knowledge Currency Gate live (both locations)
- [ ] 6/6 tests pass; registry rehashed; doc passes validate-doc-structure; ≤300 lines
- [ ] User approval obtained for CP ingestion sources before content authored

**Effort**: 6-8h | **Dependency**: Template work unblocked. Matrix content blocked on user approval.

---

## Wave W31-03: P2 — sync-l0 Migration Registry

**Architect owner**: arch-integration | **Dev owner**: data-layer-specialist

Full design at `.claude/plans/federated-inventing-walrus.md`.

**migrations.json structure**:
```json
{
  "format_version": "1.0",
  "migrations": [
    {
      "id": "M001",
      "description": "dev-lead renamed to project-manager",
      "type": "agent_rename",
      "from": "dev-lead",
      "to": "project-manager",
      "applies_when": { "l0_version_before": "5.0.0" }
    },
    {
      "id": "M002",
      "description": "l0-manifest.json gains migrations_applied array field",
      "type": "manifest_schema_bump",
      "field_to_add": "migrations_applied",
      "default_value": [],
      "applies_when": { "field_missing": "migrations_applied" }
    }
  ]
}
```

**Case-normalization (A5)**: `detectMigrations()` MUST normalize all filenames to lowercase before comparing (`Dev-Lead.md` = `dev-lead.md` on Windows).

**manifest-schema.ts (A9 HARD BLOCKER)**: `ManifestSchemaV2` must gain `migrations_applied: z.array(z.string()).optional().default([])`. Without this, `validateManifest()` throws when applying M002.

**Tests** (9 assertions):

Unit (sync-migration.test.ts):
1. `detectMigrations()` returns empty array when no migrations pending
2. `detectMigrations()` returns M001 when target has dev-lead agent (case-insensitive — A5)
3. `detectMigrations()` returns M002 when manifest missing `migrations_applied`
4. `applyMigrations()` M001 renames file in target dir
5. `applyMigrations()` M002 adds field to manifest
6. `applyMigrations()` is idempotent (double-apply = no-op)
7. `detectMigrations()` normalizes to lowercase (`Dev-Lead.md` matches M001 — A5)
8. `ManifestSchemaV2` accepts `migrations_applied` array without throwing (A9)
9. `ManifestSchemaV2` defaults `migrations_applied` to `[]` when absent (A9)

Integration (sync-migration-integration.test.ts):
- Scenario A: M001 → sync --auto-migrate → `dev-lead.md` renamed to `project-manager.md`
- Scenario B: M002 → sync --auto-migrate → manifest gains `migrations_applied: ["M002"]`

**Acceptance criteria**:
- [ ] migrations.json with M001+M002; SKILL.md migration step; --auto-migrate flag + dry-run
- [ ] manifest-schema.ts ManifestSchemaV2 updated (A9 HARD BLOCKER)
- [ ] detectMigrations() lowercase-normalizes (A5)
- [ ] 9/9 assertions pass; full suite ≥3,956 baseline (no regressions)

**Effort**: 4-6h | **Dependency**: W31-00/01 preferred first; no hard TypeScript blocker.

---

## Wave W31-04: P3+P4 — W18 Backlog Triage + W19 Topology Debt Audit

**Architect owner**: arch-platform (P3) + arch-integration (P4) | **Dev owner**: none (audit only)

### P3 — W18 Backlog Triage

**Timing**: only 5 days of /metrics data (target ~2026-05-03). Decision rule: insufficient data → defer to BL-W32-XX explicitly.

- **C1 (Dev loop)**: >3 occurrences → BL-W32-01; else DEFER-BL-W32-01.
- **C2 (Arch flip-flop)**: measurable → BL-W32-02; else DEFER-BL-W32-02.
- **C3 (CP grep scope)**: >2 disagreements → fix CP template + bats test; else DEFER-BL-W32-03.

**Output**: `.planning/wave31-findings.md` — verdict table + raw /metrics numbers.

### P4 — W19 Topology Debt Final Audit

- **#3**: session-closure hook unimplemented → **BL-W32-04**.
- **#4**: SHIPPED W20 → **OBSOLETE**.
- **#5**: SHIPPED W23 → **OBSOLETE**.
- **#6**: SHIPPED W23 → **OBSOLETE**.
- **Bug #7**: CLOSED by W31-01 → **CLOSED**.

**Output**: verdicts appended to wave31-findings.md + BL-W32-04 in backlog.md.
**Tests**: bats ONLY if C3 results in CP template fix.
**Effort**: 3-5h | **Dependency**: W31-01 must complete before Bug #7 marked CLOSED.

---

## Wave W31-05: P5 Buffer + Completion Criteria + PR

**Architect owner**: arch-integration | **Dev owner**: as needed

**Actions**:
1. Fix any W30/L1/L2 fallout bugs.
2. Create `.planning/wave32-prompt.md` (monorepo split kickoff; first tool: dokka-markdown-plugin v0.2.0).
3. Quality-gater Phase 3 full suite.
4. PR `feature/wave-31 → develop`; monitor CI until green.

**Completion criteria**:
- [ ] BL-W31-00 Bugs 2+3+4 fixed + 7 tests pass (W31-00)
- [ ] quality-gater T-BUG-015 FORBIDDEN block + 10 tests (W31-01)
- [ ] kmp-features-2026.md: 8 platforms (JS-browser/JS-Node.js/Wasm-Beta), Coroutines 1.10.x+1.11.0-rc01, Myths with JS split; arch-platform gate live (W31-02)
- [ ] Migration registry + manifest-schema.ts + 9 tests (W31-03)
- [ ] W18 triage complete — all candidates have explicit verdict (W31-04)
- [ ] W19 items #3-#6 + Bug #7 resolved (W31-04)
- [ ] W30 fallout bugs fixed
- [ ] Full suite green (≥3,956 + 32-35 new = ~3,988+)
- [ ] 0 HIGH/MEDIUM in backlog.md without target-wave
- [ ] `.planning/wave32-prompt.md` exists
- [ ] Memory updated: `project_wave31_shipped.md`
- [ ] Registry hash current; CI green on L0 PR → develop

**Effort**: 1-3h

---

## Test Coverage Summary

| Wave | New Assertions | File(s) |
|------|---------------|---------|
| W31-00 | 7 | `wave31-team-lead-hardening.test.ts` |
| W31-01 | 10 | `wave31-quality-gater-behaviors.test.ts` |
| W31-02 | 6 | `wave31-arch-platform-behaviors.test.ts` |
| W31-03 | 9 | `sync-migration.test.ts` + `sync-migration-integration.test.ts` |
| W31-04 | 0-3 (conditional) | bats if C3 hook added |
| **Total** | **32-35 new** | Baseline: ~3,956 expect(), target: ~3,988+ |

---

## Feature Branch

`feature/wave-31` from `develop` (HEAD: 5aff166)

1. `rtk git checkout -b feature/wave-31 develop`
2. Core devs commit to feature/wave-31
3. Phase 3: quality-gater validates
4. PR: feature/wave-31 → develop (user approves); master merge separately

---

## Architect + Dev Routing Table

| Scope | Architect | Dev |
|-------|-----------|-----|
| plan-context.js + bash-cli-spawn-gate.js + settings.json | arch-integration | data-layer-specialist |
| skills/work/SKILL.md rewrite | arch-platform | domain-model-specialist |
| team-lead template dual-location | arch-integration | data-layer-specialist |
| quality-gater template dual-location | arch-testing | test-specialist |
| kmp-features-2026.md + arch-platform template dual-location | arch-platform | domain-model-specialist |
| sync-engine.ts + sync-l0-cli.ts + manifest-schema.ts | arch-integration | data-layer-specialist |
| skills/sync-l0/migrations.json + SKILL.md | arch-integration | data-layer-specialist |
| W18 triage + W19 audit | arch-platform + arch-integration | none |
| All new test files | arch-testing | test-specialist |

---

## Wave Execution Order + Dependencies

```
W31-00 ──┐
W31-01 ──┤─── parallel (independent files)
W31-02 ──┘  (matrix content blocked on user approval of CP ingestion)
          │
          ▼
        W31-03 (preferred after W31-00/01; no hard TypeScript blocker)
          │
          ▼
        W31-04 (W31-01 MUST complete first — Bug #7 verdict)
          │
          ▼
        W31-05 (all prior waves done)
```

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Sentinel blocks planner's own writes | Subagent process isolation; test #5 validates bypass path explicitly |
| bash-cli-spawn-gate false-positive (`claude --help`) | Explicit false-positive sub-assertion in tests; must pass before merge |
| manifest-schema.ts missing migrations_applied (A9 HARD BLOCKER) | In scope lock; tests #8+#9 must pass; W31-03 cannot close without this |
| P2 sync-engine refactor breaks existing sync tests | Full Vitest suite after each P2 commit; abort on regression |
| P1 KMP doc content stale (training cutoff Aug 2025) | Content gate: user approval of CP ingestion before matrix authored; "Last verified: 2026-04-24" |
| Wasm Beta status may change | Mark column explicitly "Beta"; refresh reminder in doc |
| JS split + Wasm increases doc size | Monitor line count; split to sub-doc if approaching 300-line limit |
| P3 /metrics data sparse (5 days) | Defer all 3 W18 candidates to BL-W32-XX explicitly if insufficient |
| Registry hash drift | Rehash after each template edit round |
| /work inline rewrite breaks existing usage | Test #7 asserts no Agent(team-lead) spawn; MAIN-CONTEXT-ONLY warning |

---

## Amendments Applied (A1–A11)

| ID | From | Section | Change |
|----|------|---------|--------|
| A1 | arch-testing | W31-00 tests | Test #5: sentinel absent = planner write allowed |
| A2 | arch-testing | W31-02 tests | Test #6: Myths section header + at least one entry |
| A3 | arch-testing | Context + Summary + Criteria | Baseline ~3,956 expect(); target ~3,988+ |
| A4 | arch-platform | W31-02 doc | Wasm as distinct column; revised to 8 platforms per A11 |
| A5 | arch-platform | W31-03 | detectMigrations() lowercase normalization; test #7 |
| A6 | arch-integration | W31-00 scope + tests | settings.json in scope; test #6 checks hook registration |
| A7 | arch-integration | W31-00 Bug 2 | Sentinel file mechanism; caller-identity approach rejected |
| A8 | arch-integration | W31-00 Bug 3 | `-p "you are` + `--print "you are` patterns; false-positive test |
| A9 | arch-integration | W31-03 (HARD BLOCKER) | manifest-schema.ts ManifestSchemaV2 + migrations_applied Zod field + tests #8+#9 |
| A10 | CP + arch-platform | W31-02 content | Coroutines: both 1.10.x Stable AND 1.11.0-rc01 RC (Kotlin 2.2.20) |
| A11 | CP + arch-platform | W31-02 matrix | 8 platforms: JS split browser vs Node.js; Wasm Beta distinct; Myths JS myth split required |
