---
scope: [workflow, ai-agents, multi-agent, teams]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: team-topology
status: active
layer: L0
parent: agents-hub
category: agents
description: "3-phase model with disk-artifact contract. Orchestrator fans out concurrent Agent subagents (+ optional background peers). Load-bearing results live on disk — PLAN.md, arch-*-verdict.md, QG artifacts. Planning → Execution → Quality Gate."
version: 6
last_updated: "2026-06"
assumes_read: autonomous-multi-agent-workflow, context-rotation-guide
token_budget: 1500
---

# Team Topology: 3-Phase Model

Three sequential phases, each lightweight. The harness is **multi-agent capable**: the orchestrator fans out to concurrent `Agent` subagents, and **background peers + `Task*`/`SendMessage` coordination remain a fully-supported optional accelerator** when the runtime offers them.

**Load-bearing contract (authoritative):** disk artifacts — `PLAN.md`, `arch-*-verdict.md` (HEAD-bound), `quality-gate.stamp`, `quality-gate-report.json`, `push-proof.json`. Orchestrator reads these; correctness is decided here. This contract is runtime-agnostic and survives unreliable or absent messaging.

**Execution / accelerator (supported, not required):** multi-agent fan-out, background peers with `run_in_background`, `Task*`/`SendMessage` coordination. These are progressive enhancements over the disk contract, never a completion dependency.

The project slug is derived from the project directory name (lowercased, hyphens replacing spaces — e.g., `MyApp` becomes `my-app`).

---

## Two-Layer Architecture

| Layer | What | Status |
|-------|------|--------|
| **Load-bearing contract (T1/T2)** | Disk artifacts: `PLAN.md`, `arch-*-verdict.md` (HEAD-bound), stamps, `quality-gate-report.json`, `push-proof.json`, git/CI. Orchestrator reads these; correctness is decided here. | **Authoritative.** Runtime-agnostic. |
| **Execution / accelerator (T3)** | Orchestrator fans out to concurrent `Agent` subagents (default). Background peers + `Task*`/`SendMessage` coordination remain supported when the runtime offers them. | **Supported & encouraged, but never load-bearing.** |

Rules: (a) any multi-agent path MUST land its load-bearing result as a disk artifact; (b) gates verify those artifacts, not who/how many agents were spawned; (c) `TeamCreate`/`team_name`/named-team dirs are not required — a runtime that offers them may use them, but the harness does not depend on them; (d) messaging is progressive enhancement, never a completion dependency.

---

## Agent Roles

| Agent | Role | Phase |
|-------|------|-------|
| context-provider | On-demand oracle: patterns, docs, rules, external library docs (Context7) | All |
| doc-updater | CHANGELOG, docs, KDoc | Phase 2, 3 |
| arch-testing | Test strategy, coverage, test gaming — writes `arch-testing-verdict.md` | Phase 2, 3 |
| arch-platform | Source sets, Gradle, platform boundaries — writes `arch-platform-verdict.md` | Phase 2, 3 |
| arch-integration | Cross-module deps, DI, API contracts — writes `arch-integration-verdict.md` | Phase 2, 3 |
| test-specialist | Test compliance, generation, TDD | Phase 2 |
| ui-specialist | Compose UI, accessibility, Material3 | Phase 2 |
| domain-model-specialist | Domain model, sealed hierarchies, mappers | Phase 2 |
| data-layer-specialist | Repositories, data sources, caching | Phase 2 |
| toolkit-specialist | MCP server (TS), hooks, shell scripts, PS1 scripts | Phase 2 |

**Spawning:** roles are dispatched as single-use foreground `Agent` subagents (default) or as background peers when the runtime supports them. Each lands its result as a disk artifact the orchestrator reads. `context-provider` is an on-demand oracle — loaded when asked, not eagerly. Core specialists accumulate layer knowledge across waves.

**Context rotation for long sessions (5+ waves):** CP writes the role's context bundle FIRST (`write_bundle` → `.planning/wave-{slug}/context-bundles/{role}.md`, [context-bundle-schema](context-bundle-schema.md)) → graceful shutdown → re-spawn the CANONICAL name with a prompt opening with the bundle-read mandate. See [context-rotation-guide](context-rotation-guide.md) §3.


## Core Specialist Lifecycle

Five core specialists (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist, toolkit-specialist) are dispatched at Phase 2 start.

