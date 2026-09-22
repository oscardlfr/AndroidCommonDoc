---
scope: [workflow, ai-agents, architects, verdict, evidence, contract]
sources: [androidcommondoc]
targets: [all]
slug: verdict-evidence-schema
status: active
layer: L0
parent: agents-hub
category: agents
description: "Normative verdict-request/v1 and verdict/v1 JSON contract: schemas, evidence objects, validation-vs-authorization fields, CAS rebind/publication semantics, and the atomic cutover from prose-token verdict acceptance."
version: 1
last_updated: "2026-09-22"
token_budget: 2200
---

# Verdict Evidence Schema

This is the canonical reference for the verdict contract: a request-correlated, machine-validated JSON authority system that replaces prose-token acceptance (a bare string like `APPROVED-PREP` inside a mutable Markdown file). A verdict authorizes a phase transition only when every structural binding is valid and its `decision` is `approve`.

## Canonical artifacts

Every architect review begins with an immutable request written before dispatch:

```text
.planning/wave-<slug>/verdict-requests/<request-id>.json
```

Each role has one deterministic current verdict per phase:

```text
.planning/wave-<slug>/arch-<role>-verdict-prep.json
.planning/wave-<slug>/arch-<role>-verdict-verify-final.json
```

JSON is pretty-printed with two-space indentation and a trailing newline. These files are the only authority and are fully human-readable — no derived Markdown is generated from them. Historical `arch-*-verdict.md` files remain readable as history; no consumer may treat them as authoritative or fall back to them.

## `verdict-request/v1`

`scripts/sh/write-verdict-request.sh` is the only supported writer. It runs before dispatch; the orchestrator passes the resulting path and digest to the architect. A request is immutable and single-purpose — never overwritten or reused for a second verdict.

| Field | Constraint |
|---|---|
| `schema` | exact `verdict-request/v1` |
| `request_id` | 128-bit cryptographically random lowercase hex |
| `role` | `arch-platform`, `arch-testing`, or `arch-integration` |
| `phase` | `prep` or `verify-final` |
| `wave_slug` | `^[a-z0-9]+(?:-[a-z0-9]+)*$`, must equal the active wave |
| `plan_sha256` | SHA-256 of raw `PLAN.md` bytes |
| `head` | exact 40-character lowercase Git object ID at request creation |
| `subject` | exact object `{kind,path,sha256}` — `kind` is `plan` for a PREP request, `source-manifest` for VERIFY-FINAL |
| `created_at` | UTC ISO-8601 seconds |

## `verdict/v1`

| Field | Constraint |
|---|---|
| `schema` | exact `verdict/v1` |
| `role` | same closed enum as the request |
| `wave_slug` | same active wave as the request |
| `phase` | `prep` or `verify-final`; must match filename and request |
| `decision` | `approve` or `escalate` |
| `reason_code` | absent for approval; required closed enum for escalation |
| `rationale` | non-empty strict UTF-8, 1–8192 bytes |
| `evidence` | 0–64 closed evidence objects; required non-empty for a VERIFY-FINAL approval |
| `head` | exact request HEAD — PREP later permits this HEAD as an ancestor; VERIFY-FINAL requires the exact current HEAD |
| `plan_sha256` | exact request and active PLAN digest |
| `in_reply_to` | exact request `request_id` |
| `request_ref` | exact object `{path,sha256}` referencing the immutable request |
| `created_at` | UTC ISO-8601 seconds |
| `supersedes` | `null` on first publish; exact object `{sha256}` on rebind |

Escalation `reason_code` is a closed enum: `scope-conflict`, `evidence-insufficient`, `cross-architect-disagreement`, `policy-violation`, `plan-defect`, `other`.

Validation opens and re-hashes `request_ref`, validates the referenced `verdict-request/v1`, then cross-checks `request_id`, role, phase, wave, PLAN digest, HEAD, and subject/evidence scope against it, plus the verdict's own filename. A missing, altered, wrong-role, wrong-phase, wrong-wave, wrong-PLAN, wrong-HEAD, replayed, or conflicting request causes rejection.

## Evidence objects

Evidence has executable semantics, not descriptive labels. Two closed kinds:

- **`opaque-file`** — exactly `{kind,path,sha256}`. Requires a confined, non-symlink regular file within the configured size cap, a stable identity across an fd-bound raw-byte SHA-256 read, and exact digest equality.
- **`json-record`** — exactly `{kind,path,sha256,expected_schema}`. Performs every `opaque-file` check, then strict-decodes a JSON object and requires its top-level `schema` field to equal `expected_schema`.

Unknown kinds, unknown or extra keys, a missing `expected_schema`, absolute or escaping paths, symlink/reparse targets, oversized files, invalid UTF-8 where JSON is required, identity drift between open and digest, or a digest mismatch all reject. A Bats test-suite handoff is treated as `opaque-file`; this contract does not inspect or redefine Bats-internal provenance.

