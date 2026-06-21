#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/run-bats.sh (--eval-only --log <path> mode).
#
# Coverage map (4 tests):
#   #RB1  ^not ok line present in log → exit 1  [headline false-green fix]
#   #RB2  empty/no-evidence log (no ^ok, no 1..N plan) → exit 1
#   #RB3  CLEAN log (1..N plan + all ok N lines) → exit 0
#   #RB4  REGRESSION: clean log → zero not-ok → grep -c does NOT abort under
#         set -euo pipefail (exits 0 cleanly, no abort on zero-match)
#
# Isolation: every test uses mktemp + teardown rm -rf.
# NEVER reads live suite logs.

SCRIPT="$BATS_TEST_DIRNAME/../sh/run-bats.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    LOG="$WORK_DIR/suite-bats.log"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB1  ^not ok present → exit 1  (headline false-green fix)
# Even when bats itself would exit 0 (e.g. --no-fail on some versions), the
# CONTENT of the log is authoritative.  A single "not ok" line must flip the
# verdict to FAIL.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB1 FAIL: log contains ^not ok line → exit 1 (headline false-green fix)" {
    printf '1..3\nok 1 passes\nnot ok 2 explodes\nok 3 also passes\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB2  empty / no-evidence log → exit 1
# A log with no "ok" lines and no "1..N" plan line has zero run evidence.
# A dead or empty suite MUST NOT read green.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB2 FAIL: empty/no-evidence log → exit 1 (dead suite must not read green)" {
    # Completely empty log
    printf '' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB3  CLEAN log (1..N plan + all ok lines, zero not-ok) → exit 0
# Happy-path: a properly completed bats run with no failures.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB3 PASS: clean log (1..N + all ok) → exit 0" {
    printf '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB4  REGRESSION: clean log → grep -c "^not ok" returns 0 → script does NOT
# abort under set -euo pipefail (guards the bare-assignment grep-zero-match bug).
#
# The fix in run-bats.sh:
#   not_ok=$(grep -c "^not ok" "$LOG" || true)
# Without || true, grep exits 1 on zero-match, set -e propagates, and the
# script aborts before printing PASS — making a clean run look like an error.
# This test exercises exactly that path: clean log → 0 not-ok → exit 0.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB4 REGRESSION: clean log with zero not-ok does not abort under set -euo pipefail (exits 0)" {
    # Log with ONLY ok lines and a plan — no "not ok" string anywhere.
    printf '1..2\nok 1 first\nok 2 second\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    # Must exit 0 (not 1 from grep-abort)
    [ "$status" -eq 0 ]
}
