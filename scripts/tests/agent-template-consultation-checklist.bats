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

# --- F1: TYPE-vs-SCOPE script + planner step ---

@test "tl-session-start.md contains step 5 list-valid-commit-tokens.sh" {
  run grep -c "list-valid-commit-tokens" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "planner.md contains step 1.85" {
  run grep -c "1\.85" "$REPO_ROOT/setup/agent-templates/planner.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "planner.md contains TYPE-vs-SCOPE language" {
  run grep -cE "TYPE-vs-SCOPE|TYPE.*SCOPE" "$REPO_ROOT/setup/agent-templates/planner.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F2: artifact verification ---

@test "tl-session-start.md contains step 6 artifact verification" {
  run grep -cE "artifact|\.aar|Outer\\\$Inner|nested.*class" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F4: User Decision Broadcast Protocol ---

@test "tl-session-start.md contains User Decision Broadcast Protocol header" {
  run grep -c "User Decision Broadcast Protocol" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md broadcast protocol contains 60-second SLA" {
  run grep -cE "60 second|60-second|60s|within 60" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F2: context-provider Rule 8 FQN labeling ---

@test "context-provider.md contains Rule 8 FQN source labeling" {
  run grep -c "artifact-verified" "$REPO_ROOT/setup/agent-templates/context-provider.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F3: specialist exit-criteria ./gradlew check ---

@test "data-layer-specialist.md contains ./gradlew check exit criteria" {
  run grep -c "gradlew check" "$REPO_ROOT/setup/agent-templates/data-layer-specialist.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "domain-model-specialist.md contains ./gradlew check exit criteria" {
  run grep -c "gradlew check" "$REPO_ROOT/setup/agent-templates/domain-model-specialist.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "ui-specialist.md contains ./gradlew check exit criteria" {
  run grep -c "gradlew check" "$REPO_ROOT/setup/agent-templates/ui-specialist.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "toolkit-specialist.md contains ./gradlew check exit criteria" {
  run grep -c "gradlew check" "$REPO_ROOT/setup/agent-templates/toolkit-specialist.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "test-specialist.md contains ./gradlew check exit criteria" {
  run grep -c "gradlew check" "$REPO_ROOT/setup/agent-templates/test-specialist.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F4: code-state verification mandate + cross-module claim format ---

@test "tl-session-start.md contains code-state verification mandate" {
  run grep -c "code-state verification" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "arch-integration.md contains Cross-module claim format" {
  run grep -c "Cross-module claim format" "$REPO_ROOT/setup/agent-templates/arch-integration.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "arch-integration.md contains grep command executed phrase" {
  run grep -c "grep command executed" "$REPO_ROOT/setup/agent-templates/arch-integration.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}
