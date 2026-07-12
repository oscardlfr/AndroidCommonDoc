---
scope: [workflow, ai-agents, quality, verification, security]
sources: [androidcommondoc]
targets: [all]
slug: qg-proof-push-gate
status: active
layer: L0
parent: agents-hub
category: agents
description: "QG-proof push gate: emit-push-proof.sh (run-qg/verify-proof), quality-gate-manifest.json policy, push-proof.json schema, verdict→HEAD binding, bats-evidence binding (Wave A), bypass audit trail."
version: 3
last_updated: "2026-07-11"
assumes_read: quality-gate-protocol, agent-verdict-protocol
---

# QG-Proof Push Gate

The QG-proof push gate closes the loop between the quality-gater (Phase 3) and the git layer (pre-push hook). The quality-gater mints a cryptographically-bound proof after completing Steps 0-9; the pre-push hook verifies that proof before allowing any push.

**Honest contract**: no **normal branch** push without proof the canonical QG ran for real over HEAD (the pre-push hook exempts branch deletions, tags, protected-branch merge refs, and `SKIP_PUSH_GATE=1`), backed by a real bats evidence handoff for that same HEAD (Wave A) — not just an asserted `test-suite: PASS`. This is NOT peer-identity enforcement — identity-aware provenance enforcement is deferred to a future harness gate.

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
| `.planning/wave-<slug>/qg-result.json` | Orchestrator signal; written by `emit-qg-result.sh`; NOT consumed by `verify-proof`/pre-push; NOT a manifest step |
| `scripts/sh/emit-push-proof.sh` | Canonical emitter + verifier (Bash) |
| `scripts/ps1/emit-push-proof.ps1` | PS1 `run-qg` **DISABLED** (Wave A) — hard-refuses to mint (exit 2) pending PS1 evidence binding; see BACKLOG |
| `scripts/ps1/verify-push-proof.ps1` | PS1 parity for `verify-proof` subcommand — unaffected by the `run-qg` disable; gained the same `bats_evidence` 8th check as bash |
| `scripts/sh/lib/manifest-digest.sh` | Shared `canonical_digest()` helper |
| `scripts/sh/lib/bats-handoff.sh` | Sole parser/selector for bats evidence handoffs (Wave A) — `select_bats_handoff` (sourced) + `select` (standalone CLI) |

---

## Subcommands

### `run-qg` — Proof Emitter (quality-gater Step 10)

```bash
bash scripts/sh/emit-push-proof.sh --subcommand run-qg [--slug <wave-slug>]
```

Runs in sequence, failing CLOSED on any integrity violation:

