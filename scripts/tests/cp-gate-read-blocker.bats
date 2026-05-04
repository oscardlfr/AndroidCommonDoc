#!/usr/bin/env bats

setup() {
  export TMPDIR="${BATS_TMPDIR:-/tmp}"
  export SESSION_ID="test-session-$$"
  export FLAG_FILE="${TMPDIR:-/tmp}/claude-cp-consulted-${SESSION_ID}.flag"
  rm -f "$FLAG_FILE"
}

teardown() {
  rm -f "$FLAG_FILE"
  rm -f "${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-"*.flag
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

make_specialist_input() {
  local tool="$1" path="$2"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"test-specialist\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

make_arch_sendmsg_input() {
  # Simulates an arch→specialist SendMessage for consulted.js
  local to="$1"
  printf '%s\n' "{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"$to\",\"message\":\"dispatch\"},\"agent_type\":\"arch-testing\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
}

CONSULTED_HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/context-provider-consulted.js"

@test "specialist Read on docs blocked when only global CP flag set (C1 regression)" {
  # Global CP flag set (as if planner contacted CP) but no arch-response flag
  touch "$FLAG_FILE"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "specialist Read on docs allowed when arch-response flag set (C1 happy path)" {
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  touch "$arch_flag"
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
  rm -f "$arch_flag"
}

@test "consulted hook writes arch-response flag on arch→specialist SendMessage" {
  make_arch_sendmsg_input 'test-specialist'
  run bash -c "cat '$INPUT_FILE' | node '$CONSULTED_HOOK'"
  [ "$status" -eq 0 ]
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  [ -f "$arch_flag" ]
  rm -f "$arch_flag"
}

@test "consulted hook does NOT write arch-response flag on planner→CP SendMessage" {
  printf '%s\n' "{\"tool_name\":\"SendMessage\",\"tool_input\":{\"to\":\"context-provider\",\"message\":\"query\"},\"agent_type\":\"planner\",\"session_id\":\"$SESSION_ID\"}" > "$INPUT_FILE"
  run bash -c "cat '$INPUT_FILE' | node '$CONSULTED_HOOK'"
  [ "$status" -eq 0 ]
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-context-provider.flag"
  [ ! -f "$arch_flag" ]
}

@test "specialist Read on own template file blocked regardless of flags (C2)" {
  touch "$FLAG_FILE"
  local arch_flag="${TMPDIR:-/tmp}/claude-arch-responded-${SESSION_ID}-test-specialist.flag"
  touch "$arch_flag"
  make_specialist_input Read '/project/setup/agent-templates/test-specialist.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
  rm -f "$arch_flag"
}

@test "CLAUDE_CP_GATE_DISABLED=1 allows any specialist search (emergency bypass)" {
  make_specialist_input Read '/project/docs/di/di-patterns-modules.md'
  run env CLAUDE_CP_GATE_DISABLED=1 bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "non-specialist arch agent Read still uses global CP flag (no regression)" {
  touch "$FLAG_FILE"
  make_input Read '/project/docs/di/di-patterns-modules.md' 'arch-integration'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}
