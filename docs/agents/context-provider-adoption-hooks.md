---
scope: [workflow, ai-agents, hooks, observability]
sources: [androidcommondoc]
targets: [all]
slug: context-provider-adoption-hooks
status: active
layer: L0
parent: agents-hub
category: agents
description: "Context-provider adoption gate + tool-use observability layer — Wave 17-lite (session-level enforcement, falsifiable hypothesis)."
version: 1
last_updated: "2026-04"
assumes_read: team-topology, tl-session-setup
token_budget: 1500
---

# Context-Provider Adoption Hooks

Wave 17-lite observability and enforcement layer: mechanical gate for CP consultation, session-level tool logging, and analytics tooling.

## Overview

Context-provider was underutilized because the enforcement was prose-only — agents read the rule but skipped CP when under task pressure. Template text is not a gate: a busy agent routes around it. The solution is mechanical enforcement at the hook layer, not more strongly-worded templates.

Wave 17-lite installs three hooks: one blocking gate (PreToolUse), one tracker (PostToolUse SendMessage), and one observability logger (PostToolUse `.*`). Together they produce a falsifiable, measurable signal: did CP consultation increase? The plan describes a ~2-week observation window before deciding whether to harden, relax, or replace the gate.

## Hook 1: context-provider-gate

**File**: `.claude/hooks/context-provider-gate.js`
**Trigger**: PreToolUse on `Bash`, `Grep`, `Glob`
**Behavior**: Blocks the tool call and returns a human-readable rejection unless a session flag (`.androidcommondoc/cp-consulted-{session_id}.flag`) exists, indicating the calling peer has already SendMessage'd context-provider this session.

**Exempt agent types** (never blocked): `doc-updater`, `context-provider`, `quality-gater`, `release-guardian-agent`. Exemptions are matched against `agent_type` from the hook env, not agent name — so `-2`/`-3` overflow variants are also exempt.

**Fail-open semantics**: if the hook cannot read the flag directory (permissions, missing dir), it allows the tool call and logs a warning to stderr. A broken gate must not block real work.

**Rollback**: delete `.claude/hooks/context-provider-gate.js` — hook is not wired into any skill, no build-time dependency.

## Hook 2: context-provider-consulted

**File**: `.claude/hooks/context-provider-consulted.js`
**Trigger**: PostToolUse on `SendMessage`
**Behavior**: Reads the outgoing message. If `to` is `"context-provider"`, writes `.androidcommondoc/cp-consulted-{session_id}.flag` (touch). This is the flag that gate hook 1 checks.

No blocking, no side effects beyond flag creation. If the flag directory does not exist, the hook creates it.

## Hook 3: tool-use-logger

**File**: `.claude/hooks/tool-use-logger.js`
**Trigger**: PostToolUse `.*` (all tools)
**Output**: `.androidcommondoc/tool-use-log.jsonl` — one JSON object per line.

**JSONL schema**:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | ISO 8601 | Timestamp of tool call completion |
| `session_id` | string | Hook env session identifier |
| `agent_id` | string | Hook env agent identifier |
| `agent_type` | string | Hook env agent type (template name) |
| `tool` | string | Tool name (e.g. `Bash`, `Grep`, `mcp__tool-use-analytics`) |
| `mcp_server` | string\|null | MCP server name if tool is MCP, else null |
| `mcp_tool` | string\|null | MCP tool name if tool is MCP, else null |
| `skill_name` | string\|null | Skill slug if invoked from a `/skill` command, else null |
| `duration_ms` | number | Wall-clock ms from tool start to PostToolUse hook fire |
| `cp_bypass_blocked` | boolean | True if gate hook blocked this agent earlier in session |

**Log rotation**: no automatic rotation. File grows until manually archived. Recommend periodic `mv tool-use-log.jsonl tool-use-log-{date}.jsonl` before long sessions.

## MCP Tool: tool-use-analytics

