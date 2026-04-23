# Backlog — Deferred Work from Wave 25

> Created: 2026-04-21
> Scope: items intentionally deferred during Wave 25 to keep blast radius manageable. Each entry has a trigger condition for when it should be picked up.

## Wave 26 candidates (MCP wiring round 2)

### BL-W26-01: Wire MCP tools into 28 remaining agents

**Status**: backlog
**Priority**: medium
**Deferred from**: Wave 25 Task #2

Wave 25 wired MCP tools into the 10 core agents that referenced them in prose. These 28 agents were out of scope because they didn't reference MCP tools in prose, but some of them **should** — they'd benefit from first-class MCP access:

| Agent | Candidate MCP tools |
|-------|---------------------|
| `test-specialist` | `code-metrics`, `module-health`, `kdoc-coverage`, `find-pattern` |
| `ui-specialist` | `compose-preview-audit`, `string-completeness`, `find-pattern` |
| `release-guardian-agent` | `scan-secrets`, `proguard-validator`, `check-version-sync` |
| `cross-platform-validator` | `verify-kmp-packages`, `module-health`, `dependency-graph` |
| `privacy-auditor` | `scan-secrets`, `code-metrics`, `find-pattern` |
| `platform-auditor` | `dependency-graph`, `verify-kmp-packages`, `gradle-config-lint` |
| `full-audit-orchestrator` | `audit-report`, `findings-report`, `audit-docs` |
| `quality-gate-orchestrator` | `validate-all`, `findings-report` |
| `quality-gater` | `validate-all`, `code-metrics`, `validate-doc-update` |
| `planner` | `find-pattern`, `module-health`, `code-metrics`, `search-docs` |

**Not needed** (intentional): `advisor`, `researcher`, `debugger`, `content-creator`, `landing-page-strategist`, `product-strategist`, `marketing-lead`, `product-lead`, `skill-script-alignment`, `template-sync-validator`, `script-parity-validator`, `doc-code-drift-detector`, `module-lifecycle`, `domain-model-specialist`, `data-layer-specialist`, `feature-domain-specialist`, `doc-migrator`, `api-rate-limit-auditor`.

**Trigger**: after Wave 25 MCP metrics stabilize (post-2026-05-05) and we can see which of the 28 agents are calling `Bash grep/find` instead of MCP tools.

**Estimated effort**: 2-3 hours. Mostly frontmatter edits + mirror + registry regen.

---

## Skill Analytics Levels B + C

### BL-W26-02: Level B — skill-leak-check script

**Status**: backlog
**Priority**: medium
**Deferred from**: Wave 25 Task #13 (Level A shipped)

Level A aggregates `skill_name` from tool-use-log. Level B adds **alternative-path detection**: when an agent runs a raw Bash command that a skill wraps, flag the leak.

**Detection patterns**:
- `./gradlew test` (raw) while `/test` skill exists → leak
- `grep -rE "pattern" src/` (raw) while `/find-pattern` MCP tool exists → leak
- `kotlinc --verbose ...` while kmp skill exists → leak

**Implementation sketch**: `scripts/sh/skill-leak-check.sh` (+ `.ps1`)
1. Read `.androidcommondoc/tool-use-log.jsonl`
2. For each Bash entry, extract command via `input_summary`
3. Cross-reference against skill wrappers declared in `skills/*/SKILL.md` (new `wraps:` frontmatter field would help — or a hardcoded map for now)
4. Output: list of Bash calls that had a skill alternative, grouped by agent

**Effort**: ~2 hours (map + detection script + /metrics wiring).

### BL-W26-03: Level C — retroactive intent-matching analysis

**Status**: backlog
**Priority**: low
**Deferred from**: Wave 25 Task #13

For each completed session, look at the task intent (from prompt / PLAN.md) and cross-check which skills' `intent:` frontmatter matched but weren't invoked. Produces a "should-have-used" report.

