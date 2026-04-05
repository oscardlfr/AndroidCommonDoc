---
title: "L1/L2 Drift Cleanup + Test Coverage + Doc Updates"
created: "2026-04-04"
session: drift-cleanup
blast_radius: low-medium
phases: [A, B, C, D, E]
---

# Execution Plan: L1/L2 Drift Cleanup

## Context (reconciled from live spot-checks + context-provider + planner audit)

### Git State
- **L0 (AndroidCommonDoc)**: branch `feature/l0-templates-patterns-2026-04-04`, PR #26 OPEN MERGEABLE (3 CI checks failing — needs diagnosis in Phase E)
- **L1 (shared-kmp-libs)**: branch `feature/l0-sync-2026-04-04`, PR #10 OPEN MERGEABLE
- **L2 (DawSync)**: branch `feature/uat-polish-wave1`, **NO GIT REMOTE** — push/PR blocked until user configures remote
  - Dirty working tree: 8 agents modified, memory files, 2 commands deleted — surgical staging required

---

## Verified Drift Inventory

### What is NOT drifted (context-provider confirmed, spot-checked)
All four key frontmatter fields (`model`, `token_budget`, `domain`, `intent`) are **present and matching** in all L0-shared agents in both L1 and L2. The PM memory backlog was outdated on this point. No token_budget/domain/intent patching needed.

### What IS drifted

#### 1. Sync headers missing — structural gap, not content drift

18 L1 agents and 11 L2 agents were never processed by `/sync-l0`. They lack `l0_source`, `l0_hash`, `l0_synced` in their frontmatter. All other fields are correct.

**L1 (18 agents without sync headers)**:
api-rate-limit-auditor, arch-integration, arch-platform, arch-testing, beta-readiness-agent, cross-platform-validator, data-layer-specialist, doc-alignment-agent, domain-model-specialist, full-audit-orchestrator, l0-coherence-auditor, module-lifecycle, platform-auditor, privacy-auditor, release-guardian-agent, template-sync-validator, test-specialist, ui-specialist

**L2 (11 agents without sync headers)**:
api-rate-limit-auditor, arch-integration, arch-platform, arch-testing, beta-readiness-agent, data-layer-specialist, doc-alignment-agent, domain-model-specialist, full-audit-orchestrator, project-manager, test-specialist

Fix per agent: insert in frontmatter block (before closing `---`):
```yaml
l0_source: C:\Users\34645\AndroidStudioProjects\AndroidCommonDoc
l0_hash: sha256:<hash-of-current-l0-counterpart>
l0_synced: 2026-04-04
```

#### 2. Description drift — stale pre-refactor wording

**L1 shared-kmp-libs** (confirmed via live spot-check — 2 agents):

| Agent | L1 description (stale) | L0 description (current) |
|-------|------------------------|--------------------------|
| context-provider.md | "Cross-layer context agent. Reads docs, specs, MCP tools, memory across projects. Provides context to any department. Read-only — never modifies files." | "On-demand context oracle. Answers queries about patterns, docs, rules, specs, and cross-project state. Loads files on demand — never eagerly pre-reads everything. Read-only." |
| quality-gater.md | "Quality Gate Team peer. Runs sequential verification..." | "Session team peer (Phase 3). Runs sequential verification..." |

**L2 DawSync** (2 stale agents matching L1 pattern):
- context-provider.md — same stale text as L1
- quality-gater.md — same stale text as L1

**L2 descriptions to PRESERVE** (valid customizations):
- module-lifecycle.md — "in DawSync" suffix (template substitution, correct)
- platform-auditor.md — "in DawSync" suffix (template substitution, correct)
- project-manager.md — "Project manager for DawSync..." (intentional per memory)

#### 3. Functional tool gap — L2 DawSync only

`ui-specialist.md` in DawSync: `tools: Read, Grep, Glob, Bash, Write` — MISSING `Edit`
L0 and L1 both have `Edit`. Fix: `tools: Read, Grep, Glob, Bash, Write, Edit`

#### 4. DawSync PM intent list — flag to user, do not auto-fix

`project-manager.md` in DawSync has `intent: [implement, feature, build, create, develop, plan]` — implementation verbs on an orchestrator that NEVER writes code. L0 has `intent: [orchestrate, plan, assign, escalate, coordinate]`. Memory records this as intentional but it is semantically wrong for an orchestrator. **Flag to user before changing.**

#### 5. MANDATORY L2 PRESERVATIONS (do not touch)

