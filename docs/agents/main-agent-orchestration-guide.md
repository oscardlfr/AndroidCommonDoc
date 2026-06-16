---
category: agents
slug: main-agent-orchestration-guide
scope: L0
sources: ["W31.6 retirement of setup/agent-templates/team-lead.md", "docs/agents/tl-session-setup.md", "docs/agents/tl-dispatch-topology.md"]
targets: [main agent]
version: 1.2.0
description: "Orchestration guide for the main agent running a session: team topology, phase protocol, architect routing, context bundles, quality gates."
---

# Main Agent Orchestration Guide

> **W31.6**: The main agent IS the team lead. No separate `team-lead` subagent needed. This guide replaces `setup/agent-templates/team-lead.md` (deprecated W31.6).

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

### Wave Class Floors

Each wave declares a class in `PLAN.md ### Wave Class` (and the `.planning/wave-{slug}/CLASS` sentinel). The class determines the minimum peer set (floor):

| Class | Min Peers | Required roles |
|-------|-----------|----------------|
| HARNESS | 7 | arch-platform, arch-testing, arch-integration, planner, context-provider, doc-updater, quality-gater |
| DOC | 4 | arch-platform (default), context-provider, doc-updater, quality-gater |
| FAST-PATH | 1 | context-provider only (orchestrator acts as team-lead directly) |

Missing `CLASS` → fail-safe to HARNESS (strictest). `WAVE_CLASS_OVERRIDE=HARNESS` is a hardening override only — never a FAST-PATH declaration. The planner writes the CLASS sentinel; the `pre-commit-hook.sh` Gate 3 and `premature-execution-gate.js` T2 enforce it mechanically. See `tl-session-start.md` Phase 2 Topology Activation Gate for spawn instructions.

### Task List Sharing

The team-lead creates one shared task list per wave (`CLAUDE_CODE_TASK_LIST_ID` env var propagated to all peers). All peers read the same list.

**Specialist tasks are assignment-only — not open-claim.**

- Specialist tasks transition to `in_progress` ONLY on the bound architect's explicit EXECUTE dispatch.
- Idle peers MUST NOT auto-claim specialist tasks (doing so creates unbound work with no architect oversight).
- The mechanical enforcer for this rule is the `specialist-architect-binding-enforcement-queued` gate (BACKLOG; named here as a dependency so the binding is documented before the gate ships).

Team-lead is responsible for assigning specialist tasks explicitly (TaskUpdate `owner` = specialist name) at EXECUTE time.
