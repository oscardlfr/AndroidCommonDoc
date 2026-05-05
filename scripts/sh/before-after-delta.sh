#!/usr/bin/env bash
# before-after-delta.sh — N=3 retry-on-fail discriminated test runner (FIND-07, BL-W42 PR5).
#
# Usage: before-after-delta.sh <test-command>
#
# Runs <test-command> up to 3 times and classifies the result:
#   PASS 2/3 -> FLAKY  (exit 0, log only, do NOT block)
#   FAIL 3/3 -> REGRESSION (exit 1, confirmed block)
#   PASS 1/3 -> SUSPICIOUS (exit 2, suspicious block)
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "[before-after-delta] ERROR: no test command provided." >&2
  echo "Usage: before-after-delta.sh <test-command>" >&2
  exit 1
fi

TEST_CMD="$*"
PASS_COUNT=0
FAIL_COUNT=0

run_once() {
  local attempt="$1"
  if eval "$TEST_CMD"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "[before-after-delta] Attempt $attempt: PASS" >&2
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "[before-after-delta] Attempt $attempt: FAIL" >&2
  fi
}

# Disable set -e for individual test runs (we capture exit code manually)
set +e
run_once 1
run_once 2
run_once 3
set -e

echo "[before-after-delta] Results: PASS=$PASS_COUNT FAIL=$FAIL_COUNT" >&2

if [ "$FAIL_COUNT" -eq 3 ]; then
  # FAIL 3/3 -> confirmed regression
  echo "[before-after-delta] REGRESSION: command failed all 3 attempts. BLOCKING." >&2
  exit 1
elif [ "$PASS_COUNT" -eq 2 ]; then
  # PASS 2/3 -> flaky, do not block
  echo "[before-after-delta] FLAKY: command passed 2/3 attempts. Registering but NOT blocking." >&2
  exit 0
elif [ "$PASS_COUNT" -eq 1 ]; then
  # PASS 1/3 -> suspicious, block with flag
  echo "[before-after-delta] SUSPICIOUS: command passed only 1/3 attempts. BLOCKING with flag." >&2
  exit 2
else
  # PASS 3/3 -> clean, not flaky
  echo "[before-after-delta] CLEAN: command passed all 3 attempts." >&2
  exit 0
fi
