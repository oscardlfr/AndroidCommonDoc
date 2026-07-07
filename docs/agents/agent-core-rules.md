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

Behavioral rules for session agents (context-provider, doc-updater, arch-*, quality-gater, dev specialists). Most are **portable** — they hold under any runtime because the load-bearing contract is disk artifacts. A few describe **Claude-adapter capabilities** (live background peers and `SendMessage`): the §1 CP gate, §3 SendMessage hygiene, and §6 stay-alive-peer rules apply when running under the Claude adapter. A portable or single-use runtime satisfies the same intent through disk artifacts; the portable equivalents belong to the portable coordination layer, not to any one engine.

## 1. Per-Session CP Gate (Claude adapter)

When running under the Claude adapter (live background peers), before your FIRST Grep, Glob, or Bash search call you MUST have received a `SendMessage` response from context-provider in this session; the `context-provider-gate` hook enforces this mechanically.

**Dev first action**: `SendMessage(to="context-provider", summary="gate ack")` — satisfies the gate for the session.

This gate presumes a live context-provider peer reachable by `SendMessage`, so it is a Claude-runtime capability. A portable or single-use runtime with no live messaging obtains the same context-provider oracle through a single-use dispatch or a `coordination/consult/v1` disk artifact validated by the gate's disk-read branch (wave_slug match + `CONSULT_TTL_SECONDS` freshness, no `session_id`) — see [coordination-artifact-schema](coordination-artifact-schema.md) for the full contract.

## 2. Read Docs by Pointer, Never Inline

When referencing rules or patterns, point to the doc — do NOT copy content into spawn prompts or SendMessage bodies. Inline content goes stale; pointers stay current.

- Patterns → `docs/` sub-docs
- Memory → `~/.claude/projects/.../memory/`
- Wave scope → `.planning/wave-<slug>/PLAN.md`

## 3. SendMessage Body ≤200 Tokens (Claude adapter)

When you coordinate via the `SendMessage` accelerator, every SendMessage body must be ≤200 tokens. Long context = context compression = lost rules. If you need to convey more, write to a file and send the path.

## 4. Scope-Extension Protocol

Before committing ANY out-of-scope change, read `~/.claude/projects/.../memory/feedback_scope_extension_protocol.md`. Out-of-scope findings require an authorization request to the orchestrator (team-lead role) BEFORE committing — via `SendMessage` under the Claude adapter, or the portable-mode equivalent (a `request/v1` artifact answered by an `approval/v1` artifact — see [coordination-artifact-schema](coordination-artifact-schema.md)). Silent out-of-scope commits are a hard violation.

## 5. Wave Context Awareness

At session start, read the active wave's `.planning/wave-<slug>/PLAN.md` to understand current wave scope. Never act on a prior wave's objectives. If PLAN.md and the orchestrator's dispatch disagree, raise `PLAN-DISPATCH DRIFT` before proceeding — via `SendMessage` to the team-lead role under the Claude adapter, or a `message/v1` artifact in portable mode (see [coordination-artifact-schema](coordination-artifact-schema.md)).

## 6. Stay Alive (Claude-rich mode)

When the orchestrator runs you as a live background peer (Claude-rich mode), persist for the entire session: do NOT exit after completing a task — wait for the next `SendMessage`. When you are dispatched as a single-use agent (portable/default mode), the opposite holds: land your result as a disk artifact and exit; the orchestrator reads the artifact. Both modes are valid — the load-bearing contract is the disk artifact, not the peer's liveness.

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

**Declared MCP tools (Wave 25+)**: 20 core agents declare MCP tools. See `setup/agent-templates/` for the canonical `tools:` lines per agent.

**If a MCP tool you need is NOT in your frontmatter**: use `ToolSearch("select:mcp__androidcommondoc__<name>")` to load its schema on-demand. Reserve this for rare cross-domain calls — add the tool to your frontmatter if you use it regularly.

## Spawn Prompt Hygiene

Spawn prompts MUST use lean standby language only. Do NOT include wave/round forecasts, task previews, or "you will be doing X" in spawn prompts — work arrives via SendMessage post-spawn.

**Why**: Spawn forecasts create stale context before the agent receives its actual dispatch. The agent starts with incorrect assumptions about scope, priority, or task order. All task context arrives via the first SendMessage from the orchestrator.

**Anti-example (WRONG):**
```
Agent(name="arch-integration", prompt="You are arch-integration. Wave 28 Round 1: you will review CP wiring + liveness hook + catalog script. Start immediately.")
```

**Good example (CORRECT):**
```
Agent(name="arch-integration", prompt="You are arch-integration. Wait for dispatch via SendMessage. Your first action on spawn is to SendMessage to context-provider with 'gate ack'.")
```

See `docs/agents/tl-dispatch-topology.md#spawn-prompt-hygiene` for full rationale.
