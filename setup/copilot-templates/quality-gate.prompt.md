<!-- GENERATED from skills/quality-gate/SKILL.md -- DO NOT EDIT MANUALLY -->
<!-- Regenerate: bash adapters/generate-all.sh -->
---
mode: agent
description: "Run the canonical quality-gate protocol for the active wave and mint push authority only from current structured verdicts and two agreeing full Bats runs."
---

Run the canonical quality-gate protocol for the active wave and mint push authority only from current structured verdicts and two agreeing full Bats runs.

## Instructions

# Quality Gate

Use this entrypoint only after implementation and VERIFY-FINAL review are complete.

1. Resolve the active wave slug and call `scripts/tools/wave-control-plane.cjs status`. The state must be `VERIFY_FINAL`, current for the exact PLAN digest and HEAD.
2. Validate all class-required `verdict/v1` records through `verdict-evidence-contract-cli.cjs`; prose tokens and legacy Markdown are not authority.
3. Transition to `QG` through `wave-control-plane.cjs transition`, passing each required `role=verdict-path` binding.
4. Execute the canonical quality-gater procedure and `scripts/sh/emit-push-proof.sh run-qg`. Security-critical test evidence requires two distinct, agreeing, full-scope Bats handoffs bound to the same HEAD, PLAN/wave, target, environment, tool versions and counts.
5. Verify the emitted proof with `emit-push-proof.sh verify-proof`, then transition `QG → COMPLETE`. That transition independently requires current `quality-gate.stamp`, `pre-pr.stamp`, and `push-proof.json` artifacts and reruns the proof verifier.

The `EXECUTE → VERIFY_FINAL` transition is the one explicit source rebind point: after committing the completed implementation, pass `--rebind-head true`. The control plane records both heads and refuses PLAN drift; no other transition can silently adopt a different HEAD.

The installed Git `pre-push` hook is the sole portable push authority. Runtime hooks and peer-role labels are defense-in-depth only. Never set a bypass, fabricate a stamp, downgrade agreement to newest-wins, or interpret a delivered message as a PASS.
