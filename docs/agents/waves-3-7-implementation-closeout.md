---
scope: [agents, workflow, evidence, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: waves-3-7-implementation-closeout
status: active
layer: L0
parent: agents-hub
category: agents
description: "Pre-integration implementation closeout for the ordered Waves 3-7 harness program."
version: 1
last_updated: "2026-09-22"
---

# Waves 3–7 implementation closeout

This record describes the committed, locally verified pre-integration baseline. It does not call the work `SHIPPED`: review, PR checks, merge, and post-merge memory remain separate integration steps.

## Delivered contracts

| Wave | Delivered authority | Canonical implementation |
|---:|---|---|
| 3 | Immutable request-bound structured architect verdicts; strict role, phase, wave, PLAN, HEAD, request, evidence, and decision validation | `scripts/lib/verdict-evidence-contract.cjs`, `scripts/lib/verdict-artifact-store.cjs`, `scripts/lib/verdict-evidence-contract-cli.cjs` |
| 4 | Reproducible run records and agreement-based evidence selection; two independent agreeing full Bats runs for security-critical proof minting | `scripts/lib/evidence-run-record.cjs`, `scripts/sh/lib/bats-handoff.sh`, `scripts/sh/run-bats.sh` |
| 5 | Parsed shell push intent, honest peer policy, and Git-hook-owned portable push authority | `scripts/lib/shell-command-intent.cjs`, `scripts/lib/push-peer-policy.cjs`, `.claude/hooks/push-authorization-gate.js` |
| 6 | Persisted class-aware `PREP → EXECUTE → VERIFY_FINAL → QG → COMPLETE` state machine that delegates lifecycle work to the Wave-1 runtime | `scripts/lib/wave-control-plane.cjs`, `scripts/tools/wave-control-plane.cjs`, `.claude/hooks/wave-phase-gate.js` |
| 7 | Generated operational catalog, reconciled public docs/templates/skills, topology-pilot record, and one documented authority model | `scripts/tools/generate-operational-catalog.cjs`, `scripts/tools/qualify-orchestration-surfaces.cjs`, `docs/agents/operational-surface-catalog.md` |

## Authority boundaries

- JSON verdicts are the only PREP and VERIFY-FINAL authority. Legacy Markdown verdicts remain readable historical artifacts but never authorize a transition.
- Evidence selection rejects newest-wins behavior, reused artifacts, run-id replay, disagreement, stale scope/target metadata, and incomplete counts.
- Runtime push detection is advisory defense-in-depth. The installed Git `pre-push` hook remains the portable enforcement point.
- Role names do not prove actor identity. A rich host may add a capability boundary, but the portable contract never infers one from prose.
- The control plane persists orchestration state but does not duplicate role lifecycle, transports, consultation, or process ownership.

## Acceptance contract

Before integration, the exact final source must satisfy all of the following without source edits between legs:

1. Focused RED/GREEN tests for every modified authority boundary.
2. The complete MCP Vitest roster, TypeScript build, and ESLint with zero errors.
3. Two sequential, independent, complete full-scope Bats runs with identical target metadata and zero `not ok` cases.
4. Operational-surface qualification and generated-catalog equality.
5. Documentation structure, links, frontmatter, counts, and code-to-document authority terminology.
6. `git diff --check`, no test-owned processes, and no mutation of the shared Git worktree by fixtures.

Evidence files are run artifacts, not source documentation. Exact run ids, hashes, and counts belong in the integration report produced after the acceptance campaign; they must not be predicted in this document.

## Local acceptance result

The consolidated local acceptance completed on 2026-09-22 against frozen ext4
snapshot commit `4b4ec1fe2aa858d0d428a7f1602268fca26fe9f6`; the equivalent production
implementation was committed as `4face7b2`:

- MCP Vitest: 139 files, 2666 tests, zero failures.
- Node authority/runtime roster (R33 RED fixtures excluded by its explicit
  deferral): 1856 tests, 1844 passed, zero failed, 12 platform skips.
- Focused Wave-4 evidence tests: 69 Node tests and 131 Bats tests, zero
  failures.
- Full Bats: two sequential runs, each 3415/3415 with zero `not ok`, identical
  HEAD/PLAN/target/environment/tool metadata, and selector
  `agreement_count=2`.
- The two deterministic TAP logs have the same content digest
  (`cb450c1ac8e5710cd6cecc53b65f63ac800550a5323ca6fc51281c0ea4932ba4`)
  but distinct retained-file identities. This is reproducible agreement, not
  artifact reuse; the selector verifies both identities independently.
- TypeScript build, ESLint (zero errors), operational-surface qualification,
  generated-catalog equality, README audit, and `git diff --check` passed.

This establishes `LOCALLY VERIFIED` for Waves 3-7. It does not establish
`SHIPPED`; integration review, commits, PR checks, merge, and post-merge durable
memory remain separate steps.

## Deferred and excluded

- R33 remains deferred pending its external release condition.
- Wave 8 does not exist in this program and is not implied by this closeout.
- No commit, push, PR, merge, or `SHIPPED` label is authorized merely by this document.
- Historical evidence is retained; superseded plans are not rewritten into executable instructions.
