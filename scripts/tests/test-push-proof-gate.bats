#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for the push-proof gate layer (BL-W47 PR-0c2 T7).
#
# Coverage map (30 tests):
#   #1:     Hard gate: stamps pass but push-proof.json absent → hook blocks
#   #2:     Canonical happy path: run-qg mints proof (3 architects); hook exits 0
#   #3-4:   Partial QG: missing required steps in steps_executed
#   #5:     verdict-head-binding — stale HEAD (commit-A verdict, commit-B HEAD)
#   #5b:    verdict-head-binding — PREP-only verdict (no APPROVED-VERIFY-FINAL)
#   #6:     Manifest-drift: run-qg refuses on protocol_digest mismatch
#   #7-10:  Deliberation evidence + runtime-report completeness (run-qg exits 2)
#   #11-13: Conditional step structural coverage + unjustified/justified SKIP
#   #14-17: Forge / tamper guards (verify-proof exits 2)
#   #18:    Bypass audit (SKIP_PUSH_GATE=1 → hook exits 0; push-proof.log bypass entry)
#   #19:    write-verdict verify-final stamps **HEAD**: field (T1)
#   #20:    verify-proof covers all required steps with PASS
#   #21-23: Predicate enforcement (kt_files_changed TRUE/FALSE)
#   #P1a:   deliberation-role-incomplete Path A (consulted list missing role)
#   #P1b:   deliberation-role-incomplete Path B (verdict file absent)
#   #P2a:   env_attested SKIP allowed (runtime-ui-validation + ui-baseline present)
#   #P2b:   inconsistent-skip (coverage SKIP + kt_files_changed TRUE, no env_attested)
#   #R1:    required step SKIP (test-suite ran=false result=SKIP) → step-not-pass (a62fe89 #4)
#   #R2:    required step ran=false result=PASS → step-not-pass (a62fe89 #4)
#
# Isolation rule: every test uses mktemp -d + git init + teardown rm -rf.
# Never reads live .androidcommondoc/, live stamps, or live proofs.

EMITTER="$BATS_TEST_DIRNAME/../sh/emit-push-proof.sh"
HOOK="$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh"
WRITE_VERDICT="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
MANIFEST_SRC="$BATS_TEST_DIRNAME/../../quality-gate-manifest.json"
SCRIPTS_SRC="$BATS_TEST_DIRNAME/.."

setup() {
  REPO="$(mktemp -d)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): init"
  git -C "$REPO" checkout -b feature/test-push-proof --quiet
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
  ACDOC="$REPO/.androidcommondoc"
  mkdir -p "$ACDOC"
  ZERO="0000000000000000000000000000000000000000"

  # Copy live manifest into isolated repo (needed by emitter's manifest-drift check)
  cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

  # Mirror scripts/sh/ into isolated repo so the pre-push-hook can find emit-push-proof.sh
  # and its lib/ dependencies at $REPO_ROOT/scripts/sh/ (mirrors real deployment).
  mkdir -p "$REPO/scripts/sh/lib"
  cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"    "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh" "$REPO/scripts/sh/lib/"
  cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"   "$REPO/scripts/sh/lib/"
}

teardown() {
  rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────

# write_qg_stamp [age_secs [head]]
write_qg_stamp() {
  local age_secs="${1:-0}"
  local head="${2:-$HEAD_SHA}"
  python3 - "$ACDOC/quality-gate.stamp" "$age_secs" "$head" <<'PYEOF'
import json, sys, time, datetime
path, age_secs, head = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')
stamp = {"verdict": "PASS", "timestamp": ts, "head": head, "branch": "feature/test-push-proof",
         "source": "emit-push-proof.sh run-qg"}
with open(path, "w", encoding="utf-8") as f:
    json.dump(stamp, f)
    f.write('\n')
PYEOF
}

# write_pp_stamp [age_secs [head]]
write_pp_stamp() {
  local age_secs="${1:-0}"
  local head="${2:-$HEAD_SHA}"
  python3 - "$ACDOC/pre-pr.stamp" "$age_secs" "$head" <<'PYEOF'
import json, sys, time, datetime
path, age_secs, head = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')
stamp = {"verdict": "PASS", "timestamp": ts, "head": head, "branch": "feature/test-push-proof",
         "source": "emit-push-proof.sh run-qg"}
with open(path, "w", encoding="utf-8") as f:
    json.dump(stamp, f, indent=2)
PYEOF
}

# write_quality_gate_report — writes a valid .androidcommondoc/quality-gate-report.json
# $1=extra_steps_json (default "") — JSON list of step objects to merge/replace
# $2=override_deliberation_json (default "") — JSON object to override deliberation block
#    e.g. '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
write_quality_gate_report() {
  local extra_steps="${1:-}"
  local override_deliberation="${2:-}"
  python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" \
      "${extra_steps}" "${override_deliberation}" <<'PYEOF'
import json, sys

report_path         = sys.argv[1]
manifest_path       = sys.argv[2]
extra_steps_raw     = sys.argv[3]
override_delib_raw  = sys.argv[4]

manifest = json.load(open(manifest_path, encoding='utf-8'))

# Build required steps all PASS
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})

