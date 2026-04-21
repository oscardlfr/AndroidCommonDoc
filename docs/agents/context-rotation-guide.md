---
scope: [workflow, ai-agents, context-management]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: context-rotation-guide
status: active
layer: L0
parent: agents-hub
category: agents
description: "Context window management for TeamCreate teams: rotation, archiving, team-lead-as-relay, anti-patterns"
version: 1
last_updated: "2026-03"
assumes_read: autonomous-multi-agent-workflow
token_budget: 1500
---

# Context Rotation Guide

How to manage context window growth in TeamCreate teams. Covers signals, rotation strategies, the team-lead-as-relay pattern, and anti-patterns.

---

## How Context Works in Agent Teams

| Agent type | Context behavior | Freed? |
|------------|-----------------|--------|
| **TeamCreate peer** | Accumulates all SendMessages + tool results | Never (until team dissolves) |
| **Sub-agent (Agent)** | Fresh context (system prompt + task only) | Yes, on completion |
| **team-lead (session lead)** | Accumulates all team + sub-agent interactions | Never (session lifetime) |

**Key insight**: Peers are expensive (context grows). Sub-agents are cheap (context is temporary). Use sub-agents for workers, peers only for coordinators.

> **Context7 queries are stateless**: each `resolve-library-id` / `get-library-docs` call is independent. They do not accumulate context in the context-provider window beyond the response text. Context7 lookups do not contribute to context pressure and do not need to be factored into rotation thresholds.

---

## Signals: When Context Is Growing Too Large

- Team has run **3+ waves** without archiving (9-peer sessions generate context faster)
- team-lead summarizes findings in **3+ paragraphs** (should be 1-2 sentences)
- Architects report patterns **already mentioned** in previous waves
- Tool calls take noticeably longer (context overhead)
- team-lead context bar exceeds **60%**

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

### 3. Re-Spawn Session Team Peers

For long sessions (**5+ waves** with 9 peers, 7+ waves with 5 peers), re-spawn with **SAME name AND SAME team_name** to replace the old peer in-team:

```
Agent(name="arch-platform", team_name="session-{project-slug}", prompt="...", run_in_background=true)
```

This replaces the old `arch-platform` in the team with a fresh context window. **Never** use a "v2" suffix — `arch-platform-v2` creates a second peer instead of replacing the first.

### 4. Dissolve and Recreate Team

If the task changes scope entirely (e.g., from bug fixes to new feature), create a NEW session team:
1. `SendMessage(to="doc-updater", ...)` — archive current team's findings
2. Dissolve current team
3. `TeamCreate(team_name="session-{project-slug}")` — new session team, clean slate
4. Re-add all 9 session team peers with fresh context (5 at session start, 4 core devs when Phase 2 resumes)

### 5. Sub-Agent Over Peer When Possible

If an agent only needs to do **one task and return**, use Agent() (fresh context) instead of adding to team (accumulated context).

```
// GOOD: researcher does one task, returns, context freed
Agent(researcher, prompt="Map export patterns in codebase. Context: {context-provider report}")

// BAD: researcher as team peer, accumulates all team messages
Agent(name="researcher", team_name="session-{project-slug}", prompt="...")
```

---

## team-lead-as-Relay Pattern

team-lead is the only entity that can spawn sub-agents (Agent tool). All other peers must route through team-lead.

```
Architect detects issue
  → SendMessage(to="team-lead", summary="need test-specialist", message="{structured request}")
team-lead receives
  → Agent(test-specialist, prompt="{architect's request + context}")
Dev returns to team-lead
  → SendMessage(to="architect", summary="dev result", message="{structured result}")
Architect verifies
```

**Why**: In-process teammates don't have the Agent tool. Only the session lead (team-lead) can spawn sub-agents.

**Context benefit**: Dev gets fresh context (only the specific task). Architect doesn't accumulate dev's working context (only the summary).

---

## Structured Findings Format

When relaying findings between agents (architect → team-lead → architect), use structured format to minimize information loss:

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

| Agent tier | System prompt | Working context | Total capacity | Rotation threshold |
|-----------|--------------|----------------|----------------|-------------------|
| Orchestrator (team-lead) | ~5K | ~195K | 200K | Never (session lifetime) |
| Architect | ~4K | ~196K | 200K | 7+ waves |
| Core dev | ~3K | ~197K | 200K | 5+ waves (9-peer) / 7+ waves (5-peer) |
| Extra dev | ~2K | ~198K | 200K | Dies after architect verification |
| Shared service | ~2K | ~198K | 200K | 7+ waves |

**Warning signs**: If a template exceeds its system prompt budget, extract sections to reference docs (`.claude/docs/`).

---

## Conditional Team Composition

Default session team (9 peers in `session-{project-slug}`: 5 at session start + 4 core devs at Phase 2):
```
Session start:
  TeamCreate("session-{project-slug}")
  + context-provider + doc-updater + arch-testing + arch-platform + arch-integration
Phase 2 start:
  + test-specialist + ui-specialist + domain-model-specialist + data-layer-specialist
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
| 7+ waves (9-peer) / 10+ waves (5-peer) | Context grows to 60K+ tokens | Re-spawn peers with same name/team_name, or dissolve/recreate |
| Extra devs as team peers | Extras accumulate context they don't need | Core devs are peers; extras are sub-agents via team-lead (no team_name) |
| team-lead reading full verdicts | Verdict prose bloats team-lead context | Architects: 3-line summary first, details on request |
| Not calling doc-updater between waves | Findings lost if session crashes | Archive to disk every 3-5 waves |
| All dept leads in every team | 8 peers = excessive overhead | Conditional: only when their domain is in scope |
| Architects calling Agent() | Fails silently in in-process mode | SendMessage to team-lead for dev dispatch |

---

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology, handoff, failure handling
- [Claude Code Workflow](claude-code-workflow.md) — single-agent patterns
- [Agent Consumption Guide](agent-consumption-guide.md) — how agents load docs
