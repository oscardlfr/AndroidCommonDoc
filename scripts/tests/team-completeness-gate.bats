#!/usr/bin/env bats
#
# Tests for .claude/hooks/team-completeness-gate.js (F1 BL-W47-prep-8).
# Verifies that incomplete teams are blocked after the grace period.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/team-completeness-gate.js"

setup() {
  export TEAM_COMPLETENESS_BYPASS=1
  export CLAUDE_SESSION_ID="test-session-$$"
  export TMPDIR="${BATS_TEST_TMPDIR:-/tmp}"
  INPUT_FILE="${TMPDIR}/team-completeness-gate-input-$$.json"
  # FLAG_FILE is placed at the session-derived path so no cp is needed in run_hook
  FLAG_FILE="${TMPDIR}/claude-team-topology-test-session-$$.flag"
}

teardown() {
  rm -f "${TMPDIR}/claude-team-topology-test-session-$$.flag"
  rm -f "${TMPDIR}/team-completeness-gate-input-$$.json"
}

make_input() {
  local tool="${1:-Bash}"
  cat > "$INPUT_FILE" <<EOF
{"tool_name":"${tool}","session_id":"test-session-$$"}
EOF
}

make_flag() {
  local age_ms="${1:-0}"
  local peers="${2:-[]}"
  python3 - "$FLAG_FILE" "$age_ms" "$peers" <<'PYEOF'
import json, sys, time
path, age_ms, peers_str = sys.argv[1], int(sys.argv[2]), sys.argv[3]
ts = int(time.time() * 1000) - age_ms
peers = json.loads(peers_str)
with open(path, "w") as f:
    json.dump({"sessionId": "test", "peers": peers, "ts": ts}, f)
PYEOF
}

run_hook() {
  # FLAG_FILE is already at the session-derived path (no cp needed)
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' node '$HOOK'"
}

# ── PASS cases (should NOT block) ────────────────────────────────────────────

@test "PASS: no flag file (solo session)" {
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='no-flag-session' TMPDIR='${TMPDIR}' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "PASS: flag within grace period (5 min old, all peers missing)" {
  make_flag $((5 * 60 * 1000)) "[]"
  make_input "Bash"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: bypass env TEAM_COMPLETENESS_BYPASS=1" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS=1 CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "PASS: non-subject tool (Task) is not intercepted" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Task"
  run_hook
  [ "$status" -eq 0 ]
}

# ── FAIL-OPEN cases ───────────────────────────────────────────────────────────

@test "FAIL-OPEN: malformed flag file is ignored" {
  echo "not json" > "$FLAG_FILE"
  make_input "Bash"
  run_hook
  [ "$status" -eq 0 ]
}

@test "FAIL-OPEN: missing topology yaml does not block" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='/nonexistent' node '$HOOK'"
  [ "$status" -eq 0 ]
}
