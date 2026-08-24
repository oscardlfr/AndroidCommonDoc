---
scope: [workflow, ai-agents, coordination, portable-runtime, runtime-adapter]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-state-machine
status: active
layer: L0
parent: agents-hub
category: agents
description: "Wave-1 transaction namespace, attempt_id+lease_epoch fencing, and the PUBLISHED->CLAIMED->ANSWERED->ACCEPTED (+BLOCKED/SUPERSEDED/EXPIRED/CANCELLED) state table"
version: 1
last_updated: "2026-08"
assumes_read: runtime-messaging-protocol
token_budget: 1500
---

# Runtime Messaging State Machine

Ground truth for this doc is `BACKLOG.md` Wave 1 § Transaction layout and fencing, plus the fencing-related bullets in § Verification expected.

## Transaction Namespace

```text
<coordination_root>/<repo_id>/<wave_slug>/<plan_digest>/
  inbox/<target_role>/<request_id>.json
  transactions/<request_id>/
    request.json
    activations/<attempt_id>.json
    claims/<attempt_id>.json
    active-leases/<attempt_id>.json
    takeover.json
    delivery/<attempt_id>.intent.json
    delivery/<attempt_id>.json
    results/<attempt_id>.json
    accepted-result.json
    ack.json
    cancel.json
    conflict/<attempt_id>-<other_attempt_id>.json
  workers/<target_role>/<worker_session_id>/stops/<stop_id>.json
  workers/<target_role>/<worker_session_id>/stops/<stop_id>.ack.json
```

Role inboxes hold validated immutable `inbox-ref/v1` references, never copies with independent authority. The contract covers discovery bounds, filename/path allowlists, maximum envelope/content sizes, `content_ref` confinement beneath approved roots, digest verification, acknowledgement/consumption, retention, and cleanup. A `delivery/` receipt records only driver, request/attempt identifiers, timestamps, outcome, and a bounded error code — it never stores prompt/result text, secrets, or authority.

## Fencing (HARD)

- The requester/supervisor allocates each `attempt_id` and an advertised monotonic `lease_epoch`; a target may claim only that attempt.
- The confined transition lock is an exclusive `.lock/` directory with a bounded wait and **no age-based reclaim** — timeout means STOP/manual recovery, never stale-lock takeover.
- Claim/claim-fence election is outside that lock; candidate-result/accept/cancel/takeover decisions and current-attempt lease refresh re-read active state while holding it.
- Immutable records use one portable first-writer-wins publication primitive: same-directory owner-tagged temp, file fsync, no-clobber link, directory barrier, temp unlink, second directory barrier.
- Atomic replace is limited to active-lease and presence-heartbeat refreshes.
- A protocol takeover is allowed once, increments the epoch, and never overwrites the previous activation, claim, or result: it publishes the new activation, requester-owned WAL when applicable, then `takeover.json` last, and returns any required action only after that authority commit.

## Transaction States

| From | Allowed transition | Constraint |
|---|---|---|
| `PUBLISHED` | `CLAIMED` | only the advertised attempt/epoch can win |
| `CLAIMED` | `ANSWERED` | immutable per-attempt candidate result; not successful until requester acceptance |
| `ANSWERED` | `ACCEPTED` | requester only; `validate_result_for(...)` passes for the current attempt/epoch and exact subject/PLAN, then exclusive no-clobber acceptance wins atomically against cancellation |
| `CLAIMED` | `BLOCKED` | protocol-valid negative terminal result; the requester may acknowledge it, but it is never accepted as an answer and never permits phase advance |
| `CLAIMED` | `SUPERSEDED` → new `PUBLISHED` | one expired-lease takeover maximum; new activation/attempt/higher epoch becomes authoritative only when `takeover.json` is published last, and a later ordinary claim enters `CLAIMED` |
| any non-terminal state | `EXPIRED` or `CANCELLED` | transaction-local terminal state; does not stop a persistent peer |

`validate_result_for(...)` rejects a result whose attempt/epoch is not current, even if it arrives late with otherwise valid fields. Competing files remain visible for conflict detection instead of being overwritten last-writer-wins. Same-digest duplicates may be idempotent; conflicting current results force transaction cancellation plus a harness STOP/report with no phase advance. A stale `stop/v1` can never stop a new worker; `stop/v2` is confined to a specific adapter-owned worker session. See [runtime-messaging-drivers § Driver Fallback](runtime-messaging-drivers.md#driver-fallback-takeover-and-redispatch) for how the `SUPERSEDED` path is exercised in practice, including a real durability bug found and fixed this session.

## Await-Result Liveness Codes (Additive)

M6/M7 added four post-freeze liveness result codes to the requester's `await-result` poll loop (`assessAwaitResultLiveness` in `scripts/lib/runtime-consultation.cjs`), so a dead/unclaimed worker or an expired request is reported promptly instead of silently polling to a generic timeout:

| Code | Meaning |
|---|---|
| `BLOCKED/WORKER_NOT_CLAIMED` | A valid activation exists but no claim arrived before `activation_liveness_expiry` |
| `BLOCKED/WORKER_LEASE_MISSING` | An authoritative claim exists but no active-lease arrived before the claim-no-lease grace window |
| `BLOCKED/WORKER_LEASE_EXPIRED` | The authoritative active-lease itself passed its own `lease_expiry` |
| `TIMEOUT/REQUEST_EXPIRED` | The request passed its own `expiry` with no terminal and no higher-precedence liveness failure above |

**Precedence** (evaluated once per poll iteration, after terminal checks and before the CLI deadline check): a valid terminal result/cancel/accepted-result observed in the same iteration always wins first; otherwise the worker-liveness codes above are checked in the claim→lease→lease-expiry order shown, and only when none applies is request expiry checked; the CLI's own generic `DEADLINE_EXCEEDED` fires only when no more specific durable liveness condition applies at all. This is a purely additive extension of the historical frozen CLI enum — it does not change `dispatch`, `accept-result`, `transaction-ack`, other status codes, or any artifact schema.

Fixed-clock test fixtures must provide live (`_iso_now`/`_iso_plus_seconds`-derived) request/claim timestamps when the assertion under test depends on these codes; a stale hardcoded fixture timestamp produces a different, unintended code (or an unrelated early exit) and is a fixture defect, not evidence that runtime liveness classification is wrong. See `DUR-J-Gap2-await-*` and `XACT-07`..`XACT-10` in `scripts/tests/runtime-consultation-state.bats`.

## Subject vs. Producer Binding (HARD)

Request/result bind exactly to immutable `subject_head`, `plan_digest`, and `subject_scope_digest`; the result separately records the worker's `producer_head` and `producer_worktree_id` as diagnostic provenance and repeats the exact subject snapshot it observed. A target checkout need not equal the subject HEAD, but it must consume the referenced subject snapshot. If the requester's subject HEAD/scope changes before acceptance, the result is stale and a new transaction is required — a result for subject A is never implicitly reused for subject B.

## Related Docs

- [runtime-messaging-adapters](runtime-messaging-adapters.md) — hub
- [runtime-messaging-protocol](runtime-messaging-protocol.md) — the consultation loop these states drive
- [runtime-messaging-drivers](runtime-messaging-drivers.md) — driver fallback exercising `SUPERSEDED`
