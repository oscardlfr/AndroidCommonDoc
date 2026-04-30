#!/usr/bin/env bats
# Tests for .claude/hooks/plan-mode-spawn-planner.js (BL-W31.7-12)
# Modeled on scripts/tests/agent-spawn-validator.bats.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/plan-mode-spawn-planner.js"
PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
SENTINEL="$PROJECT_ROOT/.planning/.plan-mode-planner-required"

setup() {
  rm -f "$SENTINEL"
}

teardown() {
  rm -f "$SENTINEL"
}

# ── Case 1: No-op outside plan mode ─────────────────────────────────────────

@test "hook no-ops when .plan-mode-planner-required sentinel is absent" {
  # Sentinel never written — PreToolUse ExitPlanMode must pass through
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 2: Enter → no spawn → ExitPlanMode BLOCKED ────────────────────────

@test "EnterPlanMode then ExitPlanMode without planner spawn is blocked" {
  # PostToolUse EnterPlanMode writes sentinel
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  # PreToolUse ExitPlanMode must block because sentinel still present
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"planner peer was not spawned"* ]]
}

# ── Case 3: Enter → Agent(planner) → ExitPlanMode succeeds ─────────────────

@test "EnterPlanMode then Agent planner spawn then ExitPlanMode succeeds" {
  # PostToolUse EnterPlanMode writes sentinel
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  # PostToolUse Agent with subagent_type planner deletes sentinel
  run bash -c "echo '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"}}' | node '$HOOK'"
  # PreToolUse ExitPlanMode must succeed — sentinel gone
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 4: CLAUDE_SKIP_PLANNER=1 escape hatch ──────────────────────────────

@test "CLAUDE_SKIP_PLANNER=1 allows ExitPlanMode without planner spawn" {
  # EnterPlanMode with escape hatch set — sentinel must NOT be written
  run env CLAUDE_SKIP_PLANNER=1 bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  # ExitPlanMode must succeed — no sentinel was written
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 5: PostToolUse ExitPlanMode cleans sentinel (defensive) ─────────────

@test "PostToolUse ExitPlanMode removes sentinel file" {
  # Pre-create the sentinel to simulate a stale state
  touch "$SENTINEL"
  # PostToolUse ExitPlanMode — hook_event type is PostToolUse (drives cleanup branch)
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"hook_event_name\":\"PostToolUse\"}' | node '$HOOK'"
  # Sentinel must be gone regardless of exit code
  [ ! -f "$SENTINEL" ]
}

# ── Case 6 (REQUIRED-1): ExitPlanMode with no prior EnterPlanMode is allowed ─

@test "ExitPlanMode with no sentinel is allowed (no prior EnterPlanMode)" {
  # No EnterPlanMode call — sentinel never written
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 7 (REQUIRED-2): Multiple planner spawns are idempotent ─────────────

@test "multiple planner Agent spawns are idempotent — ExitPlanMode still succeeds" {
  # PostToolUse EnterPlanMode
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  # First planner spawn — deletes sentinel
  run bash -c "echo '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"}}' | node '$HOOK'"
  # Second planner spawn — sentinel already gone, must not re-create it
  run bash -c "echo '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"}}' | node '$HOOK'"
  # ExitPlanMode must succeed
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{}}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 8 (REQUIRED-3): Fails open when .planning/ dir is absent ───────────

@test "fails open when .planning/ dir is absent" {
  local tmp_dir
  tmp_dir=$(mktemp -d)
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$tmp_dir\"}' | node '$HOOK'"
  rm -rf "$tmp_dir"
  [ "$status" -eq 0 ]
}

# ── Case 9 (REQUIRED-4): Fails open on malformed JSON input ─────────────────

@test "fails open on malformed JSON input" {
  run bash -c "echo 'not-valid-json' | node '$HOOK'"
  [ "$status" -eq 0 ]
}
