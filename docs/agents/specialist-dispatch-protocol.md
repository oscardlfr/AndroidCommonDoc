---
scope: [agents, workflow, security]
sources: [premature-execution-gate, verdict-evidence-schema]
targets: [all]
slug: specialist-dispatch-protocol
status: active
layer: L0
category: agents
description: "Disk-first specialist execution authority after structured PREP approval."
version: 3
last_updated: "2026-09-22"
---

# Specialist Dispatch Protocol

A specialist may mutate an active wave only when disk evidence proves both the
phase authorization and the specialist's bounded assignment. Task lists and
messages are tracking/notification surfaces, never authority.

## PREP authority

`premature-execution-gate.js` scans only canonical
`arch-<short-role>-verdict-prep.json` records. It calls the single structured
validator with the active PLAN digest, current HEAD, wave slug, phase, and role.
At least one record must return `authorizes: true`.

Legacy Markdown, an `APPROVED-PREP` token, file existence, or a conversational
READY cannot satisfy this gate.

## Specialist dispatch artifact

The orchestrator materializes the architect-requested assignment through
`scripts/sh/write-specialist-dispatch.sh`. The JSON record binds:

| Field | Constraint |
|---|---|
| `specialist` | closed core-specialist role |
| `architect` | architect whose accepted PREP finding requested the work |
| `head` | ancestor-or-equal to current HEAD |
| `plan_path` / `plan_sha256` | active PLAN and exact raw-byte digest |
| `files[]` | non-empty repo-relative mutation allow-list unless `bash_only` |
| `bash_only` | permits Bash but contributes no Write/Edit path |

The writer rejects out-of-repository paths. The gate independently normalizes
targets and takes the union of all current non-bash-only dispatches for that
specialist. A hand-edited malformed record cannot authorize an escape.

`doc-updater` is PREP-gated but exempt from specialist dispatch because its
bounded documentation workflow has separate authority. Root-source and
lifecycle bootstraps retain their narrow action/grant gates; they are not broad
specialist bypasses.

## Runtime-neutral delivery

The artifact is load-bearing. A runtime connector may wake a persistent peer,
invoke an ephemeral role, or leave the record for a disk consumer. The result is
published through the coordination artifact protocol. `SendMessage`, TaskList,
or another runtime UI can accelerate observation but cannot create permission.

## Currency and failure

- PLAN or HEAD drift invalidates the applicable records.
- A missing Spawn Table, unresolved HEAD, invalid PREP, missing dispatch, or
  out-of-scope Write/Edit blocks.
- Re-dispatch after scope change creates a new bounded artifact; it does not
  widen an old record in place.
- VERIFY-FINAL approval is separate and cannot retroactively authorize execution.

## Related

- [Verdict Evidence Schema](verdict-evidence-schema.md)
- [Wave Control Plane](wave-control-plane.md)
- [Coordination Artifact Schema](coordination-artifact-schema.md)
- [Team-lead Dispatch Topology](tl-dispatch-topology.md)
