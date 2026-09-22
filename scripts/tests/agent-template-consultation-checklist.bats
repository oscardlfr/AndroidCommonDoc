#!/usr/bin/env bats

REPO_ROOT="$BATS_TEST_DIRNAME/../.."

@test "tl-session-start.md names the main conversation agent as orchestrator" {
  run grep -c "main conversation agent is the orchestrator" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md canonicalizes repository and worktree during preflight" {
  run grep -c "Canonicalize repository/worktree" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md reads repository instructions and planning state" {
  run grep -c "Read repository instructions, BACKLOG, active PLAN, and current Git status" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md resolves waves through the canonical slug helper" {
  run grep -c "Resolve the wave through the canonical slug helper" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md initializes the persisted wave control plane" {
  run grep -c "Initialize/read the wave control plane" "$REPO_ROOT/docs/agents/tl-session-start.md"
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

@test "tl-session-start.md forbids a redundant team-lead role" {
  run grep -c "do not create a redundant" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F1: TYPE-vs-SCOPE script + planner step ---

@test "tl-session-start.md resolves class-required roles from topology" {
  run grep -c "Resolve class-required roles" "$REPO_ROOT/docs/agents/tl-session-start.md"
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

@test "tl-session-start.md delegates lifecycle actions to the canonical runtime" {
  run grep -c "Execute returned lifecycle actions through.*runtime-role-lifecycle" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

# --- F4: User Decision Broadcast Protocol ---

@test "tl-session-start.md requires request-bound JSON architect authority" {
  run grep -c "Architect authority is request-bound JSON" "$REPO_ROOT/docs/agents/tl-session-start.md"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "tl-session-start.md assigns push authority to the installed Git hook" {
  run grep -c "Push authority is the installed Git hook" "$REPO_ROOT/docs/agents/tl-session-start.md"
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

@test "tl-session-start.md limits process cleanup to owned processes" {
  run grep -c "Stop only owned processes" "$REPO_ROOT/docs/agents/tl-session-start.md"
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
