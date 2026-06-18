#!/usr/bin/env bats
# Tests for .claude/hooks/plan-mode-spawn-planner.js (BL-W48 team-model migration).
#
# BL-W48 change: the planner is now a single-use subagent (not a TeamCreate-peer).
# A bare Agent(subagent_type="planner") without team_name is the canonical spawn
# and CLEARS the sentinel (unblocking ExitPlanMode). The team_name/name fields are
# deprecated/ignored — supplying them still works but is no longer required.
#
# The 3 sentinel invariants are PRESERVED:
#   - EnterPlanMode writes the sentinel
#   - Agent(subagent_type="planner") clears the sentinel
#   - ExitPlanMode blocks if the sentinel is still present
#
# Modeled on scripts/tests/agent-spawn-validator.bats.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/plan-mode-spawn-planner.js"
PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
SENTINEL="$PROJECT_ROOT/.planning/.plan-mode-planner-required"
# On Windows/Git-Bash, `$PROJECT_ROOT` is a POSIX path (/c/Users/...) which Node's
# path.join converts to a root-relative Windows path (\c\Users\...) that does NOT
# match the real C:\Users\... filesystem location. Use pwd -W (Git-Bash built-in)
# to get a C:/ style path that Node can resolve correctly on Windows.
WIN_PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd -W 2>/dev/null || echo "$PROJECT_ROOT")"

setup() {
  rm -f "$SENTINEL"
  # Unset CLAUDE_SKIP_PLANNER so the hook's EnterPlanMode branch writes the sentinel.
  # (It may be set in the parent shell when running under the Claude agent harness.)
  unset CLAUDE_SKIP_PLANNER
}

teardown() {
  rm -f "$SENTINEL"
  unset CLAUDE_SKIP_PLANNER
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
  # PostToolUse EnterPlanMode writes sentinel.
  # WIN_PROJECT_ROOT (C:/...) is used so Node's path.join resolves to the real
  # C:\Users\... filesystem path on Windows (POSIX /c/... path produces \c\... root-relative).
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # PreToolUse ExitPlanMode must block because sentinel still present
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  [[ "$output" == *"planner subagent was not spawned"* ]]
}

# ── Case 3: Enter → Agent(planner, bare, no team_name) → ExitPlanMode succeeds ─
# BL-W48 canonical spawn: bare Agent() without team_name.

@test "EnterPlanMode then bare Agent planner (no team_name) then ExitPlanMode succeeds" {
  # PostToolUse EnterPlanMode writes sentinel
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # PostToolUse bare Agent with subagent_type=planner — no team_name (BL-W48 canonical)
  run bash -c "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -f "$SENTINEL" ]
  # PreToolUse ExitPlanMode must succeed — sentinel gone
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 3b: Enter → Agent(planner with team_name) → ExitPlanMode succeeds ─
# Backward-compat: team_name still accepted (ignored), sentinel still cleared.

@test "EnterPlanMode then Agent planner with team_name then ExitPlanMode succeeds" {
  # PostToolUse EnterPlanMode writes sentinel
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # PostToolUse Agent with team_name (backward-compat, ignored)
  run bash -c "echo '{\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\",\"team_name\":\"session-test\",\"name\":\"planner\"},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # PreToolUse ExitPlanMode must succeed — sentinel gone
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 4: CLAUDE_SKIP_PLANNER=1 escape hatch ──────────────────────────────

@test "CLAUDE_SKIP_PLANNER=1 allows ExitPlanMode without planner spawn" {
  # EnterPlanMode with escape hatch set — sentinel must NOT be written
  run env CLAUDE_SKIP_PLANNER=1 bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # ExitPlanMode must succeed — no sentinel was written
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 5: PostToolUse ExitPlanMode cleans sentinel (defensive) ─────────────

@test "PostToolUse ExitPlanMode removes sentinel file" {
  # Pre-create the sentinel to simulate a stale state
  touch "$SENTINEL"
  # PostToolUse ExitPlanMode — hook_event type is PostToolUse (drives cleanup branch)
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"hook_event_name\":\"PostToolUse\",\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # Sentinel must be gone regardless of exit code
  [ ! -f "$SENTINEL" ]
}

# ── Case 6 (REQUIRED-1): ExitPlanMode with no prior EnterPlanMode is allowed ─

@test "ExitPlanMode with no sentinel is allowed (no prior EnterPlanMode)" {
  # No EnterPlanMode call — sentinel never written
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ -z "$output" ]] || [[ "$output" != *'"decision":"block"'* ]]
}

# ── Case 7 (REQUIRED-2): Multiple planner spawns are idempotent ─────────────

@test "multiple bare planner Agent spawns are idempotent — ExitPlanMode still succeeds" {
  # PostToolUse EnterPlanMode
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # First bare planner spawn (BL-W48 canonical) — deletes sentinel
  run bash -c "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # Second planner spawn — sentinel already gone, must not re-create it
  run bash -c "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  # ExitPlanMode must succeed
  run bash -c "echo '{\"tool_name\":\"ExitPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
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

# ── Case A: bare Agent(subagent_type=planner) clears sentinel (BL-W48 canonical) ─

@test "bare Agent(subagent_type=planner, no team_name) clears sentinel" {
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  run bash -c "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\"},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -f "$SENTINEL" ]
}

# ── Case A2: peer-spawn (team_name + name) also clears sentinel (backward-compat) ─

@test "Agent(subagent_type=planner, team_name, name=planner) clears sentinel (backward-compat)" {
  run bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  run bash -c "echo '{\"hook_event_name\":\"PostToolUse\",\"tool_name\":\"Agent\",\"tool_input\":{\"subagent_type\":\"planner\",\"team_name\":\"session-test\",\"name\":\"planner\"},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -f "$SENTINEL" ]
}

# ── Case D: CLAUDE_SKIP_PLANNER=1 still respected ───────────────────────────

@test "CLAUDE_SKIP_PLANNER=1 suppresses sentinel write on EnterPlanMode" {
  run env CLAUDE_SKIP_PLANNER=1 bash -c "echo '{\"tool_name\":\"EnterPlanMode\",\"tool_input\":{},\"cwd\":\"$WIN_PROJECT_ROOT\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
  [ ! -f "$SENTINEL" ]
}
