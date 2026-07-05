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

**Plan delivery**: Planner writes the plan to `.planning/wave-<slug>/PLAN.md` (disk artifact — authoritative). After planner notifies, orchestrator reads the plan from disk with `Read(".planning/wave-<slug>/PLAN.md")`.

**Wave PLAN.md flow** (mandatory before any architect dispatch):
1. Create wave dir.
2. `EnterPlanMode()` → spawn planner → wait for `PLAN-WRITTEN` reply (or poll disk).
3. `ExitPlanMode()` → dispatch arch-* subagents with `scope_doc_path` pointing to planner-authored PLAN.md.
Shortcutting to spawn planner later while dispatching architects → **FORBIDDEN**. No PLAN.md = no architect dispatch.

**Phase 2 — Execution (WHERE CODE GETS WRITTEN)**:
Dispatch architects as concurrent subagents (or SendMessage to background peers if already alive):
```
// Single-use concurrent dispatch (default):
Agent(subagent_type="arch-testing", prompt="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n...")
Agent(subagent_type="arch-platform", prompt="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n...")
Agent(subagent_type="arch-integration", prompt="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n...")

// Background peer dispatch (optional accelerator):
SendMessage(to="arch-testing", summary="phase 2 start", message="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n{plan + scope}")
```
1. Architects use context-provider for patterns/rules (via SendMessage or as subagent)
2. Architects investigate → request specialists from orchestrator via SendMessage or disk spec
3. **Orchestrator IMMEDIATELY spawns specialists** via Agent() — first writing a disk dispatch artifact scoping the specialist's authorized `files[]` (see [specialist-dispatch-protocol.md](specialist-dispatch-protocol.md))
4. Orchestrator relays specialist results back to requesting architect
5. After work: orchestrator dispatches doc-updater to update CHANGELOG/docs
6. Each architect writes `arch-{role}-verdict.md` (HEAD-bound) to disk
7. All 3 verdict files on disk + APPROVE status → **IMMEDIATELY proceed to Phase 3** (do NOT ask user, do NOT commit yet)

**Phase 3 — Quality Gate (MANDATORY before any commit)**:
```
Agent(subagent_type="quality-gater", prompt="{phase 2 verdicts summary and context}")
```
quality-gater reads arch-*-verdict.md files from disk and optionally SendMessages live background peer architects. Uses context-provider for project rules. Writes `quality-gate-report.json` + stamps + `push-proof.json` + `qg-result.json` to disk.

**Orchestrator polls `qg-result.json`** at `.planning/wave-<slug>/qg-result.json` — three DISTINCT branches:

| `qg-result.json` state | Orchestrator action |
|------------------------|---------------------|
| **File ABSENT** | WAIT — do NOT attempt recovery; absence does not mean failure. Fresh-spawn false-trigger guard: quality-gater may not have initialized yet. |
| **`status: running` + `updated_at` stale > ~20 min** | HUNG — quality-gater is stuck (a healthy long step does NOT false-trigger: the gater bumps `--phase` before each long step — /pre-pr, test-suite — so `updated_at` stays fresh throughout). TaskStop the peer, then lean re-dispatch: spawn fresh quality-gater with the same scope. |
| **`status: pass` or `status: fail`, HEAD-matched** | QG phase is done: `pass` → proceed to the commit step; `fail` → back to Phase 2 (max 3 retries). |

HEAD-match check: `qg-result.json ".head"` must equal `git rev-parse HEAD`. A result for a prior commit is stale; treat as ABSENT.

**`qg-result.json` is a progression signal, not authority.** A HEAD-matched `pass` tells the orchestrator the QG phase finished and passed, so it may proceed to the commit/ship step — but the authority to commit and push is `push-proof.json` + a fresh `quality-gate.stamp` + `pre-pr.stamp` + `verify-proof`, all bound to HEAD. `qg-result.json` is never consulted by `verify-proof` or the pre-push hook and is never a substitute for `push-proof.json`. See [qg-proof-push-gate](qg-proof-push-gate.md).

