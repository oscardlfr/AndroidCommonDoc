---
scope: [workflow, ai-agents, multi-agent, teams]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: team-topology
status: active
layer: L0
parent: agents-hub
category: agents
description: "3-phase team model with 9 session team peers (5 at session start + 4 core devs at Phase 2). Planning → Execution → Quality Gate. Phases are lightweight — session team peers carry context across all three."
version: 4
last_updated: "2026-04"
assumes_read: autonomous-multi-agent-workflow, context-rotation-guide
token_budget: 1500
---

# Team Topology: 3-Phase Model

Three sequential phases, each lightweight. Nine **session team peers** live in the `session-{project-slug}` team: five spawned at session start plus four core layer devs added when Phase 2 begins. All carry context across phases. The project slug is derived from the project directory name (lowercased, hyphens replacing spaces -- e.g., `DawSync` becomes `daw-sync`).

---

## Session Team Peers (9)

Five agents join at session start; four core layer devs join when Phase 2 begins. All nine stay alive across phases.

```
Session Start (5 agents)
  PM: TeamCreate("session-{project-slug}")
  PM: Agent(name="context-provider", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="doc-updater", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="arch-testing", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="arch-platform", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="arch-integration", team_name="session-{project-slug}", run_in_background=true)

Phase 2 Start (+4 core devs)
  PM: Agent(name="test-specialist", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="ui-specialist", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="domain-model-specialist", team_name="session-{project-slug}", run_in_background=true)
  PM: Agent(name="data-layer-specialist", team_name="session-{project-slug}", run_in_background=true)

All 9 peers: SendMessage(to="<agent-name>")  ← always reachable
```

| Agent | Role | Joined | Used in |
|-------|------|--------|---------|
| context-provider | On-demand oracle: patterns, docs, rules | Session start | All phases |
| doc-updater | CHANGELOG, docs, KDoc | Session start | Phase 2, 3 |
| arch-testing | Test strategy, coverage, test gaming | Session start | Phase 2, 3 |
| arch-platform | Source sets, Gradle, platform boundaries | Session start | Phase 2, 3 |
| arch-integration | Cross-module deps, DI, API contracts | Session start | Phase 2, 3 |
| test-specialist | Test compliance, generation, TDD | Phase 2 start | Phase 2 |
| ui-specialist | Compose UI, accessibility, Material3 | Phase 2 start | Phase 2 |
| domain-model-specialist | Domain model, sealed hierarchies, mappers | Phase 2 start | Phase 2 |
| data-layer-specialist | Repositories, data sources, caching | Phase 2 start | Phase 2 |

**Why TeamCreate**: team peers don't go "idle" the same way as background agents — no idle/dead confusion, no re-spawning with "v2" suffixes. **context-provider is an on-demand oracle** — agents SendMessage it with specific queries and it loads relevant files on demand (not eagerly), keeping setup cost low. Core devs accumulate layer knowledge across waves, eliminating per-spawn context re-reads. Quality-gater in Phase 3 joins the same team and can SendMessage directly to architects and devs. Context is preserved across all phases.

**Context rotation**: for long sessions (5+ waves with 9 peers, 7+ waves with 5 peers), re-spawn with SAME name AND SAME team_name: `Agent(name="arch-platform", team_name="session-{project-slug}", ...)` — replaces the old peer in-team. Never use a "v2" suffix.

### Why Session Team Peers

Previously, architects were background agents (`run_in_background=true`, no team). After each turn they went "idle" — the PM confused idle with dead, leading to re-spawns with "v2" suffixes and lost cross-phase context.

Now all 9 are `TeamCreate("session-{project-slug}")` peers. Four advantages:
- **No idle/dead confusion** — team peers are always reachable via SendMessage, no "v2" re-spawning
- **Quality-gater has direct access** — joins the session team in Phase 3, SendMessages architects directly
- **Cross-phase context preserved** — architects accumulate Phase 2 knowledge, quality-gater Step 1.5 can ask "what changed?" and get a real answer

## Core Dev Lifecycle

Four core devs (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist) are spawned at Phase 2 start and persist until session end -- same lifecycle as architects.

- **Spawn**: PM spawns all 4 when Phase 2 begins (not at session start)
- **Work**: Architects assign tasks via SendMessage; devs execute across multiple waves
- **Knowledge**: Devs accumulate layer expertise across waves -- no re-reading project context
- **Kill**: Core devs die at session end only. Never rotated mid-session unless context fills (7+ waves)
- **Reporting**: Each dev reports to specific architect(s) -- see Agent table above

## Pattern Validation Chain

Devs NEVER contact context-provider directly. The architect is the quality gate:

```
dev needs pattern -> SendMessage(to="arch-platform", "how to handle X?")
architect validates -> SendMessage(to="context-provider", "pattern for X?")
context-provider responds -> architect filters -> sends to dev
```

This ensures architects validate every pattern before it reaches dev code.

## Dynamic Scaling

When a core dev is busy and the architect needs parallel work:

