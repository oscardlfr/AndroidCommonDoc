---
scope: [workflow, ai-agents, quality]
sources: [scripts/lib/wave-control-plane.cjs, scripts/tools/wave-control-plane.cjs, .claude/registry/wave-topology.yaml]
targets: [all]
slug: wave-control-plane
status: active
layer: L0
parent: agents-hub
category: agents
description: "Class-aware persisted PREP-to-COMPLETE control plane built on the portable Wave-1 lifecycle."
version: 1
last_updated: "2026-09-22"
---

# Wave Control Plane

The control plane owns one fail-closed state machine:

```text
PREP -> EXECUTE -> VERIFY_FINAL -> QG -> COMPLETE
```

State is stored at `.androidcommondoc/wave-control/<slug>.json` and is bound to the exact PLAN digest and Git HEAD. Illegal transitions, unknown phases, source drift, missing verdicts, or missing QG artifacts reject. Callers cannot skip a phase.

## Class-aware role floors

Verdict architects and lifecycle roles are separate fields in `.claude/registry/wave-topology.yaml`:

- `HARNESS`: platform, testing, and integration verdicts; those roles plus context-provider and doc-updater in persistent lifecycle mode.
- `DOC`: the architects explicitly declared by the PLAN; context-provider and doc-updater in ephemeral lifecycle mode.
- `FAST-PATH`: no architect verdict floor and no retained support roles; disk-only mode, but QG remains mandatory.

PREP and VERIFY_FINAL transitions validate `verdict/v1` artifacts for every required role. QG-to-COMPLETE requires the genuine quality-gate stamp and push proof for the current source.

## Lifecycle integration

The state machine does not implement a second agent lifecycle. Its actions are the existing `ensure`, `status`, and `stop-owned` commands of the Wave-1 runtime lifecycle. Each action also carries the class-selected `persistent`, `ephemeral`, or `disk-only` mode. `init-session`, `resume-work`, and `work` carry the active `wave_slug` into the canonical runtime entrypoint; that entrypoint validates the state and resolves `lifecycle_roles` before invoking the existing connector selected by policy. Legacy intents without a wave slug remain readable during migration but do not claim class-aware qualification.

Public skills must not embed direct vendor-specific `Agent` or `SendMessage` orchestration. Runtime-specific behavior belongs in declared connectors. Repeated entrypoint calls are idempotent against the same state; a different PLAN or HEAD is reported as drift, never silently adopted.

## Quality-gate entrypoint

The canonical `quality-gate` skill operates only in `QG`, discovers repository rules, runs the required checks once for the frozen source, and mints canonical artifacts. It advances to `COMPLETE` only after those artifacts validate.
