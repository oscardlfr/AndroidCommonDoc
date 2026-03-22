# Changelog

All notable changes to AndroidCommonDoc are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)

<<<<<<< HEAD
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
=======
## [1.2.0] - 2026-03-22
>>>>>>> master

### Added
- **Multi-agent system**: 15 L0 agents, 5 agent templates, Copilot adapter pipeline
- **Boris Cherny CLAUDE.md**: 4-pillar template (Workflow Orchestration, Agent Delegation, Verification, Autonomous) across all 3 layers
- **Security domain**: new `docs/security/` hub with encryption patterns, key management, biometric auth
- **Audit suppressions**: `audit-suppressions.jsonl` schema with prefix matching and expiry — consumed by scripts and agents
- **2 new Detekt rules** promoted from L1: `NoHardcodedCredentialsRule`, `RequireRunCatchingCancellableRule` (17→19 rules)
- **`generate-detekt-rules` generic**: supports L1/L2 projects (configurable package, rules dir, recursive doc scan)
- **`validate-patterns` expanded**: 2→7 categories (ViewModel, UI, DI, error-handling, navigation, testing, coroutines)
- **`readme-audit` enhanced**: 13 checks including doc hub table validation, broken link detection, sub-doc count verification
- **`install-git-hooks.sh`**: optional pre-commit (pattern-lint) + commit-msg (conventional commits) git hooks
- **Git Flow autonomy**: agents can branch, merge to develop, push, create PRs autonomously — only master requires user approval
- **CI monitoring**: agents must watch CI after pushing and fix failures

### Changed
- **Storage docs rewritten**: aligned with L1 reality (SQLDelight primary, thin module architecture, MMKV, encryption boundary pattern)
- **Agent hardening**: `test-specialist` enforces quality-over-coverage, mandatory e2e for all core modules, Compose tests for features; `ui-specialist` enforces previews (HIGH if missing), zero-tolerance hardcoded strings
- **Dead weight cleanup**: 13 L0-only/web skills excluded from L1/L2 sync via `exclude_skills` in manifests
- **Doc coherence**: 22 broken cross-refs fixed across L0/L1/L2, hub tables updated, frontmatter complete

### Fixed
- CI readme-audit: exclude `index.ts` from MCP tool count
- Bats session-coverage: aligned section names, sub-docs count, vitest count
- Bats l0-bug-regressions: updated for O(1) batch recovery (removed per-module fallback tests)
- `readme-audit.sh`: all `tr -d` pipes include `\r` for Windows CRLF compatibility
- `pattern-lint.sh`: exclude `detekt-rules/` from false positives
- `run-parallel-coverage-suite.sh`: O(1) batched recovery, fixed unbound `$gradle_java`
- `layer-topology.md` trimmed to 300 lines (was 301)

## [1.1.0] - 2026-03-16

### Added
- Git Flow branch model with CI enforcement
- Downstream auto-sync workflow (l0-sync-dispatch)
- Release assets workflow
- Community files (CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, issue templates)
- JAVA_HOME auto-detection from gradle.properties

### Fixed
- False '58 failed' when Gradle exits non-zero from deprecation warnings
- --fresh-daemon JAVA_HOME detection for JDK 21

## [1.0.0] - 2026-03-01

### Added
- Initial release: 40 skills, 31 MCP tools, 17 Detekt rules
- Pattern documentation (14 hubs, 54 sub-docs)
- L0/L1/L2 layer topology with flat sync
