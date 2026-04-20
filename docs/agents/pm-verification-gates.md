---
scope: [workflow, ai-agents, pm, verification]
sources: [androidcommondoc]
targets: [all]
slug: pm-verification-gates
status: active
layer: L0
parent: agents-hub
category: agents
description: "PM verification gates: architect verdicts, post-verdict broadcast, post-wave integrity check, escalation paths."
version: 1
last_updated: "2026-04"
assumes_read: team-topology, pm-dispatch-topology
token_budget: 1200
---

# PM Verification Gates

Reference for PM's verification requirements after dev work: architect verification gate, post-verdict broadcast protocol, post-wave team integrity check, and escalation paths.

## Architect Verification Gate (non-negotiable)

After EVERY wave of dev work, architects verify as session team peers:

1. **All three are session team peers** — they cross-verify via `SendMessage(to="arch-X", ...)`
2. **Architects request devs from PM** via SendMessage — PM is the sole Agent() spawner (in-process peers cannot use Agent())
3. **Collect verdicts**: ALL three must APPROVE before proceeding
4. **On ESCALATE**: PM does NOT code the fix. Instead:
   - **Re-planifiable** → delegate to `researcher` + `advisor` for new approach
   - **Blocked** → report to user with clear error

```
PM (team peer) coordinates
  ↓
┌─ arch-testing ←→ arch-platform ←→ arch-integration ─┐  (peers, SendMessage)
│  request devs (SendMessage→PM) → detect (MCP) → validate │
│  fix via devs → cross-verify (SendMessage) → re-verify│
└──────────────────────────────────────────────────────┘
  ↓
All APPROVE → next wave
Any ESCALATE → PM re-plans (never codes)
```

## Verdict Tally Protocol (MANDATORY — TaskList pattern)

At Phase 2 start, create one task per expected arch verdict:
```
TaskCreate(title="arch-testing verdict", status="in_progress")
TaskCreate(title="arch-platform verdict", status="in_progress")
TaskCreate(title="arch-integration verdict", status="in_progress")
```

**On receiving `"APPROVE"` from arch-{role}**:
1. `TaskUpdate(title="arch-{role} verdict", status="completed")` — TaskUpdate ONLY, no broadcast.
2. `TaskList` → if all 3 verdict tasks = completed → proceed to Phase 3.

**On receiving `"ESCALATE: <reason>"` from arch-{role}**:
1. Read `.planning/wave{N}/arch-{role}-verdict.md` for full details.
2. SendMessage to relevant peers with `[ESCALATION] arch-{role}: <reason>` marker.
3. Decision: re-planifiable → delegate to researcher+advisor; blocked → report to user with clear error.

**Stall check**: if 3+ min since last substantive message and a verdict task is still in_progress → broadcast "what's blocking?" to pending architects.

Architects don't poll git. They don't read other architects' verdicts unless explicitly tasked. PM is the router.

## Compaction-Loop Detection (S6 — 3-echo threshold)

Context compaction can cause a peer to loop — echoing the same summary repeatedly without making progress. PM tracks the last 3 message summaries per peer.

**How to track** (PM mental model — no external state needed):
- For each peer, note the summary of their last 3 messages.
- If summary[N] ≈ summary[N-1] ≈ summary[N-2] (same intent, same status, no new evidence) → **compaction-loop detected**.

**On detection**:
```
SendMessage(to="user", message="[COMPACTION-LOOP] arch-{role}: 3 consecutive identical summaries detected. Likely context-compacted. Recommend re-spawning: Agent(name='arch-{role}', team_name='session-{slug}', ...)")
```

Do NOT re-spawn automatically — user decides. Just flag and await instruction.

**Threshold**: 3 echoes (not 2 — false-positive risk on retry logic).

## Token Meter Gate

At the end of every wave, PM MUST produce a retrospective and flag high token spend before starting the next wave. This gate is the Wave 23 Sprint 8 (S8) addition.

**What PM logs at wave end**:
- Wave number and sprint slug
- Steps completed (from `TaskList`) — each with short outcome: done / escalated / deferred
- Token estimate: `dispatched-message-count × avg-tokens-per-message` (order-of-magnitude; no precision required)
- Verdict tally: count of APPROVE and ESCALATE from each architect

**Retrospective file** (required):
- Path: `.planning/wave{N}/retrospective.md`
- Written by PM at wave end, before proceeding to Phase 3 or closing the session
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
- <anything the next-wave PM should know: compaction events, rework cycles, user interventions>
```

**Threshold action**:
- If estimate > 80% of the model's context window → PM MUST SendMessage user with `[TOKEN-METER] Wave {N} estimate <pct>% of context window. Recommend splitting remaining scope into Wave {N+1}.`
- Do NOT start next wave without user acknowledgement of the split proposal.
- Threshold reason: context compaction risk climbs sharply above 80%; splitting the wave keeps each wave reliably reproducible.

Precision is not the point — the retrospective anchors wave-over-wave trends so PM can see when scope creep is burning budget.

## Post-Wave Team Integrity Check (MANDATORY)

After collecting verdicts from all architects at the end of each wave, verify team integrity:
1. Bash: read team config to list active session team peers
2. Confirm context-provider, doc-updater, arch-testing, arch-platform, arch-integration, quality-gater are ALL alive
3. Confirm all spawned core devs (test-specialist, ui-specialist, domain-model-specialist, data-layer-specialist — whichever were spawned in scope) are ALL alive
4. If ANY peer is missing: IMMEDIATELY re-spawn with SAME name AND SAME team_name — `Agent(name="X", team_name="session-{slug}", ...)`. NEVER append "-v2". NEVER skip the integrity check.
