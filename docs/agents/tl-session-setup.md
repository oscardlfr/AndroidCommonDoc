---
scope: [workflow, ai-agents, pm, session-setup]
sources: [androidcommondoc]
targets: [all]
slug: tl-session-setup
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead session setup: Phase 2 core dev spawning, selective spawning, rotation protocol, context management, architect routing."
version: 1
last_updated: "2026-04"
assumes_read: team-topology, tl-phase-execution
token_budget: 1500
---

# team-lead Session Setup

Reference for team-lead's session initialization: Phase 2 core dev spawning, selective spawning rules, long-session rotation, context management, architect routing, and correct TeamCreate patterns.

## Phase 2 Core Devs

When Phase 2 execution begins, team-lead spawns 4 core layer devs as named session team members:
```
Agent(name="test-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are test-specialist for this session. Your reporting architect is arch-testing. Ask arch-testing for patterns via SendMessage — NEVER contact context-provider directly. Stay alive across all waves.")
Agent(name="ui-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are ui-specialist for this session. Your reporting architect is arch-testing. Ask arch-testing for patterns via SendMessage — NEVER contact context-provider directly. Stay alive across all waves.")
Agent(name="domain-model-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are domain-model-specialist for this session. Your reporting architect is arch-platform. Ask arch-platform for patterns via SendMessage — NEVER contact context-provider directly. Stay alive across all waves.")
Agent(name="data-layer-specialist", team_name="session-{project-slug}", run_in_background=true, prompt="You are data-layer-specialist for this session. Your reporting architects are arch-platform and arch-integration. Ask them for patterns via SendMessage — NEVER contact context-provider directly. Stay alive across all waves.")
```

**Selective spawning (MANDATORY — evaluate BEFORE any Agent() call)**: You MUST produce a scope evaluation table BEFORE calling Agent() to spawn any core dev. Format:

| Layer | Tasks in plan | Spawn? |
|---|---|---|
| test | {count} | YES/SKIP |
| ui | {count} | YES/SKIP |
| domain | {count} | YES/SKIP |
| data | {count} | YES/SKIP |

Skip specialists with zero tasks. Do NOT default to spawning all 4. Log skipped devs: "Skipping {name} — no work in sprint scope". Architects can still request a skipped dev mid-sprint via SendMessage to team-lead.

> 35K tokens were wasted on an idle ui-specialist in a data/domain-only sprint.

Core devs live until session end — same lifecycle as architects. They accumulate layer knowledge across waves. They live in the `session-{project-slug}` team — all agents reach them via `SendMessage(to="context-provider")`, `SendMessage(to="doc-updater")`, `SendMessage(to="arch-testing")`, etc.

**Why session team peers**: context-provider reads the project ONCE. Architects retain Phase 2 context — quality-gater in Phase 3 can consult them for decisions, deviations, and unresolved concerns. Team peers are always reachable via SendMessage — no idle/dead confusion, no re-spawning needed.

**Rotation**: for long sessions (5+ waves), re-spawn with SAME name AND SAME team_name: `Agent(name="context-provider", team_name="session-{project-slug}", ...)` — replaces the old peer in the team.

**Long-session rotation protocol**: If a core dev has accumulated 15+ tool uses AND 150k+ tokens AND has failed a single dispatch 2+ times, STOP retrying. Either:
(a) Architect requests team-lead rotate the dev (re-spawn with SAME name and SAME team_name — clears persistent context), OR
(b) team-lead spawns a named overflow dev (e.g. `{specialist}-2`, team_name="session-{project-slug}") for the specific failing task.

Do NOT continue retrying with a context-bloated dev — retries will keep failing due to attention anchoring to past work.

## Context Management

- **Peers accumulate context** — keep the team small (only agents that need coordination)
- **Sub-agents get fresh context** — prefer Agent() for workers to avoid context bloat
- **Summarize between waves** — before starting wave N+1, summarize wave N findings in 1-2 sentences
- **Call doc-updater mid-session** for long work (5+ waves) to archive decisions to disk

Architects handle ALL investigation, code reading, and delegation to devs/guardians. team-lead NEVER looks at code.

## Architect Routing Table

| Issue domain | Assign to | Why |
|-------------|-----------|-----|
| Tests, test quality, TDD, coverage | `arch-testing` | Manages test-specialist, ui-specialist |
| KMP patterns, encoding, data layer, domain model, source sets | `arch-platform` | Manages domain-model-specialist, data-layer-specialist |
| UI wiring, DI, navigation, buttons, compilation, feature gates | `arch-integration` | Manages ui-specialist, data-layer-specialist |
| Cross-cutting (touches multiple domains) | Launch 2-3 architects in parallel | Each handles their domain |

## Session Team Setup Patterns

**Use `TeamCreate("session-{project-slug}")` at session start. 6 core agents join at session start; 4 core devs join at Phase 2 start.**

```
// CORRECT — session peers reach each other via SendMessage
TeamCreate(team_name="session-{project-slug}")
Agent(name="context-provider", team_name="session-{project-slug}", run_in_background=true, prompt="...")
Agent(name="arch-testing", team_name="session-{project-slug}", run_in_background=true, prompt="...")

// WRONG — no team_name (go idle, team-lead confuses idle with dead → "v2" re-spawns)
Agent(name="arch-testing", run_in_background=true, prompt="...")
// WRONG — Bash spawning or team-lead reading source code
Bash("claude --print '...'")
```
