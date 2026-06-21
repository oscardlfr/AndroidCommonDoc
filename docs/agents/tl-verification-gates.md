---
scope: [workflow, ai-agents, pm, verification]
sources: [androidcommondoc]
targets: [all]
slug: tl-verification-gates
status: active
layer: L0
parent: agents-hub
category: agents
description: "team-lead verification gates: architect verdicts, post-verdict broadcast, post-wave integrity check, escalation paths."
version: 1
last_updated: "2026-04"
assumes_read: team-topology, tl-dispatch-topology
token_budget: 1200
---

# team-lead Verification Gates

Reference for team-lead's verification requirements after specialist work: architect verification gate, post-verdict broadcast protocol, post-wave team integrity check, and escalation paths.

## Architect Verification Gate (non-negotiable)

After EVERY wave of specialist work, architects verify and write their verdict files to disk:

1. **All three write `arch-{role}-verdict.md`** (HEAD-bound) to `.planning/wave{N}/`
2. **Cross-verify via SendMessage** (if background peers) or by reading each other's verdict files
3. **Architects request specialists from orchestrator** via SendMessage — orchestrator is the sole Agent() spawner (background peers cannot use Agent())
4. **Collect verdicts**: ALL three `arch-*-verdict.md` files must exist on disk with APPROVE status before proceeding
5. **On ESCALATE**: orchestrator does NOT code the fix. Instead:
   - **Re-planifiable** → delegate to `researcher` + `advisor` for new approach
   - **Blocked** → report to user with clear error

```
orchestrator coordinates (reads disk artifacts + dispatches subagents)
  ↓
┌─ arch-testing ←→ arch-platform ←→ arch-integration ─┐  (via SendMessage or disk)
│  request specialists (→orchestrator) → detect (MCP) → validate │
│  fix via specialists → cross-verify → write verdict to disk │
└──────────────────────────────────────────────────────┘
  ↓
All arch-*-verdict.md on disk + APPROVE → next wave
Any ESCALATE → orchestrator re-plans (never codes)
```

## Verdict Tally Protocol (MANDATORY — TaskList pattern)

At Phase 2 start, create one task per expected arch verdict:
```
TaskCreate(title="arch-testing verdict", status="in_progress")
TaskCreate(title="arch-platform verdict", status="in_progress")
TaskCreate(title="arch-integration verdict", status="in_progress")
```

**On receiving `"APPROVE"` from arch-{role}** (via SendMessage or subagent return):
1. **Verify verdict file on disk**: glob `.planning/wave{N}/arch-{role}-verdict.md`. If missing → DM architect "verdict file not found at expected path; please write it before APPROVE." Do NOT TaskUpdate. Re-await reply.
2. `TaskUpdate(title="arch-{role} verdict", status="completed")` — TaskUpdate ONLY, no broadcast.
3. `TaskList` → if all 3 verdict tasks = completed → proceed to Phase 3.

> **Defense-in-depth**: `.claude/hooks/architect-verdict-presence-gate.js` (PreToolUse SendMessage) blocks APPROVE if no verdict file exists on the architect side. The glob check above is the orchestrator-side complement.

**On receiving `"ESCALATE: <reason>"` from arch-{role}**:
1. Read `.planning/wave{N}/arch-{role}-verdict.md` for full details.
2. SendMessage to relevant peers with `[ESCALATION] arch-{role}: <reason>` marker.
3. Decision: re-planifiable → delegate to researcher+advisor; blocked → report to user with clear error.

**Stall check**: if 3+ min since last substantive message and a verdict task is still in_progress → broadcast "what's blocking?" to pending architects.

**Idle-QG heartbeat** (Phase 3): while quality-gater is running, poll `.planning/wave-<slug>/qg-result.json`. If `status: running` and `updated_at` is stale > ~20 min, the quality-gater is HUNG — issue TaskStop and lean re-dispatch. If the file is ABSENT, do NOT recover; absence during early execution is normal (quality-gater may not have initialized yet).

Architects don't poll git. They don't read other architects' verdicts unless explicitly tasked. team-lead is the router.

