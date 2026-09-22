---
scope: [workflow, ai-agents, session-setup]
sources: [wave-control-plane, runtime-role-lifecycle]
targets: [all]
slug: tl-session-setup
status: active
layer: L0
parent: agents-hub
category: agents
description: "Runtime-neutral session setup and selective role lifecycle."
version: 6
last_updated: "2026-09-22"
---

# Orchestrator Session Setup

Session setup is driven by the active PLAN and persisted control-plane state.
There is no fixed spawn-everything roster.

1. Resolve the repository, active wave slug, PLAN, class, and current phase.
2. Initialize or read `wave-phase-state/v1`.
3. Request `lifecycle-actions` from the control plane.
4. Execute those actions through the existing Wave-1 lifecycle and selected
   runtime connector.
5. Dispatch specialists only after PREP and only with a bounded dispatch artifact.

## Class behavior

- HARNESS keeps required architects persistent when the host proves continuity.
- DOC uses bounded ephemeral architect reviews.
- FAST-PATH uses disk-only authority and no architect floor.

When a requested rich mode is unavailable, policy selects an admitted fallback
or fails honestly. A dead/ambiguous binding is never reported as reused.

## Context and rotation

Context bundles are informative, digestable inputs. Rotation stops only the
owned binding after identity/death checks, then ensures a canonical replacement
and rehydrates from the current bundle. Host handles, PIDs, credentials, and
endpoints never enter tracked policy.

## Specialist selection

Use the PLAN Spawn Table and accepted PREP findings. Assign each file to one
owner and write a specialist dispatch before mutation. Independent tasks may run
concurrently; overlapping ownership is serialized. Task lists track completion
but grant no authority.