- `doc-updater.md`: `session-dawsync` hardcoded team name — DO NOT CHANGE
- `project-manager.md`: `model: opus[1m]`, description, 7 custom skills (test, test-full-parallel, test-changed, coverage, lint-resources, verify-kmp, validate-patterns) — add sync stamp only, change nothing else
- 9 L2-private agents (audio-engine-specialist, build-in-public-drafter, daw-guardian, firebase-auth-reviewer, freemium-gate-checker, producer-consumer-validator, product-prioritizer, stripe-integration-reviewer, version-checker) — DO NOT OPEN OR EDIT

---

## Test Coverage Assessment (prior session 4-wave changes)

| Change | Status | Gap |
|--------|--------|-----|
| dispatcher-scopes Path B2 + BANNED | Detekt rules active (`NoUnconfinedTestDispatcherForClassScopeRule` + `RequireAdvanceUntilIdleAfterStartObservingRule`, unit tests exist) | Rule doesn't verify correct testScheduler arg in B2; no integration test asserts doc content |
| PM/planner template changes | NONE | No CI gate for dual-location sync (setup/agent-templates/ ↔ .claude/agents/) |
| 6 SKILL.md bash enforcement notes | UNCLEAR | script-parity-validator + template-sync-validator wired into quality-gate-orchestrator only — NOT in /pre-pr |
| Team-topology broadcast workaround | Documented (team-topology.md:222-237) | No integration test asserts the workaround section exists |

**Actionable test gaps** (Phase D):
1. team-topology.md broadcast workaround presence
2. testing-patterns.md Quick Reference Path B2 presence
3. All L0 agents with `model:` have `token_budget:` (regression guard)

---

## Doc Staleness

| Doc | Gap | Action |
|-----|-----|--------|
| `testing-patterns.md` lines 83-84 | Quick Reference mentions Path A + B only | Add Path B2 bullet |
| `CLAUDE.md` lines 17-30 (Agent Delegation) | 11 agents listed; missing arch-*, context-provider, doc-updater, quality-gater, planner, 4 core devs, others | Rewrite table for 3-phase model |
| `CLAUDE.md` line 103 (template pointer) | Lists 4 templates; actual: 22 .md in setup/agent-templates/ | Update count/description |

**Not stale**: testing-hub.md, team-topology.md — verified current.

---

## Scope

- **Files**: ~29 agent frontmatter patches (sync stamps) + 4 description fixes + 1 tool fix + 2-3 doc edits + 3 integration tests
- **Blast radius**: low-medium — additive frontmatter + cosmetic description fixes + new tests; no logic changes

---

## Phases

### Phase A: L1 Sync Stamps + Description Fixes (shared-kmp-libs)
**Owner**: arch-platform → extra dev A (named, no team_name)
**Scope**: 18 L1 agents

**Tasks**:
1. For each of the 18 unsynced agents: compute sha256 of current L0 counterpart, insert `l0_source/l0_hash/l0_synced` block in frontmatter before closing `---`
2. **In the same pass**, fix 2 stale descriptions:
   - `context-provider.md`: update description to L0 current wording
   - `quality-gater.md`: update "Quality Gate Team peer" → "Session team peer (Phase 3)..."

**Stage files by name only**. `git diff --cached` review before commit. L1 has 1 modified + 25 untracked — do not accidentally include other files.

**Success**: All 39 L1 L0-shared agents have `l0_hash`. context-provider + quality-gater descriptions match L0.

---

### Phase B: L2 Sync Stamps + Tool Fix + Description Fixes (DawSync)
**Owner**: arch-platform → extra dev B (different named dev, parallel with A)
**Scope**: 11 L2 agents + ui-specialist tool fix

**Tasks**:
1. For each of the 11 unsynced agents: insert sync stamp block (same format as Phase A)
2. **Special for project-manager.md**: add sync stamp only; verify after edit that `model: opus[1m]`, description, and 7 custom skills are unchanged
3. **Fix ui-specialist**: `tools: Read, Grep, Glob, Bash, Write` → `tools: Read, Grep, Glob, Bash, Write, Edit`
4. **Fix 2 stale descriptions**: context-provider.md + quality-gater.md (same L0 wording as Phase A)

**Stage files by EXACT name**. L2 has 55 modified + 126 untracked — `git add` by filename is mandatory. `git diff --cached` before commit.

**FORBIDDEN**: doc-updater `session-dawsync` line, module-lifecycle/platform-auditor "in DawSync" descriptions, 9 L2-private agents.

