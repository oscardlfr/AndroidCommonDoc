---
scope: [workflow, testing, quality]
sources: [scripts/sh/run-bats.sh, scripts/tools/run-bats-sharded.cjs, scripts/sh/lib/bats-handoff.sh, scripts/lib/evidence-run-record.cjs]
targets: [all]
slug: evidence-provenance-contract
status: active
layer: L0
parent: agents-hub
category: agents
description: "Portable provenance and agreement contract for test and quality-gate evidence."
version: 1
last_updated: "2026-09-22"
---

# Evidence Provenance Contract

Evidence is acceptable only when a consumer can reproduce what ran, against which source, and under which environment. File recency is never authority.

## Required bindings

Every completed run binds a unique run id, exact Git HEAD, PLAN digest and wave slug, target and target digest, scope, start and finish times, counts, verdict, environment fingerprint, relevant tool versions, the digest of the retained log, and a separately derived retained-file identity. Missing or malformed bindings fail closed.

`scripts/lib/evidence-run-record.cjs` provides the runtime-neutral `evidence-run/v1` record. Its CLI accepts an explicit `--target-sha256` for a resolved roster/configuration and `--tool-versions` as canonical JSON; omitting them means the target digest covers the literal target specification and only Node is claimed. Bats uses the equivalent `BATS_*` handoff fields emitted by `run-bats.sh` and `run-bats-sharded.cjs`.

## Selection and agreement

`scripts/sh/lib/bats-handoff.sh select` validates confinement and every requested binding before selection. A security-critical push-proof mint requires two complete, passing, independently identified full runs that agree on HEAD, PLAN, wave, target, target digest, scope, environment, tools, counts, and verdict. The newest file cannot override disagreement.

Distinct run ids and distinct retained-file identities are both necessary but not sufficient: reused files, mismatched digests, truncated TAP, wrong targets, and stale PLAN or HEAD are rejected. Deterministic runs may correctly produce byte-identical logs and therefore equal content digests; equality of content is agreement, while the file identity proves that two separately retained artifacts were produced. Exceptions must be explicit in the consuming policy; absence of an exception means two agreeing runs.

## Portable roots

Project roots are canonicalized before execution. The sharded runner confines its run-id logs and handoffs to the repository's private `.androidcommondoc` result directory; the serial runner may evaluate a caller-designated log, but refuses a symlink leaf and hashes the retained regular file through a stable descriptor. Producers record the environment fingerprint after the effective toolchain is selected. Consumers never infer portability from a path spelling.

## Skill boundary

Testing, coverage, benchmark, evaluation, and pre-PR skills may present different user-facing summaries, but their durable claims must cite a provenance record. Conversational PASS text is not quality-gate evidence.
