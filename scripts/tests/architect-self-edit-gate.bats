#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/architect-self-edit-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/hook-input-$$.json"

make_input() {
  local tool="$1" path="$2" agent="${3-arch-integration}"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"$agent\"}" > "$INPUT_FILE"
}

@test "blocks arch-integration Write to source file" {
  make_input Write '/project/mcp-server/src/tools/foo.ts' 'arch-integration'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks arch-platform Edit to agent template" {
  make_input Edit '/project/.claude/agents/arch-platform.md' 'arch-platform'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "allows arch-integration Write to verdict file" {
  make_input Write '/project/.planning/wave30/arch-integration-verdict.md' 'arch-integration'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows data-layer-specialist Write to source file" {
  make_input Write '/project/mcp-server/src/tools/foo.ts' 'data-layer-specialist'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows unknown agent_type Write (fail-open)" {
  make_input Write '/project/src/Foo.kt' ''
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}