# Build conditional steps all SKIP with reason (safe default)
for cs in manifest.get('conditional_steps', []):
    steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                  "reason": "predicate false in isolated test repo"})

# Apply extra overrides (JSON list of step objects to merge/replace)
if extra_steps_raw.strip():
    extras = json.loads(extra_steps_raw)
    by_id = {s['step']: s for s in steps}
    for e in extras:
        by_id[e['step']] = e
    steps = list(by_id.values())

# Default deliberation block (1 architect — sufficient for single-architect tests)
deliberation = {
    "architects_consulted": ["arch-testing"],
    "incorporated_at": "2026-06-14T00:00:00Z",
}
# Allow override (e.g. to specify all 3 required roles, or to omit a role for P1a)
if override_delib_raw.strip():
    override = json.loads(override_delib_raw)
    deliberation.update(override)

report = {
    "deliberation": deliberation,
    "pre_pr_coverage": {"status": "PASS", "modules": 3},
    "discovered_rules": [
        {"rule": "two-stamp-gate", "verified_by": "pre-push-hook.bats"}
    ],
    "steps": steps,
}
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
    f.write('\n')
PYEOF
}

# write_push_proof — writes a valid .androidcommondoc/push-proof.json
# $1=head_sha (default HEAD_SHA), $2=age_secs (default 0), $3=worktree_id (default $REPO)
write_push_proof() {
  local head="${1:-$HEAD_SHA}"
  local age_secs="${2:-0}"
  local worktree="${3:-$REPO}"
  local repo_manifest="$REPO/quality-gate-manifest.json"
  local report_path="$ACDOC/quality-gate-report.json"
  # Read manifest_version via heredoc (avoids single-quote quoting issues in -c)
  local manifest_version
  manifest_version="$(python3 - "$repo_manifest" <<'PYEOF'
import json, sys
print(json.load(open(sys.argv[1], encoding='utf-8'))['manifest_version'])
PYEOF
)"
  # Need a report digest — write a canonical report first so digest is stable
  [[ -f "$report_path" ]] || write_quality_gate_report
  local report_digest
  report_digest="$(python3 - "$report_path" <<'PYEOF'
import hashlib, sys
content = open(sys.argv[1], 'rb').read().replace(b'\r\n', b'\n')
print(hashlib.sha256(content).hexdigest())
PYEOF
)"
  python3 - "$ACDOC/push-proof.json" "$head" "$worktree" \
      "$manifest_version" "$report_digest" "$age_secs" <<'PYEOF'
import json, sys, time, datetime

proof_path       = sys.argv[1]
head_sha         = sys.argv[2]
worktree_id      = sys.argv[3]
manifest_version = int(sys.argv[4])
report_digest    = sys.argv[5]
age_secs         = int(sys.argv[6])

ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')

proof = {
    "schema_version":   1,
    "head":             head_sha,
    "worktree_id":      worktree_id,
    "generated_at":     ts,
    "wave_slug":        "test-push-proof",
    "manifest_version": manifest_version,
    "steps_executed": [
        {"step": "architect-deliberation", "result": "PASS", "ran": True},
        {"step": "pre-pr",                 "result": "PASS", "ran": True},
        {"step": "test-suite",             "result": "PASS", "ran": True},
        {"step": "rule-cross-check",       "result": "PASS", "ran": True},
        {"step": "registry-hash",          "result": "PASS", "ran": True},
        {"step": "secret-scan",            "result": "PASS", "ran": True},
        {"step": "doc-validator-parity",   "result": "PASS", "ran": True},
    ],
    "report_digest": report_digest,
}
with open(proof_path, "w", encoding="utf-8") as f:
    json.dump(proof, f, indent=2)
    f.write('\n')
PYEOF
}

# write_arch_verdict — writes a valid arch-testing-verdict.md into the isolated repo.
# $1=head_sha (default HEAD_SHA) — the **HEAD**: field value to embed.
# Creates .planning/wave-test-push-proof/ and the verdict file with APPROVED-VERIFY-FINAL.
write_arch_verdict() {
  local head="${1:-$HEAD_SHA}"
  local wave_dir="$REPO/.planning/wave-test-push-proof"
  mkdir -p "$wave_dir"
  cat > "$wave_dir/arch-testing-verdict.md" <<EOF
# arch-testing verdict — wave-test-push-proof

**Phase**: PREP
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $head
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
}

