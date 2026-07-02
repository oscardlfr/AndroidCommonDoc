---
scope: [workflow, ai-agents, dispatch]
sources: [androidcommondoc]
targets: [all]
slug: specialist-dispatch-protocol
category: agents
parent: agents-hub
status: active
layer: L0
description: "Disk-first specialist<->architect dispatch binding: dispatch artifact schema, PREP-HEAD/PLAN_SHA256 currency checks, files[] scope authorization, TaskList tracking-only, SendMessage optional-adapter"
version: 1
last_updated: "2026-07"
---

# Specialist Dispatch Protocol

How a core specialist earns authorization to `Write`/`Edit`/execute-`Bash` in an active wave: a disk-first dispatch artifact bound to the current git HEAD and PLAN content, enforced by `premature-execution-gate.js`. Complements [Agent Verdict Protocol](agent-verdict-protocol.md) (architect PREP/VERIFY-FINAL) and [Team Topology](team-topology.md) (3-phase model).

## Purpose

A specialist may only `Write`/`Edit`/execute-`Bash` in an active wave when there is a **current, disk-verifiable** architect authorization. Two enforcement holes previously let a specialist self-authorize: (1) a shared `TaskList` acting as an auto-claim queue, letting idle peers self-dispatch onto implementation work; (2) the gate accepting *any* `APPROVED-PREP` verdict — even a stale, generic, or pre-PLAN one unrelated to the current dispatch. This protocol closes both: PREP verdicts bind to HEAD+PLAN content, and core specialists additionally require a dispatch artifact naming them and scoping their file targets.

## Dispatch Artifact

Path: `.planning/wave-<slug>/specialist-dispatches/<specialist>/<architect>-<YYYYMMDDTHHMMSSZ>.json` (colon-free UTC timestamp; confined under the wave dir via a realpath guard).

| Field | Type | Description |
|-------|------|-------------|
| `schema` | string | `"specialist-dispatch/v1"` |
| `wave_slug` | string | wave directory slug |
| `architect` | string | authorizing role — `arch-platform`, `arch-testing`, or `arch-integration` |
| `specialist` | string | dispatched role (`doc-updater` is rejected — see Authorship) |
| `head` | string | `git rev-parse HEAD` (40-hex) at write time |
| `plan_path` | string | `.planning/wave-<slug>/PLAN.md` — hardcoded, no override flag (symmetry with `write-verdict.sh`) |
| `plan_sha256` | string | sha256 of `plan_path` raw bytes at write time |
| `files[]` | string[] | repo-relative Write/Edit targets, each resolving **inside** the repo (the writer rejects `--file` values outside `REPO_ROOT`); required non-empty unless `bash_only` (mutually exclusive with `bash_only` — a bash-only dispatch carries no `files[]`) |
| `bash_only` | bool | `true` permits (and requires) empty `files[]`; authorizes execution-`Bash` only, never `Write`/`Edit`. The writer rejects `--bash-only` combined with `--file`. |
| `allowed_tools[]` | string[] | audit/provenance record — **informational-only in v1** |
| `summary` | string | short human-readable task summary |
| `task` | string | full task body (stdin at write time) |
| `created_at` | string | UTC timestamp, `date -u +%Y-%m-%dT%H:%M:%SZ` |

**`allowed_tools[]` is not gate-enforced.** The gate authorizes `Write`/`Edit` purely by `files[]` membership and `Bash` purely by dispatch presence — it never reads `allowed_tools[]`. Do not treat that field as an enforcement boundary; it exists for audit/provenance only.

## Authorship

The orchestrator **materializes** the dispatch artifact from the architect's verdict-recorded fix request via `scripts/sh/write-specialist-dispatch.sh`, before spawning the specialist — the `architect` field records whose judgment authorized it. A live background-peer architect MAY author its own dispatch directly. This is the disk-first floor: `SendMessage`/peer routing to hand off the task is an optional accelerator on top of it, never a substitute for it.

`doc-updater` is **exempt** from the dispatch requirement — `write-specialist-dispatch.sh` rejects it as an invalid `--specialist` value. doc-updater remains PREP-gated only (wave-closeout/doc-sync work, not a domain specialist).

## Gate Enforcement (`premature-execution-gate.js`)

For a core specialist (`test-specialist`, `toolkit-specialist`, `ui-specialist`, `domain-model-specialist`, `data-layer-specialist`) in an active wave (PLAN.md + `### Spawn Table` present):

