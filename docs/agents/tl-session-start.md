---
slug: tl-session-start
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "READ FIRST at every session start: T-BUG-010 critical block, session gates, FORBIDDEN/ALLOWED operating mode, Phase 0 spawn blocks, pre-flight checklist, planning phase gate."
---

# Session Start — Operating Mode + Phase 0

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

> **READ FIRST AT SESSION START** — Load this sub-doc before any planning or Agent() calls.

The main agent (when orchestrating a session) orchestrates the project: plan scope, assign work to architects, and handle escalations. You **NEVER write code yourself** — architects manage specialists and guardians to execute implementation.

> ⛔ **CRITICAL — WHO READS THIS TEMPLATE (T-BUG-010)**
>
> This template instructs the **main conversation agent (orchestrator)** to act as team-lead. You do NOT spawn `team-lead` as a separate subagent.
>
> **FORBIDDEN**: `Agent(name="team-lead", ...)` — creates a redundant subagent that cannot reliably spawn architects (see memory: `feedback_agent_depth_limit.md` — "team-lead as subagent can't spawn sub-agents reliably. User=team-lead, launch architects directly.").
>
> **CORRECT MODEL**: the main agent reads this guide → becomes orchestrator/team-lead → dispatches architects as concurrent `Agent` subagents (or background peers if the runtime supports them) → reads their `arch-*-verdict.md` files from disk.
>
> **IF you were spawned AS a subagent named `team-lead`**: respond once with `"team-lead-peer spawn detected — orchestrator should act as team-lead directly per T-BUG-010. Exiting."` and exit. Do NOT attempt architect spawns from inside a subagent — spawn depth is unreliable.
>
> Why: the orchestrator role executes in-process (main conversation). Sub-agents carry `agent_type` for gate keying; only the main agent has full tool access for Agent() fan-out.

> **⛔ HARD GATE — Session setup blocks ALL work.**
> If you receive a user task before completing session setup: RESPOND ONLY with "Setting up session — dispatching core subagents first."
> DO NOT plan. DO NOT spawn agents. DO NOT respond to the user task.
> Dispatch the subagents the wave CLASS floor requires — selectively, skipping roles with no work (see [tl-session-setup](tl-session-setup.md)) — + run the pre-flight checklist FIRST.
> If a role the CLASS floor requires is missing → same response, same restriction, fix it before anything else.

> ⛔ SESSION CLOSURE GATE — Acceptance criteria block session end.
> NEVER close session or report "done" when acceptance criteria are failing.
> NEVER reframe FAILs as acceptable ("pre-existing", "known issue", "good enough").
> NEVER defer sprint scope without explicit user approval.
> If ANY sprint objective is not met: ESCALATE to user with exact failures and ask whether to continue or stop.

> **FIRST POST-SETUP ACTION**: Once core subagents are dispatched and pre-flight passes, immediately consult context-provider: `Agent(subagent_type="context-provider", prompt="Read MEMORY.md and report all known bugs, open items, and current project state.")` — or `SendMessage(to="context-provider", ...)` if context-provider is a live background peer. DO NOT start planning until context-provider responds.

### Per-Session Gate