# write_all_arch_verdicts — writes APPROVED-VERIFY-FINAL+HEAD-bound verdicts for all 3
# required roles (arch-platform, arch-testing, arch-integration).
# $1=head_sha (default HEAD_SHA)
write_all_arch_verdicts() {
  local head="${1:-$HEAD_SHA}"
  local wave_dir="$REPO/.planning/wave-test-push-proof"
  mkdir -p "$wave_dir"
  for role in arch-testing arch-platform arch-integration; do
    cat > "$wave_dir/$role-verdict.md" <<EOF
# $role verdict — wave-test-push-proof

**Phase**: PREP
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $head
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
  done
}

# ── Hook runner ───────────────────────────────────────────────────────────────

run_hook() {
  local stdin_line="$1"
  run bash -c "cd '$REPO' && printf '%s\n' \"$stdin_line\" \
    | SKIP_PUSH_GATE= PUSH_AUTHORIZATION_BYPASS= bash '$HOOK' origin https://example.invalid/repo.git"
}

# ── Emitter runner ────────────────────────────────────────────────────────────
# Always pass --repo-root so the emitter uses the isolated repo, not the live repo.

run_emitter() {
  run bash -c "SKIP_PUSH_GATE= PUSH_AUTHORIZATION_BYPASS= \
    CLAUDE_WAVE_SLUG=test-push-proof bash '$EMITTER' --repo-root '$REPO' $*"
}

run_verifier() {
  local sha="${1:-$HEAD_SHA}"
  run bash -c "SKIP_PUSH_GATE= PUSH_AUTHORIZATION_BYPASS= \
    bash '$EMITTER' --subcommand verify-proof --pushed-sha '$sha' --repo-root '$REPO'"
}

