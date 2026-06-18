#!/usr/bin/env bats
#
# Tests for .claude/hooks/team-completeness-gate.js — RETIRED (BL-W48).
#
# This gate is a no-op tombstone. It exits 0 regardless of roster/flag/CLASS.
# The old roster-floor enforcement has moved to a disk-ARTIFACT floor at push
# boundary (emit-push-proof.sh + wave-topology.yaml class_artifacts).
#
# These tests assert the retirement contract:
#   - hook exits 0 in ALL scenarios, including cases that would previously block
#   - positive case: expected no-op
#   - "would-have-blocked-before" cases: previously CF-2 (HARNESS + 4 peers) and
#     CF-4 (missing CLASS, 4 peers) blocked with exit 2 — now must exit 0

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/team-completeness-gate.js"

setup() {
  export TEAM_COMPLETENESS_BYPASS=1
  export CLAUDE_SESSION_ID="test-session-$$"
  export TMPDIR="${BATS_TEST_TMPDIR:-/tmp}"
  INPUT_FILE="${TMPDIR}/team-completeness-gate-input-$$.json"
  FLAG_FILE="${TMPDIR}/claude-team-topology-test-session-$$.flag"
}

teardown() {
  rm -f "${TMPDIR}/claude-team-topology-test-session-$$.flag"
  rm -f "${TMPDIR}/team-completeness-gate-input-$$.json"
  rm -rf "${TMPDIR}/.planning/wave-bl-w48-tcg-test"
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
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' node '$HOOK'"
}

# ── RETIRED: no-op positive cases ────────────────────────────────────────────

@test "RETIRED-PASS: no flag file (solo session) → exit 0 (no-op tombstone)" {
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='no-flag-session' TMPDIR='${TMPDIR}' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "RETIRED-PASS: flag present, all peers missing → exit 0 (no-op tombstone)" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Bash"
  run_hook
  [ "$status" -eq 0 ]
}

@test "RETIRED-PASS: bypass env set → exit 0 (was already pass; still pass)" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS=1 CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "RETIRED-PASS: non-subject tool (Task) → exit 0 (no-op tombstone)" {
  make_flag $((60 * 60 * 1000)) "[]"
  make_input "Task"
  run_hook
  [ "$status" -eq 0 ]
}

@test "RETIRED-FAIL-OPEN: malformed flag file → exit 0 (no-op tombstone)" {
  echo "not json" > "$FLAG_FILE"
  make_input "Bash"
  run_hook
  [ "$status" -eq 0 ]
}

# ── RETIRED: "would-have-blocked-before, now-passes" cases ───────────────────
# These cases previously triggered CF-2 / CF-4 BLOCK (exit 2). BL-W48 retires
# the gate entirely — they must now exit 0 regardless of CLASS/roster.

write_class_sentinel_tcg() {
  local slug="${1:-bl-w48-tcg-test}"
  local class_val="${2:-HARNESS}"
  mkdir -p "${TMPDIR}/.planning/wave-${slug}"
  printf '%s' "$class_val" > "${TMPDIR}/.planning/wave-${slug}/CLASS"
}

@test "WAS-CF-2 NOW-PASS: HARNESS-class wave + only 4 peers → exit 0 (BL-W48: gate retired)" {
  # Previously CF-2 BLOCK (exit 2): HARNESS floor=7 not met.
  # Now: gate is a no-op tombstone → must exit 0.
  write_class_sentinel_tcg "bl-w48-tcg-test" "HARNESS"
  make_flag $((60 * 60 * 1000)) '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w48-tcg-test' node '$HOOK'"
  [ "$status" -eq 0 ]
  # Must NOT produce a block decision
  [[ "$output" != *"BLOCKED"* ]]
  [[ "$output" != *'"decision"'* ]]
}

@test "WAS-CF-4 NOW-PASS: missing CLASS sentinel + only 4 peers → exit 0 (BL-W48: gate retired)" {
  # Previously CF-4 BLOCK (exit 2): no CLASS → fail-safe HARNESS; floor=7 not met.
  # Now: gate is a no-op tombstone → must exit 0.
  mkdir -p "${TMPDIR}/.planning/wave-bl-w48-tcg-test"
  make_flag $((60 * 60 * 1000)) '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input "Bash"
  run bash -c "cat '$INPUT_FILE' | TEAM_COMPLETENESS_BYPASS='' CLAUDE_SESSION_ID='test-session-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w48-tcg-test' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" != *"BLOCKED"* ]]
}

@test "RETIRED-EXIT0: any Bash command → exit 0 (no-op tombstone, stdin drained)" {
  # The tombstone drains stdin and exits 0. Verify it handles tool input cleanly.
  make_flag $((60 * 60 * 1000)) '[]'
  make_input "Bash"
  run_hook
  [ "$status" -eq 0 ]
}
