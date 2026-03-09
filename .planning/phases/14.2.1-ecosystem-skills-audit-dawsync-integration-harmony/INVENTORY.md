# Ecosystem Skills, Agents & Commands Inventory

**Phase:** 14.2.1 - Ecosystem Skills Audit & DawSync Integration Harmony
**Generated:** 2026-03-15
**Scope:** L0 (AndroidCommonDoc), L1 (shared-kmp-libs), L2 (DawSync), Subprojects (DawSyncWeb, SessionRecorder-VST3)

---

## L0 (AndroidCommonDoc)

### Skills (21 in `skills/`)

| # | Name | Location | Has `name` | Has `description` | Has `allowed-tools` | Has `disable-model-invocation` | Supporting Files | Modernization Needs |
|---|------|----------|:---:|:---:|:---:|:---:|---|---|
| 1 | android-test | skills/android-test/ | Y | Y | N | N | N | Add allowed-tools |
| 2 | auto-cover | skills/auto-cover/ | Y | Y | N | N | N | Add allowed-tools |
| 3 | coverage | skills/coverage/ | Y | Y | N | N | N | Add allowed-tools |
| 4 | coverage-full | skills/coverage-full/ | Y | Y | N | N | N | Add allowed-tools |
| 5 | doc-reorganize | skills/doc-reorganize/ | Y | Y | N | N | N | Add allowed-tools |
| 6 | extract-errors | skills/extract-errors/ | Y | Y | N | N | N | Add allowed-tools |
| 7 | generate-rules | skills/generate-rules/ | Y | Y | N | N | N | Add allowed-tools |
| 8 | ingest-content | skills/ingest-content/ | Y | Y | N | N | N | Add allowed-tools |
| 9 | monitor-docs | skills/monitor-docs/ | Y | Y | N | N | N | Add allowed-tools |
| 10 | run | skills/run/ | Y | Y | N | N | N | Add allowed-tools, add disable-model-invocation |
| 11 | sbom | skills/sbom/ | Y | Y | N | N | N | Add allowed-tools |
| 12 | sbom-analyze | skills/sbom-analyze/ | Y | Y | N | N | N | Add allowed-tools |
| 13 | sbom-scan | skills/sbom-scan/ | Y | Y | N | N | N | Add allowed-tools |
| 14 | sync-vault | skills/sync-vault/ | Y | Y | N | N | N | Add allowed-tools, add disable-model-invocation |
| 15 | sync-versions | skills/sync-versions/ | Y | Y | N | N | N | Add allowed-tools |
| 16 | test | skills/test/ | Y | Y | N | N | N | Add allowed-tools |
| 17 | test-changed | skills/test-changed/ | Y | Y | N | N | N | Add allowed-tools |
| 18 | test-full | skills/test-full/ | Y | Y | N | N | N | Add allowed-tools |
| 19 | test-full-parallel | skills/test-full-parallel/ | Y | Y | N | N | N | Add allowed-tools |
| 20 | validate-patterns | skills/validate-patterns/ | Y | Y | N | N | N | Add allowed-tools |
| 21 | verify-kmp | skills/verify-kmp/ | Y | Y | N | N | N | Add allowed-tools |

**Common modernization need:** All 21 skills have `name` and `description` but NONE have `allowed-tools` or `disable-model-invocation`. All use legacy `metadata` block instead of modern frontmatter fields.

### Web Skills (6 in `.agents/skills/` -- TO BE CONSOLIDATED)

| # | Name | Location | Has `name` | Has `description` | Has `allowed-tools` | Has `disable-model-invocation` | Supporting Files | Modernization Needs |
|---|------|----------|:---:|:---:|:---:|:---:|---|---|
| 1 | accessibility | .agents/skills/accessibility/ | Y | Y | N | N | references/WCAG.md | Move to skills/, add allowed-tools |
| 2 | best-practices | .agents/skills/best-practices/ | Y | Y | N | N | N | Move to skills/, add allowed-tools |
| 3 | core-web-vitals | .agents/skills/core-web-vitals/ | Y | Y | N | N | references/LCP.md | Move to skills/, add allowed-tools |
| 4 | performance | .agents/skills/performance/ | Y | Y | N | N | N | Move to skills/, add allowed-tools |
| 5 | seo | .agents/skills/seo/ | Y | Y | N | N | N | Move to skills/, add allowed-tools |
| 6 | web-quality-audit | .agents/skills/web-quality-audit/ | Y | Y | N | N | N | Move to skills/, add allowed-tools |

