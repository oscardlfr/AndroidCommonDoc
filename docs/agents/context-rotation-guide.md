---
scope: [workflow, ai-agents, context-management]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: context-rotation-guide
status: active
layer: L0
parent: agents-hub
category: agents
description: "Context window management for TeamCreate teams: rotation, archiving, PM-as-relay, anti-patterns"
version: 1
last_updated: "2026-03"
assumes_read: autonomous-multi-agent-workflow
token_budget: 1500
---

# Context Rotation Guide

How to manage context window growth in TeamCreate teams. Covers signals, rotation strategies, the PM-as-relay pattern, and anti-patterns.

---

## How Context Works in Agent Teams

| Agent type | Context behavior | Freed? |
|------------|-----------------|--------|
| **TeamCreate peer** | Accumulates all SendMessages + tool results | Never (until team dissolves) |
| **Sub-agent (Agent)** | Fresh context (system prompt + task only) | Yes, on completion |
| **PM (session lead)** | Accumulates all team + sub-agent interactions | Never (session lifetime) |

**Key insight**: Peers are expensive (context grows). Sub-agents are cheap (context is temporary). Use sub-agents for workers, peers only for coordinators.

---

## Signals: When Context Is Growing Too Large

- Team has run **5+ waves** without archiving
- PM summarizes findings in **3+ paragraphs** (should be 1-2 sentences)
- Architects report patterns **already mentioned** in previous waves
- Tool calls take noticeably longer (context overhead)
- PM context bar exceeds **60%**

---

## Rotation Strategies

### 1. Archive to Disk Mid-Session

For sessions > 5 waves:
```
SendMessage(to="doc-updater", summary="archive waves 1-5",
  message="Archive completed findings to DECISIONS.md and CHANGELOG.md. Waves 1-5 are done.")
```

### 2. Summarize Between Waves

Before starting wave N+1, write a **3-line summary** of wave N findings. Do NOT carry full findings forward.

```
Wave 3 summary: Fixed 4 encoding issues in data layer (arch-platform).
2 tests added (arch-testing verified). Build passes (arch-integration verified).
Remaining: 1 ESCALATED issue — navigation restructuring needs design decision.
```

### 3. Dissolve and Recreate Team

If the task changes scope (e.g., from bug fixes to new feature), create a NEW TeamCreate team:
1. `SendMessage(to="doc-updater", ...)` — archive current team's findings
2. Dissolve current team
3. `Agent(context-provider, prompt="Current state after wave 5")` — fresh context
4. `TeamCreate(team_name="wave-6-feature")` — new team, clean slate

### 4. Sub-Agent Over Peer When Possible

If an agent only needs to do **one task and return**, use Agent() (fresh context) instead of adding to team (accumulated context).

```
// GOOD: researcher does one task, returns, context freed
Agent(researcher, prompt="Map export patterns in codebase. Context: {context-provider report}")

// BAD: researcher as team peer, accumulates all team messages
Agent(name="researcher", team_name="wave-1", prompt="...")
```

---

## PM-as-Relay Pattern

PM is the only entity that can spawn sub-agents (Agent tool). All other peers must route through PM.

```
Architect detects issue
  → SendMessage(to="PM", summary="need test-specialist", message="{structured request}")
PM receives
  → Agent(test-specialist, prompt="{architect's request + context}")
Dev returns to PM
  → SendMessage(to="architect", summary="dev result", message="{structured result}")
Architect verifies
```

**Why**: In-process teammates don't have the Agent tool. Only the session lead (PM) can spawn sub-agents.

**Context benefit**: Dev gets fresh context (only the specific task). Architect doesn't accumulate dev's working context (only the summary).

---

## Structured Findings Format

When relaying findings between agents (architect → PM → architect), use structured format to minimize information loss:

```json
{
  "domain": "testing",
  "file": "FamilyManagerViewModel.kt",
  "line": 42,
  "issue_type": "missing_regression_test",
  "severity": "HIGH",
  "evidence": "toStdString() corrupts UTF-8 on Windows",
  "action_needed": "test-specialist: write failing test"
}
```

---

## Token Budget Guidelines

| Agent tier | System prompt | Working context | Total capacity |
|-----------|--------------|----------------|----------------|
| Orchestrator (PM) | ~5K | ~195K | 200K |
| Architect | ~4K | ~196K | 200K |
| Dev specialist | ~3K | ~197K | 200K |
| Shared service | ~2K | ~198K | 200K |

**Warning signs**: If a template exceeds its system prompt budget, extract sections to reference docs (`.claude/docs/`).

---

## Conditional Team Composition

Default team (5-6 peers, within recommended 3-5 range + services):
```
PM + arch-testing + arch-platform + arch-integration + context-provider + doc-updater
```

Add ONLY when in scope:
```
+ marketing-lead → marketing copy, release blog, landing pages
+ product-lead → pricing decisions, spec changes, roadmap
```

**Why**: Official guidance recommends 3-5 teammates. Each peer adds context overhead.

---

## Anti-Patterns

| Anti-pattern | Why it's bad | Fix |
|-------------|-------------|-----|
| 10+ waves in same team | Context grows to 60K+ tokens | Dissolve/recreate at 5 waves |
| Devs as team peers | Accumulate context for work they don't need | Always sub-agents via PM |
| PM reading full verdicts | Verdict prose bloats PM context | Architects: 3-line summary first, details on request |
| Not calling doc-updater between waves | Findings lost if session crashes | Archive to disk every 3-5 waves |
| All dept leads in every team | 8 peers = excessive overhead | Conditional: only when their domain is in scope |
| Architects calling Agent() | Fails silently in in-process mode | SendMessage to PM for dev dispatch |

---

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology, handoff, failure handling
- [Claude Code Workflow](claude-code-workflow.md) — single-agent patterns
- [Agent Consumption Guide](agent-consumption-guide.md) — how agents load docs
