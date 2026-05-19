# Changelog

All notable changes to AndroidCommonDoc are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added (BL-W47-prep-14 — kmp-test-runner v0.10.1 bump)

- kmp-test-runner v0.9.1 → v0.10.1 across agents, scripts, hooks, skills, docs/testing/, AGENTS.md, README. Mechanical version-string bump.
- New v0.10 features available (--color/NO_COLOR, org.gradle.parallel auto-respect, user-global config ~/.kmp-test/config.json, agent skill packaging) — full feature docs deferred to a follow-up wave.
- 1 historical ref preserved: `kmp-test-runner-gate.js:88` JS/Wasm gate message (no JS/Wasm changes in v0.10).

### Added (BL-W47-prep-7 — kmp-test-runner 0.9.1 bump)

- kmp-test-runner v0.9.0 → v0.9.1 across CI, bash/ps1 wrappers, skills, docs/testing/, AGENTS.md, README. Mechanical version-string bump.
- test-specialist 1.24.0 → 1.25.0, arch-testing 1.31.0 → 1.32.0 (MIGRATIONS.json entries added).
- 3 historical refs preserved: `cli-troubleshooting.md:33` (`v0.9.0 Breaking` heading), `cli-tests-js-wasm.md:22,33` (deferred note version anchors).

### Added (BL-W47-prep — topology cleanups, [#180](https://github.com/oscardlfr/AndroidCommonDoc/pull/180))

- planner 1.10.0 → 1.11.0: AMEND discipline protocol + plan-write-location fix.
- 4 topology gaps closed: doc-updater SUPERSEDES header, premature-execution-gate arch-platform-only filename, planner plan-write-gate hook, arch amend-without-permission guard.

### Added (Wave F — post-Wave-E audit cleanup, [#179](https://github.com/oscardlfr/AndroidCommonDoc/pull/179))

