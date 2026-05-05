#!/usr/bin/env bats
#
# Tests for scripts/sh/before-after-delta.sh (FIND-07, BL-W42 PR5).
# Verifies the N=3 retry-on-fail discriminated classification logic.
#
# Exit code contract:
#   exit 0 = FLAKY (PASS 2/3) or CLEAN (PASS 3/3)
#   exit 1 = REGRESSION (FAIL 3/3)
#   exit 2 = SUSPICIOUS (PASS 1/3)

SCRIPT="$BATS_TEST_DIRNAME/../sh/before-after-delta.sh"

# Helper: creates a command that returns success (exit 0) or failure (exit 1)
# exactly N times out of 3 calls, using a counter file.
make_counter_cmd() {
  local pass_on="$1"  # space-separated list of attempt numbers that should PASS (1 2 3)
  local counter_file="${BATS_TEST_TMPDIR:-/tmp}/counter-$$-${RANDOM}.txt"
  echo "0" > "$counter_file"
  # Build the command inline using the counter file
  echo "bash -c 'c=\$(cat ${counter_file}); c=\$((c+1)); echo \$c > ${counter_file}; [[ \" ${pass_on} \" == *\" \$c \"* ]]'"
}

@test "FLAKY: PASS 2/3 exits 0 (pass on attempts 1 and 2)" {
  cmd=$(make_counter_cmd "1 2")
  run bash "$SCRIPT" $cmd
  [ "$status" -eq 0 ]
  [[ "$output" =~ "FLAKY" ]]
}

@test "REGRESSION: FAIL 3/3 exits 1" {
  cmd=$(make_counter_cmd "")
  run bash "$SCRIPT" $cmd
  [ "$status" -eq 1 ]
  [[ "$output" =~ "REGRESSION" ]]
}

@test "SUSPICIOUS: PASS 1/3 exits 2 (pass only on attempt 3)" {
  cmd=$(make_counter_cmd "3")
  run bash "$SCRIPT" $cmd
  [ "$status" -eq 2 ]
  [[ "$output" =~ "SUSPICIOUS" ]]
}
