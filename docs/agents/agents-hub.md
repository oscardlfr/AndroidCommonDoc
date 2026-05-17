---
scope: [agents, workflow, claude-code, multi-agent]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
slug: agents-hub
status: active
layer: L0
category: agents
description: "Agent workflow hub: CLAUDE.md template, team-lead model, agent delegation, multi-agent patterns, agent consumption"
version: 2
last_updated: "2026-05"
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
| [arch-topology-protocols](arch-topology-protocols.md) | Architect topology: concern-ownership map (§4), cross-architect coordination, tiebreaker chain (BL-W32-02) |
| [team-topology](team-topology.md) | 3-phase model with 10 session team peers (5 at start + 5 core specialists) — Planning → Execution → Quality Gate |
| [data-handoff-patterns](data-handoff-patterns.md) | Structured markers, severity convention, prose fallback, test gaming detection |
| [agent-consumption-guide](agent-consumption-guide.md) | How agents load and use pattern docs (frontmatter, assumes_read, hub scanning) |
| [capability-detection](capability-detection.md) | Graceful degradation for optional tools in agent definitions |
| [script-vs-agent-decision](script-vs-agent-decision.md) | Decision framework: when a script is better than an agent |
| [spec-driven-workflow](spec-driven-workflow.md) | Spec-driven agent workflow with 3-phase teams and multi-session departments |
| [quality-gate-protocol](quality-gate-protocol.md) | Sequential verification (frontmatter → tests → coverage → benchmarks → pre-pr) |
| [context-rotation-guide](context-rotation-guide.md) | Context management: rotation strategies, team-lead-as-relay, team dissolution |
| [cross-layer-protocol](cross-layer-protocol.md) | Cross-layer team coordination: separate teams per layer, filesystem handoff via `.planning/HANDOFF.md`, phase sync |
| [scope-extension-protocol](scope-extension-protocol.md) | Mechanical scope-extension gate: authorization workflow when architects hit out-of-scope blockers, escape hatch, bypass audit log |
| [team-lead-hub](team-lead/team-lead-hub.md) | Team-lead protocols: phase execution, dispatch, verification gates, model profiles, git workflow, agent roster — 14 sub-docs |
| [arch-dispatch-modes](arch-dispatch-modes.md) | Architect PREP/EXECUTE dispatch modes + scope_doc_path protocol (Wave 23 Bug #5 + #6 fix) |
| [Agent Core Rules](agent-core-rules.md) | Universal rules for all session agents |
| [Agent Verdict Protocol](agent-verdict-protocol.md) | Architect verdict format + disk-write + 1-liner DM pattern |
| [Ingestion Loop](ingestion-loop.md) | External-source → L0 docs: context-provider flag → team-lead user-approval → doc-updater `ingest-content` (Wave 25 — closes T-BUG-005) |
| [local-first-skills-pattern](local-first-skills-pattern.md) | When to deploy a skill locally (L1) before promoting to L0; lifecycle stages and promotion criteria |
| [arch-review-depth-mandate](arch-review-depth-mandate.md) | Architect line-by-line file review mandate before APPROVE — 7 scan categories, APPROVE gate (BL-W47p #29/#30) |
| [post-compaction-resync](post-compaction-resync.md) | Protocol for agent-side state recovery after context compaction |
| [branch-guard](branch-guard.md) | PreToolUse hook that blocks write-git ops on `develop`/`master` (BL-W35-08) |
| [test-specialist-coverage-targets](test-specialist-coverage-targets.md) | test-specialist minimum coverage targets by layer (model/domain/data/db/UI) |
| [test-specialist-jdk-env](test-specialist-jdk-env.md) | test-specialist JDK env triage: UnsupportedClassVersionError, JAVA_HOME override steps (BL-W32-16) |
| [test-specialist-vm-testing](test-specialist-vm-testing.md) | test-specialist high-dep ViewModel testing: factory pattern, compile-time RED signal |
| [arch-platform-prep-authoring-checklist](arch-platform-prep-authoring-checklist.md) | arch-platform pre-execute authoring checklist: cross-file pin scan, scope doc read, verdict field requirements |
| [arch-platform-section-h-rule](arch-platform-section-h-rule.md) | arch-platform Section H authoring rule: manifest yaml required when versions bump, literal paths only |
| [kmp-checks-catalog](kmp-checks-catalog.md) | 6 KMP architectural checks (extracted from arch-platform.md): source sets, dep direction, five-layer, convention plugins, pattern compliance, Compose resources |
| [commit-spec-validation](commit-spec-validation.md) | Cheat-sheet for valid commit types (`reusable-commit-lint.yml:25`) + scopes (`l0-ci.yml:22`) — referenced by arch-platform-prep-authoring-checklist.md Check 2 |
| [dual-location-protocol](dual-location-protocol.md) | Agent template SOURCE/COPY sync protocol: manifest-bump-first, MIGRATIONS.json Write-only, rehash command (BL-bump-ktr-03) |
| [arch-testing-dispatch-protocol](arch-testing-dispatch-protocol.md) | Per-dispatch validation rules for arch-testing: scope gate, pattern check, spec completeness, TDD order audit |
| [arch-scope-extension-protocol](arch-scope-extension-protocol.md) | Scope Extension Protocol (OBS-A HARD SELF-GATE, T-BUG-011) — 3-check gate before any scope extension SendMessage to team-lead |
| [arch-reporter-protocol](arch-reporter-protocol.md) | Reporter Protocol (MANDATORY, T-BUG-012) — team-lead liveness check before every SendMessage to team-lead |
| [arch-message-topic-discipline](arch-message-topic-discipline.md) | Message Topic Discipline — one SendMessage per topic; mixing topics creates ambiguous receiver state |
| [context-provider-adoption-hooks](context-provider-adoption-hooks.md) | Context-provider adoption gate + tool-use observability layer (session-level enforcement) |
| [knowledge-currency-gate](knowledge-currency-gate.md) | Knowledge currency gate: CP verification required before any KMP capability claim in arch dispatches |
| [main-agent-orchestration-guide](main-agent-orchestration-guide.md) | Orchestration guide for the main agent: team topology, phase protocol, architect routing, quality gates |
| [quality-gater-runtime-ui-validation](quality-gater-runtime-ui-validation.md) | quality-gater Step 9.5 — Runtime UI Validation: Android Layout Diff + Compose Semantic Diff dispatch |
| [workflow-orchestration](workflow-orchestration.md) | Plan mode, agent delegation table, verification, and autonomous execution rules (extracted from CLAUDE.md prep-6) |

## Key Concepts

- **3-Phase Model** = Planning → Execution → Quality Gate. Ten **session team peers** in `session-{project-slug}` carry context across phases: 5 at session start + 5 persistent core specialists at Phase 2. Planner is temporary.
- **Session team peers** = context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater (session start) + test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist, toolkit-specialist (Phase 2 start). All alive for the session.
- **CLAUDE.md** = workflow instructions (< 80 lines). Contains Agent Roster → triggers agent delegation.
- **`.claude/agents/`** = canonical agent definitions. Synced via `/sync-l0`.
- **team-lead** = orchestrator. NEVER codes — orchestrates 3-phase teams, spawns 5 core specialists at Phase 2 start, spawns extras on architect request. Pattern validation chain: specialist → architect → context-provider.
- **quality-gater** = dynamic rule discovery. Reads CLAUDE.md for project rules, runs `/pre-pr`, cross-checks every rule.
- **planner** = temporary agent in `planning-{project-slug}` team. Uses `SendMessage(to="context-provider")` for project state. Writes plan to `.planning/PLAN.md`.
- **Doc Integrity** = `/doc-integrity` pipeline: kdoc-coverage → check-doc-patterns → docs/api freshness → audit-docs. State in `kdoc-state.json`.
- **Spec-driven agents** = debugger, verifier, advisor, researcher, codebase-mapper for autonomous work.
- **Skills** = token-efficient script wrappers. Always prefer over manual agent work.

## Rules

See [agent-core-rules](agent-core-rules.md) for universal behavioral rules. Key constraints:
- Agent Roster in CLAUDE.md is mandatory — without it, Claude Code uses generic agents
- Script-first: if a regex can do it, don't make an agent for it
- team-lead orchestrates, NEVER codes — assigns to devs, launches architect gates
- **MCP tools must be declared in `tools:` frontmatter** to be callable (Wave 25 fix). 20 core agents wired; see [agent-core-rules](agent-core-rules.md) §8.
