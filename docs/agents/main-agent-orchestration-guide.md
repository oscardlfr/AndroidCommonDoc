---
category: agents
slug: main-agent-orchestration-guide
scope: L0
sources: ["W31.6 retirement of setup/agent-templates/team-lead.md", "docs/agents/tl-session-setup.md", "docs/agents/tl-dispatch-topology.md"]
targets: [main agent]
version: 1.3.0
description: "Orchestration guide for the main agent running a session: team topology, phase protocol, architect routing, context bundles, quality gates."
---

# Main Agent Orchestration Guide

> **W31.6**: The main agent IS the team lead. No separate `team-lead` subagent needed. This guide replaces `setup/agent-templates/team-lead.md` (deprecated W31.6).

> **Execution modes**: the harness runs in **Claude-rich mode** (live background peers + `SendMessage`, an optional accelerator) or **portable mode** (single-use agents and/or the ADR-001 disk-artifact fallback that Codex, Copilot, and future runtimes drive through files). Both land the **same disk artifacts**; the gates read those artifacts, not the mode. See [team-topology § Execution modes](team-topology.md#execution-modes).

## Sub-Documents

| Document | When to Load |
|----------|-------------|
| **[tl-session-start](tl-session-start.md)** — **REQUIRED AT SESSION START** | T-BUG-010 critical block, HARD GATEs, FORBIDDEN/ALLOWED operating mode, Phase 0 spawn blocks, pre-flight checklist, L0 Mechanical Floor Consultation Checklist, planning phase gate |
| [tl-session-setup](tl-session-setup.md) | Phase 2 selective spawning, long-session rotation, context management, architect routing table |
| [tl-dispatch-topology](tl-dispatch-topology.md) | Pre-dispatch gate (5 checks), pattern validation chain, dynamic scaling, autonomy rules, kill order |
| [tl-verification-gates](tl-verification-gates.md) | Architect verdicts, post-verdict broadcast, post-wave integrity check, token meter gate |
| [tl-phase-execution](tl-phase-execution.md) | Phase transitions, triggers, anti-patterns, context management, execution checklist |
| [tl-quality-doc-pipeline](tl-quality-doc-pipeline.md) | Quality-gater retry rules, doc-updater mandate, CLAUDE.md pointers-only rule |
| [tl-model-profiles](tl-model-profiles.md) | `.claude/model-profiles.json`: 4 profiles, team-lead-opus-override rationale |
| [arch-dispatch-modes](arch-dispatch-modes.md) | Architect PREP/EXECUTE dispatch modes + `scope_doc_path` protocol (Bug #5 + #6) |
| [tl-agent-roster](tl-agent-roster.md) | Agent roster, specialist ownership map, TS/hooks/scripts routing rules |
| [tl-pm-absent-mode](tl-pm-absent-mode.md) | PM liveness check, routing fallback, FORBIDDEN actions when PM goes absent |
| [tl-verification-done-criteria](tl-verification-done-criteria.md) | TDD-first gate, documentation gate, security auditor routing |
| [tl-git-workflow](tl-git-workflow.md) | Branch protection, commit discipline, script invocation, RTK prefix mandate |
| [tl-skills-mcp-tools](tl-skills-mcp-tools.md) | L0 skills, MCP tools, official skills reference |
| [tl-release-workflow](tl-release-workflow.md) | Release steps, post-change checklist, findings summary format |
| [tl-ingestion-request-handler](tl-ingestion-request-handler.md) | context-provider → user approval → doc-updater ingestion pipeline |
| [tl-pattern-gap-handler](tl-pattern-gap-handler.md) | When context-provider emits `PATTERN-GAP: <topic>`: ask user approval OR proceed without. Dispatch ingestion on approval. |
| [tl-task-completion-protocol](tl-task-completion-protocol.md) | Specialists send `READY-FOR-REVIEW: <task-id>`. team-lead verifies delivery, then marks task completed. Never accept specialist self-completion. |
| [context-bundle-schema](context-bundle-schema.md) | Context bundle schema: portable file-based respawn/rotation context — storage, TTL, PATTERNS-only rules, writer/consumer contracts |

## Context Bundles

Every peer spawn/respawn prompt MUST open with the bundle-read mandate from [context-bundle-schema](context-bundle-schema.md) §Consumer Contract:

> **FIRST: Read your bundle at `.planning/wave-{slug}/context-bundles/{role}.md` before any other action (then gate-ack to context-provider). If it is absent or its `wave_slug` does not match the active wave, report "no valid bundle" to team-lead and proceed without it.**

Bundles are written by context-provider (`write_bundle`, via `scripts/sh/write-bundle.sh`) on YOUR dispatch — always BEFORE a kill-then-respawn rotation, optionally before risky long stretches. File bundles are the PRIMARY context-handoff contract — portable to any file-reading agent; hook-based injection (`SubagentStart` `additionalContext`) is a future optional adapter, never the carrier of this invariant.

### Wave Class Artifact Floors

Each wave declares a class in `PLAN.md ### Wave Class` (and the `.planning/wave-{slug}/CLASS` sentinel). The class determines the required **disk artifact** floor — what must exist on disk before `emit-push-proof.sh` allows a push:

| Class | Required disk artifacts |
|-------|------------------------|
| HARNESS | `PLAN.md` (declared CLASS + parseable path-manifest) + all three `arch-*-verdict.md` (HEAD-bound) + `quality-gate.stamp` + `quality-gate-report.json` + `push-proof.json` |
| DOC | `PLAN.md` (with `**Required-Architects**: <role>[, <role>…]` line) + declared arch-*-verdict.md (HEAD-bound) + QG artifacts |
| FAST-PATH | `quality-gate.stamp` + `quality-gate-report.json` + `push-proof.json` only |

Gates verify **files on disk**, not who/how many agents were spawned. Missing `CLASS` → fail-safe to HARNESS (strictest). The planner writes the CLASS sentinel; the `premature-execution-gate.js` T2 and `emit-push-proof.sh` enforce it mechanically. See `tl-session-start.md` Phase 2 Topology Activation Gate for dispatch instructions.

> **`qg-result.json`** (at `.planning/wave-<slug>/qg-result.json`) is the orchestrator-layer verdict/heartbeat SIGNAL — NOT an enforced floor artifact. It is not minted by `emit-push-proof.sh`, not consumed by `verify-proof`, and absent from the table above. See [qg-proof-push-gate § qg-result.json Schema](qg-proof-push-gate.md#qg-resultjson-schema) for details.

### Task List Sharing

The team-lead creates one shared task list per wave (`CLAUDE_CODE_TASK_LIST_ID` env var propagated to all peers). All peers read the same list.

**Specialist tasks are assignment-only — not open-claim.**

- Specialist tasks transition to `in_progress` ONLY on the bound architect's explicit EXECUTE dispatch.
- Idle peers MUST NOT auto-claim specialist tasks (doing so creates unbound work with no architect oversight).
- The mechanical enforcer for this rule is the `specialist-architect-binding-enforcement-queued` gate (BACKLOG; named here as a dependency so the binding is documented before the gate ships).

Team-lead is responsible for assigning specialist tasks explicitly (TaskUpdate `owner` = specialist name) at EXECUTE time.

## Plan-Mode Clarification (before drafting — MANDATORY)

When the main agent acts as orchestrator-planner in plan mode, it MUST surface **2–5 clarifying questions before drafting the plan** whenever the spec is ambiguous on a plan-shaping axis (scope boundary, target files, acceptance criteria, an approach fork, or cross-department impact). Use `AskUserQuestion`; a complete spec → zero questions → draft directly. This mirrors the planner template's *Spec-Ambiguity Clarification* step — one rule, whether the main agent plans directly or dispatches a `planner` peer.

**Bounds (`feedback_stop_asking`)**: spec-ambiguity only, asked once, before drafting — NEVER mid-execution, never for a preference with a sensible default, never to dodge a decision derivable from context.

### Spec-Amendment Pause (worked example)

One pause primitive, two triggers — an explicit clarifying need OR a mid-flight scope change both pause at the next checkpoint:

1. The planner subagent (or the orchestrator) detects ambiguity / a scope change.
2. It emits the questions to the orchestrator via `SendMessage(to="team-lead", summary="spec questions", message="Q1… Q2…")` and pauses (does not write or overwrite `PLAN.md` past the pause point). Planner is spawned as `Agent(subagent_type="planner")` — no `team_name` required.
3. The orchestrator relays via `AskUserQuestion`, gets the answers, and resumes the planner via `SendMessage` (native auto-resume).
4. The planner weaves the answers in and continues. No mid-write interruption is possible (no preemption API); the pause lands at the next file/commit boundary.
