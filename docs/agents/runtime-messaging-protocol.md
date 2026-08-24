---
scope: [workflow, ai-agents, coordination, portable-runtime, runtime-adapter]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-protocol
status: active
layer: L0
parent: agents-hub
category: agents
description: "Wave-1 consultation protocol: consult/v2, result/v2, inbox-ref/v1, cancel/v1, stop/v2 artifact shapes plus the 6-step runtime consultation loop and validate_result_for() contract"
version: 1
last_updated: "2026-08"
assumes_read: runtime-messaging-adapters
token_budget: 1600
---

# Runtime Messaging Protocol

Ground truth for this doc is `BACKLOG.md` Wave 1 § Protocol evolution and § Runtime consultation loop. This is the first canonical documentation of `consult/v2`/`result/v2` outside `PLAN.md` (`PLAN.md:798-921`) and `scripts/lib/runtime-consultation.cjs` — it condenses that already-vetted prose rather than inventing new content.

## Artifact Shapes

| Artifact | Role |
|---|---|
| `coordination/consult/v1` | Legacy pre-PLAN context-provider contact marker; readable for compatibility, not proof a response completed, not the general transaction format |
| `coordination/consult/v2` | PLAN-bound general consultation request: stable `request_id`, target role, one bounded question, at most one optional content-addressed `content_ref`, reply contract, deadline/policy, PLAN digest, exact subject snapshot digest |
| `coordination/message/v1` | Legacy notification envelope only; never a consultation result, too weak to be the v2 inbox reference |
| `coordination/inbox-ref/v1` | Immutable reference carrying `request_id`, request digest, target role, kind, creation time; no caller path — core derives exactly `transactions/<request_id>/request.json`; not an independent copy of request authority |
| `coordination/result/v1` | Legacy result, readable with its shipped semantics; no stricter required fields added |
| `coordination/result/v2` | Correlated post-PLAN response: `in_reply_to`, attempt/epoch, expected roles, result kind/status, non-empty content or a confined content reference+digest, PLAN digest, exact observed subject snapshot |
| `coordination/cancel/v1` | Transaction-local timeout/cancel state — "this consultation will not be accepted", never "kill the peer", never harness phase authority |
| `coordination/stop/v1` | Legacy presence signal only; never controls a new persistent worker generation |
| `coordination/stop/v2` | Session-bound best-effort stop for an adapter-owned worker: worker/session, attempt/lease epoch, expiry, acknowledgement |

[coordination-artifact-schema](coordination-artifact-schema.md) documents the 6 shipped v1 schemas (`consult`/`result`/`request`/`approval`/`stop`/`message`) in full field-level detail; the table above only versions the ones Wave 1 evolves. `coordination/request/v1` + `coordination/approval/v1` keep their shipped ingestion-loop semantics unchanged — Wave 1 does not repurpose them for arbitrary consultations (see [runtime-messaging-cp-writer](runtime-messaging-cp-writer.md)).

## The 6-Step Consultation Loop

1. The requester materializes and validates the exact `plan_ref`, immutable routing-policy snapshot, subject bundle, and any optional content-addressed blob, then publishes `request.json` through the canonical durable no-clobber primitive. Nested requests carry `root_request_id`, an optional `parent_request_id`, and a bounded `max_depth` (default 2); role transitions and depth are validated to prevent loops.
2. The adapter checks the host capability manifest/handshake and selects one allowed driver (see [runtime-messaging-drivers](runtime-messaging-drivers.md)). It publishes the immutable activation; for requester-owned drivers it next durably publishes the activation-intent WAL; only then does it expose `inbox-ref/v1` and return a non-authoritative `ActivationAction`. Either Codex bridge first claims, leases, and admits the item to the per-role scheduler without a WAL — only when that scheduler selects the item for service does the trusted host durably write its WAL, immediately before backend activation. `noop` writes none.
3. A native/disk target wins the advertised attempt claim through the same no-clobber primitive, publishes/refreshes only its attempt-scoped active lease, performs the role-specific work, and writes its own immutable correlated result through the sanctioned writer. For either Codex driver, the sandboxed model is read-only: the trusted host validates its envelope/correlation and solely publishes `result/v2`.
4. The requester polls/waits with a bounded deadline and atomically records an accepted result only when `validate_result_for(...) == valid` for the active epoch.
5. If the peer is dead or its lease expires, perform at most one canonical respawn/re-invocation with the same request id, a new attempt id, and a higher lease epoch.
6. If no valid result arrives, write transaction `cancel/v1`, emit a harness STOP/report that prevents phase advance, and surface the unresolved consultation. Never stop an unrelated persistent peer and never synthesize the target's verdict in the orchestrator.

## Mediated Specialist Path

```text
specialist -> architect request artifact
architect -> context-provider nested request artifact (when needed)
context-provider -> architect correlated result artifact
architect -> specialist correlated result artifact
```

context-provider and the architect remain the semantic authors of their own answers — see [runtime-messaging-cp-writer](runtime-messaging-cp-writer.md) for context-provider's narrow write boundary. Native/disk targets publish through their confined writer; for a Codex-executed role, the trusted host materializes only the validated read-only model envelope as `result/v2`. The orchestrator may schedule, wake, validate, and report; it may not synthesize or impersonate either role.

## Validation Primitive

```text
validate_result_for(request_artifact, result_artifact) -> valid | reason
```

There is no protocol-valid answer when the result is missing, empty, stale, uncorrelated, outside the allowed requester→target→kind policy, written under the wrong declared role, or valid only as free-form runtime/MCP text. Because any process with filesystem write access can self-declare `from`, this primitive proves a protocol-valid consultation *result* — never authenticated actor identity or permission to advance a phase (Waves 3 and 5 own phase evidence and actor policy).

## Related Docs

- [runtime-messaging-adapters](runtime-messaging-adapters.md) — hub
- [runtime-messaging-state-machine](runtime-messaging-state-machine.md) — transaction fencing this loop relies on
- [coordination-artifact-schema](coordination-artifact-schema.md) — the v1 schemas this protocol versions
- [ADR-001 §3.3](../adr/ADR-001-runtime-adapter-contract.md#33-coordination-artifact-schemas) — Coordination Artifact Schemas
