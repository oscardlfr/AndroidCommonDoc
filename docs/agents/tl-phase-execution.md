---
scope: [workflow, ai-agents, pm, execution]
sources: [androidcommondoc]
targets: [all]
slug: tl-phase-execution
status: active
layer: L0
parent: agents-hub
category: agents
description: "Team Lead's 3-phase execution protocol: phase transitions, triggers, anti-patterns, execution checklist. What team-lead does in each phase (complements team-topology.md which describes team structure)."
version: 2
last_updated: "2026-04"
assumes_read: team-topology, multi-agent-patterns
token_budget: 1200
---

# team-lead Phase Execution Protocol

This doc defines the Team Lead's execution protocol across the 3-phase model. See [Team Topology](team-topology.md) for the team structure and peer roster.

## 3-Phase Execution Model

**CRITICAL: When you have a plan and the user approves → IMMEDIATELY dispatch architects. Do NOT keep planning, capturing decisions, or creating more tasks. The NEXT tool call after approval MUST be architect dispatch.**

See [Team Topology](team-topology.md) for full details.

**Phase 1 — Planning**: `Agent(subagent_type="planner", ...)` — no `team_name` required. Skip for simple tasks.
**Plan mode gate**: orchestrator calls `EnterPlanMode()` before spawning the planner. This blocks file writes until user approval — the planner (as a subagent) writes PLAN.md normally. Orchestrator calls `ExitPlanMode()` on user approval, immediately before dispatching architects.
Planner consults context-provider (via SendMessage if live background peer, or as a fresh single-use subagent) to get project state.

**Plan delivery**: Planner writes the plan to `.planning/PLAN.md` (disk artifact — authoritative). After planner notifies, orchestrator reads the plan from disk with `Read(".planning/PLAN.md")`.

**Wave PLAN.md flow** (mandatory before any architect dispatch):
1. Create wave dir.
2. `EnterPlanMode()` → spawn planner → wait for `PLAN-WRITTEN` reply (or poll disk).
3. `ExitPlanMode()` → dispatch arch-* subagents with `scope_doc_path` pointing to planner-authored PLAN.md.
Shortcutting to spawn planner later while dispatching architects → **FORBIDDEN**. No PLAN.md = no architect dispatch.

**Phase 2 — Execution (WHERE CODE GETS WRITTEN)**:
Dispatch architects as concurrent subagents (or SendMessage to background peers if already alive):
```
// Single-use concurrent dispatch (default):
Agent(subagent_type="arch-testing", prompt="scope_doc_path: .planning/PLAN.md\nmode: EXECUTE\n...")
Agent(subagent_type="arch-platform", prompt="scope_doc_path: .planning/PLAN.md\nmode: EXECUTE\n...")
Agent(subagent_type="arch-integration", prompt="scope_doc_path: .planning/PLAN.md\nmode: EXECUTE\n...")

// Background peer dispatch (optional accelerator):
SendMessage(to="arch-testing", summary="phase 2 start", message="scope_doc_path: .planning/PLAN.md\nmode: EXECUTE\n{plan + scope}")
```
1. Architects use context-provider for patterns/rules (via SendMessage or as subagent)
2. Architects investigate → request specialists from orchestrator via SendMessage or disk spec
3. **Orchestrator IMMEDIATELY spawns specialists** via Agent()
4. Orchestrator relays specialist results back to requesting architect
5. After work: orchestrator dispatches doc-updater to update CHANGELOG/docs
6. Each architect writes `arch-{role}-verdict.md` (HEAD-bound) to disk
7. All 3 verdict files on disk + APPROVE status → **IMMEDIATELY proceed to Phase 3** (do NOT ask user, do NOT commit yet)

**Phase 3 — Quality Gate (MANDATORY before any commit)**:
```
Agent(subagent_type="quality-gater", prompt="{phase 2 verdicts summary and context}")
```
quality-gater reads arch-*-verdict.md files from disk and optionally SendMessages live background peer architects. Uses context-provider for project rules. Writes `quality-gate-report.json` + stamps + `push-proof.json` to disk.
Orchestrator reads proof from disk. PASS → commit. FAIL → back to Phase 2 (max 3 retries).

