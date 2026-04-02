# Changelog

All notable changes to AndroidCommonDoc are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

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
- **PR #20 templates propagated** to `DawSync` and `shared-kmp-libs` via prune sync: `arch-*`, `quality-gater` v2.1.0, `project-manager` v3.0.0
- **`skills/setup/SKILL.md:704`**: stale cross-reference fixed — `sync-l0` is now CLI-direct, not skill-delegating

### Fixed
- **`check-outdated.test.ts:157`**: stale version assertion `koin .toBe("4.1.1")` → `.toMatch(/^\d+\.\d+\.\d+/)` — test no longer hardcodes a specific version

### Backlog
- `skills/setup/SKILL.md:464` has a pre-existing broken reference to `skills/sync-l0/SKILL.md` in L2 — follow-up fix needed (separate PR)

## [1.4.0] - 2026-03-26

### Added
- **Spec-driven agent ecosystem**: 5 new L0 agents for native Claude Code workflow
  - `debugger`: Scientific debugging with hypothesis testing (`/debug`)
  - `verifier`: Goal-backward verification against specs (`/verify`)
  - `advisor`: Technical decision comparison tables (`/decide`)
  - `researcher`: Ad-hoc technical research (`/research`)
  - `codebase-mapper`: Structured repo architecture analysis (`/map-codebase`)
- **7 new skills**: `/debug`, `/research`, `/map-codebase`, `/verify`, `/decide`, `/note`, `/review-pr`
- **Benchmark infrastructure**: `/benchmark` skill with JVM/Android detection, runner scripts (sh+ps1)
- **Spec-driven workflow doc**: `docs/agents/spec-driven-workflow.md` — native Claude Code flow without GSD
- **2 new agent templates**: `product-strategist` (ICE scoring), `content-creator` (build-in-public)
- **Coverage suite fixes**: Kover exclude patterns for benchmark/desktopApp modules
- **Bug fix**: `shared-libs` → `shared-kmp-libs` rename across 9 scripts

### Changed
- **GSD decoupled**: Behavioral isolation via CLAUDE.md rules — `gsd-*` agents blocked from native invocation
- **Hooks cleaned**: 3 GSD-only hooks removed from settings.json, 2 renamed (context-monitor, prompt-guard)
- **GSD workflow-guard disabled**: No longer nudges toward GSD workflow
- **6 DawSync-specific agents moved** from user-global to `DawSync/.claude/agents/`
- **dev-lead template updated**: References 5 new agents + 5 new skills in delegation table
- **CLAUDE.md (L0)**: New agent roster with 11 agents, 15 commands documented
- **Skills 42→50**, agents 15→20, templates 4→6, commands 27→34

## [1.3.0] - 2026-03-23

### Added
- **Unified Documentation Validation System (M011)**: `/audit-docs` command with 3 waves
  - Wave 1 (Structure): hub sizes, frontmatter, naming, category vocabulary
  - Wave 2 (Coherence): broken links, l0_refs, hub table completeness
  - Wave 3 (Upstream): deterministic assertions against live upstream docs + optional LLM semantic analysis
- **Content fetcher**: Jina Reader + raw HTTP fallback with disk cache (TTL, rate limiting)
- **Assertion engine**: 6 types (api_present, api_absent, keyword_absent, keyword_present, pattern_match, deprecation_scan) with context window matching
- **Semantic analyzer**: LLM prompt generation + response parsing for `--profile deep`
- **31 upstream assertions** seeded across 10 key L0 pattern docs
- **`/validate-upstream` skill**: standalone Layer 1 assertion runner
- **`doc-audit.yml` CI workflow**: weekly cron + manual dispatch
- **`monitor-sources --layer`**: multi-project support for L1/L2
- **URL deduplication cache** in monitor-sources change detector
- **Upstream validation guide** v2: assertion quality rules, anti-patterns, minimum quality per doc type
- **"No pre-existing excuse" rule** in test-specialist, ui-specialist, dev-lead template
- **`pattern-lint` cancellation-rethrow**: context-aware check (124 FP → 1 real)

### Changed
- **DI SDK archive docs rewritten** with corporate feedback:
  - Dagger 2: monolithic + per-feature Component approaches
  - Neutral comparison: 10 requirements × 4 frameworks (Koin, Dagger Mono, Dagger Per-Feature, kotlin-inject)
  - Singleton Survival Across Reinit: examples for all 4 frameworks
  - Version compatibility updated (Kotlin 2.3+, AGP 9.0+, Dagger KSP alpha)
  - Decision matrix by constraint, not framework preference
- **APPROVED_CATEGORIES expanded**: +9 categories (agents, compose, di, error-handling, gradle, navigation, offline-first, resources, storage)
- **Hub detection**: uses filename (contains 'hub'), not `## Sub-documents` section
- **Skills 40→42**, MCP tools 31→32, Registry 82→84, Vitest 1060→1173

### Fixed
- `console.log` → `process.stdout.write` in audit-docs CLI (ESLint no-console)
- `readme-audit.sh`: all `tr -d` pipes include `\r` for Windows CRLF
- Assertion URLs corrected (stateIn→stateflow page, compose→resources-usage, Koin→reference/koin-mp)
- Deprecation false positive: "use Room instead of SQLite" no longer triggers
- `scanner.ts`: parses `validate_upstream` frontmatter field
- Bats tests: skill count 40→42, vitest count alignment

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
