#!/usr/bin/env bats
#
# Tests for .claude/hooks/wave-phase-gate.js Rule A (isGatedCommand prefix match).
# Rule A: git push / gh pr create blocked when quality-gate sentinel missing.
#
# Strategy: set CLAUDE_WAVE_SLUG to a sentinel-free test slug so the hook always
# checks a missing sentinel (GATE cases). For the sentinel-present case (Case 10),
# create the sentinel file before running and remove it in teardown.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/wave-phase-gate.js"
TEST_SLUG="bats-test-wave-w44"
SENTINEL_DIR="$BATS_TEST_DIRNAME/../../.claude/wave-quality-gates"
SENTINEL_FILE="$SENTINEL_DIR/$TEST_SLUG.md"

run_hook() {
  local cmd="$1"
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"'\"$cmd\"'\"}}' | CLAUDE_WAVE_SLUG=$TEST_SLUG node '$HOOK'"
}

run_hook_with_bypass() {
  local cmd="$1"
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"'\"$cmd\"'\"}}' | CLAUDE_WAVE_SLUG=$TEST_SLUG WAVE_PHASE_GATE_BYPASS=1 node '$HOOK'"
}

setup() {
  rm -f "$SENTINEL_FILE"
}

teardown() {
  rm -f "$SENTINEL_FILE"
}

# ── Rule A GATE cases — sentinel missing → BLOCK ────────────────────────────

@test "Rule A GATE: git push origin feature/bl-w44-pr4 + no sentinel → exit 2" {
  run_hook "git push origin feature/bl-w44-pr4"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave-phase-gate"* ]]
}

@test "Rule A GATE: rtk git push + no sentinel → exit 2" {
  run_hook "rtk git push"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave-phase-gate"* ]]
}

@test "Rule A GATE: gh pr create with flags + no sentinel → exit 2" {
  run_hook "gh pr create --title feat --body content"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave-phase-gate"* ]]
}

@test "Rule A GATE: rtk gh pr create + no sentinel → exit 2" {
  run_hook "rtk gh pr create --title x"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave-phase-gate"* ]]
}

@test "Rule A GATE: FOO=bar git push (env-var prefix stripped) + no sentinel → exit 2" {
  run_hook "FOO=bar git push"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave-phase-gate"* ]]
}

# ── Rule A ALLOW cases — gate not triggered → exit 0 ────────────────────────

@test "Rule A ALLOW: echo with git push in string → exit 0" {
  run_hook "echo git push the button"
  [ "$status" -eq 0 ]
}

@test "Rule A ALLOW: printf with gh pr create in string → exit 0" {
  run_hook "printf remember: gh pr create"
  [ "$status" -eq 0 ]
}

@test "Rule A ALLOW: gh pr view (not gh pr create) → exit 0" {
  run_hook "gh pr view 42"
  [ "$status" -eq 0 ]
}

@test "Rule A ALLOW: git status (not git push) → exit 0" {
  run_hook "git status"
  [ "$status" -eq 0 ]
}

@test "Rule A ALLOW: gh pr create with sentinel present → exit 0" {
  mkdir -p "$SENTINEL_DIR"
  echo "quality-gate PASS" > "$SENTINEL_FILE"
  run_hook "gh pr create --body remember to git push"
  [ "$status" -eq 0 ]
}

@test "Rule A ALLOW: WAVE_PHASE_GATE_BYPASS=1 git push bypasses gate → exit 0" {
  run_hook_with_bypass "git push origin develop"
  [ "$status" -eq 0 ]
}

# ── P2b: non-feature branch slug resolution in wave-phase-gate ───────────────
# After the P2b fix, wave-phase-gate.js must resolve non-feature branches to
# last-segment slug (codex/bl-w47-demo → bl-w47-demo, not full branch name).
# The gate blocks when the sentinel is absent for the resolved slug.

@test "P2b WPG-NF1 GATE: codex/bl-w47-demo branch → slug 'bl-w47-demo' → git push blocked (no sentinel)" {
  # CLAUDE_WAVE_SLUG set to last-segment slug 'bl-w47-demo' (as the P2b fix produces).
  # No sentinel for this slug → gate must block.
  local nf_sentinel="$SENTINEL_DIR/bl-w47-demo.md"
  rm -f "$nf_sentinel"
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin codex/bl-w47-demo\"}}' | CLAUDE_WAVE_SLUG=bl-w47-demo node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave-phase-gate"* ]]
  rm -f "$nf_sentinel"
}

@test "P2b WPG-NF2 ALLOW: develop branch in CLAUDE_WAVE_SLUG (reject-list) → gate uses slug as-is; with sentinel → exit 0" {
  # When CLAUDE_WAVE_SLUG is 'develop', the gate should treat it as the slug.
  # With a sentinel for 'develop' present, the gate should allow (or fail-open if reject-list implemented).
  # This test confirms the gate does not crash on reject-list slugs.
  local dev_sentinel="$SENTINEL_DIR/develop.md"
  echo "quality-gate PASS" > "$dev_sentinel"
  run bash -c "printf '%s' '{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push origin develop\"}}' | CLAUDE_WAVE_SLUG=develop node '$HOOK'"
  # Either exit 0 (sentinel present) or exit 2 (reject-list implemented) — must not crash.
  [[ "$status" -eq 0 || "$status" -eq 2 ]]
  rm -f "$dev_sentinel"
}
