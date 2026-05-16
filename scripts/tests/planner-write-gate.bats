#!/usr/bin/env bats
# Tests for .claude/hooks/plan-md-write-gate.js (G2 — BL-W-B-bis; F2 sentinel — BL-W47-prep-3)
# Modeled on scripts/tests/plan-mode-spawn-planner.bats.
#
# Agent identity is passed via stdin JSON `data.agent_type` field (NOT CLAUDE_AGENT_NAME).

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/plan-md-write-gate.js"

# Defense-in-depth: remove any leaked sentinels from the repo's wave-quality-gates dir
teardown_file() {
  rm -f "$BATS_TEST_DIRNAME/../../.claude/wave-quality-gates/foo.md"
  rm -f "$BATS_TEST_DIRNAME/../../.claude/wave-quality-gates"/wave-test*.md
}

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
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-foo/PLAN.md\"},\"agent_type\":\"planner\"}' | CLAUDE_PROJECT_DIR='$tmp_dir' node '$HOOK'"
  [ "$status" -eq 0 ]
  rm -rf "$tmp_dir"
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

# ── F2 Sentinel cases (BL-W47-prep-3) ────────────────────────────────────────

@test "F2: planner Write on PLAN.md creates wave-quality-gates sentinel" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  mkdir -p "$tmp_dir/.claude/wave-quality-gates"
  local sentinel="$tmp_dir/.claude/wave-quality-gates/wave-test-slug.md"
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-wave-test-slug/PLAN.md\"},\"agent_type\":\"planner\"}' | CLAUDE_PROJECT_DIR='$tmp_dir' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ -f "$sentinel" ]
  [[ "$(cat $sentinel)" == *'Wave Quality Gate: wave-test-slug'* ]]
  [[ "$(cat $sentinel)" == *'PASS (stub'* ]]
  rm -rf "$tmp_dir"
}

@test "F2: sentinel NOT created for non-planner Write (block path)" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  mkdir -p "$tmp_dir/.claude/wave-quality-gates"
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-wave-test-slug/PLAN.md\"},\"agent_type\":\"team-lead\"}' | CLAUDE_PROJECT_DIR='$tmp_dir' node '$HOOK'"
  [ "$status" -eq 2 ]
  [ ! -f "$tmp_dir/.claude/wave-quality-gates/wave-test-slug.md" ]
  rm -rf "$tmp_dir"
}

@test "F2: sentinel NOT created if it already exists (idempotent)" {
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  mkdir -p "$tmp_dir/.claude/wave-quality-gates"
  local sentinel="$tmp_dir/.claude/wave-quality-gates/wave-test-slug.md"
  echo "existing content" > "$sentinel"
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".planning/wave-wave-test-slug/PLAN.md\"},\"agent_type\":\"planner\"}' | CLAUDE_PROJECT_DIR='$tmp_dir' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$(cat $sentinel)" == "existing content" ]]
  rm -rf "$tmp_dir"
}

# ── F3 Absolute-path normalization cases (BL-W47-prep-4) ─────────────────────

@test "F3-E: planner Write with ABSOLUTE path to PLAN.md → allow (exit 0) + sentinel created" {
  local tmp_dir win_dir abs_path sentinel
  tmp_dir="$(mktemp -d)"
  # cygpath -m gives forward-slash Windows paths so Node and bash agree on the dir
  win_dir="$(cygpath -m "$tmp_dir" 2>/dev/null || echo "$tmp_dir")"
  mkdir -p "$tmp_dir/.claude/wave-quality-gates"
  abs_path="${win_dir}/.planning/wave-abs-test/PLAN.md"
  sentinel="$tmp_dir/.claude/wave-quality-gates/abs-test.md"
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"'\"$abs_path\"'\"},\"agent_type\":\"planner\"}' | CLAUDE_PROJECT_DIR='$win_dir' node '$HOOK'"
  [ "$status" -eq 0 ]
  [ -f "$sentinel" ]
  [[ "$(cat "$sentinel")" == *'Wave Quality Gate: abs-test'* ]]
  rm -rf "$tmp_dir"
}

@test "F3-F: non-planner Write with ABSOLUTE path to PLAN.md → block (exit 2)" {
  local tmp_dir win_dir abs_path
  tmp_dir="$(mktemp -d)"
  win_dir="$(cygpath -m "$tmp_dir" 2>/dev/null || echo "$tmp_dir")"
  abs_path="${win_dir}/.planning/wave-abs-test/PLAN.md"
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"'\"$abs_path\"'\"},\"agent_type\":\"team-lead\"}' | CLAUDE_PROJECT_DIR='$win_dir' node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
  rm -rf "$tmp_dir"
}
