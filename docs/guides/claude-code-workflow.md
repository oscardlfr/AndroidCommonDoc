---
scope: [workflow, ai-agents, skills]
sources: [anthropic-claude-code]
targets: [all]
slug: claude-code-workflow
status: active
layer: L0
parent: guides-hub
category: guides
description: "Generic Claude Code workflow patterns for KMP projects using skills, agents, and the GSD framework"
version: "1.0"
last_updated: "2026-03-16"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
assumes_read: guides-hub
token_budget: 1958
---

# Claude Code Workflow & Skill System

> How to manage KMP projects using AI-powered automation with Claude Code.

## Core Concepts

### Skills (Slash Commands)

Skills are custom prompts invoked with `/command-name`. Stored as markdown files in `.claude/commands/`, they define step-by-step instructions that Claude follows exactly. Think of them as deterministic scripts where the runtime is an AI agent that reads files, writes code, runs tests, and makes git commits.

### Specialized Agents

Agents are autonomous sub-processes spawned for focused tasks. Each agent has specific tools and domain knowledge. Agents are defined in `.claude/agents/` and can run in parallel when tasks are independent.

### GSD (Get Stuff Done)

GSD is a structured workflow framework that organizes work into **milestones > phases > plans > tasks**. It manages state across sessions, tracks progress, and coordinates parallel execution. Key files live in `.planning/`.

## The Three Layers

```
IDEATION       /brainstorm > /prioritize         Ideas enter the system
PLANNING       /gsd:plan-phase > PLAN.md         Ideas become executable plans
EXECUTION      /gsd:execute-phase > code         Plans become tested, committed code
```

## Idea-to-Code Pipeline

### Step 1 -- Capture: `/brainstorm`

Parses raw text into classified ideas. Validates technical feasibility against the architecture. Routes each idea to the correct documentation file with approval gates.

Key properties: technical gatekeeper (not passive transcriber), approval required, idempotent.

### Step 2 -- Prioritize: `/prioritize`

Classifies ideas by priority tier (P0-P3), routes to roadmap phases, validates against architecture constraints. Conservative by default (P2 over P1 when uncertain).

### Step 3 -- Sync: `/sync-roadmap`

Bridges the roadmap (docs) and GSD (execution) by creating directory scaffolding for phases that exist in ROADMAP.md but not on disk. Read-only on the roadmap, idempotent.

### Step 4 -- Plan: `/gsd:plan-phase`

Creates detailed PLAN.md files organized into waves for parallel execution. Each plan specifies tasks, files, acceptance criteria, and dependencies.

### Step 5 -- Execute: `/gsd:execute-phase`

Executes plans in wave order with atomic commits per task. Manages state for pause/resume across sessions.

### Step 6 -- Verify & Merge

- `/pre-release` -- Pre-release validation checklist
- `/merge-track` -- Lead-only squash merge of completed tracks

## Skill Reference by Category

### Brainstorm & Planning

| Skill | Purpose |
|-------|---------|
| `/brainstorm` | Parse raw ideas, classify, validate feasibility, route to docs |
| `/prioritize` | Assign priority tiers (P0-P3), route to roadmap phases |
| `/metrics` | Project health dashboard |

### Run / Build / Deploy

| Skill | Purpose |
|-------|---------|
| `/run` | Build, install, and run the app |
| `/package` | Build distribution packages (MSI, DMG, DEB) |

### Testing

| Skill | Purpose |
|-------|---------|
| `/test` | Run tests with smart retry |
| `/test-changed` | Only test modules with uncommitted changes |
| `/test-full` | Run ALL tests with full coverage report |
| `/test-full-parallel` | Parallelized full test suite |
| `/android-test` | Android instrumented tests |
| `/unlock-tests` | Kill stuck Gradle workers and release file locks |
| `/auto-cover` | Auto-generate tests for coverage gaps |
| `/coverage` | Analyze test coverage gaps |
| `/coverage-full` | Complete coverage report |

### Code Quality & Validation

