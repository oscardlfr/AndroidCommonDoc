# Agent Templates

Generic agent templates for L1 (ecosystem library) and L2 (application) projects.

These are **starting points** — adapt to your project's specific modules, constraints, and domain terminology.

## How to Use

1. Copy the template you need to your project's `.claude/agents/` directory
2. Replace all `{{PLACEHOLDER}}` values with your project specifics
3. Remove sections that don't apply to your project
4. Register the agent in `l0-manifest.json` under `l2_specific.agents`

## Templates

### Universal (any layer)

| Template | Purpose |
|----------|---------|
| `dev-lead.md` | Development workflow coordinator — plans, executes, delegates, verifies |

### L1 (Ecosystem Library)

| Template | Purpose |
|----------|---------|
| `platform-auditor.md` | Cross-module architecture coherence auditor |
| `module-lifecycle.md` | New module creation and deprecation checklists |

### L2 (Application)

| Template | Purpose |
|----------|---------|
| `feature-domain-specialist.md` | Domain-specific architecture auditor (customize per domain) |

## Conventions

All agents follow these conventions from L0:
- **YAML frontmatter**: name, description, tools, model, memory, skills
- **Single responsibility**: one domain per agent
- **Read-only by default**: audit agents report, don't modify
- **Findings protocol**: structured JSON between `FINDINGS_START`/`FINDINGS_END` markers
- **Skills reference**: agents reference L0 skills (test, coverage, etc.) to save tokens
- **Escalation pattern**: agents escalate to user for business/API decisions, never hallucinate

## Model Selection Guide

| Agent Type | Recommended Model | Rationale |
|-----------|-------------------|-----------|
| Dev lead / orchestrator | opus | Complex reasoning, multi-step planning |
| Architecture auditor | opus | Pattern recognition across large codebases |
| Simple gate checker | sonnet | Rule-based checks, lower token cost |
| Source set validator | sonnet | Grep-based, deterministic checks |