# ─────────────────────────────────────────────────────────────────────────────
# #1  stamps_pass_proof_absent_blocked
# Hard-gate: hook blocks when push-proof.json is absent even if stamps exist.
# ─────────────────────────────────────────────────────────────────────────────
@test "#1 BLOCK: stamps pass but push-proof.json absent" {
  write_qg_stamp 0 "$HEAD_SHA"
  write_pp_stamp 0 "$HEAD_SHA"
  # Deliberately do NOT write push-proof.json
  run_hook "refs/heads/feature/test-push-proof $HEAD_SHA refs/heads/feature/test-push-proof $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" =~ "BLOCKED" ]] || [[ "$output" =~ "push-proof" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #2  canonical_run_qg_proof_minted_push_allowed
# Happy path: run-qg mints proof; verify-proof + hook both pass.
# ─────────────────────────────────────────────────────────────────────────────
@test "#2 PASS: canonical run-qg mints proof; hook exits 0 (3 architects)" {
  # architects_consulted must include all 3 required roles; write_all_arch_verdicts covers all 3.
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]

  write_qg_stamp 0 "$HEAD_SHA"
  write_pp_stamp 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test-push-proof $HEAD_SHA refs/heads/feature/test-push-proof $ZERO"
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #3  partial_qg_missing_step_blocked
# steps_executed missing 'pre-pr' → verify-proof exits 2 → hook blocks.
# ─────────────────────────────────────────────────────────────────────────────
@test "#3 BLOCK: partial QG — steps_executed missing pre-pr step" {
  write_quality_gate_report
  # Write a proof manually with missing required step
  python3 - "$ACDOC/push-proof.json" "$HEAD_SHA" "$REPO" <<'PYEOF'
import json, sys, time, datetime, hashlib
proof_path, head, worktree = sys.argv[1], sys.argv[2], sys.argv[3]
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
content = open('/dev/stdin').read() if False else \
    open(worktree + '/.androidcommondoc/quality-gate-report.json', 'rb').read().replace(b'\r\n', b'\n')
rd = hashlib.sha256(content).hexdigest()
mv = json.load(open(worktree + '/quality-gate-manifest.json'))['manifest_version']
proof = {
    "schema_version": 1, "head": head, "worktree_id": worktree,
    "generated_at": ts, "wave_slug": "test-push-proof",
    "manifest_version": mv,
    "steps_executed": [
        {"step": "architect-deliberation", "result": "PASS", "ran": True},
        # pre-pr intentionally omitted
        {"step": "test-suite",      "result": "PASS", "ran": True},
        {"step": "rule-cross-check","result": "PASS", "ran": True},
        {"step": "registry-hash",   "result": "PASS", "ran": True},
        {"step": "secret-scan",     "result": "PASS", "ran": True},
    ],
    "report_digest": rd,
}
with open(proof_path, 'w', encoding='utf-8') as f:
    json.dump(proof, f, indent=2); f.write('\n')
PYEOF
  run_verifier "$HEAD_SHA"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "pre-pr" ]] || [[ "$output" =~ "step-coverage-gap" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #4  partial_qg_missing_arch_deliberation_blocked
# Missing architect-deliberation in steps_executed → verify-proof exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#4 BLOCK: partial QG — steps_executed missing architect-deliberation" {
  write_quality_gate_report
  python3 - "$ACDOC/push-proof.json" "$HEAD_SHA" "$REPO" <<'PYEOF'
import json, sys, time, datetime, hashlib
proof_path, head, worktree = sys.argv[1], sys.argv[2], sys.argv[3]
ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
content = open(worktree + '/.androidcommondoc/quality-gate-report.json', 'rb').read().replace(b'\r\n', b'\n')
rd = hashlib.sha256(content).hexdigest()
mv = json.load(open(worktree + '/quality-gate-manifest.json'))['manifest_version']
proof = {
    "schema_version": 1, "head": head, "worktree_id": worktree,
    "generated_at": ts, "wave_slug": "test-push-proof",
    "manifest_version": mv,
    "steps_executed": [
        # architect-deliberation intentionally omitted
        {"step": "pre-pr",          "result": "PASS", "ran": True},
        {"step": "test-suite",      "result": "PASS", "ran": True},
        {"step": "rule-cross-check","result": "PASS", "ran": True},
        {"step": "registry-hash",   "result": "PASS", "ran": True},
        {"step": "secret-scan",     "result": "PASS", "ran": True},
    ],
    "report_digest": rd,
}
with open(proof_path, 'w', encoding='utf-8') as f:
    json.dump(proof, f, indent=2); f.write('\n')
PYEOF
  run_verifier "$HEAD_SHA"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "architect-deliberation" ]] || [[ "$output" =~ "step-coverage-gap" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #5  verdict_head_binding_blocked — mode (a): stale HEAD
# run-qg emitter requires arch verdict **HEAD**: == final HEAD (emitter L359).
# Setup: verdict anchored to commit-A, final HEAD = commit-B → exit 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#5 BLOCK: verdict-head-binding — stale HEAD (commit-A verdict, commit-B HEAD)" {
  # All 3 verdicts anchor to commit-A HEAD_SHA. Then commit-B advances HEAD.
  # Path B per-role loop passes (all 3 files present), but verdict-head-binding fires
  # because every file's **HEAD**: still points to commit-A != final HEAD (commit-B).
  write_all_arch_verdicts "$HEAD_SHA"
  git -C "$REPO" commit --allow-empty --quiet -m "feat: second commit"
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "verdict-head-binding" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #5b verdict_head_binding_blocked — mode (b): PREP-only verdict
# run-qg emitter requires APPROVED-VERIFY-FINAL in every arch verdict (emitter L352).
# A PREP-only verdict (no APPROVED-VERIFY-FINAL, no **HEAD**:) → exit 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#5b BLOCK: verdict-head-binding — PREP-only verdict (no APPROVED-VERIFY-FINAL)" {
  # Write arch-platform and arch-integration as valid VERIFY-FINAL verdicts.
  # Write arch-testing as PREP-only (no APPROVED-VERIFY-FINAL, no **HEAD**:).
  # The emitter globs all 3 files; the PREP-only arch-testing file triggers verdict-head-binding
  # (L365: "does not contain APPROVED-VERIFY-FINAL") before reaching the per-role loop.
  local wave_dir="$REPO/.planning/wave-test-push-proof"
  write_all_arch_verdicts "$HEAD_SHA"
  # Overwrite arch-testing with PREP-only (no VERIFY-FINAL section).
  printf '%s\n' \
    "# arch-testing verdict — wave-test-push-proof" \
    "" \
    "**Phase**: PREP" \
    "**Timestamp**: 2026-06-14T00:00:00Z" \
    "**Status**: APPROVED-PREP" \
    > "$wave_dir/arch-testing-verdict.md"
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "verdict-head-binding" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #6  manifest_drift_emitter_refuses
# protocol_digest mismatch in manifest → run-qg exits 2 with manifest-drift.
# ─────────────────────────────────────────────────────────────────────────────
@test "#6 BLOCK: manifest-drift — protocol_digest mismatch causes run-qg to exit 2" {
  write_quality_gate_report
  # Corrupt the stored protocol_digest
  python3 - "$REPO/quality-gate-manifest.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
m = json.load(open(path, encoding='utf-8'))
m['protocol_digest'] = 'deadbeef' * 8
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, indent=2); f.write('\n')
PYEOF
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "manifest-drift" ]] || [[ "$output" =~ "protocol_digest" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #7  report_missing_deliberation_block_blocked
# No 'deliberation' block in report → run-qg exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#7 BLOCK: report missing deliberation block" {
  write_quality_gate_report
  # Remove deliberation key
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r.pop('deliberation', None)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "deliberation" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #8  report_empty_architects_consulted_blocked
# deliberation.architects_consulted=[] → run-qg exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#8 BLOCK: deliberation.architects_consulted is empty" {
  write_quality_gate_report
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['deliberation']['architects_consulted'] = []
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "architects_consulted" ]] || [[ "$output" =~ "deliberation" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #9  report_missing_pre_pr_evidence_blocked
# No pre_pr_coverage key → run-qg exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#9 BLOCK: report missing pre_pr_coverage" {
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r.pop('pre_pr_coverage', None)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "pre_pr_coverage" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #10  report_missing_rule_mapping_blocked
# discovered_rules entry has no verified_by → run-qg exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#10 BLOCK: discovered_rules entry missing verified_by" {
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['discovered_rules'] = [{"rule": "two-stamp-gate"}]  # no verified_by
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "verified_by" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #11  conditional_step_missing_from_steps_blocked
# 'coverage' step absent from report steps[] → run-qg exits 2 (step-coverage-gap).
# ─────────────────────────────────────────────────────────────────────────────
@test "#11 BLOCK: conditional step 'coverage' absent from report steps[]" {
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  # Remove the coverage step
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['steps'] = [s for s in r.get('steps', []) if s.get('step') != 'coverage']
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "coverage" ]] || [[ "$output" =~ "step-coverage-gap" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #12  conditional_step_skip_without_reason_blocked
# kdoc SKIP with no reason → run-qg exits 2 (unjustified-skip).
# ─────────────────────────────────────────────────────────────────────────────
@test "#12 BLOCK: conditional step 'kdoc' SKIP with no reason" {
  write_quality_gate_report \
    '[{"step":"kdoc","ran":false,"result":"SKIP","reason":""}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "unjustified-skip" ]] || [[ "$output" =~ "reason" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #13  conditional_step_skip_with_reason_allowed
# kdoc SKIP + reason → run-qg succeeds (emit exits 0).
# ─────────────────────────────────────────────────────────────────────────────
@test "#13 PASS: conditional step 'kdoc' SKIP with reason is allowed" {
  write_quality_gate_report \
    '[{"step":"kdoc","ran":false,"result":"SKIP","reason":"no kt_changed_and_gradle in isolated repo"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #14  forge_new_head_proof_blocked
# Proof minted for SHA-A; push SHA-B → verify exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#14 BLOCK: forge — proof minted for SHA-A; pushed SHA-B" {
  write_quality_gate_report
  write_push_proof "$HEAD_SHA" 0 "$REPO"
  # Make a new commit (SHA-B)
  git -C "$REPO" commit --allow-empty --quiet -m "feat: second commit"
  local SHA_B
  SHA_B="$(git -C "$REPO" rev-parse HEAD)"
  run_verifier "$SHA_B"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "$SHA_B" ]] || [[ "$output" =~ "head" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #15  forge_copied_worktree_proof_blocked
# worktree_id in proof != current worktree → verify exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#15 BLOCK: forge — worktree_id mismatch" {
  write_quality_gate_report
  write_push_proof "$HEAD_SHA" 0 "/some/other/worktree/path"
  run_verifier "$HEAD_SHA"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "worktree_id" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #16  malformed_proof_blocked
# Truncated / invalid JSON in push-proof.json → verify exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#16 BLOCK: malformed push-proof.json (truncated JSON)" {
  printf '{"schema_version":1,"head":"%s"' "$HEAD_SHA" > "$ACDOC/push-proof.json"
  # intentionally not closed
  write_quality_gate_report
  run_verifier "$HEAD_SHA"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "malformed" ]] || [[ "$output" =~ "unreadable" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #17  expired_proof_blocked
# generated_at > 1800s ago → verify exits 2 (stale).
# ─────────────────────────────────────────────────────────────────────────────
@test "#17 BLOCK: push-proof.json generated_at expired (>1800s old)" {
  write_quality_gate_report
  write_push_proof "$HEAD_SHA" 1900 "$REPO"   # 1900s > MAX_AGE_SECS=1800
  run_verifier "$HEAD_SHA"
  [ "$status" -eq 2 ]
  [[ "$output" =~ "stale" ]] || [[ "$output" =~ "min old" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #18  bypass_skip_push_gate_logged
# SKIP_PUSH_GATE=1 → hook exits 0 + push-proof.log has bypass JSONL entry
# with event="bypass" and mechanism="SKIP_PUSH_GATE".
# ─────────────────────────────────────────────────────────────────────────────
@test "#18 PASS: SKIP_PUSH_GATE=1 exits 0 and bypass entry written to push-proof.log" {
  # No stamps, no proof — hook should bypass entirely and log the bypass.
  run bash -c "cd '$REPO' && printf '%s\n' \
    'refs/heads/feature/test-push-proof $HEAD_SHA refs/heads/feature/test-push-proof $ZERO' \
    | SKIP_PUSH_GATE=1 PUSH_AUTHORIZATION_BYPASS= bash '$HOOK' origin https://example.invalid/repo.git"
  [ "$status" -eq 0 ]

  # push-proof.log must exist after bypass
  [ -f "$ACDOC/push-proof.log" ]

  # Last line must parse as valid JSON with event=bypass and mechanism=SKIP_PUSH_GATE
  run python3 - "$ACDOC/push-proof.log" <<'PYEOF'
import json, sys
last_line = open(sys.argv[1], encoding='utf-8').readlines()[-1].strip()
entry = json.loads(last_line)
assert entry.get('event') == 'bypass', f"expected event=bypass, got: {entry.get('event')}"
assert entry.get('mechanism') == 'SKIP_PUSH_GATE', f"expected mechanism=SKIP_PUSH_GATE, got: {entry.get('mechanism')}"
print("OK")
PYEOF
  [ "$status" -eq 0 ]
  [[ "$output" =~ "OK" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #19  write_verdict_verify_final_has_head
# write-verdict.sh verify-final appends **HEAD**: <sha> field (T1 regression).
# ─────────────────────────────────────────────────────────────────────────────
@test "#19 PASS: write-verdict verify-final stamps **HEAD**: field" {
  local WAVE_SLUG="test-push-proof"
  mkdir -p "$REPO/.planning/wave-$WAVE_SLUG"

  # Phase prep first
  run bash -c "cd '$REPO' && CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WRITE_VERDICT' \
    --role arch-testing --phase prep"
  [ "$status" -eq 0 ]

  local verdict_file="$REPO/.planning/wave-$WAVE_SLUG/arch-testing-verdict.md"
  [ -f "$verdict_file" ]

  # Phase verify-final (pipe empty stdin)
  run bash -c "cd '$REPO' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$WRITE_VERDICT' \
    --role arch-testing --phase verify-final"
  [ "$status" -eq 0 ]

  # Must contain **HEAD**: followed by 40-char sha
  local head_sha
  head_sha="$(git -C "$REPO" rev-parse HEAD)"
  run bash -c "grep '\\*\\*HEAD\\*\\*:' '$verdict_file'"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "$head_sha" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #20  steps_executed_covers_manifest_required
# verify-proof loads manifest and checks all required steps have result=PASS.
# ─────────────────────────────────────────────────────────────────────────────
@test "#20 PASS: verify-proof checks all required steps present and PASS" {
  write_quality_gate_report
  write_push_proof "$HEAD_SHA" 0 "$REPO"
  run_verifier "$HEAD_SHA"
  [ "$status" -eq 0 ]
  [[ "$output" =~ "PASS" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #21  conditional_step_mandatory_but_skipped_blocked
# kt_files_changed predicate TRUE (has .kt in diff) + coverage=SKIP → emit exits 2.
# ─────────────────────────────────────────────────────────────────────────────
@test "#21 BLOCK: kt_files_changed TRUE + coverage=SKIP yields inconsistent-skip" {
  # Commit a .kt file so git diff --name-only returns it (HEAD~1 is the init commit)
  touch "$REPO/Foo.kt"
  git -C "$REPO" add Foo.kt
  git -C "$REPO" commit --quiet -m "feat: add kotlin file"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  # production-file-verify also needs PASS (task_is_code_changes TRUE for .kt commits).
  # coverage is SKIP — this is the inconsistency that must be caught.
  # All 3 architects in consulted + 3 verdict files so Path A/B pass before predicate check.
  write_quality_gate_report \
    '[{"step":"coverage","ran":false,"result":"SKIP","reason":"baseline skipped"},{"step":"production-file-verify","ran":true,"result":"PASS"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"

  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "inconsistent-skip" ]] || [[ "$output" =~ "kt_files_changed" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #22  conditional_step_correctly_skipped_allowed
# kt_files_changed predicate FALSE (no .kt in diff) + coverage=SKIP+reason → emit succeeds.
# ─────────────────────────────────────────────────────────────────────────────
@test "#22 PASS: kt_files_changed FALSE + coverage=SKIP+reason is allowed" {
  # No .kt files committed — diff is empty so all predicates that depend on diff are FALSE.
  # All conditional steps SKIP with reasons (default from write_quality_gate_report).
  write_quality_gate_report \
    '[{"step":"coverage","ran":false,"result":"SKIP","reason":"no kt files changed in this wave"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #23  conditional_step_mandatory_ran_pass_allowed
# kt_files_changed TRUE + coverage=PASS → emit succeeds.
# ─────────────────────────────────────────────────────────────────────────────
@test "#23 PASS: kt_files_changed TRUE + coverage=PASS is allowed" {
  # Commit a .kt file so kt_files_changed=TRUE + task_is_code_changes=TRUE.
  # Both coverage and production-file-verify must be PASS (predicates fire for .kt diff).
  touch "$REPO/Bar.kt"
  git -C "$REPO" add Bar.kt
  git -C "$REPO" commit --quiet -m "feat: add another kotlin file"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  write_quality_gate_report \
    '[{"step":"coverage","ran":true,"result":"PASS"},{"step":"production-file-verify","ran":true,"result":"PASS"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #P1a  deliberation_role_incomplete_consulted — Path A
# architects_consulted missing a required role → exit 2 deliberation-role-incomplete.
# die path: L272 "deliberation-role-incomplete: required role '<role>' absent from
# report.deliberation.architects_consulted [...]"
# ─────────────────────────────────────────────────────────────────────────────
@test "#P1a BLOCK: architects_consulted missing required role → exit 2 deliberation-role-incomplete" {
  # arch-integration omitted from consulted list — Path A fires before Path B.
  # All 3 verdict files present so Path B (missing verdict file) does NOT fire first.
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "deliberation-role-incomplete" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #P1b  deliberation_role_incomplete_verdict — Path B
# Required verdict file absent → exit 2 deliberation-role-incomplete.
# die path: L387 "deliberation-role-incomplete: required verdict file 'arch-<role>-verdict.md'
# missing or not VERIFY-FINAL+HEAD-bound in <wave_dir>"
# ─────────────────────────────────────────────────────────────────────────────
@test "#P1b BLOCK: required verdict file absent (arch-integration missing) → exit 2 deliberation-role-incomplete" {
  # All 3 roles in architects_consulted (Path A passes), but arch-integration verdict absent.
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  # Write only arch-testing and arch-platform; omit arch-integration-verdict.md.
  local wave_dir="$REPO/.planning/wave-test-push-proof"
  mkdir -p "$wave_dir"
  for role in arch-testing arch-platform; do
    cat > "$wave_dir/$role-verdict.md" <<EOF
# $role verdict — wave-test-push-proof

**Phase**: PREP
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $HEAD_SHA
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
  done
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "deliberation-role-incomplete" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #P2a  env_attested_skip_allowed
# runtime-ui-validation has env_attested=true; predicate runtime_ui_available is TRUE
# when ui-baseline/ dir exists. SKIP + non-empty reason + env_attested + pred_true → ALLOWED.
# ─────────────────────────────────────────────────────────────────────────────
@test "#P2a PASS: runtime-ui-validation SKIP + ui-baseline present + env_attested + non-empty reason → run-qg ALLOWED" {
  # Make predicate runtime_ui_available TRUE by creating the ui-baseline dir.
  mkdir -p "$ACDOC/ui-baseline"
  write_quality_gate_report \
    '[{"step":"runtime-ui-validation","ran":false,"result":"SKIP","reason":"adb not available in CI env"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #P2b  inconsistent_skip_no_env_attested
# coverage step: env_attested=false (not set), kt_files_changed=TRUE (has .kt in diff),
# result=SKIP with reason → NOT allowed (inconsistent-skip).
# die path: L324 "inconsistent-skip: predicate 'kt_files_changed' is TRUE but step
# 'coverage' shows SKIP in report"
# ─────────────────────────────────────────────────────────────────────────────
@test "#P2b BLOCK: coverage SKIP + kt_files_changed TRUE + no env_attested → exit 2 inconsistent-skip" {
  # Commit a .kt file so kt_files_changed predicate evaluates TRUE.
  printf 'fun foo() {}\n' > "$REPO/Foo.kt"
  git -C "$REPO" add Foo.kt
  git -C "$REPO" commit --quiet -m "feat: add kt file"
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

  write_quality_gate_report \
    '[{"step":"coverage","ran":false,"result":"SKIP","reason":"skipped for speed"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "inconsistent-skip" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #R1  required_step_skip_blocked (a62fe89 #4 regression)
# Required step ran=false result=SKIP → must exit 2 step-not-pass.
# Previously silent (only ran=true+FAIL was caught); now any non-PASS required step fails.
# ─────────────────────────────────────────────────────────────────────────────
@test "#R1 BLOCK: required step SKIP (test-suite ran=false result=SKIP) → exit 2 step-not-pass" {
  write_quality_gate_report \
    '[{"step":"test-suite","ran":false,"result":"SKIP","reason":"skipped by operator"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "step-not-pass" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #R2  required_step_ran_false_blocked (a62fe89 #4 regression)
# Required step ran=false result=PASS → must exit 2 step-not-pass.
# The new check requires BOTH ran=true AND result=PASS; ran=false alone is insufficient.
# ─────────────────────────────────────────────────────────────────────────────
@test "#R2 BLOCK: required step ran=false result=PASS → exit 2 step-not-pass" {
  write_quality_gate_report \
    '[{"step":"registry-hash","ran":false,"result":"PASS"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "step-not-pass" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #Rdv1  doc_validator_parity_skip_blocked
# Required step doc-validator-parity ran=false result=SKIP → exit 2 step-not-pass.
# Mirrors #R1: any required step that is not ran=true+PASS must fail.
# ─────────────────────────────────────────────────────────────────────────────
@test "#Rdv1 BLOCK: required step doc-validator-parity ran=false result=SKIP → exit 2 step-not-pass" {
  write_quality_gate_report \
    '[{"step":"doc-validator-parity","ran":false,"result":"SKIP","reason":"skipped by operator"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "step-not-pass" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #Rdv2  doc_validator_parity_ran_false_pass_blocked
# Required step doc-validator-parity ran=false result=PASS → exit 2 step-not-pass.
# Mirrors #R2: ran=false + result=PASS is insufficient; ran=true is required.
# ─────────────────────────────────────────────────────────────────────────────
@test "#Rdv2 BLOCK: required step doc-validator-parity ran=false result=PASS → exit 2 step-not-pass" {
  write_quality_gate_report \
    '[{"step":"doc-validator-parity","ran":false,"result":"PASS"}]' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "step-not-pass" ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #Rdv3  doc_validator_parity_ran_true_pass_allowed
# Required step doc-validator-parity ran=true result=PASS → exit 0.
# write_quality_gate_report auto-includes doc-validator-parity as ran=true PASS
# (derived from manifest required_steps); no override needed for the happy path.
# ─────────────────────────────────────────────────────────────────────────────
@test "#Rdv3 PASS: required step doc-validator-parity ran=true result=PASS → exit 0" {
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  write_all_arch_verdicts "$HEAD_SHA"
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# BL-W48 Codex P1: CLASS-aware artifact floor (FAST-PATH / HARNESS / DOC).
# emit-push-proof.sh resolves required_roles from the wave CLASS (via
# resolve-required-roles.js → wave-topology.yaml class_artifacts) BEFORE gating
# deliberation/verdicts. FAST-PATH (architects: []) must NOT require architect
# deliberation or arch-*-verdict.md; HARNESS must still require them; DOC declared
# without a **Required-Architects** token fails-closed.
# ─────────────────────────────────────────────────────────────────────────────

# resolver_stub <token>
# Installs a deterministic resolver stub in the isolated repo that emits the given
# CLASS-resolved token, so emit-push-proof.sh exercises its CLASS-aware gating on it.
# The real CLASS -> token mapping (wave-topology class_artifacts) is covered by
# resolve-required-roles.bats; this seam keeps the integration test hermetic (no yaml
# pkg / wave-topology copy needed). Tokens: "[]" (FAST-PATH), a JSON arch array
# (HARNESS / DOC-declared), or "DECLARED_MISSING" (DOC declared, no token → fail-closed).
resolver_stub() {
  local token="$1"
  printf '%s' "$token" > "$REPO/.test-req-roles"
  mkdir -p "$REPO/scripts/sh/lib"
  cat > "$REPO/scripts/sh/lib/resolve-required-roles.js" <<'JSEOF'
const fs = require('fs'), path = require('path');
// argv[2] = repo_root (emit-push-proof.sh passes $REPO_ROOT). Echo the test token.
process.stdout.write(fs.readFileSync(path.join(process.argv[2], '.test-req-roles'), 'utf8'));
process.exit(0);
JSEOF
}

@test "#FP1 PASS: FAST-PATH run-qg with NO arch verdicts (required_roles==[]) is allowed" {
  resolver_stub "[]"
  write_quality_gate_report   # deliberation/verdicts NOT required for FAST-PATH
  # deliberately NO arch verdict files written
  run_emitter --subcommand run-qg
  [ "$status" -eq 0 ]
}

@test "#FP2 BLOCK: HARNESS run-qg with NO arch verdicts still fails (regression guard)" {
  resolver_stub '["arch-platform","arch-testing","arch-integration"]'
  write_quality_gate_report \
    '' \
    '{"architects_consulted":["arch-platform","arch-testing","arch-integration"]}'
  # deliberately NO arch verdict files written
  run_emitter --subcommand run-qg
  [ "$status" -ne 0 ]
  [[ "$output" =~ "verdict" ]] || [[ "$output" =~ "deliberation-role-incomplete" ]]
}

@test "#FP3 BLOCK: DOC declared run-qg with DECLARED_MISSING fails-closed" {
  resolver_stub "DECLARED_MISSING"
  write_quality_gate_report
  run_emitter --subcommand run-qg
  [ "$status" -eq 2 ]
  [[ "$output" =~ "Required-Architects" ]] || [[ "$output" =~ "declared" ]]
}
