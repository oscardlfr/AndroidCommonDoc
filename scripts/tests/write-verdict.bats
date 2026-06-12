#!/usr/bin/env bats
#
# Tests for scripts/sh/write-verdict.sh (BL-W47-hook-surgery).
# RED-FIRST: all cases must reflect the canonical contract of write-verdict.sh.
#
# Infra: fixture-driven (real temp wave dirs, no mock framework).
# setup()/teardown() manage a temp wave dir.  The script uses git rev-parse to
# find the repo root, so we initialise a throwaway git repo inside
# $BATS_TEST_TMPDIR and cd there before every script invocation so that
# git resolves to the tmpdir rather than the live repo.
#
# Invocation: bats scripts/tests/write-verdict.bats  (from repo root)

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/sh/write-verdict.sh"
WAVE_SLUG="bl-w47-hook-surgery-test"

setup() {
  # Initialise a throwaway git repo so git rev-parse --show-toplevel
  # resolves to the tmpdir tree, not the live repo.
  git -C "$BATS_TEST_TMPDIR" init -q 2>/dev/null

  # Derive the canonical root path the way the script will (Windows form on msys).
  REPO_ROOT="$(git -C "$BATS_TEST_TMPDIR" rev-parse --show-toplevel 2>/dev/null \
                 || echo "$BATS_TEST_TMPDIR")"

  WAVE_DIR="$REPO_ROOT/.planning/wave-$WAVE_SLUG"
  mkdir -p "$WAVE_DIR"

  export CLAUDE_WAVE_SLUG="$WAVE_SLUG"
  # Clear any ambient GIT_DIR so the script picks up the tmpdir git via CWD.
  unset GIT_DIR GIT_WORK_TREE
}

teardown() {
  rm -rf "$BATS_TEST_TMPDIR/.planning" "$BATS_TEST_TMPDIR/.git"
  unset CLAUDE_WAVE_SLUG
}

# Invoke the script from the tmpdir so git rev-parse resolves there.
run_script() {
  run bash -c "cd '$BATS_TEST_TMPDIR' && bash '$SCRIPT' $*"
}

# ── Invalid-role guard ────────────────────────────────────────────────────────

@test "invalid role exits 2" {
  run_script --role arch-bogus --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Invalid role"* ]]
}

# ── Anti-traversal guard ──────────────────────────────────────────────────────

@test "slug with .. traversal exits 2" {
  run_script --role arch-testing --phase prep --slug "../evil"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Traversal"* ]]
}

@test "slug with slash traversal exits 2" {
  run_script --role arch-testing --phase prep --slug "foo/bar"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Traversal"* ]]
}

# ── Duplicate prep guard ──────────────────────────────────────────────────────

@test "duplicate prep exits 2 when verdict file already exists" {
  # Pre-create the verdict file to simulate a previous prep run.
  printf '**Status**: APPROVED-PREP\n' > "$WAVE_DIR/arch-testing-verdict.md"
  run_script --role arch-testing --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"already exists"* ]]
}

# ── verify-final without prior prep ──────────────────────────────────────────

@test "verify-final without prep file exits 2" {
  rm -f "$WAVE_DIR/arch-testing-verdict.md"
  run_script --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"No prep verdict found"* ]]
}

# ── Dual-token replay guard (verify-final) ────────────────────────────────────

@test "verify-final with both tokens already present exits 2" {
  # Simulate a verdict file that already went through both phases.
  printf '**Status**: APPROVED-PREP\n**Status**: APPROVED-FINAL\n' \
    > "$WAVE_DIR/arch-testing-verdict.md"
  run_script --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 2 ]
  [[ "$output" == *"dual-token"* ]]
}

# ── verify-final appends APPROVED-FINAL ───────────────────────────────────────

@test "verify-final appends APPROVED-FINAL block to existing prep file" {
  # Lay down a prep-only verdict.
  printf '**Status**: APPROVED-PREP\n' > "$WAVE_DIR/arch-testing-verdict.md"

  run_script --role arch-testing --phase verify-final --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  local content
  content="$(cat "$WAVE_DIR/arch-testing-verdict.md")"
  [[ "$content" == *"APPROVED-FINAL"* ]]
  [[ "$content" == *"APPROVED-PREP"* ]]
}

# ── Legacy heredoc dual-token WARN path ───────────────────────────────────────

@test "legacy heredoc dual-token: APPROVED-FINAL without APPROVED-PREP emits WARN on stderr and exits 0" {
  # Simulate a legacy heredoc write: APPROVED-FINAL present but no APPROVED-PREP.
  printf '**Status**: APPROVED-FINAL\n' > "$WAVE_DIR/arch-platform-verdict.md"

  run_script --role arch-platform --phase verify-final --slug "$WAVE_SLUG"
  # Script must not block.
  [ "$status" -eq 0 ]
  # WARN must appear (bats captures both stdout and stderr in $output).
  [[ "$output" == *"WARN"* ]]
  [[ "$output" == *"legacy heredoc"* ]]
}

# ── Happy-path prep ───────────────────────────────────────────────────────────

@test "prep creates verdict file with APPROVED-PREP header" {
  rm -f "$WAVE_DIR/arch-integration-verdict.md"

  run_script --role arch-integration --phase prep --slug "$WAVE_SLUG"
  [ "$status" -eq 0 ]

  [ -f "$WAVE_DIR/arch-integration-verdict.md" ]
  [[ "$(cat "$WAVE_DIR/arch-integration-verdict.md")" == *"APPROVED-PREP"* ]]
}
