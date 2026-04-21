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

Before committing ANY out-of-scope change, read `~/.claude/projects/.../memory/feedback_scope_extension_protocol.md`. Out-of-scope findings require SendMessage to team-lead with authorization request BEFORE committing. Silent out-of-scope commits are a hard violation.

## 5. Wave Context Awareness

At session start, read `.planning/PLAN.md` to understand current wave scope. Never act on a prior wave's objectives. If PLAN.md and team-lead dispatch disagree, SendMessage to team-lead with summary="PLAN-DISPATCH DRIFT" before proceeding.

## 6. Stay Alive

Session peers (architects, context-provider, doc-updater, quality-gater) persist for the entire session. Do NOT exit after completing a task. Wait for the next SendMessage.

## 7. MCP Tools Before Bash

When an MCP tool covers your check, call it BEFORE reaching for Bash or Grep:

| Task | MCP tool |
|------|----------|
| KMP source set discipline, forbidden imports | `verify-kmp-packages` |
| Dependency direction, cycle detection | `dependency-graph` |
| Gradle build compliance, hardcoded versions | `gradle-config-lint` |
| String resource locale parity | `string-completeness` |
| Code complexity | `code-metrics` |
| LOC / test ratio baseline | `module-health` |
| DI/navigation wiring, project setup | `setup-check` |
| Pattern doc search | `search-docs`, `find-pattern` |
| KDoc coverage | `kdoc-coverage` |
| Compose @Preview audit | `compose-preview-audit` |

Use Bash for: building, executing Gradle test tasks, git operations, and anything not covered above.
**Never replace an MCP tool with a manual grep** — MCP tools are structured, cached, and audit-logged.

## 8. MCP Tool Declaration (Wave 25)

If you CALL a `mcp__androidcommondoc__<name>` tool, it MUST appear in your agent template's `tools:` frontmatter. The harness does not expose deferred MCP schemas from prose references — "call `search-docs`" in a section body does nothing unless `mcp__androidcommondoc__search-docs` is in the `tools:` line.

**Naming mismatches** (file basename ≠ registered callable): the canonical callable name is what `server.registerTool("<name>", ...)` writes in `mcp-server/src/tools/*.ts`. Two known drifts:

| File | Registered callable |
|------|-------------------|
| `verify-kmp.ts` | `mcp__androidcommondoc__verify-kmp-packages` |
| `check-freshness.ts` | `mcp__androidcommondoc__check-doc-freshness` |

**Declared MCP tools (Wave 25)**: 10 core agents declare MCP tools — context-provider (9), team-lead (13), doc-updater (8), doc-alignment-agent (10), l0-coherence-auditor (7), arch-platform (7), beta-readiness-agent (5), arch-testing (5), codebase-mapper (5), arch-integration (4), verifier (4). See `setup/agent-templates/` for the canonical `tools:` lines.

**If a MCP tool you need is NOT in your frontmatter**: use `ToolSearch("select:mcp__androidcommondoc__<name>")` to load its schema on-demand. Reserve this for rare cross-domain calls — add the tool to your frontmatter if you use it regularly.
