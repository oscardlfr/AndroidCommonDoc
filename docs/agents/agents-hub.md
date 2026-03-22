---
scope: [agents, workflow, claude-code, multi-agent]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
slug: agents-hub
status: active
layer: L0
category: agents
description: "Agent workflow hub: CLAUDE.md template, dev-lead model, agent delegation, multi-agent patterns, agent consumption"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
---

# Agent Workflow

How AI agents operate in the L0/L1/L2 ecosystem: CLAUDE.md structure, dev-lead orchestration, specialist delegation, multi-agent patterns, and agent consumption.

> All L1/L2 projects follow the Boris Cherny CLAUDE.md style with Agent Strategy.

## Documents

| Document | Description |
|----------|-------------|
| [claude-md-template](claude-md-template.md) | Boris Cherny-style CLAUDE.md template — the 4-pillar structure for all projects |
| [claude-code-workflow](claude-code-workflow.md) | dev-lead adaptive model, skill usage, verification, release workflow |
| [multi-agent-patterns](multi-agent-patterns.md) | Topology (chain/fan-out/orchestrator), data handoff, failure handling, cost control |
| [agent-consumption-guide](agent-consumption-guide.md) | How agents load and use pattern docs (frontmatter, assumes_read, hub scanning) |
| [capability-detection](capability-detection.md) | Graceful degradation for optional tools in agent definitions |
| [script-vs-agent-decision](script-vs-agent-decision.md) | Decision framework: when a script is better than an agent |

## Key Concepts

- **CLAUDE.md** = workflow instructions (< 80 lines). Contains Agent Roster → triggers agent delegation.
- **`.claude/agents/`** = specialist definitions. Canonical source. Synced via `/sync-l0`.
- **`.claude/agents/`** = canonical agent definitions. Used by both Claude Code and GSD/pi.
- **`.gsd/agents/`** = mirror for GSD/pi users. Synced via `/sync-gsd-agents`. Not needed if using Claude Code only.
- **dev-lead** = adaptive orchestrator. Inline for simple tasks, delegates for complex ones.
- **Skills** = token-efficient script wrappers. Always prefer over manual agent work.

## Rules

- Agent Roster in CLAUDE.md is mandatory — without it, Claude Code uses generic agents
- One responsibility per agent — split if doing multiple domains
- Agents report findings; they don't modify code unless explicitly designed to
- Script-first: if a regex can do it, don't make an agent for it
