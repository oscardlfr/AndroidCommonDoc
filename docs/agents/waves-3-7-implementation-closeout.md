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
version: 2
last_updated: "2026-09-27"
---

# Waves 3–7 implementation closeout

This record preserves the committed, locally verified pre-integration baseline. The work subsequently merged through PR #250 at `develop@dfc48cf8488cf661704f8a312093c663c34db0bb` and is now `SHIPPED`; the acceptance evidence below remains historical and is not a claim that the first downstream-consumer exercise was complete.

The first real L2 consumer after merge exposed bounded runtime distribution,
worktree, launch-documentation, and Claude host-recertification defects. PR #251
closed all 13 findings upstream at
`develop@c5ee193e1f726d270577c9256ea7cb09b481508b`, with clean-consumer and
linked-worktree fixtures. Those post-merge defects are not reasons to rewrite
the frozen PR #250 acceptance record, and they are no longer an active
consumer-hardening follow-up.

## Post-merge consumer stabilization

PR #251 shipped the following bounded closure without modifying a product
repository:

- source-referenced hooks and executable-mode repair;
- required `--add-dir`, canonical POSIX entrypoints, and recovery-mode guidance;
- installed wave topology plus toolkit-owned YAML dependency resolution;
- probe-derived qualification and atomic Claude host-certificate publication;
- honest requested/observed/effective effort, bounded certification startup,
  and an isolated R131 fixture; and
- acceptance from both a clean consumer and a real linked worktree.

The P0/P1/P2 reconciliation in `BACKLOG.md` contains only newly discovered
post-#251 work. This stabilization change closes malformed `settings.json`
handling and operational one-shot silence; false-perfect coverage evidence,
non-atomic adapter publication, proportional `L0_SYNC` CI classification, and
the remaining active residuals do not reopen the 13 closed findings.

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

At the time this evidence was produced it established `LOCALLY VERIFIED`, not
`SHIPPED`. PR #250 subsequently completed integration, and PR #251 completed
the bounded downstream-consumer stabilization described above.

## Deferred and excluded

- R33 remains deferred pending its external release condition.
- Wave 8 does not exist in this program and is not implied by this closeout.
- No commit, push, PR, merge, or `SHIPPED` label is authorized merely by this document.
- Historical evidence is retained; superseded plans are not rewritten into executable instructions.
