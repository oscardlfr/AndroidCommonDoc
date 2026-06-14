#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/pre-push-hook.sh (BL-W47 PR-0b).
# Git-layer two-stamp push gate: quality-gate.stamp + pre-pr.stamp.
#
# Invocation pattern: cwd inside fixture repo, hook receives
#   argv  = <remote-name> <remote-url>
#   stdin = "<local-ref> <local-sha> <remote-ref> <remote-sha>"
#
# Fixture shapes mirror the REAL writers:
#   write_qg_stamp  — single-line JSON (quality-gater.md canonical shape)
#   write_pp_stamp  — json.dump(..., indent=2) pretty-printed (pre-pr SKILL.md shape)
#
# ★ = contract-mandated minimum cases (arch-testing verdict)
# A = advisory cases added per arch-testing ADVISORY

HOOK="$BATS_TEST_DIRNAME/../sh/pre-push-hook.sh"

setup() {
  REPO="$(mktemp -d)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): init"
  git -C "$REPO" checkout -b feature/test --quiet
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
  STAMP_DIR="$REPO/.androidcommondoc"
  mkdir -p "$STAMP_DIR"
  ZERO="0000000000000000000000000000000000000000"
}

teardown() {
  rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────
# write_qg_stamp [age_secs [head]]
# Emits SINGLE-LINE JSON — mirrors the canonical quality-gater.md writer shape.
write_qg_stamp() {
  local age_secs="${1:-0}"
  local head="${2:-}"
  python3 - "$STAMP_DIR/quality-gate.stamp" "$age_secs" "$head" <<'PYEOF'
import json, sys, time, datetime
path, age_secs, head = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')
stamp = {"verdict": "PASS", "timestamp": ts, "steps_passed": 10}
if head:
    stamp["head"] = head
with open(path, "w", encoding="utf-8") as f:
    json.dump(stamp, f)
PYEOF
}

# write_pp_stamp verdict age_secs head [branch]
# Emits PRETTY-PRINTED JSON (indent=2) — mirrors the pre-pr SKILL.md writer shape.
write_pp_stamp() {
  local verdict="${1:-PASS}"
  local age_secs="${2:-0}"
  local head="${3:-$HEAD_SHA}"
  local branch="${4:-feature/test}"
  python3 - "$STAMP_DIR/pre-pr.stamp" "$verdict" "$age_secs" "$head" "$branch" <<'PYEOF'
import json, sys, time, datetime
path, verdict, age_secs, head, branch = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')
stamp = {"verdict": verdict, "timestamp": ts, "head": head, "branch": branch}
with open(path, "w", encoding="utf-8") as f:
    json.dump(stamp, f, indent=2)
PYEOF
}

# ── Hook runner ───────────────────────────────────────────────────────────────
# run_hook stdin_line [extra_env_prefix]
# Runs the hook with cwd=$REPO (required for git rev-parse to resolve).
# SKIP_PUSH_GATE= (empty) clears any ambient bypass.
run_hook() {
  local stdin_line="$1"
  run bash -c "cd '$REPO' && printf '%s\n' \"$stdin_line\" | SKIP_PUSH_GATE= bash '$HOOK' origin https://example.invalid/repo.git"
}

run_hook_with_env() {
  local stdin_line="$1"
  local extra_env="$2"
  run bash -c "cd '$REPO' && printf '%s\n' \"$stdin_line\" | $extra_env SKIP_PUSH_GATE= bash '$HOOK' origin https://example.invalid/repo.git"
}

# ── ★ Contract-mandated cases ────────────────────────────────────────────────

@test "★1 BLOCK: quality-gate.stamp missing (pre-pr fresh and matching)" {
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  # no qg stamp written
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
  [[ "$output" == *"/quality-gate"* ]]
}

@test "★2 BLOCK: stamps present but no proof (emit-push-proof.sh absent from repo) → blocked" {
  write_qg_stamp 0
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  # No scripts/sh/ copied into $REPO → pre-push-hook.sh L169 else-branch fires:
  # "emit-push-proof.sh not found... Harness integrity violation."
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" =~ "push-proof" ]] || [[ "$output" =~ "emit-push-proof" ]]
}

@test "★2b PASS: stamps fresh + full valid proof → hook exits 0" {
  # Copy scripts into isolated repo so pre-push-hook can invoke emit-push-proof.sh.
  mkdir -p "$REPO/scripts/sh/lib"
  cp "$BATS_TEST_DIRNAME/../sh/emit-push-proof.sh"    "$REPO/scripts/sh/"
  cp "$BATS_TEST_DIRNAME/../sh/lib/manifest-digest.sh" "$REPO/scripts/sh/lib/"
  cp "$BATS_TEST_DIRNAME/../sh/lib/audit-append.sh"   "$REPO/scripts/sh/lib/"
  cp "$BATS_TEST_DIRNAME/../../quality-gate-manifest.json" "$REPO/"

  local wave_dir="$REPO/.planning/wave-test-push-proof"
  mkdir -p "$wave_dir"

  # Helper: write a valid APPROVED-VERIFY-FINAL+HEAD-bound verdict for a role.
  write_role_verdict() {
    local role="$1"
    printf '%s\n' \
      "# $role verdict — wave-test-push-proof" \
      "" \
      "**Phase**: PREP" \
      "**Timestamp**: 2026-06-14T00:00:00Z" \
      "**Status**: APPROVED-PREP" \
      "" \
      "**HEAD**: $HEAD_SHA" \
      "**Phase**: VERIFY-FINAL" \
      "**Timestamp**: 2026-06-14T00:00:00Z" \
      "**Status**: APPROVED-VERIFY-FINAL" \
      > "$wave_dir/$role-verdict.md"
  }
  write_role_verdict "arch-platform"
  write_role_verdict "arch-testing"
  write_role_verdict "arch-integration"

  # write_quality_gate_report inline (all 3 architects, all steps PASS/SKIP).
  python3 - "$STAMP_DIR/quality-gate-report.json" "$REPO/quality-gate-manifest.json" <<'PYEOF'
import json, sys
report_path, manifest_path = sys.argv[1], sys.argv[2]
manifest = json.load(open(manifest_path, encoding='utf-8'))
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})
for cs in manifest.get('conditional_steps', []):
    steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                  "reason": "predicate false in isolated test repo"})