**Per-session gate (Claude adapter)**: When running under the Claude adapter with a live context-provider peer, before your FIRST Grep, Glob, or Bash search call you must have received a SendMessage response from context-provider in this session; the hook enforces this mechanically. A portable/single-use runtime obtains the context-provider oracle differently (single-use dispatch or a `coordination/consult/v1` disk artifact validated by the gate's disk-read branch — see [coordination-artifact-schema](coordination-artifact-schema.md)) — see [agent-core-rules §1](agent-core-rules.md). Wave slug propagation + quality-gate sentinel location: see [tl-session-setup § Wave Slug Propagation](tl-session-setup.md#wave-slug-propagation-find-18-fix-bl-w42-pr1) (FIND-17/18 fix).

### L0 Mechanical Floor Consultation Checklist (MANDATORY)

Before drafting any brief that mentions git ops, hooks, /pre-pr, commit-lint, or architect protocols:

1. Read all `.claude/hooks/*.js` for PreToolUse + Bash matchers active in this project
2. Read each `arch-*` template's "MANDATORY" / "MUST DO" sections
3. List active mechanical enforcements affecting the brief topics
4. If brief contradicts any active enforcement, REVISE the brief (do NOT instruct specialists to bypass)
5. Run `scripts/sh/list-valid-commit-tokens.sh` — verify TYPE-vs-SCOPE distinction is explicit in any brief that mentions commit messages. TYPE list comes from `.github/workflows/reusable-commit-lint.yml`; SCOPE list from `.commitlintrc.json`. These are DIFFERENT files.
6. For brief items specifying Java/JNI FQN from external dependencies, verify via artifact inspection: `unzip -l <artifact>.aar | grep '\.class$'`. Nested class shows as `Outer$Inner.class`; top-level as `Inner.class`. FQNs from .java source alone are [source-based, NOT artifact-verified].
7. For brief items specifying class names, module names, file paths, or class/file co-location: query context-provider with explicit "list current public classes in <module>" / "list modules from settings.gradle.kts" / "list files in <package>" BEFORE finalizing brief. Memory-based authoring of identifiers is FORBIDDEN. Same root as #93 (artifact verification): verify against actual state, not assumed state. **code-state verification** mandate.

Active hooks: `push-authorization-gate.js`, `git-amend-gate.js`, `commit-scope-validation-gate.js`, `branch-guard.js`, `premature-execution-gate.js`, `specialist-task-completion-gate.js`.

**INTERMEDIATE PUSHES require fresh /pre-pr stamp** (content validation + receipt) **and valid `quality-gate.stamp` + `push-proof.json`** minted by the quality-gater's Quality Gate phase (Steps 0-9, then `emit-push-proof.sh run-qg` at Step 10). Plan for this in phase timing OR squash to single push at PR-open time.

## Operating Mode

### FORBIDDEN Actions (non-negotiable)

You are FORBIDDEN from doing these things directly:

- **FORBIDDEN**: Reading source code files (*.kt, *.ts, *.json, *.xml)
- **FORBIDDEN**: ANY Bash command that outputs source code — `git diff`, `git show`, `git log` with file paths, `git blame`, `cat`/`head`/`tail` on *.kt, *.ts, *.json, *.xml files
- **FORBIDDEN**: Using Grep/Glob to search implementations
- **FORBIDDEN**: Launching Explore agents to investigate code
- **FORBIDDEN**: Writing or editing ANY file (code, tests, config)
- **FORBIDDEN**: Running builds, tests, or compilation commands
- **FORBIDDEN**: Spawning agents via Bash + `claude` CLI
- **FORBIDDEN**: Using a general-purpose agent to write docs — route doc writes to the doc-updater role (`SendMessage(to="doc-updater")` if it is a live peer, else dispatch it as a single-use `Agent(subagent_type="doc-updater")`)

### ALLOWED Actions (the ONLY things you can do)

1. **Read** plan files, memory, CLAUDE.md, and project docs (NOT source code)
2. **Agent()** to dispatch architects and specialists as concurrent subagents (default) or background peers
3. **SendMessage** to coordinate with live background peers (supported optional accelerator)
4. **Read disk artifacts** — `arch-*-verdict.md`, `quality-gate-report.json`, `push-proof.json` (authoritative results)
5. **Report** results to the user
6. **Decide** on escalations: re-plan or report blocked

### Post-Validation Doc Check (MANDATORY after every context-provider response)

After receiving ANY context-provider SendMessage response:
1. Did context-provider deliver NEW pattern knowledge (not already in docs/)?
2. If YES → SendMessage doc-updater IMMEDIATELY with pattern name,
   precedent files, when-to-use rules, target doc location
3. Do NOT defer to end-of-phase batch — knowledge decays with context compression

### User Decision Broadcast Protocol (MANDATORY)

Within **60 seconds** of `AskUserQuestion` returning, team-lead MUST `SendMessage` to **every active architect** with:

1. User decision verbatim (no paraphrasing)
2. ANY invalidated prior architect reasoning (with reference to the architect's prior HOLD or query)
3. Explicit "release any HOLD on this topic" instruction if applicable

**Failure mode**: architects continue drafting HOLDs on stale premises. Wave 3b friction #76+#78 — PM took 17min, arch-platform spent cycles drafting formal HOLD GATE on now-invalid premise. Pattern: PM relay should INVALIDATE the architect's prior reasoning, not just deliver the new decision.

Friction baseline: `feedback_validate_decisions_with_user` covers WHEN to ask; this protocol covers HOW FAST to broadcast.

### Search Dispatch Protocol (MANDATORY — T-BUG-015)

When the user task involves **pattern searching** (find files matching X, count occurrences of Y, locate uses of Z, audit codebase for pattern P), you do NOT dispatch the search to architects or specialists. Route through context-provider FIRST:

1. **SendMessage to context-provider** with the search query
2. Wait for results
3. **THEN dispatch to architect** with results-as-input — architect operates on the answer, not the search
4. Architect dispatches specialist with concrete file/line targets

**FORBIDDEN**:
- Dispatching to architect with "use grep to find X" — even though architect has Bash, this bypasses the PR #40 design AND wastes architect tokens on search-mechanics
- Letting architect or specialist "just bash-grep it" — same bypass, no audit trail

Why: An L2 consumer session (2026-04-18) — the main agent dispatched grep work directly to arch-platform instead of context-provider. arch-platform used `bash grep` (mechanically allowed since it has Bash). Result: search bypassed the curated knowledge layer. The Search Dispatch Protocol makes context-provider the entry point for all search-related work.

### FORBIDDEN Agent Launches (non-negotiable)
- **FORBIDDEN**: Spawning specialists eagerly or as a fixed roster — specialists are dispatched selectively per the wave's CLASS floor when execution begins, not a fixed set spawned upfront
- **FORBIDDEN**: Spawning extra specialists without a preceding architect SendMessage to team-lead explicitly requesting it. "I think this needs a specialist" is not sufficient — the architect must ask.
- **The ONLY agents team-lead launches directly**: planner (Phase 1), the session-start setup agents (context-provider, doc-updater), the specialists the wave's CLASS floor requires (dispatched selectively when execution begins), quality-gater (Phase 3). Extra specialists require an architect SendMessage request.
- **FORBIDDEN**: Writing or editing `.planning/wave-*/PLAN.md` directly — spawn planner and wait for `PLAN-WRITTEN`. See `feedback_planner_owns_plan_md`.

## Phase 0 — Session start

**Project slug**: derive from the project root directory name, lowercased with hyphens. Examples: `my-app`, `my-kmp-libs`, `androidcommondoc`. The slug determines the wave artifact directory (`.planning/wave-{slug}/`).

### Session Start: Core Subagent Dispatch

**FIRST thing when session starts** — before ANY planning or unrelated Agent():

Dispatch the core roles the wave's CLASS floor requires (HARNESS: 3 architects + specialists + QG; DOC: declared architects + QG; FAST-PATH: QG only — see [main-agent-orchestration-guide](main-agent-orchestration-guide.md)). Spawn selectively — skip roles with no work (see [tl-session-setup](tl-session-setup.md)). In **Claude-rich mode** you MAY pre-spawn the standing core team upfront as an accelerator (the block below); in **portable/single-use mode** each role is dispatched per task. Either way the **load-bearing contract** is disk artifacts: each role writes its result to `.planning/wave-{slug}/` and the orchestrator reads from there. Background peers additionally communicate via SendMessage; single-use subagents return their result directly.

```
# Foreground single-use dispatch (default — works in any runtime):
Agent(subagent_type="context-provider", prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/context-provider.md (absent or stale wave_slug → report 'no valid bundle' and proceed). Read docs/agents/agent-core-rules.md. Answer the project state query: read MEMORY.md and report known bugs, open items, and current project state.")

# Background peer dispatch (optional accelerator — when runtime supports it):
Agent(name="context-provider", subagent_type="context-provider", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/context-provider.md (absent or stale wave_slug → report 'no valid bundle' and proceed). Read docs/agents/agent-core-rules.md. Answer pattern/doc/rule queries on demand. NEVER write files (sole carve-out: the write_bundle script protocol in your template, on orchestrator dispatch only). NEVER self-assign tasks. NEVER execute CI.")
Agent(name="doc-updater", subagent_type="doc-updater", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/doc-updater.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Update docs ONLY when orchestrator explicitly dispatches you. NEVER self-assign tasks.")
Agent(name="arch-testing", subagent_type="arch-testing", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/arch-testing.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Verify test quality, TDD, coverage. Write arch-testing-verdict.md to disk.")
Agent(name="arch-platform", subagent_type="arch-platform", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/arch-platform.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Verify KMP patterns, source sets. Write arch-platform-verdict.md to disk.")
Agent(name="arch-integration", subagent_type="arch-integration", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/arch-integration.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Verify DI, navigation, wiring. Write arch-integration-verdict.md to disk.")
Agent(name="quality-gater", subagent_type="quality-gater", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/quality-gater.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. DORMANT until orchestrator activates for Phase 3.")
```

These roles are the session's core agents (dispatch the ones the wave CLASS floor requires). When run as background peers they are reachable via SendMessage; when run as single-use subagents the orchestrator dispatches a fresh instance per task and reads results from disk.

### Phase 2 Core Specialists (dispatched when Phase 2 starts, NOT at session start)

```
Agent(name="test-specialist", subagent_type="test-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/test-specialist.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Your reporting architect is arch-testing.")
Agent(name="ui-specialist", subagent_type="ui-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/ui-specialist.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Your reporting architect is arch-testing.")
Agent(name="domain-model-specialist", subagent_type="domain-model-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/domain-model-specialist.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Your reporting architect is arch-platform.")
Agent(name="data-layer-specialist", subagent_type="data-layer-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/data-layer-specialist.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Your reporting architects are arch-platform and arch-integration.")
Agent(name="toolkit-specialist", subagent_type="toolkit-specialist", run_in_background=true, prompt="FIRST: read your bundle at .planning/wave-{slug}/context-bundles/toolkit-specialist.md (absent or stale wave_slug → report 'no valid bundle' and proceed). THEN: SendMessage(to='context-provider', summary='gate ack'). Read docs/agents/agent-core-rules.md. Your reporting architect is arch-platform.")
```

**Bundle-read mandate**: every peer spawn/respawn prompt MUST open with the bundle-read line (canonical wording: [context-bundle-schema](context-bundle-schema.md) §Consumer Contract). ALL spawn blocks in this file carry it inline — keep it when copying, and prepend it to ANY respawn prompt. At fresh-session start bundles are normally absent (the conditional makes the line harmless); after a mid-wave session death the bundle on disk IS the resume context.

### Phase 2 Core Specialists — Session Context + Routing
See [tl-session-setup](tl-session-setup.md) for Phase 2 selective spawning rules, long-session rotation protocol, context management, and architect routing table.

### Specialist Dispatch + Topology Gate
See [tl-dispatch-topology](tl-dispatch-topology.md) for pre-dispatch gate (5 checks), pattern validation chain, dynamic scaling, autonomy rules, mandatory team workflow, and kill order.

### Architect Verification + Post-Wave Integrity
See [tl-verification-gates](tl-verification-gates.md) for architect verdicts, post-verdict broadcast protocol, and post-wave team integrity check.

### 3-Phase Execution Model
**Phase 1 (Plan)**: `EnterPlanMode()` → planner writes plan → user approves → `ExitPlanMode()`
**Phase 2 (Execute)**: SendMessage architects → specialist waves → collect APPROVE/ESCALATE
**Phase 3 (Quality Gate)**: quality-gater validates → PASS → commit

See [tl-phase-execution](tl-phase-execution.md) for phase transitions, triggers, anti-patterns, context management, and the execution checklist.

### Quality Gate + Doc Pipeline
See [tl-quality-doc-pipeline](tl-quality-doc-pipeline.md) for quality-gater retry rules, doc-updater mandate, and CLAUDE.md pointers-only rule.

### Model Profiles
See [tl-model-profiles](tl-model-profiles.md) for `.claude/model-profiles.json` structure, the four profiles (budget/balanced/advanced/quality), and the team-lead semantic gap (template `model: sonnet` but profile override to opus at runtime).

### Architect Dispatch Modes (MANDATORY — Bug #5 + Bug #6 fix)
Every architect dispatch MUST include `scope_doc_path: .planning/wave-<slug>/PLAN.md` and `mode: PREP` or `mode: EXECUTE`. Never hardcode `.planning/PLAN.md`. Full protocol: [arch-dispatch-modes](arch-dispatch-modes.md). Dispatch format: [tl-dispatch-topology § Architect Dispatch](tl-dispatch-topology.md#architect-dispatch--scope_doc_path--prepexecute-mode-wave-23).

### Token Meter + Retrospective (MANDATORY at wave end)
At the end of every wave, team-lead MUST: (1) estimate token spend as `dispatched-message-count × avg-tokens-per-message` (order-of-magnitude; no precision needed), (2) write `.planning/wave-<slug>/retrospective.md` with wave number, steps completed, token estimate, and verdict outcomes (APPROVE/ESCALATE counts per architect). Threshold: if estimate >80% of model context window → flag to user and propose wave split. Full spec: [tl-verification-gates § Token Meter Gate](tl-verification-gates.md#token-meter-gate).

### Pre-Flight Checklist (MUST verify before dispatching architects)

> Verify the roles the wave's CLASS floor requires. HARNESS needs 3 architects + specialists + QG; DOC needs declared architects + QG; FAST-PATH needs QG only (see [main-agent-orchestration-guide](main-agent-orchestration-guide.md)). Roles with no work are **SKIP**, not STOP (selective spawning). Treat each checkbox below as "YES, or SKIP if the CLASS floor does not require it."

```
□ 1. context-provider dispatched (subagent or background peer)?    → YES or STOP
□ 2. doc-updater dispatched?                                        → YES or STOP
□ 3. arch-testing dispatched?                                       → YES or STOP
□ 4. arch-platform dispatched?                                      → YES or STOP
□ 5. arch-integration dispatched?                                   → YES or STOP
□ 6. quality-gater dispatched?                                      → YES or STOP
□ 7. context-provider consulted (project state response received)?  → YES or STOP
□ 8. Agent(planner) called for non-trivial tasks?                   → YES or STOP (ENFORCED by .claude/hooks/plan-mode-spawn-planner.js)
□ 9. test-specialist dispatched?         → YES or SKIP (Phase 2 not started)
□ 10. ui-specialist dispatched?          → YES or SKIP (Phase 2 not started)
□ 11. domain-model-specialist?           → YES or SKIP (Phase 2 not started)
□ 12. data-layer-specialist?             → YES or SKIP (Phase 2 not started)
□ 13. toolkit-specialist?                → YES or SKIP (Phase 2 not started)
```

**If a role the CLASS floor requires — plus #1 (context-provider oracle), #6 (quality-gater), #7 (context-provider consult), and #8 (planner, for non-trivial tasks) — is NO → STOP. Do not respond to user tasks. Do not plan. Fix it first, then re-verify from the top. Roles marked SKIP for lack of work are fine.**

### Planning Phase (EnterPlanMode gate)
For non-trivial tasks:
1. **`EnterPlanMode()`** — plan-context.js injects MODULE_MAP.md + agents + skills as additional context. Note: the hook does NOT block team-lead writes — the no-self-write rule below is discipline-enforced, not hook-enforced.
2. **Spawn planner**: `Agent(subagent_type="planner", prompt="...")` — `subagent_type` MUST be `"planner"` (lowercase, custom L0 agent with Read+Write+Bash+SendMessage), NOT `"Plan"` (capital-P built-in; read-only and cannot write plan files). No `team_name` required.

**Hook enforcement (BL-W31.7-12)**: The hook `.claude/hooks/plan-mode-spawn-planner.js` mechanically blocks `ExitPlanMode` if planner has not been spawned via `Agent(subagent_type="planner")` during the current plan-mode session. Sentinel: `.planning/.plan-mode-planner-required`. Escape hatch: `CLAUDE_SKIP_PLANNER=1` env var (set BEFORE `EnterPlanMode`) for genuinely trivial work.

3. Planner writes `.planning/wave-<slug>/PLAN.md` (planner is a subagent — outside plan mode scope, can write files normally)
4. Present plan summary to user as text output (team-lead needs no file writes during planning)
5. **On user approval**: call `ExitPlanMode()`
6. **⛔ MANDATORY Phase 2 Topology Activation Gate (Bug #8 — Wave 26 regression fix)**: AFTER `ExitPlanMode()` and BEFORE any architect EXECUTE dispatch:
   - **Dispatch the roles listed in the PLAN.md Spawn Table**, satisfying the wave class artifact floor (HARNESS requires 3 arch-*-verdict.md + QG artifacts; DOC requires declared-arch verdicts + QG artifacts; FAST-PATH requires QG artifacts only). See `docs/agents/main-agent-orchestration-guide.md` for the class floor table.
   - **Architect EXECUTE dispatches MUST include the mandate**: `"Your EXECUTE output is SendMessage-to-specialist with edit spec. You MUST NOT use Write or Edit on source/template/test files yourself. If you self-edit, the wave is rolled back."`
   - **Verification after architect APPROVE**: The main agent runs `rtk git log --format='%an' <commit-range>` and confirms commits are authored by the specialist layer (per SendMessage ownership trail), not exclusively by the architect layer. If architects self-edited: STOP, reset, re-dispatch through specialists, update `feedback_plan_mode_exit_topology.md` memory with the violation details.
   - Why this gate exists: Wave 26 BL-W26-01a shipped with 100% architect-authored edits and 0 specialists dispatched. User flagged: "no devs are working and all work has been done by the architects" (literal quote preserved — "devs" was the user's term at the time). Architects hold `Read` + mediation tools only; they do NOT self-implement.
7. **Only then** SendMessage architects to start Phase 2 (PREP → EXECUTE → APPROVE cycles).

Exception: simple tasks (< 5K tokens, clear path) → plan inline without EnterPlanMode. Step 6 still applies if ANY file edit is needed.

**Spawn Prompt Hygiene**: lean standby language only in spawn prompts — no wave/round forecasts. See `docs/agents/agent-core-rules.md#spawn-prompt-hygiene`.
