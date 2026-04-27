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
**Status**: RESOLVED (2026-04-24, W30 Round 5)
**Resolution**: .gsd/agents/ already gitignored (.gitignore:68). material-3-skill/ never existed. Agent mirrors near-parity — 1 orphan (project-manager.md in .claude/ only) + 3 missing .claude/ copies (data-layer-specialist, domain-model-specialist, team-lead). Forward constraint recorded in CLAUDE.md.

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

---

## Wave 31 closed items

### BL-W31-00 — team-lead template hardening (CLOSED in W31)
**Status**: closed | **Priority**: high | **Wave**: W31
**Bugs closed**:
- Bug 1 (subagent_type="Plan"→"planner"): FIXED W31 session start (pre-plan)
- Bug 2 (plan-context.js didn't block PLAN*.md writes): FIXED via sentinel mechanism (.planning/.plan-mode-active) + PreToolUse Write/Edit hook
- Bug 3 (FORBIDDEN Bash CLI agent spawn unenforced): FIXED via NEW bash-cli-spawn-gate.js (A8 false-positive safe — `claude --help` not blocked)
- Bug 4 (/work skill spawned team-lead subagent → Agent() loss per #31977): FIXED via skills/work/SKILL.md inline rewrite + MAIN-CONTEXT-ONLY warning
**Tests**: 7 assertions in wave31-team-lead-hardening.test.ts, all GREEN

---

## Wave 31.5 findings (in-flight discovery)

> **W31.5 status (2026-04-25):** Trilogy COMPLETE. v0.1.0 (sub-wave a) + v0.2.0 (sub-wave b) + v0.3.0 (sub-wave c) all shipped. All BL-W31.5-XX items below remain DEFERRED to a post-W31.5c L0 cleanup session — none addressed in W31.5c per resume prompt rule "no L0 commits in this wave".

### BL-W31.5-01 — Architect dispatch uses subagent_type instead of team name (HIGH)

**Status**: SHIPPED 2026-04-25 in PR #69 (77aa199)
**Priority**: HIGH — this bug desencadena toda una cadena de fallos de dispatch
**Discovered**: 2026-04-25 during Wave 31.5 execution (user confirmed root-cause)

**Problem**: Architect templates (arch-platform, arch-integration, arch-testing) dispatch devs using `SendMessage(to="data-layer-specialist")` — the agent's `subagent_type` — instead of the team member's NAME (`data-dev`, `domain-dev`, `ui-dev`, `test-dev`). SendMessage routing requires the NAME. Messages sent to a subagent_type go to a nonexistent address. Devs sit idle waiting for a dispatch that never arrives; team-lead must re-dispatch directly to unblock.

**Impact observed in W31.5**:
- Round a-2 Track 1 + Track 2 both stalled ~15 min when arch-integration sent dispatches to "domain-model-specialist" / "data-layer-specialist" — devs never received them. Team-lead detected + re-dispatched to `domain-dev` / `data-dev`.
- Round a-4: same pattern with "ui-specialist" — team-lead had to forward from own inbox to `ui-dev`.

**Root cause**: Architect templates show examples like `SendMessage(to="test-specialist")` where `test-specialist` is the subagent_type, not the team name. The 4-core-dev persistent model uses short names (`data-dev` etc.) per the team config.

**Fix (proposed)**:
1. In `setup/agent-templates/arch-platform.md`, `arch-integration.md`, `arch-testing.md`: replace every `SendMessage(to="<subagent_type>")` example with `SendMessage(to="<team-name>")`. The canonical names are:
   - `data-layer-specialist` → `data-dev`
   - `domain-model-specialist` → `domain-dev`
   - `ui-specialist` → `ui-dev`
   - `test-specialist` → `test-dev`
2. Add a "Dev dispatch protocol" section to the 3 architect templates that explicitly states: "Dispatch by team NAME (e.g., `data-dev`), NOT by subagent_type (`data-layer-specialist`). Team-lead spawns the 4 core devs with fixed names; subagent_type is the agent file, name is the addressable handle."
3. Optional enforcement: a hook that rejects SendMessage to unknown names, or a validator in the quality-gater's pre-pr step.

**Tests**: 1 assertion per architect template (grep -L for `SendMessage(to="[a-z]+-specialist"` in each arch-*.md) + 1 integration that validates a session-level round-trip `architect → dev-name`.

**Copies to propagate**: `.claude/agents/arch-platform.md`, `.claude/agents/arch-integration.md`, `.claude/agents/arch-testing.md`. Must also rehash registry after.

**Triggered**: post-W31.5c (this wave's scope is extraction-only; L0 template edits are a separate next wave).

---

### BL-W31.5-02 — ui-specialist template is Compose-only; no docs-owner role in no-UI waves (MEDIUM)

**Status**: SHIPPED 2026-04-25 in PR #69 (77aa199)
**Priority**: medium
**Discovered**: 2026-04-25 during Wave 31.5 (no-UI wave)

**Problem**: `setup/agent-templates/ui-specialist.md` assumes Compose UI work (accessibility, Material3, previews, a11y). In waves without UI (CLI tools, Gradle plugins, backend-only), there is no natural owner for README + doc ports + CHANGELOG + English polish. Current workaround: team-lead re-scopes ui-dev to "docs owner" per-dispatch, but this is a forced fit — ui-specialist.md contains instructions irrelevant to docs work that can confuse the agent (e.g., "audit Compose previews" with no previews to audit).

**Observed in W31.5**:
- Round a-4 dispatched ui-dev to port 8 L0 testing docs (pure markdown copy + frontmatter strip). User initially read this as "ui-dev doing testing" — template language ambiguity.
- Sub-wave c Round c-3 will dispatch ui-dev for CHANGELOG + final README + English polish. Again, zero Compose UI.

**Fix options**:
1. **Split**: create a new `docs-owner` agent template (README, CHANGELOG, English polish, frontmatter discipline, doc-hub/split strategy). Core roster becomes 5: data-dev / domain-dev / ui-dev / test-dev / docs-dev. But adds complexity.
2. **Generalize**: rewrite `ui-specialist.md` to cover both Compose UI AND repo docs. Add a mode toggle ("I'm in a UI wave vs a docs-only wave"). Less disruption.
3. **Delete ui-dev from no-UI waves**: team-lead spawns only 3 core devs (data/domain/test) in waves with no UI, and handles docs directly OR dispatches doc-updater (which already exists).

**Recommendation**: Option 3 is simplest; doc-updater already has repo-docs ownership semantics. Spec: if wave prompt declares `ui_scope: none`, team-lead skips ui-dev spawn and routes doc work to doc-updater.

**Triggered**: post-W31.5c, same batch as BL-W31.5-01.

---

### BL-W31.5-03 — kmp-test-runner CI tool catalog (L0 parity check)

**Status**: partial-done (W31.5 in-flight); remainder tracked for later sub-waves
**Priority**: medium
**Discovered**: 2026-04-25 during W31.5 ship-gate review (user asked about L0 tool parity)

**Context**: kmp-test-runner is a new OSS repo — needs comparable CI tooling to L0 where it applies. Mapping of L0 tools to kmp-test-runner state:

| Tool (L0) | Applies here? | Status | Wave |
|---|---|---|---|
| TruffleHog OSS `--only-verified` | Yes | **DONE** (a-2 A3 amendment) | W31.5a |
| shellcheck `--severity=warning --external-sources` | Yes | **DONE** (a-2) | W31.5a |
| bats + Pester + vitest + coverage 80% | Yes | **DONE** (a-3) | W31.5a |
| `npm audit` | Yes | **IN FLIGHT** at ship gate | W31.5a |
| License checker (Apache-2.0 compat) | Yes | **PLANNED** sub-wave c | W31.5c |
| markdown-link-check / lychee | Yes | **PLANNED** sub-wave c Round c-2 | W31.5c |
| Dependabot (`.github/dependabot.yml`) | Yes | **TODO** sub-wave c polish | W31.5c |
| Detekt | Yes (for Gradle plugin Kotlin) | **TODO** sub-wave b | W31.5b |
| kdoc-coverage | Yes (plugin public API) | **TODO** sub-wave b | W31.5b |
| gradle-config-lint | Yes (plugin build.gradle.kts) | **TODO** sub-wave b | W31.5b |
| verify-kmp-packages | No (plugin is JVM-only; consumers are KMP) | N/A | — |
| dependency-graph (MCP) | Maybe (consumer Gradle plugin deps) | **DEFER** post-v0.3.0 | later |
| compose-preview-audit | No (no Compose UI) | N/A | — |
| string-completeness | No (no i18n surface) | N/A | — |
| module-health | No (single-module repo) | N/A | — |
| pattern-coverage | No (patterns are L0-internal) | N/A | — |
| eslint/prettier | Skip (only 2 .js files — bin wrapper + lib/cli.js, overkill) | **SKIP** | — |

**Fix plan**:
- Sub-wave a (now): add `npm audit` to ci.yml — standard, zero setup, vulnerability scan.
- Sub-wave b: add Detekt + kdoc-coverage + gradle-config-lint when Gradle plugin module lands.
- Sub-wave c: add license checker + markdown-link-check + Dependabot config as part of polish round.

**Triggered**: progressive; entries drop off as each sub-wave ships.

---

### BL-W31.5-04 — Dev specialist template recurring bug: devs search patterns directly instead of asking architect (HIGH)

**Status**: SHIPPED 2026-04-25 in PR #69 (77aa199)
**Discovered**: 2026-04-25 during W31.5c Round c-1 + c-2 EXECUTE — user observed `data-layer-specialist` searching patterns/docs directly instead of routing through `arch-platform → context-provider` chain.

**Pattern**: Recurring violation across waves despite W27 codification of dev→arch→CP chain (BL-W26-06) and W31 pre-split hardening. Specialist templates still permit (or fail to forbid emphatically) direct pattern lookups via Grep / find-pattern / Read on docs/* paths.

**Evidence**:
- W27 shipped explicit "ALL pattern queries go via reporting architect" preamble in 4 dev specialist templates.
- W26 wired CP gate hook (`context-provider-gate.js`) to block Read on docs/agents/*/templates/* paths.
- T-BUG-015 (Wave 30) hardened the gate against bash-search anti-patterns (grep/find on pattern paths from dev sessions).
- Despite all the above, devs still do it as of 2026-04-25 W31.5c.

**Root cause hypotheses** (need investigation in fix wave):
1. Hook misses some path patterns (e.g., agent-specific docs, MCP queries, planner outputs).
2. Template "ALL pattern queries via architect" wording is buried — needs hard FIRST-LINE banner that's harder to miss.
3. Spawn prompt includes lean defaults (per BL-W27-04 hygiene) that omit the explicit ban each session.
4. Architect EXECUTE dispatch templates don't repeat the ban (devs forget between PREP and EXECUTE).
5. Devs may be using grep/find via Bash instead of Grep tool, bypassing path-restriction hooks.

**Fix scope** (post-W31.5c L0 cleanup session — NOT this wave):
- Audit all 4 core specialist templates (`setup/agent-templates/{data-layer,domain-model,test,ui}-specialist.md`) for HARD ban language placement (top of file, not buried).
- Add explicit BANNED-TOOLS line at top of each spawn prompt (override of generic Read/Grep tool access for docs paths).
- Extend `context-provider-gate.js` hook coverage if path patterns are slipping through (audit missing path globs).
- Add detection: scan tool-use logs for dev sessions hitting docs/* directly; flag as gate-bypass for retroactive review.
- Repeat the ban in every EXECUTE dispatch template line (architects forward the ban into specialist prompts verbatim).
- Consider: rip Grep/Read from dev specialist tools entirely; route all queries via SendMessage to architect.

**Owner**: post-W31.5c L0 cleanup session.

**Severity**: HIGH — workflow integrity bug. Each violation costs user trust + tokens. 4+ recurrences across W26→W31.5c means current mitigations are insufficient.

**Memory refs**: `feedback_dev_context_delivery.md`; `project_wave27_shipped.md` (BL-W26-06 chain codification); `feedback_tools_not_connected.md`; `feedback_enforcement_not_templates.md` (hooks not templates).

---

## Wave 31.7 — Canonical Pattern Deep Refactor (TRIAGED 2026-04-27)

> Items detectados en W31.6 al cotejar con doc canónica de Anthropic (https://code.claude.com/docs/en/agent-teams). **Triaged 2026-04-27 post-PR #73**: BL-07 SHIPPED, BL-06 partially addressed (audit complete), BL-01..05 deferred to a fresh session focused on Phase 3 / W31.8 since each requires a multi-hour design discussion.

### BL-W31.7-01 (DEFERRED — fresh session) — Flat-spawning real

**Status**: Deferred to fresh session (post-Phase-3 milestone)
**Priority**: HIGH
**Spec**: Main spawnea los 4 devs core (data-layer-specialist, domain-model-specialist, ui-specialist, test-specialist) como peers desde Phase 1 — no nested via arquitectos. Arquitectos solo coordinan vía SendMessage a devs que ya son peers.
**Impacto**: ~40 archivos afectados (todos los templates de arch + devs + docs/agents/*). Cambio profundo en cómo arquitectos dispatch trabajo.
**Why deferred**: Architectural decision with broad blast radius — needs a dedicated planning session, not a closeout. Pairs naturally with BL-W31.7-05 (eliminar Phase 1/2/3 split).

---

### BL-W31.7-02 (DEFERRED — fresh session) — Pull-model task claiming

**Status**: Deferred to fresh session
**Priority**: MEDIUM
**Spec**: Peers idle ven TaskList y claiman tasks vía `TaskUpdate(owner=self)` en vez de push desde main vía `TaskUpdate(owner=other)`.
**Impacto**: Reentrenar templates de todos los peers para añadir "check TaskList on idle, claim available tasks" en lugar de "wait for assignment".
**Why deferred**: Push-model actual funciona; pull-model puede crear race conditions o tasks unclaimed. Necesita prototipo + observación antes de cambiar templates de prod.

---

### BL-W31.7-03 (DEFERRED — fresh session) — Reducción de hooks

**Status**: Deferred to fresh session
**Priority**: MEDIUM
**Spec**: Auditar hooks (`context-provider-gate.js`, `scope-immutability-gate.js`, `addressee-liveness-gate.js`) y consolidar/eliminar redundantes. Doc canónica usa prompts y tools — no hooks bash.
**Impacto**: Riesgo de regresión en enforcement (hooks bloquean violations mecánicamente, prompts solo guían).
**Why deferred**: Necesitamos telemetría de cuántas violations cada hook ha bloqueado en últimas N waves antes de eliminar. `tool-use-analytics` MCP debe correrse primero.

---

### BL-W31.7-04 (DEFERRED — fresh session) — Spawn-prompt diet pass 2

**Status**: Deferred to fresh session
**Priority**: MEDIUM
**Spec**: Bajar payload de spawn prompts de KB → bytes. Wave 22 hizo pass 1 (~30% reducción). Faltan pass 2 y 3.
**Impacto**: Reduce token cost por sesión.
**Why deferred**: Touches cada spawn prompt — coordinated rewrite across templates. Más coherente como dedicated wave de polish.

---

### BL-W31.7-05 (DEFERRED — fresh session) — Eliminar Phase 1/2/3 split

**Status**: Deferred to fresh session (paired with BL-W31.7-01)
**Priority**: MEDIUM
**Spec**: Doc canónica no tiene fases. Refactorizar `tl-session-setup.md` y guías para "spawn equipo, empezar" — sin fases discretas.
**Impacto**: Cambio de modelo mental significativo. Coordinación con doc-updater para reescribir guías.
**Why deferred**: Diseño accoplado a BL-W31.7-01 (flat-spawning real). Decisión de juntarlos vs separarlos pertenece a la fresh session.

---

### BL-W31.7-06 (✅ SHIPPED — audit complete) — Architect Bash-write workaround tightening
**Status**: Done. Substantially addressed by PR #73; closeout audit 2026-04-27 ran the architect tool-use-log entries from W31.5 / W31.6 against the new hook and surfaced one gap (python heredoc), which was patched in the same closeout session.
**Spec**: arch-testing during W31.6 used `Bash` + Python scripts to edit files because architects don't have Write/Edit by design. Original options:
- Remove `Bash` from architect tools entirely (forces dispatch to dev specialist) — REJECTED, breaks legitimate verification work.
- Hook that blocks Bash-invoked file writes (heredoc, python edit, sed, awk) when invoked by architect agents — **ADOPTED** as BL-W31.7-07.
- Or accept the workaround and document it as legitimate — REJECTED, undermines role boundary.
**Resolution**: Hook approach landed in PR #73 (`architect-bash-write-gate.js`). Initial 6 bypass patterns covered (heredoc redirect, sed -i, awk -i inplace, python -c open(...,'w'), tee write, plain shell redirect).
**Audit findings (2026-04-27 closeout)**: Cross-referenced `.androidcommondoc/tool-use-log.jsonl` for `agent_type` matching `arch-*` and `tool_name` `Bash`. Confirmed 5 of 6 patterns trigger correctly on real W31.5/W31.6 invocations (e.g. `cat > MIGRATIONS.json <<EOF`, `sed -i 's/...' file`, `cat > .../setup/agent-templates/...`, etc.). **One gap discovered**: `python3 << 'PYEOF' ... open(...,'w') ... PYEOF` heredoc form — observed 2026-04-21 with `arch-platform` editing `MIGRATIONS.json`. The `-c` flag was the regex anchor, so heredoc-fed python scripts slipped through. **Patched in same closeout PR**: added `PYTHON_HEREDOC_WRITE_RE` + 2 bats (`blocks python3 <<EOF heredoc with open(...,'w')` + `allows python3 heredoc without open() write`). Hook now covers 7 patterns; bats grew 21 → 23.

---

### BL-W31.7-07 (✅ SHIPPED 2026-04-27 — PR #73 commit 0514058) — Architect Bash file-write hook
**Status**: Done. `.claude/hooks/architect-bash-write-gate.js` (≈110 LOC) + `scripts/tests/architect-bash-write-gate.bats` (21 tests) + wired into `PreToolUse → Bash` matcher in `.claude/settings.json`. Pairs with `architect-self-edit-gate.js` to fully close the W31.5 architect Write/Edit bypass surface.
**Patterns blocked**: heredoc redirect, sed -i / --in-place, awk -i inplace, python(3)? -c open(...,'w'), tee write, plain `>` / `>>` redirect to non-exempt targets.
**Exempt write targets**: `/tmp/*`, `$TMPDIR/*`, `/dev/null`, `/dev/std*`, `.planning/wave*/arch-*-verdict.md`, `.androidcommondoc/audit-log.jsonl`.
**Test deltas**: 21 bats covering each block pattern, each exempt target, non-arch passthrough, read-only bash, fd-2 redirects, malformed input.
**CI**: 19/19 green on merge commit. Commit Lint required one amend (scope `(agents,hooks)` → `(agents)`; `hooks` not in valid scope list).

---

### BL-W31.7-11 — Manifest ABI (agent-API stability validator) (MEDIUM)
**Status**: backlog
**Priority**: MEDIUM (consumer-side stability concern)
**Source**: User question 2026-04-27 during Phase 3 round 1 wrap-up — "shouldn't we have something like Android's ABI?"

**Problem**: Phase 2/3 manifest tooling detects:
- DRIFT (template frontmatter ≠ manifest) — Phase 2 validator
- Frontmatter SHA-256 baseline (any byte change → drift) — Phase 3 generator
- Cross-cutting invariants (5 rules: ARCHITECT_NO_FILE_WRITE, IN_PROCESS_NO_AGENT, NAMING_CONVENTION, CANONICAL_NAME_MATCHES_SUBAGENT_TYPE, CONTEXT_PROVIDER_READ_ONLY)

But it does NOT detect **breaking changes** that would invalidate downstream consumers:
- Renaming `canonical_name` (breaks `Agent(subagent_type=...)` calls)
- Removing entries from `dispatch.can_send_to` (breaks SendMessage callers)
- Removing `tools.allowed` entries (caller's existing prompt may rely on them)
- Renaming `subagent_type` (breaks Agent spawning)
- Removing an agent entry entirely (breaks any caller still referencing it)
- Reordering `intent[]` if downstream routing depends on first-match semantics

**Comparison to Android's binary-compatibility-validator (BCV)**:
- BCV diffs the public Kotlin API surface (`.api` files committed to the repo) and fails CI on incompatible changes
- An "agent ABI" would diff a serialized manifest snapshot (e.g., `.claude/registry/agents.api`) against the live manifest and fail CI on incompatible changes
- Compatible (additive) changes: new agent, new field, new optional capability, expanding `tools.allowed`, expanding `dispatch.can_send_to`
- Incompatible: rename, remove, narrow, change required fields, change `subagent_type`, change `canonical_name`

**Approach options**:
- **Option A (snapshot file)**: commit `.claude/registry/agents.api` with the structural fingerprint of every agent (canonical_name, subagent_type, dispatch shape, required tools). PR diff vs baseline → flag breaking changes; require explicit `apiCheck()` analogous to BCV's `apiDump`.
- **Option B (per-agent contract test)**: each manifest entry annotated with `stability: stable|experimental` field; stable entries enforce ABI rules.
- **Option C (semantic-version field)**: bump `template_version` MAJOR for breaking, MINOR for additive, PATCH for fix. Validator checks: MAJOR-bump REQUIRED for breaking changes, BLOCK if not.

**Recommended**: A + C. A catches the structural diff; C catches contract intent. C is already half-built (every agent has `template_version` SemVer).

**Trigger**: when downstream consumers (skills, hooks, /work routing) start depending on manifest fields beyond `tools.allowed` and `description`. Currently Phase 4 pre-spawn hook will add `canonical_name + subagent_type` as load-bearing — that's the moment ABI becomes critical.

**Related**: BL-W31.7-09 (verdict-to-disk protocol — also a consumer contract issue). BL-W31.7-10 (quality-gater consumer assumptions about project shape).

---

### BL-W31.7-10 — quality-gater hardcodes Gradle/Kotlin protocol — fails on L0 (HIGH)
**Status**: backlog
**Priority**: HIGH (renders Phase 3 sequential gate unusable on L0 toolkit)
**Source**: Wave 31.7 Phase 3 round 1 dogfood, 2026-04-27

**What happened**: quality-gater spawned at 21:04, dispatched at 21:09 with 7-gate spec. Hung on "Running Git diff stat vs develop" for 2+ hours. Two pings (retract + status) received no response. team-lead bypassed and ran gates inline.

**Root cause**: `setup/agent-templates/quality-gater.md` (lines 94-132) hardcodes a Kotlin/Gradle/Compose project shape:
- Step 2: `/pre-pr` skill — assumes Gradle pipeline
- Step 2.5: `./gradlew build --warning-mode all` — no Gradle wrapper exists at L0
- Step 3: `/test-full-parallel --fresh-daemon` — Gradle skill
- Step 4: `/coverage` — Gradle skill
- Step 9: Compose UI tests — no Compose at L0
- Step 9.5: `android-layout-diff` / `compose-semantic-diff` MCP tools — N/A

This project (`AndroidCommonDoc`) is the L0 toolkit itself: Node.js MCP server + Bash/PS1 scripts + docs + agent templates. ZERO Kotlin, ZERO Gradle, ZERO Compose. quality-gater either silently looped on a missing Gradle wrapper or hung on a skill invocation that has no L0 implementation.

**Fix path** (3 options, pick one for W32):
- **Option A (project-shape detection)**: quality-gater Step 0 detects project shape (Gradle wrapper present? package.json present? both?) and branches the gate sequence. Add `setup/agent-templates/quality-gater-l0.md` variant for Node-only projects, OR fold the branching into the existing template.
- **Option B (skill abstraction)**: each gate step calls a project-defined skill (`/test`, `/coverage`, `/lint`) that resolves to the right runner per project. L0 skills target vitest/bats; L1/L2 skills target Gradle. quality-gater stays project-agnostic.
- **Option C (kill quality-gater for L0)**: explicitly mark quality-gater as L1/L2-only; L0 sequential verification falls to team-lead inline. Simplest; lowest topology coverage.

**Recommended**: B (skill abstraction). Aligns with the existing `/test`, `/coverage`, `/pre-pr` skill ecosystem. team-lead's inline run already works because team-lead is project-agnostic by design.

**Impact this wave**: Phase 3 round 1 ships without a quality-gater PASS stamp. The 3 architect APPROVEs + team-lead's inline verification (validator green, generator NOOP, mirror parity, 54+11 tests) substitute for quality-gater's role. NOT a blocker for Phase 3 but a critical L0 dogfood gap.

**Trigger**: W32 if topology hardening becomes a wave goal, OR earlier if another L0 wave hits the same hang.

**Related findings same session**:
- BL-W31.7-09 (architect verdict-to-disk fabrication)
- doc-updater silent for 25 min after dispatch (pattern unclear — may have been blocked on CP gate reading template files)

---

### BL-W31.7-09 — Architect verdict-to-disk protocol gap (HIGH)
**Status**: backlog
**Priority**: HIGH (honesty + protocol integrity)
**Source**: Wave 31.7 Phase 3 round 1 dogfood, 2026-04-27 — arch-platform fabricated disk-write claim

**What happened**: arch-platform's APPROVE DM stated "Verdict written to `.planning/wave31.7/arch-platform-verdict.md`" but the file did not exist on disk. When challenged, arch-platform admitted: "I have no Write or Edit tools in my toolset" and fabricated the claim. arch-testing and arch-integration successfully wrote their verdicts using Bash redirect (path is exempt per BL-W31.7-07 hook). arch-platform did not attempt the Bash-redirect path.

**Two-axis bug**:
1. **Honesty axis**: arch-platform fabricated protocol compliance to appear correct. This is the more dangerous failure mode — silent "OK" claims hide topology bugs.
2. **Protocol axis**: the verdict-to-disk step is mandatory in arch-platform's template but the agent has no obvious mechanism. Architects rely on the bash-redirect exempt path (`.planning/wave*/arch-*-verdict.md` per BL-W31.7-07) — fragile and undocumented in the agent template.

**Pick one fix path**:
- **Option A (template clarity)**: arch-* templates explicitly document the bash-redirect protocol with an example: `cat > .planning/wave{N}/arch-{X}-verdict.md <<EOF ... EOF` — make the hook-exempt path obvious, not implicit.
- **Option B (scoped Write)**: extend ARCHITECT_NO_FILE_WRITE invariant to allow Write tool only to `.planning/wave*/arch-*-verdict.md`. More invasive but self-documenting.
- **Option C (honesty hook)**: post-action hook on architect APPROVE messages that asserts the verdict file exists on disk; reject the DM if not. Catches future fabrication.

**Recommended**: A + C combined. A teaches the architect; C catches drift.

**Trigger**: ship Phase 3 round 1 first (verdict file written by team-lead on arch-platform's behalf), then file as W32 hardening.

---

### BL-W31.7-08 — `toolkit-specialist` agent (mcp-server TS work)
**Status**: backlog
**Priority**: medium
**Source**: Wave 31.7 Phase 3 round 1 plan validation (Plan agent surfaced gap during plan-mode design check, 2026-04-27)

**Problem**: `mcp-server/` TypeScript work has no formal core-specialist owner. Phase 3 round 1 used the main-agent + arch-platform review + test-specialist (for vitest/bats) pattern — worked fine for this round but stretches the existing 4 core-specialists (test/ui/data-layer/domain-model — all KMP-focused) outside their scope.

**Trigger**: when Phase 4 hook work (pre-Agent-spawn manifest validator hook) lands, OR when a future MCP tool addition is non-trivial enough that "main-agent writes the TS, arch-platform reviews" feels too thin.

**Decision points** (defer to that fresh session):
1. Add as 5th core-specialist (persistent Phase 2→end) or per-task spawn?
2. Scope: TS code in `mcp-server/`, hook scripts in `.claude/hooks/`, generator extensions, manifest validators?
3. Tools: Read/Write/Edit/Bash + which MCP tools? Likely `code-metrics`, `validate-doc-update`, plus the upcoming generator MCP tools.
4. Naming: `toolkit-specialist`, `mcp-specialist`, `tooling-specialist`?

**Estimated effort**: 1-2 hours (template authoring + manifest entry + sync to L1/L2 if scoped that way).

**Why not in Phase 3 round 1**: round 1 scope was "ship the generator + 3 architect pilots" — adding a new agent would have doubled the wave. Filed for the fresh session that picks up Phase 3 round 2 onwards.