report = {
    "deliberation": {
        "architects_consulted": ["arch-platform", "arch-testing", "arch-integration"],
        "incorporated_at": "2026-06-14T00:00:00Z",
    },
    "pre_pr_coverage": {"status": "PASS", "modules": 3},
    "discovered_rules": [{"rule": "two-stamp-gate", "verified_by": "pre-push-hook.bats"}],
    "steps": steps,
}
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2); f.write('\n')
PYEOF

  # write_push_proof inline — worktree_id must be $REPO for verify-proof check.
  python3 - "$STAMP_DIR/push-proof.json" "$HEAD_SHA" "$REPO" \
      "$REPO/quality-gate-manifest.json" "$STAMP_DIR/quality-gate-report.json" <<'PYEOF'
import json, sys, time, datetime, hashlib
proof_path, head, worktree = sys.argv[1], sys.argv[2], sys.argv[3]
manifest_path, report_path = sys.argv[4], sys.argv[5]
ts = datetime.datetime.utcfromtimestamp(time.time()).strftime('%Y-%m-%dT%H:%M:%SZ')
mv = json.load(open(manifest_path, encoding='utf-8'))['manifest_version']
content = open(report_path, 'rb').read().replace(b'\r\n', b'\n')
rd = hashlib.sha256(content).hexdigest()
proof = {
    "schema_version": 1, "head": head, "worktree_id": worktree,
    "generated_at": ts, "wave_slug": "test-push-proof", "manifest_version": mv,
    "steps_executed": [
        {"step": "architect-deliberation", "result": "PASS", "ran": True},
        {"step": "pre-pr",                 "result": "PASS", "ran": True},
        {"step": "test-suite",             "result": "PASS", "ran": True},
        {"step": "rule-cross-check",       "result": "PASS", "ran": True},
        {"step": "registry-hash",          "result": "PASS", "ran": True},
        {"step": "secret-scan",            "result": "PASS", "ran": True},
    ],
    "report_digest": rd,
}
with open(proof_path, "w", encoding="utf-8") as f:
    json.dump(proof, f, indent=2); f.write('\n')