- **Dispatch**: orchestrator spawns all 5 when Phase 2 begins — as single-use subagents or background peers
- **Work**: Architects assign tasks; specialists execute across waves and land results on disk
- **Knowledge**: Specialists accumulate layer expertise across waves when run as background peers; single-use subagents receive per-task context
- **Rotation**: Rotate (kill-then-respawn with context bundle) only when context fills (7+ waves for background peers)
- **Reporting**: Each specialist reports to specific architect(s) — see Agent table above

## Pattern Validation Chain

Specialists NEVER contact context-provider directly. The architect is the quality gate:

```
specialist needs pattern -> SendMessage(to="arch-platform", "how to handle X?")
architect validates -> SendMessage(to="context-provider", "pattern for X?")
context-provider responds -> architect filters -> sends to specialist
```

This ensures architects validate every pattern before it reaches specialist code.

**External context path**: context-provider: internal miss -> Context7 lookup -> architect filters -> specialist

## Dynamic Scaling

When a core specialist is busy and the architect needs parallel work:

1. Architect sends: `SendMessage(to="team-lead", "need extra ui-specialist")`
2. Orchestrator spawns: `Agent(name="ui-specialist-2", subagent_type="ui-specialist", run_in_background=true, prompt="...")` — named subagent
3. Extra specialist executes, returns result to orchestrator, orchestrator relays to architect
4. After architect verifies → extra specialist dismissed

**Named extra specialists (MANDATORY):** All overflow specialists MUST be named (`{specialist}-2`, `{specialist}-3`). Anonymous Agent() calls are FORBIDDEN — unnamed specialists are unreachable via SendMessage and invisible to type-keyed gates.

**Architect-name-honoring (MANDATORY):** When an architect requests a specific specialist by name via SendMessage, the orchestrator MUST spawn that specialist with the requested name. The orchestrator MUST NOT substitute an anonymous or differently-named agent.

## Overview

```
Phase 1 — Planning (planner subagent)
  orchestrator spawns planner (single-use Agent or background peer)
  planner queries context-provider for project state
  planner writes PLAN.md to disk
  orchestrator reads PLAN.md → planner dismissed

Phase 2 — Execution (architects dispatched per plan)
  orchestrator dispatches arch-testing/platform/integration with plan assignments
  architects query context-provider for patterns/rules
  architects assign work to specialists via SendMessage or disk spec
  each arch writes arch-{role}-verdict.md (HEAD-bound) to disk
  doc-updater dispatched after work
  All 3 verdicts on disk + APPROVE → phase complete

Phase 3 — Quality Gate (quality-gater subagent)
  quality-gater deliberates with architects (via SendMessage or reading verdicts)
  quality-gater runs automated checks (see quality-gate-protocol.md)
  quality-gater writes quality-gate-report.json + stamps + push-proof.json to disk
  PASS → orchestrator commits. FAIL → back to Phase 2 (max 3 retries → user)
```

---

## Phase 1: Planning

**Purpose**: Produce a structured execution plan before any code is written.

**Flow**:
1. Orchestrator spawns planner: `Agent(subagent_type="planner", ...)` — no `team_name` required
2. Planner queries context-provider for current state (via SendMessage if context-provider is a live background peer, or by reading its context bundle from disk)
3. Planner reads architecture docs, specs, MODULE_MAP.md
4. Planner produces plan with: scope, steps, architect assignments, dependencies, risks
5. Planner writes plan to `.planning/PLAN.md` (disk artifact — authoritative)
6. Planner notifies orchestrator: `"Plan ready: .planning/PLAN.md"` (via SendMessage if supported, or orchestrator polls the file)
7. Orchestrator reads plan from disk, planner dismissed

**Cross-department check**: If planner flags product/marketing impact, orchestrator spawns product-strategist or content-creator as sub-agents for review before proceeding.

**Skip condition**: Simple/obvious tasks (< 5K tokens, clear path) — orchestrator plans inline, no planner needed.

---

## Phase 2: Execution

**Purpose**: Implement the plan with architect-verified quality.

**Flow**:
1. Orchestrator dispatches arch-testing, arch-platform, arch-integration with plan assignments (via SendMessage to live background peers, or as concurrent single-use Agent subagents)
2. Architects query context-provider for patterns and project rules
3. Architects detect issues using MCP tools (code-metrics, verify-kmp-packages, dependency-graph, etc.)
4. Architects assign tasks to core specialists via SendMessage or by writing a disk spec
5. For overflow: orchestrator spawns extra specialist subagents on architect request
6. Architects cross-verify via SendMessage
7. Each architect writes `arch-{role}-verdict.md` (HEAD-bound) to disk
8. After work: orchestrator dispatches doc-updater to update CHANGELOG/docs
9. All 3 verdicts on disk + APPROVE status → phase complete
10. Any ESCALATE → orchestrator re-plans (never codes the fix)

