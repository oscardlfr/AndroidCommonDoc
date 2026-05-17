#!/usr/bin/env bats

REPO_ROOT="$BATS_TEST_DIRNAME/../.."

@test "tl-session-start.md contains L0 Mechanical Floor Consultation Checklist header" {
  run grep -c "L0 Mechanical Floor Consultation Checklist" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md contains step 1" {
  run grep -c "1. Read all" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md contains step 2" {
  run grep -c "2. Read each" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md contains step 3" {
  run grep -c "3. List active" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md contains step 4" {
  run grep -c "4. If brief contradicts" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "planner.md contains BRIEF-HOOK-CONFLICT marker" {
  run grep -c "BRIEF-HOOK-CONFLICT" "$REPO_ROOT/setup/agent-templates/planner.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "planner.md contains INTERMEDIATE PUSHES note" {
  run grep -c "INTERMEDIATE PUSHES" "$REPO_ROOT/setup/agent-templates/planner.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md contains INTERMEDIATE PUSHES note" {
  run grep -c "INTERMEDIATE PUSHES" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}
