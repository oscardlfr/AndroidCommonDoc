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
# D-3 (BL-W47 ex-PR4): active wave requires PLAN.md + Spawn Table before specialists
# execute. Pre-existing cases inherit a valid PLAN.md from setup(). Tests that need
# to exercise the missing-PLAN.md (ST-5) or missing-Spawn-Table (ST-1) boundaries
# override this by rm -f or write_plan_without_spawn_table in their own body.
setup() {
  WAVE_DIR="$BATS_TEST_TMPDIR/planning/wave-bl-w43"
  mkdir -p "$WAVE_DIR"
  export CLAUDE_PROJECT_DIR="$BATS_TEST_TMPDIR"
  export CLAUDE_WAVE_SLUG="bl-w43"
  export WAVE_PREP_BYPASS=''
  # write_plan_with_spawn_table is defined later in this file; bats loads the whole
  # file before running any test, so the forward-reference is safe.
  write_plan_with_spawn_table
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

# Case 10 PASS: arch-integration-verdict.md with APPROVED-PREP unblocks specialist (BL-W47-prep-2)
@test "Case 10: allows specialist Write when arch-integration-verdict.md contains APPROVED-PREP" {
  printf 'STATUS: APPROVED-PREP\n' > "$WAVE_DIR/arch-integration-verdict.md"
  make_input "Write" "docs/new-doc.md" "toolkit-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# Case 11 PASS: arch-testing-verdict.md with APPROVED-PREP unblocks specialist (BL-W47-prep-2)
@test "Case 11: allows specialist Write when arch-testing-verdict.md contains APPROVED-PREP" {
  printf 'STATUS: APPROVED-PREP\n' > "$WAVE_DIR/arch-testing-verdict.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

# ── Identity-tolerance: suffix-rotation + free-name (BL-W47 OQ3) ─────────────
# SUBJECT_TYPES uses startsWith — suffix-rotated peers (e.g. test-specialist-2)
# must be caught the same as the canonical name.

@test "IT-1 BLOCK: suffix-rotated specialist (test-specialist-2) blocked without APPROVED-PREP" {
  # No verdict file — test-specialist-2 startsWith test-specialist → subject → BLOCK
  make_input "Write" "docs/new-doc.md" "test-specialist-2"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

@test "IT-2 BLOCK: suffix-rotated specialist (toolkit-specialist-2) blocked without APPROVED-PREP" {
  make_input "Write" "docs/new-doc.md" "toolkit-specialist-2"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

@test "IT-3 PASS: free-name agent (free-agent) allowed without verdict (not a subject type)" {
  # free-agent does not startWith any SUBJECT_TYPE — not gated, exits 0
  make_input "Write" "docs/new-doc.md" "free-agent"
  run_hook
  [ "$status" -eq 0 ]
}

@test "IT-4 PASS: suffix-rotated specialist unblocked when APPROVED-PREP verdict exists" {
  printf 'STATUS: APPROVED-PREP\n' > "$WAVE_DIR/arch-testing-verdict.md"
  make_input "Write" "docs/new-doc.md" "test-specialist-2"
  run_hook
  [ "$status" -eq 0 ]
}

# ── P1c: block channel — block JSON must appear on STDOUT not stderr ──────────
# Codex repro (P1c): premature-execution-gate.js at line 142 uses process.stderr.write(...)
# for the block JSON. All 3 sibling gates use process.stdout. After the fix, the
# structured block decision must be on stdout so the harness can read it.
#
# Test strategy: redirect stderr to /dev/null; assert structured JSON is on stdout.
# RED before fix: stdout is empty (JSON goes to stderr, lost after redirect).
# GREEN after fix: JSON block decision is on stdout.

@test "P1c BLOCK: specialist + active wave + no APPROVED-PREP emits block JSON on stdout (not stderr)" {
  # No verdict file — gate must block. Redirect stderr to /dev/null to prove
  # the block JSON is on stdout, not leaking through stderr.
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 2 ]
  # The block decision JSON must be present on stdout (captured in $output by bats).
  [[ "$output" == *'"decision"'* ]]
  [[ "$output" == *'"block"'* ]]
}

# ── P2b: non-feature branch slug resolution for premature-execution-gate ──────
# Per PLAN Step 10: each resolver file gets a non-feature branch case.
# Setup: switch CLAUDE_WAVE_SLUG to a non-feature-prefixed slug (last-segment only).

@test "P2b PEG-SLUG: codex/bl-w47-demo branch → slug 'bl-w47-demo' + active wave dir detected" {
  # After the P2b fix, premature-execution-gate must resolve 'codex/bl-w47-demo' to
  # last-segment slug 'bl-w47-demo'. Create a wave dir for that slug and confirm the gate
  # detects the active wave (which means slug resolution worked).
  local non_feature_slug="bl-w47-demo"
  local non_feature_wave_dir="$BATS_TEST_TMPDIR/planning/wave-$non_feature_slug"
  mkdir -p "$non_feature_wave_dir"
  # D-3: wave dir needs PLAN.md + Spawn Table so the gate reaches the APPROVED-PREP check.
  cat > "$non_feature_wave_dir/PLAN.md" <<'PLANEOF'
### Spawn Table
| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | test |
PLANEOF
  # No verdict → gate must BLOCK on APPROVED-PREP (proves slug resolved + wave found).
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='$non_feature_slug' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

# ── B: env reject-list for CLAUDE_WAVE_SLUG (CodeRabbit #3) ──────────────────
# After the fix, the 3 JS resolvers must apply the reject-list to CLAUDE_WAVE_SLUG too.
# When CLAUDE_WAVE_SLUG is 'develop' or 'master', the gate must skip/fail-open.
# RED now: env slug returned unvalidated → gate looks for wave-develop/ → not found
# → fails open (exit 0). GREEN after fix confirms the SAME behaviour, but via explicit
# reject-list path rather than accidental miss. Both before and after the fix the exit
# is 0 — the test validates that the gate does NOT incorrectly block.

@test "B PEG-ENV-REJECT-develop: CLAUDE_WAVE_SLUG=develop → gate fails open (no block)" {
  # develop is a reject-list slug — gate must skip/fail-open regardless of wave dirs.
  # Create a wave-develop dir to confirm the gate is NOT finding it and blocking.
  local dev_wave_dir="$BATS_TEST_TMPDIR/planning/wave-develop"
  mkdir -p "$dev_wave_dir"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_PROJECT_DIR='$BATS_TEST_TMPDIR' CLAUDE_WAVE_SLUG='develop' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
}

@test "B PEG-ENV-REJECT-master: CLAUDE_WAVE_SLUG=master → gate fails open (no block)" {
  # master is a reject-list slug — same behaviour as develop.
  local master_wave_dir="$BATS_TEST_TMPDIR/planning/wave-master"
  mkdir -p "$master_wave_dir"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_PROJECT_DIR='$BATS_TEST_TMPDIR' CLAUDE_WAVE_SLUG='master' node '$HOOK' 2>/dev/null"
  [ "$status" -eq 0 ]
}

# ── C: branch path (no env) for premature-execution-gate (CodeRabbit #4) ──────
# Drive slug resolution via git branch (no CLAUDE_WAVE_SLUG), mirroring the
# subagent-start F1/C1 model. Creates an isolated git repo on codex/ branch.
# BEFORE fix: gate returns full branch 'codex/bl-w47-demo' as slug →
#   wave dir is 'wave-codex/bl-w47-demo' (invalid path or not found) → fails open.
# AFTER fix: slug = 'bl-w47-demo' → wave-bl-w47-demo/ found → no verdict → exit 2.

@test "C PEG-BRANCH-PATH: codex/bl-w47-demo branch (no env) → gate detects wave via branch → exit 2" {
  # Isolated git repo — never reads live .git.
  local proj
  proj="$(mktemp -d)"
  git -C "$proj" init -q 2>/dev/null
  git -C "$proj" config user.email "bats@test.local"
  git -C "$proj" config user.name "Bats Test"
  git -C "$proj" commit --allow-empty -q -m "init"
  git -C "$proj" checkout -b "codex/bl-w47-demo" -q 2>/dev/null
  # Create wave dir for the CORRECT last-segment slug.
  mkdir -p "$proj/.planning/wave-bl-w47-demo"
  # D-3: wave dir needs PLAN.md + Spawn Table so the gate reaches the APPROVED-PREP check.
  cat > "$proj/.planning/wave-bl-w47-demo/PLAN.md" <<'PLANEOF'
### Spawn Table
| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | test |
PLANEOF
  # Explicitly clear CLAUDE_WAVE_SLUG so setup()'s export doesn't leak into the subprocess
  # and bypass branch parsing (the env-bypass class of bug — S4 lesson).
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' CLAUDE_WAVE_SLUG='' CLAUDE_PROJECT_DIR='$proj' node '$HOOK' 2>/dev/null"
  rm -rf "$proj"
  # BEFORE fix: exits 0 (wave dir not found due to full-branch slug). RED.
  # AFTER fix: exits 2 (no verdict → gate blocks).
  [ "$status" -eq 2 ]
  [[ "$output" == *"APPROVED-PREP"* ]]
}

@test "B PEG-SLUG-TRAVERSAL: CLAUDE_WAVE_SLUG=../evil — robustness check (no crash, fail-open via isValidSlug rejection)" {
  # Robustness: invalid slug (contains /) → isValidSlug rejects → getWaveSlug returns null
  # → no waveDir resolved → fail-open (exit 0, no block decision).
  # Non-vacuity for isValidSlug is proven at the bash layer (SRM-TRAVERSAL asserts
  # wave-slug.sh outputs empty for ../evil vs a valid slug). isValidSlug in JS mirrors
  # the same allowlist; arch-platform confirmed all 3 getWaveSlug return points are guarded.
  make_input "Write" "docs/x.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | CLAUDE_WAVE_SLUG='../evil' WAVE_PREP_BYPASS='' node '$HOOK'"
  [ "$status" -eq 0 ]
  [[ "$output" != *'"decision"'* ]]
}

# ── D-3 Spawn-Table check (BL-W47 ex-PR4) ────────────────────────────────────
#
# After Decision 3 (CORRECTED fail-open boundary): when waveDir is confirmed +
# tool is by a SUBJECT_TYPES role, PLAN.md must exist AND contain ### Spawn Table.
# Missing waveDir still fails open (exit 0). Missing PLAN.md or missing Spawn Table
# in PLAN.md → exit 2 (BLOCK). SKIP_SPAWN_TABLE=1 is the escape hatch.
#
# These cases use the existing setup() wave dir (WAVE_DIR=$BATS_TEST_TMPDIR/planning/wave-bl-w43)
# and write PLAN.md into it via the helpers below (Option a — simpler, no slug override needed).

write_plan_with_spawn_table() {
  cat > "$WAVE_DIR/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Path-Manifest

- scripts/sh/pre-commit-hook.sh

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-platform | 1 | hook surgery |
| test-specialist | 1 | bats tests |
PLANEOF
}

write_plan_without_spawn_table() {
  cat > "$WAVE_DIR/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Path-Manifest

- scripts/sh/pre-commit-hook.sh

(no Spawn Table section)
PLANEOF
}

@test "ST-1 BLOCK: active wave + specialist Write + PLAN.md missing Spawn Table → exit 2" {
  write_plan_without_spawn_table
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"Spawn Table"* ]]
}

@test "ST-2 PASS: active wave + specialist Write + PLAN.md has Spawn Table + APPROVED-PREP → exit 0" {
  write_plan_with_spawn_table
  printf 'STATUS: APPROVED-PREP\n' > "$WAVE_DIR/arch-testing-verdict.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "ST-3 PASS: no wave dir → fail-open exit 0 (fail-open preserved, regression guard)" {
  # CRITICAL: rm -rf the wave dir created by setup() so the hook sees no active wave.
  # Without this, the hook finds waveDir present but no PLAN.md → falls into ST-5's
  # BLOCK path. The rm is load-bearing for this fail-open regression guard.
  rm -rf "$WAVE_DIR"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 0 ]
}

@test "ST-4 PASS: SKIP_SPAWN_TABLE=1 + PLAN.md missing Spawn Table → exit 0 (escape hatch)" {
  write_plan_without_spawn_table
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' SKIP_SPAWN_TABLE=1 node '$HOOK'"
  [ "$status" -eq 0 ]
}

@test "ST-5 BLOCK: wave dir exists + no PLAN.md + specialist Write → exit 2 (old fail-open closed)" {
  # setup() now writes PLAN.md; remove it so the wave dir exists but has no PLAN.md.
  # rm -f (not rm -rf) keeps the wave dir — that's what distinguishes ST-5 from ST-3.
  # Decision 3 CORRECTED: confirmed waveDir + no PLAN.md → BLOCK (not fail-open).
  rm -f "$WAVE_DIR/PLAN.md"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run_hook
  [ "$status" -eq 2 ]
  [[ "$output" == *"PLAN.md"* ]]
}

# Helper path for .codex mirror (used by codex-identity check below)
HOOK_CODEX="$BATS_TEST_DIRNAME/../../.codex/hooks/premature-execution-gate.js"

@test "CODEX-1: .codex mirror produces identical exit behavior to canonical (post-sync parity)" {
  # Run the .codex copy against the same scenario as Case 1 (specialist Write + no APPROVED-PREP → block).
  # After D-3 full re-sync, both copies must exit 2 with block JSON on stdout.
  # RED before sync (if .codex still has process.stderr.write): stdout will be empty, test fails.
  # GREEN after sync: .codex exits 2 with block JSON on stdout, identical to canonical.
  # .codex/ is gitignored — skip on CI where the mirror is absent.
  [ -f "$HOOK_CODEX" ] || skip ".codex mirror not present (gitignored)"
  make_input "Write" "docs/new-doc.md" "test-specialist"
  run bash -c "cat '$INPUT_FILE' | WAVE_PREP_BYPASS='' node '$HOOK_CODEX' 2>/dev/null"
  [ "$status" -eq 2 ]
  [[ "$output" == *'"decision"'* ]]
  [[ "$output" == *'"block"'* ]]
}