**PHASE TRANSITIONS ARE AUTOMATIC — never ask the user between phases:**
```
Plan approved → IMMEDIATELY dispatch architects (Phase 2)
All arch-*-verdict.md on disk + APPROVE → IMMEDIATELY spawn quality-gater (Phase 3)
quality-gate-report.json PASS on disk → IMMEDIATELY commit
quality-gate-report.json FAIL → IMMEDIATELY back to architect dispatch (Phase 2 retry)
```

**Anti-patterns (each one is a template bug if it happens):**
- Orchestrator asks "shall I commit?" before running quality gate → BUG
- Orchestrator asks "what next?" after architect approval → BUG
- Orchestrator creates tasks/memories between phases instead of proceeding → BUG
- Orchestrator spawns extra specialists without a name (anonymous Agent() calls) — ALL overflow specialists MUST be named (`{specialist}-2`) → BUG
- Architect requests named specialist via SendMessage and orchestrator substitutes differently-named agent — orchestrator MUST honor the requested name → BUG
- Orchestrator re-spawns a background peer architect instead of SendMessage to the original → BUG. **RULE: If a background peer architect seems unresponsive → SendMessage first. If no response after 1 retry → kill-then-respawn: dispatch context-provider `write_bundle(role, ...)` so the bundle is on disk pre-kill ([context-bundle-schema](context-bundle-schema.md)), gracefully terminate the old peer (shutdown_request), then re-spawn the CANONICAL name (`Agent(name="arch-platform", subagent_type="arch-platform", run_in_background=true, ...)`) with a prompt opening with the bundle-read mandate. NEVER use free-form names for agents holding Write/Bash/gh — non-canonical names are invisible to type-keyed gates (firing matrix §5).**

## Execution Trigger Checklist
```
□ Plan approved?           → SendMessage the architects NOW (or Agent-spawn if not live)
□ All architects APPROVE?  → SendMessage the quality-gater NOW (or Agent-spawn if not live)
□ quality-gater PASS?      → commit NOW
□ quality-gater FAIL?      → SendMessage to architects NOW (with failure context)
→ If you're asking the user what to do between phases: YOU HAVE A BUG.
```

See also [Team Topology](team-topology.md), [Multi-Agent Patterns](multi-agent-patterns.md).

## PLAN.md Modularization (Wave 22 pattern)

**Master PLAN.md** (≤80 lines) is the sprint index — navigation only. Per-wave detail lives in `.planning/PLAN-W{N}.md`.

| File | Max lines | Content |
|------|-----------|---------|
| `.planning/PLAN.md` | ≤80 | Sprint table, scope-files list, acceptance criteria, risks |
| `.planning/PLAN-W{N}.md` | no limit | Per-sprint detail: blocked-by, sub-tasks, notes for planner |

**Planner writes both files.** team-lead reads master PLAN.md at activation (stays ≤80 lines). Per-wave detail loaded on demand when sprinting.

**Why**: Wave 21 PLAN.md grew to 326 lines. team-lead context loaded the full file eagerly — ~50K tokens per activation. Modular split keeps master under 80 lines without losing sprint detail.

## Context Management

- **Peers accumulate context** — keep the team small (only agents that need coordination)
- **Sub-agents get fresh context** — prefer Agent() for workers to avoid context bloat
- **Summarize between waves** — before starting wave N+1, summarize wave N findings in 1-2 sentences
- **Call doc-updater mid-session** for long work (5+ waves) to archive decisions to disk

Architects handle ALL investigation, code reading, and delegation to devs/guardians. team-lead NEVER looks at code.

## FORBIDDEN Actions

**FORBIDDEN**: team-lead Write/Edit on `.planning/wave-*/PLAN.md` — that file is planner exclusive work-product.
Rule: `feedback_planner_owns_plan_md`. Violation recovery: dispatch planner with RATIFY-WITH-EDITS or REJECT-AND-REWRITE.
