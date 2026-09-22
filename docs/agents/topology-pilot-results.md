---
scope: [workflow, ai-agents, orchestration]
sources: [.planning/AUDIT-harness-2026-06.md, .planning/BL-W47-PLAN-v2.md, scripts/lib/runtime-role-lifecycle.cjs]
targets: [all]
slug: topology-pilot-results
status: active
layer: L0
parent: agents-hub
category: agents
description: "Measured topology-pilot decision for HARNESS, DOC, and FAST-PATH waves."
version: 1
last_updated: "2026-09-22"
---

# Topology Pilot Result

The pilot compares only evidence actually observed by earlier harness work. It
does not invent equivalent live runs after the fact.

| Topology | Observed evidence | Strength | Cost/risk observed |
|---|---|---|---|
| Persistent peers | Wave-1 qualification proved stable identity, idle reuse, canonical respawn, mixed-host operation, and clean owned shutdown | Required when continuity and cross-turn state are part of the contract | Startup/readiness/owner management is material and must remain bounded |
| On-demand single-use roles | The June harness audit completed a 14-subagent evidence fan-out and recorded about 2.05M tokens with no idle peers; a fresh disposable reviewer also outperformed a 176k-token bloated retained context | Best fit for bounded DOC review where continuity is not a requirement | Repeated bootstrap cost; no claim of retained identity or context |
| Disk-only | Wave-1 conformance proved the artifact protocol, validation, deadlines, and deterministic no-runtime fallback | Portable authority floor and appropriate FAST-PATH behavior | No liveness or peer-identity claim; progress depends on a registered consumer or explicit later pickup |

The evidence is not symmetric enough to claim a universal winner. The class
decision therefore minimizes capability rather than maximizing concurrency:

- `HARNESS` uses `persistent` because continuity and cross-turn state are part of
  its acceptance contract.
- `DOC` uses `ephemeral` because bounded independent review is the demonstrated
  useful outcome and retained identity is not required.
- `FAST-PATH` uses `disk-only`; QG artifacts remain mandatory, but no agent floor
  is manufactured.

The executable decision lives in `.claude/registry/wave-topology.yaml` and is
consumed by `scripts/lib/wave-control-plane.cjs`. A runtime may provide richer
acceleration, but it may not weaken the class artifact floor or relabel an
ephemeral/disk-only outcome as a persistent peer.

## Re-evaluation trigger

Re-run a live comparison only when a runtime changes continuity semantics,
cost attribution becomes available for both sides, or a class gains a new
contractual need. Ordinary waves inherit this result; they do not repeat the
pilot.
