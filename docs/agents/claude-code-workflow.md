---
scope: [workflow, claude-code, agents, skills]
sources: [anthropic-claude-code]
targets: [all]
slug: claude-code-workflow
status: active
layer: L0
parent: agents-hub
category: agents
description: "How to work with Claude Code in the L0/L1/L2 ecosystem: project-manager workflow, agent delegation, skills, verification"
version: "2.0.0"
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
assumes_read: guides-hub
token_budget: 2500
---

# Claude Code Workflow

How development works across the L0/L1/L2 ecosystem with Claude Code, specialized agents, and L0 skills.

## The Project Manager Model

Every L1/L2 project has a `project-manager` agent as the primary workflow coordinator. PM NEVER writes code — all code is written by dev specialists.

| Task size | project-manager behavior |
|-----------|--------------------------|
| **Simple** (bug fix, 1 file) | Assigns to dev specialist, reviews result, runs tests |
| **Medium** (feature, 1-3 files) | Assigns code to dev specialist, delegates audits to domain specialists |
| **Large** (5+ files, multi-step) | Orchestrates waves — assigns code to dev specialists, audits to domain specialists |
| **Long session** (3+ features) | Always orchestrates — delegates everything, manages flow only |

### Escalation Rules

project-manager is autonomous on technical decisions. It escalates to the user for:
- **Business decisions** — feature scope, tier assignment, pricing
- **API contract changes** — breaking changes to shared libraries
- **Architectural shifts** — new modules, new patterns, dependency additions

## Agent Delegation

Agents live in `.claude/agents/` (canonical). Claude Code invokes them natively via the `Agent` tool. GSD/pi users also need `.gsd/agents/` mirrors (synced via `/sync-gsd-agents`).

### Invocation

```
delegate to daw-guardian: "Audit changed files in core/data/ for ProcessingMode violations"
```

### When to Delegate vs Inline

| Signal | Action |
|--------|--------|
| Domain-specific audit (DAW safety, API purity, feature gates) | **Always delegate** — specialist knows the rules |
| Code review after implementation | **Delegate** to test-specialist or relevant domain agent |
| Parallel implementation (a11y across modules, test generation) | **Delegate to specialists with Write** — NOT multiple PM copies |
| Writing code for any change | **Delegate to dev specialist** — PM never writes code |
| Running tests, linting, coverage | **Use L0 skills** (`/test`, `/pre-pr`) — not agents |
| Cross-cutting concern (privacy, release readiness) | **Delegate** — specialist scans holistically |
| After any wave of specialist work | **Architect gate** — arch-testing + arch-platform + arch-integration detect, fix, and cross-verify before proceeding |
| Official skill available for the task | **Use skill** — battle-tested and maintained upstream |

### Agent Tool Only (non-negotiable)

All delegation uses the `Agent` tool. Never spawn agents via Bash + `claude` CLI:
- CORRECT: `Agent(project-manager, prompt="implement feature X")`
- WRONG: `Bash("claude --print 'You are project-manager...'")`

### Token Economics

Every agent pays a startup tax (~3-5K tokens for instructions + file reading). Delegation saves tokens only when:
1. It **prevents context growth** in the main window (long sessions)
2. It **runs in parallel** (fan-out to multiple specialists)
3. The specialist **knows things the project-manager doesn't** (domain rules, patterns)

Rule of thumb: if the task is < 5K tokens of work, do it inline.

## L0 Skills — Token-Efficient Operations

Skills wrap cross-platform scripts. They save 10-50x tokens vs having the agent do the same work manually.

| Instead of... | Use |
|--------------|-----|
| Agent reads 200 lines of Gradle output | `/test <module>` — structured summary |
| Agent greps for anti-patterns | `/validate-patterns` — script checks 8 patterns for free |
| Agent manually checks coverage XML | `/coverage` — markdown report |
| Agent runs commit-lint + resources + konsist manually | `/pre-pr` — one command, all gates |

### Core Skills

