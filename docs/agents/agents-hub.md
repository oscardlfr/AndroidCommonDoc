---
scope: [agents, workflow, claude-code, multi-agent]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
slug: agents-hub
status: active
layer: L0
category: agents
description: "Agent workflow hub: CLAUDE.md template, project-manager model, agent delegation, multi-agent patterns, agent consumption"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
---

# Agent Workflow

How AI agents operate in the L0/L1/L2 ecosystem: CLAUDE.md structure, project-manager orchestration, specialist delegation, multi-agent patterns, and agent consumption.

> All L1/L2 projects follow the Boris Cherny CLAUDE.md style with Agent Strategy.

## Documents

| Document | Description |
|----------|-------------|
| [claude-md-template](claude-md-template.md) | Boris Cherny-style CLAUDE.md template — the 4-pillar structure for all projects |
| [claude-code-workflow](claude-code-workflow.md) | Project Manager adaptive model, skill usage, verification, release workflow |
| [multi-agent-patterns](multi-agent-patterns.md) | Topology (chain/fan-out/orchestrator), data handoff, failure handling, cost control |
| [agent-consumption-guide](agent-consumption-guide.md) | How agents load and use pattern docs (frontmatter, assumes_read, hub scanning) |
| [capability-detection](capability-detection.md) | Graceful degradation for optional tools in agent definitions |
| [script-vs-agent-decision](script-vs-agent-decision.md) | Decision framework: when a script is better than an agent |
| [spec-driven-workflow](spec-driven-workflow.md) | Spec-driven agent workflow: debugger, verifier, advisor, researcher, codebase-mapper |
| [architect-gate-pattern](multi-agent-patterns.md#architect-gate-pattern) | Verification gate between execution waves (arch-testing, arch-platform, arch-integration) |

## Key Concepts

- **CLAUDE.md** = workflow instructions (< 80 lines). Contains Agent Roster → triggers agent delegation.
- **`.claude/agents/`** = canonical agent definitions. Synced via `/sync-l0`. Used by both Claude Code and GSD/pi.
- **`.gsd/agents/`** = mirror for GSD/pi users (optional). Synced via `/sync-gsd-agents`. Not needed if using Claude Code only.
- **project-manager** = orchestrator. NEVER codes — assigns all code tasks to dev specialists, launches architect gates.
- **Spec-driven agents** = 5 new agents (debugger, verifier, advisor, researcher, codebase-mapper) for autonomous research, decision-making, and codebase exploration.
- **Skills** = token-efficient script wrappers. Always prefer over manual agent work.

## Rules

- Agent Roster in CLAUDE.md is mandatory — without it, Claude Code uses generic agents
- One responsibility per agent — split if doing multiple domains
- Agents report findings; they don't modify code unless explicitly designed to
- Script-first: if a regex can do it, don't make an agent for it
- Architect team gates every wave — mini-orchestrators that detect, fix, cross-verify, then APPROVE/ESCALATE
- Bug fixes require TDD — failing test first, then fix, then architect verification
- project-manager orchestrates, NEVER codes — assigns to devs, launches architect gates
- Agents classified as: Devs (write code), Architects (verify+manage), Guardians (read-only audit)
- Official Anthropic skills enhance agents — reference them with capability detection (use when available)
- Department heads are session-level agents (`claude --agent`), NOT sub-agents
- Cross-department context via `context-provider`, NOT by calling other department leads
