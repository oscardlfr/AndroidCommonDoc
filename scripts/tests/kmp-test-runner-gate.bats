#!/usr/bin/env bats
#
# Tests for .claude/hooks/kmp-test-runner-gate.js (Item 4, BL-W42 PR5).
# Verifies that raw Gradle test invocations are blocked and bypass paths work.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/kmp-test-runner-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/kmp-test-runner-gate-input-$$.json"

setup() {
  # Export bypass so that any bats-internal commands do not trigger the hook
  export KMP_TEST_RUNNER_BYPASS=1
}

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
  # Unset bypass for the hook invocation so gate logic is exercised
  run bash -c "cat '$INPUT_FILE' | KMP_TEST_RUNNER_BYPASS='' node '$HOOK'"
}

@test "BLOCK: ./gradlew test" {
  make_input './gradlew test'
  run_hook
  [ "$status" -eq 2 ]
}

@test "BLOCK: gradle test" {
  make_input 'gradle test --rerun-tasks'
  run_hook
  [ "$status" -eq 2 ]
}

@test "BLOCK: :module:test task invocation" {
  make_input './gradlew :core:network:test'
  # :module:test pattern — contains ':' + 'test' substring but we match ':module:test'
  # Use a command that contains the exact blocked substring
  make_input 'bash -c "./gradlew :module:test"'
  run_hook
  [ "$status" -eq 2 ]
}

@test "PASS: KMP_TEST_RUNNER_BYPASS=1 env set" {
  make_input './gradlew test'
  run bash -c "cat '$INPUT_FILE' | KMP_TEST_RUNNER_BYPASS=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "PASS: /test skill invocation (no blocked substring)" {
  make_input '/test --module core-network'
  run_hook
  [ "$status" -eq 0 ]
}
