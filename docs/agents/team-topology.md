---
scope: [workflow, ai-agents, multi-agent, teams]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: team-topology
status: active
layer: L0
parent: agents-hub
category: agents
description: "3-phase team model: Planning Team → Execution Team → Quality Gate Team. Each temporary, dissolved after phase completes."
version: 1
last_updated: "2026-03"
assumes_read: autonomous-multi-agent-workflow, context-rotation-guide
token_budget: 1500
---

# Team Topology: 3-Phase Model

Three sequential teams, each temporary and dissolved after its phase completes. Context is freed between phases to prevent bloat.

---

## Overview

```
Phase 1 — Planning Team (temporary)
  planner + context-provider as peers
  Output: structured execution plan
  ↓ team dissolved

Phase 2 — Execution Team
  3 architects + context-provider + doc-updater as peers
  PM dispatches devs as sub-agents via relay
  All 3 architects APPROVE → team dissolved
  ↓ team dissolved

Phase 3 — Quality Gate Team (temporary)
  quality-gater + context-provider as peers
  Runs: frontmatter → tests → coverage → benchmarks → pre-pr
  PASS → commit. FAIL → back to Phase 2
  ↓ team dissolved
```

---

## Phase 1: Planning Team

**Purpose**: Produce a structured execution plan before any code is written.

**Peers**: planner, context-provider

**Flow**:
1. PM creates team: `TeamCreate("planning")`
2. Planner SendMessages context-provider for current state
3. Planner reads architecture docs, specs, MODULE_MAP.md
4. Planner produces plan with: scope, steps, architect assignments, dependencies, risks
5. Planner SendMessages plan to PM
6. PM dissolves team

**Cross-department check**: If planner flags product/marketing impact, PM spawns product-strategist or content-creator as sub-agents (outside the team) for review before proceeding.

**Skip condition**: Simple/obvious tasks (< 5K tokens, clear path) → PM plans inline, no Planning Team needed.

---

## Phase 2: Execution Team

**Purpose**: Implement the plan with architect-verified quality.

**Peers**: arch-testing, arch-platform, arch-integration, context-provider, doc-updater

**Flow**:
1. PM creates team: `TeamCreate("execution")`
2. PM dispatches plan to architects via SendMessage
3. Architects detect issues using MCP tools (code-metrics, verify-kmp-packages, dependency-graph, etc.)
4. Architects request dev work via: `SendMessage(to="project-manager", summary="need {agent}", message="Task: ...")`
5. PM spawns devs as sub-agents: `Agent({agent-name}, prompt="...")`
6. PM relays dev results back to requesting architect
7. Architects cross-verify via `SendMessage(to="arch-X", ...)`
8. All 3 architects: APPROVE → PM dissolves team
9. Any ESCALATE → PM re-plans (never codes the fix)

**Wave pattern**: For large tasks, multiple detect→fix→verify cycles (waves) within the same team. Summarize between waves to manage context.

**Context management**: Call doc-updater mid-session for long work (5+ waves) to archive decisions to disk.

---

## Phase 3: Quality Gate Team

**Purpose**: Verify quality before commit. Sequential gates, each blocks.

**Peers**: quality-gater, context-provider

**Flow**:
1. PM creates team: `TeamCreate("quality-gate")`
2. quality-gater runs protocol: validate-doc-structure → tests → coverage → benchmarks → pre-pr
3. quality-gater SendMessages structured PASS/FAIL report to PM (includes retry count)
4. PASS → PM commits, dissolves team
5. FAIL → PM dissolves team, re-enters Phase 2 with failure context
6. **Max 3 retries** — after 3 FAIL→Phase 2→FAIL cycles on the same issue, escalate to user

See [Quality Gate Protocol](quality-gate-protocol.md) for step details.

---

## Key Constraints

- **PM is sole Agent() spawner** — teammates can't use Agent() in in-process mode (#31977)
- **Architects**: Read, Grep, Glob, Bash, SendMessage (NO Write/Edit/Agent)
- **context-provider re-spawned** in each team — fresh context, no carryover
- **3 architects ALWAYS mandatory** in Execution Team. Dept leads conditional.
- **Max team size**: 6-7 peers. Beyond that, context accumulates too fast.

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
