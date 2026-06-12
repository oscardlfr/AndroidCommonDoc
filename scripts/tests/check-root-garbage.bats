#!/usr/bin/env bats
#
# Tests for scripts/sh/check-root-garbage.sh (BL-W47 PR-0b WS3).
# Verifies the script exits 1 (listing the offending entry) when Users* files
# exist in the target directory, and exits 0 when the directory is clean.

SCRIPT="$BATS_TEST_DIRNAME/../sh/check-root-garbage.sh"

setup() {
  TMPDIR_ROOT="$(mktemp -d)"
}

teardown() {
  rm -rf "$TMPDIR_ROOT"
}

@test "exits 1 and lists mangled Users* file" {
  touch "$TMPDIR_ROOT/Users-303-24645-mangled"
  run bash "$SCRIPT" "$TMPDIR_ROOT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Users-303-24645-mangled"* ]]
}

@test "exits 0 for a clean directory (no Users* entries)" {
  run bash "$SCRIPT" "$TMPDIR_ROOT"
  [ "$status" -eq 0 ]
}
