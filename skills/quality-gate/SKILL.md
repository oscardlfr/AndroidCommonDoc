---
name: quality-gate
description: "Run the canonical quality-gate protocol for the active wave with one full local Bats aggregate; required GitHub CI Gate remains merge authority."
intent: [quality-gate, verification, push-proof, evidence]
allowed-tools: [Bash, Read, Grep, Glob]
copilot: true
copilot-template-type: behavioral
---

# Quality Gate

Use this entrypoint only after implementation and VERIFY-FINAL review are complete.

1. Resolve the active wave slug and call `scripts/tools/wave-control-plane.cjs status`. The state must be `VERIFY_FINAL`, current for the exact PLAN digest and HEAD.
2. Validate all class-required `verdict/v1` records through `verdict-evidence-contract-cli.cjs`; prose tokens and legacy Markdown are not authority.
3. Transition to `QG` through `wave-control-plane.cjs transition`, passing each required `role=verdict-path` binding.
4. Execute the canonical quality-gater procedure and `scripts/sh/emit-push-proof.sh run-qg`. Local test evidence is one canonical full aggregate produced by `run-bats-sharded.cjs` with 6 shards at max parallelism 6 and explicit `--wave-slug` plus `--plan`; it must bind the same HEAD, PLAN/wave, full target, environment, tool versions, and complete zero-failure counts.
5. Verify the emitted proof with `emit-push-proof.sh verify-proof`, then transition `QG → COMPLETE`. That transition independently requires current `quality-gate.stamp`, `pre-pr.stamp`, and `push-proof.json` artifacts and reruns the proof verifier.

The local full run validates the exact branch HEAD and authorizes publishing it.
The required GitHub `CI Gate` is the independent merge authority: strict branch
protection runs it on the PR merge candidate updated with `develop`; never merge
while it is absent, red, cancelled, or pending. These are deliberately different
subjects, so do not claim GitHub tested the byte-identical local SHA. Do not rerun
a green local full suite to manufacture a second local agreement artifact.

The `EXECUTE → VERIFY_FINAL` transition is the one explicit source rebind point: after committing the completed implementation, pass `--rebind-head true`. The control plane records both heads and refuses PLAN drift; no other transition can silently adopt a different HEAD.

The installed Git `pre-push` hook is the sole portable push authority. Runtime hooks and peer-role labels are defense-in-depth only. Never set a bypass, fabricate a stamp, treat a partial shard as a full run, or interpret a delivered message as a PASS.
