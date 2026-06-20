---
scope: [agents, quality-gate]
sources: [androidcommondoc]
targets: [all]
slug: quality-gater-hub
status: active
layer: L0
category: agents
description: "quality-gater extended-protocol hub: per-step detail sub-docs (Step 7.5 Doc-Validator Parity, Step 9.5 Runtime UI Validation) plus the QG protocol and push-gate references."
---

# quality-gater Hub

Extended-protocol detail for the [quality-gater](../../setup/agent-templates/quality-gater.md) agent (the Phase 3 QG owner). The main template keeps the step skeleton concise; heavier per-step procedures and references live in the sub-docs below.

## Step detail sub-docs

| Document | Step | Description |
|----------|------|-------------|
| [quality-gater-doc-validator-parity](quality-gater-doc-validator-parity.md) | Step 7.5 | Doc-Validator Parity (REQUIRED) — runs `qg-doc-validators.sh` (cross_refs + doc_structure_vitest); local↔CI doc-validator parity that closes the PR #220 gap |
| [quality-gater-runtime-ui-validation](quality-gater-runtime-ui-validation.md) | Step 9.5 | Runtime UI Validation — Android Layout Diff + Compose Semantic Diff dispatch (platform-aware) |
| [quality-gater-registry-integrity](quality-gater-registry-integrity.md) | registry-hash | Registry Integrity (REQUIRED when `skills/` exists) — runs `qg-registry-integrity.sh --require-registry`; 3-state result (clean/drift/n/a); closes the registry-hash rubber-stamp |

## Protocol & push-gate references

| Document | Description |
|----------|-------------|
| [quality-gate-protocol](quality-gate-protocol.md) | Sequential verification protocol (frontmatter → tests → coverage → benchmarks → pre-pr) |
| [qg-proof-push-gate](qg-proof-push-gate.md) | QG-proof push gate: `emit-push-proof.sh` (run-qg / verify-proof), `quality-gate-manifest.json` policy, push-proof schema, verdict→HEAD binding |

## Operational notes

### Stash Hygiene (OBS-B — MANDATORY if you used `git stash`)

If during your run you invoked `git stash` (e.g., to test "is this error pre-existing?" by temporarily hiding in-progress changes), you MUST:

1. Pop the stash before emitting your final report: `git stash pop`
2. Include `Stash: popped cleanly` OR `Stash: pop FAILED — <reason>` in your report. Pop-with-conflicts: escalate via SendMessage to team-lead (stash hash + conflict diff) — dangling stash = silent data loss.

If you did NOT use stash, include `Stash: not used` in the Report. Explicit positive statement beats silence.
