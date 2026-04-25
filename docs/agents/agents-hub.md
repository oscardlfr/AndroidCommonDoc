---
scope: [agents, workflow, claude-code, multi-agent]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
slug: agents-hub
status: active
layer: L0
category: agents
description: "Agent workflow hub: CLAUDE.md template, team-lead model, agent delegation, multi-agent patterns, agent consumption"
version: 1
last_updated: "2026-03"
monitor_urls:
  - url: "https://docs.anthropic.com/en/docs/claude-code/overview"
    type: doc-page
    tier: 3
---

# Agent Workflow

How AI agents operate in the L0/L1/L2 ecosystem: CLAUDE.md structure, team-lead orchestration, specialist delegation, multi-agent patterns, and agent consumption.

> All L1/L2 projects follow the Boris Cherny CLAUDE.md style with Agent Strategy.

## Documents

| Document | Description |
|----------|-------------|
| [claude-md-template](claude-md-template.md) | Boris Cherny-style CLAUDE.md template — the 4-pillar structure for all projects |
| [claude-code-workflow](claude-code-workflow.md) | Team Lead adaptive model, skill usage, verification, release workflow |
| [multi-agent-patterns](multi-agent-patterns.md) | Topology (chain/fan-out/orchestrator), agent design rules, failure handling, cost control |
| [team-topology](team-topology.md) | 3-phase model with 9 session team peers (5 at start + 4 core specialists) — Planning → Execution → Quality Gate |
| [data-handoff-patterns](data-handoff-patterns.md) | Structured markers, severity convention, prose fallback, test gaming detection |
| [agent-consumption-guide](agent-consumption-guide.md) | How agents load and use pattern docs (frontmatter, assumes_read, hub scanning) |
| [capability-detection](capability-detection.md) | Graceful degradation for optional tools in agent definitions |
| [script-vs-agent-decision](script-vs-agent-decision.md) | Decision framework: when a script is better than an agent |
| [spec-driven-workflow](spec-driven-workflow.md) | Spec-driven agent workflow with 3-phase teams and multi-session departments |
| [quality-gate-protocol](quality-gate-protocol.md) | Sequential verification (frontmatter → tests → coverage → benchmarks → pre-pr) |
| [context-rotation-guide](context-rotation-guide.md) | Context management: rotation strategies, team-lead-as-relay, team dissolution |
| [cross-layer-protocol](cross-layer-protocol.md) | Cross-layer team coordination: separate teams per layer, filesystem handoff via `.planning/HANDOFF.md`, phase sync |
| [tl-phase-execution](tl-phase-execution.md) | team-lead's 3-phase execution protocol: phase transitions, triggers, anti-patterns, execution checklist |
| [tl-session-setup](tl-session-setup.md) | team-lead session setup: Phase 2 core specialists, selective spawning, rotation protocol, context management, architect routing |
| [tl-dispatch-topology](tl-dispatch-topology.md) | team-lead dispatch: topology gate, pattern validation chain, dynamic scaling, autonomy rules, kill order |
| [tl-verification-gates](tl-verification-gates.md) | team-lead verification: architect verdicts, post-verdict broadcast, post-wave integrity check |
| [tl-quality-doc-pipeline](tl-quality-doc-pipeline.md) | team-lead quality gate + doc pipeline: quality-gater retry rules, doc-updater mandate, CLAUDE.md pointers-only rule |
| [scope-extension-protocol](scope-extension-protocol.md) | Mechanical scope-extension gate: authorization workflow when architects hit out-of-scope blockers, escape hatch, bypass audit log |
| [tl-model-profiles](tl-model-profiles.md) | `.claude/model-profiles.json`: 4 profiles, team-lead-opus-override rationale, haiku/opus override maps |
| [arch-dispatch-modes](arch-dispatch-modes.md) | Architect PREP/EXECUTE dispatch modes + scope_doc_path protocol (Wave 23 Bug #5 + #6 fix) |
| [Agent Core Rules](agent-core-rules.md) | Universal rules for all session agents |
| [Agent Verdict Protocol](agent-verdict-protocol.md) | Architect verdict format + disk-write + 1-liner DM pattern |
| [Ingestion Loop](ingestion-loop.md) | External-source → L0 docs: context-provider flag → team-lead user-approval → doc-updater `ingest-content` (Wave 25 — closes T-BUG-005) |

## Key Concepts

- **3-Phase Model** = Planning → Execution → Quality Gate. Nine **session team peers** in `session-{project-slug}` carry context across phases: 5 at session start + 4 persistent core specialists at Phase 2. Planner and quality-gater are temporary.
- **Session team peers** = context-provider, doc-updater, arch-testing, arch-platform, arch-integration (session start) + test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist (Phase 2 start). All alive for the session.
- **CLAUDE.md** = workflow instructions (< 80 lines). Contains Agent Roster → triggers agent delegation.
- **`.claude/agents/`** = canonical agent definitions. Synced via `/sync-l0`.
- **team-lead** = orchestrator. NEVER codes — orchestrates 3-phase teams, spawns 4 core specialists at Phase 2 start, spawns extras on architect request. Pattern validation chain: specialist → architect → context-provider.
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
- team-lead orchestrates, NEVER codes — assigns to devs, launches architect gates
- Agents classified as: Specialists (write code), Architects (verify+manage), Guardians (read-only audit)
- Official Anthropic skills enhance agents — reference them with capability detection (use when available)
- Department heads are session-level agents (`claude --agent`), NOT sub-agents
- Cross-department context via `context-provider`, NOT by calling other department leads
- **MCP tools must be declared in `tools:` frontmatter** to be callable (Wave 25 fix). Prose references alone don't load schemas — the harness only exposes what's listed. 10 core agents wired; see [agent-core-rules](agent-core-rules.md) §8.
