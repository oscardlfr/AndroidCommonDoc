#!/usr/bin/env bats
#
# Tests for .claude/hooks/premature-execution-gate.js (BL-W43 W43-03).
# RED-FIRST: hook does not exist yet; all cases must FAIL on first run.
# Spec: .planning/wave-bl-w43/pr3-arch-platform-verdict.md Decision 8.
#
# Infra: fixture-driven (real temp wave dirs, no mock framework).
# setup()/teardown() manage a temp wave dir for wave detection.

HOOK="$BATS_TEST_DIRNAME/../../.claude/hooks/premature-execution-gate.js"
INPUT_FILE="${BATS_TEST_TMPDIR}/premature-exec-input-$$.json"

# setup() creates a temp .planning/wave-bl-w43/ dir to simulate an active wave.
# WAVE_PREP_BYPASS is explicitly cleared to prevent accidental bypass leaking.
setup() {
  WAVE_DIR="$BATS_TEST_TMPDIR/planning/wave-bl-w43"
  mkdir -p "$WAVE_DIR"
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR"
  export CLAUDE_WAVE_SLUG="bl-w43"
  export WAVE_PREP_BYPASS=''
}

teardown() {
  rm -rf "$BATS_TEST_TMPDIR/planning"
}

# Build a JSON envelope:
#   make_input <tool_name> <target> <agent_type>
# For Bash tools, target is the command string.
# For Write/Edit tools, target is the file_path string.
make_input() {
  local tool="$1" target="$2" agent="$3"
  python3 - "$tool" "$target" "$agent" "$INPUT_FILE" <<'PYEOF'
import json, sys
tool, target, agent, path = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
inp = {"command": target} if tool == "Bash" else {"file_path": target}
with open(path, "w", encoding="utf-8") as f:
    json.dump({"tool_name": tool, "tool_input": inp, "agent_type": agent}, f)
PYEOF
}

run_hook() {
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' node '$HOOK'"
}

# ── BLOCK scenarios ─────────────────────────────────────────────────────────

# Case 1 BLOCK: specialist Write + active wave + no APPROVED-PREP -> exit 2
@test "Case 1: blocks specialist Write when active wave has no APPROVED-PREP verdict" {
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# Case 2 BLOCK: specialist Edit + active wave + no APPROVED-PREP -> exit 2
@test "Case 2: blocks specialist Edit when active wave has no APPROVED-PREP verdict" {
  make_input "Edit" "docs/existing-doc.md" "toolkit-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# Case 3 BLOCK: specialist Bash + active wave + no APPROVED-PREP -> exit 2
@test "Case 3: blocks specialist Bash when active wave has no APPROVED-PREP verdict" {
  make_input "Bash" "echo hello > docs/output.md" "doc-updater"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# ── PASS scenarios ──────────────────────────────────────────────────────────

# Case 4 PASS: specialist Write + APPROVED-PREP present -> exit 0
@test "Case 4: allows specialist Write when APPROVED-PREP verdict is present" {
  printf 'STATUS: APPROVED-PREP\n' > "$WAVE_DIR/pr3-arch-platform-verdict.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 5 PASS: arch-testing Write + active wave + no APPROVED-PREP (not subject) -> exit 0
@test "Case 5: allows arch-testing Write even without APPROVED-PREP (not in subject list)" {
  make_input "Write" "docs/new-doc.md" "arch-testing"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 6 PASS: WAVE_PREP_BYPASS=1 env set -> exit 0
@test "Case 6: allows specialist Write when WAVE_PREP_BYPASS=1 is set" {
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

# Case 7 PASS: [PREMATURE_EXEC_BYPASS] inline in Bash command -> exit 0
@test "Case 7: allows specialist Bash when [PREMATURE_EXEC_BYPASS] inline token present" {
  make_input "Bash" "[PREMATURE_EXEC_BYPASS] echo hello" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 8 PASS: no active wave detected (CLAUDE_WAVE_SLUG unset, no branch match), fail-open -> exit 0
@test "Case 8: allows specialist Write when no active wave detected, fail-open" {
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='' node '$HOOK'"
  [ "$status" -eq 0 ]
}

# Case 9 PASS: no verdict file at all (wave dir empty), fail-open -> exit 0
# (Wave dir exists but has no verdict file — distinct from Case 1 which relies on block logic.
#  This case verifies the scanner returns 0 when the dir is entirely absent of verdict files,
#  but wait — Case 1 also has no verdict file and must BLOCK. The distinction: Case 9 tests
#  the scenario where the .planning/wave-{slug}/ directory itself does not exist, so the
#  hook cannot confirm an active wave, and therefore fails open.)
@test "Case 9: allows specialist Write when wave plan dir does not exist, fail-open" {
  rm -rf "$WAVE_DIR"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}