**Key:** 2 skills have supporting `references/` directories (accessibility, core-web-vitals). All have `license: MIT` field. None have `allowed-tools` or `disable-model-invocation`.

### Commands (32 in `.claude/commands/`)

| # | Name | Matching Skill | Generated from Skill | Promote to Skill? | Notes |
|---|------|:---:|:---:|:---:|---|
| 1 | android-test | Y | Y (auto-generated) | Already skill | Generated adapter |
| 2 | auto-cover | Y | Y (auto-generated) | Already skill | Generated adapter |
| 3 | brainstorm | N | N | Consider | Complex behavior, promoted from DawSync |
| 4 | bump-version | N | N | Consider | Side-effect, promoted from DawSync |
| 5 | changelog | N | N | Consider | Promoted from DawSync |
| 6 | coverage | Y | Y (auto-generated) | Already skill | Generated adapter |
| 7 | coverage-full | Y | Y (auto-generated) | Already skill | Generated adapter |
| 8 | doc-check | N | N | Consider | Promoted from DawSync |
| 9 | doc-update | N | N | Consider | Promoted from DawSync |
| 10 | extract-errors | Y | Y (auto-generated) | Already skill | Generated adapter |
| 11 | feature-audit | N | N | Consider | Promoted from DawSync |
| 12 | merge-track | N | N | Consider | Promoted from DawSync, side-effect |
| 13 | metrics | N | N | Consider | Promoted from DawSync |
| 14 | package | N | N | Consider | Side-effect, promoted from DawSync |
| 15 | pre-release | N | N | Consider | Orchestrator, promoted from DawSync |
| 16 | prioritize | N | N | Consider | Promoted from DawSync |
| 17 | run | Y | Y (auto-generated) | Already skill | Generated adapter |
| 18 | sbom | Y | Y (auto-generated) | Already skill | Generated adapter |
| 19 | sbom-analyze | Y | Y (auto-generated) | Already skill | Generated adapter |
| 20 | sbom-scan | Y | Y (auto-generated) | Already skill | Generated adapter |
| 21 | start-track | N | N | Consider | Side-effect, promoted from DawSync |
| 22 | sync-roadmap | N | N | No | Simple GSD command |
| 23 | sync-tech-versions | N | N | Consider | Promoted from DawSync |
| 24 | sync-versions | Y | Y (auto-generated) | Already skill | Generated adapter |
| 25 | test | Y | Y (auto-generated) | Already skill | Generated adapter |
| 26 | test-changed | Y | Y (auto-generated) | Already skill | Generated adapter |
| 27 | test-full | Y | Y (auto-generated) | Already skill | Generated adapter |
| 28 | test-full-parallel | Y | Y (auto-generated) | Already skill | Generated adapter |
| 29 | unlock-tests | N | N | No | Simple utility |
| 30 | validate-patterns | Y | Y (auto-generated) | Already skill | Generated adapter |
| 31 | verify-kmp | Y | Y (auto-generated) | Already skill | Generated adapter |
| 32 | verify-migrations | N | N | No | Simple utility, promoted from DawSync |

**Summary:** 16 commands are auto-generated skill adapters (matching skill exists). 16 are standalone commands (promoted from DawSync). Of the 16 standalone: 11 are candidates for promotion to skills, 5 are fine as command-only (simple utilities or GSD wrappers).

**5 L0 skills without commands:**
- doc-reorganize, generate-rules, ingest-content, monitor-docs, sync-vault
- Assessment: These are MCP tool orchestration workflows. No command wrapper needed -- skills are the preferred format.

### Agents (11 in `.claude/agents/`)

| # | Name | Has `name` | Has `description` | Has `tools` | Has `model` | Has `memory` | Has `skills` | Classification | Modernization Needs |
|---|------|:---:|:---:|:---:|:---:|:---:|:---:|---|---|
| 1 | beta-readiness-agent | Y | Y | Y | Y (sonnet) | Y | N | Generic | Add skills field |
| 2 | cross-platform-validator | Y | Y | Y | Y (sonnet) | Y | N | Generic | Add skills field |
| 3 | doc-alignment-agent | Y | Y | Y | Y (sonnet) | Y | N | Generic | Add skills field |
| 4 | doc-code-drift-detector | Y | Y | Y | Y (sonnet) | Y | N | Toolkit-internal | OK |
| 5 | quality-gate-orchestrator | Y | Y | Y (incl Bash) | Y (sonnet) | Y | N | Toolkit-internal | OK |
| 6 | release-guardian-agent | Y | Y | Y | Y (haiku) | Y | N | Generic | Add skills field |
| 7 | script-parity-validator | Y | Y | Y | Y (sonnet) | Y | N | Toolkit-internal | OK |
| 8 | skill-script-alignment | Y | Y | Y | Y (sonnet) | Y | N | Toolkit-internal | OK |
| 9 | template-sync-validator | Y | Y | Y | Y (sonnet) | Y | N | Toolkit-internal | OK |
| 10 | test-specialist | Y | Y | Y (incl Bash) | Y (sonnet) | Y | N | Generic | Add skills field (test, coverage) |
| 11 | ui-specialist | Y | Y | Y | Y (sonnet) | Y | N | Generic | Add skills field |

