# Wave Quality Gate: qg-macos-local-ci-parity

## Status: PASS

**HEAD**: 1df74834bcd415e1c85f60dd8b6b0092b699ecd8
**Branch**: feature/qg-macos-local-ci-parity
**CLASS**: HARNESS
**History**: 187b507 (macOS/local-QG parity hardening: BL-W4-1/2/3/4/7/9) -> 3b24996 (BL-W4-6: bound validate-doc-update docsRoot walk, exempt repo-root markdown) -> 1df7483 (BL-W4-4: qg-result degraded-env doc-contract + manifest step-count fixes). This is the authoritative, final verdict for 1df7483.

## Proof artifacts (minted at 1df7483 — this is the sole authoritative mint)

- `.androidcommondoc/push-proof.json` — head=1df74834bcd415e1c85f60dd8b6b0092b699ecd8, generated_at 2026-07-08T11:51:24Z, 7/7 required steps PASS
- `.androidcommondoc/quality-gate.stamp` — verdict=PASS @ 1df7483
- `.androidcommondoc/pre-pr.stamp` — verdict=PASS @ 1df7483
- `verify-proof --pushed-sha 1df74834bcd415e1c85f60dd8b6b0092b699ecd8`: PASS (exit 0)

## Required steps (7/7 PASS)

| Step | Result |
|---|---|
| architect-deliberation | PASS — 3/3 required roles (arch-platform, arch-testing, arch-integration) APPROVED-VERIFY-FINAL, HEAD-bound to 1df7483 |
| pre-pr | PASS — commit-lint 3/3, registry-hash clean 159/159, secret-scan PASS, eslint 0 errors, tsc clean, mcp-server 138 files/2605 tests PASS |
| test-suite | PASS — delta-clean (wave's 7 files + vitest 100% clean; see Test suite below) |
| rule-cross-check | PASS — context-provider + 3 architects; bash-3.2 compat, no GNU-only syntax, manifest untouched |
| registry-hash | PASS — clean |
| secret-scan | PASS — trufflehog 3.95.8, 0 findings |
| doc-validator-parity | PASS — cross_refs + doc_structure_vitest parity PASS |

## Test suite

Delta-honest, post `node_modules` restore (see Environment incident below):

- **Wave's 7 touched bats files** (`qg-path-audit`, `resolve-required-roles`, `qg-doc-validators`, `validate-agent-templates`, `write-specialist-dispatch`, `write-verdict`, `emit-qg-result`): 124/124 ok, 0 not-ok.
- **vitest (mcp-server)**: 138/138 files, 2605/2605 tests PASS.
- **Named consumers** (`emit-push-proof`, `test-push-proof-gate`, `emit-push-proof-template-size`, `ci-bats-parity`, `script-static-analysis`): 94 ok / 4 not-ok — all 4 in `test-push-proof-gate.bats`, root-caused to a pre-existing macOS `/var` vs `/private/var` symlink mismatch in `emit-push-proof.sh`'s `worktree_id` check; `emit-push-proof.sh` confirmed NOT in this wave's diff (`git diff 8aacc05..HEAD -- scripts/sh/emit-push-proof.sh` empty; file last touched PR #227, 2026-06-24); reproduced identically pre- and post-restore.
- **Full suite**: 126 not-ok / 1754 ok / 1880 total. Delta-honest classification: 0 of the 126 belong to the wave's 7 touched files (name-matched against the raw TAP log); 4 are the `test-push-proof-gate.bats` entries above; the remaining 122 are spread across files this wave never touches (`sync-gsd-agents.bats`, `copilot-adapter-reference.bats`, `arch-platform-section-h-gate.bats`, `coverage-detect.bats`, and others) — the known macOS-bash-3.2/GNU-userland-portability gap class this wave's own PLAN.md explicitly scopes OUT (Excluded/Deferred: BL-W4-8/10/11/12). The `71` not-ok baseline cited by the `phase-orchestration-restoration` sentinel (HEAD e5b836e) does not reproduce on this box at any point this session (126/128/138/149 measured across multiple runs, pre- and post-restore, at both this wave's HEAD and its parent commit) — a baseline-measurement staleness on this machine, not a wave-4 regression. CI (bash 5.x) remains authoritative green; this is precisely the degraded-local-env semantics documented this wave in `docs/agents/qg-proof-push-gate.md`'s Boundary list (BL-W4-4).

## Environment incident (investigated, resolved — not a regression)

`mcp-server/node_modules` was found emptied mid-run (worktree/rm-rf incident during a baseline measurement, unrelated to wave-4 source). Restored via user-authorized `npm ci` (206 packages, package.json/lock byte-identical to HEAD). All results above are POST-RESTORE fresh re-runs.

## Known non-blocking signal

Same class as `phase-orchestration-restoration`: `qg-result.json` may mechanically report `status:fail` locally in this degraded macOS/local environment even with 0 wave-caused failures — signal only, not push authority. This wave documents that contract directly in `docs/agents/qg-proof-push-gate.md`'s Boundary list (BL-W4-4), rather than leaving it as an unwritten convention.

## Push authorization

Push authority is `push-proof.json` + `verify-proof` + the two-stamp pre-push gate (see `docs/agents/qg-proof-push-gate.md`) — never this file. This sentinel is committed but deliberately NOT declared in this wave's Path-Manifest (Codex P2 review point): BL-W4-7 (auto-recognition of a wave's own `.claude/wave-quality-gates/<slug>.md` sentinel by `qg-path-audit.sh`, superseding the per-wave Path-Manifest workaround used in Waves 1-2) is itself one of this wave's fixes — this file's Path-Manifest-absence is the live self-test proving that fix.
