#!/usr/bin/env bats
# =============================================================================
# Tests for scripts/sh/lib/coverage-detect.sh
#
# Validates:
#   - detect_coverage_tool: kover/jacoco/none detection from build.gradle.kts
#   - get_coverage_gradle_task: correct task per tool+test_type
#   - get_coverage_xml_path: resolves correct XML path
#   - get_coverage_display_name: human-readable names
# =============================================================================

LIB="$BATS_TEST_DIRNAME/../sh/lib/coverage-detect.sh"

setup() {
    # Source the library before each test
    # shellcheck disable=SC1090
    source "$LIB"
    WORK_DIR=$(mktemp -d)
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ---------------------------------------------------------------------------
# detect_coverage_tool
# ---------------------------------------------------------------------------

@test "detect_coverage_tool: returns 'kover' when build file contains kover" {
    echo 'plugins { id("org.jetbrains.kotlinx.kover") }' > "$WORK_DIR/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/build.gradle.kts")
    [ "$result" = "kover" ]
}

@test "detect_coverage_tool: returns 'jacoco' when build file contains jacoco" {
    echo 'apply plugin: "jacoco"' > "$WORK_DIR/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

@test "detect_coverage_tool: returns 'jacoco' when testCoverageEnabled present" {
    echo 'testCoverageEnabled = true' > "$WORK_DIR/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

@test "detect_coverage_tool: returns 'jacoco' when jacoco report dir exists (no explicit config)" {
    mkdir -p "$WORK_DIR/build/reports/jacoco"
    echo 'plugins { id("com.android.library") }' > "$WORK_DIR/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

@test "detect_coverage_tool: returns 'jacoco' as default for plain android build file" {
    echo 'plugins { id("com.android.library") }' > "$WORK_DIR/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/build.gradle.kts")
    [ "$result" = "jacoco" ]
}

@test "detect_coverage_tool: returns 'none' when build file does not exist" {
    result=$(detect_coverage_tool "$WORK_DIR/nonexistent.gradle.kts")
    [ "$result" = "none" ]
}

@test "detect_coverage_tool: kover takes precedence over jacoco when both present" {
    printf 'plugins {\n  id("org.jetbrains.kotlinx.kover")\n  apply plugin: "jacoco"\n}' > "$WORK_DIR/build.gradle.kts"
    result=$(detect_coverage_tool "$WORK_DIR/build.gradle.kts")
    [ "$result" = "kover" ]
}

# ---------------------------------------------------------------------------
# get_coverage_gradle_task
# ---------------------------------------------------------------------------

@test "get_coverage_gradle_task: jacoco+androidUnit → jacocoTestReport" {
    result=$(get_coverage_gradle_task "jacoco" "androidUnit" "false")
    [ "$result" = "jacocoTestReport" ]
}

@test "get_coverage_gradle_task: jacoco+androidInstrumented → jacocoTestReport" {
    result=$(get_coverage_gradle_task "jacoco" "androidInstrumented" "false")
    [ "$result" = "jacocoTestReport" ]
}

@test "get_coverage_gradle_task: kover+common → koverXmlReportDesktop" {
    result=$(get_coverage_gradle_task "kover" "common" "true")
    [ "$result" = "koverXmlReportDesktop" ]
}

@test "get_coverage_gradle_task: kover+androidUnit → koverXmlReportDebug" {
    result=$(get_coverage_gradle_task "kover" "androidUnit" "false")
    [ "$result" = "koverXmlReportDebug" ]
}

@test "get_coverage_gradle_task: kover+desktop → koverXmlReportDesktop" {
    result=$(get_coverage_gradle_task "kover" "desktop" "true")
    [ "$result" = "koverXmlReportDesktop" ]
}

@test "get_coverage_gradle_task: none → empty string" {
    result=$(get_coverage_gradle_task "none" "androidUnit" "false")
    [ -z "$result" ]
}

# ---------------------------------------------------------------------------
# get_coverage_display_name
# ---------------------------------------------------------------------------

@test "get_coverage_display_name: jacoco → JaCoCo" {
    result=$(get_coverage_display_name "jacoco")
    [ "$result" = "JaCoCo" ]
}

@test "get_coverage_display_name: kover → Kover" {
    result=$(get_coverage_display_name "kover")
    [ "$result" = "Kover" ]
}

@test "get_coverage_display_name: none → (none)" {
    result=$(get_coverage_display_name "none")
    [ "$result" = "(none)" ]
}

@test "get_coverage_display_name: auto → (none)" {
    result=$(get_coverage_display_name "auto")
    [ "$result" = "(none)" ]
}

# ---------------------------------------------------------------------------
# get_coverage_xml_path
# ---------------------------------------------------------------------------

@test "get_coverage_xml_path: jacoco — returns path when report XML exists" {
    mkdir -p "$WORK_DIR/build/reports/jacoco"
    echo "<report/>" > "$WORK_DIR/build/reports/jacoco/jacocoTestReport.xml"
    result=$(get_coverage_xml_path "jacoco" "$WORK_DIR" "false")
    echo "$result" | grep -q "jacocoTestReport.xml"
}

@test "get_coverage_xml_path: jacoco — returns empty when report dir missing" {
    run get_coverage_xml_path "jacoco" "$WORK_DIR" "false"
    # Function returns 1 when dir missing; output is empty
    [ -z "$output" ]
}

@test "get_coverage_xml_path: kover desktop — returns path when reportDesktop.xml exists" {
    mkdir -p "$WORK_DIR/build/reports/kover"
    echo "<report/>" > "$WORK_DIR/build/reports/kover/reportDesktop.xml"
    result=$(get_coverage_xml_path "kover" "$WORK_DIR" "true")
    echo "$result" | grep -q "reportDesktop.xml"
}

@test "get_coverage_xml_path: none — returns empty (function returns 1)" {
    run get_coverage_xml_path "none" "$WORK_DIR" "false"
    [ -z "$output" ]
}
