#!/usr/bin/env bats
# =============================================================================
# Regression tests for L0 bugs reported by downstream agents
#
# Each test prevents a specific bug from recurring:
# - Bug 1+2: CRLF arithmetic error (tr -d '\r')
# - Bug 3: pattern-lint scans .worktrees/.gsd
# - Bug 6: coverage-detect falls through to jacoco for Kover projects
# - Bug 7: verify-kmp false positive on KMP-safe AndroidX libs
# - Bug 8: module-health-scan misses platform test dirs
# - Bug 13: pattern-lint cancellation grep matches KDoc
# - Bug 14: pattern-lint println grep matches KDoc
# =============================================================================

SH_DIR="$BATS_TEST_DIRNAME/../sh"
LIB_DIR="$SH_DIR/lib"

# ---------------------------------------------------------------------------
# Bug 1+2: CRLF arithmetic — all tr -d must include \r
# ---------------------------------------------------------------------------

@test "regression: no tr -d without \\r in any script" {
    FAIL=0
    for f in "$SH_DIR"/*.sh; do
        # Find tr -d ' ' that don't include \r
        while IFS= read -r line; do
            # Skip lines that already have \r (proper or in \r\n context)
            echo "$line" | grep -q '\\r' && continue
            echo "MISSING \\r: $(basename "$f"): $line"
            FAIL=1
        done < <(grep -n "tr -d '" "$f" 2>/dev/null | grep -v '\\r' | grep -v "tr -d '\"'" || true)
    done
    [ "$FAIL" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Bug 3: pattern-lint must exclude .gsd and .worktrees
# ---------------------------------------------------------------------------

@test "regression: pattern-lint GREP_EXCLUDES includes .gsd" {
    grep -q "exclude-dir=.gsd" "$SH_DIR/pattern-lint.sh"
}

@test "regression: pattern-lint GREP_EXCLUDES includes .worktrees" {
    grep -q "exclude-dir=.worktrees" "$SH_DIR/pattern-lint.sh"
}

# ---------------------------------------------------------------------------
# Bug 6: coverage-detect checks kover report dir before defaulting to jacoco
# ---------------------------------------------------------------------------

@test "regression: coverage-detect checks kover report dir" {
    grep -q 'reports/kover' "$LIB_DIR/coverage-detect.sh"
}

@test "regression: coverage-detect kover dir check comes before jacoco default" {
    # kover dir check should appear before the "Default: JaCoCo" comment
    kover_line=$(grep -n 'reports/kover' "$LIB_DIR/coverage-detect.sh" | head -1 | cut -d: -f1)
    default_line=$(grep -n 'Default.*JaCoCo\|Default.*jacoco' "$LIB_DIR/coverage-detect.sh" | head -1 | cut -d: -f1)
    [ "$kover_line" -lt "$default_line" ]
}

@test "regression: coverage-detect checks root buildscript for convention plugin kover" {
    grep -q 'root_build\|parent.*build' "$LIB_DIR/coverage-detect.sh"
}

# ---------------------------------------------------------------------------
# Bug 7: verify-kmp allowlist includes KMP-safe AndroidX libs
# ---------------------------------------------------------------------------

@test "regression: verify-kmp allowlists androidx.datastore" {
    grep -q 'datastore' "$SH_DIR/verify-kmp-packages.sh"
}

@test "regression: verify-kmp allowlists androidx.collection" {
    grep -q 'collection' "$SH_DIR/verify-kmp-packages.sh"
}

@test "regression: verify-kmp allowlists androidx.lifecycle" {
    grep -q 'lifecycle' "$SH_DIR/verify-kmp-packages.sh"
}

# ---------------------------------------------------------------------------
# Bug 8: module-health-scan must count platform test source sets
# ---------------------------------------------------------------------------

@test "regression: module-health-scan includes androidUnitTest in test count" {
    grep -q "androidUnitTest" "$SH_DIR/module-health-scan.sh"
}

@test "regression: module-health-scan includes desktopTest in test count" {
    grep -q "desktopTest" "$SH_DIR/module-health-scan.sh"
}

@test "regression: module-health-scan includes iosTest in test count" {
    grep -q "iosTest" "$SH_DIR/module-health-scan.sh"
}

# ---------------------------------------------------------------------------
# Bug 13+14: pattern-lint scan_prod must filter KDoc/comment lines
# ---------------------------------------------------------------------------

@test "regression: pattern-lint scan_prod filters KDoc lines (asterisk)" {
    # scan_prod function should grep -v lines starting with *
    grep -A8 "scan_prod()" "$SH_DIR/pattern-lint.sh" | grep -q '\*'
}

@test "regression: pattern-lint scan_prod filters comment lines (//)" {
    grep -A8 "scan_prod()" "$SH_DIR/pattern-lint.sh" | grep -q '//'
}

@test "regression: pattern-lint cancellation check filters KDoc lines" {
    # The cancellation-rethrow check should also have its own KDoc filter
    grep -A10 "cancellation-rethrow" "$SH_DIR/pattern-lint.sh" | grep -q 'grep -vE'
}
