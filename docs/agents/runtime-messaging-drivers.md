---
scope: [workflow, ai-agents, runtime-adapter, multi-agent, portable-runtime]
sources: [androidcommondoc]
targets: [all]
slug: runtime-messaging-drivers
status: active
layer: L0
parent: agents-hub
category: agents
description: "Wave-1 activation driver table, routing, fallback matrix, context7-preferred evidence policy, and the takeover-and-redispatch driver-fallback recovery mechanism"
version: 1
last_updated: "2026-08"
assumes_read: runtime-messaging-adapters
token_budget: 2000
---

# Runtime Messaging Drivers

Ground truth for this doc is `BACKLOG.md` Wave 1 § Adapter drivers and routing and § Fallback matrix, plus this session's measured implementation in `scripts/lib/runtime-bridge-codex.cjs`, `scripts/lib/runtime-consultation.cjs`, and `scripts/lib/runtime-role-lifecycle.cjs`.

## Adapter Versioning

This system versions and extends [ADR-001](../adr/ADR-001-runtime-adapter-contract.md)'s 9-op `RuntimeAdapter` contract with consultation dispatch/await semantics — never a parallel `ConsultationAdapter` facade. Runtime spawn, app-server, and MCP operations execute only through explicitly registered host bridges outside the portable shell core (see [runtime-messaging-bridges](runtime-messaging-bridges.md)). A manifest is declarative: allowlisted driver/executable identifiers, fixed argv fields, versions, availability, and approval state — never an arbitrary command string, request-controlled model/permission flags, or anything evaluated with `eval`/shell interpolation.

## Activation Drivers (HARD)

| Activation driver | Use | Required behavior |
|---|---|---|
| `claude-sendmessage` | Wake an existing Claude peer | Send only role + artifact path + kind/request id; never treat reply text as evidence |
| `claude-agent` | Execute one canonical role in Claude without Agent Teams | Outside planner bootstrap only, after request/activation/WAL/inbox are durable, invoke one foreground Agent; no TeamCreate/SendMessage/READY/reuse claim; require a target-gated disk result and ignore final prose |
| `codex-app-server` / persistent thread | Wake a parked Codex worker | Start the retained `session-run` only through the exact top-level-owned `supervisor-start` action/background task, then resume the canonical worker from disk; no operator/out-of-band launch |
| `codex-mcp` | Invoke Codex on demand from Claude or another MCP host | Sandboxed model stays read-only; trusted host validates its correlated result envelope and is the sole publisher of `result/v2`; returned text alone is insufficient |
| `runtime-spawn` | Wake an already-supervised registered disk consumer | Invoke only its fixed allowlisted wake helper; it never starts a model or carries result content |
| `noop` | Notification unavailable | Record diagnostic no-delivery (`commit_point:null`, `delivered:false`, no WAL) and leave progress to an already-registered disk loop or fail closed at deadline |

Requester result polling and optional worker inbox polling are bounded wait strategies, not activation drivers. `noop` plus disk polling completes only when a separately registered external supervisor/worker consumer already exists; otherwise it deterministically times out. The routing registry chooses the connector for one attempt; project collaboration policy separately chooses lifecycle mode and role class — the logical role stays canonical regardless of whether Claude or Codex executes it. Two active drivers never race for the same request by default.

## Fallback Matrix

| Condition | Expected action |
|---|---|
| Live Claude peer + `SendMessage` available | Persist request, notify through Claude driver, validate disk result |
| Agent Teams unavailable + `claude-agent` proven in `auto\|ephemeral` | Outside planner bootstrap, persist request/activation/WAL/inbox, invoke one Agent, require target-gated disk result, ignore final prose, and make no READY/reuse claim |
| Persistent Codex worker available | Persist request, wake/resume worker, validate disk result |
| No persistent Codex worker + Codex MCP available | Persist request, invoke adapter MCP facade; trusted host validates the read-only model envelope and publishes `result/v2`; only that artifact completes |
| Runtime has no messaging capability | Persist request, record no-op delivery, and use bounded polling only if a registered external worker/supervisor consumes that inbox; otherwise timeout deterministically |
| Canonical peer is dead | One bounded canonical respawn/re-invocation, then continue polling |
| Adapter fails but disk result appears | Accept only after full artifact validation; report adapter degradation |
| No valid result before deadline | Transaction cancel + harness STOP/report; consultation remains unanswered and a persistent peer is not killed |

