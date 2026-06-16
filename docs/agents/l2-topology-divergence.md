---
scope: [workflow, ai-agents, cross-layer]
sources: [androidcommondoc]
targets: [all]
slug: l2-topology-divergence
status: active
layer: L0
parent: agents-hub
category: agents
description: "Doctrine for L1/L2 spawn-topology divergence from the L0 adaptive floor: document-not-override, preserve consumer-private topology, reconcile after the team-primitive re-eval"
version: 1
last_updated: "2026-06"
---

# L1/L2 Topology Divergence Doctrine

How L0 treats a consumer project (L1/L2) whose local agent topology diverges from the L0 adaptive-floor model.

## The divergence

L0 mandates **selective spawning** with **per-class adaptive floors** — spawn only the roles a wave class requires (HARNESS = full floor; DOC = reduced; FAST-PATH = minimal), and never idle a peer the wave does not need.

Some consumer projects locally institutionalized the opposite: a **spawn-everything-upfront-and-idle** kickoff that spawns a fixed full roster regardless of wave class. This actively opposes the L0 selective-spawning rule and the adaptive floor.

## Doctrine: document, do not force-override

When a consumer's topology diverges:

1. **Preserve consumer-private files.** Never overwrite a consumer's private agent files (`.claude/agents/*`) with L0 copies. Consumer spawn-counts that reflect that project's real domain topology are legitimate and stay.
2. **Override only on hard-invariant conflict.** Force-align a consumer only where its divergence breaks a hard L0 invariant. The selective-spawning *MANDATE* is the candidate invariant, but it is **recommended-not-forced** while the underlying multi-agent team primitive is itself under active re-evaluation (see below).
3. **Document the divergence here** rather than silently inheriting or silently overriding. Silent inheritance hides a real conflict; silent override destroys legitimate consumer topology.

## Why not override now

The L0 multi-agent execution model is built on a named-team coordination primitive that is being re-evaluated end-to-end (spawn mechanism, message routing, completion delivery). Forcing consumers onto the *current* L0 spawn doctrine while that primitive is in flux would propagate a model that may itself change. Until the team-primitive re-evaluation lands, spawn-topology divergences are **tolerated and documented**, not overridden.

## When to revisit

After the team-primitive re-evaluation ships a stable canonical execution model, reconcile each consumer's topology against the then-current L0 model: keep domain-driven spawn-counts, align the selective-spawning posture, and retire this divergence note if the gap closes.

## Related

- [main-agent-orchestration-guide](main-agent-orchestration-guide.md) — L0 orchestration + selective spawning
- [cross-layer-protocol](cross-layer-protocol.md) — cross-layer team coordination
- `feedback_never_overwrite_l2_agents` (memory) — never copy L0 over consumer-private agents
