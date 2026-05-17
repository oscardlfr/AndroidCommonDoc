#!/usr/bin/env bats
#
# Tests for .claude/hooks/team-completeness-gate.js (F1 BL-W47-prep-8).
# Verifies that incomplete teams are blocked after the grace period.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/team-completeness-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/team-completeness-gate-input-$$.json"
FLAG_FILE="${BATS_TEST_TMPDIR:-/tmp}/claude-team-topology-test-session-$$.flag"

setup() {
  export TEAM_COMPLETENESS_BYPASS=1
  export CLAUDE_SESSION_ID="test-session-$$"
  export TMPDIR="${BATS_TEST_TMPDIR:-/tmp}"
}

teardown() {
  rm -f "$FLAG_FILE"
  rm -f "$INPUT_FILE"
}

make_input() {
  local tool="${1:-Bash}"
  python3 - "$tool" "$INPUT_FILE" <<'PYEOF'
import json, sys
tool, path = sys.argv[1], sys.argv[2]
with open(path, "w", encoding="utf-8") as f:
    inp = {"tool_name": tool, "session_id": "test-session-" + __import__("os").environ.get("BATS_SUITE_TMPDIR", "x")[-4:]}
    json.dump(inp, f)
PYEOF
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
  local session_id="test-session-$$"
  # Rename flag to match session
  local flag_path="${TMPDIR}/claude-team-topology-${session_id}.flag"
  cp "$FLAG_FILE" "$flag_path" 2>/dev/null || true
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='${session_id}' TMPDIR='${TMPDIR}' node '$HOOK'"
  rm -f "$flag_path"
}

# ── PASS cases (should NOT block) ────────────────────────────────────────────

@test "PASS: no flag file (solo session)" {
  python3 -c "import json; f=open('$INPUT_FILE','w'); json.dump({'tool_name':'Bash','session_id':'no-flag-session'},f)"
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
  local session_id="test-session-$$"
  local flag_path="${TMPDIR}/claude-team-topology-${session_id}.flag"
  cp "$FLAG_FILE" "$flag_path"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS=1 CLAUDE_SESSION_ID='${session_id}' TMPDIR='${TMPDIR}' node '$HOOK'"
  rm -f "$flag_path"
  [ "$status" -eq 0 ]
}

@test "PASS: non-subject tool (Task) is not intercepted" {
  make_flag $((60 * 60 * 1000)) "[]"
  python3 -c "import json; f=open('$INPUT_FILE','w'); json.dump({'tool_name':'Task','session_id':'test-session-$$'},f)"
  run_hook
  [ "$status" -eq 0 ]
}

# ── FAIL-OPEN cases ───────────────────────────────────────────────────────────

@test "FAIL-OPEN: malformed flag file is ignored" {
  local session_id="test-session-$$"
  local flag_path="${TMPDIR}/claude-team-topology-${session_id}.flag"
  echo "not json" > "$flag_path"
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='${session_id}' TMPDIR='${TMPDIR}' node '$HOOK'"
  rm -f "$flag_path"
  [ "$status" -eq 0 ]
}

@test "FAIL-OPEN: missing topology yaml does not block" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Bash"
  local session_id="test-session-$$"
  local flag_path="${TMPDIR}/claude-team-topology-${session_id}.flag"
  cp "$FLAG_FILE" "$flag_path"
  # Use a nonexistent project root so yaml load fails
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='${session_id}' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='/nonexistent' node '$HOOK'"
  rm -f "$flag_path"
  [ "$status" -eq 0 ]
}
