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
  rm -rf "${TMPDIR}/.planning/wave-bl-w47-tcg-test"
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

# NOTE: "FAIL-OPEN: missing topology yaml" test removed in BL-W47 ex-PR4.
# topoPath is __dirname-anchored — topology is always readable from hook location.
# CLAUDE_PROJECT_DIR=/nonexistent no longer achieves fail-open; load always succeeds.
# loadYaml null→exit(0) path exists in code but requires __dirname mock to test — not cheap.

# ── D-1 class_floors: CLASS-aware peer count floor (BL-W47 ex-PR4) ──────────
#
# After D-1, team-completeness-gate reads <waveDir>/CLASS sentinel and looks up
# class_floors[class] in wave-topology.yaml to enforce role-list membership.
# DOC floor: 4 peers. HARNESS floor: 7 peers.
# Missing CLASS sentinel → fail-safe to HARNESS.
#
# Tests set CLAUDE_PROJECT_DIR=${TMPDIR} and write CLASS sentinel to
# ${TMPDIR}/.planning/wave-{slug}/CLASS. topology+yaml are __dirname-anchored.
# teardown() removes ${TMPDIR}/.planning/wave-bl-w47-tcg-test after each test.

write_class_sentinel_tcg() {
  local slug="${1:-bl-w47-tcg-test}"
  local class_val="${2:-HARNESS}"
  mkdir -p "${TMPDIR}/.planning/wave-${slug}"
  printf '%s' "$class_val" > "${TMPDIR}/.planning/wave-${slug}/CLASS"
}

@test "CF-1 PASS: DOC-class wave + 4 peers after grace period → exit 0 (DOC floor met)" {
  write_class_sentinel_tcg "bl-w47-tcg-test" "DOC"
  make_flag $((60 * 60 * 1000)) '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w47-tcg-test' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" != *"BLOCKED"* ]]
}

@test "CF-2 BLOCK: HARNESS-class wave + 4 peers after grace period → exit 2 (HARNESS floor 7 not met)" {
  write_class_sentinel_tcg "bl-w47-tcg-test" "HARNESS"
  make_flag $((60 * 60 * 1000)) '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w47-tcg-test' node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED"* ]] || [[ "$output" == *"Missing"* ]]
}

@test "CF-3 PASS: missing CLASS sentinel → fail-safe HARNESS + 7 peers → exit 0 (floor met)" {
  # No CLASS sentinel written — hook defaults to HARNESS (fail-safe per Decision 6).
  make_flag $((60 * 60 * 1000)) '["arch-platform","arch-testing","arch-integration","planner","context-provider","doc-updater","quality-gater"]'
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w47-tcg-test' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "CF-4 BLOCK: missing CLASS sentinel → fail-safe HARNESS + 4 peers → exit 2 (floor not met)" {
  # No CLASS sentinel — wave dir created so waveDir resolves; hook defaults CLASS to HARNESS.
  mkdir -p "${TMPDIR}/.planning/wave-bl-w47-tcg-test"
  make_flag $((60 * 60 * 1000)) '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w47-tcg-test' node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"BLOCKED"* ]] || [[ "$output" == *"Missing"* ]]
}