PYEOF

  write_qg_stamp 0 "$HEAD_SHA"
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 0 ]
}

# ── Additional BLOCK cases ────────────────────────────────────────────────────

@test "3 BLOCK: pre-pr.stamp missing (qg fresh)" {
  write_qg_stamp 0
  # no pp stamp written
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"pre-pr.stamp"* ]]
  [[ "$output" == *"/pre-pr"* ]]
}

@test "4 BLOCK: qg stamp stale (age 35 min)" {
  write_qg_stamp $((35 * 60))
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
  [[ "$output" == *"stale"* ]]
}

@test "5 BLOCK: pre-pr stamp stale (age 35 min)" {
  write_qg_stamp 0
  write_pp_stamp "PASS" $((35 * 60)) "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"pre-pr.stamp"* ]]
  [[ "$output" == *"stale"* ]]
}

@test "6 BLOCK: pre-pr verdict FAIL" {
  write_qg_stamp 0
  write_pp_stamp "FAIL" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"pre-pr.stamp"* ]]
}

@test "7 BLOCK: pre-pr head != pushed sha" {
  local other_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  write_qg_stamp 0
  write_pp_stamp "PASS" 0 "$other_sha"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"pre-pr.stamp"* ]]
  [[ "$output" == *"$HEAD_SHA"* ]]
}

@test "8 BLOCK: committer-date ordering — qg stamp older than pushed commit" {
  # Write qg stamp with age_secs=5 FIRST, then make a new commit.
  # The new commit's committer-date will be strictly newer than the stamp epoch.
  write_qg_stamp 5
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): second"
  local new_sha
  new_sha="$(git -C "$REPO" rev-parse HEAD)"
  write_pp_stamp "PASS" 0 "$new_sha"
  run_hook "refs/heads/feature/test $new_sha refs/heads/feature/test $HEAD_SHA"
  [ "$status" -eq 1 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
  [[ "$output" == *"OLDER"* || "$output" == *"older"* || "$output" == *"OLDER than"* ]]
}

# ── PASS / exempt cases ───────────────────────────────────────────────────────

@test "9 PASS: deletion-only push (local sha = zero), no stamps needed" {
  run_hook "refs/heads/feature/test $ZERO refs/heads/feature/test $HEAD_SHA"
  [ "$status" -eq 0 ]
}

@test "10 PASS: tag-only push (refs/tags/), no stamps needed" {
  run_hook "refs/tags/v1.0 $HEAD_SHA refs/tags/v1.0 $ZERO"
  [ "$status" -eq 0 ]
}

@test "11 PASS: push to refs/heads/develop is exempt, no stamps needed" {
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/develop $ZERO"
  [ "$status" -eq 0 ]
}

@test "12 PASS: SKIP_PUSH_GATE=1 bypasses gate, no stamps needed" {
  run bash -c "cd '$REPO' && printf '%s\n' 'refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO' | SKIP_PUSH_GATE=1 bash '$HOOK' origin https://example.invalid/repo.git"
  [ "$status" -eq 0 ]
  [[ "$output" == *"BYPASSED"* ]]
}

@test "13 BLOCK: malformed qg JSON" {
  echo '{not json' > "$STAMP_DIR/quality-gate.stamp"
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
}

@test "14 PASS: empty stdin exits 0 (nothing gated)" {
  run bash -c "cd '$REPO' && printf '' | SKIP_PUSH_GATE= bash '$HOOK' origin https://example.invalid/repo.git"
  [ "$status" -eq 0 ]
}

@test "15 BLOCK output contains /quality-gate, /pre-pr, and SKIP_PUSH_GATE" {
  # No stamps present — message must contain all three key phrases.
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"/quality-gate"* ]]
  [[ "$output" == *"/pre-pr"* ]]
  [[ "$output" == *"SKIP_PUSH_GATE"* ]]
}

