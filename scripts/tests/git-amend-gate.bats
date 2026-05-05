#!/usr/bin/env bats
#
# Tests for .claude/hooks/git-amend-gate.js (BL-W42 PR3 / FIND-15).
# Verifies that git commit --amend is blocked unless CLAUDE_AMEND_AUTHORIZED=1
# is set or [CLAUDE_AMEND_AUTHORIZED] marker is present in the command.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/git-amend-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/git-amend-gate-input-$$.json"

# Use python3 for JSON encoding so embedded quotes survive intact.
make_input() {
  local cmd="$1"
  python3 - "$cmd" "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd, path = sys.argv[1], sys.argv[2]
with open(path, "w", encoding="utf-8") as f:
    json.dump({"tool_name": "Bash", "tool_input": {"command": cmd}}, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
}

@test "blocks git commit --amend (no authorization)" {
  make_input 'git commit --amend -m "fix: oops"'
  run_hook
  [ "$status" -eq 1 ]
}

@test "blocks git commit -a --amend (staged-all variant)" {
  make_input 'git commit -a --amend --no-edit'
  run_hook
  [ "$status" -eq 1 ]
}

@test "allows git commit --amend when CLAUDE_AMEND_AUTHORIZED=1 is set" {
  make_input 'git commit --amend -m "fix: authorized"'
  run bash -c "cat '$INPUT_FILE' | CLAUDE_AMEND_AUTHORIZED=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows plain git commit -m (no amend token)" {
  make_input 'git commit -m "feat(agents): new feature"'
  run_hook
  [ "$status" -eq 0 ]
}

@test "allows command with [CLAUDE_AMEND_AUTHORIZED] marker but no --amend token" {
  make_input 'echo "[CLAUDE_AMEND_AUTHORIZED] marker present but no amend"'
  run_hook
  [ "$status" -eq 0 ]
}