**Success**: All 35 L2 L0-shared agents have `l0_hash`. ui-specialist has `Edit`. doc-updater `session-dawsync` intact. PM `model: opus[1m]` + 7 skills intact.

---

### Phase C: Doc Content Updates
**Owner**: arch-testing → doc-updater (session peer)
**Scope**: 3 doc edits — independent of A+B, can run in parallel

**C1 — testing-patterns.md** Quick Reference (line ~84):
After the Path B bullet, insert:
```
- **Path B2** (SharedFlow/no-replay): `CoroutineScope(UnconfinedTestDispatcher(testScheduler))` for subscriber — `backgroundScope` races the emission since SharedFlow has no replay buffer
```

**C2 — CLAUDE.md §2 Agent Delegation table** (lines 17-30):
Rewrite table to reflect 3-phase session team model. Keep section header + intro text. Replace 11-row table with ~17-row version covering all 9 session team peers + key standalone agents. Suggested structure:

| Agent | Role | MUST delegate when |
|-------|------|-------------------|
| `context-provider` | Patterns, docs, rules, cross-project oracle | Any agent needing current state or docs |
| `doc-updater` | CHANGELOG, docs, KDoc | After implementation |
| `arch-testing` | Test strategy, coverage, test-gaming | After implementation |
| `arch-platform` | KMP patterns, source sets, Gradle | Any platform-boundary work |
| `arch-integration` | DI wiring, cross-module, navigation | Any integration change |
| `test-specialist` | Write/audit tests | After arch-testing assigns |
| `ui-specialist` | Compose UI, accessibility, Material3 | ANY Compose change |
| `domain-model-specialist` | Domain models, use cases | Domain layer work |
| `data-layer-specialist` | Repositories, data sources | Data layer work |
| `planner` | Execution plan creation | Phase 1 of 3-phase model |
| `quality-gater` | Sequential quality verification | Phase 3, after all architects APPROVE |
| `debugger` | Systematic bug investigation | `/debug` |
| `verifier` | Goal-backward verification | After feature complete — `/verify` |
| `advisor` | Technical decision comparison | `/decide` |
| `researcher` | Pre-implementation research | `/research` |
| `codebase-mapper` | First-time repo analysis | `/map-codebase` |
| `release-guardian-agent` | Release safety | Before ANY publish |

**C3 — CLAUDE.md line 103 template pointer**:
Change `(project-manager, product-strategist, content-creator, landing-page-strategist)` to `(22 templates: PM, 3 architects, 4 core devs, quality-gater, planner, context-provider, doc-updater, and domain specialists)`.

**Risk**: CLAUDE.md table rewrite is the most visible change. Keep surgical — table + template count line only. Run `cd mcp-server && npm test` after.

**Success**: testing-patterns.md has Path B2. CLAUDE.md delegation table covers 3-phase model. Template count accurate.

---

### Phase D: Integration Test Additions
**Owner**: arch-testing → test-specialist (session peer)
**Depends on**: Phase C (tests validate C output)

**D1 — session-team-peers.test.ts**:
```typescript
it('team-topology documents broadcast workaround for SendMessage(to="*")', () => {
  expect(topologyContent).toContain('SendMessage(to="*")');
  expect(topologyContent).toMatch(/workaround|individual messages/i);
});
```

**D2 — doc-integrity-system.test.ts**:
```typescript
it('testing-patterns Quick Reference mentions Path B2', () => {
  expect(testingPatternsContent).toContain('Path B2');
});
it('testing-patterns-dispatcher-scopes covers SharedFlow CUT scope', () => {
  expect(dispatcherScopesContent).toContain('Path B2');
  expect(dispatcherScopesContent).toContain('SharedFlow');
  expect(dispatcherScopesContent).toContain('testScheduler');
});
```

**D3 — agent-content.test.ts**:
```typescript
it('all L0 agents with model field also have token_budget', () => {
  for (const file of l0AgentFiles) {
    const content = readFileSync(file, 'utf8');
    if (content.includes('\nmodel:')) {
      expect(content, `${basename(file)} missing token_budget`).toContain('token_budget:');
    }
  }
});
```

Run: `cd mcp-server && npm test` — full suite must be green.

---

### Phase E: CI Monitoring + Commits
**Owner**: PM directly (no coding)