# ── Advisory cases (arch-testing ADVISORY A1 + A2) ───────────────────────────

@test "A16 BLOCK: python3 crashing — fail-closed" {
  # Both stamps present and valid so the ONLY failure source is the interpreter.
  write_qg_stamp 0
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  # Hijack python3 resolution with a shim that exits 127 immediately.
  # Full PATH is preserved so bash/git/coreutils remain available.
  local fake_bin
  fake_bin="$(mktemp -d)"
  printf '#!/usr/bin/env bash\nexit 127\n' > "$fake_bin/python3"
  chmod +x "$fake_bin/python3"
  # set -euo pipefail in the hook propagates python3's exit code (127) through
  # command substitution, so the hook exits nonzero (127 or 1). Either is a BLOCK.
  run -127 bash -c "cd '$REPO' && printf '%s\n' 'refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO' | PATH='$fake_bin:$PATH' SKIP_PUSH_GATE= bash '$HOOK' origin https://example.invalid/repo.git"
  rm -rf "$fake_bin"
  [ "$status" -ne 0 ]
}

@test "A17 BLOCK: opportunistic qg.head mismatch — qg stamp has head field != pushed sha" {
  # qg stamp carries a head field pointing to a different sha → BLOCK.
  local other_sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  write_qg_stamp 0 "$other_sha"
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
  [[ "$output" == *"$HEAD_SHA"* ]]
}

# ── NOTE N1: qg verdict FAIL path (cheap addition per arch-testing NOTE) ──────

@test "N1 BLOCK: qg stamp verdict FAIL" {
  # Write a qg stamp with verdict=FAIL (single-line shape).
  python3 - "$STAMP_DIR/quality-gate.stamp" <<'PYEOF'
import json, sys, time, datetime
path = sys.argv[1]
ts = datetime.datetime.utcfromtimestamp(time.time()).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(path, "w", encoding="utf-8") as f:
    json.dump({"verdict": "FAIL", "timestamp": ts, "steps_passed": 3}, f)
PYEOF
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"quality-gate.stamp"* ]]
}

# ── Future-skew guard (BL-W47 Commit 8) ──────────────────────────────────────
# A stamp whose timestamp is more than 120 s AHEAD of the system clock is
# treated as tampered/clock-skew and must block the push.
# The existing write_qg_stamp helper computes:  time.time() - age_secs
# so passing -600 gives time.time() + 600 (10 minutes in the future).

@test "F1 BLOCK: qg stamp with future timestamp (+10 min) blocked with 'future timestamp' message" {
  write_qg_stamp -600          # timestamp = now + 600 s (well past the -120 s grace)
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run_hook "refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO"
  [ "$status" -eq 1 ]
  [[ "$output" == *"future timestamp"* ]]
  [[ "$output" == *"quality-gate.stamp"* ]]
}

# ── R1: multi-ref pre-check (CodeRabbit PR #209 review) ──────────────────────

@test "R1 BLOCK: multi-ref feature push with distinct tips names the real cause" {
  # Two gated feature refs with DIFFERENT tip shas: a single-head pre-pr stamp
  # can never vouch for both — the block reason must say multi-ref, not a
  # misleading per-sha head mismatch.
  local other_sha="cccccccccccccccccccccccccccccccccccccccc"
  write_qg_stamp 0
  write_pp_stamp "PASS" 0 "$HEAD_SHA"
  run bash -c "cd '$REPO' && printf '%s\n' \
    \"refs/heads/feature/test $HEAD_SHA refs/heads/feature/test $ZERO\" \
    \"refs/heads/feature/other $other_sha refs/heads/feature/other $ZERO\" \
    | SKIP_PUSH_GATE= bash '$HOOK' origin https://example.invalid/repo.git"
  [ "$status" -eq 1 ]
  [[ "$output" == *"multi-ref"* ]]
  [[ "$output" != *"does not match pushed commit"* ]]
}
