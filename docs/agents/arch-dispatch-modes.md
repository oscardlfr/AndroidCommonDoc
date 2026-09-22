---
scope: [workflow, ai-agents, architects, dispatch]
sources: [androidcommondoc]
targets: [all]
slug: arch-dispatch-modes
status: active
layer: L0
parent: agents-hub
category: agents
description: "Architect PREP and VERIFY-FINAL dispatch with request-bound structured verdict authority."
version: 4
last_updated: "2026-09-22"
assumes_read: [tl-phase-execution, tl-dispatch-topology]
token_budget: 1500
---

# Architect Dispatch Modes

This doc defines the two-step architect dispatch protocol. Every orchestrator dispatch carries `scope_doc_path`, `mode`, and the immutable verdict request path/digest. Architects never infer authority from cwd or prose.

## Problem this solves

**Bug #5 (scope-doc hardcode)**: Arch templates hardcoded `.planning/PLAN.md` in their PRE-TASK and Scope Validation gates. Wave plans live at `.planning/wave-<slug>/PLAN.md`. Architects reading the hardcoded path either got stale content or failed outright. team-lead dispatch did not pass a path, so architects guessed from cwd.

**Bug #6 (no mode tagging)**: Architects received a single dispatch per wave and had no signal whether they were being asked to **prepare** work for specialists (read plan, identify risks, produce a specialist task list) or **execute + verify** work after specialists ran (collect results, write verdict). Both phases shared the same dispatch format. This caused architects to either start investigating too eagerly (pre-specialist) or skip prep entirely (post-specialist).

## Required fields on every architect dispatch

Every team-lead `SendMessage` to an architect MUST include:

| Field | Value | Required |
|-------|-------|----------|
| `scope_doc_path` | Path to the active wave plan: `.planning/wave-<slug>/PLAN.md` | YES — every dispatch |
| `mode` | `PREP` or `VERIFY_FINAL` | YES — every dispatch |
| `verdict_request_path` | Immutable `verdict-request/v1` path | YES — every dispatch |
| `verdict_request_sha256` | SHA-256 of those exact request bytes | YES — every dispatch |

Example team-lead → architect dispatch message body:

```
scope_doc_path: .planning/wave-<slug>/PLAN.md
mode: PREP
wave: <slug>
summary: PREP — read the plan, identify risks, publish the request-bound verdict, return READY
```

## PREP mode — pre-dev planning

**When**: team-lead sends PREP dispatch to the architects the wave class requires (HARNESS: all 3; DOC: the declared subset; FAST-PATH: none) **before** devs are spawned for a wave.

**Architect behavior in PREP**:
1. Read `scope_doc_path` — extract the wave's goals, files in scope, acceptance criteria
2. Consult context-provider for domain patterns relevant to the wave
3. Identify domain-specific risks: KMP source set pitfalls (platform), test gaps (testing), wiring/nav concerns (integration)
4. Build a specialist task list scoped to your specialty (files + required specialist names)
5. SendMessage team-lead with `READY: <1-line summary of risks and dev tasks>`
6. Do NOT dispatch specialists yet. Publish the PREP `verdict/v1` through `write-verdict.sh` using the exact request path/digest. Then stay idle after READY until implementation begins.

**team-lead collects all dispatched READY responses before spawning specialists.** This lets team-lead merge cross-architect concerns into a single specialist dispatch plan — e.g., if platform flags a source-set move that testing needs to reconcile, team-lead surfaces both in the specialist brief.

## VERIFY_FINAL mode — post-implementation verification

**When**: the orchestrator sends VERIFY_FINAL to the same required architects after implementation is frozen and the control plane is rebound to the final HEAD.

**Architect behavior in VERIFY_FINAL**:
1. Read `scope_doc_path` — cross-check dev work against the wave's acceptance criteria
2. Run verification checks in your domain (MCP tools, `/test`, `/pre-pr`, code-metrics)
3. Delegate any fixes back to devs via SendMessage to team-lead (standard flow)
4. Publish `.planning/wave-<slug>/arch-<short-role>-verdict-verify-final.json` through `write-verdict.sh`, bound to the fresh request and digest-backed evidence
5. SendMessage team-lead with `APPROVE` or `ESCALATE: <1-sentence reason>` (per agent-verdict-protocol.md)

## team-lead workflow — 2-step dispatch per wave

```
1. PREP dispatch to the architects the wave class requires (HARNESS: all 3 — arch-testing,
   arch-platform, arch-integration; DOC: the declared subset; FAST-PATH: none) in parallel
   → wait for all dispatched READY responses

2. team-lead merges READY findings, spawns specialists (Phase 2 core specialists if first wave, extras if requested)

3. Devs execute their assigned work

4. VERIFY_FINAL dispatch to the same required architects in parallel
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
6. **Branch on mode**: `PREP` identifies risks and returns READY status; `VERIFY_FINAL` verifies final source and publishes evidence-backed verdicts.

## Structured verdict dispatch hygiene (mandatory)

PREP and VERIFY-FINAL are separate immutable JSON records:

- `.planning/wave-<slug>/arch-<short-role>-verdict-prep.json`
- `.planning/wave-<slug>/arch-<short-role>-verdict-verify-final.json`

Only `write-verdict-request.sh` creates requests and only `write-verdict.sh` publishes verdicts. The canonical validator binds filename, role, phase, wave, PLAN, HEAD, request and evidence bytes. Conversational READY/APPROVE text and historical Markdown never authorize a transition. Re-review requires a fresh request and compare-and-swap supersession.

## Anti-patterns (forbidden)

- Hardcoding `.planning/PLAN.md` in arch templates — Bug #5 reopener. Use `scope_doc_path` field from dispatch.
- Guessing scope path from cwd or wave number — Bug #5 reopener. Use the provided path or SCOPE-DOC-MISSING.
- Starting dev dispatch in PREP mode — PREP is plan-review only. Dev dispatch happens after team-lead sees all dispatched READY responses.
- Skipping the PREP verdict — the premature-execution gate validates the request-bound PREP JSON before any specialist may execute.
- Treating one request or dispatch as both PREP and VERIFY_FINAL — phases have separate requests, files and evidence.
- team-lead spawning devs before all dispatched READY responses arrive — ignores cross-architect risk merging.

## Example: PREP dispatch

A PREP dispatch the orchestrator sends to an architect:

```
to: arch-platform
scope_doc_path: .planning/wave-<slug>/PLAN.md
mode: PREP
wave: <slug>
verdict_request_path: .planning/wave-<slug>/verdict-requests/<request-id>.json
verdict_request_sha256: <sha256>
summary: PREP — read the plan, identify risks, publish the request-bound verdict, return READY status
```

## See also

- [team-lead Phase Execution](tl-phase-execution.md) — overall 3-phase protocol
- [team-lead Dispatch Topology](tl-dispatch-topology.md) — pre-dispatch gate and kill order
- [Agent Verdict Protocol](agent-verdict-protocol.md) — EXECUTE-mode verdict file format
- [Architect Topology Protocols](arch-topology-protocols.md) — T-BUG-011 + T-BUG-012 + T-BUG-015
