---
scope: [workflow, ai-agents, multi-agent, cross-layer, teams]
sources: [androidcommondoc, anthropic-claude-code]
targets: [all]
slug: cross-layer-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "Cross-layer team coordination: when to use separate teams per layer, filesystem handoff via .planning/HANDOFF.md, and phase synchronization between L1/L2 projects."
version: 1
last_updated: "2026-04"
assumes_read: team-topology, data-handoff-patterns
---

# Cross-Layer Team Coordination Protocol

When a task spans L1 (shared-kmp-libs) and L2 (DawSync, WakeTheCave), two independent session teams run in parallel and coordinate via filesystem handoff files — not direct messaging.

## When to Use

- New API added in L1 that L2 consumes
- Cross-layer refactors: renames or moves that propagate through the dependency chain
- Features requiring parallel implementation across layers

**When NOT to separate:**

- Fix isolated to one layer → single team in that layer's terminal
- Release prep (version bumps) → single PM via Bash
- Doc-only changes → single team

## Architecture: Separate Teams per Layer

```
Terminal 1 (L2 DawSync):         Terminal 2 (L1 shared-kmp-libs):
session-dawsync team             session-shared-kmp-libs team
├── context-provider             ├── context-provider
├── 3 architects                 ├── architects
├── 4 core devs                  ├── core devs
└── quality-gater (P3)           └── quality-gater (P3)
```

- Teams don't collide because each uses a project-specific slug
- Each team follows the full 3-phase model (Planning → Execution → Quality Gate) independently
- Each `context-provider` reads its own project and can `Read` sibling directories for cross-layer context

## Communication: Filesystem Handoff

Direct `SendMessage` between teams is not possible — they live in different team namespaces. Teams coordinate via `.planning/HANDOFF.md` files:

1. **L1 team writes** `.planning/HANDOFF-TO-L2.md` with API contract, breaking changes, and migration notes
2. **L2 context-provider reads** `../shared-kmp-libs/.planning/HANDOFF-TO-L2.md`
3. **L2 team acts** on the handoff
4. **L2 team writes** `.planning/HANDOFF-TO-L1.md` with integration feedback

The user monitors both terminals and acts as router for urgent decisions that cannot wait for a handoff file.

## Handoff File Format

```markdown
# Handoff: L1 → L2
## Date: {date}
## From: session-shared-kmp-libs
## To: session-dawsync
## Status: PENDING | ACKNOWLEDGED | COMPLETED

## Changes
- {what changed in L1}

## Impact on L2
- {what L2 needs to do}

## Migration Notes
- {breaking changes, renames, new APIs}
```

Set `Status: ACKNOWLEDGED` when the receiving team has read and understood the handoff. Set `Status: COMPLETED` when the receiving team has finished acting on it.

## Phase Coordination

| Phase | L1 Team | L2 Team | Coordination |
|-------|---------|---------|-------------|
| Planning | Plan L1 scope | Plan L2 scope | Handoff: API contract |
| Execution | Implement L1 | Implement L2 (may wait for L1) | Handoff: "API ready" |
| Quality Gate | Gate L1 | Gate L2 | Independent — each gates own scope |

L2 Execution phase may start in parallel with L1 if the API contract is stable enough, or wait until L1 writes the "API ready" handoff.

## Future Enhancements (backlog)

- Hook that notifies user when a `HANDOFF` file is written
- `context-provider` auto-check for sibling `.planning/` changes on startup
- Bridge agent pattern for real-time coordination between terminals