**File**: `mcp-server/src/tools/tool-use-analytics.ts`
**Tool ID**: `tool-use-analytics` (tool #47 in registry)
**Registered in**: `mcp-server/src/index.ts`

**Input params**:

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `log_path` | string | `.androidcommondoc/tool-use-log.jsonl` | Path to JSONL log |
| `since` | ISO 8601\|null | null (all time) | Filter entries after this timestamp |
| `agent_type` | string\|null | null (all agents) | Filter by agent_type |

**Output schema** (JSON):

```json
{
  "top_tools": [{"tool": "Bash", "count": 142}],
  "dead_tools": ["WebFetch"],
  "mcp_call_rate": 0.31,
  "context7_call_rate": 0.08,
  "skill_call_rate": 0.12,
  "cp_bypass_blocked_count": 3,
  "per_agent": {
    "arch-platform": {"total": 54, "mcp": 18, "cp_bypass_blocked": 1}
  }
}
```

**Aggregation dimensions**: top-tools (sorted by count), dead-tools (registered but zero calls in window), MCP/Context7/skill call rates as fraction of total, CP bypass blocked count, per-agent breakdown with same sub-fields.

## /metrics Skill

**File**: `.claude/commands/metrics.md`
**Intent**: unified observability dashboard — one command, two data sources.

Three sections in output:

1. **Runtime** — `tool-use-analytics` output: top tools, dead tools, MCP/Context7 rates, CP bypass count, per-agent table
2. **Skill-audit** — `skill-usage-analytics` output: skill call rates, unused skills, last-used timestamps
3. **Cross-cutting** — derived: CP adoption rate (sessions with CP consult / total sessions), hook gate effectiveness (bypasses blocked / total Bash+Grep+Glob calls)

Invoke: `/metrics` — no arguments required. Optional `--since {ISO date}` passed through to both analytics tools.

## Falsifiable Hypothesis

From `.planning/wave17-lite-PLAN.md` §2: "Installing a mechanical gate will increase CP consultation rate from ~10% of sessions to ≥60% within 2 weeks, measurable via tool-use-log."

**What to measure** (at ~2-week mark):
- CP consultation rate: sessions with `cp-consulted-*.flag` / total sessions
- CP bypass block count: `cp_bypass_blocked_count` from `tool-use-analytics`
- Pattern quality proxy: architect-escalation rate (architect asking CP vs. dev asking directly)

**Decision tree**:
- Rate ≥60%: gate is working — consider adding more agent types to exempt list, harden log rotation
- Rate 30-60%: partial adoption — investigate which agent_types are bypassing, tighten exemptions
- Rate <30%: gate not firing correctly — check hook wiring, session_id probe findings

## Limitations (Session-Level Gate)

The gate is session-scoped: flag file keyed by `session_id`. This was a deliberate tradeoff from the PRE-FLIGHT probe (task #6): the hook env does not expose a reliable cross-session agent identifier, so cross-session enforcement is not feasible without a persistent registry.

**Known gaps**:
- A peer that sends CP one message then never again passes the gate for the rest of the session — the gate does not enforce per-query consultation
- Flag files accumulate in `.androidcommondoc/` — add to `.gitignore`, clean up after sessions
- `session_id` availability varies by Claude Code version (probe confirmed present in current env; may change)

**Future upgrade path**: if session_id becomes unreliable, replace flag file with an in-memory hook state store keyed by `agent_id` — requires hook runtime state support (not available in current hook SDK).

## Wave 25 Extensions

Wave 25 layered two behavioral upgrades on top of the Wave 17-lite hooks layer:

### 1. Pattern Pre-Cache on Spawn (context-provider v3.0.0)

Earlier versions explicitly deferred all reads "on-demand" (the template said *"Do NOT eagerly pre-read"*). This produced a MCP round-trip per query even for common patterns (source set discipline, DI registration, test dispatcher scopes) — the cache was never populated because caching was banned.

v3.0.0 replaces that rule with a **Spawn Protocol** that hydrates the working context with the L0 pattern index via a batch of `mcp__androidcommondoc__find-pattern` calls keyed by canonical categories (`architecture`, `testing`, `compose`, `error-handling`, `gradle`). Subsequent queries hit the cached pattern titles directly. The Answer Pipeline gains a **Cache first** step before the MCP call.

See `setup/agent-templates/context-provider.md` §"Spawn Protocol" for the exact call sequence.

### 2. Ingestion Loop (T-BUG-005 closed)

context-provider now routes external-source findings (Context7 / WebFetch) through a team-lead-gated ingestion loop that ends in `mcp__androidcommondoc__ingest-content` writing canonical L0 docs. Before Wave 25, only the *flag* half existed — no execution path. See [Ingestion Loop](ingestion-loop.md) for the end-to-end protocol.

### 3. MCP Tool Declaration Requirement

The hooks in this doc (Wave 17-lite) assume agents *can call* MCP tools. Wave 25 discovered that the 10 core agents described MCP usage in their prose but none declared MCP tools in their `tools:` frontmatter — so the harness never exposed the schemas and the `cp_bypass_blocked_count` was artificially low because agents couldn't call CP-backed MCP tools anyway. Wave 25 wired MCP tools into the 10 core agents' frontmatter. This changes the baseline measurement for the Wave 17-lite falsifiable hypothesis — the 2-week window resets from 2026-04-21.

## Cross-References

- Plan: `.planning/wave17-lite-PLAN.md`
- Gate hook: `.claude/hooks/context-provider-gate.js`
- Tracker hook: `.claude/hooks/context-provider-consulted.js`
- Logger hook: `.claude/hooks/tool-use-logger.js`
- MCP tool: `mcp-server/src/tools/tool-use-analytics.ts`
- Skill: `.claude/commands/metrics.md`
- Catalog checker: `scripts/sh/catalog-coverage-check.sh` (lines 87-111)
- team-lead dispatch topology: [tl-dispatch-topology.md](tl-dispatch-topology.md)
- Team topology: [../agents/team-topology.md](team-topology.md)
- Wave 25 ingestion loop: [ingestion-loop.md](ingestion-loop.md)
- Wave 25 MCP declaration rule: [agent-core-rules.md](agent-core-rules.md) §8
