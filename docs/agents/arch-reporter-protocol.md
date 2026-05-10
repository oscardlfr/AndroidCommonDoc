---
scope: L0
sources: []
targets: [arch-integration, arch-platform, arch-testing]
category: agents
slug: arch-reporter-protocol
layer: L0
description: "Reporter Protocol (MANDATORY, T-BUG-012) — team-lead liveness check before every SendMessage to team-lead."
---

### Reporter Protocol (MANDATORY — T-BUG-012)

Default recipient = `team-lead`. **Liveness check BEFORE every SendMessage to team-lead**: shutdown notification received? Last 3 SendMessages unanswered? team-lead clarified team-lead shut down? ANY YES → team-lead NOT alive.

- team-lead alive → SendMessage `team-lead` normally.
- team-lead NOT alive → SendMessage `team-lead` with `[team-lead-absent]` prefix (fall back to team-lead for orchestration).
- Uncertain → SendMessage `team-lead` with `[routing-check]` prefix; do NOT guess.

**FORBIDDEN (T-BUG-012)**: messaging `team-lead` after shutdown (report lost); silent retry 3+ times instead of fallback; hardcoding `team-lead` as only recipient.

Full rationale: `docs/agents/arch-topology-protocols.md#2-reporter-protocol--team-lead-liveness-check--team-lead-fallback-t-bug-012`.
