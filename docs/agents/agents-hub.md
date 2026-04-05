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
| [multi-agent-patterns](multi-agent-patterns.md) | Topology (chain/fan-out/orchestrator), agent design rules, failure handling, cost control |
| [team-topology](team-topology.md) | 3-phase model with 9 session team peers (5 at start + 4 core devs) — Planning → Execution → Quality Gate |
| [data-handoff-patterns](data-handoff-patterns.md) | Structured markers, severity convention, prose fallback, test gaming detection |
| [agent-consumption-guide](agent-consumption-guide.md) | How agents load and use pattern docs (frontmatter, assumes_read, hub scanning) |
| [capability-detection](capability-detection.md) | Graceful degradation for optional tools in agent definitions |
| [script-vs-agent-decision](script-vs-agent-decision.md) | Decision framework: when a script is better than an agent |
| [spec-driven-workflow](spec-driven-workflow.md) | Spec-driven agent workflow with 3-phase teams and multi-session departments |
| [quality-gate-protocol](quality-gate-protocol.md) | Sequential verification (frontmatter → tests → coverage → benchmarks → pre-pr) |
| [context-rotation-guide](context-rotation-guide.md) | Context management: rotation strategies, PM-as-relay, team dissolution |
| [cross-layer-protocol](cross-layer-protocol.md) | Cross-layer team coordination: separate teams per layer, filesystem handoff via `.planning/HANDOFF.md`, phase sync |
| [pm-phase-execution](pm-phase-execution.md) | PM's 3-phase execution protocol: phase transitions, triggers, anti-patterns, execution checklist |

## Key Concepts

- **3-Phase Model** = Planning → Execution → Quality Gate. Nine **session team peers** in `session-{project-slug}` carry context across phases: 5 at session start + 4 persistent core devs at Phase 2. Planner and quality-gater are temporary.
- **Session team peers** = context-provider, doc-updater, arch-testing, arch-platform, arch-integration (session start) + test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist (Phase 2 start). All alive for the session.
- **CLAUDE.md** = workflow instructions (< 80 lines). Contains Agent Roster → triggers agent delegation.
- **`.claude/agents/`** = canonical agent definitions. Synced via `/sync-l0`.
- **project-manager** = orchestrator. NEVER codes — orchestrates 3-phase teams, spawns 4 core devs at Phase 2 start, spawns extras on architect request. Pattern validation chain: dev → architect → context-provider.
- **quality-gater** = dynamic rule discovery. Reads CLAUDE.md for project rules, runs `/pre-pr`, cross-checks every rule.
- **planner** = temporary agent in `planning-{project-slug}` team. Uses `SendMessage(to="context-provider")` for project state. Writes plan to `.planning/PLAN.md`.
- **Doc Integrity** = `/doc-integrity` pipeline: kdoc-coverage → check-doc-patterns → docs/api freshness → audit-docs. State in `kdoc-state.json`.
- **Spec-driven agents** = debugger, verifier, advisor, researcher, codebase-mapper for autonomous work.
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