- Post-Wave-E audit cleanup: 7 findings resolved (1H/3M/3L).
- Script v0.9.0 parity: L1 sync (#50) aligning agent templates.
- README skills count audit ran (skills count remained 61; audit script counted non-dir entries — closed in BL-W47-prep-2 T3 (disk-derived count helper)).

### Added (Wave E — L0 cleanup, [#178](https://github.com/oscardlfr/AndroidCommonDoc/pull/178))

- BL-W30-04/-05 closed: atomization of Scope Extension + Reporter Protocol inline bodies to pointer lines across 3 architect templates.
- Line-anchor vitest refactor: template-wave1-rules.test.ts assertions anchored to exact line numbers.
- Private-name scrub: remaining cross-project path literals replaced with generic placeholders.

### Added (Wave D — quick wins, [#177](https://github.com/oscardlfr/AndroidCommonDoc/pull/177))

- Atomization pass 2: 3 new sub-docs extracted (arch-testing-dispatch-protocol, arch-scope-extension-protocol, arch-reporter-protocol). ~30L diet.
- CP integration W17#11/#17: context-provider Spawn Protocol pre-cache expanded with kmp-features-2026.md.
- Test gap W17#5 closed: testing-patterns-dispatcher-scopes sub-doc added.

### Added (Wave C — doc cleanup + private-name scrub, [#176](https://github.com/oscardlfr/AndroidCommonDoc/pull/176))

- BL-W32-11 closed: arch-bash-write-gate regex fix for Windows paths.
- BL-W30-02/-03 closed: context-provider + product-lead private project name scrub.
- T6 private-name scrub: 3 templates scrubbed of literal cross-project paths.

### Added (Wave B — arch-platform-hardening-bundle)

- **`docs/agents/kmp-checks-catalog.md`** (NEW sub-doc, 44 lines): Six KMP architectural checks extracted verbatim from `arch-platform.md` L275-309 per atomicity LAW. `arch-platform.md` L275-309 replaced with 4-line pointer block. Net −31 lines on arch-platform.md (400→392 with other insertions).
- **`docs/agents/commit-spec-validation.md`** (NEW sub-doc, 23 lines): Canonical types/scopes cheat-sheet sourced from `.github/workflows/reusable-commit-lint.yml:25` + `l0-ci.yml:22`. Inline pointer added to `arch-platform.md` Pre-Execute Authoring Checklist. Cross-reference added from `arch-platform-prep-authoring-checklist.md` Check 2. Closes BL-bump-ktr-02.
- **`docs/agents/dual-location-protocol.md`** (NEW sub-doc, 36 lines): SOURCE→COPY sync steps, manifest-first versioning, Write-tool-only MIGRATIONS.json rule. Inline pointer added to `arch-platform.md`. Closes BL-bump-ktr-03.
- **`agents-hub.md` 3 new pointer entries**: kmp-checks-catalog, commit-spec-validation, dual-location-protocol.
- **Disk-Write + 1-Liner DM block** added to `setup/agent-templates/arch-platform.md` (mirrors `arch-testing.md` L336-353, name-adapted). Closes BL-W31.7-09 (HIGH PARTIAL).
- **APPEND-not-OVERWRITE language** for EXECUTE phase verdict writes added to arch-platform disk-write block. Root-cause fix for PR #166 incident where overwrite erased `APPROVED-PREP` token triggering premature-execution-gate. Closes BL-bump-ktr-01.
- **`scripts/tests/copilot-adapter-reference.bats`** (8 tests): New bats suite covering `copilot-adapter.sh` `reference` template_type branch. Root-cause fix for 6+ PRs of `android-skills-consume.prompt.md` drift. Closes BL-Wave-B-adapter-bug.
- **Memory `feedback_l0_doc_atomicity_law`**: Canonicalized rule — atomicity > info preservation > compaction. Extract to sub-doc at size limit; never compress.
- **Memory `feedback_planner_owns_plan_md`**: team-lead never drafts PLAN.md; planner agent owns all PLAN.md writes.
- **arch-platform manifest 1.27.0 → 1.28.0** (`agents.manifest.yaml`) + MIGRATIONS.json Shape B entry (additive, no action required). 2 vitest assertion bumps: `template-wave1-rules.test.ts` + `three-phase-architecture.test.ts`.

### Added

- **CLI hub at `docs/testing/`** (12 atomic sub-docs): cli-hub, cli-tests-{jvm, android-unit, android-instrumented, ios, macos, js-wasm}, cli-coverage, cli-cache-management, cli-troubleshooting, cli-changed-modules, cli-agent-mandate. Comprehensive reference for kmp-test-runner v0.9.0+ CLI consumption across all KMP platforms. Each sub-doc carries L0 frontmatter (scope, sources, targets, slug, monitor_urls).
- **CLI Mandate pointer block** in `setup/agent-templates/test-specialist.md` (1.22.0→1.23.0) and `setup/agent-templates/arch-testing.md` (1.28.0→1.29.0). Templates link to canonical MANDATE/FORBID at `docs/testing/cli-agent-mandate.md`.

### Fixed

- **Pre-CLI references purged** from 5 agent templates (PR #170 cli-mandate-cleanup, follow-up to PR #169 audit). Closes 3 findings:
  - 4 dev specialist templates (data-layer, domain-model, test-specialist, ui-specialist): "grep for expected changes" bullet contradicted BANNED TOOLS section (Grep tool FORBIDDEN for these specialists). Rewritten to "verify via reporting architect".
  - Same 4 templates: "verified and APPROVED" old verdict nomenclature → "APPROVE verdict".
  - arch-testing.md L409: "Never wrapper scripts" was incoherent with canonical chain (skill → wrapper → CLI). Rewritten to clarify wrappers wrap kmp-test-runner v0.9.0+.

Manifests bumped (1.29.0→1.30.0 arch-testing, 1.23.0→1.24.0 test-specialist, 1.15.0→1.16.0 data-layer, 1.15.0→1.16.0 domain-model, 1.17.0→1.18.0 ui-specialist) + MIGRATIONS.json entries + 4 vitest test files updated.

### Changed

- **kmp-test-runner-gate.js gate-expansion** (CLI-only mandate enforcement). Allowlist-then-block architecture replaces the 3-pattern literal blocklist. Allowlist (10 patterns): `kmp-test info|describe`, `assembleAndroidTest`, `kover*Report`, `createDebugCoverageReport`, `dependencyInsight`, `outgoingVariants`, `testRuntimeClasspath`, `*PrintCommand`/`*DryRun` helpers, plus existing env+inline bypass. Block regex (4 patterns) catches all `*Test` task variants KMP-wide (jvm, common, android-unit, android-instrumented, ios, macos, js, wasm) plus `allTests`, `check`, and module-qualified `:module:*Test`. Special JS/Wasm error message acknowledges that kmp-test-runner v0.9.0 does not yet support JS/Wasm targets. Bats coverage: 22 new cases (gate file 8→30 cases, full suite ~1093→1116).
- **kmp-test-runner v0.8.1 → v0.9.0** across L0 toolkit. v0.9.0 introduces ENVELOPE_SCHEMA_VERSION 2 (semantic exit-code split + `flavor_unused` promotion + `isolated_runtime_race` guard) — not consumed by L0 wrappers (verified GREEN pre-flight). New v0.9.0 features: `kmp-test info|describe|update` discovery subcommands, `--gradle-args` escape hatch, `--isolated` Windows-safe cache for re-enabling parallel tests, `--variant` truly global. No flag renames. No deprecations. Files: workflow, hook, agent template (dual-location), 6 wrapper scripts, 4 SKILL.md, README, AGENTS.md, gradle-run.bats. PR #TBD.

### Added (BL-W46.1 PR-B — README Counts + Version + Context-Provider Frontmatter, #162)
- **README Recent Changes +14 rows** (`README.md`): BL-W33..W46 wave history (newest-first) added to the stale table (was last at BL-W32). Closes HIGH-2.
- **README count fixes** (`README.md`): sub-docs 68→77 (2 places), skills 61 (canonical `find skills -name SKILL.md` count, 4 places), bats 1081 (actual @test count). Closes 3 MED.
- **version.properties 1.3.0→1.4.0**: Aligns with CHANGELOG `[1.4.0] - 2026-05-08`. Closes MED.
- **context-provider vault-status frontmatter** (`setup/agent-templates/context-provider.md`, `.claude/agents/context-provider.md`): `mcp__androidcommondoc__vault-status` added to `tools:` (body-xref gap, grep-confirmed at template:35). `template_version` 3.3.0→3.4.0. Manifest + MIGRATIONS.json + SHA rehashed. `validate-agent-templates.sh` ALL PASS. Closes MED.

### Added (BL-W46 PR1 — Post-W45 Audit Cleanup, #157)
- **agents-hub.md 7 missing sub-doc entries** (`docs/agents/agents-hub.md`): Restores hub discovery for arch-platform-prep-authoring-checklist, arch-platform-section-h-rule, arch-testing-dispatch-protocol, context-provider-adoption-hooks, knowledge-currency-gate, main-agent-orchestration-guide, quality-gater-runtime-ui-validation. Also updates stale "11 core agents" → "20 core agents" in hub Rules section. Closes H-02.
- **README count fixes post-PR2** (`README.md`): sub-docs 68 (unchanged), guides 24→25, agent-workflow 37→45, hooks 26/28→27/27, bats 1078→1085. Closes M-03/04/05.
- **guides-hub.md 2 missing entries** (`docs/guides/guides-hub.md`): compose-semantic-diff.md + jdk-toolchain.md. Closes M-06.
- **Placeholder links in readme-audit-fix-guide** (`docs/guides/readme-audit-fix-guide.md`): Wrapped `<slug>` and `<hub-name>` inline example links in double-backtick code spans to silence link checker. Closes M-07.
- **agent-core-rules.md count fix** (`docs/agents/agent-core-rules.md:80`): "11 core agents" → "20 core agents" (BL-W26-01 + BL-W44-S2 additions); dropped stale per-agent parenthetical to avoid tool-count drift. Closes L-02.

### Added (BL-W46 PR2 — MCP Fixes + Shell Parity + Frontmatter, #158)
- **validate-agents.ts JSDoc + error string corrected** (`mcp-server/src/tools/validate-agents.ts:10`): JSDoc "≤400" → "≤425 (≤400 non-orchestrators)"; error message "400" → "425". Closes M-01 + L-01.
- **"network" added to APPROVED_CATEGORIES** (`mcp-server/src/tools/validate-doc-structure.ts:31`): Silences false-positive ERROR for `docs/network/` domain docs. Closes L-03.
- **validate-agent-templates.sh inline backtick strip** (`scripts/sh/validate-agent-templates.sh`): `get_body_no_fences()` now strips inline backtick spans before tool-body cross-reference check, achieving parity with the TS `stripCodeFences()` inline strip added in BL-W45 PR2. Closes Deferred 3. New bats test: backtick-wrapped `Agent()` in body does NOT trigger WARN.
- **kmp-test-runner v0.7.0→v0.8.1 in 2 ps1 scripts** (`scripts/ps1/run-changed-modules-tests.ps1`, `scripts/ps1/run-parallel-coverage-suite.ps1`): Mirrors the BL-W45 PR1 sh fix that was missed for ps1 pairs. Closes H-01.
- **getting-started 9-doc frontmatter** (`docs/guides/getting-started/01` through `09`): Adds `scope`, `sources`, `targets`, `status: active`, `layer: L0`, `parent: getting-started` to all 9 getting-started guide files. Closes L-07.
- **feature-domain-specialist L-08 fix** (`setup/agent-templates/feature-domain-specialist.md`, `.claude/agents/feature-domain-specialist.md`): Adds `SendMessage` to `tools:` frontmatter (grep-confirmed usage). Registry manifest updated. Closes L-08.

### Added (BL-W46 PR3 — architect-bash-write-gate node -e Fix, #159)
- **NODE_EVAL_RE exemption in architect-bash-write-gate** (`.claude/hooks/architect-bash-write-gate.js`): `detectViolation()` now strips single-quoted `node -e '...'` body before pattern checks, preventing false-positive fires when the `node -e` payload contains `open(`/`write` keywords. Python detection unaffected. Closes Deferred 2.
- **2 new bats cases** (`tests/architect-bash-write-gate.bats`): `node -e 'require("fs").writeFileSync()'` must NOT fire; `python3 -c 'open("bar.md","w")'` still MUST fire.

### Added (BL-W46 PR4 — Plan-Mode ENTRY Investigation, #160)
- **Findings doc** (`.claude/wave-quality-gates/bl-w46-plan-mode-investigation.md`): Documents investigation of plan-mode ENTRY regression. EnterPlanMode hook confirmed present and correctly gated; no repro found in hook trace. Closes Deferred 1 as NOT-REPRODUCIBLE.

### Fixed (BL-W32-12 — pathlib write_text security false-negative)
- architect-bash-write-gate now correctly detects pathlib.Path.write_text()/write_bytes() inside `python3 -c "..."` wrappers with backslash-escaped inner quotes — closes a security false-negative where dangerous writes (e.g. `/etc/passwd`) bypassed the gate (BL-W32-12)

## [1.4.0] - 2026-05-08

### Added (BL-W45 — Alignment Debt Cleanup, PRs #154-#155 + L1 #46)
- **Runtime fix: kmp-test-runner v0.8.1 in 4 active scripts** (`scripts/sh/gradle-run.sh`, `run-changed-modules-tests.sh`, `run-parallel-coverage-suite.sh`, `scripts/ps1/gradle-run.ps1`): Active runtime invocations were calling wrong binary (v0.7.0). Closes INV-b.
- **8 rtk-prefixed deny rules** (`.claude/settings.json`): Covers force-push (3 HIGH: rtk push --force, push -f, rtk push -f) + 5 MEDIUM (rtk clean -f, rtk checkout main/master, rtk merge master/main). Closes INV-k.
- **16 README count fixes + 1 CLAUDE.md** (scripts 39/5, hooks 26 wired, registry 162, tests 1078, agents 20, templates 40, sub-docs 68, etc.). Closes INV-c.
- **adapters/README.md + new docs/guides/copilot-templates-regen.md**: claude-adapter.sh marked deprecated; new guide doc resolves dead bats reference. Closes INV-d.
- **stripCodeFences inline backtick handling** (`mcp-server/src/tools/validate-agents.ts`): Extends function to strip inline backtick spans in addition to fenced blocks. Kills 8 false-positive tool-body-xref WARNs across 4 agents. Closes INV-e.
- **Cap policy canonicalized 400→425** (`mcp-server/src/tools/validate-agents.ts` MAX_LINES + `CLAUDE.md` L56): W31.6 evidence-based bump (arch templates need PREP/EXECUTE blocks). Closes INV-f + BL-W32-09.
- **compile-fail-pre-commit.sh registered** (`.claude/settings.json`): PreToolUse Bash hook catches error() patterns in staged .kt files. Closes INV-g.
- **Orchestration guide HUB-SPLIT: 351→33 lines** (`docs/agents/main-agent-orchestration-guide.md`): 8 new tl-* sub-docs preserving full info per "hubs over compression" rule (tl-session-start, tl-agent-roster, tl-pm-absent-mode, tl-verification-done-criteria, tl-git-workflow, tl-skills-mcp-tools, tl-release-workflow, tl-ingestion-request-handler). Vitest helper `readOrchestrationGuide()` + bats helper `cat_orchestration_guide` resolve 51+11 test failures. Closes INV-j + BL-W32-10.
- **L1/L2 propagation**: shared-kmp-libs PR #46 (4 MCP-frontmatter agents + 14 tl-* sub-docs) + WakeTheCave local. DawSync deferred. Closes BL-W32-08.

### Removed (BL-W45)
- **`.claude/hooks/readme-pre-commit.sh`**: Hook tested fragile count formulas (3+ inconsistent across docs). Manual `/readme-audit --fix` preferred until autogen wave. Cleaned 4 stale doc references (README L507, readme-audit-fix-guide L36+L130, skills/readme-audit/SKILL.md L67+L83, .gsd/KNOWLEDGE.md). 5 obsolete bats @tests removed (4 in l0-bug-functional + 1 in sh-hooks-stdin-resilience).

## [1.3.0] - 2026-05-07

### Added (BL-W44 — Process Hardening + Windows Support, PRs #145-#149)
- **commit-lint compound scope clarification** (`docs/commands/commit-lint.md`): Clarifies
  that only the first hyphen-delimited segment must be in valid_scopes; subsequent segments
  are appended automatically. Closes BL-W32-13.
- **Gradle error triage block in 3 specialist templates** (`setup/agent-templates/test-specialist.md`
  v1.21.0, `data-layer-specialist.md` v1.15.0, `domain-model-specialist.md` v1.15.0): Inline
  4-step UnsupportedClassVersionError triage replaces pointer-to-subdoc pattern (specialists
  cannot read docs/** per banned tools). Closes BL-W32-16.
- **Windows-aware isExemptTarget in architect-bash-write-gate** (`.claude/hooks/architect-bash-write-gate.js`):
  Adds `os.tmpdir()` dynamic check + `normalizePath()` helper. Windows temp paths
  (`C:Users...AppDataLocalTemp`) now exempt. Closes W44-01.
- **wave-phase-gate Rule A narrowed** (`.claude/hooks/wave-phase-gate.js`): Replaces
  substring match with `isGatedCommand()` prefix match — body prose no longer triggers.
  Adds `WAVE_PHASE_GATE_BYPASS=1` env var (consistent with other gates). Closes W44-02.
- **hook-bypass-recursive-pattern doc extended** (`docs/guides/hook-bypass-recursive-pattern.md`):
  Adds wave-phase-gate.js bypass pattern and WAVE_PHASE_GATE_BYPASS=1 documentation.
  Closes W44-03.

### Added (BL-W44-S2 — Retrospective Fixes + BL-W26 Closures, PRs #150-#153)
- **MCP tools frontmatter × 5 audit/validator agents** (`setup/agent-templates/`): cross-platform-validator, platform-auditor, privacy-auditor, full-audit-orchestrator, quality-gate-orchestrator gain `tools:` declarations (BL-W26-01 closure). Agents now callable by harness without ToolSearch workaround.
- **skill-leak-check.sh + .ps1 + /metrics Step 3b** (`scripts/sh/skill-leak-check.sh`, `scripts/ps1/skill-leak-check.ps1`): 37 bats cases; wired into `/metrics` dashboard. Closes BL-W26-02.
- **4 retrospective hook + lint + generator fixes**: planner sentinel resolves to git root (cwd-relative bug); architect-bash-write-gate exempts `arch-*.md` verdict files; validate-agent-templates Check 7 uses `jq -e tuple` (was buggy substring grep); adapters/ generation headers restored + bats expectations corrected.
- **MIGRATIONS.json backfill**: 4 missing entries surfaced by jq tuple lint cascade; encoding fix via Write tool (Windows curly-quote autocorrect bug).

### Added (BL-W43 — Architect Topology Hardening, PRs #140-#143)
- **arch-bash-write-gate cross-verify exempt** (`scripts/sh/quality-gate-pre-pr.sh`, `scripts/sh/architect-bash-write-gate.sh`): Extends exempt regex to allow architects to read/write `pr*-arch-*-cross-verify.md` files when validating peer verdicts. Closes W43-01.
- **substring-gate hook-bypass-recursive-pattern doc + bats** (`docs/guides/hook-bypass-recursive-pattern.md`, `scripts/tests/hook-bypass-recursive-pattern.bats`): Documents the recursive-bootstrap edge case where bypass markers in prose Bash text fire the gate they should bypass. 3 new bats cases. Closes W43-02.
- **premature-execution-gate hook** (`.claude/hooks/premature-execution-gate.js`, `scripts/tests/premature-execution-gate.bats`): PreToolUse gate blocks specialist Write/Edit/Bash before architect publishes APPROVED-PREP verdict. 9 bats cases. Subject set: 6 specialists + doc-updater. Bypass: WAVE_PREP_BYPASS=1 env or [PREMATURE_EXEC_BYPASS] inline. Closes W43-03 (HIGH, recurring).

### Added (BL-W42 — Topology Hardening Pack, PRs #135-#139)
- **Knowledge Currency Gate** (`.claude/hooks/knowledge-currency-gate.js`): PreToolUse SendMessage gate — blocks arch-platform/arch-testing from sending KMP-keyword messages unless `KMP_CURRENCY_CHECKED=1` env or `[KMP_CURRENCY_CHECKED]` inline marker is set. Closes FIND-06.
- **N=3 Retry-on-Fail Discriminator** (`scripts/sh/before-after-delta.sh`): Runs test command 3x; classifies FLAKY (2/3 pass, exit 0), REGRESSION (0/3 pass, exit 1), SUSPICIOUS (1/3 pass, exit 2). Closes FIND-07.
- **doc-updater SUPERSEDES Dispatch Protocol** (`setup/agent-templates/doc-updater.md` v2.9.0): When mid-execute SendMessage carries `SUPERSEDES PRIOR DISPATCH` header, doc-updater aborts, validates `superseded_at` ISO field, re-reads dispatch and scope_doc from scratch. Closes FIND-10.
- **kmp-test-runner v0.8.1 enforcement hook** (`.claude/hooks/kmp-test-runner-gate.js`): PreToolUse Bash gate — blocks `./gradlew test`, `gradle test`, `:module:test` invocations. Bypass: `KMP_TEST_RUNNER_BYPASS=1` or `[KMP_TEST_RUNNER_BYPASS]` inline. Closes BL-W42 PR5 backlog.
- **test-specialist v0.8.1 pins** (`setup/agent-templates/test-specialist.md` v1.20.0): Updated kmp-test-runner version pins v0.6.2→v0.8.1; added MANDATE/FORBID block for raw gradle invocations.
- **Verdict pre-execute checklist** (`docs/agents/verdict-pre-execute-checklist.md`): Binding gate before any architect EXECUTE dispatch. Closes FIND-08/09/11/12/16/19 (PR2).
- **Amend discipline hardening** (`setup/agent-templates/doc-updater.md` v2.8.0, PR3): `git commit --amend` requires explicit user authorization, not architect dispatch. Closes FIND-15.
- **Bash hook hardening + REDIRECT_RE fix** (PR4): stderr noise cleanup + structural fix for redirect regex. Closes FIND-13/17/18.

### Added (BL-W32-06a)
- `scripts/sh/gradle-run.sh` + `scripts/ps1/gradle-run.ps1` refactored to thin wrappers (~75/~65 lines) around `kmp-test-runner@0.6.2` CLI (was 497/489 lines). Drops: 2-attempt daemon retry, Kover fallback chain, JDK detection, 15s heartbeat poll.
- New `--dry-run` flag (additive): prints the constructed `kmp-test` command and exits 0. Useful for debugging flag translation.
- `scripts/tests/gradle-run.bats` — 7 new bats cases for the kmp-test-runner wrapper.

### Changed (BL-W32-06a)
- `skills/test/SKILL.md` Windows implementation block simplified — flags pass through directly to `gradle-run.ps1`.
- `.github/workflows/reusable-shell-tests.yml`: `npm install -g kmp-test-runner@0.6.2` step added before bats run.

### Deprecated (BL-W32-06a)
- `--platform` flag: warn-and-drop. Use `--test-type` instead.
- `--search-pattern` flag: warn-and-drop. Use `kmp-test errors[].code` discriminator instead.

### Known Gap (BL-W32-06a)
- `shared-kmp-libs` composite-build daemon stop is not yet handled by `kmp-test-runner v0.6.2`. File upstream issue; resolve before BL-W32-06d L2 adoption. Add `KMP_GRADLE_TIMEOUT_MS` (milliseconds) env var as an escape hatch for Gradle watchdog override if needed.

### Added
- **Context-provider adoption hook** (`.claude/hooks/context-provider-gate.js`): PreToolUse blocking gate on Grep/Glob/Bash — blocks tool calls unless the calling peer SendMessage'd context-provider first in the session. Session-level enforcement with agent_type-based exempt list.
- **Context-provider consultation tracker** (`.claude/hooks/context-provider-consulted.js`): PostToolUse SendMessage hook — writes session flag when CP is addressed.
- **Tool-use observability logger** (`.claude/hooks/tool-use-logger.js`): PostToolUse `.*` — logs every tool call to `.androidcommondoc/tool-use-log.jsonl` with agent_id, agent_type, mcp_server, mcp_tool, skill_name, duration, cp_bypass_blocked.
- **MCP tool `tool-use-analytics`** (`mcp-server/src/tools/tool-use-analytics.ts`, tool #47): aggregates tool-use-log by top-tools, dead-tools, MCP/Context7/skill call rates, CP bypass count, per-agent breakdown.
- **/metrics skill** (`.claude/commands/metrics.md`): harmonized dashboard invoking both `tool-use-analytics` and `skill-usage-analytics` — one user-facing view, two internal data sources.
- **Hyphen-notation catalog accessor checker** in `scripts/sh/catalog-coverage-check.sh` (lines 87-111): warns when agent templates or audit scripts use hyphen-notation (`libs.androidx-lifecycle-runtime-ktx`) instead of Gradle's dot-notation (`libs.androidx.lifecycle.runtime.ktx`).
- **context-provider template "On Team Join" section**: instructs CP to broadcast cached pattern list when new peers join the team (template_version 2.6.0).

### Changed
- `docs/agents/tl-dispatch-topology.md`: added canonical module path list (core/audio, core/media-session, core/data, desktopApp) + dot-notation grep examples.

### Fixed
- `doc-integrity-system.test.ts:68` stale assertion "Registered 46 tools" → "Registered 47 tools" after tool-use-analytics registration.
- `three-phase-architecture.test.ts:822` hardcoded template_version "2.5.0" → "2.6.0" for context-provider template bump.

---

### Added
- `dokka-markdown-plugin` 0.1.0 — Dokka 2.2.x custom renderer that generates L0-compliant structured markdown (`docs/api/*.md`) from KDoc. Replaces lost `dokka-to-docs.sh`. Optional opt-in via `/setup` wizard step W10.

### Changed
- `dokka-markdown-plugin` **extracted** to its own repo: [oscardlfr/dokka-markdown-plugin](https://github.com/oscardlfr/dokka-markdown-plugin) (MIT-licensed). First artifact of the modularization plan — standalone release cadence, independent CI, independent publish. Maven coordinate unchanged (`com.androidcommondoc:dokka-markdown-plugin`); registry URL moved to `maven.pkg.github.com/oscardlfr/dokka-markdown-plugin`. Local `tools/dokka-markdown-plugin/` directory reduced to a pointer README.
- Agent templates: Wave 7 fixes from DawSync L2 feedback
  - 4 core dev templates gained Wave Scope Gate (HARD STOP), Revert Compliance Protocol, and Owned Files sections
  - 3 arch templates gained Cross-Architect Dev Delegation (Option A/B/C)
  - Version bumps: test/ui-specialist 1.1.0→1.2.0, domain/data-layer-specialist 1.0.0→1.1.0, arch-platform/integration 1.6.0→1.7.0, arch-testing 1.7.0→1.8.0
  - Refs: PR #28, .planning/WAVE7-PLAN.md, DawSync .planning/L0-TEMPLATE-FEEDBACK.md

### BREAKING
- **Dev dispatch model v5.0.0**: anonymous disposable devs replaced by persistent named layer devs as session team peers

### Added
- docs/testing/testing-patterns-dispatcher-scopes.md — Path A (stateIn/VM) vs Path B (startObserving/infrastructure) disambiguation, verified via Context7 + nowinandroid + androidify
- Detekt rule: NoUnconfinedTestDispatcherForClassScopeRule — flags UnconfinedTestDispatcher() without testScheduler as constructor arg
- Detekt rule: RequireAdvanceUntilIdleAfterStartObservingRule — flags test functions with startObserving() but no advanceUntilIdle()
- Detekt rule: RequireConstantIdsRule — enforces id parameters use constants, not string literals
- Architect templates: Proactive Dev Support + Library Behavior Uncertainty sections (arch-testing v1.5.0, arch-platform v1.4.0, arch-integration v1.4.0)

### Changed
- CLAUDE.md: testing section lean pointer to dispatcher-scopes sub-doc + expanded testDispatcher injection rule
- testing-patterns.md: v4 — Path A/B in Key Rules + Quick Reference, new sub-doc reference
- NoHardcodedStringsInViewModelRule: added StringResource/UiText.StringResource exclusions, removed id exclusion

### Fixed
- NoHardcodedStringsInViewModelRule false positives on StringResource("key") patterns

### Added
- **Context7 MCP** as first-class external context source in context-provider v2.4.0
- **Planner v1.4.0 research step**: external library docs via context-provider + Context7
- **Doc-updater feedback loop**: undocumented Context7 patterns get documented automatically
- **Context7 awareness** in researcher and advisor agents
- **9-peer session team**: 4 core devs (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist) join at Phase 2 start alongside 5 existing peers
- **Pattern validation chain**: dev -> architect -> context-provider. Devs NEVER contact context-provider directly
- **Dynamic scaling**: architects request extra named devs from team-lead for overflow work (no team_name, die after verification)
- **4 new dev templates**: test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist in `setup/agent-templates/` with Team Identity sections
- **Core Dev Lifecycle**: persistent devs accumulate layer knowledge across waves (~210K tokens saved per session)

### Fixed
- **DawSync L2 cleanup**: 4 L0-internal agents removed, team topology/memory/placeholders fixed on 5 agents, 3 generic agents enriched

### Changed
- **team-lead template v4.2.0**: `TeamCreate("session-{project-slug}")` replaces `TeamCreate("session")` — prevents agent suffix collisions (-2/-3) when multiple Claude Code sessions run simultaneously
- **team-lead template v4.2.0**: `TeamCreate("planning-{project-slug}")` replaces `TeamCreate("planning")` — same collision fix for planning phase teams
- **Planner template v1.3.0**: writes plan to `.planning/PLAN.md` instead of SendMessage — bypasses message delivery size limitation for large plans
- **context-provider and doc-updater templates**: session team references updated to use project slug (commits: c93d9d3, cd4b6c8 L0; 78db5607 L1; ca5ae701 L2)

---

### Added
- **Ecosystem initialization skills**: `/work` (smart task routing), `/init-session` (project awareness), `/resume` (CEO/CTO dashboard)
- **Business layer**: `landing-page-strategist` agent template, 5 business doc templates (PRODUCT_SPEC, MARKETING, PRICING, LANDING_PAGES, COMPETITIVE)
- **Extensible routing**: `domain` + `intent` frontmatter on all 20 agents — `/work` discovers agents automatically via intent keywords
- **CEO/CTO dashboard** (`/resume`): department-based session resume (development, product, marketing) with memory-backed persistence

---

<!-- PR #21 | branch: feature/sync-templates | commit: 736d215 -->

### Changed
- **`sync-l0` command self-contained** (`.claude/commands/sync-l0.md`): rewritten to read `l0-manifest.json` and invoke the CLI directly — fixes silent hallucination in L2 where `skills/sync-l0/SKILL.md` was missing
- **L2 manifest exclusions** (`DawSync`, `shared-kmp-libs`): `sync-gsd-agents` and `sync-gsd-skills` added to `exclude_commands` — these are L0-internal and must not propagate to consumers
- **Stale GSD command files pruned** from `DawSync` and `shared-kmp-libs`
- **PR #20 templates propagated** to `DawSync` and `shared-kmp-libs` via prune sync: `arch-*`, `quality-gater` v2.1.0, `team-lead` v3.0.0
- **`skills/setup/SKILL.md:704`**: stale cross-reference fixed — `sync-l0` is now CLI-direct, not skill-delegating

### Fixed
- **`check-outdated.test.ts:157`**: stale version assertion `koin .toBe("4.1.1")` → `.toMatch(/^\d+\.\d+\.\d+/)` — test no longer hardcodes a specific version

### Backlog
- `skills/setup/SKILL.md:464` has a pre-existing broken reference to `skills/sync-l0/SKILL.md` in L2 — follow-up fix needed (separate PR)

## [1.2.0] - 2026-03-22

### Added
- Multi-agent system: 15 agents, Boris Cherny CLAUDE.md, Git Flow autonomy
- Security domain: encryption, key management, biometric patterns
- Audit suppressions with prefix matching and expiry
- 2 Detekt rules promoted from L1 (17→19)
- Agent hardening: quality-over-coverage, e2e mandatory

### Fixed
- CI fixes: readme-audit, bats tests, CRLF compat

## [1.1.0] - 2026-03-16

### Added
- Git Flow branch model with CI enforcement
- Downstream auto-sync workflow

## [1.0.0] - 2026-03-01

### Added
- Initial release: 40 skills, 31 MCP tools, 17 Detekt rules
