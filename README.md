# AndroidCommonDoc

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Agents](https://img.shields.io/badge/AI_Agents-Claude_Code%20%7C%20GitHub_Copilot-blueviolet.svg)]()

**Centralized developer toolkit for Android and Kotlin Multiplatform projects.**

Cross-platform scripts, AI agent skills (Claude Code + GitHub Copilot), 17 custom Detekt architecture rules, convention plugins for one-line adoption (KMP and Android-only), real-time enforcement hooks, an MCP server with 32 tools for programmatic access, a unified audit system with finding deduplication, and doc intelligence with upstream monitoring -- designed for solo developers and small teams managing multiple Android/KMP projects from a single source of truth.

> **Platform support:** All skills, agents, and Detekt rules work on both **Android-only (AGP 8.x)** and **KMP (AGP 9.0+)** projects. A small subset is KMP-only (noted below).

---

## Why

Managing multiple Android/KMP projects means duplicated scripts, inconsistent patterns, and coverage blind spots. AndroidCommonDoc solves this by centralizing:

- **Scripts** that run identically on Windows (PowerShell) and macOS/Linux (Bash) -- 22 cross-platform pairs
- **AI agent skills** for Claude Code and GitHub Copilot -- 40 canonical skill definitions in `skills/`, distributed to downstream projects via registry + manifest + sync engine
- **Pattern docs** that encode architecture decisions once, reference everywhere
- **Detekt rules** that enforce architecture patterns at build time -- 17 hand-written AST-only rules covering state exposure, coroutine safety, ViewModel boundaries, KMP time safety, and navigation contracts
- **Convention plugins** for one-line Gradle adoption: `KmpLibraryConventionPlugin` (AGP 9.0+ / KMP) and `AndroidLibraryConventionPlugin` (AGP 8.x / Android-only)
- **Claude Code hooks** that catch violations in real-time during AI-assisted development
- **Coverage tooling** with configurable engine (JaCoCo or Kover), parallel execution, and gap analysis
- **MCP server** with 32 tools for programmatic validation, pattern discovery, vault sync, module health, dependency analysis, code metrics, findings reports, and doc intelligence
- **Unified audit system** (`/full-audit`) with wave-based parallel execution, 3-pass finding deduplication, severity normalization, and resolution tracking
- **Doc monitoring** with tiered upstream source checking, review state tracking, and CI integration
- **Detekt rule generation** from pattern doc frontmatter (auto-generate Kotlin rules from documentation)
- **Reusable CI workflows** (`workflow_call`) for commit-lint, resource naming, safety checks, and architecture guards
- **15 specialized agents** for quality gates, release readiness, cross-platform validation, privacy auditing, and unified audit orchestration

Install once, use across all your projects.

---

## Design Philosophy: Token-Efficient AI Workflows

AI agents that drive Gradle directly waste thousands of tokens parsing raw output. AndroidCommonDoc moves all heavy processing outside the context window.

| | Without AndroidCommonDoc | With AndroidCommonDoc |
|---|---|---|
| **Test execution** | Agent runs Gradle, reads 200+ lines of logs | Script runs Gradle, agent receives structured summary |
| **Coverage analysis** | Agent parses XML reports, explores `build/` dirs | Script parses XML, agent gets markdown table |
| **Error diagnosis** | Agent greps stack traces across modules | Script categorizes errors with fix suggestions |
| **Pattern checking** | Agent greps for anti-patterns (~$0.10/run) | `pattern-lint.sh` runs 8 checks for free |
| **Full audit** | 26 separate agent runs (~$5-10) | `/full-audit` with dedup (~$1-2) |
| **Token cost** | ~50K tokens per full test run | ~2K tokens of structured output |

Skills enforce these boundaries -- `/coverage` explicitly forbids the agent from reading XML files. The script output is the single source of truth.

---

## Layered Ecosystem Model

AndroidCommonDoc is designed as an **L0 (generic layer)** in a multi-tier ecosystem where skills, agents, and documentation cascade down to consuming projects:

| Layer | Role | Example |
|-------|------|---------|
| L0 (Generic) | Universal patterns, skills, agents | This repo |
| L1 (Ecosystem) | Shared libraries, version authority | Your shared-libs repo |
| L2 (Application) | App-specific skills, domain agents | Your app project |

### How it works

- **L0 defines** canonical skills (`skills/*/SKILL.md`), agents (`.claude/agents/`), and pattern docs (`docs/`)
- **L1/L2 consume** L0 via materialized copies synced by the `/sync-l0` skill
- **L2 extends** with domain-specific skills and agents not present in L0
- **Absence = opt-out**: Exclude entries in `l0-manifest.json` to skip specific skills

### Topology: flat vs chain

Projects choose how they consume layers via `l0-manifest.json` (manifest v2):

| Topology | Flow | Use case |
|----------|------|----------|
| **flat** | L0 → L2 directly | Enterprise, standalone apps, no shared-libs layer |
| **chain** | L0 → L1 → L2 | Solo devs / small teams with shared libraries |

**Flat** (default): each project consumes L0 independently.
```json
{ "version": 2, "topology": "flat",
  "sources": [{ "layer": "L0", "path": "../AndroidCommonDoc" }] }
```

**Chain**: L2 inherits everything from L1, which inherits from L0. Skills, agents, Detekt rules, docs, and conventions cascade through the chain.
```json
{ "version": 2, "topology": "chain",
  "sources": [
    { "layer": "L0", "path": "../../AndroidCommonDoc", "role": "tooling" },
    { "layer": "L1", "path": "../../shared-kmp-libs", "role": "ecosystem" }
  ] }
```

In chain mode, an AI agent working on L2 (your app) sees:
1. **L0 patterns**: "UiState must be sealed interface"
2. **L1 conventions**: "Repositories return Flow, use SqlDelight not Room"
3. **L2 rules**: "Producer/consumer architecture, feature gates per tier"

Choose topology in `/setup` wizard or edit `l0-manifest.json` directly. Manifest v1 (`l0_source` field) is auto-migrated to v2 on read.

### Materialization model

Downstream projects maintain local copies of L0 skills via the **registry + manifest + sync engine**:

1. **Registry** (`skills/registry.json`) -- catalogs all 82 L0 entries with SHA-256 hashes
2. **Manifest** (`l0-manifest.json` in each project) -- declares which L0 entries to sync and tracks checksums
3. **Sync engine** (`/sync-l0` skill) -- materializes copies with `l0_source` / `l0_hash` headers for drift detection. Additive by default (never removes files); use `--prune` to clean orphans. Resolves paths via git toplevel for worktree safety.

```bash
# In your project: sync all L0 skills (additive — safe)
/sync-l0

# Remove orphaned files that no longer exist in L0
/sync-l0 --prune

# Preview what would change without writing
/sync-l0 --dry-run
```

---

## Multi-Agent Support: Claude Code + GitHub Copilot

AndroidCommonDoc supports multiple AI coding agents from the same source of truth:

| Agent | Skills Location | Format | Invocation |
|-------|----------------|--------|------------|
| Claude Code | `skills/*/SKILL.md` | Markdown skills (read directly) | `/test core:domain` |
| GitHub Copilot | `setup/copilot-templates/` | `.prompt.md` files (generated) | `/test` in Copilot Chat |

Claude Code reads `SKILL.md` files directly from `skills/`. Both agents invoke the **same cross-platform scripts**. Copilot prompts are generated via the adapter pipeline (`adapters/copilot-adapter.sh`).

---

## Quick Start

### 1. Clone

```bash
git clone git@github.com:<org>/AndroidCommonDoc.git
```

### 2. Set Environment Variable

```bash
# macOS / Linux -- add to ~/.zshrc or ~/.bashrc
export ANDROID_COMMON_DOC="$(cd AndroidCommonDoc && pwd)"
```

<details>
<summary><strong>Windows (PowerShell)</strong></summary>

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_COMMON_DOC", (Resolve-Path AndroidCommonDoc).Path, [EnvironmentVariableTarget]::User)
```

</details>

### 3. Run the interactive setup wizard

Open Claude Code **from the AndroidCommonDoc directory** and run:

<details open>
<summary><strong>macOS / Linux</strong></summary>

```
cd "$ANDROID_COMMON_DOC"
/setup --project-root ~/AndroidStudioProjects/MyApp
```

</details>

<details>
<summary><strong>Windows (PowerShell)</strong></summary>

```
cd $env:ANDROID_COMMON_DOC
/setup --project-root C:\Users\YourName\AndroidStudioProjects\MyApp
```

</details>

The wizard covers everything in order:
- **W1 Skills** -- which categories to import (testing, build, security, guides, ui...) + per-skill opt-out
- **W2 Agents** -- user-facing agents vs internal quality-gate validators
- **W3 Detekt** -- `all` / pick rule-by-rule / disable all / skip (Gradle projects only)
- **W4 Konsist guards** -- structural guard tests with your root package (Gradle only)
- **W5 CI + PR template** -- copies `ci.yml` + `pull_request_template.md` to `.github/`
- **W6 MCP server** -- prints the ready-to-paste `claude_desktop_config.json` snippet
- **W7 GSD Integration** -- sync skills + agents to GSD-2 as invocable subagents (if `~/.gsd/` exists)
- **W8 Model Profile** -- choose agent model tier: budget / balanced / advanced / quality
- **Step 9 Health Check** -- verifies MCP, Detekt JAR, GSD parity, registry hashes; suggests next actions
- **Hook severity** -- `warn` (review violations) or `block` (enforce immediately)

It creates `l0-manifest.json` for your layer (L1 or L2), syncs selected
skills and agents, and finishes with a full verification checklist.

> **Manual alternative** -- if you prefer a non-interactive one-liner:
> ```bash
> bash "$ANDROID_COMMON_DOC/setup/setup-toolkit.sh" --project-root /path/to/your/project
> ```
> Setup runs `./gradlew detektBaseline` automatically (Step 2.5) so the first Detekt run doesn't explode with pre-existing issues in legacy code.

### 4. Restart Claude Code

Skills and hooks are loaded on startup. Restart after setup completes.

> Full step-by-step guide: [docs/guides/getting-started.md](docs/guides/getting-started.md)

---

## Unified Audit System

The `/full-audit` skill consolidates all quality checks into a single deduplicated report with wave-based execution:

```
/full-audit                        # standard profile (default)
/full-audit --profile quick        # fast, no Gradle (~5 min)
/full-audit --profile deep         # everything including beta-readiness (~45 min)
```

### How it works

1. **Wave 1 (Fast Static)** -- `commit-lint`, `lint-resources`, `verify-kmp`, `pattern-lint`, `module-health`, `dependency-graph`, `unused-resources`, `gradle-config-lint`, `string-completeness` (free, parallel)
2. **Wave 2 (Architecture)** -- `release-guardian`, `quality-gate-orchestrator`, `cross-platform-validator`, `ui-specialist`, `pattern-coverage`, `l0-diff`, `api-surface-diff`, `migration-validator`, `compose-preview-audit`, `proguard-validator` (agent + MCP tools)
3. **Wave 3 (Testing & Security)** -- `coverage`, `test-specialist`, `sbom-scan`, `sync-versions`, `code-metrics` (may need Gradle)
4. **Wave 4 (Deep, `--deep` only)** -- `beta-readiness`, `test-full`, `privacy-auditor`, `api-rate-limit-auditor`

After all waves: 3-pass deduplication (exact key, proximity, file rollup), severity normalization, and resolution tracking against previous runs.

### Finding Schema

All agents emit structured findings using the `AuditFinding` schema with canonical severity levels:

| Level | Maps from |
|-------|-----------|
| CRITICAL | BLOCKER, BLOCK, CRITICAL |
| HIGH | ERROR, FAIL, HIGH, BROKEN |
| MEDIUM | WARNING, WARN, MEDIUM, MISSING, DRIFT, MISMATCH, GAP |
| LOW | LOW, STALE |
| INFO | INFO |

Findings are persisted to `.androidcommondoc/findings-log.jsonl` with resolution tracking -- findings from a previous run that no longer appear are marked as resolved.

---

## Detekt Architecture Rules

17 hand-written AST-only rules (no type resolution, no bindingContext) that enforce the most impactful architecture patterns at build time. Organized by category:

### State & Exposure

| Rule | What It Catches |
|------|----------------|
| `SealedUiStateRule` | `data class` UiState -- must be `sealed interface` |
| `WhileSubscribedTimeoutRule` | Missing or zero timeout in `WhileSubscribed()` |
| `MutableStateFlowExposedRule` | Public `MutableStateFlow` property in ViewModel |

### ViewModel Boundaries

| Rule | What It Catches |
|------|----------------|
| `NoPlatformDepsInViewModelRule` | `android.*`, `UIKit`, `java.io` imports in ViewModels |
| `NoHardcodedStringsInViewModelRule` | String literals in ViewModel -- use `StringResource`/`DynamicString` |
| `NoHardcodedDispatchersRule` | `Dispatchers.IO/Main/Default` hardcoded in ViewModel or UseCase |

### Coroutine Safety

| Rule | What It Catches |
|------|----------------|
| `CancellationExceptionRethrowRule` | Swallowed `CancellationException` in catch blocks |
| `NoRunCatchingInCoroutineScopeRule` | `runCatching` inside coroutine scope (swallows CancellationException) |
| `NoSilentCatchRule` | `catch(Exception/Throwable)` without rethrow or meaningful handling |
| `NoLaunchInInitRule` | `launch { }` inside `init { }` block |

### Architecture Guards

| Rule | What It Catches |
|------|----------------|
| `NoChannelForUiEventsRule` | `Channel` for UI events in ViewModel -- use `SharedFlow` |
| `NoChannelForNavigationRule` | `Channel` for navigation events in ViewModel |
| `NoMagicNumbersInUseCaseRule` | Numeric literals in UseCase body -- extract as named constants |

### KMP / Time Safety

| Rule | What It Catches |
|------|----------------|
| `PreferKotlinTimeClockRule` | `kotlinx.datetime.Clock` -- use `kotlin.time.Clock.System` instead |
| `NoSystemCurrentTimeMillisRule` | `System.currentTimeMillis()` -- use `Clock.System.now().toEpochMilliseconds()` |
| `NoJavaTimeInCommonMainRule` | `java.time.*`, `java.security.*`, `java.text.*` in commonMain source sets |

### Testing Patterns

| Rule | What It Catches |
|------|----------------|
| `NoTurbineRule` | `app.cash.turbine` imports -- use `backgroundScope.launch` + `flow.toList()` |

### L0/L1 Config Hierarchy

L0 ships `detekt-l0-base.yml` with all 17 rules `active: true`. The convention plugin loads both files automatically -- `detekt-l0-base.yml` as base, `config.yml` as L1 override (last file wins per key):

```bash
# Manual equivalent of what the plugin does:
./gradlew detekt --config detekt-l0-base.yml,detekt.yml
```

```yaml
# detekt.yml -- L1 overrides only (empty = all rules active)
AndroidCommonDoc:
  NoHardcodedDispatchersRule:
    active: false   # disabled during migration
```

See [docs/guides/detekt-config.md](docs/guides/detekt-config.md) for the full guide.

### One-Line Convention Plugin Adoption

**KMP projects (AGP 9.0+):**
```kotlin
// build-logic/src/main/kotlin/your-convention.gradle.kts
plugins {
    id("androidcommondoc.toolkit")
}

androidCommonDoc {
    detektRules.set(true)       // default: true  -- 17 architecture rules
    composeRules.set(true)      // default: true  -- Compose best practices
    testConfig.set(true)        // default: true  -- useJUnitPlatform, maxParallelForks=1
    formattingRules.set(false)  // default: false -- ktlint formatting (opt-in)
}
```

> **First run**: `setup-toolkit.sh` automatically runs `./gradlew detektBaseline` (Step 2.5) to suppress pre-existing issues. Only violations introduced *after* integration will block the build. To reduce the baseline over time, see the [troubleshooting guide](docs/guides/getting-started/08-verify.md).

**Android-only projects (AGP 8.x):**
```kotlin
// Uses AndroidLibraryConventionPlugin -- no AGP migration required
plugins {
    id("your.project.android.library")  // com.android.library + kotlin.android + test config
}
```

> See [docs/gradle/gradle-patterns-android-only.md](docs/gradle/gradle-patterns-android-only.md) for the full Android-only convention plugin.

---

## Claude Code Hooks

Real-time pattern enforcement during AI-assisted development:

| Hook | Trigger | What It Does |
|------|---------|-------------|
| `detekt-post-write.sh` | PostToolUse (Write/Edit) | Runs Detekt on modified `.kt` files, blocks if violations found |
| `detekt-pre-commit.sh` | PreToolUse (git commit) | Validates all staged `.kt` files before commit |

---

## Skills Reference

40 canonical skills in `skills/`. Invoke via Claude Code (`/skill-name`) or Copilot Chat.

> Skills marked **[KMP only]** are not useful for Android-only projects and are deselected by default in the `/setup` wizard when an Android-only project is detected.

> **Audit skills** (`/audit`, `/full-audit`) read from `.androidcommondoc/audit-log.jsonl` and `findings-log.jsonl` -- written by scripts automatically. No extra Gradle runs.

### Daily Development

| Skill | What it does |
|-------|-------------|
| `/android-test` | Run instrumented tests on connected device or emulator |
| `/extract-errors` | Extract structured errors from build/test output with fix suggestions |
| `/run` | Build, install, and launch app with automatic log capture |
| `/test <module>` | Run tests for a single module with smart retry and daemon recovery |
| `/test-changed` | Test only modules with uncommitted changes (git-aware) |

### Full Validation

| Skill | What it does |
|-------|-------------|
| `/auto-cover` | Auto-generate tests targeting uncovered lines |
| `/coverage` | Analyze coverage gaps from existing data (no test execution) |
| `/coverage-full` | Complete per-module coverage report with missed line numbers |
| `/test-full` | Run all tests across all modules with full coverage report |
| `/test-full-parallel` | Same but single `--parallel` Gradle invocation (~2-3x faster) |

### Pre-PR & Git Flow

| Skill | What it does |
|-------|-------------|
| `/commit-lint` | Validate or fix Conventional Commits v1.0.0 format |
| `/git-flow` | start/merge/release/hotfix branch management |
| `/lint-resources` | Enforce string resource naming conventions |
| `/pre-pr` | Orchestrate all pre-merge checks: lint, tests, commit format, summary table |

### Architecture & Maintenance

| Skill | What it does | Platform |
|-------|-------------|----------|
| `/audit-l0` | Run coherence audit on any L0/L1/L2 layer root | Android + KMP |
| `/sbom` | Generate CycloneDX Software Bill of Materials | Android + KMP |
| `/sbom-analyze` | Analyze SBOM dependencies, licenses, and transitive tree | Android + KMP |
| `/sbom-scan` | Scan SBOM for known CVEs using Trivy | Android + KMP |
| `/set-model-profile` | Switch agent model tier: budget / balanced / advanced / quality (auto-bootstraps from L0) | Android + KMP |
| `/setup` | Interactive wizard -- configure any project to consume AndroidCommonDoc | Android + KMP |
| `/sync-versions` | Check version alignment between projects and shared catalog | KMP / multi-project |
| `/validate-patterns` | Validate code against documented architecture patterns | Android + KMP |
| `/verify-kmp` | Validate KMP source set rules, imports, and expect/actual contracts | KMP only |

### Doc Intelligence

| Skill | What it does |
|-------|-------------|
| `/doc-reorganize` | Reorganize docs/ into domain-based subdirectories |
| `/generate-rules` | Generate Kotlin Detekt rules from pattern doc frontmatter |
| `/ingest-content` | Fetch and match external content against pattern doc metadata |
| `/monitor-docs` | Monitor upstream sources for version drift -- auto-bumps `versions-manifest.json` on accept |
| `/readme-audit` | Audit README.md against repo state -- surfaces stale counts and missing sections |

### Audit & Reporting

| Skill | What it does |
|-------|-------------|
| `/audit` | Quality trend report -- coverage, Detekt, tests, CVEs. Reads existing log, zero extra runs |
| `/full-audit` | **Unified audit** -- wave-based execution, 15 agents + scripts, 3-pass dedup, consolidated report |

### Sync & Distribution

| Skill | What it does |
|-------|-------------|
| `/sync-gsd-skills` | Sync skills from all sources (marketplace, L0, L0 agents) to GSD-2 |
| `/sync-gsd-agents` | Sync .claude/agents/ to GSD subagent system and verify parity |
| `/sync-l0` | Synchronize L0 skills, agents, and commands to current project (additive default, `--prune` for removes) |
| `/sync-vault` | Sync documentation into unified Obsidian vault |

### Web Development

| Skill | What it does |
|-------|-------------|
| `/accessibility` | Audit web content against WCAG guidelines |
| `/best-practices` | Validate web development best practices |
| `/core-web-vitals` | Analyze Core Web Vitals (LCP, FID, CLS) |
| `/performance` | Full web performance audit with recommendations |
| `/seo` | Validate SEO metadata, structure, and discoverability |
| `/web-quality-audit` | Comprehensive web quality audit across all dimensions |

---

## Agents

15 specialized agents in `.claude/agents/`. User-facing agents can be invoked directly; internal agents are orchestrated by `quality-gate-orchestrator` or `full-audit-orchestrator`.

### Unified Audit

| Agent | What It Does |
|-------|-------------|
| `full-audit-orchestrator` | Orchestrates `/full-audit` -- wave execution, finding collection, 3-pass dedup, consolidated report |

### Toolkit Quality Gates (internal -- invoked by quality-gate-orchestrator)

| Agent | What It Verifies |
|-------|-----------------|
| `doc-code-drift-detector` | Pattern doc version references match `versions-manifest.json` |
| `l0-coherence-auditor` | Full L0/L1/L2 coherence audit (9 checks incl. Context7 + Jina) |
| `quality-gate-orchestrator` | Unified pass/fail report across all gates with token cost |
| `script-parity-validator` | PS1 and SH scripts produce equivalent behavior |
| `skill-script-alignment` | Skills reference correct scripts and parameters |
| `template-sync-validator` | Claude commands and Copilot prompts are semantically equivalent |

### Release & Readiness

| Agent | What It Does |
|-------|-------------|
| `beta-readiness-agent` | Feature completeness, stability, and beta criteria |
| `release-guardian-agent` | Release checklist -- debug flags, secrets, build config, hardcoded URLs, ProGuard |

### Cross-Cutting Validation

| Agent | What It Does |
|-------|-------------|
| `cross-platform-validator` | Platform parity across Android, iOS, and Desktop targets |
| `doc-alignment-agent` | Documentation accuracy against actual implementation |

### Domain Specialists

| Agent | What It Does |
|-------|-------------|
| `api-rate-limit-auditor` | HTTP client rate limiting, retry backoff, timeouts, concurrency |
| `privacy-auditor` | PII in logs, analytics consent, encrypted storage, data retention |
| `test-specialist` | Test pattern compliance and coverage gap analysis |
| `ui-specialist` | Compose UI accessibility, Material3, and design system review |

### Model Tier Strategy

Agents don't have hardcoded models -- the active profile determines which model each agent uses. Switch profiles with `/set-model-profile`:

| Profile | Default | Strategy | Use Case |
|---------|---------|----------|----------|
| `budget` | haiku | All haiku | Quick checks, cost-conscious iterations |
| `balanced` | sonnet | Haiku for static, Sonnet for reasoning | Day-to-day development (default) |
| `advanced` | sonnet | Opus for orchestrators + deep analysis, Sonnet for rest | Serious work needing high-quality planning |
| `quality` | opus | All opus | Critical audits, pre-release, production issues |

**Balanced profile** (default) assignment:

| Tier | Use Case | Agents |
|------|----------|--------|
| **haiku** | Static comparison, grep-like checks | script-parity, skill-script-alignment, doc-code-drift, l0-coherence, release-guardian, api-rate-limit, template-sync |
| **sonnet** | Cross-file reasoning, semantic analysis | quality-gate, beta-readiness, cross-platform, doc-alignment, test-specialist, ui-specialist, privacy-auditor, full-audit-orchestrator |

**Advanced profile** upgrades orchestrators and deep-analysis agents to opus while keeping validators on sonnet.

---

## MCP Server

32 tools with shared rate limiting (45 calls/min). Start with `cd mcp-server && npm start`.

| Tool | Category | What It Does |
|------|----------|-------------|
| `code-metrics` | Analysis | Code complexity metrics: LOC, nesting depth, function count per module |
| `dependency-graph` | Analysis | Build module dependency graph with DFS cycle detection + Mermaid output |
| `module-health` | Analysis | Per-module health dashboard: LOC, test count, deps, coverage |
| `string-completeness` | Analysis | Compare base strings.xml vs locale variants, report missing translations |
| `unused-resources` | Analysis | Detect orphan strings/drawables not referenced in source code |
| `skill-usage-analytics` | Analytics | Toolkit usage stats: run counts, common findings, per-skill trends |
| `api-surface-diff` | API | Detect breaking public API changes between git branches |
| `audit-report` | Audit | Read `audit-log.jsonl` and return aggregated quality trend data |
| `findings-report` | Audit | Read `findings-log.jsonl` with dedup, severity filter, resolution tracking |
| `pattern-coverage` | Coverage | Map pattern doc enforcement: Detekt rules, scripts, agents per doc |
| `find-pattern` | Discovery | Search pattern registry by query terms |
| `generate-detekt-rules` | Generation | Generate Kotlin Detekt rules from pattern doc frontmatter |
| `ingest-content` | Ingestion | Fetch and analyze external content against pattern metadata |
| `gradle-config-lint` | Linting | Check convention plugin usage, hardcoded versions, version catalog compliance |
| `check-doc-freshness` | Monitoring | Alias for monitor-sources (backward compatible) |
| `monitor-sources` | Monitoring | Check upstream sources for version changes and deprecations |
| `compose-preview-audit` | Quality | Audit @Preview quality: dark mode, screen sizes, PreviewParameter usage |
| `script-parity` | Quality | Compare PS1 and SH script behavior |
| `setup-check` | Setup | Verify toolkit installation in a project |
| `l0-diff` | Sync | Compare L0 registry vs downstream manifest to preview sync delta |
| `rate-limit-status` | Utility | Check current rate limit status |
| `check-version-sync` | Validation | Check version alignment between projects |
| `migration-validator` | Validation | Validate Room/SQLDelight migration sequences and flag destructive ops |
| `proguard-validator` | Validation | Validate ProGuard references exist and recommend keep rules by library |
| `validate-all` | Validation | Run all validation scripts with structured output |
| `validate-claude-md` | Validation | Validate CLAUDE.md ecosystem: template structure, canonical coverage |
| `validate-doc-structure` | Validation | Validate documentation structure and frontmatter completeness |
| `validate-skills` | Validation | Validate skills registry, frontmatter, and downstream sync |
| `validate-vault` | Validation | Validate vault content and wikilink integrity |
| `verify-kmp` | Validation | Validate KMP source sets and imports |
| `sync-vault` | Vault | Sync documentation into unified Obsidian vault |
| `vault-status` | Vault | Check vault sync status and statistics |

---

## Reusable CI Workflows

7 `workflow_call` workflows any Android or KMP project can reference:

```yaml
jobs:
  commit-lint:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-commit-lint.yml@main
    with:
      valid_scopes: "core,data,ui,feature"

  lint-resources:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-lint-resources.yml@main

  safety-check:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-kmp-safety-check.yml@main
    with:
      fail_on_dispatchers_warning: true   # scans for GlobalScope, hardcoded Dispatchers

  architecture-guards:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-architecture-guards.yml@main
    with:
      gradle_task: ":konsist-guard:test"

  audit-report:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-audit-report.yml@main
    with:
      weeks_lookback: 6
      generate_html: true         # downloadable HTML artifact
      post_pr_comment: false      # optional PR comment
      fail_on_regression: false   # set true to block merges on CRITICAL health

  shell-tests:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-shell-tests.yml@main

  agent-parity:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-agent-parity.yml@main
```

See `setup/github-workflows/ci-template.yml` for a full consumer project template.

---

## Scripts

22 cross-platform script pairs in `scripts/ps1/` (Windows) and `scripts/sh/` (macOS/Linux).

### Core Scripts

| Script | Purpose |
|--------|---------|
| `ai-error-extractor` | Structured error extraction with categorization and fix suggestions |
| `analyze-sbom` | SBOM dependency and license analysis |
| `build-run-app` | Build + install + launch + logcat/stdout capture |
| `check-doc-freshness` | Verify pattern doc version references against versions manifest |
| `check-version-sync` | Version catalog diff between projects -- or against `versions-manifest.json` directly |
| `generate-sbom` | CycloneDX SBOM generation via Gradle plugin |
| `gradle-run` | Gradle execution with retry, timeout, OOM recovery, and daemon management |
| `lint-resources` | String resource naming convention enforcement |
| `pattern-lint` | **Deterministic code pattern checks** -- 8 grep-based rules (CancellationException, MutableSharedFlow, forbidden imports, println, TODO crash, runBlocking, GlobalScope, System.currentTimeMillis) |
| `run-android-tests` | Instrumented test orchestration on device/emulator |
| `run-changed-modules-tests` | Git diff-based module detection + selective test execution |
| `run-parallel-coverage-suite` | Parallel test execution + XML parsing + markdown report |
| `scan-sbom` | CVE scanning via Trivy |
| `verify-kmp-packages` | KMP source set validation and import checking |

### MCP Tool Backing Scripts (new)

| Script | Purpose |
|--------|---------|
| `module-health-scan` | Per-module health metrics: source files, test files, LOC |
| `module-deps-graph` | Module dependency graph builder with cycle detection |
| `unused-strings` | Orphan string resource detector |
| `api-diff` | Public API breaking change detection between git branches |
| `migration-check` | Database migration validator (Room/SQLDelight) |
| `code-metrics` | Code complexity metrics: LOC, file count, public functions per module |
| `gradle-config-check` | Gradle configuration linter (convention plugins, hardcoded versions) |
| `sync-gsd-skills` | GSD-2 skill sync from marketplace + L0 + L0 agents (opt-in) |
| `sync-gsd-agents` | Generate GSD subagent wrappers from .claude/agents/ |
| `check-agent-parity` | Verify parity between .claude/agents/ and GSD subagents |

### Shared Libraries

| Library | Location | Purpose |
|---------|----------|---------|
| `audit-append` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Append events to `audit-log.jsonl` |
| `findings-append` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Append findings to `findings-log.jsonl` |
| `coverage-detect` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Auto-detect JaCoCo vs Kover coverage engine |
| `script-utils` | `scripts/sh/lib/` | Common shell utilities |

---

## Documentation

13 domain hubs, 67 sub-docs, 11 guides -- all with YAML frontmatter for registry scanning, upstream monitoring, and Detekt rule generation.

| Hub | Covers | Platform |
|-----|--------|----------|
| [Architecture](docs/architecture/architecture-hub.md) | Source set hierarchy, expect/actual, module naming | KMP |
| [Archive](docs/archive/archive-hub.md) | Superseded proposals and deprecated patterns | -- |
| [Compose](docs/compose/compose-hub.md) | Multi-module resource management in CMP | KMP |
| [DI](docs/di/di-hub.md) | Koin module declarations, test configuration | Android + KMP |
| [Error Handling](docs/error-handling/error-handling-hub.md) | Result type, DomainException hierarchy, CancellationException | Android + KMP |
| [Gradle](docs/gradle/gradle-hub.md) | Convention plugins (KMP + Android-only), version catalogs, Kover | Android + KMP |
| [Guides](docs/guides/guides-hub.md) | Agent consumption, Claude Code workflow, CLAUDE.md template, Detekt config, baseline reduction, script-vs-agent decision | Android + KMP |
| [Navigation](docs/navigation/navigation-hub.md) | Navigation3, state-driven nav, deep links | Android + KMP |
| [Offline-First](docs/offline-first/offline-first-hub.md) | Local-first data, sync strategies, conflict resolution | Android + KMP |
| [Resources](docs/resources/resources-hub.md) | Memory, lifecycle, and platform resource handling | Android + KMP |
| [Storage](docs/storage/storage-hub.md) | Key-value storage, encrypted storage, migrations | Android + KMP |
| [Testing](docs/testing/testing-hub.md) | runTest, fakes, coroutine dispatchers, coverage strategy | Android + KMP |
| [UI](docs/ui/ui-hub.md) | Sealed UiState, StateFlow, events, navigation, Compose screen structure | Android + KMP |

---

## How Skills Work

```
                   +-----------------------------------------+
                   |           AndroidCommonDoc (L0)          |
                   |                                          |
                   |  +----------+    +------------------+   |
                   |  | skills/  |    | skills/          |   |
                   |  | */       |--->| registry.json    |   |
                   |  | SKILL.md |    | (82 entries,     |   |
                   |  | (canon.) |    |  SHA-256 hashes) |   |
                   |  +----------+    +--------+---------+   |
                   |                           |              |
+----------+       |                  +--------v---------+   |
|Your      | /sync |                  | scripts/         |   |
|Project   |<------|                  |   ps1/*.ps1      |   |
|          |  -l0  |                  |   sh/*.sh        |   |
|skills/   |       |                  +-------^----------+   |
|.claude/  |       |                          |              |
|l0-       |       |              invokes at runtime         |
|manifest  |       |                                         |
|.json     |       |  +--------------+    +---------------+  |
+----------+       |  | detekt-      |    | build-logic/  |  |
                   |  | rules/       |--->| convention    |  |
                   |  | (17 rules)   |    | plugin        |  |
                   |  +--------------+    +---------------+  |
                   +-----------------------------------------+
```

---

## Project Structure

```
AndroidCommonDoc/
+-- .claude/
|   +-- commands/           # 27 Claude Code slash commands
|   +-- agents/             # 15 specialized agents
|   +-- hooks/              # Real-time Detekt enforcement hooks
|   +-- model-profiles.json # Agent model tier config (budget/balanced/advanced/quality)
+-- skills/
|   +-- */SKILL.md          # 40 canonical skill definitions
|   +-- registry.json       # L0 registry (82 entries, SHA-256 hashes)
|   +-- params.json         # Parameter manifest
|   +-- params.schema.json  # JSON Schema for parameter validation
+-- scripts/
|   +-- ps1/                # PowerShell (Windows) -- 22 scripts
|   +-- sh/                 # Bash (macOS/Linux) -- 22 scripts
|   |   +-- lib/            # Shared libraries (audit-append, findings-append, coverage-detect, script-utils)
|   +-- lib/                # Shared Python tools (parse-coverage-xml.py)
|   +-- tests/              # bats shell test suite (255 tests, 4 fixture XMLs)
+-- mcp-server/             # MCP server (32 tools, 3 prompts, dynamic resources)
|   +-- src/
|   |   +-- tools/          # 32 tools: validation, analysis, metrics, audit, sync, vault
|   |   +-- types/          # Shared types (ValidationResult, AuditFinding, FindingsReport)
|   |   +-- utils/          # Utilities (rate-limiter, jsonl-reader, gradle-parser, xml-report-reader, finding-dedup, logger)
|   |   +-- generation/     # Detekt rule parser, emitters, config-emitter
|   |   +-- registry/       # Pattern registry: scanner, resolver, frontmatter
|   |   +-- vault/          # Obsidian vault sync engine
|   |   +-- cli/            # CLI entrypoint for CI monitoring
|   +-- tests/              # 76 test files -- vitest unit + integration (983 tests)
+-- detekt-rules/
|   +-- src/main/kotlin/    # 17 hand-written AST-only Detekt rules
|   +-- src/main/resources/
|       +-- config/
|           +-- detekt-l0-base.yml  # Distributable baseline (all rules active)
|           +-- config.yml          # L1 override example
+-- build-logic/
|   +-- src/main/kotlin/    # Convention plugins (KMP + Android-only)
+-- konsist-tests/          # Konsist architecture verification tests
+-- setup/
|   +-- setup-toolkit.sh    # Unified full-toolkit installer
|   +-- copilot-templates/  # 40 Copilot prompt templates
|   +-- github-workflows/   # CI template + PR template for consumer projects
+-- .github/workflows/
|   +-- l0-ci.yml                            # L0 unified CI (all checks on push/PR)
|   +-- mcp-server-ci.yml                    # MCP server test CI (path-filtered)
|   +-- doc-monitor.yml                      # Upstream doc monitoring cron
|   +-- readme-audit.yml                     # README count verification
|   +-- reusable-commit-lint.yml             # workflow_call: Conventional Commits
|   +-- reusable-lint-resources.yml          # workflow_call: resource naming
|   +-- reusable-kmp-safety-check.yml        # workflow_call: GlobalScope/Dispatchers scan
|   +-- reusable-agent-parity.yml            # workflow_call: .claude ↔ GSD agent sync check
|   +-- reusable-architecture-guards.yml     # workflow_call: Konsist guards
|   +-- reusable-audit-report.yml            # workflow_call: quality audit HTML report
|   +-- reusable-shell-tests.yml             # workflow_call: bats shell script tests
+-- docs/                   # 13 hub docs, 67 sub-docs, 11 guides
|   +-- architecture/       +-- compose/    +-- di/
|   +-- error-handling/     +-- gradle/     +-- guides/
|   +-- navigation/         +-- offline-first/ +-- resources/
|   +-- storage/            +-- testing/    +-- ui/
|   +-- archive/
+-- adapters/               # Code generation pipeline (skills -> commands/prompts)
+-- versions-manifest.json  # Canonical library versions + monitor_urls + coupled_versions
+-- AGENTS.md               # Universal AI agent entry point
+-- CHANGELOG.md
```

---

## Coverage Workflow

`/test-full-parallel` orchestrates a complete test + coverage cycle via `run-parallel-coverage-suite.sh` — a single script that handles everything from daemon management to gap analysis:

```
┌─────────────────────────────────────────────────────────────────────┐
│  /test-full-parallel                                                │
│  run-parallel-coverage-suite.sh --project-root . --coverage-tool auto│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. DAEMON MANAGEMENT                                               │
│     --fresh-daemon → stop daemons + wipe build/reports/kover|jacoco │
│                                                                     │
│  2. DISCOVER MODULES                                                │
│     Scan settings.gradle.kts → detect KMP vs Android → filter       │
│     --module-filter "core:*"  --coverage-only  --include-shared     │
│                                                                     │
│  3. BUILD TASK LISTS                                                │
│     Auto-detect test type (common|androidUnit|desktop) per module   │
│     --test-type all  → run every variant                            │
│                                                                     │
│  4. RUN TESTS (single Gradle invocation)                            │
│     gradlew :mod:test :mod:koverXmlReport --parallel --continue     │
│     --rerun-tasks (coverage phase only — avoids stale XMLs)         │
│     --max-workers N  --timeout 600                                  │
│                                                                     │
│  5. PARSE COVERAGE (lib/coverage-detect.sh)                         │
│     Auto-detect JaCoCo vs Kover → parse XML → per-module metrics    │
│     --coverage-tool jacoco|kover|auto|none                          │
│                                                                     │
│  6. GENERATE REPORT → coverage-full-report.md                       │
│     Per-module: instruction%, branch%, missed lines, uncovered fns  │
│     --min-missed-lines 5  --output-file custom-report.md            │
│                                                                     │
│  7. COVERAGE GAPS                                                   │
│     Files with lowest coverage → input for /auto-cover              │
│                                                                     │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           v
         coverage-full-report.md  →  /auto-cover
         (per-module %, missed lines)    (generate tests for gaps)
```

The same script powers all coverage skills:

| Skill | What It Runs | Gradle Invocations |
|-------|-------------|-------------------|
| `/test-full-parallel` | Full flow: tests + coverage + report | 1 (parallel) |
| `/test-full` | Same flow, sequential execution | 1 per module |
| `/coverage` | Steps 5-7 only (parse existing XMLs) | 0 |
| `/auto-cover` | Reads report → generates tests for gaps | 0 + 1 per new test |

All skills accept `--coverage-tool jacoco|kover|auto|none`.

---

## Requirements

| Dependency | Required By | Install |
|------------|-------------|---------|
| ADB | `/run`, `/android-test` | Android SDK Platform-Tools |
| CycloneDX plugin | `/sbom` | Applied via Gradle plugin |
| Git | `/test-changed`, `/pre-pr`, `/git-flow` | Pre-installed on most systems |
| Gradle | All build/test scripts | Wrapper included in projects |
| JaCoCo or Kover | `/coverage`, `/test-full` | JaCoCo built-in; Kover via `libs.versions.toml` |
| JDK 17+ | All Gradle scripts | [sdkman](https://sdkman.io/) or [Adoptium](https://adoptium.net/) |
| Node.js 18+ | MCP server, CLI monitoring | [nodejs.org](https://nodejs.org/) |
| Trivy | `/sbom-scan` | [trivy.dev](https://trivy.dev/) |

---

## Updating

1. `git pull` in AndroidCommonDoc -- script changes apply immediately
2. Run `/sync-l0` in each downstream project to pull updated skills, agents, and commands
3. The sync engine compares SHA-256 hashes and only updates changed files

---

## License

Apache License 2.0 -- see [LICENSE](LICENSE) for details.