**E1 — Diagnose PR #26 failing checks** (L0):
- Run `gh pr checks 26`; identify the 3 failures
- Fix (likely registry hash mismatch from previous session's agent changes)
- `cd mcp-server && npm test` locally

**E2 — L0 commit + push**:
- Files: testing-patterns.md, CLAUDE.md, 3 integration test files
- Commit: `fix(docs): add Path B2 to testing-patterns QR + CLAUDE.md delegation table refresh + 3 integration tests`
- Push `feature/l0-templates-patterns-2026-04-04`, monitor CI until 11/11 green

**E3 — L1 commit + push**:
- Files: 18-20 agent files by name
- Commit: `fix(agents): add l0 sync stamps + fix stale context-provider + quality-gater descriptions`
- Push `feature/l0-sync-2026-04-04`, monitor CI

**E4 — L2 commit** (no push):
- Files: 11-13 agent files by EXACT name
- Commit: `fix(agents): add l0 sync stamps + ui-specialist Edit tool + stale description fixes`
- **Flag to user**: DawSync has no git remote. Cannot push or create PR. User must run:
  ```bash
  git remote add origin <remote-url>
  git push -u origin feature/uat-polish-wave1
  ```

**E5 — Flag PM intent issue to user**:
DawSync `project-manager.md` has `intent: [implement, feature, build, create, develop, plan]`. This is wrong for an orchestrator that NEVER writes code. L0 uses `[orchestrate, plan, assign, escalate, coordinate]`. Memory says intentional — ask user to confirm or correct.

---

## Dependencies

```
Phase A (L1 stamps + descriptions)  ─── independent ───┐
Phase B (L2 stamps + tool fix)       ─── independent ───┤
Phase C (doc content)                ─── independent ───┤→ Wave 1 (all parallel)
                                                        │
Phase D (tests — validates C)        ─── after C ───────┤→ Wave 2
                                                        │
Phase E (CI + commits)               ─── after A+B+C+D ─┘→ Wave 3
```

---

## Architect Routing

| Phase | Architect | Dev | Notes |
|-------|-----------|-----|-------|
| A | arch-platform | extra dev A (named, no team_name) | 18 L1 stamps + 2 description fixes |
| B | arch-platform | extra dev B (named, no team_name) | 11 L2 stamps + 1 tool fix + 2 descriptions; highest-risk commit |
| C | arch-testing | doc-updater (session peer) | 3 doc edits; CLAUDE.md is sensitive |
| D | arch-testing | test-specialist (session peer) | 3 new integration tests |
| E | PM directly | — | CI diagnosis + commits + user flags |

**Extra devs needed**: 2 named extras for A+B in parallel (no team_name). Spawn both when Phase 1 begins. Kill after arch-platform verifies diffs.

---

## Cross-Department Impact
- **Product**: none
- **Marketing**: none

---

## Risks

| Risk | Mitigation |
|------|-----------|
| L2 dirty worktree pollutes commit | Stage ONLY patched files by exact name; `git diff --cached` before commit |
| L2 PM body overwritten | Dev reads full PM file before editing; verifies `model: opus[1m]` + 7 skills intact after |
| Wrong l0_hash values | arch-platform instructs dev to compute sha256 of current L0 file content (`sha256sum <file>`), not guess |
| CLAUDE.md table rewrite breaks tooling | `cd mcp-server && npm test` after C2; table is display-only but verify |
| PR #26 CI failures block L0 merge | Diagnose in E1 before adding new commits to same branch |
| DawSync no remote | Flagged in E4; does not block other phases |

---

## Verification / Success Criteria

- [ ] All 39 L1 L0-shared agents have `l0_hash` in frontmatter
- [ ] All 35 L2 L0-shared agents have `l0_hash` in frontmatter
- [ ] L2 ui-specialist: `tools:` line includes `Edit`
- [ ] L2 doc-updater: `session-dawsync` still present (spot-check after Phase B)
- [ ] L2 project-manager: `model: opus[1m]` + 7 custom skills intact
- [ ] L1 + L2 context-provider, quality-gater: descriptions match L0
- [ ] testing-patterns.md Quick Reference: Path B2 bullet present
- [ ] CLAUDE.md delegation table: all 9 session team peers + key specialists listed
- [ ] CLAUDE.md template pointer: reflects 22 templates
- [ ] `cd mcp-server && npm test`: full suite green (existing + 3 new tests)
- [ ] PR #26 CI: 11/11 checks green
- [ ] L1 PR #10 CI: green after Phase A push
- [ ] L2: clean commit on `feature/uat-polish-wave1`; remote blocker + PM intent issue flagged to user