**Summary:** All 11 agents have modern frontmatter (name, description, tools, model, memory). None use the `skills` field to preload skills. 6 are generic (promoted from DawSync), 5 are toolkit-internal (L0-specific validation agents).

---

## L1 (shared-kmp-libs)

### Commands (9 in `.claude/commands/`)

| # | Name | L0 Equivalent | Is Delegate | Action Needed |
|---|------|:---:|:---:|---|
| 1 | auto-cover | Y | N | Convert to delegate |
| 2 | coverage | Y | N | Convert to delegate |
| 3 | coverage-full | Y | N | Convert to delegate |
| 4 | extract-errors | Y | N | Convert to delegate |
| 5 | sync-versions | Y | N | Convert to delegate |
| 6 | test | Y | N | Convert to delegate |
| 7 | test-changed | Y | N | Convert to delegate |
| 8 | test-full | Y | N | Convert to delegate |
| 9 | verify-kmp | Y | N | Convert to delegate |

**Critical finding:** ALL 9 commands are independent copies, NOT delegates. All have L0 equivalents. All should be converted to delegate stubs pointing to L0 canonical versions.

### Agents (1 in `.claude/agents/`)

| # | Name | Has `name` | Has `description` | Has `tools` | Has `model` | Has `memory` | Has `skills` | L1-Specific | Modernization Needs |
|---|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | api-contract-guardian | Y | Y | Y | Y (haiku) | Y | N | Y | Add skills field |

**Assessment:** Appropriately L1-specific. Guards API module contract boundaries -- unique to shared-kmp-libs's multi-module architecture. Good frontmatter. Could benefit from `skills` field referencing relevant skills.

### Skills

None. No `.claude/skills/` directory exists. Assessment: No L1-specific skills needed -- L0 skills cover all L1 needs via `--add-dir` mechanism.

---

## L2 (DawSync)

### Commands (39 in `.claude/commands/`)

#### Delegate Commands (29)

| # | Name | Canonical Path | Path Valid |
|---|------|----------------|:---:|
| 1 | android-test | AndroidCommonDoc/.claude/commands/android-test.md | Y |
| 2 | auto-cover | AndroidCommonDoc/.claude/commands/auto-cover.md | Y |
| 3 | brainstorm | AndroidCommonDoc/.claude/commands/brainstorm.md | Y |
| 4 | bump-version | AndroidCommonDoc/.claude/commands/bump-version.md | Y |
| 5 | changelog | AndroidCommonDoc/.claude/commands/changelog.md | Y |
| 6 | coverage | AndroidCommonDoc/.claude/commands/coverage.md | Y |
| 7 | coverage-full | AndroidCommonDoc/.claude/commands/coverage-full.md | Y |
| 8 | doc-check | AndroidCommonDoc/.claude/commands/doc-check.md | Y |
| 9 | doc-update | AndroidCommonDoc/.claude/commands/doc-update.md | Y |
| 10 | extract-errors | AndroidCommonDoc/.claude/commands/extract-errors.md | Y |
| 11 | feature-audit | AndroidCommonDoc/.claude/commands/feature-audit.md | Y |
| 12 | metrics | AndroidCommonDoc/.claude/commands/metrics.md | Y |
| 13 | package | AndroidCommonDoc/.claude/commands/package.md | Y |
| 14 | pre-release | AndroidCommonDoc/.claude/commands/pre-release.md | Y |
| 15 | prioritize | AndroidCommonDoc/.claude/commands/prioritize.md | Y |
| 16 | run | AndroidCommonDoc/.claude/commands/run.md | Y |
| 17 | sbom | AndroidCommonDoc/.claude/commands/sbom.md | Y |
| 18 | sbom-analyze | AndroidCommonDoc/.claude/commands/sbom-analyze.md | Y |
| 19 | sbom-scan | AndroidCommonDoc/.claude/commands/sbom-scan.md | Y |
| 20 | sync-tech-versions | AndroidCommonDoc/.claude/commands/sync-tech-versions.md | Y |
| 21 | sync-versions | AndroidCommonDoc/.claude/commands/sync-versions.md | Y |
| 22 | test | AndroidCommonDoc/.claude/commands/test.md | Y |
| 23 | test-changed | AndroidCommonDoc/.claude/commands/test-changed.md | Y |
| 24 | test-full | AndroidCommonDoc/.claude/commands/test-full.md | Y |
| 25 | test-full-parallel | AndroidCommonDoc/.claude/commands/test-full-parallel.md | Y |
| 26 | unlock-tests | AndroidCommonDoc/.claude/commands/unlock-tests.md | Y |
| 27 | validate-patterns | AndroidCommonDoc/.claude/commands/validate-patterns.md | Y |
| 28 | verify-kmp | AndroidCommonDoc/.claude/commands/verify-kmp.md | Y |
| 29 | verify-migrations | AndroidCommonDoc/.claude/commands/verify-migrations.md | Y |

