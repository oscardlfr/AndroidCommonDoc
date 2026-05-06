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

@test "allows arch-* Write to hyphenated wave verdict file (wave-bl-w32-05)" {
  make_input Write '/project/.planning/wave-bl-w32-05/arch-platform-verdict.md' 'arch-platform'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows arch-* Write to dotted wave verdict file (wave31.7)" {
  make_input Write '/project/.planning/wave31.7/arch-testing-verdict.md' 'arch-testing'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows pr3- prefixed arch-platform verdict file (single-digit)" {
  make_input Write '/project/.planning/wave-bl-w42-pr4/pr3-arch-platform-verdict.md' 'arch-platform'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows pr10- prefixed arch-integration verdict file (multi-digit)" {
  make_input Write '/project/.planning/wave-bl-w42-pr4/pr10-arch-integration-verdict.md' 'arch-integration'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "blocks pr3-foo-verdict file (non-arch prefix)" {
  make_input Write '/project/.planning/wave-bl-w42-pr4/pr3-foo-verdict.md' 'arch-platform'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}

@test "allows legacy arch-testing-verdict file (no pr prefix)" {
  make_input Write '/project/.planning/wave-bl-w42-pr4/arch-testing-verdict.md' 'arch-testing'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── BL-W43-01: cross-verify path exemption ──────────────────────────────────

@test "allows arch-* Write to cross-verify file (no pr prefix)" {
  make_input Write '/project/.planning/wave-bl-w43/arch-testing-cross-verify.md' 'arch-testing'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "allows arch-* Write to pr-prefixed cross-verify file" {
  make_input Write '/project/.planning/wave-bl-w43/pr1-arch-platform-cross-verify.md' 'arch-platform'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "blocks arch-* Write to cross-check.md (wrong suffix, not cross-verify)" {
  make_input Write '/project/.planning/wave-bl-w43/arch-platform-cross-check.md' 'arch-platform'
  run bash -c "cat '$INPUT_FILE' | node '$HOOK'"
  [ "$status" -eq 2 ]
}
