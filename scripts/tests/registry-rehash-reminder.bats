#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/registry-rehash-reminder.js"

make_input() {
  local tool="$1" path="$2"
  echo "{\"tool_name\":\"$tool\",\"tool_input\":{\"file_path\":\"$path\"},\"agent_type\":\"doc-updater\"}"
}

@test "emits warning when Write to .claude/agents/ file" {
  run bash -c "$(make_input Write '/project/.claude/agents/team-lead.md') 2>&1 | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"registry-rehash-reminder"* ]] || [[ "$output" == *"rehash-registry"* ]]
}

@test "emits warning when Edit to setup/agent-templates/ file" {
  run bash -c "$(make_input Edit '/project/setup/agent-templates/planner.md') 2>&1 | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"rehash-registry"* ]] || [[ "$output" == *"registry-rehash-reminder"* ]]
}

@test "no warning for Write to source file" {
  run bash -c "$(make_input Write '/project/mcp-server/src/tools/foo.ts') | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" != *"registry-rehash-reminder"* ]]
  [[ "$output" != *"rehash-registry"* ]]
}

@test "no warning for Write to skills/pre-pr/SKILL.md" {
  run bash -c "$(make_input Write '/project/skills/pre-pr/SKILL.md') | node '$HOOK' 2>&1"
  [ "$status" -eq 0 ]
  [[ "$output" != *"registry-rehash-reminder"* ]]
  [[ "$output" != *"rehash-registry"* ]]
}
