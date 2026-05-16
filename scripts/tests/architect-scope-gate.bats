#!/usr/bin/env bats
# Tests for .claude/hooks/architect-scope-gate.js (F1 — BL-W47-prep-4)
# Modeled on scripts/tests/pre-commit-hook.bats.
#
# Agent identity is passed via stdin JSON `data.agent_type` field.
# Scope is read from PROJECT_ROOT/.planning/PLAN.md.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/architect-scope-gate.js"

setup() {
  WORK_DIR="$(mktemp -d)"
  mkdir -p "$WORK_DIR/.planning"
  # PLAN.md with one authorized file in scope
  cat > "$WORK_DIR/.planning/PLAN.md" <<'EOF'
## Scope Files

- `.claude/hooks/architect-scope-gate.js`
- `.claude/wave-quality-gates/arch-platform-verdict.md`
EOF
}

teardown() {
  rm -rf "$WORK_DIR"
}

# ── Case A: non-arch agent Write + any path → exit 0 (hook only gates arch-*) ──

@test "A: non-arch agent (toolkit-specialist) Write on any path → allow (exit 0)" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".claude/hooks/architect-scope-gate.js\"},\"agent_type\":\"toolkit-specialist\"}' | PROJECT_ROOT='$WORK_DIR' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case B: arch-platform + Write + file_path in scope → exit 0 (allow) ─────────

@test "B: arch-platform Write with file_path in PLAN.md scope → allow (exit 0)" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".claude/hooks/architect-scope-gate.js\"},\"agent_type\":\"arch-platform\"}' | PROJECT_ROOT='$WORK_DIR' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case C: arch-platform + Write + verdict-exempt path (BL-W35-06) → exit 0 ───
# Verdict files are listed in PLAN.md scope so the gate allows them.

@test "C: arch-platform Write to own verdict file (in scope) → allow (exit 0)" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\".claude/wave-quality-gates/arch-platform-verdict.md\"},\"agent_type\":\"arch-platform\"}' | PROJECT_ROOT='$WORK_DIR' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# ── Case D: arch-platform + Write + file_path NOT in scope → exit 2 (block) ────

@test "D: arch-platform Write with file_path not in PLAN.md scope → block (exit 2)" {
  run bash -c "echo '{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"docs/agents/some-other-doc.md\"},\"agent_type\":\"arch-platform\"}' | PROJECT_ROOT='$WORK_DIR' node '$HOOK'"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision":"block"'* ]]
}
