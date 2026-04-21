---
scope: [claude-md, template, context-management, agent-workflow]
sources: [anthropic-claude-code]
targets: [all]
slug: claude-md-template
status: active
layer: L0
parent: agents-hub
category: agents
description: "Boris Cherny-style CLAUDE.md template: workflow orchestration, agent delegation, project constraints, commands"
version: "2.0.0"
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
assumes_read: guides-hub
token_budget: 1800
---

# CLAUDE.md Template — Boris Cherny Style

CLAUDE.md is the **workflow instruction file** for AI agents, not project documentation. Keep it under 80 lines. It tells the agent *how to work*, not *what the project is*.

## Design Principles

| Principle | Rule |
|-----------|------|
| **Workflow, not docs** | CLAUDE.md = operational instructions. Project docs go in `docs/` and `README.md` |
| **< 80 lines** | Agents lose rules in long files. Compress to one-liners. |
| **Delegation-first** | List agents + trigger conditions. Agent does the audit, not the team-lead. |
| **Boris Cherny 4 pillars** | Plan Mode, Agent Delegation, Verification Before Done, Autonomous Execution |
| **Layer separation** | L0 auto-loads via `~/.claude/CLAUDE.md`. L1/L2 add ONLY project-specific rules. |

## Template Structure

```markdown
# {Project Name}

> {Layer} — {one-line description}

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural impact)
- {Project-specific plan triggers — e.g., "Modifying core/domain/ → plan mode"}
- If something goes sideways, STOP and re-plan immediately

### 2. Agent Delegation
- Use specialized agents — don't do domain audits manually
- One task per agent for focused execution
- → delegate to `{agent-name}`: "{specific task description}"

| Agent | Domain | When |
|-------|--------|------|
| `team-lead` | Orchestration | Entry point — NEVER codes, assigns to devs, launches architect gates |
| `arch-testing` | Test verification | Architect gate after each wave |
| `arch-platform` | Architecture verification | Architect gate after each wave |
| `arch-integration` | Integration verification | Architect gate after each wave |
| `{specialist-1}` | {domain} | {trigger condition} |
| `{specialist-2}` | {domain} | {trigger condition} |

### 3. Verification Before Done
- Never mark done without proving it works — run tests, check logs, demonstrate
- {Project-specific verification — e.g., "DAW change → test SILENT mode"}
- **Before any PR → `/pre-pr`**

### 4. Autonomous Execution
- When given a bug: just fix it. Logs → errors → root cause → fix → verify
- Use L0 skills, never raw Gradle: `/test <mod>`, `/test-changed`, `/coverage`
- Zero context switching — go fix failing tests without being told how

## Project Constraints

{3-5 hard rules as compact one-liners. These are the rules an agent must never violate.}

### Git Flow
- `master` ← releases only. `develop` ← integration. `feature/*` ← from develop.
- Every PR must pass `/pre-pr` locally. Conventional Commits enforced.

## Commands
- `/pre-pr` — full pre-merge validation
- `/test-full-parallel` — all modules parallel + coverage
- `/test <module>` — single module with retry
- {other project-specific commands}

## Doc Consultation
- {file/module pattern} → {doc path}
- {file/module pattern} → {doc path}
```

## Layer Examples

### L1 (Ecosystem Library)
```markdown
# shared-kmp-libs

> L1 Ecosystem Library — Version authority for all KMP modules.

## Workflow Orchestration
### 1. Plan Mode Default
- Adding a new module → plan first: name, targets, api/impl split
- Changing foundation modules → plan mode — blast radius is every consumer

### 2. Agent Delegation
| Agent | Domain | When |
|-------|--------|------|
| `team-lead` | Orchestration | Entry point — assigns to devs, never codes |
| `arch-testing` | Test verification | Architect gate after each wave |
| `arch-platform` | Architecture verification | Architect gate after each wave |
| `arch-integration` | Integration verification | Architect gate after each wave |
| `api-contract-guardian` | API purity | Changing -api modules |
| `platform-auditor` | Cross-cluster | Changes spanning multiple clusters |
| `module-lifecycle` | Module mgmt | Adding or removing modules |
...
```

### L2 (Application)
```markdown
# DawSync

> L2 Application — Creative Project OS for musicians.

## Workflow Orchestration
### 1. Plan Mode Default
- Modifying core/domain/ → plan mode — SSOT blast radius
- SnapshotProducer changes → plan mode — DAW interaction, high risk

### 2. Agent Delegation
| Agent | Domain | When |
|-------|--------|------|
| `team-lead` | Orchestration | Entry point — assigns to devs, never codes |
| `arch-testing` | Test verification | Architect gate after each wave |
| `arch-platform` | Architecture verification | Architect gate after each wave |
| `arch-integration` | Integration verification | Architect gate after each wave |
| `daw-guardian` | DAW safety | Background work, file I/O, schedulers |
| `data-layer-specialist` | Data layer | core/data/, repositories |
| `freemium-gate-checker` | Feature gates | New features, tier changes |
...
```

## What Does NOT Go in CLAUDE.md

| Content | Where it belongs |
|---------|-----------------|
| Architecture diagrams | `docs/architecture/` |
| API contracts | `docs/core-{module}/` |
| Git Flow full branch diagram | `README.md` Development section |
| Pattern details (PHANTOM→FULL, StateFlow events) | `docs/architecture/patterns-*.md` |
| Temporal context (active sprints, tracks) | Plan Mode, Memory (native) — primary; `.gsd/milestones/` (optional) |
| Command `--help` details | `skills/*/SKILL.md` (each skill carries its own docs) |
| CI workflow details | `.github/workflows/` |
| Sub-project listing | `README.md` Ecosystem section |

## CLAUDE.md + Agent Connection

```
CLAUDE.md                    .claude/agents/team-lead.md
┌──────────────────────┐     ┌──────────────────────────┐
│ ## Agent Delegation │     │ ## Specialist Delegation  │
│ | daw-guardian | ...  │────▶│ invoke daw-guardian when  │
│ | data-layer  | ...  │     │ invoke data-layer when    │
│                      │     │                           │
│ ## Commands           │     │ ## L0 Skills Usage        │
│ /pre-pr, /test ...   │     │ /test, /coverage, /pre-pr │
└──────────────────────┘     └──────────────────────────┘
         │                              │
         │ Agent Roster tells Claude     │ Agent body tells the agent
         │ WHICH agents exist            │ HOW to do the audit
         │                              │
         ▼                              ▼
   .claude/agents/                   Claude Code reads these natively.
   (canonical definitions)           GSD/pi mirrors (optional) to .gsd/agents/
```

The CLAUDE.md Agent Roster is the **discovery** mechanism. Without it, Claude Code uses generic agents (Explore, Plan, Code) instead of your specialists.

## Validation

`validate-claude-md` checks:
- Line count ≤ 150
- Has Workflow Orchestration section
- Has Agent Roster table
- Has Commands section
- No L0 rule duplication (L0 auto-loads)
- No upward references (L1→L2, L0→L1)

## Related Docs

- [claude-code-workflow](claude-code-workflow.md) — How the team-lead workflow operates
- [autonomous-multi-agent-workflow](multi-agent-patterns.md) — Multi-agent patterns and cost control
- [agent-consumption-guide](agent-consumption-guide.md) — How agents load and use pattern docs
