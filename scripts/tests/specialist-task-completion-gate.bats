#!/usr/bin/env bats
#
# Tests for .claude/hooks/specialist-task-completion-gate.js (F1a — BL-W47-prep-10).
# Spec: .planning/wave-bl-w47-prep-10/PLAN.md C6.
#
# 6 cases:
#   1. Specialist + status=completed → BLOCK (exit 2)
#   2. Specialist + status=in_progress → ALLOW (exit 0)
#   3. team-lead + status=completed → ALLOW (exit 0)
#   4. arch-platform + status=completed → ALLOW (exit 0)
#   5. Specialist + status=completed + BYPASS env → ALLOW (exit 0)
#   6. Malformed JSON stdin → fail-open (exit 0)

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/specialist-task-completion-gate.js"

setup() {
  export SPECIALIST_TASK_COMPLETION_BYPASS=''
}

make_input() {
  local agent_type="$1" status="$2"
  printf '{"tool_name":"TaskUpdate","tool_input":{"taskId":"1","status":"%s"},"agent_type":"%s"}' \
    "$status" "$agent_type"
}

# ── BLOCK scenario ───────────────────────────────────────────────────────────

@test "Case 1: blocks specialist + status=completed" {
  local input
  input="$(make_input "toolkit-specialist" "completed")"
  run bash -c "echo '$input' | SPECIALIST_TASK_COMPLETION_BYPASS='' node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"block"* ]] || [[ "$stderr" == *"block"* ]]
}

# ── ALLOW scenarios ──────────────────────────────────────────────────────────

@test "Case 2: allows specialist + status=in_progress" {
  local input
  input="$(make_input "toolkit-specialist" "in_progress")"
  run bash -c "echo '$input' | SPECIALIST_TASK_COMPLETION_BYPASS='' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "Case 3: allows team-lead + status=completed" {
  local input
  input="$(make_input "team-lead" "completed")"
  run bash -c "echo '$input' | SPECIALIST_TASK_COMPLETION_BYPASS='' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "Case 4: allows arch-platform + status=completed" {
  local input
  input="$(make_input "arch-platform" "completed")"
  run bash -c "echo '$input' | SPECIALIST_TASK_COMPLETION_BYPASS='' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "Case 5: allows specialist + status=completed + BYPASS env" {
  local input
  input="$(make_input "test-specialist" "completed")"
  run bash -c "echo '$input' | SPECIALIST_TASK_COMPLETION_BYPASS=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "Case 6: malformed JSON → fail-open (exit 0)" {
  run bash -c "echo 'not-valid-json' | SPECIALIST_TASK_COMPLETION_BYPASS='' node '$HOOK'"
  [ "$status" -eq 0 ]
}
