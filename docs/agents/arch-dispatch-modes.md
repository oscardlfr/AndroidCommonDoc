---
scope: [workflow, ai-agents, architects, dispatch]
sources: [androidcommondoc]
targets: [all]
slug: arch-dispatch-modes
status: active
layer: L0
parent: agents-hub
category: agents
description: "Architect dispatch modes (PREP/EXECUTE) and scope_doc_path protocol. team-lead includes mode + scope_doc_path in every dispatch; architects read scope from that path (never cwd guess). Fixes Wave 23 Bug #5 (hardcoded PLAN.md) and Bug #6 (missing mode tagging)."
version: 1
last_updated: "2026-04-20"
assumes_read: [tl-phase-execution, tl-dispatch-topology]
token_budget: 1500
---

# Architect Dispatch Modes

This doc defines the two-step architect dispatch protocol introduced in Wave 23. Every team-lead dispatch to an architect carries two mandatory fields: `scope_doc_path` (the wave plan file) and `mode` (`PREP` or `EXECUTE`). Architects read scope from the provided path and behave differently per mode.

## Problem this solves

**Bug #5 (scope-doc hardcode)**: Arch templates hardcoded `.planning/PLAN.md` in their PRE-TASK and Scope Validation gates. Wave plans live at `.planning/wave-<slug>/PLAN.md`. Architects reading the hardcoded path either got stale content or failed outright. team-lead dispatch did not pass a path, so architects guessed from cwd.

**Bug #6 (no mode tagging)**: Architects received a single dispatch per wave and had no signal whether they were being asked to **prepare** work for specialists (read plan, identify risks, produce a specialist task list) or **execute + verify** work after specialists ran (collect results, write verdict). Both phases shared the same dispatch format. This caused architects to either start investigating too eagerly (pre-specialist) or skip prep entirely (post-specialist).

## Two fields on every team-lead dispatch

Every team-lead `SendMessage` to an architect MUST include:

| Field | Value | Required |
|-------|-------|----------|
| `scope_doc_path` | Path to the active wave plan: `.planning/wave-<slug>/PLAN.md` | YES — every dispatch |
| `mode` | `PREP` or `EXECUTE` | YES — every dispatch |

Example team-lead → architect dispatch message body:

```
scope_doc_path: .planning/wave-<slug>/PLAN.md
mode: PREP
wave: <slug>
summary: PREP — read the plan, identify platform risks, write APPROVED-PREP verdict, return READY
```

## PREP mode — pre-dev planning

**When**: team-lead sends PREP dispatch to the architects the wave class requires (HARNESS: all 3; DOC: the declared subset; FAST-PATH: none) **before** devs are spawned for a wave.

**Architect behavior in PREP**:
1. Read `scope_doc_path` — extract the wave's goals, files in scope, acceptance criteria
2. Consult context-provider for domain patterns relevant to the wave
3. Identify domain-specific risks: KMP source set pitfalls (platform), test gaps (testing), wiring/nav concerns (integration)
4. Build a specialist task list scoped to your specialty (files + required specialist names)
5. SendMessage team-lead with `READY: <1-line summary of risks and dev tasks>`
6. Do NOT dispatch devs yet. Write your PREP verdict file (`APPROVED-PREP`, per PREP verdict dispatch hygiene below) — this authorizes specialists to execute. Then stay idle after READY until EXECUTE dispatch arrives.

**team-lead collects all 3 READY responses before spawning specialists.** This lets team-lead merge cross-architect concerns into a single specialist dispatch plan — e.g., if platform flags a source-set move that testing needs to reconcile, team-lead surfaces both in the specialist brief.

## EXECUTE mode — post-dev verification

**When**: team-lead sends EXECUTE dispatch to the architects the wave class requires (HARNESS: all 3; DOC: the declared subset; FAST-PATH: none) **after** devs have completed their work for the wave.

**Architect behavior in EXECUTE**:
1. Read `scope_doc_path` — cross-check dev work against the wave's acceptance criteria
2. Run verification checks in your domain (MCP tools, `/test`, `/pre-pr`, code-metrics)
3. Delegate any fixes back to devs via SendMessage to team-lead (standard flow)
4. Write your full EXECUTE verdict (`APPROVED-VERIFY-FINAL`, HEAD-bound) to `.planning/wave-<slug>/arch-<role>-verdict.md`
5. SendMessage team-lead with `APPROVE` or `ESCALATE: <1-sentence reason>` (per agent-verdict-protocol.md)

## team-lead workflow — 2-step dispatch per wave

```
1. PREP dispatch to the architects the wave class requires (HARNESS: all 3 — arch-testing,
   arch-platform, arch-integration; DOC: the declared subset; FAST-PATH: none) in parallel
   → wait for all dispatched READY responses

2. team-lead merges READY findings, spawns specialists (Phase 2 core specialists if first wave, extras if requested)

3. Devs execute their assigned work

4. EXECUTE dispatch to the same required architects in parallel
   → wait for all their APPROVE/ESCALATE verdicts

5. If all APPROVE → proceed to Phase 3 (quality-gater)
   If any ESCALATE → team-lead re-plans or dispatches clarification
```

