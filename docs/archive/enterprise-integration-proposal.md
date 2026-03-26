---
scope: [enterprise, integration, proposal]
sources: [androidcommondoc, ci-cd, detekt, copilot, claude-code]
targets: [android, kmp]
version: 2
last_updated: "2026-03"
description: "Enterprise adoption catalog for AndroidCommonDoc — modular, pick what you need. Each module is independent: Detekt rules, CI workflows, agents, Copilot instructions, coverage dashboards, pattern docs."
slug: enterprise-integration
status: archived
layer: L0
category: archive
---

# AndroidCommonDoc — Enterprise Adoption Catalog

This is NOT an all-or-nothing package. Each module below is **independently adoptable**. Pick what solves your team's problem — ignore the rest.

## How to Use This Document

1. Read the [Module Catalog](#module-catalog) — each module has: what it is, what it requires, what it gives you
2. Check the [Dependency Map](#module-dependency-map) — some modules work better together but none are required
3. Start with the [Quick Wins](#recommended-starting-points) for immediate value
4. For management visibility, see [Coverage Dashboard for Stakeholders](#module-7-coverage-dashboard-for-stakeholders)

## Fork Strategy

```
Option A: Full fork (internal GitHub/GitLab)
  → Clone entire repo, remove what you don't need
  → Pro: everything available, easy to explore
  → Con: maintenance burden on unused parts

Option B: Cherry-pick modules (recommended)
  → Copy only the directories you chose from the catalog
  → Pro: minimal footprint, clear ownership
  → Con: manual updates when L0 evolves

Option C: Git subtree / submodule
  → Reference L0 as subtree in your project
  → Pro: upstream updates via git pull
  → Con: requires Git expertise, may conflict with corporate Git policies
```

---

## Module Catalog

### Module 1: Detekt Architecture Rules

**What:** 19 custom Detekt rules that enforce architecture patterns at compile time. Catches sealed-interface violations, CancellationException swallowing, hardcoded credentials, forbidden imports in commonMain, and more.

**Requires:** Detekt 2.x in your Gradle build. No other L0 dependency.

**You get:**
- Violations caught in IDE (real-time) and CI (PR gate)
- Zero manual review for architecture pattern violations
- Rules configurable per-project via `detekt.yml`

**Install:**
```kotlin
// Copy detekt-rules/ to your project, or publish as Maven artifact
dependencies {
    detektPlugins(project(":detekt-rules"))
}
```

**Works without:** Everything else. Pure Gradle plugin — no agents, no MCP, no docs needed.

**Best for:** Any team that wants automated architecture enforcement. Works with any CI system.

---

### Module 2: CI Workflows (GitHub Actions)

**What:** 14 reusable GitHub Actions workflows — commit linting, README audit, Detekt checks, agent parity, coverage reporting, doc monitoring, KMP safety checks.

**Requires:** GitHub Actions. Some workflows reference L0 scripts.

**You get:**
- PR gate: commit-lint, pattern-lint, Detekt, README count validation
- Weekly: doc source monitoring, upstream validation
- On-demand: full audit, coverage suite

**Key workflows:**
| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `l0-ci.yml` | Push/PR | MCP tests, Detekt, bats, README audit, registry integrity |
| `doc-audit.yml` | Weekly cron | Doc structure + coherence + upstream validation |
| `reusable-commit-lint.yml` | PR | Conventional Commits enforcement |
| `reusable-kmp-safety-check.yml` | PR | Forbidden imports in commonMain |

**Install:** Copy `.github/workflows/` files. Adjust paths if your project structure differs.

**Works without:** Agents, MCP server, pattern docs. Only needs the scripts they call.

**Best for:** Teams already on GitHub Actions that want standardized PR gates.

---

### Module 3: AI Agent System (Claude Code)

**What:** 20 specialized agents + 5 templates for multi-agent development. Dev-lead orchestrates, specialists (test, UI, security, release) execute domain-specific tasks.

**Requires:** Claude Code (Anthropic). Agents are `.md` files in `.claude/agents/`.

**You get:**
- `dev-lead`: plans, delegates to specialists, never does parallel work itself
- `test-specialist`: writes tests, enforces quality-over-coverage, mandatory e2e
- `ui-specialist`: Compose accessibility, previews, hardcoded strings
- `release-guardian`: pre-release safety scan (debug flags, secrets, dev URLs)
- `full-audit-orchestrator`: runs specialized agents in waves with dedup

**Install:** Copy `.claude/agents/` and `.claude/settings.json` to your project. Customize the dev-lead with your module map.

**Works without:** MCP server, CI workflows, Detekt rules. Agents work standalone.

**Best for:** Teams using Claude Code that want structured multi-agent workflows.

---

### Module 4: Copilot Instructions + Adapter

**What:** GitHub Copilot custom instructions generated from L0 patterns. Copilot adapter converts Claude agent definitions to Copilot-compatible prompts.

**Requires:** GitHub Copilot Enterprise or Individual.

**You get:**
- `.github/copilot-instructions.md` with architecture conventions
- Copilot suggestions aligned with team patterns (sealed UiState, Result type, etc.)
- Adapter script: `adapters/copilot-agent-adapter.sh` converts agent `.md` to Copilot prompts

**Install:** Run `bash adapters/generate-all.sh` to generate Copilot files from your agents.

**Works without:** Claude Code, MCP server, CI. Pure Copilot enhancement.

**Best for:** Teams on Copilot that want convention-aware suggestions without switching to Claude.

---

### Module 5: Pattern Documentation (97 docs)

**What:** 15 domain hubs, 88+ sub-docs, 16 guides, 8 agent workflow docs — all with YAML frontmatter for tooling integration. Covers ViewModel, Compose, Navigation, Testing, DI, Offline-first, Security, Storage, KMP architecture.

**Requires:** Nothing. Markdown files readable by anyone.

**You get:**
- Architecture patterns with code examples
- Anti-patterns with explanations
- `validate_upstream` assertions that verify patterns match official docs
- Frontmatter enables: Detekt rule generation, upstream monitoring, registry scanning

**Install:** Copy `docs/` directory. Customize patterns for your project.

**Works without:** Everything else. Docs are standalone knowledge.

**Best for:** Any team that wants documented, searchable architecture standards.

---

### Module 6: MCP Server (32 tools)

**What:** Model Context Protocol server with 32 tools for programmatic validation — pattern discovery, module health, dependency graphs, code metrics, doc validation, coverage analysis, vault sync.

**Requires:** Node.js 24+. MCP-compatible AI tool (Claude Desktop, Claude Code).

**You get:**
- `audit-docs`: 3-wave doc validation (structure, coherence, upstream)
- `monitor-sources`: upstream version drift detection
- `validate-doc-structure`: hub sizes, frontmatter, naming
- `generate-detekt-rules`: emit Kotlin rules from doc frontmatter
- `module-health`: test count, coverage, complexity per module
- 27 more tools for analysis and validation

**Install:** `cd mcp-server && npm install && npm run build`. Connect via Claude Desktop config or CLI.

**Works without:** Agents, CI, Copilot. CLI tools work standalone.

**Best for:** Teams that want programmatic access to validation tools. Powers CI and agent workflows.

---

### Module 7: Coverage Dashboard for Stakeholders

**What:** CI pipeline that generates coverage history, stores it as artifacts, and feeds a dashboard visible to non-technical stakeholders.

**Requires:** GitHub Actions + a visualization tool (Power BI, Grafana, or simple HTML).

**Architecture:**
```
CI (each PR/merge)                    Dashboard (weekly)
┌──────────────────────┐              ┌──────────────────────┐
│ ./gradlew koverXml   │              │ Power BI / Grafana   │
│         ↓            │              │                      │
│ Parse XML reports    │──artifacts──▶│ Coverage trends      │
│         ↓            │              │ Module breakdown     │
│ Append to            │              │ Risk heatmap         │
│ coverage-history.json│              │ Sprint-over-sprint   │
└──────────────────────┘              └──────────────────────┘
```

**CI generates (per run):**
```json
{
  "timestamp": "2026-03-23T12:00:00Z",
  "commit": "abc1234",
  "branch": "develop",
  "overall": 87.3,
  "modules": {
    "core:model": 98.2,
    "core:domain": 100.0,
    "core:data": 97.1,
    "feature:settings": 82.4
  }
}
```

**Dashboard shows (for management):**
- Overall coverage trend (line chart, sprint boundaries)
- Module breakdown (bar chart, color-coded: green >95%, yellow >80%, red <80%)
- Risk modules (table: lowest coverage, most churn, fewest tests)
- Sprint delta ("+2.3% this sprint, 3 modules improved, 1 regressed")

**Install:**
1. Add coverage reporting to CI (Kover for KMP, JaCoCo for Android-only)
2. Script to parse XML → JSON history (L0 has `scripts/sh/run-parallel-coverage-suite.sh`)
3. Store `coverage-history.json` as CI artifact or push to a data repo
4. Connect Power BI/Grafana to the JSON endpoint

**Works without:** Agents, MCP, docs. Pure CI + data pipeline.

**Best for:** Teams whose management wants visibility into code quality trends without reading code.

---

### Module 8: Shell Scripts (28 scripts)

**What:** Cross-platform Bash scripts for testing, coverage, pattern linting, registry management, git hooks. Battle-tested on Windows (MSYS2) and Linux (CI).

**Requires:** Bash. Some scripts need `jq`, `python3`, or `node`.

**Key scripts:**
| Script | What |
|--------|------|
| `run-parallel-coverage-suite.sh` | Parallel Kover coverage with batch recovery |
| `pattern-lint.sh` | 8 anti-pattern checks (CancellationException, println, etc.) |
| `readme-audit.sh` | 13 README consistency checks |
| `install-git-hooks.sh` | Pre-commit (pattern-lint) + commit-msg (conventional commits) |
| `verify-kmp-packages.sh` | Forbidden imports in KMP source sets |

**Works without:** Everything else. Scripts are standalone.

---

## Module Dependency Map

```
Independent (no deps):          Enhanced together:
┌─────────────────────┐        ┌─────────────────────────────┐
│ Module 1: Detekt    │        │ Module 3 (Agents)           │
│ Module 5: Docs      │        │   ↕ uses                    │
│ Module 8: Scripts   │        │ Module 6 (MCP) ← Module 2   │
│ Module 4: Copilot   │        │   ↕ feeds          (CI)     │
│ Module 7: Dashboard │        │ Module 7 (Dashboard)        │
└─────────────────────┘        └─────────────────────────────┘
```

No module requires another. But agents (3) work better with MCP tools (6), which power CI workflows (2), which feed the coverage dashboard (7).

## Recommended Starting Points

| Team situation | Start with | Next |
|----------------|-----------|------|
| "We have no standards" | Module 5 (docs) + Module 1 (Detekt) | Module 8 (scripts) |
| "PRs have no gates" | Module 2 (CI) + Module 1 (Detekt) | Module 7 (dashboard) |
| "We use Claude Code" | Module 3 (agents) + Module 6 (MCP) | Module 2 (CI) |
| "We use Copilot" | Module 4 (Copilot) + Module 5 (docs) | Module 1 (Detekt) |
| "Management wants metrics" | Module 7 (dashboard) + Module 2 (CI) | Module 1 (Detekt) |
| "We want everything" | Fork (Option A), enable progressively | — |

## Security Considerations (Banking/Enterprise)

| Module | Data exposure | Needs approval? |
|--------|--------------|----------------|
| 1. Detekt rules | None — runs locally + CI | No — Gradle plugin, no network |
| 2. CI workflows | GitHub Actions (already approved) | No — uses existing infra |
| 3. Agents | Claude Code — code sent to Anthropic API | **Yes** — LLM with source code |
| 4. Copilot | Copilot Enterprise — code stays in tenant | Check existing Copilot policy |
| 5. Docs | None — static Markdown | No |
| 6. MCP server | Local Node.js process, no external calls | No — unless upstream validation (Jina) |
| 7. Dashboard | Coverage data only (no source code) | No — numerical metrics only |
| 8. Scripts | Local execution | No |

**Module 3 (Agents) and Module 6 with upstream validation are the only modules that send data externally.** Everything else runs locally or within existing corporate infrastructure.
