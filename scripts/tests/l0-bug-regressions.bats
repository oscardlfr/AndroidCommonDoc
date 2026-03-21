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

# ---------------------------------------------------------------------------
# Bug 18: coverage batch partial → per-module retry with kover fallbacks
# ---------------------------------------------------------------------------

@test "regression: coverage suite retries missing modules after partial batch" {
    grep -q "retrying.*per-module\|recovered via\|Batch partial" scripts/sh/run-parallel-coverage-suite.sh
}

@test "regression: coverage suite uses get_kover_task_fallbacks for recovery" {
    grep -q "get_kover_task_fallbacks" scripts/sh/run-parallel-coverage-suite.sh
}

@test "regression: per-module kover retry tries multiple task variants" {
    grep -q "fb_task" scripts/sh/run-parallel-coverage-suite.sh
}

# ---------------------------------------------------------------------------
# Bug 19: --exclude-coverage flag + auto-exclude patterns
# ---------------------------------------------------------------------------

@test "regression: coverage suite has --exclude-coverage flag" {
    grep -q "\-\-exclude-coverage" scripts/sh/run-parallel-coverage-suite.sh
}

@test "regression: coverage suite has AUTO_EXCLUDE_COVERAGE_PATTERNS" {
    grep -q "AUTO_EXCLUDE_COVERAGE_PATTERNS" scripts/sh/run-parallel-coverage-suite.sh
}

@test "regression: auto-exclude patterns include testing modules" {
    grep "AUTO_EXCLUDE_COVERAGE_PATTERNS" scripts/sh/run-parallel-coverage-suite.sh | grep -q "testing"
}

@test "regression: auto-exclude patterns include konsist-guard" {
    grep "AUTO_EXCLUDE_COVERAGE_PATTERNS" scripts/sh/run-parallel-coverage-suite.sh | grep -q "konsist"
}

@test "regression: PS1 has ExcludeCoverage parameter" {
    grep -q "ExcludeCoverage" scripts/ps1/run-parallel-coverage-suite.ps1
}

# ---------------------------------------------------------------------------
# Bug 20: local keyword used outside function in main script body
# ---------------------------------------------------------------------------

@test "regression: no 'local' outside functions in any SH script" {
    FAIL=0
    for script in scripts/sh/*.sh scripts/sh/lib/*.sh; do
        [ -f "$script" ] || continue
        # Use python to detect local outside function scope
        result=$(python3 -c "
import re, sys
with open('$script', encoding='utf-8', errors='replace') as f:
    lines = f.readlines()
in_func = False
depth = 0
violations = []
for i, line in enumerate(lines, 1):
    s = line.strip()
    if re.match(r'^[a-zA-Z_]\w*\s*\(\)', s): in_func = True
    depth += s.count('{') - s.count('}')
    if depth <= 0 and in_func:
        in_func = False
        depth = 0
    if s.startswith('local ') and not in_func:
        violations.append(f'{i}: {s}')
if violations:
    print(f'$(basename "$script"):')
    for v in violations: print(f'  {v}')
    sys.exit(1)
" 2>&1) || { echo "$result"; FAIL=1; }
    done
    [ "$FAIL" -eq 0 ]
}
