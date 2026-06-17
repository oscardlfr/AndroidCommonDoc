#!/usr/bin/env bats
#
# Tests for .claude/hooks/team-topology-gate.js — RETIRED (BL-W48).
#
# This gate is a no-op tombstone. It exits 0 regardless of roster/flag/CLASS/
# subagent_type. The old PreToolUse(Agent) roster-floor enforcement has moved
# to a disk-ARTIFACT floor at push boundary (emit-push-proof.sh + wave-topology.yaml
# class_artifacts). PostToolUse(Agent) roster-recording is also gone — team_name
# is deprecated/ignored and subagents spawned without it never armed the flag anyway.
#
# These tests assert the retirement contract:
#   - hook exits 0 in ALL scenarios
#   - positive case: expected no-op (was already no-op without flag)
#   - "would-have-blocked-before" case: TF-2 (HARNESS + 4 peers + arch-* spawn)
#     previously exited 2 — must now exit 0

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
  rm -rf "${TMPDIR}/.planning/wave-bl-w48-ttg-test"
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
  local slug="${1:-bl-w48-ttg-test}"
  local class_val="${2:-HARNESS}"
  mkdir -p "${TMPDIR}/.planning/wave-${slug}"
  printf '%s' "$class_val" > "${TMPDIR}/.planning/wave-${slug}/CLASS"
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_TOPOLOGY_GATE_DISABLED='' CLAUDE_SESSION_ID='test-topology-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w48-ttg-test' node '$HOOK'"
}

# ── RETIRED: no-op positive cases ────────────────────────────────────────────

@test "RETIRED-PASS: DOC-class wave + 4 peers → exit 0 (no-op tombstone)" {
  write_class_sentinel "bl-w48-ttg-test" "DOC"
  make_flag 0 '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input_spawn "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" != *'"block"'* ]]
}

@test "RETIRED-PASS: gate disabled env → exit 0 (was already pass; still pass)" {
  write_class_sentinel "bl-w48-ttg-test" "HARNESS"
  make_flag 0 '["arch-platform"]'
  make_input_spawn "arch-testing"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_TOPOLOGY_GATE_DISABLED=1 CLAUDE_SESSION_ID='test-topology-$$' TMPDIR='${TMPDIR}' CLAUDE_PROJECT_DIR='${TMPDIR}' CLAUDE_WAVE_SLUG='bl-w48-ttg-test' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "RETIRED-PASS: no session flag → exit 0 (no-op tombstone)" {
  make_input_spawn "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
}

@test "RETIRED-PASS: non-arch-* spawn (toolkit-specialist) → exit 0 (no-op tombstone)" {
  write_class_sentinel "bl-w48-ttg-test" "HARNESS"
  make_flag 0 '[]'
  cat > "$INPUT_FILE" <<EOF
{"tool_name":"Agent","hook_event_name":"PreToolUse","session_id":"test-topology-$$","tool_input":{"subagent_type":"toolkit-specialist"}}
EOF
  run_hook
  [ "$status" -eq 0 ]
}

# ── RETIRED: "would-have-blocked-before, now-passes" case ─────────────────────
# TF-2 previously blocked (exit 2): HARNESS-class + 4 peers → arch-* spawn blocked.
# BL-W48 retires the gate — must now exit 0 regardless.

@test "WAS-TF-2 NOW-PASS: HARNESS-class + only 4 peers + arch-* spawn → exit 0 (BL-W48: gate retired)" {
  # Previously TF-2 BLOCK (exit 2): HARNESS floor=7 not met → arch-* spawn blocked.
  # Now: gate is a no-op tombstone → must exit 0.
  write_class_sentinel "bl-w48-ttg-test" "HARNESS"
  make_flag 0 '["arch-platform","context-provider","doc-updater","quality-gater"]'
  make_input_spawn "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
  # Must NOT produce a block decision
  [[ "$output" != *'"decision"'* ]]
  [[ "$output" != *'"block"'* ]]
}

@test "RETIRED-EXIT0: arch-* spawn with empty peer list → exit 0 (no-op tombstone)" {
  # Previously: empty peer list → well below any floor → would block for arch-* spawn.
  # Now: gate is a no-op tombstone → exit 0 unconditionally.
  write_class_sentinel "bl-w48-ttg-test" "HARNESS"
  make_flag 0 '[]'
  make_input_spawn "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}
