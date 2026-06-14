---
scope: [workflow, ai-agents, quality, verification, security]
sources: [androidcommondoc]
targets: [all]
slug: qg-proof-push-gate
status: active
layer: L0
parent: agents-hub
category: agents
description: "QG-proof push gate: emit-push-proof.sh (run-qg/verify-proof), quality-gate-manifest.json policy, push-proof.json schema, verdict→HEAD binding, bypass audit trail."
version: 1
last_updated: "2026-06"
assumes_read: quality-gate-protocol, agent-verdict-protocol
---

# QG-Proof Push Gate

The QG-proof push gate closes the loop between the quality-gater (Phase 3) and the git layer (pre-push hook). The quality-gater mints a cryptographically-bound proof after completing Steps 0-9; the pre-push hook verifies that proof before allowing any push.

**Honest contract**: no push without proof the canonical QG ran for real over HEAD. This is NOT peer-identity enforcement — identity-aware provenance enforcement is deferred to a future harness gate.

---

## Files

| File | Role |
|------|------|
| `quality-gate-manifest.json` | Policy: required steps, conditional steps, named predicates, manifest version |
| `.androidcommondoc/quality-gate-report.json` | Runtime: quality-gater writes after Steps 0-9 |
| `.androidcommondoc/push-proof.json` | Proof: minted by `run-qg`; consumed by `verify-proof` + pre-push hook |
| `.androidcommondoc/push-proof.log` | Audit: JSONL append, fail-OPEN |
| `.androidcommondoc/quality-gate.stamp` | Backward-compat stamp (written by `run-qg`) |
| `.androidcommondoc/pre-pr.stamp` | Backward-compat stamp (written by `run-qg`) |
| `scripts/sh/emit-push-proof.sh` | Canonical emitter + verifier (Bash) |
| `scripts/ps1/emit-push-proof.ps1` | PS1 parity for `run-qg` subcommand |
| `scripts/ps1/verify-push-proof.ps1` | PS1 parity for `verify-proof` subcommand |
| `scripts/sh/lib/manifest-digest.sh` | Shared `canonical_digest()` helper |

---

## Subcommands

### `run-qg` — Proof Emitter (quality-gater Step 10)

```bash
bash scripts/sh/emit-push-proof.sh --subcommand run-qg [--slug <wave-slug>]
```

Runs in sequence, failing CLOSED on any integrity violation:

1. **Manifest-drift check**: recomputes `canonical_digest(quality-gate-manifest.json)` and compares to the stored `protocol_digest`. Drift → exit 2.
2. **Load + validate report**: reads `quality-gate-report.json`. Validates required steps, conditional step structure + named-predicate enforcement, deliberation evidence, pre-PR coverage, discovered rules with `verified_by`.
3. **Verdict→HEAD binding**: reads every `arch-*-verdict.md` in `.planning/wave-<slug>/`. Each file must contain `APPROVED-VERIFY-FINAL` and a `**HEAD**:` field matching `git rev-parse HEAD`. Missing field or HEAD mismatch → exit 2. Digests each file (sha256, CRLF→LF) into `artifact_digests`. See [agent-verdict-protocol](agent-verdict-protocol.md).
4. **Compute `report_digest`**: sha256 of `quality-gate-report.json` (CRLF→LF).
5. **Write backward-compat stamps**: `quality-gate.stamp`, `pre-pr.stamp`.
6. **Write `push-proof.json`**: see schema below.
7. **Append to `push-proof.log`** (fail-OPEN — log I/O failure does not block a valid proof).

### `verify-proof` — Cheap Git-Layer Verifier (pre-push hook)

```bash
bash scripts/sh/emit-push-proof.sh --subcommand verify-proof --pushed-sha <sha>
```

Seven integrity checks, all fail-CLOSED (exit 2 on failure):

1. `schema_version == 1`
2. `proof.head == pushed_sha`
3. `proof.worktree_id == current worktree`
4. Freshness: `generated_at` within 30 min (120 s skew tolerance for clock drift)
5. `proof.manifest_version == manifest.manifest_version`
6. All required steps present in `steps_executed` with `result == PASS`
7. `report_digest` matches recomputed sha256 of current `quality-gate-report.json`

`verify-proof` does NOT re-evaluate predicates. Predicate consistency was enforced at mint (run-qg) and is bound cryptographically via `report_digest`. Post-mint tampering with `quality-gate-report.json` causes a digest mismatch and blocks.