#### Non-Delegate Commands (10)

| # | Name | L0 Equivalent | Classification | Still Valid |
|---|------|:---:|---|:---:|
| 1 | deploy-web | N | L2-specific (DawSync web) | Y |
| 2 | lint-web | N | L2-specific (DawSync web) | Y |
| 3 | merge-track | Y (L0 generic) | L2 variant (DawSync-specific track mappings) | Y |
| 4 | nuke-builds | N | L2-specific (DawSync + shared-kmp-libs builds) | Y |
| 5 | roadmap | N | L2-specific (DawSync roadmap) | Y |
| 6 | run-clean | N | L2-specific (DawSync desktop) | Y |
| 7 | start-track | Y (L0 generic) | L2 variant (DawSync-specific track mappings) | Y |
| 8 | sync-roadmap | Y (L0 generic) | L2 variant (but identical to L0) | Convert to delegate |
| 9 | test-m4l | N | L2-specific (Max for Live tests) | Y |
| 10 | validate-strings | N | L2-specific (DawSync i18n) | Y |

**Summary:** 29 delegates (all paths valid), 10 non-delegates. Of 10 non-delegates: 7 are truly L2-specific, 3 have L0 equivalents (merge-track, start-track are customized L2 variants with project-specific track mappings; sync-roadmap could be converted to delegate).

### Skills (6 in `.claude/skills/`)

| # | Name | Delegate Path | Path Valid | Modernization Needs |
|---|------|---------------|:---:|---|
| 1 | accessibility | AndroidCommonDoc/.agents/skills/accessibility/SKILL.md | **N** (path breaks after consolidation) | Update path to skills/ |
| 2 | best-practices | AndroidCommonDoc/.agents/skills/best-practices/SKILL.md | **N** (path breaks after consolidation) | Update path to skills/ |
| 3 | core-web-vitals | AndroidCommonDoc/.agents/skills/core-web-vitals/SKILL.md | **N** (path breaks after consolidation) | Update path to skills/ |
| 4 | performance | AndroidCommonDoc/.agents/skills/performance/SKILL.md | **N** (path breaks after consolidation) | Update path to skills/ |
| 5 | seo | AndroidCommonDoc/.agents/skills/seo/SKILL.md | **N** (path breaks after consolidation) | Update path to skills/ |
| 6 | web-quality-audit | AndroidCommonDoc/.agents/skills/web-quality-audit/SKILL.md | **N** (path breaks after consolidation) | Update path to skills/ |

**Critical:** All 6 delegate paths point to `.agents/skills/` which will be removed in this plan. Paths must be updated to `skills/` in Plan 05 (SKILL-07). Additionally, per RESEARCH.md: Claude Code does NOT resolve delegate `canonical:` paths -- these stubs are effectively broken and provide no useful instructions.

### Agents (11 in `.claude/agents/`)

#### Delegate Agents (6)

| # | Name | Canonical Path | Path Valid |
|---|------|----------------|:---:|
| 1 | beta-readiness-agent | AndroidCommonDoc/.claude/agents/beta-readiness-agent.md | Y |
| 2 | cross-platform-validator | AndroidCommonDoc/.claude/agents/cross-platform-validator.md | Y |
| 3 | doc-alignment-agent | AndroidCommonDoc/.claude/agents/doc-alignment-agent.md | Y |
| 4 | release-guardian-agent | AndroidCommonDoc/.claude/agents/release-guardian-agent.md | Y |
| 5 | test-specialist | AndroidCommonDoc/.claude/agents/test-specialist.md | Y |
| 6 | ui-specialist | AndroidCommonDoc/.claude/agents/ui-specialist.md | Y |

