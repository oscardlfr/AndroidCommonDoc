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

@test "★2 PASS: both stamps fresh, pp.head == HEAD_SHA, stamps newer than commit" {
  write_qg_stamp 0
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
