---
scope: [workflow, ai-agents, pm, execution]
sources: [androidcommondoc]
targets: [all]
slug: pm-phase-execution
status: active
layer: L0
parent: agents-hub
category: agents
description: "Project Manager's 3-phase execution protocol: phase transitions, triggers, anti-patterns, execution checklist. What PM does in each phase (complements team-topology.md which describes team structure)."
version: 2
last_updated: "2026-04"
assumes_read: team-topology, multi-agent-patterns
token_budget: 1200
---

# PM Phase Execution Protocol

This doc defines the Project Manager's execution protocol across the 3-phase model. See [Team Topology](team-topology.md) for the team structure and peer roster.

## 3-Phase Execution Model

**CRITICAL: When you have a plan and the user approves → IMMEDIATELY call TeamCreate. Do NOT keep planning, capturing decisions, or creating more tasks. The NEXT tool call after approval MUST be TeamCreate.**

See [Team Topology](team-topology.md) for full details.

**Phase 1 — Planning Team**: `TeamCreate("planning-{project-slug}")` → planner only. Skip for simple tasks.
Planner uses `SendMessage(to="context-provider")` to get project state (context-provider is a session team peer).

**Plan delivery**: Planner writes the plan to `.planning/PLAN.md` (not via SendMessage — large messages get truncated to idle notification summaries). After planner notifies via SendMessage, PM reads the plan with `Read(".planning/PLAN.md")`.

**Phase 2 — Execution (WHERE CODE GETS WRITTEN)**:
Architects are already session team peers — no new TeamCreate needed.
```
SendMessage(to="arch-testing", summary="phase 2 start", message="{plan + scope}")
SendMessage(to="arch-platform", summary="phase 2 start", message="{plan + scope}")
SendMessage(to="arch-integration", summary="phase 2 start", message="{plan + scope}")
```
1. PM sends plan to session team architects via SendMessage (no new TeamCreate needed)
2. Architects use `SendMessage(to="context-provider")` for patterns/rules
3. Architects investigate → SendMessage PM requesting devs
4. **PM IMMEDIATELY spawns devs** via Agent() relay
5. PM relays dev results back to requesting architect
6. After work: `SendMessage(to="doc-updater")` to update CHANGELOG/docs
7. All 3 APPROVE → **IMMEDIATELY proceed to Phase 3** (do NOT ask user, do NOT commit yet)

**Phase 3 — Quality Gate (MANDATORY before any commit)**:
```
SendMessage(to="quality-gater", message="{phase 2 verdicts and context}")
```
quality-gater is already a session peer — no re-spawning needed. Can SendMessage directly to architects (same team — no cross-team complexity). Uses `SendMessage(to="context-provider")` for project rules, AND consults persistent architects for Phase 2 context (decisions, deviations, unresolved concerns).
PASS → PM commits. FAIL → back to Phase 2 (max 3 retries).

**PHASE TRANSITIONS ARE AUTOMATIC — never ask the user between phases:**
```
Plan approved → IMMEDIATELY SendMessage to session team architects (Phase 2)
All architects APPROVE → IMMEDIATELY spawn quality-gater in session team (Phase 3)
quality-gater PASS → IMMEDIATELY commit
quality-gater FAIL → IMMEDIATELY back to SendMessage architects (Phase 2 retry)
```

**Anti-patterns (each one is a template bug if it happens):**
- PM asks "shall I commit?" before running quality gate → BUG
- PM asks "what next?" after architect approval → BUG
- PM creates tasks/memories between phases instead of proceeding → BUG
- PM spawns extra devs without name or team_name (anonymous Agent() calls) — ALL overflow devs MUST be named peers (`{specialist}-2`) with team_name → BUG
- Architect requests named specialist via SendMessage and PM substitutes anonymous or differently-named agent — PM MUST honor the requested name → BUG
- PM uses TeamCreate for architects in Phase 2 (they're persistent, use SendMessage) → BUG
- PM creates new TeamCreate per wave instead of reusing session team → BUG
- PM re-spawns an architect as "arch-X-v2" instead of SendMessage to the original → BUG. **RULE: If an architect seems unresponsive → SendMessage first. If no response after 1 retry → re-spawn with the SAME name AND SAME team_name (e.g. `Agent(name="arch-platform", team_name="session-{project-slug}", ...)`), never append "v2" or any suffix.**

## Execution Trigger Checklist
```
□ Plan approved?           → SendMessage to session team architects NOW
□ All architects APPROVE?  → SendMessage quality-gater in session team NOW
□ quality-gater PASS?      → commit NOW
□ quality-gater FAIL?      → SendMessage to architects NOW (with failure context)
→ If you're asking the user what to do between phases: YOU HAVE A BUG.
```

See also [Team Topology](team-topology.md), [Multi-Agent Patterns](multi-agent-patterns.md).

## Context Management

- **Peers accumulate context** — keep the team small (only agents that need coordination)
- **Sub-agents get fresh context** — prefer Agent() for workers to avoid context bloat
- **Summarize between waves** — before starting wave N+1, summarize wave N findings in 1-2 sentences
- **Call doc-updater mid-session** for long work (5+ waves) to archive decisions to disk

Architects handle ALL investigation, code reading, and delegation to devs/guardians. PM NEVER looks at code.