## Architect PRE-TASK Protocol (replaces hardcoded PLAN.md reads)

Arch templates' PRE-TASK Protocol uses `scope_doc_path` instead of a hardcoded path:

1. **Inbox-first**: idle until team-lead dispatch arrives
2. **Read dispatch**: extract `scope_doc_path`, `mode`, `wave` fields
3. **Path-missing guard**: If `scope_doc_path` is absent or empty in the dispatch message:
   - `SendMessage(to="team-lead", summary="SCOPE-DOC-MISSING", message="Dispatch for wave {N} did not include scope_doc_path. Re-dispatch with the field populated.")`
   - Do NOT fall back to guessing the path from cwd or assuming `.planning/PLAN.md`
   - Do NOT proceed with investigation
4. **Read scope doc**: `Read(scope_doc_path)` — this is the authoritative wave plan
5. **Cross-check**: if the dispatch summary conflicts with scope_doc_path contents, SendMessage team-lead with `PLAN-DISPATCH DRIFT` and quote both. Do NOT silently follow either.
6. **Branch on mode**: `PREP` → prep behavior (identify risks, return READY). `EXECUTE` → execute behavior (verify, delegate fixes, write verdict).

## PREP verdict dispatch hygiene (mandatory)

Architect PREP verdicts MUST be filed at:
`.planning/wave-<slug>/arch-<arch>-verdict.md`

The body MUST contain the literal string `APPROVED-PREP`.

**Why this exact filename**:
- `.claude/hooks/premature-execution-gate.js:77` regex `/^(?:pr\d+-)?arch-[a-z]+-verdict\.md$/` admits ONLY this naming pattern.
- `.claude/hooks/architect-bash-write-gate.js:112` exempt pattern likewise admits only `arch-<arch>-verdict\.md` (and `arch-<arch>-cross-verify.md` for cross-arch verification verdicts).
- Files named `APPROVED-PREP-<arch>.md` or any other variant are NOT exempt — the architect will be BLOCKED from writing them.

**Anti-pattern to avoid in dispatch prompts**:
Do NOT instruct architects to write to `APPROVED-PREP-<arch>.md`, `<arch>-prep.md`, or any non-canonical name. Architects follow dispatch prompts; if the dispatch prescribes a wrong filename, the architect will attempt to write it and hit the gate.

**Canonical dispatch snippet** (correct):
```
Write PREP verdict to: .planning/wave-<slug>/arch-integration-verdict.md
Body MUST contain literal string: APPROVED-PREP
```

**Reference**: this rule surfaced from BL-W47-prep-5 friction where all 3 architects hit the gate due to orchestrator dispatch wording (templates were correct; dispatch prompts were the bug).

## Anti-patterns (forbidden)

- Hardcoding `.planning/PLAN.md` in arch templates — Bug #5 reopener. Use `scope_doc_path` field from dispatch.
- Guessing scope path from cwd or wave number — Bug #5 reopener. Use the provided path or SCOPE-DOC-MISSING.
- Starting dev dispatch in PREP mode — PREP is plan-review only. Dev dispatch happens after team-lead sees all 3 READY responses.
- Skipping the PREP verdict — the `APPROVED-PREP` verdict file is what the premature-execution-gate checks before any specialist may execute (see PREP verdict dispatch hygiene). PREP writes that file AND returns `READY` (or `BLOCKED`); EXECUTE later updates the same file to `APPROVED-VERIFY-FINAL`.
- Treating one dispatch as both PREP and EXECUTE — the `mode` field is load-bearing. Separate dispatches, separate behaviors.
- team-lead spawning devs before all 3 READY responses arrive — ignores cross-architect risk merging.

## Example: PREP dispatch

A PREP dispatch the orchestrator sends to an architect:

```
to: arch-platform
scope_doc_path: .planning/wave-<slug>/PLAN.md
mode: PREP
wave: <slug>
summary: PREP — read the plan, identify platform risks, write APPROVED-PREP verdict, return READY
message: Read .planning/wave-<slug>/PLAN.md. Identify KMP/structural risks in scope. Write your APPROVED-PREP verdict to .planning/wave-<slug>/arch-platform-verdict.md, then return READY with a specialist task list.
```

## See also

- [team-lead Phase Execution](tl-phase-execution.md) — overall 3-phase protocol
- [team-lead Dispatch Topology](tl-dispatch-topology.md) — pre-dispatch gate and kill order
- [Agent Verdict Protocol](agent-verdict-protocol.md) — EXECUTE-mode verdict file format
- [Architect Topology Protocols](arch-topology-protocols.md) — T-BUG-011 + T-BUG-012 + T-BUG-015