## Validation versus authorization

The canonical validator returns independently reportable fields, never a single boolean:

```text
exists, wellFormed, roleBound, requestBound, headBound, planBound,
evidenceValid, decisionAuthorized, authorizes, reason
```

`authorizes` is `true` only when every preceding binding is `true` **and** `decision == "approve"`. A structurally valid `escalate` record can be fully role/request/HEAD/PLAN/evidence bound while `decisionAuthorized == false` and `authorizes == false` — escalation is durable and terminal for that request. It never authorizes the next phase, and a later approval requires a fresh request.

## Publication, locking, and supersession

`scripts/lib/verdict-artifact-store.cjs` owns all artifact I/O and enforces, under a per-target sibling lock with a bounded timeout:

- canonical confinement beneath the active wave, with symlink/reparse refusal;
- fd-bound reads with before/after identity checks;
- durable temporary write, mandatory file fsync, atomic rename, and parent-directory fsync where the host exposes a directory handle;
- true no-clobber on first publication;
- compare-and-swap on supersession.

First publish requires the target to be absent. Rebinding an existing verdict — after a PLAN amendment or a VERIFY-FINAL HEAD change — requires a fresh request plus:

```text
--supersede --expected-current-sha256 <64-hex>
```

Under lock, the store proves the current bytes match the expected digest, writes the new record with `supersedes.sha256` set to that digest, and replaces atomically. A missing or mismatched expected digest rejects; there is no delete-and-recreate path.

Stable publication reason codes: `lock-timeout`, `already-exists`, `compare-mismatch`, `identity-drift`, `durability-unproven`, `confinement-failed`.

Windows does not expose POSIX directory-fsync semantics consistently. The store capability-detects that specific gap: on Windows, a successful file fsync plus a same-volume atomic replace is the documented durability contract; every other fsync/rename error remains `durability-unproven` and fails closed.

## Identity boundary

The declared `role` on a request or verdict is not a cryptographic identity claim. Request/role correlation — a verdict must reply to a specific immutable request bound to that role, wave, PLAN, and HEAD — is the strongest authenticity claim this contract makes. Stronger actor authorization (for example, cryptographic signing) is out of scope here and may be layered on by a future contract without changing this one.

## Atomic cutover

The producers (schemas, store, CLI, request writer, verdict writer) are tested first while prior consumers remain active. Every consumer then migrates to canonical validation in the same commit set — there is no dual-authority window and no silent fallback. Heredoc verdict-token writing graduates from a warning to a hard block. Legacy `arch-*-verdict.md` Markdown remains readable history but authorizes nothing.

Existing Section G/H rationale checks are preserved unchanged in meaning; they now read `rationale` through the canonical CLI instead of parsing Markdown prose. The seven public skills (`verify`, `review-pr`, `audit`, `full-audit`, `audit-docs`, `doc-integrity`, `audit-l0`) keep their own distinct conversational outputs — each carries one clarification that its PASS/FAIL is not a structured phase-authority verdict.

One narrow, explicitly-scoped legacy-compatibility mode exists outside this contract: `write-verdict.sh --publication-nonce` reproduces the pre-cutover PREP Markdown grammar byte-for-byte, solely for one identified out-of-repo consumer that this contract does not modify. It activates only on explicit `--publication-nonce` combined with `--phase prep`, rejects any combination with the structured contract's own request/digest/decision/evidence arguments or `--supersede`, and never produces output the canonical validator's `authorizes` field recognizes as authorizing anything.

## Implementation

Three focused CommonJS modules, each capped at 250 physical lines:

- **`scripts/lib/verdict-evidence-contract.cjs`** — pure schemas, parsing, validation, serialization. May import only Node built-ins and `scripts/lib/runtime-role-lifecycle/structural-validators.cjs`.
- **`scripts/lib/verdict-artifact-store.cjs`** — confined durable reads/writes, locking, no-clobber, CAS.
- **`scripts/lib/verdict-evidence-contract-cli.cjs`** — thin CLI adapter used by shell consumers.

The store and CLI may import only these three modules, Node built-ins, and path helpers already proven independent of live runtime authority.

## See also

- [Agent Verdict Protocol](agent-verdict-protocol.md) — how architects and hooks use this contract in practice
- [Quality Gate Protocol](quality-gate-protocol.md) — where a VERIFY-FINAL verdict feeds the quality gate
- [QG Proof Push Gate](qg-proof-push-gate.md) — verdict→HEAD binding at push-proof time
- [Architect Dispatch Modes](arch-dispatch-modes.md) — the PREP/EXECUTE dispatch fields, including the request path/digest
