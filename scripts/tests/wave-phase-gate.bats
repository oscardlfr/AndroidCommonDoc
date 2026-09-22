#!/usr/bin/env bats

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/wave-phase-gate.js"

setup() {
  ROOT="$(mktemp -d)"
  mkdir -p "$ROOT/.planning/wave-demo" "$ROOT/.claude/registry" "$ROOT/mcp-server/node_modules" "$ROOT/.androidcommondoc/wave-control"
  ln -s "$BATS_TEST_DIRNAME/../../mcp-server/node_modules/yaml" "$ROOT/mcp-server/node_modules/yaml"
  cat > "$ROOT/.planning/wave-demo/PLAN.md" <<'EOF'
### Wave Class

**Class**: FAST-PATH
EOF
  cat > "$ROOT/.claude/registry/wave-topology.yaml" <<'EOF'
default_class: HARNESS
class_artifacts:
  FAST-PATH:
    architects: []
    lifecycle_roles: []
    execution_mode: disk-only
EOF
  git -C "$ROOT" init -q
  git -C "$ROOT" config user.email bats@example.invalid
  git -C "$ROOT" config user.name Bats
  git -C "$ROOT" add .
  git -C "$ROOT" commit -qm fixture
  node "$BATS_TEST_DIRNAME/../tools/wave-control-plane.cjs" init --root "$ROOT" --slug demo >/dev/null
}

teardown() { rm -rf "$ROOT"; }

run_bash_hook() {
  local command="$1"
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$command\"}}' | CLAUDE_PROJECT_DIR='$ROOT' CLAUDE_WAVE_SLUG=demo node '$HOOK'"
}

@test "Rule A ignores harmless push prose" {
  run_bash_hook "echo git push the button"
  [ "$status" -eq 0 ]
}

@test "Rule A blocks executable push intent before COMPLETE" {
  run_bash_hook "rtk git push origin demo"
  [ "$status" -eq 2 ]
  [[ "$output" == *"COMPLETE"* ]]
}

@test "Rule A blocks PR creation when wave context is unresolved" {
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"gh pr create\"}}' | CLAUDE_PROJECT_DIR='$ROOT' CLAUDE_WAVE_SLUG=develop node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"fails closed"* ]]
}

@test "Rule A explicit bypass remains available only when set by caller" {
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push\"}}' | CLAUDE_PROJECT_DIR='$ROOT' CLAUDE_WAVE_SLUG=demo WAVE_PHASE_GATE_BYPASS=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "Rule B rejects undeclared architects for the wave class" {
  run bash -c "printf '%s' '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"arch-platform\"}}' | CLAUDE_PROJECT_DIR='$ROOT' CLAUDE_WAVE_SLUG=demo node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"not required"* ]]
}
