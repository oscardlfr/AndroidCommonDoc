#!/usr/bin/env bats
# Tests for .claude/hooks/plan-md-write-gate.js (G2 — BL-W-B-bis)
# Modeled on scripts/tests/plan-mode-spawn-planner.bats.
#
# Agent identity is passed via stdin JSON `data.agent_type` field (NOT CLAUDE_AGENT_NAME).

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/plan-md-write-gate.js"

# ── Case 1: BLOCK — non-planner (team-lead) writes PLAN.md → exit 2 ─────────

@test "gate blocks team-lead Write on .planning/wave-*/PLAN.md" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-foo/PLAN.md\"},\"agent_type\":\"team-lead\"}' | node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

@test "gate blocks missing agent_type Write on .planning/wave-*/PLAN.md" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-foo/PLAN.md\"}}' | node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

# ── Case 2: ALLOW — planner writes PLAN.md → exit 0 ────────────────────────

@test "gate allows planner Write on .planning/wave-*/PLAN.md" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-foo/PLAN.md\"},\"agent_type\":\"planner\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case 3: ALLOW — Write on non-matching path → exit 0 ─────────────────────

@test "gate allows Write on non-.planning path" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"docs/agents/some-doc.md\"},\"agent_type\":\"team-lead\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case 4: ALLOW — Write on non-PLAN.md file in wave dir → exit 0 ──────────

@test "gate allows Write on .planning/wave-foo/OTHER.md (not PLAN.md)" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-foo/arch-testing-verdict.md\"},\"agent_type\":\"team-lead\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case 5: ALLOW — CLAUDE_SKIP_PLANNER=1 escape hatch → exit 0 ─────────────

@test "CLAUDE_SKIP_PLANNER=1 bypasses block for non-planner Write on PLAN.md" {
  run env CLAUDE_SKIP_PLANNER=1 bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-foo/PLAN.md\"},\"agent_type\":\"team-lead\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case 6: BLOCK — Edit (not Write) on PLAN.md by non-planner → exit 2 ─────

@test "gate blocks team-lead Edit on .planning/wave-*/PLAN.md" {
  run bash -c "echo '{\"tool_name\":\"Edit\",\"tool_input\":{\"file_path\":\".planning/wave-foo/PLAN.md\"},\"agent_type\":\"team-lead\"}' | node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}

# ── Case 7: ALLOW — unknown agent_type on non-matching path → exit 0 ─────────

@test "gate allows unknown agent_type on non-.planning path" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"scripts/tests/something.bats\"},\"agent_type\":\"unknown-agent\"}' | node '$HOOK'"
  [ "$status" -eq 0 ]
}
