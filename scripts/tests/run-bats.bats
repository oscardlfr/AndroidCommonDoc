#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/run-bats.sh (--eval-only --log <path> mode).
#
# Coverage map (12 tests):
#   #RB1  ^not ok line present in log → exit 1  [headline false-green fix]
#   #RB2  empty/no-evidence log (no ^ok, no 1..N plan) → exit 1
#   #RB3  CLEAN log (1..N plan + all ok N lines) → exit 0
#   #RB4  REGRESSION: clean log → zero not-ok → grep -c does NOT abort under
#         set -euo pipefail (exits 0 cleanly, no abort on zero-match)
#   #RB5  REGRESSION: 1..0 plan-only log (plan present, zero ok lines) → exit 1
#         (CI parity: a suite that ran 0 tests is NOT green)
#   #RB6  PARTIAL run (1..5, 2 ok, 0 not ok) → exit 1 (completeness fails; the manifested bug)
#   #RB7  COMPLETE run (1..3, 3 ok) → exit 0 (anti-over-strict: a legitimate green run still passes)
#   #RB8  EXECUTED-WARNING present (1..2, 2 ok, + bats warning line) → exit 1
#   #RB9  --expected override: clean 1..3 + 3 ok with --expected 1631 → exit 1;
#         with --expected 3 → exit 0
#   #RB10 PLAN-LINE policy: ok lines but no 1..N → exit 1;
#         log with TWO 1..N lines → exit 1
#   #RB11 DEFAULT TARGET: no explicit targets passes scripts/tests directory to npx
#   #RB12 EXPLICIT TARGETS: caller-supplied targets pass through unchanged
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

# ─────────────────────────────────────────────────────────────────────────────
# #RB5  REGRESSION: 1..0 plan-only log → exit 1  (CI parity fix)
# A log containing only a TAP plan line "1..0" with ZERO ok lines means bats
# planned 0 tests and ran 0 tests.  Before the fix, run-bats.sh would PASS on
# this input because it only checked ^not ok count (which is 0).  CI fails
# because ok_ct == 0.  After the fix, ok_ct == 0 is an explicit error path
# that exits 1 — closing the local-green-but-CI-red gap.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB5 REGRESSION: 1..0 plan-only log (plan present, zero ok) → exit 1 (CI parity)" {
    # Only a TAP plan line — no ok or not ok lines.
    printf '1..0\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB6  PARTIAL run: 1..5, 2 ok, 0 not ok → exit 1  (completeness fails)
#
# This is the MANIFESTED BUG from the predecessor wave: the QG reported PASS
# while the log only captured a subset of ok lines (no not ok).  The old code
# checked "not_ok == 0" and "ok > 0", which both passed on a partial run.
# The new completeness assertion (ok + not_ok) == plan-N catches this:
#   2 ok + 0 not ok = 2 total ≠ 5 expected → exit 1.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB6 FAIL: partial run (1..5 + 2 ok + 0 not ok) → exit 1 (completeness fails; manifested bug)" {
    printf '1..5\nok 1 alpha\nok 2 beta\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB7  COMPLETE run: 1..3, 3 ok → exit 0  (anti-over-strict)
#
# A legitimate green run where ok + not_ok == plan-N must still exit 0.
# Guards against the completeness check being too strict (e.g. requiring N > 1
# or some other overconstrained invariant that would break a real green run).
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB7 PASS: complete run (1..3 + 3 ok) → exit 0 (anti-over-strict)" {
    printf '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB8  EXECUTED-WARNING present → exit 1
#
# bats emits `# bats warning: Executed X instead of expected Y tests` when a
# teardown_file failure inflates or deflates the count.  Even if (ok + not_ok)
# happens to equal the plan N, this warning signals an unreliable run and must
# flip the verdict to FAIL.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB8 FAIL: bats Executed-warning present (1..2 + 2 ok + warning) → exit 1" {
    printf '1..2\nok 1 alpha\nok 2 beta\n# bats warning: Executed 3 instead of expected 2 tests\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB9  --expected override flag
#
# Two sub-cases exercising the caller-supplied --expected N flag:
#   (a) clean 1..3 + 3 ok with --expected 1631 → exit 1  (plan N ≠ 1631)
#   (b) clean 1..3 + 3 ok with --expected 3   → exit 0  (plan N == 3)
# This is the "optional cross-check against a known authoritative count" path.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB9a FAIL: clean 1..3 + 3 ok with --expected 1631 → exit 1 (plan N != override)" {
    printf '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG" --expected 1631
    [ "$status" -eq 1 ]
}

@test "#RB9b PASS: clean 1..3 + 3 ok with --expected 3 → exit 0 (plan N == override)" {
    printf '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG" --expected 3
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RB10  PLAN-LINE policy pin
#
# Two sub-cases requiring EXACTLY ONE `^1..N` plan line:
#   (a) ok lines present but NO plan line → exit 1  (malformed TAP)
#   (b) log with TWO `^1..N` lines → exit 1  (merged / partial TAP)
# Prevents a falsely green verdict when bats output is truncated in a way that
# drops the plan line, or when multiple partial runs are concatenated.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RB10a FAIL: ok lines but no 1..N plan line → exit 1 (malformed TAP)" {
    # No plan line at all — just ok lines.
    printf 'ok 1 alpha\nok 2 beta\nok 3 gamma\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

@test "#RB10b FAIL: log with two 1..N plan lines → exit 1 (merged/partial TAP)" {
    printf '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n1..3\nok 1 delta\nok 2 epsilon\nok 3 zeta\n' > "$LOG"

    run bash "$SCRIPT" --eval-only --log "$LOG"
    [ "$status" -eq 1 ]
}

write_fake_npx() {
    mkdir -p "$WORK_DIR/bin"
    cat > "$WORK_DIR/bin/npx" << EOF
#!/usr/bin/env bash
printf '%s\n' "\$@" > "$WORK_DIR/npx-args"
if [[ "\$1" == "bats" && "\${2:-}" == "--count" ]]; then
    printf '2\n'
else
    printf '1..2\nok 1 alpha\nok 2 beta\n'
fi
EOF
    chmod +x "$WORK_DIR/bin/npx"
}

@test "#RB11 DEFAULT TARGET: no explicit targets passes scripts/tests directory to npx (no expanded glob)" {
    write_fake_npx

    run env PATH="$WORK_DIR/bin:$PATH" bash "$SCRIPT" --project-root "$WORK_DIR" --log "$LOG"
    [ "$status" -eq 0 ]

    mapfile -t args < "$WORK_DIR/npx-args"
    [ "${#args[@]}" -eq 2 ]
    [ "${args[0]}" = "bats" ]
    [ "${args[1]}" = "$WORK_DIR/scripts/tests" ]
}

@test "#RB12 EXPLICIT TARGETS: caller-supplied bats targets pass through unchanged" {
    write_fake_npx

    run env PATH="$WORK_DIR/bin:$PATH" bash "$SCRIPT" --project-root "$WORK_DIR" --log "$LOG" "$WORK_DIR/one.bats" "$WORK_DIR/two.bats"
    [ "$status" -eq 0 ]

    mapfile -t args < "$WORK_DIR/npx-args"
    [ "${#args[@]}" -eq 3 ]
    [ "${args[0]}" = "bats" ]
    [ "${args[1]}" = "$WORK_DIR/one.bats" ]
    [ "${args[2]}" = "$WORK_DIR/two.bats" ]
}
