---
scope: [workflow, ai-agents, multi-agent, teams]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: team-topology
status: active
layer: L0
parent: agents-hub
category: agents
description: "3-phase team model with 5 persistent agents. Planning → Execution → Quality Gate. Phases are lightweight — persistent agents carry context across all three."
version: 2
last_updated: "2026-04"
assumes_read: autonomous-multi-agent-workflow, context-rotation-guide
token_budget: 1500
---

# Team Topology: 3-Phase Model

Three sequential phases, each lightweight. Five **persistent agents** live outside phases for the entire session, carrying context across all three.

---

## Persistent Agents (5)

All five are spawned ONCE at session start and stay alive across all phases:

```
Session Start
  PM: Agent(name="context-provider", run_in_background=true)   → reads project ONCE
  PM: Agent(name="doc-updater", run_in_background=true)        → ready for doc updates
  PM: Agent(name="arch-testing", run_in_background=true)       → testing domain
  PM: Agent(name="arch-platform", run_in_background=true)      → platform domain
  PM: Agent(name="arch-integration", run_in_background=true)   → integration domain

All agents in all phases: SendMessage(to="<agent-name>")
```

| Agent | Role | Used in |
|-------|------|---------|
| context-provider | Project state, patterns, rules | All phases |
| doc-updater | CHANGELOG, docs, KDoc | Phase 2, 3 |
| arch-testing | Test strategy, coverage, test gaming | Phase 2, 3 |
| arch-platform | Source sets, Gradle, platform boundaries | Phase 2, 3 |
| arch-integration | Cross-module deps, DI, API contracts | Phase 2, 3 |

**Why persistent**: architects accumulate Phase 2 execution context. Quality-gater in Phase 3 can ask "what changed?" and get a real answer from the agents who did the work. Re-spawning per phase loses this.

**Rotation**: for long sessions (5+ waves), PM spawns fresh instances to prevent context window fill.

### Why Persistent Architects

Previously, architects were created per Phase 2 and destroyed at phase end. This caused three problems:
- **Quality-gater couldn't ask architects about Phase 2 decisions** — the agents that made those decisions no longer existed by Phase 3
- **PM bypassed architects for "simple" tasks** — no TeamCreate overhead tempted PM to skip architectural review
- **Cross-phase context was lost** — each phase started from scratch, repeating project discovery

Now architects persist like context-provider. Quality-gater Step 1.5 consults them before reporting, and PM sends work directly via SendMessage instead of creating teams.

## Overview

```
Phase 1 — Planning (temporary planner)
  planner SendMessage(to="context-provider") for project state
  Output: structured execution plan
  ↓ planner dismissed

Phase 2 — Execution (no TeamCreate — architects are already alive)
  PM SendMessage(to="arch-testing/platform/integration") with plan
  architects SendMessage(to="context-provider") for patterns/rules
  PM dispatches devs as sub-agents via relay
  SendMessage(to="doc-updater") after work
  All 3 architects APPROVE → phase complete

Phase 3 — Quality Gate (temporary quality-gater)
  quality-gater deliberates with persistent architects for Phase 2 context
  quality-gater runs automated checks (see quality-gate-protocol.md)
  PASS → commit. FAIL → back to Phase 2
  ↓ quality-gater dismissed
```

---

## Phase 1: Planning

**Purpose**: Produce a structured execution plan before any code is written.

**Temporary agent**: planner (spawned, then dismissed after plan delivered)

**Flow**:
1. PM spawns planner: `Agent(name="planner", ...)`
2. Planner `SendMessage(to="context-provider")` for current state
3. Planner reads architecture docs, specs, MODULE_MAP.md
4. Planner produces plan with: scope, steps, architect assignments, dependencies, risks
5. Planner SendMessages plan to PM
6. PM dismisses planner

**Cross-department check**: If planner flags product/marketing impact, PM spawns product-strategist or content-creator as sub-agents for review before proceeding.

**Skip condition**: Simple/obvious tasks (< 5K tokens, clear path) -- PM plans inline, no planner needed.

---

## Phase 2: Execution

**Purpose**: Implement the plan with architect-verified quality.

**No TeamCreate** -- architects are already alive as persistent agents. PM sends work directly via SendMessage.

