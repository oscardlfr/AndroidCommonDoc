#!/usr/bin/env bats
# Tests for .claude/hooks/kickoff-scope-validator.js (F1 — BL-W47-prep-19).
# Verifies that the hook fires a WARN when a *-kickoff.md file is written with
# invalid commitlint scopes, and stays silent on valid scope lists or non-kickoff files.
#
# PostToolUse Write hook — stdin JSON envelope:
#   { "tool_name": "Write", "tool_input": { "file_path": "...", "content": "..." } }
#
# Hook behaviour:
#   - Exit 0 always (WARN-only, never blocks)
#   - WARN on stderr + additionalContext JSON on stdout when *-kickoff.md contains invalid scopes
#   - WARN format: [kickoff-scope-validator] WARN: invalid commitlint scopes in <file>: <list>. Canonical scopes: <canonical>.
#   - Silent (no output) when all scopes are valid or file_path does not end with -kickoff.md

set -euo pipefail

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/kickoff-scope-validator.js"
PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."

run_hook_with_envelope() {
  local fpath="$1"
  local content="$2"
  # Build JSON envelope via Python so real newlines are preserved in the content field.
  local json
  json="$(python3 - "$fpath" <<PYEOF
import json, sys
fpath = sys.argv[1]
content = """$content"""
print(json.dumps({"tool_name": "Write", "tool_input": {"file_path": fpath, "content": content}}))
PYEOF
)"
  run bash -c "printf '%s' '$json' | CLAUDE_PROJECT_DIR='$PROJECT_ROOT' node '$HOOK'"
}

# ── Case 1: valid scope list → silent exit 0 ────────────────────────────────
# A kickoff whose scope line lists only canonical scopes produces no output.

@test "valid scope list in kickoff → silent exit 0" {
  run_hook_with_envelope ".planning/BL-W47-prep-19-kickoff.md" \
"# Wave kickoff

commitlint scopes válidos: core, data, ui, feature, ci, deps, release, docs, detekt, mcp, skills, scripts, agents, archive, di, guides, tests, tools
"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ── Case 2: prep-17/18 invalid triple → WARN ────────────────────────────────
# Reproduces the exact drift in prep-17 kickoff:159 and prep-18 kickoff:137.

@test "prep-17/18 triple invalid scopes (architecture, gradle, testing) → WARN" {
  run_hook_with_envelope ".planning/BL-W47-prep-17-kickoff.md" \
"# Wave kickoff

commitlint scopes válidos: architecture, gradle, testing
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[kickoff-scope-validator] WARN"* ]]
  [[ "$output" == *"architecture"* ]]
  [[ "$output" == *"gradle"* ]]
  [[ "$output" == *"testing"* ]]
}

# ── Case 3: partial invalid (core, data, architecture) → WARN names only invalid ──
# Valid scopes in the same line are fine; only invalid ones appear in the WARN.

@test "partial invalid scope list → WARN names only invalid scope" {
  run_hook_with_envelope ".planning/draft-kickoff.md" \
"# Wave kickoff

commitlint scopes válidos: core, data, architecture
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"[kickoff-scope-validator] WARN"* ]]
  [[ "$output" == *"architecture"* ]]
  [[ "$output" != *"\"core\""* ]]
  [[ "$output" != *"\"data\""* ]]
}

# ── Case 4: non-kickoff file (PLAN.md) → silent exit 0 ──────────────────────
# Writing a PLAN.md with invalid scope text does not trigger the hook.

@test "non-kickoff file (PLAN.md) with invalid scopes → silent exit 0" {
  run_hook_with_envelope ".planning/wave-foo/PLAN.md" \
"# Plan

architecture, gradle, testing mentioned here.
"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
