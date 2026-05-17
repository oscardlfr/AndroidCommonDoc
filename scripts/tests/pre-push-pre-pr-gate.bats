#!/usr/bin/env bats
#
# Tests for .claude/hooks/pre-push-pre-pr-gate.js (F2 BL-W47-prep-8).
# Verifies that git push is blocked without a valid /pre-pr stamp.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/pre-push-pre-pr-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/pre-push-gate-input-$$.json"
STAMP_DIR="${BATS_TEST_TMPDIR:-/tmp}/project-root-$$/.androidcommondoc"
STAMP_FILE="$STAMP_DIR/pre-pr.stamp"
PROJECT_ROOT="${BATS_TEST_TMPDIR:-/tmp}/project-root-$$"

setup() {
  export PRE_PR_BYPASS=1
  mkdir -p "$STAMP_DIR"
}

teardown() {
  rm -rf "$PROJECT_ROOT"
  rm -f "$INPUT_FILE"
}

make_input() {
  local cmd="$1"
  python3 - "$cmd" "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd, path = sys.argv[1], sys.argv[2]
with open(path, "w", encoding="utf-8") as f:
    json.dump({"tool_name": "Bash", "tool_input": {"command": cmd}}, f)
PYEOF
}

write_stamp() {
  local verdict="${1:-PASS}"
  local age_secs="${2:-0}"
  local head="${3:-abc12345}"
  local branch="${4:-feature/test}"
  python3 - "$STAMP_FILE" "$verdict" "$age_secs" "$head" "$branch" <<'PYEOF'
import json, sys, time, datetime
path, verdict, age_secs, head, branch = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5]
ts = datetime.datetime.utcfromtimestamp(time.time() - age_secs).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(path, "w") as f:
    json.dump({"verdict": verdict, "timestamp": ts, "head": head, "branch": branch}, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | PRE_PR_BYPASS='' CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
}

# ── BLOCK cases ───────────────────────────────────────────────────────────────

@test "BLOCK: no stamp file" {
  rm -f "$STAMP_FILE"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
}

@test "BLOCK: stamp verdict is FAIL" {
  write_stamp "FAIL" 0 "abc12345" "feature/test"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
}

@test "BLOCK: stale stamp (35 min old)" {
  write_stamp "PASS" $((35 * 60)) "abc12345" "feature/test"
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 2 ]
}

# ── PASS cases ────────────────────────────────────────────────────────────────

@test "PASS: valid fresh stamp (1 min old)" {
  write_stamp "PASS" 60 "" ""
  make_input "git push origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: push to develop is exempt" {
  rm -f "$STAMP_FILE"
  make_input "git push origin develop"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: push to master is exempt" {
  rm -f "$STAMP_FILE"
  make_input "git push origin master"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: force push is exempt" {
  rm -f "$STAMP_FILE"
  make_input "git push --force origin feature/test"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: non-push command is ignored" {
  rm -f "$STAMP_FILE"
  make_input "git commit -m 'chore: update'"
  run_hook
  [ "$status" -eq 0 ]
}

# ── BYPASS cases ──────────────────────────────────────────────────────────────

@test "BYPASS: PRE_PR_BYPASS=1 allows push without stamp" {
  rm -f "$STAMP_FILE"
  make_input "git push origin feature/test"
  run bash -c "cat '$INPUT_FILE' | PRE_PR_BYPASS=1 CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
  [ "$status" -eq 0 ]
}
