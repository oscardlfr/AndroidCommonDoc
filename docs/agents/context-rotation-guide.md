---
scope: [workflow, ai-agents, context-management]
sources: [anthropic-claude-code, androidcommondoc]
targets: [all]
slug: context-rotation-guide
status: active
layer: L0
parent: agents-hub
category: agents
description: "Context window management for background peer agents: rotation with context bundles, archiving, orchestrator-as-relay, anti-patterns"
version: 5
last_updated: "2026-06"
assumes_read: autonomous-multi-agent-workflow
token_budget: 1500
---

# Context Rotation Guide

How to manage context window growth in background peer agents. Covers signals, rotation strategies, the orchestrator-as-relay pattern, and anti-patterns. Applies when agents run as background peers with `run_in_background=true`; single-use Agent subagents get fresh context per dispatch and don't need rotation.

---

## How Context Works in Multi-Agent Dispatch

| Agent type | Context behavior | Freed? |
|------------|-----------------|--------|
| **Background peer** (`run_in_background=true`) | Accumulates all SendMessages + tool results | Never (until dismissed or session ends) |
| **Single-use subagent** (default) | Fresh context (system prompt + task only) | Yes, on completion |
| **Orchestrator (main agent)** | Accumulates all subagent interactions + disk reads | Never (session lifetime) |

**Key insight**: Background peers are expensive (context grows). Single-use subagents are cheap (context is temporary). Use single-use subagents for workers; background peers only for long-lived coordinators that need cross-wave context.

> **Context7 queries are stateless**: each `resolve-library-id` / `get-library-docs` call is independent. They do not accumulate context in the context-provider window beyond the response text. Context7 lookups do not contribute to context pressure and do not need to be factored into rotation thresholds.

---

## Signals: When Context Is Growing Too Large

- Team has run **3+ waves** without archiving (10-peer sessions generate context faster)
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

### 3. Rotate Background Peers (kill-then-respawn)

For long sessions (**5+ waves** with background peers), rotate a peer in three steps:

0. **Write the bundle BEFORE the kill**: dispatch context-provider `write_bundle(role, plan_id, status_snapshot)` → `.planning/wave-{slug}/context-bundles/{role}.md` ([context-bundle-schema](context-bundle-schema.md)). A dead peer cannot be queried for its state; architect-role bundles carry the verdict state, in-flight findings, and pending dispatches.
1. **Kill properly**: `SendMessage(to="arch-platform", message={type:"shutdown_request"})` — wait for the peer to terminate.
2. **Re-spawn the CANONICAL name**: `Agent(name="arch-platform", subagent_type="arch-platform", run_in_background=true, prompt="...")` — fresh context window with full gate coverage. The respawn prompt MUST open with the bundle-read mandate (schema §Consumer Contract): the fresh peer reads its bundle as the literal first action.

**Anti-pattern — indexed replacement**: spawning `arch-platform-2` as a replacement does NOT rotate the role. Indexed `-2` names are legitimate ONLY as intentional OVERFLOW capacity — a second peer working alongside a LIVE canonical peer, addressed explicitly by its own `-2` name. **Never use free-form names** for agents holding Write/Bash/gh — non-canonical names are invisible to every type-keyed gate (firing matrix §5).

**Single-use subagents** need no rotation — they get fresh context per dispatch. If a single-use subagent's result is on disk, simply dispatch another one for the next task.

> Worktree note: stamps (`.androidcommondoc/quality-gate.stamp`, `pre-pr.stamp`) are PER-WORKTREE — a peer working in a linked worktree must run /quality-gate and /pre-pr inside its own worktree or the git pre-push gate blocks its pushes.

### 4. Reset Session (scope change)

If the task changes scope entirely (e.g., from bug fixes to new feature):
1. Dispatch doc-updater to archive current findings to disk
2. Gracefully terminate any live background peers (shutdown_request to each)
3. Start a new dispatch cycle: fresh context-provider consult, fresh subagent dispatch for the new scope

### 5. Sub-Agent Over Peer When Possible

If an agent only needs to do **one task and return**, use Agent() (fresh context) instead of adding to team (accumulated context).

```
// GOOD: researcher does one task, returns, context freed
Agent(researcher, prompt="Map export patterns in codebase. Context: {context-provider report}")

// BAD: researcher as long-lived background peer when a single task is all that's needed — accumulates all messages
Agent(name="researcher", run_in_background=true, prompt="...")
```

---

## Orchestrator-as-Relay Pattern

The orchestrator (main agent) is the only entity that can spawn sub-agents (Agent tool). Background peer teammates must route through the orchestrator when they need specialist dispatch.

```
Background peer architect detects issue
  → SendMessage(to="team-lead", summary="need test-specialist", message="{structured request}")
Orchestrator receives
  → Agent(subagent_type="test-specialist", prompt="{architect's request + context}")
Specialist returns to orchestrator
  → orchestrator relays result to architect via SendMessage
Architect verifies + writes verdict to disk
```

**Why**: In-process background peers don't have the Agent tool. Only the main conversation (orchestrator) can spawn Agent subagents.

**Context benefit**: Specialist gets fresh context (only the specific task). Architect background peer doesn't accumulate specialist's working context (only the summary).

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
| Core specialist | ~3K | ~197K | 200K | 5+ waves (10-peer) / 7+ waves (5-peer) |
| Extra specialist | ~2K | ~198K | 200K | Dies after architect verification |
| Shared service | ~2K | ~198K | 200K | 7+ waves |

**Warning signs**: If a template exceeds its system prompt budget, extract sections to reference docs (`.claude/docs/`).

---

## Conditional Dispatch Composition

Default dispatch (6 core roles at session start, 5 core specialists at Phase 2):
```
Session start dispatch:
  context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater
Phase 2 dispatch:
  test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist, toolkit-specialist
```

Add ONLY when in scope:
```
+ marketing-lead → marketing copy, release blog, landing pages
+ product-lead → pricing decisions, spec changes, roadmap
```

**Why**: Each background peer adds context overhead. Prefer single-use subagents for work that doesn't need cross-wave context accumulation.

---

## Anti-Patterns

| Anti-pattern | Why it's bad | Fix |
|-------------|-------------|-----|
| 5+ waves without rotating a context-bloated background peer | Context grows to 60K+ tokens | Rotate kill-then-respawn (bundle → shutdown_request → respawn canonical name) |
| Extra specialists as background peers | Extras accumulate context they don't need | Use single-use Agent subagents for overflow work |
| Orchestrator reading full verdict prose | Verdict prose bloats orchestrator context | Read only the verdict file's summary section; get details on demand |
| Not dispatching doc-updater between waves | Findings lost if session crashes | Archive to disk every 3-5 waves |
| All dept leads as background peers in every session | Excessive context overhead | Conditional: only when their domain is in scope |
| Background peer architects calling Agent() | Fails silently in in-process mode | SendMessage to orchestrator for specialist dispatch |

---

## Related Docs

- [Multi-Agent Patterns](multi-agent-patterns.md) — topology, handoff, failure handling
- [Claude Code Workflow](claude-code-workflow.md) — single-agent patterns
- [Agent Consumption Guide](agent-consumption-guide.md) — how agents load docs