1. **Manifest-drift check**: recomputes `canonical_digest(quality-gate-manifest.json)` and compares to the stored `protocol_digest`. Drift → exit 2.
2. **Load + validate report**: reads `quality-gate-report.json`. Validates required steps, conditional step structure + named-predicate enforcement, deliberation evidence, pre-PR coverage, discovered rules with `verified_by`. **Evidence binding (Wave A)** — six additional named checks, all fail-closed (exit 2), identified by name not number (never call any of these "check 5" — see the naming discipline in [quality-gate-protocol](quality-gate-protocol.md)): `invalid-step-result` (every `steps[].result` ∈ `{PASS,FAIL,SKIP}`); `duplicate-step-id` (no two entries share a step id — closes a last-write-wins overwrite); `unknown-step-id` (every step id ∈ `required_steps` ∪ `conditional_steps` ∪ `informational_steps`); `report-started-at-*` (see "QG-Session Freshness" below); `report-head-*` (see "QG-Session Freshness" below); `test-suite-evidence-*` (see "Evidence Binding" below).
3. **Verdict→HEAD binding**: reads every `arch-*-verdict.md` in `.planning/wave-<slug>/`. Each file must contain `APPROVED-VERIFY-FINAL` and a `**HEAD**:` field matching `git rev-parse HEAD`. Missing field or HEAD mismatch → exit 2. Digests each file (sha256, CRLF→LF) into `artifact_digests`. See [agent-verdict-protocol](agent-verdict-protocol.md).
4. **Committed-tree integrity** (fail-CLOSED — all four parts run after verdict→HEAD binding):
   - **Part 1 — Clean-tree assertion**: `git status --porcelain` must be empty except paths matching `^\.claude/wave-quality-gates/`. Any other modified/untracked tracked path → exit 2: `[emit-push-proof] ERROR: tracked artifact drift detected; commit regenerated artifact, re-seal verdicts, rerun QG.` Note: `.planning/wave*/` and `.androidcommondoc/` are gitignored → invisible to `git status` → naturally excluded. The allowlist is exactly ONE narrow entry.
   - **Part 2 — Registry integrity**: calls `qg-registry-integrity.sh --project-root .` (plus `--require-registry` when `skills/` exists). Recomputes registry hashes against the committed tree and compares to stored hashes, replicating CI's `skill-registry` job. Drift → exit 2: `[emit-push-proof] ERROR: derived artifact drift detected; commit regenerated artifact, re-seal verdicts, rerun QG.` Writes `.androidcommondoc/registry-hash-report.json` with `result`: `clean` / `drift` / `n/a`. The `n/a` escape (no `registry.json`) is only valid when `--require-registry` is NOT passed — i.e., genuinely-minimal repos without `skills/`. See [quality-gater-registry-integrity](quality-gater-registry-integrity.md).
   - **Part 3 — Template size gate** (wave `qg-artifact-binding`): calls `validate-agent-templates.sh --check size-limits --templates-dir setup/agent-templates --agents-dir .claude/agents` to enforce the ≤435-line cap on every agent template. Guarded by `-d setup/agent-templates` (N/A, not a bypass, when the dir is absent). Drift → exit 2: `[emit-push-proof] ERROR: agent template size cap exceeded; trim template, rerun QG.` Remedy: extract domain knowledge into a sub-doc — see [project-constraints.md](../guides/project-constraints.md) ("Splitting is the design pattern. Never compress content to fit — create hub + sub-docs").
   - **Part 4 — Hook-binding precondition** (wave `push-authority-bootstrap`, H1): calls `verify-git-hooks.sh --repo-root "$REPO_ROOT"` — the single clone-gating primitive also used by `push-authorization-gate.js` and `setup-check`'s Check 7 — to confirm the git-layer `pre-push` hook is installed, executable, marker-bearing, and byte-identical (CRLF-normalized) to canonical `scripts/sh/pre-push-hook.sh`. Fail-closed, unconditional: any of the 5 `verify-git-hooks.sh` reason codes (`canonical-source-missing`, `hook-absent`, `hook-not-executable`, `hook-marker-missing`, `hook-drifted`) → exit 2, re-emitted prefixed `hook-binding-` (e.g. `hook-binding-drifted`): `[emit-push-proof] ERROR: hook-binding-<code> — git-layer pre-push hook is not installed and byte-identical to scripts/sh/pre-push-hook.sh; run: bash scripts/sh/install-git-hooks.sh (or: make install-git-hooks).` Pure precondition — writes nothing into `push-proof.json` (no `hook_binding` field; `schema_version` stays 1).

   **Sequencing note (Wave A):** this check runs against the COMMITTED tree — `git status --porcelain` flags staged-but-uncommitted changes too. Any wave that regenerates a derived artifact (e.g. `skills/registry.json` during a template-version ceremony) must commit it before dispatching the formal QG; `git add` alone is not enough and will still trip this check.
5. **Compute `report_digest`**: sha256 of `quality-gate-report.json` (CRLF→LF).
6. **Write backward-compat stamps**: `quality-gate.stamp`, `pre-pr.stamp`.
7. **Write `push-proof.json`**: see schema below (now additionally carries `bats_evidence`, Wave A).
8. **Append to `push-proof.log`** (fail-OPEN — log I/O failure does not block a valid proof).

#### QG-Session Freshness (`report.started_at` + `report.head`, Wave A)

`report-started-at-*` enforces that `quality-gate-report.json`'s `started_at` field (stamped by `emit-qg-result.sh --init` at the start of the QG session, fixing D6) is present, parses as UTC `%Y-%m-%dT%H:%M:%SZ`, and is plausible: `now-86400s <= started_at <= now+120s`. Absent or unparseable → `report-started-at-absent`; out of bounds → `report-started-at-implausible`. This is the D6 / in-scope check — **distinct from, and not to be confused with**, the pre-existing, unrelated `scripts/sh/lib/qg-report-freshness.sh` (Step Z's step-reason-coherence gate; see [quality-gater-freshness-gate](quality-gater-freshness-gate.md) for the explicit disambiguation). `started_at` also serves as the `--since` floor passed to the evidence lookup below — it is a floor, not a ceiling: a long QG session that runs bats early and mints late is fine.

