#!/usr/bin/env bats
#
# Tests for .claude/hooks/team-topology-gate.js (BL-W47 ex-PR4 D-1 class_floors).
# Verifies that the class-aware peer floor blocks arch-* spawns when the wave class
# requires more peers than are currently present in the session flag.
#
# CLASS sentinels written to ${TMPDIR}/.planning/wave-{slug}/ so the hook's
# .planning check finds them with CLAUDE_PROJECT_DIR=${TMPDIR}. topology+yaml
# are __dirname-anchored — no CLAUDE_PROJECT_DIR action needed for those.
# teardown() removes ${TMPDIR}/.planning/wave-bl-w47-ttg-test after each test.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/team-topology-gate.js"

setup() {
  export CLAUDE_TOPOLOGY_GATE_DISABLED=''
  export CLAUDE_SESSION_ID="test-topology-$$"
  export TMPDIR="${BATS_TEST_TMPDIR:-/tmp}"
  INPUT_FILE="${TMPDIR}/team-topology-gate-input-$$.json"
  FLAG_FILE="${TMPDIR}/claude-team-topology-test-topology-$$.flag"
}

teardown() {
  rm -f "${TMPDIR}/claude-team-topology-test-topology-$$.flag"
  rm -f "${TMPDIR}/team-topology-gate-input-$$.json"
  rm -rf "${TMPDIR}/.planning/wave-bl-w47-ttg-test"
}

make_input_spawn() {
  local subagent="${1:-arch-platform}"
  cat > "$INPUT_FILE" <<EOF
{"tool_name":"Agent","hook_event_name":"PreToolUse","session_id":"test-topology-$$","tool_input":{"subagent_type":"${subagent}"}}
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
    json.dump({"sessionId": "test-topology", "peers": peers, "ts": ts}, f)
PYEOF
}

write_class_sentinel() {
  local slug="${1:-bl-w47-ttg-test}"
  local class_val="${2:-HARNESS}"
  mkdir -p "${TMPDIR}/.planning/wave-${slug}"
  printf '%s' "$class_val" > "${TMPDIR}/.planning/wave-${slug}/CLASS"
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_TOPOLOGY_GATE_DISABLED='' CLAUDE_SESSION_ID='test-topology-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w47-ttg-test' node '$HOOK'"
}

@test "TF-1 PASS: DOC-class wave + 4 peers → arch-* spawn allowed (DOC floor met)" {
  write_class_sentinel "bl-w47-ttg-test" "DOC"
  make_flag 0 '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input_spawn "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"block"'* ]]
}

@test "TF-2 BLOCK: HARNESS-class wave + 4 peers → arch-* spawn blocked (HARNESS floor 7 not met)" {
  write_class_sentinel "bl-w47-ttg-test" "HARNESS"
  make_flag 0 '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input_spawn "arch-testing"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision"'* ]]
  [[ "$output" == *'"block"'* ]]
}

@test "TF-3 PASS: CLAUDE_TOPOLOGY_GATE_DISABLED=1 → no block" {
  write_class_sentinel "bl-w47-ttg-test" "HARNESS"
  make_flag 0 '["arch-platform"]'
  make_input_spawn "arch-testing"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_TOPOLOGY_GATE_DISABLED=1 CLAUDE_SESSION_ID='test-topology-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w47-ttg-test' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "TF-4 PASS: no session flag → fail-open" {
  make_input_spawn "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
}

@test "TF-5 PASS: non-arch-* spawn (toolkit-specialist) → not intercepted" {
  write_class_sentinel "bl-w47-ttg-test" "HARNESS"
  make_flag 0 '[]'
  # team-topology-gate PreToolUse only intercepts arch-* subagent_type
  cat > "$INPUT_FILE" <<EOF
{"tool_name":"Agent","hook_event_name":"PreToolUse","session_id":"test-topology-$$","tool_input":{"subagent_type":"toolkit-specialist"}}
EOF
  run_hook
  [ "$status" -eq 0 ]
}