**PHASE TRANSITIONS ARE AUTOMATIC — never ask the user between phases:**
```
Plan approved → IMMEDIATELY dispatch architects (Phase 2)
All arch-*-verdict.md on disk + APPROVE → IMMEDIATELY spawn quality-gater (Phase 3)
qg-result.json status:pass (HEAD-matched) → IMMEDIATELY proceed to commit (authorized by push-proof.json + stamps + verify-proof, not by qg-result itself)
qg-result.json status:fail (HEAD-matched) → IMMEDIATELY back to architect dispatch (Phase 2 retry)
```

**Anti-patterns (each one is a template bug if it happens):**
- Orchestrator asks "shall I commit?" before running quality gate → BUG
- Orchestrator asks "what next?" after architect approval → BUG
- Orchestrator creates tasks/memories between phases instead of proceeding → BUG

**Background-peer hygiene (Claude-rich mode only — the accelerator, not the floor):** these apply *when* the orchestrator runs live background peers. In portable/single-use mode they do not apply — single-use agents land disk artifacts and need no names.
- Spawning overflow specialists anonymously: a named overflow specialist (`{specialist}-2`) is reachable via SendMessage; an anonymous `Agent()` peer is not. (Portable/single-use mode: anonymous single-use specialists are fine — the disk artifact is the contract.)
- Substituting a differently-named agent for an architect's requested peer name — honor the requested name so SendMessage routing resolves. (Portable mode: names are irrelevant.)
- Re-spawning a background peer architect instead of SendMessage to the original. **RULE: If a background peer architect seems unresponsive → SendMessage first. If no response after 1 retry → kill-then-respawn: dispatch context-provider `write_bundle(role, ...)` so the bundle is on disk pre-kill ([context-bundle-schema](context-bundle-schema.md)), gracefully terminate the old peer (shutdown_request), then re-spawn the CANONICAL name (`Agent(name="arch-platform", subagent_type="arch-platform", run_in_background=true, ...)`) with a prompt opening with the bundle-read mandate. NEVER use free-form names for agents holding Write/Bash/gh — non-canonical names are invisible to type-keyed gates (firing matrix §5).**

## Execution Trigger Checklist
```
□ Plan approved?                                    → SendMessage the architects NOW (or Agent-spawn if not live)
□ All architects APPROVE?                           → SendMessage the quality-gater NOW (or Agent-spawn if not live)
□ qg-result.json status:pass (HEAD-matched)?        → proceed to commit NOW (commit/push gated by push-proof.json + stamps + verify-proof, not qg-result)
□ qg-result.json status:fail (HEAD-matched)?        → SendMessage to architects NOW (with failure context)
□ qg-result.json absent?                            → WAIT (do not recover)
□ qg-result.json status:running + stale >~20 min?  → TaskStop + lean re-dispatch
→ If you're asking the user what to do between phases: YOU HAVE A BUG.
```

See also [Team Topology](team-topology.md), [Multi-Agent Patterns](multi-agent-patterns.md).

## PLAN.md size discipline

Keep the active wave's `.planning/wave-<slug>/PLAN.md` focused — a sprint index plus the wave's scope-files list, acceptance criteria, and risks. Per-task detail (blocked-by, sub-tasks, planner notes) belongs in later sections of the same file or a sibling note in the wave dir, loaded on demand rather than eagerly.

The planner writes it; team-lead reads it at activation. Keep it lean so activation does not eagerly load tens of thousands of tokens of context — the failure mode that motivated this discipline.

## Context Management

- **Peers accumulate context** — keep the team small (only agents that need coordination)
- **Sub-agents get fresh context** — prefer Agent() for workers to avoid context bloat
- **Summarize between waves** — before starting wave N+1, summarize wave N findings in 1-2 sentences
- **Call doc-updater mid-session** for long work (5+ waves) to archive decisions to disk

Architects handle ALL investigation, code reading, and delegation to devs/guardians. team-lead NEVER looks at code.

## FORBIDDEN Actions

**FORBIDDEN**: team-lead Write/Edit on `.planning/wave-*/PLAN.md` — that file is planner exclusive work-product.
Rule: `feedback_planner_owns_plan_md`. Violation recovery: dispatch planner with RATIFY-WITH-EDITS or REJECT-AND-REWRITE.
