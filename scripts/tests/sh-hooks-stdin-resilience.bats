#!/usr/bin/env bats
#
# Verifies that all .sh PreToolUse hooks in .claude/hooks/ read stdin via
# bare `cat` (not `cat /dev/stdin`) and handle non-git-commit input without
# error — exit 0, stderr clean of "No such file" noise.
# BL-W42 PR4 Item 1.

HOOKS_DIR="$BATS_TEST_DIRNAME/../../.claude/hooks"

make_non_commit_input() {
  local out="$1"
  printf '%s\n' '{"tool_name":"Bash","tool_input":{"command":"echo hello"}}' > "$out"
}

run_hook_with_input() {
  local hook="$1" input_file="$2"
  run bash -c "cat '$input_file' | bash '$hook' 2>/tmp/bats-hook-stderr-$$"
  HOOK_STDERR=$(cat /tmp/bats-hook-stderr-$$ 2>/dev/null || true)
  rm -f /tmp/bats-hook-stderr-$$
}

@test "compile-fail-pre-commit: exits 0 on non-commit input, no /dev/stdin noise" {
  local inp="${BATS_TEST_TMPDIR:-/tmp}/stdin-test-compile-$$.json"
  make_non_commit_input "$inp"
  run_hook_with_input "$HOOKS_DIR/compile-fail-pre-commit.sh" "$inp"
  [ "$status" -eq 0 ]
  [[ "$HOOK_STDERR" != *"/dev/stdin"* ]]
}

@test "detekt-post-write: exits 0 on non-kotlin-file input, no /dev/stdin noise" {
  local inp="${BATS_TEST_TMPDIR:-/tmp}/stdin-test-detekt-post-$$.json"
  printf '%s\n' '{"tool_name":"Write","tool_input":{"file_path":"foo.md"}}' > "$inp"
  run_hook_with_input "$HOOKS_DIR/detekt-post-write.sh" "$inp"
  [ "$status" -eq 0 ]
  [[ "$HOOK_STDERR" != *"/dev/stdin"* ]]
}

@test "detekt-pre-commit: exits 0 on non-commit input, no /dev/stdin noise" {
  local inp="${BATS_TEST_TMPDIR:-/tmp}/stdin-test-detekt-pre-$$.json"
  make_non_commit_input "$inp"
  run_hook_with_input "$HOOKS_DIR/detekt-pre-commit.sh" "$inp"
  [ "$status" -eq 0 ]
  [[ "$HOOK_STDERR" != *"/dev/stdin"* ]]
}

@test "quality-gate-pre-commit: exits 0 on non-commit input, no /dev/stdin noise" {
  local inp="${BATS_TEST_TMPDIR:-/tmp}/stdin-test-qg-$$.json"
  make_non_commit_input "$inp"
  run_hook_with_input "$HOOKS_DIR/quality-gate-pre-commit.sh" "$inp"
  [ "$status" -eq 0 ]
  [[ "$HOOK_STDERR" != *"/dev/stdin"* ]]
}

@test "readme-pre-commit: exits 0 on non-commit input, no /dev/stdin noise" {
  local inp="${BATS_TEST_TMPDIR:-/tmp}/stdin-test-readme-$$.json"
  make_non_commit_input "$inp"
  run_hook_with_input "$HOOKS_DIR/readme-pre-commit.sh" "$inp"
  [ "$status" -eq 0 ]
  [[ "$HOOK_STDERR" != *"/dev/stdin"* ]]
}

@test "registry-pre-commit: exits 0 on non-commit input, no /dev/stdin noise" {
  local inp="${BATS_TEST_TMPDIR:-/tmp}/stdin-test-registry-$$.json"
  make_non_commit_input "$inp"
  run_hook_with_input "$HOOKS_DIR/registry-pre-commit.sh" "$inp"
  [ "$status" -eq 0 ]
  [[ "$HOOK_STDERR" != *"/dev/stdin"* ]]
}