| Skill | What | When |
|-------|------|------|
| `/test <module>` | Single module test with retry | After code changes |
| `/test-changed` | Only modules with uncommitted changes | Quick pre-commit check |
| `/test-full-parallel` | All modules parallel + coverage | Full validation |
| `/pre-pr` | commit-lint + resources + konsist + tests | Before every PR |
| `/coverage` | Gap analysis from existing data | Find untested code |
| `/auto-cover` | Generate tests for gaps | Increase coverage |
| `/extract-errors` | Structured errors from Gradle output | When builds fail |
| `/verify-kmp` | Source set and import validation | KMP architecture check |
| `/validate-patterns` | ViewModel/UI pattern compliance | Code quality |
| `/bump-version` | Semver bump + CHANGELOG update | Release prep |
| `/changelog` | Generate release notes from git log | Release documentation |
| `/git-flow` | Branch management (start/finish/release) | Git workflow |
| `/readme-audit` | Audit README against filesystem reality | Before milestone close |

## CLAUDE.md — The Entry Point

CLAUDE.md drives the entire workflow. It follows the [Boris Cherny template](claude-md-template.md):

```
## Workflow Orchestration
  ### 1. Plan Mode Default      ← when to stop and think
  ### 2. Agent Delegation       ← agent roster + invocation examples
  ### 3. Verification Before Done ← project-specific verification rules
  ### 4. Autonomous Execution    ← just fix it, use skills

## Project Constraints           ← hard rules (3-5 one-liners)
## Commands                      ← skill shortcuts
## Doc Consultation              ← what to read before touching each area
```

Without the Agent Roster in CLAUDE.md, Claude Code uses generic agents (`Explore`, `Plan`, `Code`) instead of your domain specialists.

## Verification Before Done

Every task type has a verification pattern:

| Task type | Verification |
|-----------|-------------|
| Bug fix | Failing test first → fix → test passes → architect gate → `/pre-pr` |
| Feature | Code → `/test <module>` → delegate audit to specialist → architect gate → `/pre-pr` |
| Refactor | `/test-full-parallel` → no regressions |
| Release | `/pre-release --quick` → `/bump-version` → `/git-flow release` |
| UI change | Verify in browser/app → delegate to `ui-specialist` |
| DAW-related | Test SILENT mode → delegate to `daw-guardian` |

Work is done when verification passes, not when code compiles.

## The Three Layers

```
L0 (AndroidCommonDoc)          L1 (shared-kmp-libs)          L2 (DawSync)
┌─────────────────────┐        ┌─────────────────────┐       ┌──────────────────────┐
│ skills/             │──sync─▶│ .claude/skills/      │       │ .claude/skills/      │
│ .claude/agents/     │──sync─▶│ .claude/agents/      │       │ .claude/agents/      │
│ .claude/commands/   │──sync─▶│ .claude/commands/    │       │ .claude/commands/    │
│ scripts/sh/         │        │ (L1-specific agents) │       │ (L2-specific agents) │
│ detekt-rules/       │──JAR──▶│ detektPlugins()      │──JAR─▶│ detektPlugins()      │
│ docs/               │  ref   │                      │       │                      │
└─────────────────────┘        └─────────────────────┘       └──────────────────────┘

L0 defines.  L1/L2 consume.  L2 extends with domain-specific agents.
```

- **L0**: Generic toolkit — skills, agents, scripts, docs, Detekt rules
- **L1**: Ecosystem library — version authority, shared modules, API contracts
- **L2**: Application — domain logic, features, platform apps

Each layer has its own CLAUDE.md, project-manager agent, architect reviewers (arch-testing, arch-platform, arch-integration), and project-specific specialists.

## Release Workflow

Standard across all layers:

1. `/bump-version --minor` — updates `version.properties` + `CHANGELOG.md`
2. `/changelog` — generates release notes from git history
3. `/git-flow release v{X.Y.Z}` — creates release branch, merges to master, tags, back-merges
4. `/readme-audit --fix` — ensure docs are current

## Related Docs

- [claude-md-template](claude-md-template.md) — Boris Cherny CLAUDE.md structure (project-manager in Agent Roster)
- [autonomous-multi-agent-workflow](multi-agent-patterns.md) — Multi-agent patterns and cost control
- [agent-consumption-guide](agent-consumption-guide.md) — How agents load and use pattern docs
- [getting-started](../guides/getting-started.md) — Full L0/L1/L2 setup from scratch
