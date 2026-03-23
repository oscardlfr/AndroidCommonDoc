# AndroidCommonDoc

Reusable patterns, scripts, and AI skills for Kotlin Multiplatform projects targeting Android, Desktop, iOS, and macOS.

## Commands

```bash
# Run tests for a single module
bash scripts/sh/gradle-run.sh --project-root "$(pwd)" core:domain

# Run all tests with coverage
bash scripts/sh/run-parallel-coverage-suite.sh --project-root "$(pwd)"

# Validate KMP source set organization
bash scripts/sh/verify-kmp-packages.sh --project-root "$(pwd)"

# Regenerate all AI tool files from canonical skills
bash adapters/generate-all.sh

# Start MCP server
cd mcp-server && npm start

# Run doc source monitoring (CLI)
node mcp-server/build/cli/monitor-sources.js --tier all --output reports/monitoring-report.json
# For L1/L2 projects:
node mcp-server/build/cli/monitor-sources.js --project-root /path/to/l1 --layer L1 --tier all
```

## Architecture

| Layer | Contains | Depends On |
|-------|----------|-----------|
| UI | Compose Screens, SwiftUI Views | ViewModel |
| ViewModel | UiState, event handling | UseCases |
| Domain | UseCases, Repository interfaces | Model |
| Data | Repository impls, DataSources | Domain + Platform |
| Model | Data classes, enums, sealed types | Nothing |

## Key Conventions

1. **UiState:** Always `sealed interface` -- never `data class` with boolean flags.
2. **CancellationException:** Always rethrow in `catch` blocks -- never swallow.
3. **Result type:** Use `com.example.shared.core.result.Result<T>` for all operations.
4. **UiText:** Use `StringResource` / `DynamicString` for user-facing strings in ViewModels.
5. **StateFlow:** Expose via `stateIn(WhileSubscribed(5_000))`.
6. **Ephemeral events:** Use `MutableSharedFlow(replay = 0)` -- never `Channel`.
7. **Navigation:** State-driven -- never Channel-based.
8. **No platform deps in ViewModels:** No `Context`, `Resources`, `UIKit` imports.

## Available Skills (42)

Skills are defined canonically in `skills/*/SKILL.md`. Adapters generate tool-specific files.

### Development & Testing

| Skill | Description |
|-------|-------------|
| `test` | Run tests for a module with smart retry and error extraction |
| `test-full` | Run all tests with full coverage report |
| `test-full-parallel` | Run all tests in parallel with full coverage report |
| `test-changed` | Run tests only on modules with uncommitted git changes |
| `coverage` | Analyze test coverage gaps without running tests |
| `coverage-full` | Generate comprehensive coverage report from existing data |
| `auto-cover` | Automatically generate tests for coverage gaps |
| `extract-errors` | Extract structured build and test errors from Gradle runs |
| `run` | Build, install and run app with debug logging |
| `android-test` | Run Android instrumented tests with logcat capture and error extraction |
| `commit-lint` | Validate and fix commit messages against Conventional Commits v1.0.0 |
| `git-flow` | Git Flow branch management — start/finish feature/release/hotfix branches |

### Architecture & Validation

| Skill | Description |
|-------|-------------|
| `verify-kmp` | Validate KMP architecture and source set organization |
| `sync-versions` | Check version alignment between KMP projects |
| `validate-patterns` | Validate code against AndroidCommonDoc pattern standards |
| `audit-l0` | Run coherence audit on any L0/L1/L2 layer root |
| `sbom` | Generate CycloneDX SBOM for project deliverables |
| `sbom-scan` | Scan SBOM for known CVE vulnerabilities using Trivy |
| `sbom-analyze` | Analyze SBOM for dependency statistics, licenses, and concerns |
| `pre-pr` | Run all pre-PR checks locally before opening a pull request |
| `lint-resources` | Validate string resource naming conventions (snake_case, prefixes, duplicates) |
| `full-audit` | Run unified audit across all quality dimensions |
| `audit` | Generate quality audit report from audit-log.jsonl |
| `readme-audit` | Audit README.md against current repo state — surfaces stale counts |

### Doc Intelligence

| Skill | Description |
|-------|-------------|
| `monitor-docs` | Monitor upstream documentation sources for changes and deprecations (`--layer L0/L1/L2`) |
| `audit-docs` | Unified doc audit — structure (sizes, frontmatter), coherence (links, refs), upstream (assertions) |
| `validate-upstream` | Validate pattern docs against upstream official documentation using Layer 1 assertions |
| `generate-rules` | Generate Detekt rules from pattern doc frontmatter |
| `ingest-content` | Fetch external content and match against pattern doc metadata |
| `doc-reorganize` | Reorganize docs/ into domain-based subdirectories |

### Ecosystem & Vault

| Skill | Description |
|-------|-------------|
| `sync-l0` | Synchronize L0 skills, agents, and commands to a consumer project |
| `sync-gsd-agents` | Sync .claude/agents/ to GSD subagent system and verify parity |
| `sync-gsd-skills` | Sync skills from Claude Code marketplace/L0/agents to GSD user-level directory |
| `sync-vault` | Sync documentation into unified Obsidian vault |
| `setup` | Interactive wizard to configure a project to consume L0 |
| `set-model-profile` | Switch agent model tier: budget / balanced / advanced / quality |

### Web Development

| Skill | Description |
|-------|-------------|
| `accessibility` | Audit web content against WCAG guidelines |
| `best-practices` | Validate web development best practices |
| `core-web-vitals` | Analyze Core Web Vitals (LCP, FID, CLS) |
| `performance` | Full web performance audit with recommendations |
| `seo` | Validate SEO metadata, structure, and discoverability |
| `web-quality-audit` | Comprehensive web quality audit across all dimensions |

