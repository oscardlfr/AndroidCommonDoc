# AndroidCommonDoc

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Agents](https://img.shields.io/badge/AI_Agents-Claude_Code%20%7C%20GitHub_Copilot-blueviolet.svg)]()

**Centralized developer toolkit for Android and Kotlin Multiplatform projects.**

Cross-platform scripts, AI agent skills (Claude Code + GitHub Copilot), 17 custom Detekt architecture rules, convention plugins for one-line adoption (KMP and Android-only), real-time enforcement hooks, an MCP server with 31 tools for programmatic access, a unified audit system with finding deduplication, multi-layer knowledge cascade (L0→L1→L2) for chain topology, and doc intelligence with upstream monitoring -- designed for solo developers and small teams managing multiple Android/KMP projects from a single source of truth.

> **Platform support:** All skills, agents, and Detekt rules work on both **Android-only (AGP 8.x)** and **KMP (AGP 9.0+)** projects. A small subset is KMP-only (noted below).

---

## Why

Managing multiple Android/KMP projects means duplicated scripts, inconsistent patterns, and coverage blind spots. AndroidCommonDoc solves this by centralizing:

- **Scripts** that run identically on Windows (PowerShell) and macOS/Linux (Bash) -- 22 cross-platform pairs + 4 Bash-only utilities
- **AI agent skills** for Claude Code and GitHub Copilot -- 40 canonical skill definitions in `skills/`, distributed to downstream projects via registry + manifest + sync engine
- **Pattern docs** that encode architecture decisions once, reference everywhere
- **Detekt rules** that enforce architecture patterns at build time -- 17 hand-written AST-only rules covering state exposure, coroutine safety, ViewModel boundaries, KMP time safety, and navigation contracts
- **Convention plugins** for one-line Gradle adoption: `KmpLibraryConventionPlugin` (AGP 9.0+ / KMP) and `AndroidLibraryConventionPlugin` (AGP 8.x / Android-only)
- **Claude Code hooks** that catch violations in real-time during AI-assisted development
- **Coverage tooling** with auto-detection (JaCoCo or Kover — checks build files, convention plugins, and version catalogs), kover task fallback recovery, `--exclude-coverage` for test utilities, parallel execution, and gap analysis
- **MCP server** with 31 tools for programmatic validation, pattern discovery, vault sync, module health, dependency analysis, code metrics, findings reports, and doc intelligence
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
| **flat** | L0 → L2 directly | Solo devs / small teams, standalone apps, no shared-libs layer |
| **chain** | L0 → L1 → L2 | Enterprise, multi-team orgs with shared platform libraries |

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

Choose topology in `/setup` wizard (W0) or edit `l0-manifest.json` directly. Manifest v1 (`l0_source` field) is auto-migrated to v2 on read.

#### What chain mode provides (M003)

- **Multi-source sync**: `syncMultiSource()` reads all `sources[]`, merges registries (last layer wins per entry name+type), materializes files from the correct source layer
- **Knowledge cascade**: `sync-l0 --resolve` generates `KNOWLEDGE-RESOLVED.md` with tagged `[L0]`/`[L1]`/`[L2]` sections — agents see all layers' knowledge in one file
- **Agent template injection**: Agent files can use `{{LAYER_KNOWLEDGE}}` and `{{LAYER_CONVENTIONS}}` placeholders, resolved from the knowledge cascade at sync time
- **Multi-layer doc search**: `find-pattern --from_manifest` searches docs from all sources, ranked by proximity (local > L1 > L0)
- **Convention plugin chain**: Detekt config loads L0 base → L1 override → L2 local via `config.setFrom()` — see [convention-plugin-chain.md](docs/guides/convention-plugin-chain.md)

### What gets synced to your project

When you run `/sync-l0` or merge an auto-sync PR, these assets are materialized to your project:

| What | Destination | Count |
|------|-------------|-------|
| Skills | `.claude/skills/*/SKILL.md` | 40 |
| Agents | `.claude/agents/*.md` | 15 |
| Commands | `.claude/commands/*.md` | 27 |
| **Total** | | **82 entries** |

**Not synced:** scripts (invoked at runtime from L0 path), Detekt rules (consumed via JAR), docs (reference only), MCP tools (server runs from L0).

### Materialization model

Downstream projects maintain local copies of L0 skills via the **registry + manifest + sync engine**:

1. **Registry** (`skills/registry.json`) -- catalogs all 82 L0 entries with SHA-256 hashes
2. **Manifest** (`l0-manifest.json` in each project) -- declares which L0 entries to sync, tracks checksums, and lists source layers for chain topology
3. **Sync engine** (`/sync-l0` skill) -- materializes copies with `l0_source` / `l0_hash` headers for drift detection. Additive by default (never removes files); use `--prune` to clean orphans. Resolves paths via git toplevel for worktree safety. In chain mode, `syncMultiSource()` merges registries from all sources before syncing.

```bash
# In your project: sync all L0 skills (additive — safe)
/sync-l0

# Chain mode: sync from all manifest sources (L0 + L1)
/sync-l0

# Generate KNOWLEDGE-RESOLVED.md from all layers
/sync-l0 --resolve

# Remove orphaned files that no longer exist in L0
/sync-l0 --prune

# Preview what would change without writing
/sync-l0 --dry-run
```

---

## Multi-Agent Support: Claude Code + GitHub Copilot

AndroidCommonDoc supports multiple AI coding agents from the same source of truth:

| Agent | Skills | Agents | Format | Invocation |
|-------|--------|--------|--------|------------|
| Claude Code | `skills/*/SKILL.md` | `.claude/agents/*.md` | Markdown (read directly) | `/test core:domain` |
| GitHub Copilot | `setup/copilot-templates/` | `setup/copilot-agent-templates/` | `.prompt.md` / `.agent.md` (generated) | `/test` in Copilot Chat |

Claude Code reads `SKILL.md` files directly from `skills/`. Both agents invoke the **same cross-platform scripts**. Copilot files are generated via the adapter pipeline (`adapters/generate-all.sh`):
- `copilot-adapter.sh` — skills → `.prompt.md`
- `copilot-agent-adapter.sh` — agents → `.agent.md` (maps tools, inlines skill summaries, strips Claude-specific fields)
- `claude-md-copilot-adapter.sh` — CLAUDE.md → `.github/copilot-instructions.md`

For L1/L2 projects, the agent adapter only generates Copilot agents for **project-specific** agents (listed in `l0-manifest.json`), skipping L0-synced agents to avoid duplication.

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
- **W0 Topology** -- flat (L0 direct) or chain (L0→L1→L2 cascade) + parent layer path validation
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

See [docs/guides/detekt-config.md](docs/guides/detekt-config.md) for the full guide and [docs/guides/convention-plugin-chain.md](docs/guides/convention-plugin-chain.md) for multi-layer chain loading (L0→L1→L2).

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

40 canonical skills in `skills/`. Invoke via Claude Code (`/skill-name`) or Copilot Chat. All skills are synced to downstream projects via `/sync-l0`.

> Skills marked **[KMP only]** are not useful for Android-only projects and are deselected by default in the `/setup` wizard when an Android-only project is detected.

> **Audit skills** (`/audit`, `/full-audit`) read from `.androidcommondoc/audit-log.jsonl` and `findings-log.jsonl` -- written by scripts automatically. No extra Gradle runs.

### Skills (synced to your project)

These are the skills that get materialized to your `.claude/skills/` directory via `/sync-l0`.

#### Daily Development

| Skill | What it does |
|-------|-------------|
| `/android-test` | Run instrumented tests on connected device or emulator |
| `/extract-errors` | Extract structured errors from build/test output with fix suggestions |
| `/run` | Build, install, and launch app with automatic log capture |
| `/test <module>` | Run tests for a single module with smart retry and daemon recovery |
| `/test-changed` | Test only modules with uncommitted changes (git-aware) |

#### Full Validation

| Skill | What it does |
|-------|-------------|
| `/auto-cover` | Auto-generate tests targeting uncovered lines |
| `/coverage` | Analyze coverage gaps from existing data (no test execution) |
| `/coverage-full` | Complete per-module coverage report with missed line numbers |
| `/test-full` | Run all tests across all modules with full coverage report |
| `/test-full-parallel` | Same but single `--parallel` Gradle invocation (~2-3x faster) |

#### Pre-PR & Git Flow

| Skill | What it does |
|-------|-------------|
| `/commit-lint` | Validate or fix Conventional Commits v1.0.0 format |
| `/git-flow` | start/merge/release/hotfix branch management |
| `/lint-resources` | Enforce string resource naming conventions |
| `/pre-pr` | Orchestrate all pre-merge checks: lint, tests, commit format, summary table |

#### Architecture & Maintenance

| Skill | What it does | Platform |
|-------|-------------|----------|
| `/sbom` | Generate CycloneDX Software Bill of Materials | Android + KMP |
| `/sbom-analyze` | Analyze SBOM dependencies, licenses, and transitive tree | Android + KMP |
| `/sbom-scan` | Scan SBOM for known CVEs using Trivy | Android + KMP |
| `/set-model-profile` | Switch agent model tier: budget / balanced / advanced / quality | Android + KMP |
| `/setup` | Interactive wizard -- configure any project to consume AndroidCommonDoc | Android + KMP |
| `/sync-l0` | Synchronize L0 skills, agents, and commands to current project | Android + KMP |
| `/sync-versions` | Check version alignment between projects and shared catalog | KMP / multi-project |
| `/validate-patterns` | Validate code against documented architecture patterns | Android + KMP |
| `/verify-kmp` | Validate KMP source set rules, imports, and expect/actual contracts | KMP only |

#### Audit & Reporting

| Skill | What it does |
|-------|-------------|
| `/audit` | Quality trend report -- coverage, Detekt, tests, CVEs. Reads existing log, zero extra runs |
| `/full-audit` | **Unified audit** -- wave-based execution, 15 agents + scripts, 3-pass dedup, consolidated report |

#### Web Development

| Skill | What it does |
|-------|-------------|
| `/accessibility` | Audit web content against WCAG guidelines |
| `/best-practices` | Validate web development best practices |
| `/core-web-vitals` | Analyze Core Web Vitals (LCP, FID, CLS) |
| `/performance` | Full web performance audit with recommendations |
| `/seo` | Validate SEO metadata, structure, and discoverability |
| `/web-quality-audit` | Comprehensive web quality audit across all dimensions |

### L0 Maintenance Skills

Skills primarily useful when working on AndroidCommonDoc (L0) itself:

| Skill | What it does |
|-------|-------------|
| `/audit-l0` | Run coherence audit on any L0/L1/L2 layer root (doc structure, frontmatter, line limits) |
| `/doc-reorganize` | Reorganize `docs/` into domain-based subdirectories |
| `/generate-rules` | Generate Kotlin Detekt rules from pattern doc YAML frontmatter |
| `/ingest-content` | Fetch and match external content against pattern doc metadata |
| `/monitor-docs` | Monitor upstream sources for version drift -- auto-bumps `versions-manifest.json` on accept |
| `/readme-audit` | Audit README.md against repo state -- surfaces stale counts, missing entries, and content drift |
| `/sync-gsd-agents` | Sync `.claude/agents/` to GSD subagent system and verify parity |
| `/sync-gsd-skills` | Sync skills from all sources (marketplace, L0, L0 agents) to GSD-2 |
| `/sync-vault` | Sync documentation into unified Obsidian vault |

---

## Agents

15 specialized agents in `.claude/agents/`. All synced to downstream projects. Claude Code auto-delegates to these agents based on their `description:` field — configure delegation rules in your CLAUDE.md [Agent Roster](docs/agents/claude-md-template.md).

**6 audit-only agents** (read-only). **2 audit+implement agents** (can write code). **5 quality gate agents** (internal). **2 orchestrators**.

### Domain Agents

These agents are materialized to your `.claude/agents/` via `/sync-l0`. Claude Code delegates to them automatically when the task matches their description.

| Agent | Mode | What It Does |
|-------|------|-------------|
| `api-rate-limit-auditor` | audit | HTTP client rate limiting, retry backoff, timeouts, concurrency |
| `beta-readiness-agent` | audit | Feature completeness, stability, and beta criteria |
| `cross-platform-validator` | audit | Platform parity across Android, iOS, and Desktop targets |
| `doc-alignment-agent` | audit | Documentation accuracy against actual implementation |
| `privacy-auditor` | audit | PII in logs, analytics consent, encrypted storage, data retention |
| `release-guardian-agent` | audit | Release checklist -- debug flags, secrets, build config, hardcoded URLs, ProGuard |
| `test-specialist` | **audit+impl** | Test pattern compliance, coverage gaps, **and test generation** |
| `ui-specialist` | **audit+impl** | Compose UI accessibility, Material3, design system — **audits and implements fixes** |

### Orchestrators

| Agent | What It Does |
|-------|-------------|
| `full-audit-orchestrator` | Orchestrates `/full-audit` -- wave execution, finding collection, 3-pass dedup, consolidated report |
| `quality-gate-orchestrator` | Unified pass/fail report across all gates with token cost |

### Quality Gate Agents

These agents verify internal consistency. Invoked by `quality-gate-orchestrator`.

| Agent | What It Verifies |
|-------|-----------------|
| `doc-code-drift-detector` | Pattern doc version references match `versions-manifest.json` |
| `l0-coherence-auditor` | Full L0/L1/L2 coherence audit (9 checks incl. Context7 + Jina) |
| `script-parity-validator` | PS1 and SH scripts produce equivalent behavior |
| `skill-script-alignment` | Skills reference correct scripts and parameters |
| `template-sync-validator` | Claude commands and Copilot prompts are semantically equivalent |

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

31 tools with shared rate limiting (45 calls/min). Start with `cd mcp-server && npm start`.

**18 tools** work in any project. **13 tools** are for AndroidCommonDoc development (doc intelligence, vault sync, toolkit validation).

### General Tools

| Tool | Category | What It Does |
|------|----------|-------------|
| `api-surface-diff` | API | Detect breaking public API changes between git branches |
| `audit-report` | Audit | Read `audit-log.jsonl` and return aggregated quality trend data |
| `check-version-sync` | Validation | Check version alignment between projects |
| `code-metrics` | Analysis | Code complexity metrics: LOC, nesting depth, function count per module |
| `compose-preview-audit` | Quality | Audit @Preview quality: dark mode, screen sizes, PreviewParameter usage |
| `dependency-graph` | Analysis | Build module dependency graph with DFS cycle detection + Mermaid output |
| `find-pattern` | Discovery | Search pattern registry by query terms (supports `from_manifest` for multi-layer search) |
| `findings-report` | Audit | Read `findings-log.jsonl` with dedup, severity filter, resolution tracking |
| `gradle-config-lint` | Linting | Check convention plugin usage, hardcoded versions, version catalog compliance |
| `migration-validator` | Validation | Validate Room/SQLDelight migration sequences and flag destructive ops |
| `module-health` | Analysis | Per-module health dashboard: LOC, test count, deps, coverage |
| `proguard-validator` | Validation | Validate ProGuard references exist and recommend keep rules by library |
| `setup-check` | Setup | Verify toolkit installation in a project |
| `skill-usage-analytics` | Analytics | Toolkit usage stats: run counts, common findings, per-skill trends |
| `string-completeness` | Analysis | Compare base strings.xml vs locale variants, report missing translations |
| `unused-resources` | Analysis | Detect orphan strings/drawables not referenced in source code |
| `validate-all` | Validation | Run all validation scripts with structured output |
| `verify-kmp` | Validation | Validate KMP source sets and imports |

### L0 Internal Tools (for AndroidCommonDoc development)

These tools operate on AndroidCommonDoc's own documentation, vault, and toolkit structure.

| Tool | Category | What It Does |
|------|----------|-------------|
| `check-freshness` | Monitoring | Alias for monitor-sources (backward compatible) |
| `generate-detekt-rules` | Generation | Generate Kotlin Detekt rules from pattern doc frontmatter |
| `ingest-content` | Ingestion | Fetch and analyze external content against pattern metadata |
| `l0-diff` | Sync | Compare L0 registry vs downstream manifest to preview sync delta |
| `monitor-sources` | Monitoring | Check upstream sources for version changes and deprecations |
| `pattern-coverage` | Coverage | Map pattern doc enforcement: Detekt rules, scripts, agents per doc |
| `script-parity` | Quality | Compare PS1 and SH script behavior |
| `sync-vault` | Vault | Sync documentation into unified Obsidian vault |
| `validate-claude-md` | Validation | Validate CLAUDE.md ecosystem: template structure, canonical coverage |
| `validate-doc-structure` | Validation | Validate documentation structure and frontmatter completeness |
| `validate-skills` | Validation | Validate skills registry, frontmatter, and downstream sync |
| `validate-vault` | Validation | Validate vault content and wikilink integrity |
| `vault-status` | Vault | Check vault sync status and statistics |

---

## Reusable CI Workflows

7 `workflow_call` workflows any Android or KMP project can reference:

```yaml
jobs:
  commit-lint:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-commit-lint.yml@master
    with:
      valid_scopes: "core,data,ui,feature"

  lint-resources:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-lint-resources.yml@master

  safety-check:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-kmp-safety-check.yml@master
    with:
      fail_on_dispatchers_warning: true   # scans for GlobalScope, hardcoded Dispatchers

  architecture-guards:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-architecture-guards.yml@master
    with:
      gradle_task: ":konsist-guard:test"

  audit-report:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-audit-report.yml@master
    with:
      weeks_lookback: 6
      generate_html: true         # downloadable HTML artifact
      post_pr_comment: false      # optional PR comment
      fail_on_regression: false   # set true to block merges on CRITICAL health

  shell-tests:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-shell-tests.yml@master

  agent-parity:
    uses: <org>/AndroidCommonDoc/.github/workflows/reusable-agent-parity.yml@master
```

See `setup/github-workflows/ci-template.yml` for a full consumer project template.

---

## Scripts

22 cross-platform script pairs in `scripts/ps1/` (Windows) and `scripts/sh/` (macOS/Linux), plus 5 Bash-only scripts (`check-agent-parity`, `check-detekt-coverage`, `install-git-hooks`, `rehash-registry`, `sync-gsd-agents`).

### Core Scripts

| Script | Purpose |
|--------|---------|
| `ai-error-extractor` | Structured error extraction with categorization and fix suggestions |
| `analyze-sbom` | SBOM dependency and license analysis |
| `build-run-app` | Build + install + launch + logcat/stdout capture |
| `check-doc-freshness` | Verify pattern doc version references against versions manifest (calls check-freshness) |
| `check-version-sync` | Version catalog diff between projects -- or against `versions-manifest.json` directly |
| `generate-sbom` | CycloneDX SBOM generation via Gradle plugin |
| `gradle-run` | Gradle execution with retry, timeout, OOM recovery, and daemon management |
| `lint-resources` | String resource naming convention enforcement |
| `pattern-lint` | **Deterministic code pattern checks** -- 8 grep-based rules (CancellationException, MutableSharedFlow, forbidden imports, println, TODO crash, runBlocking, GlobalScope, System.currentTimeMillis) |
| `run-android-tests` | Instrumented test orchestration on device/emulator |
| `run-changed-modules-tests` | Git diff-based module detection + selective test execution |
| `run-parallel-coverage-suite` | Parallel test execution + per-module coverage (auto-detect JaCoCo/Kover) + kover task fallback retry + XML parsing + markdown report. `--exclude-coverage` for test-utility modules, auto-excludes `*:testing`, `konsist-guard`, etc. |
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
| `check-detekt-coverage` | Diagnose Detekt per-module task coverage (KMP source sets) |
| `readme-audit` | Comprehensive README/doc audit against filesystem (counts, tables, tree, hub links, prose claims) |
| `rehash-registry` | Recompute SHA-256 hashes in registry.json (CRLF→LF normalized) |
| `install-git-hooks` | Install pre-commit (pattern-lint) + commit-msg (conventional commits) git hooks |

### Shared Libraries

| Library | Location | Purpose |
|---------|----------|---------|
| `audit-append` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Append events to `audit-log.jsonl` |
| `findings-append` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Append findings to `findings-log.jsonl` |
| `coverage-detect` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Auto-detect JaCoCo vs Kover per module — checks build file, report dirs, root buildscript, build-logic convention plugins, and gradle/libs.versions.toml. Provides task name resolution with kover variant fallbacks. |
| `script-utils` | `scripts/sh/lib/` | Common shell utilities: `glob_match`, `get_project_type`, `format_line_ranges`, `safe_rg` (cross-platform ripgrep with find+grep fallback on Windows) |

---

## Documentation

14 domain hubs, 54 sub-docs, 15 guides, 6 agent workflow docs -- all with YAML frontmatter for registry scanning, upstream monitoring, and Detekt rule generation.

| Hub | Covers | Platform |
|-----|--------|----------|
| [Architecture](docs/architecture/architecture-hub.md) | Source set hierarchy, expect/actual, module naming | KMP |
| [Archive](docs/archive/archive-hub.md) | Superseded proposals and deprecated patterns | -- |
| [Compose](docs/compose/compose-hub.md) | Multi-module resource management in CMP | KMP |
| [DI](docs/di/di-hub.md) | Koin module declarations, test configuration | Android + KMP |
| [Error Handling](docs/error-handling/error-handling-hub.md) | Result type, DomainException hierarchy, CancellationException | Android + KMP |
| [Gradle](docs/gradle/gradle-hub.md) | Convention plugins (KMP + Android-only), version catalogs, Kover | Android + KMP |
| [Agents](docs/agents/agents-hub.md) | CLAUDE.md Boris Cherny template, dev-lead workflow, multi-agent patterns, agent consumption, capability detection | All |
| [Guides](docs/guides/guides-hub.md) | Getting started, Detekt config/migration/baseline, convention plugin chain, doc template | Android + KMP |
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
|   +-- sh/                 # Bash (macOS/Linux) -- 28 scripts (22 cross-platform + 6 utilities)
|   |   +-- lib/            # Shared libraries (audit-append, findings-append, coverage-detect, script-utils)
|   +-- lib/                # Shared Python tools (parse-coverage-xml.py)
|   +-- tests/              # bats shell test suite (567 tests, 4 fixture XMLs)
+-- mcp-server/             # MCP server (31 tools, 3 prompts, dynamic resources)
|   +-- src/
|   |   +-- tools/          # 31 tools: validation, analysis, metrics, audit, sync, vault
|   |   +-- types/          # Shared types (ValidationResult, AuditFinding, FindingsReport)
|   |   +-- utils/          # Utilities (rate-limiter, jsonl-reader, gradle-parser, xml-report-reader, finding-dedup, logger)
|   |   +-- generation/     # Detekt rule parser, emitters, config-emitter
|   |   +-- registry/       # Pattern registry: scanner, resolver, frontmatter
|   |   +-- vault/          # Obsidian vault sync engine
|   |   +-- cli/            # CLI entrypoint for CI monitoring
|   +-- tests/              # 79 test files -- vitest unit + integration (1060 tests)
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
|   +-- copilot-templates/  # 40 Copilot prompt templates (generated from skills)
|   +-- copilot-agent-templates/ # 4 Copilot agent templates (generated from agent-templates)
|   +-- agent-templates/    # 5 generic agent templates for L1/L2 projects
|   +-- github-workflows/   # CI template + PR template for consumer projects
|   +-- templates/
|   |   +-- workflows/
|   |       +-- l0-auto-sync.yml  # Downstream auto-sync workflow template
|   |       +-- release.yml       # Git Flow + Conventional Commits release template
+-- .github/workflows/
|   +-- l0-ci.yml                            # L0 unified CI (all checks on push/PR)
|   +-- l0-sync-dispatch.yml                # Dispatch l0-sync events to downstream repos on push
|   +-- l0-release-assets.yml               # Package skills+agents+commands as release tarball
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
+-- docs/                   # 14 hub docs, 54 sub-docs, 15 guides, 6 agent workflow docs
|   +-- agents/          +-- architecture/  +-- compose/    +-- di/
|   +-- error-handling/     +-- gradle/     +-- guides/
|   +-- navigation/         +-- offline-first/ +-- resources/
|   +-- storage/            +-- testing/    +-- ui/
|   +-- archive/
+-- adapters/               # Code generation pipeline (skills → prompts, agents → Copilot agents, CLAUDE.md → copilot-instructions)
+-- versions-manifest.json  # Canonical library versions + monitor_urls + coupled_versions
+-- version.properties      # Semver source of truth (major/minor/patch)
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
│     --java-home <path> → override JAVA_HOME for Gradle execution   │
│     Auto-detects: gradle.properties org.gradle.java.home            │
│     Warns if jvmToolchain version ≠ current JAVA_HOME               │
│                                                                     │
│  2. DISCOVER MODULES + EXCLUDE                                      │
│     Scan settings.gradle.kts → detect KMP vs Android → filter       │
│     --module-filter "core:*"  --coverage-only  --include-shared     │
│     --exclude-coverage "core:testing,konsist-guard"                 │
│     Auto-excludes: *:testing, *:test-fakes, konsist-guard, etc.    │
│                                                                     │
│  3. BUILD TASK LISTS (per-module coverage detection)                │
│     coverage-detect.sh checks: build.gradle.kts → report dirs →    │
│       root buildscript → build-logic/ → gradle/libs.versions.toml  │
│     Auto-detect test type (common|androidUnit|desktop) per module   │
│     --test-type all  → run every variant                            │
│                                                                     │
│  4. RUN TESTS (single Gradle invocation)                            │
│     gradlew :mod:test :mod:koverXmlReport --parallel --continue     │
│     --rerun-tasks (coverage phase only — avoids stale XMLs)         │
│     --max-workers N  --timeout 600                                  │
│                                                                     │
│  4b. KOVER RECOVERY (if batch partial — e.g. 3/18 XMLs)            │
│     Retry missing modules with task fallbacks:                      │
│     koverXmlReportDesktop → koverXmlReport → koverXmlReportDebug   │
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

All skills accept `--coverage-tool jacoco|kover|auto|none` and `--exclude-coverage <modules>`.

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

Downstream projects sync automatically — no manual steps needed.

### Automatic (recommended)

Two distribution models:

- **Managed (instant):** L0 lists downstream repos in `.github/downstream-repos.json`. On push to master, dispatches `repository_dispatch` → each downstream clones L0, runs sync, opens PR. For your own ecosystem.
- **Open (daily cron):** Any consumer installs `l0-auto-sync.yml` and points `l0-manifest.json` at L0. Daily cron checks for changes. L0 doesn't need to know they exist. For external teams.

```
L0 push to master
  → l0-sync-dispatch.yml (managed repos: instant)
  → L1 l0-auto-sync.yml: clone L0 → sync → PR
  → merge PR → git pull develop → done
```

**Quick setup — managed (3 steps):**

1. **L0**: `.github/downstream-repos.json` + `DOWNSTREAM_SYNC_TOKEN` secret (fine-grained PAT, Contents:RW)
2. **L1/L2**: Copy `setup/templates/workflows/l0-auto-sync.yml` → `.github/workflows/` (or `/setup` wizard W5)
3. **L1/L2**: Enable "Allow GitHub Actions to create and approve pull requests" in Settings → Actions → General

**Quick setup — open consumers (2 steps):**

1. Copy `setup/templates/workflows/l0-auto-sync.yml` → `.github/workflows/`
2. Run `/setup` to create `l0-manifest.json` (cron handles the rest)

**After merging the PR:** `git pull develop` — skills, agents, and commands are updated in `.claude/`. No scripts to run.

See [layer-topology.md](docs/architecture/layer-topology.md#auto-sync) for the full guide with troubleshooting.

### Manual

```bash
# In the downstream project:
/sync-l0              # additive sync (pulls new/updated, never removes)
/sync-l0 --prune      # also removes orphaned files
/sync-l0 --dry-run    # preview changes without writing
```

The sync engine compares SHA-256 hashes and only updates changed files. Works identically for flat and chain topologies — chain mode syncs from all sources in manifest order (L0 → L1). User selections (`exclude_skills`, `exclude_categories`, `l2_specific`) are never overwritten.

See [layer-topology.md](docs/architecture/layer-topology.md) for auto-sync setup details.

---

## License

Apache License 2.0 -- see [LICENSE](LICENSE) for details.
