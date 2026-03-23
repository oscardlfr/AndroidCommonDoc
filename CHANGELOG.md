# Changelog

All notable changes to AndroidCommonDoc are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

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