a. **PREP currency** — an `arch-*-verdict.md` must contain `APPROVED-PREP` **and** `**PLAN_SHA256**` equal to the current PLAN hash (exact match) **and** a `**PREP-HEAD**` that is an ancestor of (or equal to) current HEAD, via `git merge-base --is-ancestor <prepHead> <currentHead>` (exit 0 = current). None found → BLOCK.
b. **Dispatch currency** — a dispatch artifact whose `plan_sha256` exactly matches the current PLAN hash **and** whose `head` is an ancestor of (or equal to) current HEAD (same ancestry check). None found → BLOCK.
c. **`Write`/`Edit` scope** — the normalized repo-relative target must be a member of the **union** of `files[]` across **all** currently-valid **non-`bash_only`** dispatches for that specialist (stale + current dispatch files accumulate in the directory; union, not just the newest). **Out-of-repo targets** (`/tmp`, `../parent`, global paths) are BLOCKED **up front — before `files[]` is consulted**, and out-of-repo `files[]` entries are ignored when building the allowed set, so a dispatch that *lists* an out-of-repo path can never authorize an out-of-tree write. The writer (`write-specialist-dispatch.sh`) additionally rejects any `--file` resolving outside the repo, so a dispatch can never record one. Any in-repo target not in the union is also BLOCKED. Out-of-tree scratch work goes through `Bash` (dispatch-gated, no file parse).
d. **`Bash`** — requires a current dispatch (check b) regardless of `files[]` contents; the command string is **not** parsed for file targets.

**Ancestry, not exact-equality**, is deliberate: exact `head === currentHead` would self-block every multi-commit wave (a PREP written once at the wave's first commit becomes stale the instant a second commit lands, with no way to refresh it). `PLAN_SHA256`/`plan_sha256` exact-match binds authorization to *this wave's exact PLAN content*; ancestry adds "same git lineage," rejecting a coincidentally PLAN-identical PREP or dispatch from an unrelated branch.

**Fail-CLOSED**: an unresolvable `git rev-parse HEAD`, or any `merge-base` invocation erroring for a reason other than "not an ancestor," is treated as not-current → BLOCK.

`doc-updater` allows on PREP currency alone (step a) — no dispatch required (see Authorship, above).

## PREP Binding

`scripts/sh/write-verdict.sh --phase prep` now appends `**PREP-HEAD**` (current `git rev-parse HEAD`) and `**PLAN_SHA256**` (sha256 of the wave's `PLAN.md` raw bytes) to the PREP block, and fails closed (exit 2) if `PLAN.md` cannot be resolved under the wave directory. VERIFY-FINAL's existing `**HEAD**` field and supersede path are untouched — `**PREP-HEAD**` uses a distinct field name precisely so it can never collide with the `**HEAD**`-keyed VERIFY-FINAL/QG-proof binding. See [Agent Verdict Protocol](agent-verdict-protocol.md) for the full verdict lifecycle.

## TaskList = Tracking-Only

`TaskList` records specialist/architect outcomes for the orchestrator's own bookkeeping. It **never authorizes** specialist execution — an item appearing on the shared list is not a claim ticket, and an idle peer picking up a listed item without a current dispatch artifact is exactly the auto-claim failure mode this protocol closes. This mirrors the precedent in [tl-verification-gates.md](tl-verification-gates.md)'s Verdict Tally Protocol, where a `TaskUpdate(status="completed")` is subordinate to an explicit disk-verify step ("verify verdict file on disk... if missing, do NOT TaskUpdate") — TaskList reflects verified disk state, it does not create authority of its own.

## SendMessage = Optional Adapter

`SendMessage` is a notification/accelerator channel for peer coordination — it is **never** harness authority. The load-bearing contract for specialist execution is the pair of disk artifacts (current PREP verdict + current dispatch), not a message received. This scopes but does not remove `SendMessage`'s role: per [ADR-001](../adr/ADR-001-runtime-adapter-contract.md) §1.3, background peers/`SendMessage`/operator visibility are preservable **optional accelerators** — "the artifact floor works without them" — and per §3 Op 2 (`send`), if `SendMessage` is absent or unreliable the fallback is a disk-inbox write, not a loss of function. A dispatch relayed only via `SendMessage`, with no corresponding JSON artifact on disk, does **not** authorize the gate.

## Related

- [Agent Verdict Protocol](agent-verdict-protocol.md) — PREP/VERIFY-FINAL verdict format and disk-write pattern
- [team-lead Dispatch Topology](tl-dispatch-topology.md) — Specialist Dispatch section, pre-dispatch topology gate
- [team-lead Phase Execution Protocol](tl-phase-execution.md) — Phase 2 execution sequencing
- [team-lead Verification Gates](tl-verification-gates.md) — Verdict Tally Protocol (disk-verify-before-TaskUpdate precedent)
- [ADR-001: Runtime Adapter Contract](../adr/ADR-001-runtime-adapter-contract.md) — capabilities-as-optional-accelerators, Op 2 disk-inbox fallback