| Skill | Purpose |
|-------|---------|
| `/verify-kmp` | Validate KMP source set rules |
| `/verify-migrations` | Validate database schema integrity |
| `/validate-patterns` | Validate code against documented patterns |
| `/feature-audit` | Audit incomplete features visible in UI |
| `/extract-errors` | Extract and summarize build/test errors |

### Documentation & Versioning

| Skill | Purpose |
|-------|---------|
| `/doc-check` | Validate documentation is in sync with code |
| `/doc-update` | Update documentation from code changes |
| `/changelog` | Generate changelog from git history |
| `/bump-version` | Bump application version |
| `/sync-tech-versions` | Sync doc versions with version catalog |
| `/sync-versions` | Check version alignment across projects |

### Release & Security

| Skill | Purpose |
|-------|---------|
| `/pre-release` | Full pre-release validation checklist |
| `/sbom` | Generate Software Bill of Materials |
| `/sbom-analyze` | Analyze SBOM dependencies |
| `/sbom-scan` | Scan SBOM for known vulnerabilities |

## Agent Reference

### Quality & Architecture

| Agent | What It Validates |
|-------|-------------------|
| `cross-platform-validator` | Feature parity across platforms |
| `ui-specialist` | Compose UI: Material3, design system, accessibility |
| `test-specialist` | Test patterns, coverage gaps |

### Security & Release

| Agent | What It Catches |
|-------|-----------------|
| `release-guardian-agent` | Debug flags, dev URLs, secrets, disabled security |
| `beta-readiness-agent` | Deep audit: features tested, gates enforced, crash safety |

### Documentation

| Agent | What It Does |
|-------|--------------|
| `doc-alignment-agent` | Detects drift between code and documentation |

## GSD Workflow

### Hierarchy

```
Project (PROJECT.md)
  > Milestone (version target)
    > Phase (focused scope)
      > Plan (PLAN.md -- atomic unit of work)
        > Tasks (code changes, tests, commits)
```

### Phase Lifecycle

```
/gsd:discuss-phase    >  Gather context
/gsd:plan-phase       >  Create PLAN.md files
/gsd:execute-phase    >  Execute plans with atomic commits
/gsd:verify-work      >  Validate features
```

### Session Management

| Command | When |
|---------|------|
| `/gsd:progress` | "Where am I? What's next?" |
| `/gsd:pause-work` | Create context handoff |
| `/gsd:resume-work` | Restore context from previous session |

## Parallel Execution: Wave System

Parallel tracks use isolated git worktrees with separate branches. Tracks run in parallel because they touch different modules.

### Track Lifecycle

| Command | Who | Purpose |
|---------|-----|---------|
| `/start-track` | Lead | Create worktree + branch |
| `/gsd:execute-phase` | Agent | Execute plans in worktree |
| `/pre-release` | Lead | Validate before merge |
| `/merge-track` | Lead only | Squash-merge, cleanup |

### Rules

- Each track has strict **module ownership**
- Only the lead squash-merges -- agents never merge directly
- Tracks sharing modules require lead coordination
- `.claude/worktrees/` is gitignored

## Context Management

### Token Budget

Keep initial context load under 4000 tokens. CLAUDE.md should be under 150 lines. Reference detailed docs on demand rather than including everything upfront.

### Skill Design Principles

1. **Step-by-step** -- numbered steps Claude follows exactly
2. **Approval gates** -- never modify without user confirmation
3. **Idempotent** -- safe to run repeatedly
4. **Read-only by default** -- require explicit flags for writes
5. **$ARGUMENTS** -- use Claude Code's native variable expansion for inputs
6. **Structured output** -- consistent report formats across skills

### Agent Design Principles

1. **Focused scope** -- one domain per agent
2. **Read-only tools** -- agents report, they don't fix (unless explicitly designed to)
3. **Parameterized references** -- use `$PROJECT_ROOT` and `{placeholder}` for paths
4. **L0 generic** -- project-specific overrides via L2 agents
