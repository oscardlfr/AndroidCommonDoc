# AndroidCommonDoc Backlog

> **Last updated**: 2026-05-03 (post BL-W34)
> **Source of truth**: this file is the ordered index. Detailed entries live in `git log` + `~/.claude/projects/.../memory/` (`project_*shipped.md`, `project_*backlog.md`).
> **Update protocol**: when a wave ships, move entry to `## Shipped (recent)`. New items appended in priority order under `## Active`.

## Active (proposed wave order)

### Wave 35 — L0 dogfood topology hardening (HIGH urgency, ~4-8h)

L1 (shared-kmp-libs) dogfooded BL-W34 → 6 confirmed bugs in L0 templates/protocols (audit at end of BL-W34 session 2026-05-03). Plus 1 recurring bug from BL-W31.5.

| ID | Severity | Item | Source |
|----|----------|------|--------|
| BL-W35-01 | HIGH | planner template "flag gaps, don't invent fixes" rule | L1 audit #2 |
| BL-W35-02 | HIGH | cross-architect cancel/amend relay (`docs/agents/arch-topology-protocols.md`) | L1 audit #4 |
| BL-W35-03 | HIGH | post-compaction re-sync protocol (template addendum × 4-5 agents) | L1 audit #7 |
| BL-W35-04 | MED | arch-testing "first dispatch only" + specialist on-spawn boilerplate | L1 audit #3 |
| BL-W35-05 | LOW | CP defensive `task_assignment` guard | L1 audit #6 |
| BL-W35-06 | HIGH | dev pattern-search recurring bug (BL-W31.5-04 fold) | `project_dev_pattern_search_recurring_bug.md` |
| BL-W35-07 | MED | architect activation protocol scope_doc explicit (Wave 19 #5 + L1 audit #5 fold) | `project_wave19_topology_debt.md` #5 |
| BL-W35-08 | HIGH | pre-commit branch guard hook (block direct commits to `develop`/`master`) | 2026-05-03 incident: parallel session committed directly to local develop — GitHub branch protection only blocks pushes, not local commits |

**Prompt scaffold**: `.planning/wave-bl-w35-l0-dogfood-topology-prompt.md` (local, gitignored).
**Recommended bundling**: 6 PRs (template fixes / cross-arch protocol / re-sync / CP+activation / dev-search investigation / branch guard hook).

### Wave 36 — BL-W34 deferred bundle (MED urgency, ~3-6h)

Items filed during BL-W34 wave; atomic test/template fixes.

| ID | Severity | Item |
|----|----------|------|
| BL-W34-G | HIGH | `context-provider-gate.test.js` F1 fix (failing test, clean env failure) |
| BL-W34-F | HIGH | `context-provider-consulted.test.js` per-agent vs session scope drift |
| BL-W34-H | MED | auto-bump version assertions on registry rehash (recurring PR4+PR5 fixup pattern) |
| BL-W34-D | MED | extract escalation + JDK env from test-specialist (restore 350-line limit) |
| BL-W34-C | MED | Vitest assertions for template prose rules |

**Source**: `project_wave_bl_w34_l1_security_prep_shipped.md` deferred section.

### Wave 37 — Cross-repo sync (waits for L1 BL-W35 completion, ~4-6h)

| ID | Severity | Item |
|----|----------|------|
| BL-W34-A | HIGH | L1 sync tool-use-logger.js Bug 1 (cross-repo coordination) |
| BL-W34-B | HIGH | L1 CI parity (Node test runner extension to reusable-shell-tests) |
| BL-W34-E | MED | per-tool-call marker nonces (researcher's deferred CP-bypass fix) |

### Wave 38 — Ingestion bundle (LOW urgency, ~2-4h)

| ID | Item |
|----|------|
| Ingest-1 | npm-cli-bin-field doc |
| Ingest-2 | gradle-patterns-plugin-authoring doc |
| Ingest-3 | testing-vitest-cjs-esm-mock-boundary doc |
| Ingest-4 | testing-vitest-esm-coverage-instrumentation doc |
| BL-W36-check | `/release-build-verify` promotion eval (calendar BL-W38 ~2026-07-03) |

**Source**: `project_w31.5_ingestion_deferred.md`, `project_bl_w36_backlog.md`.
**Recommendation**: consider folding 4 ingest items into a single `external-tooling-gotchas` hub doc.

### Wave 39 — Wave 19 topology debt + housekeeping (~10-15h)

| ID | Severity | Item |
|----|----------|------|
| W19-#3 | MED | session teardown hook (TeamDelete on session end) |
| W19-#4 | MED | `/work` skill rewrite for 3-phase topology |
| W19-#6 | MED | PREP/EXECUTE dispatch modes (verify partial Wave 23 ship) |
| Housekeeping | LOW | `.gsd/agents/` gitignore decision, `l0-manifest.json` source vs output, `material-3-skill/` triage, lingering remote branches |
| Modularization paso 2 | LOW | rewrite "Target architecture" section in `.planning/MODULARIZATION-PLAN.md` (~1h) |

**Source**: `project_wave19_topology_debt.md`, `project_wave19_sprint2_deferred.md`, `project_modularization_paso2_pending.md`.

### Wave 40 — Wave 17 L2 hardening (BIG, ~19-32h)

19 findings (5 HIGH, 13 MED, 1 LOW) from DawSync L2 session 2026-04-18. Hardens prose rules → mechanical gates (hooks, numbered-step assertions, liveness probes).

**Source**: `project_wave17_l2_topology_findings.md`, plan at `.planning/wave17-l2-topology-findings.md`.
**Trigger**: schedule AFTER Wave 35-39 cleared for clean context.

### Wave 41 — Plugin v0.2.0 generalize (TBD effort)

9 DSL settings + 3 enums + sha256+prefix + custom frontmatter lambda. Decouple plugin from AndroidCommonDoc opinions.

**Source**: `project_plugin_v0.2.0_generalize.md`, plan at `.planning/plugin-v0.2.0-generalize.md`.
**Sequencing**: per memory directive, "Start AFTER Wave 17".

### Wave 42 — OSS Phase 1 modularization (~12-20h)

`@oscardlfr/claude-kmp-mcp` npm + `io.github.oscardlfr:detekt-kmp-rules` Maven Central + `oscardlfr.github.io/AndroidCommonDoc` VitePress. Apache-2.0 LICENSE prereq met.

**Source**: `project_claude_for_oss_modularization.md`.

### Wave 43 — Wave 18 hypothesis triage (data-driven)

3 candidates: dev pattern-matching loop detection, arch flip-flop guard (one-topic-per-message), CP grep scope auto-validation.

**Trigger**: review when `/metrics` data shows measurable pattern frequency.
**Source**: `project_wave18_backlog.md`.

## Long-term / no fixed order

- **DawSync product alignment** session — pricing drift, feature contradictions, dormant context-bridge — `project_dawsync_product_alignment.md`
- **Future agents** — D1 guardian for DawSyncWeb, context-provider-as-internal-context7-agent — `project_future_agents.md`
- **Plugin v0.2.1** — triggered-only (10 @Disabled tests pending Maven Central v0.3.0) — `project_plugin_v0.2.1_status.md`
- **BL-W32-04** — CP zombie session start — active observation, no fix yet — `project_BL-W32-04_shipped.md`

## Shipped (recent)

- **BL-W34** (2026-05-03) — L1 security prep, 3 PRs (#107 / #108 / #109) — `project_wave_bl_w34_l1_security_prep_shipped.md`
- **BL-W33** (2026-05-02) — L1 reports triage, 5 PRs (#101-#105) — `project_wave_bl_w33_shipped.md`
- **BL-W32-06e** (2026-05-02) — Script dedup PR #100 — `project_BL-W32-06e_shipped.md`
- **l0-doc-refresh** (2026-05-02) — PR #99 — `project_l0_doc_refresh_shipped.md`
- **BL-W32-04 phase1** (2026-05-01) — PR #97 — `project_BL-W32-04_shipped.md`

For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
