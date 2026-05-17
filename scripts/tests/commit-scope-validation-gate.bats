#!/usr/bin/env bats
#
# Tests for .claude/hooks/commit-scope-validation-gate.js (F3 BL-W47-prep-8).
# Verifies commit scope validation against .commitlintrc.json.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/commit-scope-validation-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR:-/tmp}/commit-scope-gate-input-$$.json"
CONFIG_FILE="${BATS_TEST_TMPDIR:-/tmp}/commitlintrc-$$.json"

setup() {
  export COMMIT_SCOPE_BYPASS=1
  # Write a test .commitlintrc.json in a temp dir; hook reads from CLAUDE_PROJECT_DIR
  mkdir -p "${BATS_TEST_TMPDIR}"
  echo '{"valid_scopes":["core","data","ui","mcp","tools","ci","docs","scripts","agents"]}' \
    > "$CONFIG_FILE"
  export CLAUDE_PROJECT_DIR="${BATS_TEST_TMPDIR}"
  cp "$CONFIG_FILE" "${BATS_TEST_TMPDIR}/.commitlintrc.json"
}

make_input() {
  local cmd="$1"
  python3 - "$cmd" "$INPUT_FILE" <<'PYEOF'
import json, sys
cmd, path = sys.argv[1], sys.argv[2]
with open(path, "w", encoding="utf-8") as f:
    json.dump({"tool_name": "Bash", "tool_input": {"command": cmd}}, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | COMMIT_SCOPE_BYPASS='' CLAUDE_PROJECT_DIR='${BATS_TEST_TMPDIR}' node '$HOOK'"
}

# ── BLOCK cases ───────────────────────────────────────────────────────────────

@test "BLOCK: invalid scope 'invalid'" {
  make_input "git commit -m 'feat(invalid): add something'"
  run_hook
  [ "$status" -eq 2 ]
}

@test "BLOCK: scope 'hooks' not in valid_scopes" {
  make_input "git commit -m 'chore(hooks): test commit'"
  run_hook
  [ "$status" -eq 2 ]
}

@test "BLOCK: scope 'cli' not in valid_scopes" {
  make_input "git commit -m 'chore(cli): test commit'"
  run_hook
  [ "$status" -eq 2 ]
}

# ── PASS cases ────────────────────────────────────────────────────────────────

@test "PASS: valid scope 'mcp'" {
  make_input "git commit -m 'chore(mcp): update mcp server'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: valid scope 'tools'" {
  make_input "git commit -m 'chore(tools): add new hook'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: compound scope 'core-error-sdk' matches first segment 'core'" {
  make_input "git commit -m 'feat(core-error-sdk): add typed exceptions'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: no scope in commit message (scopeless is optional)" {
  make_input "git commit -m 'chore: update README'"
  run_hook
  [ "$status" -eq 0 ]
}

@test "PASS: non-git-commit bash command is ignored" {
  make_input "echo hello world"
  run_hook
  [ "$status" -eq 0 ]
}

# ── BYPASS cases ──────────────────────────────────────────────────────────────

@test "BYPASS: COMMIT_SCOPE_BYPASS=1 env allows invalid scope" {
  make_input "git commit -m 'feat(invalid): should be bypassed'"
  run bash -c "cat '$INPUT_FILE' | COMMIT_SCOPE_BYPASS=1 CLAUDE_PROJECT_DIR='${BATS_TEST_TMPDIR}' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "BYPASS: [COMMIT_SCOPE_BYPASS] inline marker allows invalid scope" {
  make_input "git commit -m 'feat(invalid): test' # [COMMIT_SCOPE_BYPASS]"
  run_hook
  [ "$status" -eq 0 ]
}

# ── FAIL-OPEN cases ───────────────────────────────────────────────────────────

@test "FAIL-OPEN: missing .commitlintrc.json allows all scopes" {
  make_input "git commit -m 'feat(anything): test'"
  run bash -c "cat '$INPUT_FILE' | COMMIT_SCOPE_BYPASS='' CLAUDE_PROJECT_DIR='/nonexistent/path' node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "FAIL-OPEN: interactive commit (no -m flag) is allowed" {
  make_input "git commit"
  run_hook
  [ "$status" -eq 0 ]
}
