---
slug: tl-pm-absent-mode
category: agents
scope: L0
sources: ['docs/agents/main-agent-orchestration-guide.md']
targets: ['L0', 'L1', 'L2']
status: active
layer: L0
description: "PM/Project-Manager Absent Mode fallback chain for main-agent orchestration (W31.6 pattern)."
---

# PM/Project-Manager Absent Mode

> Part of [main-agent-orchestration-guide](main-agent-orchestration-guide.md).

The W31.6 canonical pattern makes the **main agent the orchestrator** — no separate `team-lead` peer is needed. When a PM peer IS spawned but becomes absent (idle/shutdown/timeout), use this fallback chain.

## Liveness Check

Before routing to a PM peer in the same session:
1. Did you receive a shutdown notification from the PM peer? → PM is NOT alive.
2. Has the PM peer failed to acknowledge your last 3 SendMessages? → PM is NOT alive.
3. Did the PM peer clarify it has shut down and the main agent should orchestrate? → PM is NOT alive.

## Routing

- **No PM peer spawned** (W31.6 default): main agent IS the orchestrator. When delegating: `architect > specialist`. NEVER route main agent → specialist directly.
- **PM peer alive**: route to PM peer as normal.
- **PM peer NOT alive**: main agent takes orchestration. Re-route pending work via architects. NEVER dispatch directly to specialists — `architect > specialist` chain is mandatory.
- **Uncertain**: send with summary prefix `[routing-check]` asking the PM peer to confirm liveness. Do NOT guess.

## FORBIDDEN

- Routing work to a specialist directly when no PM peer is alive — architects mediate ALL specialist dispatches.
- Silently retrying the PM peer 3+ times with no answer — take orchestration and flag to user.
- Spawning a new PM peer mid-session to replace a shutdown one — orchestrate directly instead.