---

## `push-proof.json` Schema (schema_version: 1)

```json
{
  "schema_version":   1,
  "head":             "<40-char sha>",
  "worktree_id":      "<absolute path from git rev-parse --show-toplevel>",
  "generated_at":     "<ISO-8601 UTC>",
  "wave_slug":        "<branch last-segment>",
  "manifest_version": 1,
  "steps_executed":   [{"step": "<id>", "result": "PASS|SKIP", "ran": true|false}],
  "report_digest":    "<sha256 hex>",
  "artifact_digests": {"arch-<role>-verdict.md": "<sha256 hex>"}
}
```

---

## `quality-gate-manifest.json` Policy

Committed to repo root. Versioned (`manifest_version`) so `verify-proof` detects stale proofs from a prior manifest revision.

```json
{
  "manifest_version": <N>,
  "protocol_digest":  "<sha256 of manifest content, CRLF->LF>",
  "required_steps":   [...],
  "conditional_steps": [...]
}
```

**Required steps** (6): `architect-deliberation`, `pre-pr`, `test-suite`, `rule-cross-check`, `registry-hash`, `secret-scan`. A `FAIL` result blocks proof emission.

**Conditional steps** (8) carry a `predicate` field evaluated at mint time. Named predicates (closed enum — unknown predicates are a hard exit-2 error):

| Predicate | True when | env_attested |
|-----------|-----------|--------------|
| `project_type_gradle_or_hybrid` | `settings.gradle[.kts]` exists at repo root | — |
| `project_type_node_or_hybrid` | `package.json` at root or in any immediate subdir | — |
| `kt_files_changed` | Any `.kt` file in `git diff $BASE...$HEAD` range | — |
| `kt_changed_and_gradle` | `kt_files_changed` AND `project_type_gradle_or_hybrid` | — |
| `task_is_code_changes` | Diff includes non-doc/non-config files | — |
| `kt_and_docs_api_and_gradle` | `kt_files_changed` AND `docs/api/` exists AND Gradle | — |
| `compose_ui_files_changed` | `ui/` or `compose/` `.kt` files in diff | — |
| `runtime_ui_available` | `.androidcommondoc/ui-baseline/` exists | yes |

If predicate is `true` and the report shows `SKIP` → `inconsistent-skip` (exit 2), **except** for steps with `env_attested: true` (currently only `runtime-ui-validation`): predicate-true + SKIP + non-empty `reason` is allowed — the runtime environment check is delegated to the quality-gater's attested reason. If predicate is `true` and result is `FAIL` → `mandatory-step-not-pass` (exit 2).

---

## Verdict→HEAD Binding

VERIFY-FINAL verdicts written by `write-verdict.sh --phase verify-final` carry a `**HEAD**:` field (sha at emit time). `run-qg` enforces `verdict.head == git rev-parse HEAD` at proof-mint time.

**Required roles**: `run-qg` cross-checks that every role in `quality-gate-manifest.json architect-deliberation.required_roles` has both (a) an entry in `report.deliberation.architects_consulted` and (b) a `VERIFY-FINAL`+HEAD-bound `arch-<role>-verdict.md` in the wave dir. Current required roles: `arch-platform`, `arch-testing`, `arch-integration`. A missing role in either check → exit 2 `deliberation-role-incomplete`.

**Rule**: if any commit lands after VERIFY-FINAL is written, re-run `write-verdict.sh --phase verify-final` before calling `run-qg`. A verdict approved at commit A does not satisfy a proof minted at commit B.

---

## Bypass Audit Trail

`SKIP_PUSH_GATE=1` and `PUSH_AUTHORIZATION_BYPASS` are logged to `push-proof.log` (JSONL, fail-OPEN) with the pushed SHA. Bypasses are always detectable through session records and audit logs. The audit trail does not prevent bypass — it makes bypass visible.

---

## Related Docs

- [Quality Gate Protocol](quality-gate-protocol.md) — Steps 0-9 that produce `quality-gate-report.json`; Step 10 calls `run-qg`
- [Agent Verdict Protocol](agent-verdict-protocol.md) — VERIFY-FINAL `**HEAD**:` field requirement and re-run rule
- [Pre-Commit Hooks](../guides/pre-commit-hooks.md) — three-layer pre-push gate overview
- [Hook Manifest](hook-manifest.md) — `push-authorization-gate.js` + git-layer hook classifications
