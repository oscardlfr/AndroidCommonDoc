# Changelog

All notable changes to AndroidCommonDoc are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Agent templates for L1/L2 projects (`setup/agent-templates/`)
- Copilot agent adapter (`adapters/copilot-agent-adapter.sh`)
- Copilot agent templates (`setup/copilot-agent-templates/`)
- Standardized `version.properties` pattern for all layers
- Updated `/bump-version` command to use version.properties + CHANGELOG as standard

## [1.1.0] - 2026-03-14 - Hardening & Intelligence

Complete overhaul adding architecture verification, programmatic MCP access, pattern discovery, and documentation intelligence to the v1.0 script-and-skills foundation.

### Phase 5: Tech Debt Cleanup
- Removed 5 orphaned shell scripts superseded by quality-gate-orchestrator
- Fixed `((INSTALLED++))` set -e bug pattern across all scripts (safe arithmetic)
- Standardized environment variable guard ordering (after `--set-env` processing)
- Cross-platform path handling improvements (Windows/macOS/Linux)

### Phase 6: Konsist Architecture Tests
- New `konsist-tests/` JVM-only module for architecture verification
- Naming and package structure tests (bidirectional: package-to-suffix and suffix-to-package)
- Architecture layer isolation tests (no upward imports, no cross-module violations)
- Source set parity tests (androidMain/desktopMain use jvmMain, iosMain/macosMain use appleMain)
- Relative paths for `scopeFromDirectory` (Windows compatibility)

### Phase 7: Consumer Guard Tests
- Guard test template system (`.kt.template` files with token substitution)
- `install-guard-tests.sh/.ps1` installer with Kotlin version auto-detection
- Import-based architecture checks (avoids Konsist empty-scope false positives)
- Validated in MyApp (main + worktree) and MyApp consumer projects
- `require(count > 0)` canary assertion prevents silent empty-scope passes

### Phase 8: MCP Server
- TypeScript MCP server using SDK 1.27.1 with stdio transport
- 8 initial tools: validate-all, verify-kmp, check-version-sync, check-doc-freshness, script-parity, setup-check, find-pattern, rate-limit-status
- 3 prompts: architecture-review, pr-review, onboarding
- Dynamic resources: pattern docs, skills, changelog
- Rate limiting (30 calls/min) with per-tool guard
- ESLint no-console rule + stderr-only logger (prevents stdio corruption)
- InMemoryTransport for tests, subprocess for stdio integration tests
- CI matrix: ubuntu-latest + windows-latest

### Phase 9: Pattern Registry & Discovery
- Layered pattern registry: L0 (base), L1 (project), L2 (user)
- YAML frontmatter scanner with required field validation (scope, sources, targets)
- Layer resolver with L1>L2>L0 full replacement semantics
- Cross-project discovery (sibling dirs + `projects.yaml` fallback)
- Dynamic MCP resources from registry entries
- `find-pattern` tool with tokenized query matching across metadata
- Hub docs trimmed to <150 lines with sub-doc references
- MyApp L1 pattern migration (error-handling promoted to L0)
- 8 original docs split into 23 docs for granularity

### Phase 10: Doc Intelligence & Detekt Generation
- **Source monitoring engine**: tiered checking (1=critical, 2=important, 3=informational)
  - URL-to-manifest fuzzy matching for version comparison
  - HTTP status categorization (429/5xx=transient, 4xx=permanent)
  - Deprecation keyword detection across upstream content
- **Review state tracking**: atomic file writes, new-findings filtering, stale deferral detection
- **`monitor-sources` MCP tool**: on-demand monitoring with tier/review filters
- **`check-doc-freshness` alias**: backward-compatible delegation to monitor-sources
- **Detekt rule generation**: parse pattern doc frontmatter `rules:` field
  - Template-based Kotlin emission (rule + test + config)
  - `com.androidcommondoc.detekt.rules.generated` package separation
  - Hand-written rules (`hand_written: true`) never overwritten
  - Orphan detection for removed rule definitions
- **`generate-detekt-rules` MCP tool**: dry_run defaults to true (safety-first)
- **Content ingestion**: fetch arbitrary URLs, extract keywords, match against pattern metadata
  - 15-second AbortController timeout
  - Returns suggestions with `recommended_action`, never auto-applies
- **`ingest-content` MCP tool**: structured ingestion with match scoring
- **3 new skills**: `/monitor-docs`, `/generate-rules`, `/ingest-content`
- **CLI entrypoint**: `node build/cli/monitor-sources.js` for CI/manual use
  - stderr-only logging (stdout reserved for summary)
  - Exit code 0 always (findings are data, not errors)
- **GitHub Actions CI**: `doc-monitor.yml` cron workflow with JSON artifact output
- **check-doc-freshness consolidated** into monitor-sources with backward-compatible alias
- **Frontmatter hardened**: all 23 docs have complete scope/sources/targets
- **Convention compliance verified**: kebab-case files, try/catch in async tools, no console.log

### v1.1 Summary
- **19 skills** (up from 16)
- **11 MCP tools** (up from 0)
- **23 pattern docs** (up from 8)
- **5 Detekt rules** (hand-written) + generation pipeline for auto-generated rules
- **5 quality gate agents**
- **2 CI workflows** (MCP server tests + doc monitoring cron)
- **12 cross-platform script pairs** (PS1 + SH)

---

## [v1.0] - 2026-03 - MVP

Initial release with scripts, skills, pattern docs, Detekt rules, convention plugin, Claude Code hooks, and quality gate agents.

### Features
- 16 canonical skills (SKILL.md) with adapter pipeline to Claude Code + GitHub Copilot
- 12 cross-platform script pairs (PowerShell + Bash)
- 5 custom Detekt architecture rules (AST-only, no type resolution)
- Convention plugin for one-line Gradle adoption
- Claude Code hooks (post-write + pre-commit Detekt enforcement)
- 5 quality gate agents
- 8 architecture pattern documents
- Version manifest for freshness tracking
- Adapter pipeline: SKILL.md -> Claude commands + Copilot prompts + copilot-instructions
