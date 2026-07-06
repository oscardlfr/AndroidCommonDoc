---
scope: [workflow, ai-agents, pm, session-setup]
sources: [androidcommondoc]
targets: [all]
slug: tl-session-setup
status: active
layer: L0
parent: agents-hub
category: agents
description: "Orchestrator session setup: Phase 2 core specialist dispatch, selective dispatch, bundle-read mandate, rotation protocol, context management, architect routing."
version: 4
last_updated: "2026-06"
assumes_read: team-topology, tl-phase-execution
token_budget: 1500
---

# Orchestrator Session Setup

Reference for the orchestrator's session initialization: Phase 2 core specialist dispatch, selective dispatch rules, long-session rotation, context management, and architect routing.

## Phase 2 Core Specialists

When Phase 2 execution begins, the orchestrator dispatches the core specialists that have work in scope (see Selective spawning below — do not default to all 5). These may run as background peers (when the runtime supports them) or as single-use Agent subagents dispatched per task:
```
Agent(name="test-specialist", subagent_type="test-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/test-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-testing. Ask arch-testing for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact).")
Agent(name="ui-specialist", subagent_type="ui-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/ui-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-testing. Ask arch-testing for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact).")
Agent(name="domain-model-specialist", subagent_type="domain-model-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/domain-model-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-platform. Ask arch-platform for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact).")
Agent(name="data-layer-specialist", subagent_type="data-layer-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/data-layer-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architects are arch-platform and arch-integration. Ask them for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact).")
Agent(name="toolkit-specialist", subagent_type="toolkit-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/toolkit-specialist.md before any other action (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Your reporting architect is arch-platform. Ask arch-platform for patterns via SendMessage — NEVER send pattern queries to context-provider directly (the gate ack is the only direct contact).")
```

**Bundle-read mandate (MANDATORY)**: every peer spawn/respawn prompt opens with the bundle-read line shown above — canonical wording in [context-bundle-schema](context-bundle-schema.md) §Consumer Contract. The `.planning/` bundle path is CP-gate-exempt, so the read works BEFORE the peer's gate-ack. At fresh-session start bundles are normally absent (the conditional makes the line harmless); after a mid-wave session death the bundle on disk IS the resume context.

**Selective spawning (MANDATORY — evaluate BEFORE any Agent() call)**: You MUST produce a scope evaluation table BEFORE calling Agent() to spawn any core specialist. Format:

| Layer | Tasks in plan | Spawn? |
|---|---|---|
| test | {count} | YES/SKIP |
| ui | {count} | YES/SKIP |
| domain | {count} | YES/SKIP |
| data | {count} | YES/SKIP |

Skip specialists with zero tasks. Do NOT default to dispatching all 5. Log skipped specialists: "Skipping {name} — no work in sprint scope". Architects can still request a skipped specialist mid-sprint via SendMessage to the orchestrator.

> 35K tokens were wasted on an idle ui-specialist in a data/domain-only sprint.

**No-UI waves**: If the sprint plan has zero `ui` tasks in the scope table above, SKIP ui-specialist spawn.
Route any doc work (README, CHANGELOG, English polish, frontmatter) to `doc-updater` instead.
Log: "Skipping ui-specialist — no UI tasks in scope; doc work routed to doc-updater."

Core specialists accumulate layer knowledge across waves when run as background peers. When run as single-use subagents, each dispatch receives per-task context. Reach background peers via `SendMessage(to="context-provider")`, `SendMessage(to="arch-testing")`, etc.

**Why background peers (when available)**: context-provider reads the project ONCE. Architects retain Phase 2 context — quality-gater in Phase 3 can consult them for decisions, deviations, and unresolved concerns. The load-bearing contract is disk artifacts regardless — verdicts, QG report, and push-proof are always on disk.

**Rotation** (for long sessions with background peers, 5+ waves): rotate KILL-THEN-RESPAWN: (0) dispatch context-provider `write_bundle(role, plan_id, status_snapshot)` so the role's context bundle is on disk BEFORE the kill — see [context-bundle-schema](context-bundle-schema.md); (1) gracefully terminate the old peer — `SendMessage(to="test-specialist", message={type:"shutdown_request"})`; (2) re-spawn the CANONICAL name: `Agent(name="test-specialist", subagent_type="test-specialist", run_in_background=true, ...)` with a prompt OPENING with the bundle-read mandate (schema §Consumer Contract). NEVER use free-form names for agents holding Write/Bash/gh — non-canonical names are invisible to every type-keyed gate (firing matrix §5).

