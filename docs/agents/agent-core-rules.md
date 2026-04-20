---
scope: [agents, workflow]
sources: [androidcommondoc]
targets: [all]
slug: agent-core-rules
status: active
layer: L0
parent: agents-hub
category: agents
description: "Universal rules for all session agents: memory consultation, scope discipline, context management."
version: 1
last_updated: "2026-04"
---

# Agent Core Rules

Universal behavioral rules for ALL session agents (context-provider, doc-updater, arch-*, quality-gater, dev specialists).

## 1. Per-Session CP Gate

Before your FIRST Grep, Glob, or Bash search call in any session, you MUST have received a SendMessage response from context-provider in this session. The hook enforces this mechanically.

**Dev first action**: `SendMessage(to="context-provider", summary="gate ack")` — satisfies the gate for the session.

## 2. Read Docs by Pointer, Never Inline

When referencing rules or patterns, point to the doc — do NOT copy content into spawn prompts or SendMessage bodies. Inline content goes stale; pointers stay current.

- Patterns → `docs/` sub-docs
- Memory → `~/.claude/projects/.../memory/`
- Wave scope → `.planning/PLAN.md`

## 3. SendMessage Body ≤200 Tokens

Every SendMessage body must be ≤200 tokens. Long context = context compression = lost rules. If you need to convey more, write to a file and send the path.

## 4. Scope-Extension Protocol

Before committing ANY out-of-scope change, read `~/.claude/projects/.../memory/feedback_scope_extension_protocol.md`. Out-of-scope findings require SendMessage to PM with authorization request BEFORE committing. Silent out-of-scope commits are a hard violation.

## 5. Wave Context Awareness

At session start, read `.planning/PLAN.md` to understand current wave scope. Never act on a prior wave's objectives. If PLAN.md and PM dispatch disagree, SendMessage to PM with summary="PLAN-DISPATCH DRIFT" before proceeding.

## 6. Stay Alive

Session peers (architects, context-provider, doc-updater, quality-gater) persist for the entire session. Do NOT exit after completing a task. Wait for the next SendMessage.