`report-head-*` enforces the sibling check on the report's own `head` field (also stamped by `--init`): `report-head-absent` — "`quality-gate-report.json` has no `head` field" — fires when the field is missing entirely; `report-head-mismatch` — "`report.head={…}` != current HEAD `{…}` (was `--init` run at this HEAD?)" — fires when it is present but stale. Both share one operator-actionable cause: **`--init` was not run at the current HEAD** — re-run `emit-qg-result.sh --init` before the bats run. Any commit landing after `--init` but before the mint invalidates the report's `head` the same way a commit after VERIFY-FINAL invalidates a verdict.

#### Evidence Binding (`test-suite-evidence-*`, Wave A)

A claimed `report.steps[]` entry of `{"step":"test-suite","result":"PASS"}` is no longer accepted on faith. `run-qg` calls `lib/bats-handoff.sh select --since <report.started_at> --require-scope full` and requires the returned evidence to satisfy ALL of: `status == "ok"`, `head == <current HEAD>`, `scope == "full"`, `complete == true`, `not_ok == 0`, plus a sanity floor (`ok > 0`, `expected > 0`, `total == ok + not_ok`, `total == expected` — closing the bypass where an internally-inconsistent count would otherwise pass every other check). Failure die-codes: `test-suite-evidence-absent` (no qualifying handoff, or the sanity floor's `ok`/`expected` checks fail), `test-suite-evidence-stale` (`head` mismatch), `test-suite-evidence-partial` (`scope`/`complete` mismatch, or the sanity floor's count-consistency checks fail), `test-suite-evidence-dirty` (`not_ok > 0`). The selected evidence — `{run_id, head, ok, not_ok, expected, scope, generated_at}`, no filesystem paths — is carried into `push-proof.json` as `bats_evidence` (see schema below). **Wave `qg-artifact-binding` (W7)** additively persists two more fields into the same object, `complete` and `total`, growing it to 9 keys — see "Eight integrity checks" below for what the extra fields unlock at verify time.

### `verify-proof` — Cheap Git-Layer Verifier (pre-push hook)

```bash
bash scripts/sh/emit-push-proof.sh --subcommand verify-proof --pushed-sha <sha>
```

Eight integrity checks, all fail-CLOSED (exit 2 on failure):

1. `schema_version == 1`
2. `proof.head == pushed_sha`
3. `proof.worktree_id == current worktree`
4. Freshness: `generated_at` within 30 min (120 s skew tolerance for clock drift)
5. `proof.manifest_version == manifest.manifest_version`
6. All required steps present in `steps_executed` with `result == PASS`
7. `report_digest` matches recomputed sha256 of current `quality-gate-report.json`
8. **(Wave A, grown in W7)** `bats_evidence` present, `bats_evidence.head == pushed_sha`, AND the full completeness predicate: `not_ok == 0 && scope == 'full' && complete == True && total == expected && ok > 0` — checked via 5 granular die-codes (`bats-evidence-dirty`, `bats-evidence-scope`, `bats-evidence-incomplete`, `bats-evidence-count-mismatch`, `bats-evidence-floor`) so a partial, stale, wrong-scope, or internally-inconsistent run cannot authorize a push, even when checks 1-7 all still pass.

`verify-proof` does NOT re-evaluate predicates. Predicate consistency was enforced at mint (run-qg) and is bound cryptographically via `report_digest`. Post-mint tampering with `quality-gate-report.json` causes a digest mismatch and blocks. Check 8 is a narrower, independent binding: even a byte-identical, untampered proof carried over from an earlier commit fails it, since `report_digest` alone does not encode which commit the bats evidence was gathered for.