**Long-session rotation protocol**: If a background peer has accumulated 15+ tool uses AND 150k+ tokens AND has failed a single dispatch 2+ times, STOP retrying. Either:
(a) Architect requests the orchestrator rotate the specialist — kill-then-respawn: CP writes the role bundle FIRST (`write_bundle`), then graceful shutdown, then re-spawn the CANONICAL name with fresh context and the bundle-read mandate (see Rotation above), OR
(b) Orchestrator spawns a named overflow specialist (e.g. `{specialist}-2`) for the specific failing task — overflow is ADDITIONAL capacity alongside the live canonical peer, addressed explicitly by its own `-2` name (NOT a replacement).

Do NOT continue retrying with a context-bloated peer — retries will keep failing due to attention anchoring to past work.

## Context Management

- **Peers accumulate context** — keep the team small (only agents that need coordination)
- **Sub-agents get fresh context** — prefer Agent() for workers to avoid context bloat
- **Summarize between waves** — before starting wave N+1, summarize wave N findings in 1-2 sentences
- **Call doc-updater mid-session** for long work (5+ waves) to archive decisions to disk

Architects handle ALL investigation, code reading, and delegation to specialists/guardians. The orchestrator NEVER looks at code.

## Architect Routing Table

| Issue domain | Assign to | Why |
|-------------|-----------|-----|
| Tests, test quality, TDD, coverage | `arch-testing` | Manages test-specialist, ui-specialist |
| KMP patterns, encoding, data layer, domain model, source sets | `arch-platform` | Manages domain-model-specialist, data-layer-specialist |
| UI wiring, DI, navigation, buttons, compilation, feature gates | `arch-integration` | Manages ui-specialist, data-layer-specialist |
| Cross-cutting (touches multiple domains) | Launch 2-3 architects in parallel | Each handles their domain |

## Dispatch Patterns

**The main agent IS the orchestrator. No separate `team-lead` subagent needed.**

The orchestrator fans out to concurrent `Agent` subagents. Background peers (with `run_in_background=true`) are a supported optional accelerator — they communicate via SendMessage and accumulate context across waves. Single-use subagents receive per-task context and return results directly. Both patterns are valid; the load-bearing contract is always disk artifacts.

```
// CORRECT — concurrent single-use subagents (works in any runtime):
Agent(subagent_type="arch-testing", prompt="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n...")
Agent(subagent_type="arch-platform", prompt="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n...")
Agent(subagent_type="arch-integration", prompt="scope_doc_path: .planning/wave-<slug>/PLAN.md\nmode: EXECUTE\n...")
// Each writes arch-{role}-verdict.md to disk; orchestrator reads them.

// CORRECT — background peers (optional accelerator, when runtime supports them):
Agent(name="arch-testing", subagent_type="arch-testing", run_in_background=true, prompt="...")
// Reached via SendMessage(to="arch-testing", ...) once alive.

// WRONG — Bash spawning or orchestrator reading source code
Bash("claude --print '...'")
```

**PREP/EXECUTE distinction in arch templates**: Still ENFORCED — see [arch-dispatch-modes.md](arch-dispatch-modes.md). Architects receive PREP dispatches (risk identification) in Phase 1 and EXECUTE dispatches (verify + verdict) in Phase 2. The distinction governs whether specialists are available to receive sub-dispatches.

## Wave Slug Propagation (FIND-18 fix, BL-W42 PR1)

The wave slug (e.g., `bl-w42-pr1`) is used by hooks to locate PLAN.md and the quality-gate sentinel.

**MANDATORY: export slug BEFORE starting your session shell, NOT inline in commands:**

```bash
export CLAUDE_WAVE_SLUG=bl-w42-pr1   # set once in terminal; hooks pick it up
```

**Fallback detection order:**
1. `CLAUDE_WAVE_SLUG` env var (canonical)
2. Git branch: **last path-segment** (`${branch##*/}` / `branch.split('/').pop()`), so `feature/payment-api` → `payment-api` and `codex/api-redesign` → `api-redesign`. `develop`, `master`, `main`, `HEAD`, and empty values are rejected.
3. Alias scan: single `.planning/wave-*/PLAN.md` presence (last resort)

**Quality-gate sentinel location (FIND-17 fix):** `.claude/wave-quality-gates/{slug}.md`
NOT in `.planning/wave-{slug}/quality-gate.md` (gitignored by `.gitignore:54`).
Create sentinel BEFORE first `git push` on the feature branch.