## MCP Tools (32)

Programmatic access via Model Context Protocol server (`mcp-server/`):

| Tool | Description |
|------|-------------|
| `validate-all` | Run all validation scripts with structured output |
| `verify-kmp` | Validate KMP source sets and imports |
| `check-version-sync` | Check version alignment between projects |
| `check-freshness` | Check upstream doc sources for staleness |
| `script-parity` | Compare PS1 and SH script behavior |
| `setup-check` | Verify toolkit installation in a project |
| `find-pattern` | Search pattern registry by query terms |
| `monitor-sources` | Check upstream sources for version changes and deprecations |
| `audit-docs` | Unified doc audit — structure, coherence, upstream (3 waves) |
| `generate-detekt-rules` | Generate Kotlin Detekt rules from pattern doc frontmatter |
| `ingest-content` | Fetch and analyze external content against pattern metadata |
| `sync-vault` | Sync documentation into Obsidian vault |
| `vault-status` | Check vault health and sync state |
| `validate-doc-structure` | Validate docs/ subdirectory organization and frontmatter |
| `validate-skills` | Validate skill registry and SKILL.md structure |
| `validate-claude-md` | Validate CLAUDE.md files across L0/L1/L2 layers |
| `validate-vault` | Validate vault content and wikilink integrity |
| `api-surface-diff` | Diff public API surface between branches/tags |
| `audit-report` | Generate quality audit HTML report |
| `code-metrics` | Collect code metrics (LOC, complexity, module stats) |
| `compose-preview-audit` | Audit Compose previews for completeness |
| `dependency-graph` | Visualize module dependency graph |
| `findings-report` | Aggregate and deduplicate findings across agents |
| `gradle-config-lint` | Lint Gradle build files for common misconfigurations |
| `l0-diff` | Diff L0 registry against consumer manifests |
| `migration-validator` | Validate database migration safety |
| `module-health` | Scan module health (test count, coverage, complexity) |
| `pattern-coverage` | Measure pattern doc coverage across codebase |
| `proguard-validator` | Validate ProGuard/R8 rules |
| `skill-usage-analytics` | Track skill invocation patterns |
| `string-completeness` | Check string resource completeness across locales |
| `unused-resources` | Find unused resources in the project |

## Quality Gate Agents (5)

Automated consistency verification via `.claude/agents/`:

| Agent | What It Verifies |
|-------|-----------------|
| `script-parity-validator` | PS1 and SH scripts produce equivalent behavior |
| `skill-script-alignment` | Claude commands reference correct scripts and parameters |
| `template-sync-validator` | Claude commands and Copilot prompts are semantically equivalent |
| `doc-code-drift-detector` | Pattern doc version references match versions-manifest.json |
| `quality-gate-orchestrator` | Unified pass/fail report across all gates with token cost |

## Pattern Docs (13 categories, 54 sub-docs)

Detailed pattern guidance in `docs/`, with YAML frontmatter (scope, sources, targets) for registry scanning:

| Document | Scope |
|----------|-------|
| `viewmodel-state-patterns.md` | ViewModel state management, sealed UiState, StateFlow |
| `viewmodel-state-management.md` | Detailed state management patterns |
| `viewmodel-events.md` | Ephemeral event handling with SharedFlow |
| `viewmodel-navigation.md` | State-driven navigation patterns |
| `ui-screen-patterns.md` | Compose screen structure, accessibility, navigation |
| `testing-patterns.md` | Testing with runTest, fakes, coroutine dispatchers |
| `testing-patterns-coroutines.md` | Coroutine testing patterns |
| `testing-patterns-coverage.md` | Coverage configuration and analysis |
| `testing-patterns-fakes.md` | Pure-Kotlin fakes and test DI |
| `gradle-patterns.md` | KMP Gradle configuration, convention plugins |
| `kmp-architecture.md` | Source set hierarchy, expect/actual, module naming |
| `offline-first-patterns.md` | Offline-first sync, conflict resolution, queue patterns |
| `offline-first-architecture.md` | Offline architecture layers |
| `offline-first-sync.md` | Sync strategies and conflict resolution |
| `offline-first-caching.md` | Caching strategies |
| `compose-resources-patterns.md` | Compose Multiplatform resource management |
| `compose-resources-configuration.md` | Resource configuration |
| `compose-resources-usage.md` | Resource usage patterns |
| `compose-resources-troubleshooting.md` | Resource troubleshooting |
| `resource-management-patterns.md` | Resource-intensive app coexistence, lifecycle-aware cleanup |
| `error-handling-patterns.md` | Result type, DomainException hierarchy |
| `enterprise-integration-proposal.md` | Enterprise deployment proposal |

## Boundaries

- **No platform deps in ViewModels** -- no `android.content.Context`, `UIKit`, `java.io.File`.
- **No Channel for UI events** -- use `MutableSharedFlow(replay = 0)` for ephemeral events.
- **No duplicating across source sets** -- use `jvmMain` for Android+Desktop, `appleMain` for iOS+macOS.
- **No resources in custom source sets** -- Compose resources must be in `src/commonMain/composeResources/`.
- **No nested module names** -- use flat names like `core-json-api` (AGP 9+ circular dependency bug).
- **No `Dispatchers.Default` in tests** -- inject `testDispatcher` from `StandardTestDispatcher`.
- **No `console.log` in MCP server** -- use `logger` utility (stderr only, prevents stdio corruption).