**Wave pattern**: For large tasks, multiple detect/fix/verify cycles. Background peers retain full context between waves; single-use subagents receive per-dispatch context.

**Context management**: For long sessions (5+ waves with background peers), rotate kill-then-respawn: CP writes context bundle first → graceful shutdown → re-spawn the CANONICAL name. See [context-rotation-guide](context-rotation-guide.md) §3.

---

## Phase 3: Quality Gate

**Purpose**: Verify quality before commit. Architect deliberation, then sequential automated gates.

**Temporary subagent**: quality-gater (spawned as single-use Agent, then dismissed after PASS/FAIL)

**Flow**:
1. Orchestrator spawns quality-gater: `Agent(subagent_type="quality-gater", ...)` — no `team_name` required
2. **Architect Deliberation** — quality-gater consults all 3 architects by reading their `arch-*-verdict.md` files, and optionally via SendMessage if architects are live background peers:
   - arch-testing — what was tested, known gaps, coverage concerns
   - arch-platform — source set changes, platform boundary risks
   - arch-integration — cross-module impacts, DI wiring, API changes
3. quality-gater runs automated protocol (see [quality-gate-protocol](quality-gate-protocol.md))
4. quality-gater writes `quality-gate-report.json` + `quality-gate.stamp` + `push-proof.json` to disk (canonical QG truth). Notifies orchestrator via SendMessage if supported.
5. PASS — orchestrator reads proof from disk, commits, dismisses quality-gater
6. FAIL — orchestrator re-enters Phase 2 with failure context from `quality-gate-report.json`
7. **Max 3 retries** — after 3 FAIL/Phase 2/FAIL cycles on the same issue, escalate to user

**Why deliberation matters**: Architects hold Phase 2 context that automated checks cannot see. Reading verdict files captures recorded decisions; direct SendMessage captures live concerns. Deliberation prevents false positives and catches gaps.

See [Quality Gate Protocol](quality-gate-protocol.md) for step details.

---

## Key Constraints

- **Orchestrator is sole Agent() spawner** — background peers cannot use Agent() in in-process mode (#31977)
- **Architects**: Read, Grep, Glob, Bash, SendMessage (NO Write/Edit/Agent)
- **Disk artifacts are authoritative** — `arch-*-verdict.md` (HEAD-bound), `quality-gate-report.json`, `push-proof.json`. Gates verify these files, not who/how many agents were spawned.
- **Phase 3 deliberation is mandatory** — quality-gater MUST read all 3 arch-*-verdict.md files (and optionally SendMessage live architects) before running automated checks. Skipping deliberation voids the gate.
- **Core specialists dispatched at Phase 2 start** — orchestrator spawns the 5 core specialists when Phase 2 begins. For long sessions with background peers (5+ waves), rotate kill-then-respawn (canonical name; see [context-rotation-guide](context-rotation-guide.md) §3).
- **Pattern validation chain** — specialists NEVER contact context-provider directly; architect is the quality gate.
- **Project-specific agents MUST be in routing table** — guardians, validators, domain specialists. If the routing table doesn't list a domain, architects can't request specialists for it.

---

## When to Use 3-Phase vs Single Agent

| Signal | Model |
|--------|-------|
| Non-trivial task (3+ files, multiple domains) | 3-phase multi-agent |
| Simple bug fix (1-2 files, clear path) | Single agent, no subagents |
| Cross-department impact | 3-phase + dept lead sub-agents |
| Urgent hotfix | Skip planning phase, minimal execution + quality gate |

---

## Known Platform Considerations

**Messaging is progressive enhancement**: SendMessage between background peers is a supported optional accelerator. The load-bearing contract is always disk artifacts. If peer messaging is unreliable or absent, the wave still completes because the contract is files.

**SendMessage routing**: Address peers by canonical role name (e.g., `SendMessage(to="arch-testing")`). Individual messages are more reliable than any broadcast pattern.

**Named team dirs** (`~/.claude/teams/`): present only when the runtime creates them. Gates do not require these dirs — they verify disk artifacts in the wave directory instead.

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology overview, agent design rules, failure handling
- [Data Handoff Patterns](data-handoff-patterns.md) — structured markers, severity, report formats
- [Quality Gate Protocol](quality-gate-protocol.md) — detailed gate steps
- [Context Rotation Guide](context-rotation-guide.md) — managing context across team phases
