# AndroidCommonDoc Backlog

> **Last updated**: 2026-05-04 (post BL-W36)
> **Source of truth**: this file is the ordered index. Detailed entries live in `git log` + `~/.claude/projects/.../memory/` (`project_*shipped.md`, `project_*backlog.md`).
> **Update protocol**: when a wave ships, move entry to `## Shipped (recent)`. New items appended in priority order under `## Active`.

## Active (proposed wave order)

### Wave 37 — Cross-repo sync (waits for L1 BL-W35 completion, ~4-6h)

| ID | Severity | Item |
|----|----------|------|
| BL-W34-A | HIGH | L1 sync tool-use-logger.js Bug 1 (cross-repo coordination) |
| BL-W34-B | HIGH | L1 CI parity (Node test runner extension to reusable-shell-tests) |
| BL-W34-E | MED | per-tool-call marker nonces (researcher's deferred CP-bypass fix) |
| BL-W36-01 | MED | arch-bash-write-gate regex gap — `wave\d+` doesn't cover `wave-bl-w36-bl-w34-deferred` (letter-suffix slugs); broaden to `wave[-\w]+`. Hit 3× during BL-W36 — required main-agent file copy from `/tmp` |

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
| BL-W36-02 | MED | test-specialist sub-docs vm-testing (10 lines) + coverage-targets (8 lines) are stub-sized per `doc-migrator.md:157`. Consider consolidating into a single `test-specialist-patterns.md` sub-doc or merging back to template (if line budget allows) |
| BL-W36-03 | LOW | MIGRATIONS.json field divergence — older entries use `note`, recent (1.16.0/1.17.0/1.18.0) use `summary`. Normalize in cleanup pass |
| BL-W36-04 | LOW | quality-gater stash-test methodology gave false "pre-existing" verdict on PR4 manifest-validator failures (actually PR4-introduced version mismatch). Investigate stash hygiene or replace with `git diff develop` baseline check |
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

- **BL-W36** (2026-05-04) — BL-W34 deferred bundle, 4 PRs (#119-#122). PR1 BL-W34-G closed as RESOLVED by PR #116 Amendment C (no PR needed). Filed BL-W36-01..04 findings — `project_wave_bl_w36_bl_w34_deferred_shipped.md`
- **BL-W35** (2026-05-04) — L0 dogfood topology hardening, 6 PRs (#112-#117) addressing 7 bugs + 1 incident — `project_wave_bl_w35_l0_dogfood_topology_shipped.md`
- **BL-W34** (2026-05-03) — L1 security prep, 3 PRs (#107 / #108 / #109) — `project_wave_bl_w34_l1_security_prep_shipped.md`
- **BL-W33** (2026-05-02) — L1 reports triage, 5 PRs (#101-#105) — `project_wave_bl_w33_shipped.md`
- **BL-W32-06e** (2026-05-02) — Script dedup PR #100 — `project_BL-W32-06e_shipped.md`

For full wave history: `git log` + memory `project_*shipped.md` files.

## How to use this document

1. **Starting a session**: pick the topmost active wave; review the linked source memory files for detailed context.
2. **Wave brief**: write `.planning/wave-bl-w{N}-prompt.md` modeled after `.planning/wave-bl-w34-l1-security-prep-prompt.md` (gitignored — local).
3. **On wave completion**: doc-updater moves entry to `## Shipped (recent)`, prunes oldest if section >5 waves, commits via PR.
4. **Adding new items**: append to active waves or create new wave entry; preserve priority order rationale.
5. **Cross-references**: every active wave row links to a memory file with full context. If memory entry is missing, file before starting that wave.
