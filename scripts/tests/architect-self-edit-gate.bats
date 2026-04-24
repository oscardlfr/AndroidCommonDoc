#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/architect-self-edit-gate.js"

make_input() {
  local tool="$1" path="$2" agent="${3:-arch-integration}"
  echo "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"$agent\"}"
}

@test "blocks arch-integration Write to source file" {
  run bash -c "$(make_input Write '/project/mcp-server/src/tools/foo.ts' 'arch-integration') | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "blocks arch-platform Edit to agent template" {
  run bash -c "$(make_input Edit '/project/.claude/agents/arch-platform.md' 'arch-platform') | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "allows arch-integration Write to verdict file" {
  run bash -c "$(make_input Write '/project/.planning/wave30/arch-integration-verdict.md' 'arch-integration') | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows data-layer-specialist Write to source file" {
  run bash -c "$(make_input Write '/project/mcp-server/src/tools/foo.ts' 'data-layer-specialist') | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows unknown agent_type Write (fail-open)" {
  run bash -c "$(make_input Write '/project/src/Foo.kt' '') | node '$HOOK'"
  [ "$status" -eq 0 ]
}