All three verifiers implement this same 8-check contract at equivalent rigor: this bash `verify_proof` subcommand, `scripts/ps1/verify-push-proof.ps1` (Windows git-layer parity), and the in-JS fallback inside `.claude/hooks/push-authorization-gate.js` (used only when it cannot delegate to bash) — all three independently re-derive the SAME W7 completeness predicate over `bats_evidence`, not just presence + head match.

**Narrowed claim (2026-07-10):** the 8-check contract above governs the *proof verification* logic once a command has been identified as a push attempt. The separate *push-detection* logic inside `push-authorization-gate.js` (`isGitPushCommand`, PreToolUse) is best-effort command-string parsing with a known, unbounded shell-evasion surface (see `BACKLOG.md`'s CRITICAL entry) — it is **not** authoritative. The authoritative, escape-proof push gate is the git-layer `.git/hooks/pre-push` hook, which validates real git refs and stamps rather than parsing a command string, and so cannot be evaded by any command spelling.

**Bootstrap caveat (wave `push-authority-bootstrap`, H1):** that git-layer hook exists only once installed — `bash scripts/sh/install-git-hooks.sh` (or `make install-git-hooks`) — since git never auto-installs hooks into a fresh clone; a never-bootstrapped clone has no git-layer gate at all. H1 does **not** improve push *detection* — `isGitPushCommand` is untouched and the best-effort/evadable framing above is unchanged. What H1 adds is a fail-closed dependency on the hook's presence at the two points it can mechanically reach: the QG mint (`run-qg`, unconditionally — see Part 4 above) and a Claude push that `push-authorization-gate.js` actually detects (bounded by that same best-effort detector). `verify-git-hooks.sh` is the single verifier both delegate to. A terminal push in a clone that was never bootstrapped remains uncoverable by design (git's own anti-RCE model, not a gap H1 can patch) — see `BACKLOG.md`'s HIGH auto-install item, addressed by H1 in this narrowed sense.

---

## `push-proof.json` Schema (schema_version: 1)

```json
{
  "schema_version":   1,
  "head":             "<40-char sha>",
  "worktree_id":      "<absolute path from git rev-parse --show-toplevel>",
  "generated_at":     "<ISO-8601 UTC>",
  "wave_slug":        "<branch last-segment>",
  "manifest_version": 3,
  "steps_executed":   [{"step": "<id>", "result": "PASS|SKIP", "ran": true|false}],
  "report_digest":    "<sha256 hex>",
  "artifact_digests": {
    "arch-<role>-verdict.md": "<sha256 hex>",
    "skills/registry.json":   "<sha256 hex, CRLF→LF, record-only>"
  },
  "bats_evidence": {
    "run_id":       "<the selected handoff's BATS_RUN_ID>",
    "head":         "<40-char sha; re-checked against the pushed SHA at verify time>",
    "ok":           0,
    "not_ok":       0,
    "expected":     0,
    "scope":        "full",
    "generated_at": "<ISO-8601 UTC, the handoff's own timestamp>",
    "complete":     true,
    "total":        0
  }
}
```

`artifact_digests` carries two kinds of entries (additive, `schema_version` stays 1):
- **`arch-*-verdict.md`**: VERIFY-FINAL verdict files; bound at step 3 (verdict→HEAD binding). Digest mismatch after post-mint tampering → `report_digest` cascade blocks push.
- **`skills/registry.json`**: sha256 (CRLF→LF) of the committed registry file, recorded for audit. `verify-proof` does NOT re-evaluate this digest — the committed-tree integrity check (step 4) already ran at mint time; the digest is a post-hoc record. `schema_version` stays 1.

`bats_evidence` (additive, Wave A + W7; `schema_version` stays 1): the bats handoff selected by `lib/bats-handoff.sh select --since report.started_at --require-scope full` at mint time (see "Evidence Binding" above), carried into the proof for re-binding at verify time. No filesystem paths — the selector never emits one in its JSON payload. `complete`/`total` (W7) are additive fields alongside the original 7 keys. Unlike `artifact_digests`, **`verify-proof` DOES re-check this object at verify time** — not just `bats_evidence.head == pushed SHA`, but the full W7 completeness predicate (`not_ok==0 && scope=='full' && complete==True && total==expected && ok>0`), so a proof minted at commit A cannot authorize a push at commit B, and a partial/dirty/inconsistent run cannot authorize any push at all (see check 8 below). Mirrored identically by `verify-push-proof.ps1` and the in-JS fallback in `push-authorization-gate.js`.

