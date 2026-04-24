#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/registry-rehash-reminder.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/hook-input-$$.json"

make_input() {
  local tool="$1" path="$2"
  printf '%s\n' "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"doc-updater\"}" > "$INPUT_FILE"
}

@test "emits warning when Write to .claude/agents/ file" {
  make_input Write '/project/.claude/agents/team-lead.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"registry-rehash-reminder"* ]] || [[ "$output" == *"rehash-registry"* ]]
}

@test "emits warning when Edit to setup/agent-templates/ file" {
  make_input Edit '/project/setup/agent-templates/planner.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"rehash-registry"* ]] || [[ "$output" == *"registry-rehash-reminder"* ]]
}

@test "no warning for Write to source file" {
  make_input Write '/project/mcp-server/src/tools/foo.ts'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" != *"registry-rehash-reminder"* ]]
  [[ "$output" != *"rehash-registry"* ]]
}

@test "no warning for Write to skills/pre-pr/SKILL.md" {
  make_input Write '/project/skills/pre-pr/SKILL.md'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" != *"registry-rehash-reminder"* ]]
  [[ "$output" != *"rehash-registry"* ]]
}