1. Architect sends: `SendMessage(to="project-manager", "need extra ui-specialist")`
2. PM spawns: `Agent(name="ui-specialist-2", prompt="...")` -- named but NO team_name
3. Extra dev executes, returns result to PM, PM relays to architect
4. After architect verifies -> extra dev dies

**Anonymous devs** (<=3 files): For trivial fixes, PM uses `Agent(prompt="...")` -- no name, no team_name, disposable.

## Overview

```
Phase 1 — Planning (temporary planner)
  planner SendMessage(to="context-provider") for project state
  Output: structured execution plan
  ↓ planner dismissed

Phase 2 — Execution (no TeamCreate — architects are already alive)
  PM SendMessage(to="arch-testing/platform/integration") with plan
  architects SendMessage(to="context-provider") for patterns/rules
  Architects assign work to core devs via SendMessage
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

**Temporary team**: `TeamCreate("planning-{project-slug}")` with planner only (dismissed after plan delivered).

**Flow**:
1. PM creates planning team and spawns planner: `TeamCreate("planning-{project-slug}")`, `Agent(name="planner", ...)`
2. Planner `SendMessage(to="context-provider")` for current state (context-provider is a session team peer, reachable by name)
3. Planner reads architecture docs, specs, MODULE_MAP.md
4. Planner produces plan with: scope, steps, architect assignments, dependencies, risks
5. Planner writes plan to `.planning/PLAN.md`
6. Planner SendMessages path only to PM: `"Plan ready: .planning/PLAN.md"`
7. PM reads plan from disk, dismisses planner

**Cross-department check**: If planner flags product/marketing impact, PM spawns product-strategist or content-creator as sub-agents for review before proceeding.

**Skip condition**: Simple/obvious tasks (< 5K tokens, clear path) -- PM plans inline, no planner needed.

---

## Phase 2: Execution

**Purpose**: Implement the plan with architect-verified quality.

**No TeamCreate** -- architects are already session team peers. PM sends work directly via SendMessage.

**Flow**:
1. PM `SendMessage(to="arch-testing/platform/integration")` with plan assignments
2. Architects `SendMessage(to="context-provider")` for patterns and project rules
3. Architects detect issues using MCP tools (code-metrics, verify-kmp-packages, dependency-graph, etc.)
4. Architects assign tasks to core devs: `SendMessage(to="test-specialist", summary="task", message="...")`
5. For overflow: architects request extra devs from PM via SendMessage
6. PM spawns extras as named agents (no team_name); relays results to architect
7. Architects cross-verify via `SendMessage(to="arch-X", ...)`
8. After work: `SendMessage(to="doc-updater")` to update CHANGELOG/docs
9. All 3 architects: APPROVE -- phase complete
10. Any ESCALATE -- PM re-plans (never codes the fix)

**Wave pattern**: For large tasks, multiple detect/fix/verify cycles (waves). Persistent architects retain full context between waves.

**Context management**: All 9 session team peers carry context across waves automatically. For long sessions (5+ waves), re-spawn with same name AND same team_name: `Agent(name="arch-platform", team_name="session-{project-slug}", ...)` — replaces the old peer in the team.

---

## Phase 3: Quality Gate

**Purpose**: Verify quality before commit. Architect deliberation, then sequential automated gates.

**Temporary agent**: quality-gater (spawned, then dismissed after PASS/FAIL)

**Flow**:
1. PM adds quality-gater to session team: `Agent(name="quality-gater", team_name="session-{project-slug}", ...)`
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
- **9 session team peers** -- 5 at session start (context-provider, doc-updater, arch-testing, arch-platform, arch-integration) + 4 core devs at Phase 2 start (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist). For long sessions (5+ waves), re-spawn with same name AND same team_name.
- **No new TeamCreate for Phase 2** -- architects are already in the session team. PM sends plan via SendMessage. No additional team creation needed.
- **Phase 3 deliberation is mandatory** -- quality-gater MUST consult all 3 architects before running automated checks. Skipping deliberation voids the gate.
- **PM FORBIDDEN from spawning core devs outside Phase 2 start** -- the 4 core devs are spawned exactly once when Phase 2 begins.
- **Pattern validation chain** -- devs NEVER contact context-provider directly; architect is the quality gate.
- **Project-specific agents MUST be in routing table** -- guardians, validators, domain specialists. If the PM routing table doesn't list a domain, architects can't request specialists for it.

---

## When to Use 3-Phase vs Single-Team

| Signal | Model |
|--------|-------|
| Non-trivial task (3+ files, multiple domains) | 3-phase |
| Simple bug fix (1-2 files, clear path) | Single agent, no team |
| Cross-department impact | 3-phase + dept lead sub-agents |
| Urgent hotfix | Skip planning phase, minimal execution + quality gate |

---

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology overview, agent design rules, failure handling
- [Data Handoff Patterns](data-handoff-patterns.md) — structured markers, severity, report formats
- [Quality Gate Protocol](quality-gate-protocol.md) — detailed gate steps
- [Context Rotation Guide](context-rotation-guide.md) — managing context across team phases