---

## `qg-result.json` Schema

Written by `emit-qg-result.sh` to `.planning/wave-<slug>/qg-result.json` (gitignored path). Provides orchestrator-layer heartbeat and final verdict signal.

```json
{
  "schema_version": 1,
  "status": "running | pass | fail",
  "head": "<40-char sha>",
  "wave_slug": "<branch last-segment>",
  "phase": "<step-label>",
  "started_at": "<ISO-8601 UTC>",
  "updated_at": "<ISO-8601 UTC>",
  "steps": [{"step": "<id>", "result": "PASS|FAIL|SKIP|RUNNING"}],
  "suite_summary": {"bats_total": 0, "bats_not_ok": 0, "bats_ok": 0}
}
```

**Boundary list** — what `qg-result.json` is NOT:
- NOT consumed by `verify-proof` or the pre-push hook
- NOT push authorization (push requires `push-proof.json`)
- NOT a `quality-gate-manifest.json` step
- NOT referenced in `quality-gate-report.json`
- Lives in a gitignored path (`.planning/wave-*/` is gitignored); not a committed artifact
- MAY still read `fail` in a degraded local/macOS environment (pre-existing bash-3.2 / GNU-userland-gap failure class) even after this wave's fix removes the conditional-SKIP-flips-fail false negative — `push-proof.json` + `verify-proof` + the two-stamp pre-push gate remain the SOLE push authority regardless (once the git-layer hook is bootstrapped — see the Bootstrap caveat above; the QG mint itself fail-closes unconditionally on an unbootstrapped clone, per Part 4)

---

## `quality-gate-manifest.json` Policy

Committed to repo root. Versioned (`manifest_version`) so `verify-proof` detects stale proofs from a prior manifest revision.

```json
{
  "manifest_version": <N>,
  "protocol_digest":  "<sha256 of manifest content, CRLF->LF>",
  "required_steps":   [...],
  "conditional_steps": [...],
  "informational_steps": [...]
}
```

**Required steps** (7): `architect-deliberation`, `pre-pr`, `test-suite`, `rule-cross-check`, `registry-hash`, `secret-scan`, `doc-validator-parity`. A `FAIL` result blocks proof emission.

**Conditional steps** (9) carry a `predicate` field evaluated at mint time. Named predicates (closed enum — unknown predicates are a hard exit-2 error):

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
| `wave_plan_present` | `.planning/wave-<slug>/PLAN.md` exists (D-7 declared-vs-touched, via `qg-path-audit.sh`) | — |

If predicate is `true` and the report shows `SKIP` → `inconsistent-skip` (exit 2), **except** for steps with `env_attested: true` (currently only `runtime-ui-validation`): predicate-true + SKIP + non-empty `reason` is allowed — the runtime environment check is delegated to the quality-gater's attested reason. If predicate is `true` and result is `FAIL` → `mandatory-step-not-pass` (exit 2).

**Informational steps** (Wave A) — a third, minimal array: currently exactly `["report-freshness"]`. Entries here carry NO step-coverage weight and are NOT inputs to `protocol_digest` (which hashes only `required_steps` + `conditional_steps`) — the array exists solely so `emit-push-proof.sh`'s `unknown-step-id` check (see "Evidence Binding" above) accepts a `report-freshness` entry in `quality-gate-report.json`'s `steps[]` instead of rejecting it as unrecognized.

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
- [quality-gater-freshness-gate](quality-gater-freshness-gate.md) — Step Z, the pre-mint gate that runs just before this one; uses a DIFFERENT freshness mechanism than this doc's `report.started_at` evidence anchor (see the disambiguation there)
- [Agent Verdict Protocol](agent-verdict-protocol.md) — VERIFY-FINAL `**HEAD**:` field requirement and re-run rule
- [Pre-Commit Hooks](../guides/pre-commit-hooks.md) — fail-CLOSED pre-push gate overview (two-stamp + QG-proof; missing proof → BLOCK)
- [Hook Manifest](hook-manifest.md) — `push-authorization-gate.js` + git-layer hook classifications