**Flow**:
1. PM `SendMessage(to="arch-testing/platform/integration")` with plan assignments
2. Architects `SendMessage(to="context-provider")` for patterns and project rules
3. Architects detect issues using MCP tools (code-metrics, verify-kmp-packages, dependency-graph, etc.)
4. Architects request dev work via: `SendMessage(to="project-manager", summary="need {agent}", message="Task: ...")`
5. PM spawns devs as sub-agents: `Agent(prompt="You are {agent}. {task}. PROJECT RULES: {rules from context-provider}.", run_in_background=true)`
6. PM relays dev results back to requesting architect
7. Architects cross-verify via `SendMessage(to="arch-X", ...)`
8. After work: `SendMessage(to="doc-updater")` to update CHANGELOG/docs
9. All 3 architects: APPROVE -- phase complete
10. Any ESCALATE -- PM re-plans (never codes the fix)

**Wave pattern**: For large tasks, multiple detect/fix/verify cycles (waves). Persistent architects retain full context between waves.

**Context management**: All 5 persistent agents carry context across waves automatically. For very long sessions (5+ waves), PM rotates them (spawn fresh, kill old).

---

## Phase 3: Quality Gate

**Purpose**: Verify quality before commit. Architect deliberation, then sequential automated gates.

**Temporary agent**: quality-gater (spawned, then dismissed after PASS/FAIL)

**Flow**:
1. PM spawns quality-gater: `Agent(name="quality-gater", ...)`
2. **Architect Deliberation** -- quality-gater consults all 3 persistent architects:
   - `SendMessage(to="arch-testing")` -- what was tested, known gaps, coverage concerns
   - `SendMessage(to="arch-platform")` -- source set changes, platform boundary risks
   - `SendMessage(to="arch-integration")` -- cross-module impacts, DI wiring, API changes
3. quality-gater runs automated protocol (see [quality-gate-protocol](quality-gate-protocol.md))
4. quality-gater SendMessages structured PASS/FAIL report to PM (includes retry count + architect deliberation summary)
5. PASS -- PM commits, dismisses quality-gater
6. FAIL -- PM dismisses quality-gater, re-enters Phase 2 with failure context
7. **Max 3 retries** -- after 3 FAIL/Phase 2/FAIL cycles on the same issue, escalate to user

**Why deliberation matters**: Architects hold Phase 2 context that automated checks cannot see. A test might pass but an architect knows the coverage is shallow. A file might look clean but an architect knows the integration was deferred. Deliberation prevents false positives and catches gaps.

See [Quality Gate Protocol](quality-gate-protocol.md) for step details.

---

## Key Constraints

- **PM is sole Agent() spawner** -- teammates can't use Agent() in in-process mode (#31977)
- **Architects**: Read, Grep, Glob, Bash, SendMessage (NO Write/Edit/Agent)
- **5 persistent agents** -- spawned once at session start: context-provider, doc-updater, arch-testing, arch-platform, arch-integration. Rotated for long sessions (5+ waves).
- **No TeamCreate for Phase 2** -- architects are already alive. PM sends plan via SendMessage. Eliminates team creation/dissolution overhead.
- **Phase 3 deliberation is mandatory** -- quality-gater MUST consult all 3 architects before running automated checks. Skipping deliberation voids the gate.
- **PM FORBIDDEN from launching devs directly** -- all devs dispatched only when an architect requests via SendMessage.
- **Project-specific agents MUST be in routing table** -- guardians, validators, domain specialists. If the PM routing table doesn't list a domain, architects can't request specialists for it.

---

## When to Use 3-Phase vs Single-Team

| Signal | Model |
|--------|-------|
| Non-trivial task (3+ files, multiple domains) | 3-phase |
| Simple bug fix (1-2 files, clear path) | Single agent, no team |
| Cross-department impact | 3-phase + dept lead sub-agents |
| Urgent hotfix | Skip Planning Team, minimal Execution + Quality Gate |

---

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology overview, agent design rules, failure handling
- [Data Handoff Patterns](data-handoff-patterns.md) — structured markers, severity, report formats
- [Quality Gate Protocol](quality-gate-protocol.md) — detailed gate steps
- [Context Rotation Guide](context-rotation-guide.md) — managing context across team phases
