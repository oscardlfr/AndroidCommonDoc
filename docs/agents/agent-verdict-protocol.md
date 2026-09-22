---
scope: L0
sources: [scripts/lib/verdict-evidence-contract.cjs, scripts/lib/verdict-artifact-store.cjs, scripts/sh/write-verdict-request.sh, scripts/sh/write-verdict.sh]
targets: [.planning/wave-*/]
slug: agent-verdict-protocol
category: agents
parent: agents-hub
status: active
layer: L0
description: "Request-bound structured architect verdict publication and validation protocol."
version: 3
last_updated: "2026-09-21"
---

# Agent Verdict Protocol

Architect phase authority is a machine-validated JSON exchange. A conversational `APPROVE`, a Markdown verdict, or an `APPROVED-*` substring never authorizes PREP or VERIFY-FINAL.

## Artifact flow

1. Before dispatch, create an immutable `verdict-request/v1` under `.planning/wave-<slug>/verdict-requests/` with `write-verdict-request.sh`.
2. Give the architect the exact request path and SHA-256. The role reviews only the requested phase and subject.
3. The architect publishes one deterministic `verdict/v1` using `write-verdict.sh`. Direct Write/Edit and ad-hoc heredocs are not supported publication channels.
4. Consumers call `verdict-evidence-contract-cli.cjs validate` and require `authorizes:true` for the expected role, phase, wave, PLAN, HEAD, request, filename, and evidence set.
5. The architect may send a compact notification after publication. Delivery is a hint to read the artifact, not evidence itself.

## Canonical paths

```text
.planning/wave-<slug>/verdict-requests/<request-id>.json
.planning/wave-<slug>/arch-<role>-verdict-prep.json
.planning/wave-<slug>/arch-<role>-verdict-verify-final.json
```

Legacy `.md` verdicts remain historical and are never a fallback.

## Decisions

`approve` authorizes only when every binding validates. `escalate` is a valid, durable, non-authorizing response and must include a closed reason code. Empty rationale, unknown fields/enums, wrong role or phase, request replay, stale PLAN/HEAD, and invalid evidence all reject.

PREP retains the planned ancestry rule where the consumer explicitly requests it; VERIFY-FINAL binds the exact final HEAD. The Wave Control Plane resolves which architect roles are required for the wave class.

## Evidence

Evidence entries are either confined `opaque-file` byte digests or `json-record` digests with an expected schema. Validation rejects traversal, symlinks/reparse points, unstable identity, oversize content, digest drift, and schema mismatch. Consultation results may be cited as evidence but are not themselves phase verdicts.

## Publication and supersession

`verdict-artifact-store.cjs` owns confined reads, sibling locking, fsync, atomic same-volume replacement, first-write no-clobber, and compare-and-swap supersession. Rebinding requires a fresh request plus `--supersede --expected-current-sha256 <digest>`. Delete-and-recreate and silent overwrite are forbidden.

## Role output

All three architect roles use the same outer contract and place discipline-specific detail in `rationale` and evidence:

- `arch-platform`: architecture, source sets, platform and policy boundaries.
- `arch-testing`: RED/GREEN quality, regression protection, coverage and mutation evidence.
- `arch-integration`: compilation, wiring, installation, consumer and end-to-end behavior.

Public audit or verification skills may report conversational PASS/FAIL, but only the structured architect channel can authorize a phase transition.