## Context7 Evidence Policy

Context7 is an optional external dependency, never a base-protocol requirement. Two evidence policies exist:

- **`context7-required`** (unchanged, strict) — the architect must consult context-provider, context-provider must attempt Context7, and a null `pattern_evidence_dependency` is rejected. Reserved for tests/scenarios that specifically need to prove the Context7 capability itself.
- **`context7-preferred`** (new) — context-provider's internal MCP search runs first (already unconditional), followed by exactly one mandatory Context7 attempt.
  - **AVAILABILITY-class failure** (HTTP 401/403/429/5xx, timeout, DNS/connection error) → the turn resumes and terminates `ANSWERED` with `pattern_evidence_dependency: null`, mechanically `DEGRADED_UNCITED`, never eligible for ingestion.
  - **INTEGRITY-class failure** (redirect, malformed/oversize content, library mismatch, a second gap attempt) → fails closed exactly like `context7-required`.

  Normal operation and Matrix 3 use `context7-preferred`. Implemented in `scripts/lib/runtime-bridge-codex.cjs` (`classifyContext7Failure`, `HOST_PATTERN_EVIDENCE_UNAVAILABLE_TURN_INPUT`) and `scripts/lib/runtime-consultation.cjs` (`parsePreferredContext7Directive`, `resolveRootEvidenceAuthority`). Root-source's question-text directive is `PREFERRED_CONTEXT7_LIBRARY_ID: /owner/repo` (parallel to the existing `APPROVED_CONTEXT7_LIBRARY_ID`); root-consult sets the intent's `evidence_policy` field directly. Verified end-to-end — a real 503 from a fake Context7 server, real degrade-to-`ANSWERED`-null — by `WAVE1-E2E-03-CONTEXT7-DOWN` in `scripts/tests/runtime-consultation-e2e.bats`.

## Driver Fallback (Takeover-and-Redispatch)

On `WORKER_LEASE_EXPIRED`/`WORKER_LEASE_MISSING`/`WORKER_NOT_CLAIMED`, the root-source bootstrap (`ROOT_SOURCE_BOOTSTRAP_FINAL_LINE` in `scripts/lib/runtime-role-lifecycle.cjs`) instructs exactly one bounded takeover-and-redispatch recovery: run `takeover` once, then redispatch — which always excludes whichever driver the takeover just superseded, read from that attempt's own durable activation record with no new schema field — reporting `BLOCKED NO_SECOND_DRIVER_AVAILABLE` if the redispatch also finds no real driver.

A real production bug was found and fixed while verifying this: `dispatchCanonical`'s inbox-ref publish (`scripts/lib/runtime-consultation.cjs`) used to compute a fresh `created_at` on every call, so a legitimate post-takeover redispatch collided with the first dispatch's already-durable inbox-ref (no-clobber `AUTHORITY_INVALID`) — making the documented recovery unreachable in practice. Fixed by reusing any existing, request-correlated inbox-ref's `created_at` unconditionally, since an inbox-ref is a request-level fact, not an attempt-level one.

Verified end-to-end by `WAVE1-E2E-02-DRIVER-FALLBACK` (real dispatch → real claim → forced lease expiry → real takeover → real redispatch, all succeeding) and at unit level by `WAVE1-DISPATCH-FALLBACK-01` in `scripts/tests/runtime-consultation-cli.test.js`. Historical bootstrap wordings remain decodable through a `ROOT_SOURCE_BOOTSTRAP_FINAL_LINE_HISTORY` array in the same file — not a two-constant special case — so durable actions minted under any prior wording never misclassify as malformed.

## Related Docs

- [runtime-messaging-adapters](runtime-messaging-adapters.md) — hub, current measured status
- [runtime-messaging-state-machine](runtime-messaging-state-machine.md) — the `SUPERSEDED` transition this fallback drives
- [runtime-messaging-bridges](runtime-messaging-bridges.md) — per-bridge host contracts
- [ADR-001 §4](../adr/ADR-001-runtime-adapter-contract.md#4-per-engine-adapter-matrix-constraint-4) — per-engine adapter matrix
