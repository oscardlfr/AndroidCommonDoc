#!/usr/bin/env bats
#
# Tests for .claude/hooks/knowledge-currency-gate.js (FIND-06, BL-W42 PR5).
# Verifies that arch-platform / arch-testing are blocked when sending messages
# containing KMP API claims without CP-verification bypass.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/knowledge-currency-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/knowledge-currency-gate-input-$$.json"

make_input() {
  local agent_type="$1"
  local message="$2"
  python3 - "$agent_type" "$message" "$INPUT_FILE" <<'PYEOF'
import json, sys
agent_type, message, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "w", encoding="utf-8") as f:
    json.dump({
        "tool_name": "SendMessage",
        "agent_type": agent_type,
        "tool_input": {"to": "team-lead", "message": message}
    }, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
}

@test "BLOCK: arch-platform with KMP keyword and no bypass" {
  make_input "arch-platform" "Pattern uses commonMain source set"
  run_hook
  [ "$status" -eq 2 ]
}

@test "PASS: arch-platform with KMP keyword + KMP_CURRENCY_CHECKED=1 env" {
  make_input "arch-platform" "Pattern uses commonMain source set"
  run bash -c "cat '$INPUT_FILE' | KMP_CURRENCY_CHECKED=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "PASS: arch-platform with KMP keyword + [KMP_CURRENCY_CHECKED] inline marker" {
  make_input "arch-platform" "Pattern uses commonMain source set [KMP_CURRENCY_CHECKED]"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: non-architect agent sending message with KMP keyword" {
  make_input "doc-updater" "Pattern uses commonMain source set"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: arch-testing message with no KMP keywords" {
  make_input "arch-testing" "The verdict is approved, no issues found."
  run_hook
  [ "$status" -eq 0 ]
}
