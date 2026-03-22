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
    # The cancellation-rethrow check should filter KDoc/comment lines by content
    grep -A20 "cancellation-rethrow" "$SH_DIR/pattern-lint.sh" | grep -q 'trimmed.*\\\*'
}

# ---------------------------------------------------------------------------
# Bug 21: cancellation-rethrow context-aware check (124 FP → real issues)
# ---------------------------------------------------------------------------

@test "regression: cancellation check parses Windows drive letter paths" {
    # Must handle C:/Users/... paths via regex, not IFS=:
    grep -A30 "cancellation-rethrow" "$SH_DIR/pattern-lint.sh" | grep -q 'A-Za-z]:'
}

@test "regression: cancellation check looks at surrounding context for CancellationException" {
    # Must check lines BEFORE catch (prior catch block) for CancellationException
    grep -A30 "cancellation-rethrow" "$SH_DIR/pattern-lint.sh" | grep -q 'line - 5\|start.*line.*5'
}

@test "regression: cancellation check skips catch blocks that rethrow exception" {
    # Must check if catch block does throw e/it/ex (rethrow = safe)
    grep -A40 "cancellation-rethrow" "$SH_DIR/pattern-lint.sh" | grep -q 'throw.*e\|throw.*it\|throw.*ex'
}

@test "regression: cancellation check filters comment lines by content not grep output" {
    # Must trim the code portion and check for * or // prefix
    grep -A30 "cancellation-rethrow" "$SH_DIR/pattern-lint.sh" | grep -q 'trimmed'
}

# ---------------------------------------------------------------------------
# Bug 22: readme-audit tr -d must include \r for CRLF compat
# ---------------------------------------------------------------------------

@test "regression: readme-audit all wc-l pipes include \\r in tr -d" {
    FAIL=0
    while IFS= read -r line; do
        echo "$line" | grep -q '\\r' && continue
        echo "MISSING \\r in readme-audit.sh: $line"
        FAIL=1
    done < <(grep -n "wc -l.*tr -d" "$SH_DIR/readme-audit.sh" || true)
    [ "$FAIL" -eq 0 ]
}

@test "regression: readme-audit tr -d on parentheses includes \\r" {
    # tr -d '()' must be tr -d '()\r' for Windows compat
    FAIL=0
    while IFS= read -r line; do
        echo "$line" | grep -q '\\r' && continue
        echo "MISSING \\r in readme-audit.sh: $line"
        FAIL=1
    done < <(grep -n "tr -d '()'" "$SH_DIR/readme-audit.sh" || true)
    [ "$FAIL" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Bug 23: Agent generification — no project-specific names in L0 agents
# ---------------------------------------------------------------------------

@test "regression: ui-specialist uses ExampleScreen not SettingsScreen" {
    AGENT=".claude/agents/ui-specialist.md"
    [ -f "$AGENT" ] || skip "Agent file not found"
    ! grep -q "SettingsScreen" "$AGENT"
}

@test "regression: agents use generic layer names not module names" {
    # L0 agents must not reference project-specific modules
    FAIL=0
    for agent in .claude/agents/test-specialist.md .claude/agents/ui-specialist.md; do
        [ -f "$agent" ] || continue
        if grep -qE "core:model|core:data|core:domain|core:database|feature/" "$agent"; then
            echo "Project-specific module in $(basename "$agent")"
            FAIL=1
        fi
    done
    [ "$FAIL" -eq 0 ]
}

@test "regression: test-specialist has no pre-existing excuse rule" {
    grep -q "No.*Pre-existing.*Excuse\|pre-existing" ".claude/agents/test-specialist.md"
}

@test "regression: ui-specialist has no pre-existing excuse rule" {
    grep -q "No.*Pre-existing.*Excuse\|pre-existing" ".claude/agents/ui-specialist.md"
}

@test "regression: dev-lead template has no pre-existing excuse rule" {
    grep -q "pre-existing" "setup/agent-templates/dev-lead.md"
}

@test "regression: test-specialist requires e2e for all core layers" {
    # Must mention Model, Domain, Data, Database with e2e requirements
    agent=".claude/agents/test-specialist.md"
    grep -q "Model layer" "$agent"
    grep -q "Domain layer" "$agent"
    grep -q "Data layer" "$agent"
    grep -q "Database layer" "$agent"
}

@test "regression: ui-specialist findings use generic file names" {
    # Example JSON in findings should use ExampleScreen.kt, not SettingsScreen.kt
    grep "dedupe_key.*Screen" ".claude/agents/ui-specialist.md" | grep -q "ExampleScreen"
}

# ---------------------------------------------------------------------------
# Bug 24: suppressions system
# ---------------------------------------------------------------------------

@test "regression: suppressions library has load_suppressions function" {
    [ -f "$LIB_DIR/suppressions.sh" ]
    grep -q "load_suppressions" "$LIB_DIR/suppressions.sh"
}

@test "regression: suppressions library has is_suppressed function" {
    grep -q "is_suppressed" "$LIB_DIR/suppressions.sh"
}

@test "regression: suppressions supports prefix matching with asterisk" {
    grep -q '\*' "$LIB_DIR/suppressions.sh"
}

@test "regression: suppressions supports expiry dates" {
    grep -q 'expires\|expir' "$LIB_DIR/suppressions.sh"
}

@test "regression: readme-audit sources suppressions library" {
    grep -q "suppressions.sh" "$SH_DIR/readme-audit.sh"
}

@test "regression: pattern-lint sources suppressions library" {
    grep -q "suppressions.sh" "$SH_DIR/pattern-lint.sh"
}

# ---------------------------------------------------------------------------
# Bug 18: coverage batch partial → per-module retry with kover fallbacks
# ---------------------------------------------------------------------------

@test "regression: coverage suite retries missing modules after partial batch" {
    grep -q "retrying.*per-module\|recovered via\|Batch partial" scripts/sh/run-parallel-coverage-suite.sh
}

@test "regression: coverage suite uses batch recovery for missing modules" {
    grep -q "Batch partial\|Batch recovery\|retrying as single batch" scripts/sh/run-parallel-coverage-suite.sh
}

@test "regression: coverage suite retries with --no-configuration-cache on full failure" {
    grep -q "no-configuration-cache" scripts/sh/run-parallel-coverage-suite.sh
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
