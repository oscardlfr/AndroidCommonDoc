#!/usr/bin/env bats
# =============================================================================
# Tests for scripts/sh/lib/script-utils.sh
#
# All pure utility functions:
#   - glob_match, get_project_type, test_class_excluded
#   - format_line_ranges, get_module_from_file, get_changed_files
#
# Also regression tests for script-level bugs:
#   - TEMP_DIR fix in run-parallel-coverage-suite.sh
# =============================================================================

LIB="$BATS_TEST_DIRNAME/../sh/lib/script-utils.sh"
COVERAGE_SCRIPT="$BATS_TEST_DIRNAME/../sh/run-parallel-coverage-suite.sh"
CHANGED_SCRIPT="$BATS_TEST_DIRNAME/../sh/run-changed-modules-tests.sh"

setup() {
    # shellcheck disable=SC1090
    source "$LIB"
    EXCLUSION_PATTERNS=(
        '*$DefaultImpls'
        '*$Companion'
        '*$$serializer'
        'ComposableSingletons$*'
    )
    WORK_DIR=$(mktemp -d)
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ---------------------------------------------------------------------------
# glob_match
# ---------------------------------------------------------------------------

@test "glob_match: exact match returns 0" {
    glob_match "hello" "hello"
}

@test "glob_match: wildcard prefix matches" {
    glob_match '*$Companion' 'SomeClass$Companion'
}

@test "glob_match: wildcard suffix matches" {
    glob_match 'ComposableSingletons$*' 'ComposableSingletons$MyScreen'
}

@test "glob_match: no match returns 1" {
    run glob_match "hello" "world"
    [ "$status" -eq 1 ]
}

@test "glob_match: double dollar matches literal dollar" {
    glob_match '*$$serializer' 'MyClass$$serializer'
}

# ---------------------------------------------------------------------------
# test_class_excluded
# ---------------------------------------------------------------------------

@test "test_class_excluded: DefaultImpls is excluded" {
    test_class_excluded 'MyInterface$DefaultImpls'
}

@test "test_class_excluded: Companion is excluded" {
    test_class_excluded 'MyClass$Companion'
}

@test "test_class_excluded: serializer is excluded" {
    test_class_excluded 'MyClass$$serializer'
}

@test "test_class_excluded: ComposableSingletons prefix is excluded" {
    test_class_excluded 'ComposableSingletons$HomeScreen'
}

@test "test_class_excluded: regular class is NOT excluded" {
    run test_class_excluded 'MyViewModel'
    [ "$status" -eq 1 ]
}

@test "test_class_excluded: AesAlgorithm is NOT excluded" {
    run test_class_excluded 'AesAlgorithm'
    [ "$status" -eq 1 ]
}

# ---------------------------------------------------------------------------
# get_project_type
# ---------------------------------------------------------------------------

@test "get_project_type: returns kmp-desktop when desktopApp dir exists" {
    mkdir -p "$WORK_DIR/desktopApp"
    result=$(get_project_type "$WORK_DIR")
    [ "$result" = "kmp-desktop" ]
}

@test "get_project_type: returns kmp-desktop when project name contains kmp" {
    local kmp_dir
    kmp_dir=$(mktemp -d "$WORK_DIR/shared-kmp-XXXXXX")
    result=$(get_project_type "$kmp_dir")
    [ "$result" = "kmp-desktop" ]
}

@test "get_project_type: returns android for plain android project" {
    mkdir -p "$WORK_DIR/core/domain"
    echo 'plugins { id("com.android.library") }' > "$WORK_DIR/core/domain/build.gradle.kts"
    result=$(get_project_type "$WORK_DIR")
    [ "$result" = "android" ]
}

@test "get_project_type: returns android for empty dir" {
    result=$(get_project_type "$WORK_DIR")
    [ "$result" = "android" ]
}

# ---------------------------------------------------------------------------
# format_line_ranges
# ---------------------------------------------------------------------------

@test "format_line_ranges: single line returns single number" {
    result=$(format_line_ranges "42")
    [ "$result" = "42" ]
}

@test "format_line_ranges: consecutive lines form a range" {
    result=$(format_line_ranges "1,2,3")
    [ "$result" = "1-3" ]
}

@test "format_line_ranges: non-consecutive lines are comma-separated" {
    result=$(format_line_ranges "1,3,5")
    [ "$result" = "1, 3, 5" ]
}

@test "format_line_ranges: mixed consecutive and non-consecutive" {
    result=$(format_line_ranges "1,2,3,5,6,10")
    [ "$result" = "1-3, 5-6, 10" ]
}

@test "format_line_ranges: empty input returns dash" {
    result=$(format_line_ranges "")
    [ "$result" = "-" ]
}

@test "format_line_ranges: two consecutive lines form a range" {
    result=$(format_line_ranges "18,19")
    [ "$result" = "18-19" ]
}

# ---------------------------------------------------------------------------
# get_module_from_file
# ---------------------------------------------------------------------------

_setup_project_structure() {
    mkdir -p "$WORK_DIR/core/domain"
    mkdir -p "$WORK_DIR/core/api"
    mkdir -p "$WORK_DIR/feature/home"
    mkdir -p "$WORK_DIR/app"
    touch "$WORK_DIR/core/domain/build.gradle.kts"
    touch "$WORK_DIR/core/api/build.gradle.kts"
    touch "$WORK_DIR/feature/home/build.gradle.kts"
    touch "$WORK_DIR/app/build.gradle.kts"
}

@test "get_module_from_file: core/domain/... → :core:domain" {
    _setup_project_structure
    result=$(get_module_from_file "core/domain/src/main/MyClass.kt" "$WORK_DIR")
    [ "$result" = ":core:domain" ]
}

@test "get_module_from_file: core/api/... → :core:api" {
    _setup_project_structure
    result=$(get_module_from_file "core/api/src/main/Api.kt" "$WORK_DIR")
    [ "$result" = ":core:api" ]
}

@test "get_module_from_file: feature/home/... → :feature:home" {
    _setup_project_structure
    result=$(get_module_from_file "feature/home/src/main/HomeScreen.kt" "$WORK_DIR")
    [ "$result" = ":feature:home" ]
}

@test "get_module_from_file: root-level file returns empty" {
    _setup_project_structure
    result=$(get_module_from_file "build.gradle.kts" "$WORK_DIR")
    [ -z "$result" ]
}

@test "get_module_from_file: unknown path returns empty" {
    _setup_project_structure
    result=$(get_module_from_file "totally/unknown/path/File.kt" "$WORK_DIR")
    [ -z "$result" ]
}

@test "get_module_from_file: single component path returns empty" {
    _setup_project_structure
    result=$(get_module_from_file "README.md" "$WORK_DIR")
    [ -z "$result" ]
}

# ---------------------------------------------------------------------------
# get_changed_files
# ---------------------------------------------------------------------------

_setup_git_repo() {
    git -C "$WORK_DIR" init -q 2>/dev/null || true
    git -C "$WORK_DIR" config user.email "test@test.com" 2>/dev/null || true
    git -C "$WORK_DIR" config user.name "Test" 2>/dev/null || true
    touch "$WORK_DIR/README.md"
    git -C "$WORK_DIR" add . 2>/dev/null || true
    git -C "$WORK_DIR" commit -q -m "init" 2>/dev/null || true
}

@test "get_changed_files: staged-only returns empty on clean repo" {
    _setup_git_repo
    result=$(get_changed_files "$WORK_DIR" "true")
    [ -z "$result" ]
}

@test "get_changed_files: returns modified file when unstaged" {
    _setup_git_repo
    echo "change" >> "$WORK_DIR/README.md"
    result=$(get_changed_files "$WORK_DIR" "false")
    echo "$result" | grep -q "README.md"
}

@test "get_changed_files: staged-only ignores unstaged changes" {
    _setup_git_repo
    echo "unstaged" >> "$WORK_DIR/README.md"
    result=$(get_changed_files "$WORK_DIR" "true")
    [ -z "$result" ]
}

# ---------------------------------------------------------------------------
# Regression: TEMP_DIR bug fix
# ---------------------------------------------------------------------------

@test "run-parallel-coverage-suite.sh: no bare TEMP_DIR reference" {
    count=$(grep -c '\$TEMP_DIR\b' "$COVERAGE_SCRIPT" || true)
    [ "$count" -eq 0 ]
}

@test "run-parallel-coverage-suite.sh: mod_summary_lookup uses TMPDIR fallback" {
    grep -q 'TMPDIR' "$COVERAGE_SCRIPT"
}

@test "run-parallel-coverage-suite.sh: --fresh-daemon cleans coverage cache" {
    # --fresh-daemon should remove kover/jacoco report dirs, not just stop daemons
    grep -q "kover" "$COVERAGE_SCRIPT"
    grep -q "jacoco" "$COVERAGE_SCRIPT"
    grep -A5 "FRESH_DAEMON" "$COVERAGE_SCRIPT" | grep -q "rm -rf\|Clean"
}

@test "run-parallel-coverage-suite.ps1: -FreshDaemon cleans coverage cache" {
    PS1_SCRIPT="$BATS_TEST_DIRNAME/../ps1/run-parallel-coverage-suite.ps1"
    [ -f "$PS1_SCRIPT" ] || skip "PS1 script not found"
    grep -A10 "FreshDaemon" "$PS1_SCRIPT" | grep -q "kover\|Remove-Item"
}

@test "run-parallel-coverage-suite.sh: coverage phase uses --rerun-tasks" {
    # Without --rerun-tasks, Kover doesn't regenerate XML when tests are cached UP-TO-DATE
    count=$(grep -c '\-\-rerun-tasks' "$COVERAGE_SCRIPT" || true)
    # Should appear at least twice: main project + shared-libs
    [ "$count" -ge 2 ]
}

@test "run-parallel-coverage-suite.sh: test phase does NOT use --rerun-tasks" {
    # Tests benefit from caching — only coverage needs forced rerun
    # The test phase is the GRADLE_ARGS section (before coverage)
    # Check that --rerun-tasks only appears in coverage context (COV_ARGS)
    test_phase_rerun=$(sed -n '/GRADLE_ARGS/,/coverage/p' "$COVERAGE_SCRIPT" | grep -c '\-\-rerun-tasks' || true)
    [ "$test_phase_rerun" -eq 0 ]
}

@test "run-parallel-coverage-suite.ps1: coverage phase uses --rerun-tasks" {
    PS1_SCRIPT="$BATS_TEST_DIRNAME/../ps1/run-parallel-coverage-suite.ps1"
    [ -f "$PS1_SCRIPT" ] || skip "PS1 script not found"
    count=$(grep -c '\-\-rerun-tasks' "$PS1_SCRIPT" || true)
    [ "$count" -ge 2 ]
}

# ---------------------------------------------------------------------------
# Regression: --show-modules-only flag in run-changed-modules-tests.sh
# ---------------------------------------------------------------------------

@test "run-changed-modules-tests.sh: --show-modules-only is recognized" {
    grep -q '\-\-show-modules-only' "$CHANGED_SCRIPT"
}

@test "run-changed-modules-tests.sh: no bare --show-modules alias" {
    count=$(grep -c "'\-\-show-modules')" "$CHANGED_SCRIPT" || true)
    [ "$count" -eq 0 ]
}