**Effort**: ~4-6 hours. Requires session-level intent annotation (doesn't exist today — would need capture).

---

## Housekeeping

### BL-W26-04: `.gsd/agents/` mirror cleanup

**Status**: backlog
**Priority**: low
**Memory**: `project_wave19_sprint2_deferred.md`

`.gsd/agents/` has stale mirrors of `.claude/agents/` (4+ files still reference `project-manager` after Wave 25 rename). Decision: sync OR deprecate the directory.

### BL-W26-05: Align `.planning/` historical plan files

**Status**: backlog
**Priority**: low

`.planning/` contains historical plan files referencing the old `project-manager` name. These are session-scoped plan history — renaming would rewrite historical record. Option A: leave as-is (historical record). Option B: add a top-level note in each file: "Wave 25: role renamed to team-lead". Currently: left as-is.

---

## Non-backlog (intentional — no plan to wire)

- `android-cli-bridge` MCP tool — L2-only (DawSync/WakeTheCave)
- `best-practices`, `core-web-vitals`, `web-quality-audit` skills — L2/web-specific for DawSyncWeb
- `sync-gsd-*` skills — GSD-specific integration, user-invoked

---

## Open Bugs

### Bug #8 — ExitPlanMode does not activate Phase 2 dev topology (FIXED Wave 26)

**Status**: FIXED in Wave 26 (team-lead v6.1.0 template + MIGRATIONS entry).
**Discovered**: Wave 26 BL-W26-01a session (2026-04-21).
**Regression window**: Wave 22+ (since Phase 2 Core Devs block was added but not enforced as post-ExitPlanMode gate).

**Symptom**: after `ExitPlanMode()` completes, team-lead sends EXECUTE dispatches directly to architects without first spawning the 4 core devs (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist). Architects then self-edit source/template/test files using their `Read` + `Bash` mediation tools, bypassing the dispatch-through-dev topology.

**User report**: "plan mode was activated correctly, but upon exit it wasn't switched to execution mode of the topology. Currently no devs are working and all work has been done by the architects."

**Impact**: violates `feedback_persistent_dev_model.md` + `feedback_architect_writes_code.md`. Architects accumulate token cost on implementation work; devs never gain session context; no architect-dev audit trail exists in commit log.

**Fix applied (Wave 26 commit 2)**:
1. `setup/agent-templates/team-lead.md` §Planning Phase — added Step 6 "⛔ MANDATORY Phase 2 Topology Activation Gate".
2. `.claude/agents/team-lead.md` — mirror synced.
3. `setup/agent-templates/MIGRATIONS.json` — added `team-lead 6.1.0` entry with Bug #8 note.
4. `feedback_plan_mode_exit_topology.md` memory entry created.

**Verification post-fix (future waves)**: team-lead must spawn 4 core devs immediately after ExitPlanMode; architect EXECUTE dispatches must include the no-self-edit mandate; team-lead verifies commits are authored through dev layer.

### BL-W26-06 — Rollback W25 pattern-search MCP wiring + codify dev→arch→CP chain (✅ SHIPPED Wave 27)

**Status**: ✅ SHIPPED — PR #61, 2026-04-22
**Discovered**: Wave 26 post-session review.

Architects (arch-testing, arch-platform, arch-integration) and team-lead gained `find-pattern`, `module-health`, `pattern-coverage` in frontmatter during Wave 25 MCP wiring. These are pattern-search/lookup tools that violate the Search Dispatch Protocol (T-BUG-015): pattern queries must enter via context-provider, not be callable directly from architects or team-lead.

**Fix applied (Wave 27)**:
1. Stripped `find-pattern`, `module-health`, `pattern-coverage` from arch-testing, arch-platform, arch-integration, team-lead frontmatter.
2. Added "Why you hold the pattern chain (W27)" prose to 3 architect templates + clarifying sentence to 4 core dev templates.
3. Split arch-testing.md → hub + `docs/agents/arch-testing-dispatch-protocol.md` sub-doc.
4. 8 MIGRATIONS.json entries + registry regen.
5. New Group 8 anti-regression tests (7 tests) + 10 version assertion bumps.

---

## Wave 28 closures (2026-04-22)

### BL-W27-01 — CP Spawn Protocol Zod validation fix (✅ SHIPPED Wave 28)
**Status**: ✅ SHIPPED — commit d0fb39a on develop via PR feature/wave-28
**Problem**: context-provider Spawn Protocol Step 2 called `find-pattern` with only `{category: "..."}` but the tool requires `query: string` (Zod validation error).
**Fix**: replaced with `search-docs` using keyword queries matching category names. Evidence: `.claude/agents/context-provider.md:29-31`, `setup/agent-templates/context-provider.md:29-31`.

### BL-W27-02 — Dev scope gate uniformity (✅ SHIPPED Wave 28, Opción B)
**Status**: ✅ SHIPPED — commit 721b2a2
**Decision**: Opción B — permissive specialty-default + architect-authorized override for all 4 core devs.
**Evidence**: `setup/agent-templates/test-specialist.md` Owned Files (lines 69+). test-specialist 1.11.0 → 1.11.1.

### BL-W27-03 — Agent-template ownership formalization (✅ SHIPPED Wave 28)
**Status**: ✅ SHIPPED — commit 721b2a2
**Decision**: doc-updater owns agent-template `.md` edits by default; core devs own when change is specialty-domain.
**Evidence**: `setup/agent-templates/doc-updater.md` Owned Files (line 140); `CLAUDE.md` Workflow policy rule. doc-updater 2.4.0 → 2.5.0.

### BL-W27-04 — Spawn-prompt hygiene (✅ SHIPPED Wave 28)
**Status**: ✅ SHIPPED — commit 721b2a2
**Decision**: lean standby-only spawn prompts; no wave/round forecasts.
**Evidence**: `docs/agents/agent-core-rules.md` Spawn Prompt Hygiene section; cross-refs in team-lead.md + tl-dispatch-topology.md. team-lead 6.2.0 → 6.2.1.

### BL-W26-01b — planner MCP frontmatter (✅ Resolved no-change Wave 28)
**Status**: ✅ Resolved — no change needed.
**Verdict**: planner frontmatter stays `Read, Write, Bash, SendMessage`. Rationale: W27 rolled back pattern-search MCP from architects precisely because pattern queries must route via context-provider. Adding MCP to planner would recreate the W27 anti-pattern. Planner defers pattern/metric queries to context-provider via SendMessage.

---

## W17 Topology Findings — Triage Verdicts (Wave 28)

### W17 HIGH findings (5)

| # | Finding | Status | Evidence / Target-wave |
|---|---------|--------|-------------------------|
| #1 | architect-pm-routing-post-shutdown (liveness hook) | ✅ SHIPPED Wave 28 | `.claude/hooks/addressee-liveness-gate.js` + `.claude/settings.json` hook wiring. 3 bats tests pass. Commit d0fb39a. |
| #2 | catalog-coverage-check-kts-blind | OBSOLETE | Already fixed: `scripts/sh/catalog-coverage-check.sh:85` scans `*.gradle.kts`. No action needed. |
| #3 | architect-contradictory-dispatch (Message Topic Discipline) | ✅ SHIPPED Wave 28 | "Message Topic Discipline" section in 3 architect templates + `docs/agents/tl-dispatch-topology.md`. Commit d0fb39a. |
| #4 | arch-platform-scope-expansion-pattern (Scope Immutability Gate) | ✅ SHIPPED Wave 28 | "Scope Immutability Gate" section in 3 architect templates + `docs/agents/arch-topology-protocols.md`. Commit d0fb39a. |
| #5 | catalog-grep-hyphen-vs-dot (Kotlin scan) | ✅ SHIPPED Wave 28 | `scripts/sh/catalog-coverage-check.sh` Check 2 now scans `**/*Konsist*.kt` + `detekt-rules/**/*.kt`. Bats fixture test. Commit d0fb39a. |

### W17 MEDIUM findings (13) — triage by Explore agent 2026-04-22

| # | Finding | Status | Evidence / Target-wave |
|---|---------|--------|-------------------------|
| #1 | Pre-fetched Wave 3 scope during Wave 0 | OBSOLETE-W23 | scope_doc_path + Activation Sequence enforced in arch templates. |
| #4 | /pre-pr K/N interop @Suppress allowlist | DEFERRED → W29 | Simple-fix ~20min: add K/N stdlib interop allowlist to pre-pr SKILL.md. |
| #5 | Dev skipped Step 2' in STRICT dispatch | OBSOLETE-W27 | Architect-chain mediation + PREP/EXECUTE modes. |
| #6 | team-lead dispatched dev directly when PM absent | OBSOLETE-W23 | Reporter Protocol + [team-lead-absent] fallback. |
| #9 | arch-platform skipped Step 1 (amend) | OBSOLETE-W27 | PREP/EXECUTE explicit sub-steps eliminate numbered-step ambiguity. |
| #11 | arch-platform asserted macOS can't IO (stale KMP knowledge) | DEFERRED → W30+ | Requires new `docs/architecture/kmp-features-2026.md` reference doc + context-provider integration. Combined effort with #17 ~6-8h. |
| #13 | team-lead dispatched grep to architect vs CP | OBSOLETE-W23 | Search Dispatch Protocol (T-BUG-015) routes grep via context-provider mandatory. |
| #14 | Dev committed compile FAIL marked "pre-existing" | DEFERRED → W29 | Requires git pre-commit hook template for mechanical compile-fail blocking. |
| #16 | Audit grep missed core/audio, core/media-session, core/data | DEFERRED → W29 | Simple-fix: add `--module-paths` flag to catalog-coverage-check.sh. |
| #17 | Architect assumed JVM-only features not in K/N | DEFERRED → W30+ | Same root cause + fix as #11; covered by KMP features reference doc. |
| #18 | arch-platform overrode team-lead ruling (4th override) | OBSOLETE-W26 | Phase 2 Topology Gate + git-log verification. Plus W28 W17 #4 Scope Immutability Gate hardens further. |
| #19 | Dev producing diagnostic interpretation | DEFERRED → W29 | Simple-fix template rule: "raw output + [DEV NOTE]" guidance in specialist Summary section. |

### W17 LOW finding (1)

| # | Finding | Status | Evidence |
|---|---------|--------|----------|
| #8 | team-lead relayed dev claim without verification | OBSOLETE-W26 | Findings Protocol + Post-Validation Doc Check enforce verify-before-relay. |

---

## External deferrals

### Plugin v0.2.1 (dokka-markdown-plugin standalone)
**Status**: DEFERRED — triggered-only, no target-wave
**Trigger**: user issue / downstream request / Maven Central publish (v0.3.0) / W33+ adoption plan.
**Evidence**: memory `project_plugin_v0.2.1_status.md` — v0.2.0 stable since 2026-04-19, 10 @Disabled tests, no active work. Verification Wave 28 by Explore agent.

---

## Summary of backlog state as of Wave 28 close (2026-04-22)

**✅ SHIPPED in Wave 28**: 5 BL items (BL-W27-01..04 + BL-W26-01b) + 4 W17 HIGH (#1, #3, #4, #5)
**OBSOLETE closed**: 1 W17 HIGH (#2) + 7 W17 MEDIUM/LOW (#1, #5, #6, #9, #13, #18, LOW #8) — total 8
**DEFERRED → W29**: 4 W17 MED simple-fix (#4, #14, #16, #19)
**DEFERRED → W30+**: 2 W17 MED complex (#11, #17)
**TRIGGERED-ONLY**: Plugin v0.2.1
**Remaining HIGH without target-wave**: **ZERO** ✓
**Remaining MEDIUM without target-wave**: **ZERO** ✓

L0 is shipping-ready for Wave 29 propagation.

---

## Wave 29 closures (2026-04-23)

### BL-W29-01 — L1 manifest drift cleanup (✅ SHIPPED W29)
Removed ghost dev-lead + L0-generic entries (platform-auditor, module-lifecycle) from shared-kmp-libs l2_specific.agents. Added project-manager (legacy L1). PR #28.

### BL-W29-02 — api-contract-guardian CP gate (✅ SHIPPED W29)
Added FIRST ACTION SendMessage(CP) per agent-core-rules.md § 1. PR #28.

### BL-W29-03 — DawSync manifest drift cleanup (✅ SHIPPED W29)
Removed data-layer-specialist + domain-model-specialist (L0 generics). Added audio-engine-specialist + build-in-public-drafter (real L2-private but missing). Commit d3af4ce9 on feature/sidebar-bug-sprint.

### BL-W29-04 — 4 DawSync private agents CP gate (✅ SHIPPED W29)
daw-guardian, audio-engine-specialist, freemium-gate-checker, producer-consumer-validator. Commit 0f654dcd.

### BL-W29-05 — L0 dev-lead legacy reference cleanup (✅ SHIPPED W29)
Removed dev-lead mentions from doc-alignment-agent.md (both locations) + skills/work/SKILL.md orchestrator safety list. On L0 feature/wave-29 (pending commit).

---

## Wave 30 seeds

### BL-W30-01 (LOW tool fix) — tool-use-analytics aggregation bug
`mcp-server/src/tools/tool-use-analytics.ts` reports `our_mcp_calls: 0` when log has 16+ entries with `mcp_server: "androidcommondoc"`. Aggregation bug. ~15 min fix.

### BL-W30-02 (observation) — CP shutdown latency memory update
Update `feedback_cp_shutdown_bug.md`: CP DOES process shutdown_request, with ~38s delay after first TeamDelete rejection. Current memory says "ignores shutdown_request" — incorrect. Bug #3 (TeamDelete-before-TeamCreate) remains conservative workaround.

### BL-W30-03 (doc alignment audit) — DI patterns drift check
Verify no drift between `docs/di/di-patterns-modules.md` and `~/.claude/CLAUDE.md` global DI guidance (KoinIsolatedContext, startKoin semantics).

### BL-W30-04 — /sync-l0 setup/agent-templates/ staleness bug (from W29 observations)
`/sync-l0` does NOT propagate `setup/agent-templates/`. L1 + L2 `team-lead.md`, `quality-gater.md`, etc. lag L0 after every L0 wave. Fix in sync-engine.ts: include that dir OR provide explicit propagation command. Memory: `project_sync_staleness_bug.md`.

### BL-W30-05 — DawSync remote setup
DawSync is local-only. When ready: create GitHub repo, `git remote add origin ...`, push develop + master + feature/sidebar-bug-sprint. Enables normal PR flow for future waves.

### BL-W30-06..09 — W17 MED simple-fixes deferred from W29 Phase 4
(Phase 4 skipped this wave — capacity allocated to manifest drift cleanup + CP gates.)
- BL-W30-06 (from W17 MED #4): /pre-pr K/N stdlib interop @Suppress allowlist. ~20min. skills/pre-pr/SKILL.md.
- BL-W30-07 (from W17 MED #14): git pre-commit hook blocking compile-fail commits.
- BL-W30-08 (from W17 MED #16): --module-paths flag for catalog-coverage-check.sh.
- BL-W30-09 (from W17 MED #19): specialist raw-output + [DEV NOTE] template rule.

### BL-W30-10 — W29 A3 scope creep lesson
W29 initially ran /pre-pr /check-outdated /audit-docs in L1 via test-specialist — this was out of scope. Future waves: L0 propagates only; L1/L2 consoles validate. Codify in planner template if needed.

---

## Out-of-scope leftover (pre-Wave 25)

- `project_wave17_l2_topology_findings.md` findings #1, #2, #4, #5, #6, #8, #9, #10, #12, #14, #17, #18, #19 — may become unnecessary if Wave 17-lite hypothesis holds post-reset
- Plugin v0.2.1 TestKit classloader fix — blocked on Maven Central publish (see `project_plugin_v0.2.0_shipped.md`)
