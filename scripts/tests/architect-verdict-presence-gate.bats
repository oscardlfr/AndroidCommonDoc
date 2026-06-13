#!/usr/bin/env bats
#
# Tests for .claude/hooks/architect-verdict-presence-gate.js.
# Validates that arch-* agents are blocked from sending APPROVE via SendMessage
# unless a verdict file exists at .planning/wave*/arch-{role}-verdict.md.
# Non-arch agents, non-SendMessage tools, non-APPROVE messages, and structured
# JSON message forms all flow through unblocked.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/architect-verdict-presence-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/arch-verdict-presence-input-$$.json"

# Build a JSON SendMessage envelope:
#   make_input <message_body> [agent_type] [recipient]
# Uses python3 to safely serialize the message body as valid JSON.
make_input() {
  local msg="$1" agent="${2:-arch-platform}" recipient="${3:-team-lead}"
  python3 - "$msg" "$agent" "$recipient" "$INPUT_FILE" <<'PYEOF'
import json, sys
msg, agent, recipient, path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "SendMessage",
        "tool_input": {"to": recipient, "message": msg},
        "agent_type": agent,
        "session_id": "session-test",
    }, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
}

setup() {
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR"
}

teardown() {
  unset CLAUDE_PROJECT_DIR
}

# ── Block scenarios (exit 2) ─────────────────────────────────────────────────

@test "blocks arch-platform APPROVE without verdict file" {
  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"arch-platform"* ]]
}

@test "blocks arch-testing APPROVE without verdict file" {
  make_input "APPROVE" "arch-testing"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"arch-testing"* ]]
}

@test "blocks arch-integration APPROVE without verdict file" {
  make_input "APPROVE" "arch-integration"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"arch-integration"* ]]
}

# ── Allow scenarios — verdict file present (exit 0) ─────────────────────────

@test "allows arch-platform APPROVE when verdict file exists" {
  mkdir -p "$BATS_TEST_TMPDIR/.planning/wave31.7"
  touch "$BATS_TEST_TMPDIR/.planning/wave31.7/arch-platform-verdict.md"
  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-testing APPROVE when verdict file exists" {
  mkdir -p "$BATS_TEST_TMPDIR/.planning/wave31.7"
  touch "$BATS_TEST_TMPDIR/.planning/wave31.7/arch-testing-verdict.md"
  make_input "APPROVE" "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-integration APPROVE when verdict file exists" {
  mkdir -p "$BATS_TEST_TMPDIR/.planning/wave31.7"
  touch "$BATS_TEST_TMPDIR/.planning/wave31.7/arch-integration-verdict.md"
  make_input "APPROVE" "arch-integration"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-APPROVE messages (exit 0) ─────────────────────────

@test "allows arch-platform ESCALATE message (not gated)" {
  make_input "ESCALATE: foo is blocking" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows arch-platform plain question (no APPROVE keyword)" {
  make_input "what's blocking the release?" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-arch agents (exit 0) ──────────────────────────────

@test "allows test-specialist sending APPROVE (not arch-*)" {
  make_input "APPROVE" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — non-SendMessage tool (exit 0) ─────────────────────────

@test "allows non-SendMessage tool even if APPROVE in message" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "Read",
        "tool_input": {"file_path": "APPROVE.md"},
        "agent_type": "arch-platform",
        "session_id": "session-test",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# ── Allow scenarios — edge cases (exit 0) ───────────────────────────────────

@test "allows malformed JSON (fail-open)" {
  printf '%s' '{not json' > "$INPUT_FILE"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows verdict file in alternate wave dir (glob resolves across wave names)" {
  mkdir -p "$BATS_TEST_TMPDIR/.planning/wave29"
  touch "$BATS_TEST_TMPDIR/.planning/wave29/arch-platform-verdict.md"
  make_input "APPROVE" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows empty message body (no APPROVE keyword)" {
  make_input "" "arch-platform"
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows structured JSON message object form (not a string APPROVE)" {
  python3 - "$INPUT_FILE" <<'PYEOF'
import json, sys
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "SendMessage",
        "tool_input": {
            "to": "team-lead",
            "message": {"type": "shutdown_response", "request_id": "abc", "approve": True}
        },
        "agent_type": "arch-platform",
        "session_id": "session-test",
    }, f)
PYEOF
  run_hook
  [ "$status" -eq 0 ]
}

# ── Identity-tolerance: suffix-rotation + free-name (BL-W47 OQ3) ─────────────
# ARCH_ROLES uses startsWith — suffix-rotated arch peers must be blocked the
# same as canonical; free names (no arch- prefix) must pass through.

@test "IT-1 BLOCK: suffix-rotated arch-platform-2 blocked on APPROVE without verdict" {
  make_input "APPROVE" "arch-platform-2"
  run_hook
  [ "$status" -eq 2 ]
}

@test "IT-2 BLOCK: suffix-rotated arch-testing-2 blocked on APPROVE without verdict" {
  make_input "APPROVE" "arch-testing-2"
  run_hook
  [ "$status" -eq 2 ]
}

@test "IT-3 PASS: free-name agent sending APPROVE allowed (not arch-*)" {
  make_input "APPROVE" "free-agent"
  run_hook
  [ "$status" -eq 0 ]
}

@test "IT-4 PASS: suffix-rotated arch-platform-2 APPROVE allowed when verdict exists" {
  mkdir -p "$BATS_TEST_TMPDIR/.planning/wave-bl-w47"
  touch "$BATS_TEST_TMPDIR/.planning/wave-bl-w47/arch-platform-verdict.md"
  make_input "APPROVE" "arch-platform-2"
  run_hook
  [ "$status" -eq 0 ]
}