## Compaction-Loop Detection (S6 — 3-echo threshold)

Context compaction can cause a peer to loop — echoing the same summary repeatedly without making progress. team-lead tracks the last 3 message summaries per peer.

**How to track** (team-lead mental model — no external state needed):
- For each peer, note the summary of their last 3 messages.
- If summary[N] ≈ summary[N-1] ≈ summary[N-2] (same intent, same status, no new evidence) → **compaction-loop detected**.

**On detection**:
```
SendMessage(to="user", message="[COMPACTION-LOOP] arch-{role}: 3 consecutive identical summaries detected. Likely context-compacted. Recommend kill-then-respawn: shutdown_request to arch-{role}, then Agent(name='arch-{role}', subagent_type='arch-{role}', run_in_background=true, ...) with fresh context and bundle-read mandate — never spawn a -2 replacement alongside a live canonical peer")
```

Do NOT re-spawn automatically — user decides. Just flag and await instruction.

**Threshold**: 3 echoes (not 2 — false-positive risk on retry logic).

## Token Meter Gate

At the end of every wave, team-lead MUST produce a retrospective and flag high token spend before starting the next wave. This gate is the Wave 23 Sprint 8 (S8) addition.

**What team-lead logs at wave end**:
- Wave number and sprint slug
- Steps completed (from `TaskList`) — each with short outcome: done / escalated / deferred
- Token estimate: `dispatched-message-count × avg-tokens-per-message` (order-of-magnitude; no precision required)
- Verdict tally: count of APPROVE and ESCALATE from each architect

**Retrospective file** (required):
- Path: `.planning/wave{N}/retrospective.md`
- Written by team-lead at wave end, before proceeding to Phase 3 or closing the session
- Format:

```
# Wave {N} Retrospective

Sprint: <slug>
Date: <YYYY-MM-DD>

## Steps
| # | Step | Outcome |
|---|------|---------|
| 1 | ... | done / escalated: <reason> / deferred |

## Verdicts
- arch-testing: APPROVE | ESCALATE: <reason>
- arch-platform: APPROVE | ESCALATE: <reason>
- arch-integration: APPROVE | ESCALATE: <reason>

## Token estimate
- Dispatched messages: <N>
- Avg tokens/message: <N>
- Estimate: <N * avg> (≈ <pct>% of <model> context window)

## Notes
- <anything the next-wave team-lead should know: compaction events, rework cycles, user interventions>
```

**Threshold action**:
- If estimate > 80% of the model's context window → team-lead MUST SendMessage user with `[TOKEN-METER] Wave {N} estimate <pct>% of context window. Recommend splitting remaining scope into Wave {N+1}.`
- Do NOT start next wave without user acknowledgement of the split proposal.
- Threshold reason: context compaction risk climbs sharply above 80%; splitting the wave keeps each wave reliably reproducible.

Precision is not the point — the retrospective anchors wave-over-wave trends so team-lead can see when scope creep is burning budget.

## Post-Wave Artifact Integrity Check (MANDATORY)

After collecting verdicts from all architects at the end of each wave, verify disk artifacts:
1. Glob `.planning/wave{N}/arch-*-verdict.md` — confirm all 3 verdict files exist and are HEAD-bound.
   If Phase 3 ran: confirm `.planning/wave-<slug>/qg-result.json` has `status: pass|fail` and `head` matches current HEAD.
2. If running with background peers: confirm context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater are reachable (SendMessage ACK or disk bundle present).
3. Confirm any dispatched core specialists have completed their assigned tasks (output artifacts on disk or APPROVE relayed to architect).
4. If a background peer is missing/unresponsive: kill-then-respawn — CP writes the role bundle first, gracefully terminate the old peer (shutdown_request), then re-spawn the CANONICAL name — `Agent(name="X", subagent_type="X", run_in_background=true, ...)`. NEVER use free-form names for agents holding Write/Bash/gh — non-canonical names are gate-invisible (firing matrix §5). NEVER skip the integrity check.
