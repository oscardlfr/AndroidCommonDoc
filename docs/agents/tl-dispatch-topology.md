---
scope: [workflow, ai-agents, pm, dispatch]
sources: [androidcommondoc]
targets: [all]
slug: tl-dispatch-topology
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead dispatch topology: pre-dispatch gate, pattern chain, dynamic scaling, autonomy rules, mandatory team workflow, kill order for dev agents."
version: 2
last_updated: "2026-04-19"
assumes_read: team-topology, tl-session-setup
token_budget: 1300
---

# team-lead Dispatch Topology

Reference for team-lead's agent dispatch rules: topology gate checks, pattern validation chain, dynamic scaling with named overflow devs, autonomy boundaries, mandatory team workflow, and kill order.

## Architect Dispatch — scope_doc_path + PREP/EXECUTE mode (Wave 23)

Every team-lead `SendMessage` to an architect MUST carry two fields: `scope_doc_path` (wave plan file) and `mode` (`PREP` or `EXECUTE`). The architect reads scope from that path (never guesses) and branches on mode.

```
SendMessage(
  to="arch-platform",
  summary="W{N} PREP — <specialty-focused 1-liner>",
  message="scope_doc_path: .planning/PLAN-W{N}.md\nmode: PREP\nwave: {N}\n\n<optional context>"
)
```

- **PREP dispatch** goes to all 3 architects in parallel **before** devs are spawned. Architects read the plan, identify domain risks, return `READY: <1-line summary>`. team-lead merges all 3 READY responses before spawning devs.
- **EXECUTE dispatch** goes to all 3 architects in parallel **after** devs complete their wave work. Architects verify, delegate any fixes, write verdict to `.planning/wave{N}/arch-{role}-verdict.md`, respond `APPROVE` or `ESCALATE: <reason>`.

Full protocol, team-lead workflow, and anti-patterns: `docs/agents/arch-dispatch-modes.md`. Fixes Wave 23 Bug #5 (hardcoded `.planning/PLAN.md`) and Bug #6 (no mode tagging).

## Specialist Dispatch — Persistent Core Specialists + Dynamic Scaling

**Core specialists** are session team peers spawned at Phase 2 start. They persist across all waves, accumulate layer knowledge, and communicate directly with their architect(s) via SendMessage.

## Pre-Dispatch Topology Gate (MANDATORY before ANY Agent() dispatch)

BEFORE calling Agent() to spawn a specialist, verify ALL:

> Applies to ALL Agent() calls — code writing, test runs, verification, builds, and any other task a session specialist could handle.

1. **Alive specialist check**: Is there a session team specialist who
   could do this? If YES → route through their architect via SendMessage.
   Do NOT spawn Agent(). Specialist already has context.
2. **Scope check**: Does task touch >3 files? If YES → MUST use session
   team specialist. Extra capacity = named peers (`{specialist}-2`) with team_name.
3. **Architect check**: Are architects alive? If YES → SendMessage
   architect with the task. team-lead NEVER dispatches specialists directly when
   architects are alive.
4. **Pressure check**: Am I dispatching because "it's faster" or "user
   is waiting"? If YES → STOP. That's the bypass anti-pattern. Route
   through architects.
5. **Architect name request**: When an architect requests a specific specialist by name via SendMessage, team-lead MUST spawn that specialist as a named team peer with the requested name. team-lead MUST NOT substitute an anonymous or differently-named agent.

Violating this gate erodes the architect verification layer — fixes land without architectural review.

**Pattern validation chain (CRITICAL):**
```
specialist needs pattern → SendMessage(to="arch-platform", "how to handle X?")
architect validates → SendMessage(to="context-provider", "pattern for X?")
context-provider responds → architect filters → sends to specialist
```
Specialist NEVER contacts context-provider directly — the architect is the quality gate.

**Work assignment:** Architects assign tasks to their core specialists via SendMessage. No team-lead relay needed for ongoing work. team-lead only spawns at Phase 2 start.