#### L2-Specific Agents (5)

| # | Name | Has `name` | Has `description` | Has `tools` | Has `model` | Has `memory` | Has `skills` | Modernization Needs |
|---|------|:---:|:---:|:---:|:---:|:---:|:---:|---|
| 1 | data-layer-specialist | Y | Y | Y | Y (sonnet) | Y | N | Add skills field |
| 2 | daw-guardian | Y | Y | Y | Y (sonnet) | Y | N | OK (DawSync-unique constraint) |
| 3 | domain-model-specialist | Y | Y | Y | Y (sonnet) | Y | N | Add skills field |
| 4 | freemium-gate-checker | Y | Y | Y | Y (haiku) | Y | N | OK (DawSync-unique business logic) |
| 5 | producer-consumer-validator | Y | Y | Y | Y (haiku) | Y | N | OK (DawSync-unique data pattern) |

**Summary:** 6 delegates (all paths valid), 5 L2-specific (all have modern frontmatter). L2-specific agents cover DawSync-unique concerns: DAW constraint, freemium gating, producer/consumer pattern, data layer, domain model.

---

## Subprojects

### DawSyncWeb (`DawSync/web/`)

| Property | Value |
|----------|-------|
| `.claude/` exists | **No** |
| Needs setup | Minimal -- `.claude/settings.json` for multi-console workflow |
| Skill access | Via automatic subdirectory discovery from DawSync root |
| Web commands | Stay in DawSync L2 `.claude/commands/` (deploy-web, lint-web) |
| Own `.planning/` | No -- shares DawSync's GSD infrastructure |

### SessionRecorder-VST3 (`DawSync/SessionRecorder-VST3/`)

| Property | Value |
|----------|-------|
| `.claude/` exists | **No** |
| Needs setup | Skip -- C++/JUCE project, different toolchain entirely |
| File count | ~12 files |
| Skill infrastructure | No benefit from KMP skill infrastructure |

---

## Summary

### Total Counts

| Type | L0 | L1 | L2 | Total |
|------|:---:|:---:|:---:|:---:|
| Skills (canonical) | 21 | 0 | 0 | 21 |
| Skills (to merge) | 6 | 0 | 0 | 6 |
| Skills (delegates) | 0 | 0 | 6 | 6 |
| Commands | 32 | 9 | 39 | 80 |
| Agents | 11 | 1 | 11 | 23 |
| **Total** | **70** | **10** | **56** | **136** |

### Broken/Stale References

| Issue | Count | Location | Impact |
|-------|:---:|---|---|
| DawSync skill delegates pointing to `.agents/skills/` | 6 | DawSync `.claude/skills/` | Will break after consolidation (Plan 05 fix) |
| L1 commands not delegating to L0 | 9 | shared-kmp-libs `.claude/commands/` | Independent copies diverging from L0 |
| DawSync sync-roadmap not delegating | 1 | DawSync `.claude/commands/` | Identical to L0 but independent copy |
| **Total broken/stale** | **16** | | |

### Modernization Needs

| Need | Count | Details |
|------|:---:|---|
| Skills missing `allowed-tools` | 27 | All 21 L0 skills + 6 web skills |
| Skills missing `disable-model-invocation` | ~5 | Side-effect skills: run, sync-vault, bump-version, package, deploy-web |
| Agents missing `skills` field | ~8 | 6 L0 generic + 2 L2 specialist agents could benefit |
| Skills using legacy `metadata` block | 21 | All L0 skills use metadata instead of modern fields |
| Web skills using `license` field | 6 | Non-standard field, harmless but noisy |
| L1 commands needing delegate conversion | 9 | All shared-kmp-libs commands |
| DawSync commands needing delegate review | 1 | sync-roadmap (identical to L0) |

### Command-Skill Alignment Gaps

| Gap Type | Count | Names |
|----------|:---:|---|
| Commands without matching skill (consider promotion) | 11 | brainstorm, bump-version, changelog, doc-check, doc-update, feature-audit, merge-track, metrics, package, pre-release, prioritize |
| Commands without matching skill (OK as command-only) | 5 | start-track, sync-roadmap, sync-tech-versions, unlock-tests, verify-migrations |
| Skills without matching command (OK, preferred format) | 5 | doc-reorganize, generate-rules, ingest-content, monitor-docs, sync-vault |
