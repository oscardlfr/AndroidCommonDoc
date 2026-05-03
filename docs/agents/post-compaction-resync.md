---
scope: [agents, topology, protocol]
sources: []
targets: [all-agent-templates]
category: agents
slug: post-compaction-resync
---

# Post-Compaction Re-Sync Protocol

> Agent-side protocol for recovering from context compaction mid-session.
> Team-lead detection side: `tl-verification-gates.md#compaction-loop-detection-s6--3-echo-threshold` (§S6).

## Symptoms

You may need re-sync if you observe:
- "I think compaction happened" or unexpected stale state
- Forgotten task completion — you can't recall whether a prior task finished
- Missing inbox history — recent SendMessage exchanges feel absent
- You're about to act on an assumption you can't verify from current context

## Re-Sync Steps (ordered)

1. **Ask team-lead for a snapshot**: `SendMessage(to="team-lead", summary="post-compaction re-sync", message="Need state for {topic} — I may have lost context. Please confirm current status.")` — team-lead has the session-level view.
2. **Read verdict files directly**: for any architect verdict you're working from, read `.planning/<wave>/arch-*-pr<N>-verdict.md` directly rather than relying on remembered state.
3. **Check git log**: `git log --oneline -10` for committed state — what actually landed is authoritative.
4. **Re-read recent inbox**: review the most recent SendMessage exchanges in your context to verify nothing dropped between steps.

## When NOT to Re-Sync

- Trivial single-task lookup: just ask CP directly. No re-sync overhead needed.
- Newly spawned session: you have no prior state to lose. Proceed normally.
- Confirmed in-progress task with recent message activity in your context window: compaction hasn't dropped meaningful state.

## Anti-Pattern: Silent Reset

**FORBIDDEN**: detecting likely compaction and silently restarting from scratch without
informing team-lead. This wastes prior work, may violate architect verdicts already issued,
and creates session-state divergence that team-lead cannot detect or correct.

If you reset silently, team-lead may dispatch work you already completed, or miss that your
in-progress task was abandoned. Always announce suspected compaction via SendMessage first.

## Cross-References

- Team-lead detection side: `docs/agents/tl-verification-gates.md#compaction-loop-detection-s6--3-echo-threshold`
- Verdict re-sync during cancel/amend: `docs/agents/arch-topology-protocols.md#5-cross-architect-state-sync`
