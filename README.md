# AndroidCommonDoc

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()
[![Agents](https://img.shields.io/badge/AI_Agents-Claude_Code%20%7C%20GitHub_Copilot-blueviolet.svg)]()

**Centralized developer toolkit for Android and Kotlin Multiplatform projects.**

Cross-platform scripts, AI agent skills (Claude Code + GitHub Copilot), 19 custom Detekt architecture rules, convention plugins for one-line adoption (KMP and Android-only), real-time enforcement hooks, an MCP server with 38 tools for programmatic access, a unified audit system with finding deduplication, multi-layer knowledge cascade (L0→L1→L2) for chain topology, extensible agent routing with domain+intent frontmatter, 3-phase team model (Planning → Execution → Quality Gate), 17 agent templates for dev workflow orchestration, and doc intelligence with upstream monitoring -- designed for solo developers and small teams managing multiple Android/KMP projects from a single source of truth.

> **Start here:** `/work` (smart task routing), `/init-session` (project context dashboard), `/resume-work` (CEO-level session resume). These three entry points discover your agents, skills, and modules automatically.

> **Platform support:** All skills, agents, and Detekt rules work on both **Android-only (AGP 8.x)** and **KMP (AGP 9.0+)** projects. A small subset is KMP-only (noted below).

---

## Why

Managing multiple Android/KMP projects means duplicated scripts, inconsistent patterns, and coverage blind spots. AndroidCommonDoc solves this by centralizing:

- **Scripts** that run identically on Windows (PowerShell) and macOS/Linux (Bash) -- 25 cross-platform pairs + 6 Bash-only utilities
- **AI agent skills** for Claude Code and GitHub Copilot -- 56 canonical skill definitions in `skills/`, distributed to downstream projects via registry + manifest + sync engine
- **Pattern docs** that encode architecture decisions once, reference everywhere
- **Detekt rules** that enforce architecture patterns at build time -- 19 hand-written AST-only rules covering state exposure, coroutine safety, ViewModel boundaries, KMP time safety, and navigation contracts
- **Convention plugins** for one-line Gradle adoption: `KmpLibraryConventionPlugin` (AGP 9.0+ / KMP) and `AndroidLibraryConventionPlugin` (AGP 8.x / Android-only)
- **Claude Code hooks** that catch violations in real-time during AI-assisted development
- **Coverage tooling** with auto-detection (JaCoCo or Kover — checks build files, convention plugins, and version catalogs), kover task fallback recovery, `--exclude-coverage` for test utilities, parallel execution, and gap analysis
- **MCP server** with 38 tools for programmatic validation, pattern discovery, vault sync, module health, dependency analysis, code metrics, findings reports, doc intelligence, and doc search/suggestions
- **Unified audit system** (`/full-audit`) with wave-based parallel execution, 3-pass finding deduplication, severity normalization, and resolution tracking
- **Doc monitoring** with tiered upstream source checking, review state tracking, and CI integration
- **Detekt rule generation** from pattern doc frontmatter (auto-generate Kotlin rules from documentation)
- **Reusable CI workflows** (`workflow_call`) for commit-lint, resource naming, safety checks, and architecture guards
- **20 specialized agents** with domain+intent frontmatter for extensible routing -- quality gates, release readiness, cross-platform validation, privacy auditing, unified audit orchestration, and spec-driven workflows (debugger, verifier, advisor, researcher, codebase-mapper)
- **19 agent templates** for the 3-phase team model -- project-manager, planner, quality-gater, 3 architects, context-provider, doc-updater, doc-migrator, plus business and domain specialist templates. Add a new agent with `domain:` and `intent:` frontmatter and `/work` discovers it automatically

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
| Skills | `.claude/skills/*/SKILL.md` | 53 |
| Agents | `.claude/agents/*.md` | 20 |
| Commands | `.claude/commands/*.md` | 50 |
| **Total** | | **123 entries** |

**Not synced:** scripts (invoked at runtime from L0 path), Detekt rules (consumed via JAR), docs (reference only), MCP tools (server runs from L0).

### Materialization model

Downstream projects maintain local copies of L0 skills via the **registry + manifest + sync engine**:

1. **Registry** (`skills/registry.json`) -- catalogs all 123 L0 entries with SHA-256 hashes
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

### 5. First commands to try

```
/init-session          # See what's available: agents, skills, modules, business docs
/work fix the login bug  # Smart routing — finds the right agent/skill automatically
/resume-work                # CEO dashboard — department status across your project
```

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

19 hand-written AST-only rules (no type resolution, no bindingContext) that enforce the most impactful architecture patterns at build time. Organized by category:

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

L0 ships `detekt-l0-base.yml` with all 19 rules `active: true`. The convention plugin loads both files automatically -- `detekt-l0-base.yml` as base, `config.yml` as L1 override (last file wins per key):

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

Real-time pattern enforcement and context injection during AI-assisted development:

| Hook | Trigger | What It Does |
|------|---------|-------------|
| `detekt-post-write.sh` | PostToolUse (Write/Edit) | Runs Detekt on modified `.kt` files, blocks if violations found |
| `detekt-pre-commit.sh` | PreToolUse (git commit) | Validates all staged `.kt` files before commit |
| `plan-context.js` | Plan mode entry | Injects MODULE_MAP.md contents so the agent understands project structure during planning |
| `doc-freshness-alert.js` | Session start | Warns when pattern docs are stale relative to upstream sources |
| `agent-delegation-reminder.js` | Task start | Nudges the agent to delegate to specialized agents instead of doing everything inline |
| `readme-pre-commit.sh` | PreToolUse (git commit) | Validates README counts match filesystem before commit |
| `registry-pre-commit.sh` | PreToolUse (git commit) | Validates registry.json hashes before commit |

---

## Skills Reference

53 canonical skills in `skills/`. Invoke via Claude Code (`/skill-name`) or Copilot Chat. All skills are synced to downstream projects via `/sync-l0`.

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

#### Research & Decision

| Skill | What it does |
|-------|-------------|
| `/debug` | Autonomous bug diagnosis -- logs, errors, root cause, fix, verify |
| `/research` | Deep research on a topic using multiple sources and synthesis |
| `/map-codebase` | Map codebase structure, dependencies, and architecture |
| `/verify` | Verify implementation correctness against spec or requirements |
| `/decide` | Decision framework -- pros/cons analysis with recommendation |
| `/note` | Capture structured notes and observations during work |
| `/review-pr` | Review pull request for quality, patterns, and correctness |
| `/benchmark` | Performance benchmark with per-platform Gradle config |

#### Audit & Reporting

| Skill | What it does |
|-------|-------------|
| `/audit` | Quality trend report -- coverage, Detekt, tests, CVEs. Reads existing log, zero extra runs |
| `/full-audit` | **Unified audit** -- wave-based execution, specialized agents + scripts, 3-pass dedup, consolidated report |

#### Web Development

| Skill | What it does |
|-------|-------------|
| `/accessibility` | Audit web content against WCAG guidelines |
| `/best-practices` | Validate web development best practices |
| `/core-web-vitals` | Analyze Core Web Vitals (LCP, FID, CLS) |
| `/performance` | Full web performance audit with recommendations |
| `/seo` | Validate SEO metadata, structure, and discoverability |
| `/web-quality-audit` | Comprehensive web quality audit across all dimensions |

#### Ecosystem & Workflow (Entry Points)

These three skills are the recommended way to start any session. They discover agents, skills, and project structure automatically.

| Skill | What it does |
|-------|-------------|
| `/work <task>` | **Primary entry point.** Smart task routing -- reads agent frontmatter (domain+intent), matches your task description, and delegates to the best agent or skill. Extensible: add new agents and `/work` finds them |
| `/init-session` | Project context dashboard -- lists available agents, skills, modules, business docs, and recent activity. Run this when you open a project for the first time |
| `/resume-work` | CEO/CTO session resume -- department-level status across your project (engineering, product, content). Picks up where you left off |

### L0 Maintenance Skills

Skills primarily useful when working on AndroidCommonDoc (L0) itself:

| Skill | What it does |
|-------|-------------|
| `/audit-l0` | Run coherence audit on any L0/L1/L2 layer root (doc structure, frontmatter, line limits) |
| `/doc-reorganize` | Reorganize `docs/` into domain-based subdirectories |
| `/generate-rules` | Generate Kotlin Detekt rules from pattern doc YAML frontmatter |
| `/ingest-content` | Fetch and match external content against pattern doc metadata |
| `/monitor-docs` | Monitor upstream sources for version drift -- auto-bumps `versions-manifest.json` on accept. Supports `--layer L1/L2` for consumer projects |
| `/audit-docs` | Unified doc audit — structure, coherence, upstream validation. `--with-upstream` for Wave 3 |
| `/validate-upstream` | Validate pattern docs against upstream official documentation using deterministic assertions |
| `/readme-audit` | Audit README.md against repo state -- surfaces stale counts, missing entries, and content drift |
| `/sync-gsd-agents` | Sync `.claude/agents/` to GSD subagent system and verify parity |
| `/sync-gsd-skills` | Sync skills from all sources (marketplace, L0, L0 agents) to GSD-2 |
| `/sync-vault` | Sync documentation into unified Obsidian vault |

---

## 3-Phase Team Model

Every non-trivial task flows through three sequential teams, each temporary and dissolved after its phase completes. This prevents context bloat and ensures structured verification.

```
Phase 1 — Planning Team          Phase 2 — Execution Team           Phase 3 — Quality Gate Team
┌─────────────────────┐          ┌──────────────────────────┐       ┌───────────────────────┐
│ planner              │          │ arch-testing              │       │ quality-gater          │
│ context-provider     │  ──→    │ arch-platform             │  ──→ │ context-provider       │
│                      │          │ arch-integration          │       │                        │
│ Output: exec plan    │          │ context-provider          │       │ Output: PASS / FAIL    │
└─────────────────────┘          │ doc-updater               │       └───────────────────────┘
                                 │                            │       FAIL → back to Phase 2
                                 │ PM dispatches devs on      │       (max 3 retries → user)
                                 │ demand via Agent() relay   │
                                 └──────────────────────────┘
```

**Project Manager** orchestrates all 3 phases. PM NEVER writes code — assigns to architects, who manage devs and guardians.

### Multi-Session Departments

Different work types run in separate Claude Code sessions with dedicated leads:

| Session | Command | Lead | Team |
|---------|---------|------|------|
| Development | `claude --agent project-manager` | PM | architects, devs, guardians |
| Marketing | `claude --agent marketing-lead` | ML | content-creator, landing-page-strategist |
| Product | `claude --agent product-lead` | PL | product-strategist |

All departments share context via `context-provider` and sync documentation via `doc-updater`.

### Agent Categories

| Category | Role | Examples |
|----------|------|---------|
| **Orchestrators** | Plan and delegate, NEVER code | project-manager, marketing-lead, product-lead |
| **Architects** | Verify and manage devs (Read-only + SendMessage) | arch-testing, arch-platform, arch-integration |
| **Devs** | Write code (spawned on demand as sub-agents) | test-specialist, ui-specialist, data-layer-specialist |
| **Guardians** | Read-only auditors | release-guardian, cross-platform-validator, privacy-auditor |
| **Shared Services** | Mandatory in every team | context-provider, doc-updater |
| **Sporadic** | Created on demand, dissolved after | doc-migrator, quality-gater, planner |

See [Team Topology](docs/agents/team-topology.md) for full details.

---

## Agents

20 specialized agents in `.claude/agents/` + 19 agent templates in `setup/agent-templates/`. All synced to downstream projects. Each agent declares `domain:` and `intent:` in YAML frontmatter for **extensible routing** -- `/work` dispatches tasks automatically.

### Production Agents (synced via /sync-l0)

| Agent | Category | What It Does |
|-------|----------|-------------|
| `test-specialist` | dev | Test compliance, coverage gaps, **test generation** |
| `ui-specialist` | dev | Compose accessibility, Material3 — **audits and implements fixes** |
| `api-rate-limit-auditor` | guardian | HTTP rate limiting, retry backoff, timeouts |
| `beta-readiness-agent` | guardian | Feature completeness and beta criteria |
| `cross-platform-validator` | guardian | Platform parity (Android, iOS, Desktop) |
| `doc-alignment-agent` | guardian | Documentation accuracy vs implementation |
| `privacy-auditor` | guardian | PII in logs, analytics consent, encrypted storage |
| `release-guardian-agent` | guardian | Release checklist — debug flags, secrets, ProGuard |
| `full-audit-orchestrator` | orchestrator | `/full-audit` — wave execution, 3-pass dedup |
| `quality-gate-orchestrator` | orchestrator | L0 internal quality gates (script-parity, template-sync) |
| `debugger` | spec-driven | Scientific bug investigation — `/debug` |
| `verifier` | spec-driven | Goal-backward verification — `/verify` |
| `advisor` | spec-driven | Technical decision comparison — `/decide` |
| `researcher` | spec-driven | Ad-hoc research — `/research` |
| `codebase-mapper` | spec-driven | Architecture analysis — `/map-codebase` |
| `doc-code-drift-detector` | quality-gate | Pattern doc vs `versions-manifest.json` |
| `l0-coherence-auditor` | quality-gate | L0/L1/L2 coherence (9 checks) |
| `script-parity-validator` | quality-gate | PS1 ↔ SH behavior parity |
| `skill-script-alignment` | quality-gate | Skills reference correct scripts |
| `template-sync-validator` | quality-gate | Claude commands ↔ Copilot prompts sync |

### Agent Templates (for L1/L2 projects)

19 templates in `setup/agent-templates/` — copy to your project's `.claude/agents/` and customize.

**Team Core (used in every 3-phase workflow):**

| Template | Phase | Role |
|----------|-------|------|
| `project-manager` | All | 3-phase orchestrator — NEVER codes |
| `planner` | Planning | Produces structured execution plans |
| `quality-gater` | Quality Gate | Runs sequential verification gates |
| `context-provider` | All | Read-only cross-layer context (mandatory in every team) |
| `doc-updater` | All | Updates docs, CHANGELOG, memory after work (mandatory) |
| `doc-migrator` | Sporadic | Migrates docs to L0 patterns (hubs, splits, frontmatter) |

**Architects (Execution Team peers):**

| Template | Domain |
|----------|--------|
| `arch-testing` | Test quality, TDD — manages test-specialist, ui-specialist |
| `arch-platform` | KMP patterns, deps — manages domain-model, data-layer specialists |
| `arch-integration` | Compilation, DI, nav — manages ui-specialist, data-layer |

**Business (L2 session-level leads):**

| Template | Role |
|----------|------|
| `product-lead` | Product orchestrator — specs, pricing, roadmap |
| `marketing-lead` | Marketing orchestrator — campaigns, content |
| `product-strategist` | Feature prioritization (ICE scoring) |
| `content-creator` | Developer marketing content |
| `landing-page-strategist` | Landing page copy, CTAs, SEO |

**Domain Specialists (L1/L2 customizable):**

| Template | Role |
|----------|------|
| `platform-auditor` | Cross-module architecture coherence |
| `module-lifecycle` | Module creation and deprecation checklists |
| `feature-domain-specialist` | Domain-specific auditor (customize per domain) |

### Model Tier Strategy

Switch profiles with `/set-model-profile`:

| Profile | Strategy | Use Case |
|---------|----------|----------|
| `budget` | All haiku | Quick checks, cost-conscious |
| `balanced` | Haiku static + Sonnet reasoning | Day-to-day (default) |
| `advanced` | Opus orchestrators + Sonnet validators | Serious planning |
| `quality` | All opus | Critical audits, pre-release |

---

## Business Layer

L2 projects can bootstrap business documentation using 5 templates in `setup/doc-templates/business/`:

| Template | Purpose |
|----------|---------|
| `PRODUCT_SPEC.md` | Product specification with user stories and acceptance criteria |
| `MARKETING.md` | Marketing strategy, positioning, and messaging |
| `PRICING.md` | Pricing model, tiers, and competitive positioning |
| `COMPETITIVE.md` | Competitive analysis matrix |
| `LANDING_PAGES.md` | Landing page structure and conversion funnel |

These templates pair with the business agent templates (product-strategist, content-creator, landing-page-strategist) to give AI agents structured context about your product when working on user-facing features.

---

## MODULE_MAP.md Pattern

Each L1/L2 project should maintain a `MODULE_MAP.md` at its root -- a concise map of modules, their responsibilities, and key files. The `plan-context` hook automatically injects MODULE_MAP.md contents when Claude Code enters plan mode, giving the agent architectural awareness before it starts planning.

```markdown
# MODULE_MAP.md (example)
## core:domain
- Purpose: Business logic use cases
- Key files: src/commonMain/kotlin/usecases/
- Dependencies: core:model, core:error

## feature:login
- Purpose: Login/auth UI + ViewModel
- Key files: src/commonMain/kotlin/login/
- Dependencies: core:domain, core:network
```

This eliminates the "agent explores for 5 minutes before planning" problem. The hook is zero-cost when MODULE_MAP.md doesn't exist.

---

## MCP Server

38 tools with shared rate limiting (45 calls/min). Start with `cd mcp-server && npm start`.

**24 tools** work in any project. **14 tools** are for AndroidCommonDoc development (doc intelligence, vault sync, toolkit validation).

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
| `rate-limit-status` | Utility | Show current MCP rate-limit counters and reset time |
| `search-docs` | Doc Intelligence | Full-text search across pattern docs and guides |
| `suggest-docs` | Doc Intelligence | Suggest relevant docs for a given topic or error message |

### L0 Internal Tools (for AndroidCommonDoc development)

These tools operate on AndroidCommonDoc's own documentation, vault, and toolkit structure.

| Tool | Category | What It Does |
|------|----------|-------------|
| `check-freshness` | Monitoring | Alias for monitor-sources (backward compatible) |
| `generate-detekt-rules` | Generation | Generate Kotlin Detekt rules from pattern doc frontmatter |
| `ingest-content` | Ingestion | Fetch and analyze external content against pattern metadata |
| `l0-diff` | Sync | Compare L0 registry vs downstream manifest to preview sync delta |
| `monitor-sources` | Monitoring | Check upstream sources for version changes and deprecations (`--layer L0/L1/L2`) |
| `audit-docs` | Documentation | Unified doc audit — structure, coherence, upstream (3 waves) |
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

24 cross-platform script pairs in `scripts/ps1/` (Windows) and `scripts/sh/` (macOS/Linux), plus 7 Bash-only utilities (`check-agent-parity`, `check-detekt-coverage`, `copilot-parity`, `install-git-hooks`, `rehash-registry`, `run-benchmarks`, `validate-agent-templates`).

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
| `copilot-parity` | Verify Copilot prompt templates match Claude skill definitions |
| `install-git-hooks` | Install pre-commit (pattern-lint) + commit-msg (conventional commits) git hooks |
| `run-benchmarks` | Detect and run JVM/Android benchmark suites with Gradle |
| `validate-agent-templates` | Lint agent templates: frontmatter, role keywords, anti-patterns, versioning (7 checks) |

### Shared Libraries

| Library | Location | Purpose |
|---------|----------|---------|
| `audit-append` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Append events to `audit-log.jsonl` |
| `findings-append` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Append findings to `findings-log.jsonl` |
| `coverage-detect` | `scripts/sh/lib/`, `scripts/ps1/lib/` | Auto-detect JaCoCo vs Kover per module — checks build file, report dirs, root buildscript, build-logic convention plugins, and gradle/libs.versions.toml. Provides task name resolution with kover variant fallbacks. |
| `script-utils` | `scripts/sh/lib/` | Common shell utilities: `glob_match`, `get_project_type`, `format_line_ranges`, `safe_rg` (cross-platform ripgrep with find+grep fallback on Windows) |

---

## Documentation

15 domain hubs, 88+ sub-docs, 16 guides, 12 agent workflow docs -- all with YAML frontmatter for registry scanning, upstream monitoring, and Detekt rule generation. 19 approved categories including `api` for auto-generated API docs.

### Doc Integrity System

4-layer system ensuring documentation quality, code-doc alignment, and zero duplication:

```
Layer 0: MIGRATION (/kdoc-migrate)
  Brings existing projects from 0% → baseline KDoc coverage
  Module-by-module, pattern-informed — no stubs

Layer 0.5: PUBLICATION (Dokka pipeline, optional)
  KDoc in .kt → Dokka → transformer → docs/api/ with frontmatter
  Makes KDoc searchable by context-provider and search-docs

Layer 1: PREVENTION (doc-updater smart protocol)
  Pre-write validation via validate-doc-update MCP tool
  Duplicate detection (Jaccard similarity), anti-pattern filter,
  size limit pre-check, context-provider cross-doc coherence

Layer 2: MEASUREMENT (kdoc-coverage MCP tool)
  Public API scanning → coverage % per module
  Changed-file focus for quality gate, baselines in audit-log.jsonl

Layer 3: ENFORCEMENT (quality gate Step 0.5)
  BLOCK if new public APIs lack KDoc
  WARN if module coverage < 80%
  check-doc-patterns detects Detekt rule candidates
```

**MCP tools** (3 new):
| Tool | Purpose |
|------|---------|
| `kdoc-coverage` | Measure KDoc coverage on public Kotlin APIs |
| `validate-doc-update` | Pre-write validation: duplicates, anti-patterns, coherence, size |
| `check-doc-patterns` | Detect enforceable patterns without Detekt rules, rule drift |

**Skills** (3 new):
| Skill | Purpose |
|-------|---------|
| `/kdoc-audit` | Audit KDoc coverage, regressions, undocumented APIs |
| `/kdoc-migrate` | Full-project KDoc migration, module by module |
| `/generate-api-docs` | Optional: Dokka + transformer → docs/api/ |

**Quality gate steps** (doc-related):
| Step | What | Action |
|------|------|--------|
| 0 | Frontmatter validation | BLOCK if docs/ missing required fields |
| 0.5 | KDoc coverage | BLOCK if new public APIs lack KDoc, WARN if module < 80% |
| 4.5 | Production file verification | BLOCK if dev task was "fix code" but only test files changed |

**Agent behavioral enforcement**:
- **Architects**: TRIVIAL/NON-TRIVIAL threshold table — max 1-2 line edits (import/annotation). KDoc, tests, DI = delegate to dev via PM.
- **Devs**: dispatch prompt rule (4) — "MUST modify production files, test-only = REJECTED". Reports modified files in final message.
- **doc-updater**: pre-write validation via `validate-doc-update` MCP tool. Rejects duplicates (Jaccard > 70%), anti-patterns, oversized docs. Communicates with context-provider before writing.

**Remediation flows**: missing KDoc → quality gate FAIL → PM re-enters Phase 2 → architect routes to dev specialist → dev adds pattern-informed KDoc → quality gate re-runs. doc-updater rejects duplicates/anti-patterns back to PM. Generated docs (`docs/api/`) protected from manual edits via `generated: true` frontmatter.

**Dokka pipeline** (optional): `scripts/sh/dokka-to-docs.sh` transforms Dokka Markdown → `docs/api/` with YAML frontmatter. Exits gracefully if Dokka not configured. Convention plugin template in `setup/templates/build-logic/`.

### Doc Hubs

| Hub | Covers | Platform |
|-----|--------|----------|
| [Architecture](docs/architecture/architecture-hub.md) | Source set hierarchy, expect/actual, module naming | KMP |
| [Archive](docs/archive/archive-hub.md) | Superseded proposals and deprecated patterns | -- |
| [Compose](docs/compose/compose-hub.md) | Multi-module resource management in CMP | KMP |
| [DI](docs/di/di-hub.md) | Koin module declarations, test configuration | Android + KMP |
| [Error Handling](docs/error-handling/error-handling-hub.md) | Result type, DomainException hierarchy, CancellationException | Android + KMP |
| [Gradle](docs/gradle/gradle-hub.md) | Convention plugins (KMP + Android-only), version catalogs, Kover | Android + KMP |
| [Agents](docs/agents/agents-hub.md) | 3-phase team model, multi-agent patterns, team topology, data handoff, quality gate protocol, agent consumption | All |
| [Guides](docs/guides/guides-hub.md) | Getting started, Detekt config/migration/baseline, convention plugin chain, doc template | Android + KMP |
| [Navigation](docs/navigation/navigation-hub.md) | Navigation3, state-driven nav, deep links | Android + KMP |
| [Offline-First](docs/offline-first/offline-first-hub.md) | Local-first data, sync strategies, conflict resolution | Android + KMP |
| [Resources](docs/resources/resources-hub.md) | Memory, lifecycle, and platform resource handling | Android + KMP |
| [Security](docs/security/security-hub.md) | Encryption, key management, biometric auth, platform crypto | Android + KMP |
| [Storage](docs/storage/storage-hub.md) | Key-value, relational, secure, cache — thin module architecture | Android + KMP |
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
                   |  | SKILL.md |    | (123 entries,    |   |
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
                   |  | (19 rules)   |    | plugin        |  |
                   |  +--------------+    +---------------+  |
                   +-----------------------------------------+
```

---

## Project Structure

```
AndroidCommonDoc/
+-- .claude/
|   +-- commands/           # 50 Claude Code slash commands
|   +-- agents/             # 20 specialized agents
|   +-- hooks/              # Real-time Detekt enforcement hooks
|   +-- model-profiles.json # Agent model tier config (budget/balanced/advanced/quality)
+-- skills/
|   +-- */SKILL.md          # 56 canonical skill definitions
|   +-- registry.json       # L0 registry (123 entries, SHA-256 hashes)
|   +-- params.json         # Parameter manifest
|   +-- params.schema.json  # JSON Schema for parameter validation
+-- scripts/
|   +-- ps1/                # PowerShell (Windows) -- 24 scripts
|   +-- sh/                 # Bash (macOS/Linux) -- 32 scripts (25 cross-platform + 7 utilities)
|   |   +-- lib/            # Shared libraries (audit-append, findings-append, coverage-detect, script-utils)
|   +-- lib/                # Shared Python tools (parse-coverage-xml.py)
|   +-- tests/              # bats shell test suite (567 tests, 4 fixture XMLs)
+-- mcp-server/             # MCP server (34 tools, 3 prompts, dynamic resources)
|   +-- src/
|   |   +-- tools/          # 38 tools: validation, analysis, metrics, audit, sync, vault, doc integrity
|   |   +-- types/          # Shared types (ValidationResult, AuditFinding, FindingsReport)
|   |   +-- utils/          # Utilities (rate-limiter, jsonl-reader, gradle-parser, xml-report-reader, finding-dedup, logger, doc-scoring)
|   |   +-- generation/     # Detekt rule parser, emitters, config-emitter
|   |   +-- registry/       # Pattern registry: scanner, resolver, frontmatter
|   |   +-- vault/          # Obsidian vault sync engine
|   |   +-- cli/            # CLI entrypoint for CI monitoring
|   +-- tests/              # 95 test files -- vitest unit + integration (1482 tests)
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
|   +-- agent-templates/    # 17 agent templates: PM, planner, quality-gater, 3 architects, context-provider, doc-updater, doc-migrator, business leads, domain specialists
|   +-- doc-templates/
|   |   +-- business/       # 5 business doc templates (PRODUCT_SPEC, MARKETING, PRICING, COMPETITIVE, LANDING_PAGES)
|   +-- github-workflows/   # CI template + PR template for consumer projects
|   +-- templates/
|   |   +-- workflows/
|   |   |   +-- l0-auto-sync.yml  # Downstream auto-sync workflow template
|   |   |   +-- release.yml       # Git Flow + Conventional Commits release template
|   |   +-- build-logic/
|   |       +-- dokka-convention.gradle.kts.template  # Optional Dokka convention plugin for KDoc → docs/api/
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
+-- docs/                   # 15 hub docs, 88+ sub-docs, 16 guides, 12 agent workflow docs
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
