---
category: agents
slug: main-agent-orchestration-guide
scope: L0
sources: ["W31.6 retirement of setup/agent-templates/team-lead.md", "docs/agents/tl-session-setup.md", "docs/agents/tl-dispatch-topology.md"]
targets: [main agent]
version: 1.1.0
description: "Orchestration guide for the main agent running a session: team topology, phase protocol, architect routing, quality gates."
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