**Dynamic scaling (extra specialists):** When a core specialist is busy and the architect needs parallel work:
1. Architect sends: `SendMessage(to="team-lead", summary="need extra ui-specialist", message="Task: {desc}. Files: {list}.")`
2. team-lead spawns: `Agent(name="ui-specialist-2", team_name="session-{project-slug}", prompt="...", run_in_background=true)` — named team peer
3. Extra dev executes, returns result to team-lead, team-lead relays to architect
4. After architect verifies → extra dev dies

**Named extra devs:** All overflow devs MUST be named team peers (`{specialist}-2`, `{specialist}-3`) with team_name. No anonymous Agent() calls — unnamed devs go idle and are unreachable via SendMessage.

**Background completion → IMMEDIATELY act**: When ANY background agent completes (task notification received), IMMEDIATELY: (a) read any output files, (b) relay results to relevant architects, (c) proceed to next plan step. Do NOT wait for user prompting.

**Kill order:**
- Extra devs: DISPOSABLE — die after architect verification, no state preserved
- Core devs: die at session end only (never mid-session)
- Rotate core specialists only if context window fills (7+ waves)

## Autonomy with Escalation

team-lead is autonomous on:
- Assigning tasks to architects (they manage devs and guardians)
- Launching architect gates
- Creating branches, commits, PRs, merging feature→develop
- Coordinating multiple agents in parallel

team-lead **escalates to the user** for:
- Public API or product behavior decisions
- Architectural direction uncertainty
- Business logic without spec
- High blast radius changes
- Conflicting requirements

## Mandatory Team Workflow (non-negotiable)

Every TeamCreate session MUST include `context-provider` + `doc-updater` as peers.

1. **START**: `SendMessage(to="context-provider", ...)` — get current state before planning
2. **WORK**: architects + devs + guardians execute
3. **END**: `SendMessage(to="doc-updater", ...)` — update CHANGELOG, roadmap, memory, specs

Skipping step 1 → decisions based on stale/hallucinated context.
Skipping step 3 → documentation drift, lost decisions, stale roadmap.

## Canonical Module Paths (for grep and dispatch)

When constructing grep commands or dispatch file lists, use these exact paths (relative to project root):

| Module | Path | Owner |
|--------|------|-------|
| Audio core | `core/audio` | arch-platform |
| Media session | `core/media-session` | arch-platform |
| Data layer | `core/data` | arch-platform |
| Desktop app | `desktopApp` | arch-integration |

### Dot-notation grep examples (CORRECT)

```bash
# Correct: dot-notation — Gradle generates this automatically from catalog
grep -r "libs\.androidx\.lifecycle\.runtime\.ktx" core/audio core/media-session
grep -r "libs\.compose\.ui" desktopApp/src
grep -r "libs\.koin\.core" core/data
```

### Hyphen-notation grep examples (WRONG — do not use)

```bash
# Wrong: hyphen-notation — Gradle does NOT generate this
grep -r "libs\.androidx-lifecycle-runtime-ktx" .  # BAD
grep -r "libs\.compose-ui" .                       # BAD
```

> Hyphen-notation catalog accessors are flagged by `catalog-coverage-check.sh` (wave17-lite T3-1).

## Message Topic Discipline

Each SendMessage between team peers MUST cover ONE topic only. Mixing a CANCEL with a NEW dispatch in a single message creates ambiguous state for the receiver.

**WRONG — mixed topics:**
> "Cancel the nav-route dispatch and also add the Koin registration for FooUseCase."

**CORRECT — two messages:**
> Message 1: "Cancel the nav-route dispatch — scope changed."
> Message 2: "New task: add Koin registration for FooUseCase in appModule.kt:42."

This applies to all peer-to-peer messages: arch→dev, arch→arch, team-lead→arch.

## Spawn Prompt Hygiene

Spawn prompts use lean standby language only. No wave/round forecasts in spawn — work arrives via SendMessage post-spawn. Full guidance: `docs/agents/agent-core-rules.md#spawn-prompt-hygiene`.
