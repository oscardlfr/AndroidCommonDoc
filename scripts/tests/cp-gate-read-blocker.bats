#!/usr/bin/env bats

setup() {
  export SESSION_ID="test-session-$$"
  export FLAG_FILE="${TMPDIR:-/tmp}/claude-cp-consulted-${SESSION_ID}.flag"
  rm -f "$FLAG_FILE"
}

teardown() {
  rm -f "$FLAG_FILE"
}

INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/hook-input-$$.json"

make_input() {
  local tool="$1" path="$2" agent="${3:-arch-integration}"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"$agent\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-gate.js"

@test "blocks Read of docs pattern file when CP not consulted" {
  make_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks Read of .claude/agents/ file when CP not consulted" {
  make_input Read '/project/.claude/agents/arch-integration.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "allows Read of .planning/ file without CP flag" {
  make_input Read '/project/.planning/PLAN-W30.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows Read of docs pattern file when CP flag exists" {
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows Read of source .kt file without CP flag" {
  make_input Read '/project/src/main/kotlin/Foo.kt'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}
