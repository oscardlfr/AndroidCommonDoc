#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# AI Error Extractor - Extract actionable errors from Gradle logs and test results.
#
# Parses build output to extract:
#   - Compilation errors with file locations
#   - Test failures from JUnit XML results
#   - Coverage gaps from coverage reports (Kover/JaCoCo)
#
# Outputs structured data optimized for AI agent fixes.
#
# Usage:
#   ./ai-error-extractor.sh --module core:data
#   ./ai-error-extractor.sh --project-root ~/Projects/MyProject --module core:domain --platform desktop --json
#
# Options:
#   --project-root <path>   Project root (default: current directory)
#   --module <name>         Module to analyze (required)
#   --platform <auto|android|desktop>
#   --include-stacktrace    Include full stack traces
#   --json                  Output results as JSON
# =============================================================================

# Defaults
PROJECT_ROOT="$(pwd)"
MODULE=""
PLATFORM="auto"
INCLUDE_STACKTRACE=false
JSON_OUTPUT=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"; shift 2 ;;
        --module)
            MODULE="$2"; shift 2 ;;
        --platform)
            PLATFORM="$2"; shift 2 ;;
        --include-stacktrace)
            INCLUDE_STACKTRACE=true; shift ;;
        --json)
            JSON_OUTPUT=true; shift ;;
        *)
            # If no flag, treat first positional as module
            if [[ -z "$MODULE" ]]; then
                MODULE="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$MODULE" ]]; then
    echo "Error: --module is required"
    echo "Usage: ./ai-error-extractor.sh --module <module-name> [options]"
    exit 1
fi

# Color helpers
color_cyan="\033[36m"
color_green="\033[32m"
color_red="\033[31m"
color_yellow="\033[33m"
color_gray="\033[90m"
color_white="\033[37m"
color_reset="\033[0m"

# Source coverage detection library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/coverage-detect.sh"

# Resolve paths
MODULE_PATH="$PROJECT_ROOT/${MODULE//://}"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Counters
COMPILATION_ERROR_COUNT=0
TEST_FAILURE_COUNT=0
COVERAGE_GAP_COUNT=0
ACTION_NUM=0

# Temp files for structured data
COMPILATION_ERRORS_FILE=$(mktemp "${TMPDIR:-/tmp}/ai-extract-comp-XXXXXX")
TEST_FAILURES_FILE=$(mktemp "${TMPDIR:-/tmp}/ai-extract-test-XXXXXX")
COVERAGE_GAPS_FILE=$(mktemp "${TMPDIR:-/tmp}/ai-extract-cov-XXXXXX")
ACTIONABLE_ITEMS_FILE=$(mktemp "${TMPDIR:-/tmp}/ai-extract-actions-XXXXXX")

cleanup() {
    rm -f "$COMPILATION_ERRORS_FILE" "$TEST_FAILURES_FILE" "$COVERAGE_GAPS_FILE" "$ACTIONABLE_ITEMS_FILE"
}
trap cleanup EXIT

get_project_type() {
    local root="$1"
    if [[ -d "$root/desktopApp" ]]; then
        echo "kmp-desktop"
    else
        echo "android"
    fi
}

get_suggested_fix() {
    local msg="$1"
    if echo "$msg" | grep -q "Unresolved reference"; then
        echo "Add missing import or check dependency"; return
    elif echo "$msg" | grep -q "Type mismatch"; then
        echo "Verify parameter types match function signature"; return
    elif echo "$msg" | grep -q "Cannot access"; then
        echo "Check visibility modifiers or add dependency"; return
    elif echo "$msg" | grep -q "No value passed for parameter"; then
        echo "Add missing required parameter to function call"; return
    elif echo "$msg" | grep -q "Too many arguments"; then
        echo "Remove extra arguments from function call"; return
    elif echo "$msg" | grep -q "Expecting"; then
        echo "Fix syntax error - check brackets, braces, or keywords"; return
    elif echo "$msg" | grep -q "does not have"; then
        echo "Check class/interface has the referenced member"; return
    elif echo "$msg" | grep -q "Duplicate"; then
        echo "Remove duplicate declaration or rename one instance"; return
    elif echo "$msg" | grep -q "Constructor call expected"; then
        echo "Change object instantiation to data class constructor"; return
    elif echo "$msg" | grep -q "Modifier 'suspend'"; then
        echo "Make calling function suspend or wrap in coroutine scope"; return
    fi
    echo "Review error message and fix accordingly"
}

get_test_failure_suggested_fix() {
    local msg="$1"
    if echo "$msg" | grep -qE "expected.*but was"; then
        echo "Update expected value or fix the implementation"; return
    elif echo "$msg" | grep -qE "assertThat.*isInstanceOf"; then
        echo "Check object type or update test expectation"; return
    elif echo "$msg" | grep -q "NullPointerException"; then
        echo "Add null check or ensure object is initialized"; return
    elif echo "$msg" | grep -q "IndexOutOfBoundsException"; then
        echo "Check array/list bounds before accessing"; return
    elif echo "$msg" | grep -q "ClassCastException"; then
        echo "Verify object types match expected cast"; return
    elif echo "$msg" | grep -qi "timeout"; then
        echo "Increase timeout or optimize code performance"; return
    elif echo "$msg" | grep -qE "mock.*not.*stubbed"; then
        echo "Add stub for mock method call"; return
    elif echo "$msg" | grep -q "CancellationException"; then
        echo "Ensure coroutine scope is properly managed"; return
    fi
    echo "Review test failure message and adjust test or implementation"
}

parse_gradle_log() {
    local log_path="$1"
    if [[ ! -f "$log_path" ]]; then
        return
    fi

    local count=0
    while IFS= read -r line; do
        # Kotlin compilation error with file location: e: file:///path:line:col: message
        if [[ "$line" =~ e:\ file:///([^:]+):([0-9]+):([0-9]+):\ (.+)$ ]]; then
            local file_path="${BASH_REMATCH[1]}"
            local line_num="${BASH_REMATCH[2]}"
            local col_num="${BASH_REMATCH[3]}"
            local message="${BASH_REMATCH[4]}"
            local fix
            fix=$(get_suggested_fix "$message")

            echo "compilation|ERROR|${file_path}|${line_num}|${col_num}|${message}|${fix}" >> "$COMPILATION_ERRORS_FILE"
            count=$((count + 1))
        # KSP errors
        elif [[ "$line" =~ e:\ \[ksp\]\ (.+)$ ]]; then
            local message="${BASH_REMATCH[1]}"
            echo "ksp|ERROR|unknown|0|0|${message}|Check KSP annotation processing configuration" >> "$COMPILATION_ERRORS_FILE"
            count=$((count + 1))
        # Unresolved reference (standalone)
        elif [[ "$line" =~ Unresolved\ reference:\ (.+)$ ]]; then
            local ref="${BASH_REMATCH[1]}"
            echo "compilation|ERROR|unknown|0|0|Unresolved reference: ${ref}|Add import for '${ref}' or check if it exists in dependencies" >> "$COMPILATION_ERRORS_FILE"
            count=$((count + 1))
        fi
    done < "$log_path"

    COMPILATION_ERROR_COUNT=$count
}

get_test_results_path() {
    local module_path="$1"
    local platform="$2"
    local project_type="$3"

    local paths=()
    if [[ "$platform" == "desktop" || ("$platform" == "auto" && "$project_type" == "kmp-desktop") ]]; then
        paths+=("$module_path/build/test-results/desktopTest")
    fi
    if [[ "$platform" == "android" || "$platform" == "auto" ]]; then
        paths+=("$module_path/build/test-results/testDebugUnitTest")
    fi
    paths+=("$module_path/build/test-results")

    for p in "${paths[@]}"; do
        if [[ -d "$p" ]]; then
            echo "$p"
            return
        fi
    done
}

parse_test_failures() {
    local test_results_path="$1"
    if [[ -z "$test_results_path" || ! -d "$test_results_path" ]]; then
        return
    fi

    # Use python3 to parse JUnit XML files
    python3 -c "
import xml.etree.ElementTree as ET
import os, sys, re

results_path = sys.argv[1]
include_stack = sys.argv[2] == 'true'
output_file = sys.argv[3]

count = 0
with open(output_file, 'w') as out:
    for root_dir, dirs, files in os.walk(results_path):
        for fname in files:
            if not fname.startswith('TEST-') or not fname.endswith('.xml'):
                continue
            fpath = os.path.join(root_dir, fname)
            try:
                tree = ET.parse(fpath)
                root = tree.getroot()
                for tc in root.iter('testcase'):
                    failure = tc.find('failure')
                    error = tc.find('error')
                    fail_elem = failure if failure is not None else error
                    if fail_elem is None:
                        continue

                    fail_type = 'assertion_failure' if failure is not None else 'test_error'
                    classname = tc.get('classname', 'unknown')
                    testname = tc.get('name', 'unknown')
                    message = (fail_elem.get('message') or '').replace('|', ' ').replace('\n', ' ')[:200]
                    stack_text = (fail_elem.text or '')

                    # Find file location from stack trace
                    file_loc = 'unknown'
                    line_loc = '0'
                    for sline in stack_text.split('\n')[:10]:
                        m = re.search(r'([A-Za-z0-9_]+\\.kt):(\d+)', sline)
                        if m:
                            file_loc = m.group(1)
                            line_loc = m.group(2)
                            break

                    stack_output = stack_text.replace('|', ' ')[:500] if include_stack else ''

                    # Get suggested fix inline
                    fix = 'Review test failure message and adjust test or implementation'
                    if re.search(r'expected.*but was', message):
                        fix = 'Update expected value or fix the implementation'
                    elif 'NullPointerException' in message:
                        fix = 'Add null check or ensure object is initialized'
                    elif 'CancellationException' in message:
                        fix = 'Ensure coroutine scope is properly managed'
                    elif re.search(r'timeout', message, re.IGNORECASE):
                        fix = 'Increase timeout or optimize code performance'

                    out.write(f'{fail_type}|FAILURE|{classname}|{testname}|{message}|{file_loc}|{line_loc}|{stack_output}|{fix}\n')
                    count += 1
            except Exception as e:
                print(f'Warning: Failed to parse {fname}: {e}', file=sys.stderr)

print(count)
" "$test_results_path" "$INCLUDE_STACKTRACE" "$TEST_FAILURES_FILE" 2>/dev/null || echo "0"
}

parse_coverage_gaps() {
    local xml_path="$1"
    local output_file="$2"
    if [[ -z "$xml_path" || ! -f "$xml_path" ]]; then
        echo "0"
        return
    fi

    local parser_script="$SCRIPT_DIR/../lib/parse-coverage-xml.py"
    python3 "$parser_script" "$xml_path" "" --mode gaps --output-file "$output_file" 2>/dev/null || echo "0"
}

# --- Main Logic ---

project_type=$(get_project_type "$PROJECT_ROOT")
if [[ "$PLATFORM" == "auto" ]]; then
    if [[ "$project_type" == "kmp-desktop" ]]; then
        PLATFORM="desktop"
    else
        PLATFORM="android"
    fi
fi

echo ""
echo -e "${color_cyan}========================================${color_reset}"
echo -e "${color_cyan}  AI Error Extractor${color_reset}"
echo -e "${color_cyan}========================================${color_reset}"
echo -e "${color_white}Module: ${MODULE}${color_reset}"
echo -e "${color_white}Platform: ${PLATFORM}${color_reset}"
echo ""

# Extract compilation errors from gradle log
log_path="$PROJECT_ROOT/gradle-run-error.log"
if [[ -f "$log_path" ]]; then
    echo -e "${color_white}Extracting compilation errors...${color_reset}"
    parse_gradle_log "$log_path"
    if [[ $COMPILATION_ERROR_COUNT -eq 0 ]]; then
        echo -e "  ${color_green}Found: 0 error(s)${color_reset}"
    else
        echo -e "  ${color_yellow}Found: ${COMPILATION_ERROR_COUNT} error(s)${color_reset}"
    fi
fi

# Extract test failures
echo -e "${color_white}Extracting test failures...${color_reset}"
test_results_path=$(get_test_results_path "$MODULE_PATH" "$PLATFORM" "$project_type")
TEST_FAILURE_COUNT=$(parse_test_failures "$test_results_path")
TEST_FAILURE_COUNT=${TEST_FAILURE_COUNT:-0}
if [[ "$TEST_FAILURE_COUNT" -eq 0 ]]; then
    echo -e "  ${color_green}Found: 0 failure(s)${color_reset}"
else
    echo -e "  ${color_yellow}Found: ${TEST_FAILURE_COUNT} failure(s)${color_reset}"
fi

# Extract coverage gaps
echo -e "${color_white}Analyzing coverage gaps...${color_reset}"
# Detect coverage tool for the module
cov_build_file="$MODULE_PATH/build.gradle.kts"
cov_tool="$(detect_coverage_tool "$cov_build_file")"
is_desktop="false"
if [[ "$PLATFORM" == "desktop" ]]; then
    is_desktop="true"
fi
coverage_xml_path=""
coverage_xml_path="$(get_coverage_xml_path "$cov_tool" "$MODULE_PATH" "$is_desktop")" || true
COVERAGE_GAP_COUNT=$(parse_coverage_gaps "$coverage_xml_path" "$COVERAGE_GAPS_FILE")
COVERAGE_GAP_COUNT=${COVERAGE_GAP_COUNT:-0}
if [[ "$COVERAGE_GAP_COUNT" -eq 0 ]]; then
    echo -e "  ${color_green}Found: 0 file(s) with gaps${color_reset}"
else
    echo -e "  ${color_yellow}Found: ${COVERAGE_GAP_COUNT} file(s) with gaps${color_reset}"
fi

# Generate actionable items
echo ""
echo -e "${color_cyan}ACTIONABLE ITEMS:${color_reset}"
echo -e "${color_cyan}========================================${color_reset}"

ACTION_NUM=0
HIGH_PRIORITY_COUNT=0

# Compilation errors (highest priority)
if [[ -s "$COMPILATION_ERRORS_FILE" ]]; then
    while IFS='|' read -r type severity file line col message fix; do
        ACTION_NUM=$((ACTION_NUM + 1))
        HIGH_PRIORITY_COUNT=$((HIGH_PRIORITY_COUNT + 1))
        echo -e "${color_red}[${ACTION_NUM}] HIGH - Fix compilation error${color_reset}"
        echo -e "    ${color_gray}Location: ${file}:${line}:${col}${color_reset}"
        echo -e "    ${color_gray}Error: ${message}${color_reset}"
        echo -e "    ${color_yellow}Fix: ${fix}${color_reset}"
        echo ""
        echo "HIGH|Fix compilation error|${file}:${line}|${message}|${fix}" >> "$ACTIONABLE_ITEMS_FILE"
    done < "$COMPILATION_ERRORS_FILE"
fi

# Test failures (high priority)
if [[ -s "$TEST_FAILURES_FILE" ]]; then
    while IFS='|' read -r type severity classname testname message file line stack fix; do
        ACTION_NUM=$((ACTION_NUM + 1))
        HIGH_PRIORITY_COUNT=$((HIGH_PRIORITY_COUNT + 1))
        echo -e "${color_red}[${ACTION_NUM}] HIGH - Fix test failure${color_reset}"
        echo -e "    ${color_gray}Test: ${classname}.${testname}${color_reset}"
        echo -e "    ${color_gray}Message: ${message}${color_reset}"
        echo -e "    ${color_yellow}Fix: ${fix}${color_reset}"
        echo ""
        echo "HIGH|Fix test failure|${classname}.${testname}|${message}|${fix}" >> "$ACTIONABLE_ITEMS_FILE"
    done < "$TEST_FAILURES_FILE"
fi

# Coverage gaps (lower priority, top 5)
if [[ -s "$COVERAGE_GAPS_FILE" ]]; then
    local_count=0
    while IFS='|' read -r file pkg missed total pct ranges; do
        if [[ $local_count -ge 5 ]]; then break; fi
        ACTION_NUM=$((ACTION_NUM + 1))
        local_count=$((local_count + 1))
        echo -e "${color_yellow}[${ACTION_NUM}] MEDIUM - Add test coverage${color_reset}"
        echo -e "    ${color_gray}File: ${file}${color_reset}"
        echo -e "    ${color_gray}Lines: ${ranges}${color_reset}"
        echo -e "    ${color_gray}Coverage: ${pct}%${color_reset}"
        echo ""
        echo "MEDIUM|Add test coverage|${file}|${missed} uncovered lines (${pct}% coverage)|Add tests to cover lines: ${ranges}" >> "$ACTIONABLE_ITEMS_FILE"
    done < "$COVERAGE_GAPS_FILE"

    remaining=$((COVERAGE_GAP_COUNT - 5))
    if [[ $remaining -gt 0 ]]; then
        echo -e "${color_gray}... and ${remaining} more files with coverage gaps${color_reset}"
        echo ""
    fi
fi

# Summary
echo -e "${color_cyan}========================================${color_reset}"
echo -e "${color_cyan}SUMMARY:${color_reset}"
if [[ $COMPILATION_ERROR_COUNT -eq 0 ]]; then
    echo -e "  ${color_green}Compilation Errors: ${COMPILATION_ERROR_COUNT}${color_reset}"
else
    echo -e "  ${color_red}Compilation Errors: ${COMPILATION_ERROR_COUNT}${color_reset}"
fi
if [[ $TEST_FAILURE_COUNT -eq 0 ]]; then
    echo -e "  ${color_green}Test Failures: ${TEST_FAILURE_COUNT}${color_reset}"
else
    echo -e "  ${color_red}Test Failures: ${TEST_FAILURE_COUNT}${color_reset}"
fi
if [[ $COVERAGE_GAP_COUNT -eq 0 ]]; then
    echo -e "  ${color_green}Coverage Gaps: ${COVERAGE_GAP_COUNT} files${color_reset}"
else
    echo -e "  ${color_yellow}Coverage Gaps: ${COVERAGE_GAP_COUNT} files${color_reset}"
fi
echo -e "  ${color_cyan}Total Actions: ${ACTION_NUM}${color_reset}"
echo ""

# JSON output if requested
if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo -e "${color_cyan}JSON OUTPUT:${color_reset}"
    python3 -c "
import json, sys

module = sys.argv[1]
project_root = sys.argv[2]
platform = sys.argv[3]
timestamp = sys.argv[4]
comp_file = sys.argv[5]
test_file = sys.argv[6]
cov_file = sys.argv[7]
actions_file = sys.argv[8]

output = {
    'module': module,
    'projectRoot': project_root,
    'platform': platform,
    'timestamp': timestamp,
    'compilationErrors': [],
    'testFailures': [],
    'coverageGaps': [],
    'actionableItems': []
}

# Parse compilation errors
try:
    with open(comp_file) as f:
        for line in f:
            parts = line.strip().split('|')
            if len(parts) >= 7:
                output['compilationErrors'].append({
                    'type': parts[0], 'severity': parts[1], 'file': parts[2],
                    'line': int(parts[3]), 'column': int(parts[4]),
                    'message': parts[5], 'suggestedFix': parts[6]
                })
except: pass

# Parse test failures
try:
    with open(test_file) as f:
        for line in f:
            parts = line.strip().split('|')
            if len(parts) >= 9:
                output['testFailures'].append({
                    'type': parts[0], 'severity': parts[1], 'class': parts[2],
                    'test': parts[3], 'message': parts[4], 'file': parts[5],
                    'line': int(parts[6]), 'stackTrace': parts[7] if parts[7] else None,
                    'suggestedFix': parts[8]
                })
except: pass

# Parse coverage gaps
try:
    with open(cov_file) as f:
        for line in f:
            parts = line.strip().split('|')
            if len(parts) >= 6:
                output['coverageGaps'].append({
                    'type': 'coverage_gap', 'severity': 'WARNING',
                    'file': parts[0], 'package': parts[1],
                    'linesMissed': int(parts[2]), 'linesTotal': int(parts[3]),
                    'percentage': float(parts[4]), 'missedRanges': parts[5],
                    'suggestedFix': f'Add tests to cover lines: {parts[5]}'
                })
except: pass

# Parse actionable items
try:
    with open(actions_file) as f:
        for line in f:
            parts = line.strip().split('|')
            if len(parts) >= 5:
                output['actionableItems'].append({
                    'priority': parts[0], 'action': parts[1],
                    'location': parts[2], 'description': parts[3],
                    'suggestedFix': parts[4]
                })
except: pass

print(json.dumps(output, indent=2))
" "$MODULE" "$PROJECT_ROOT" "$PLATFORM" "$TIMESTAMP" \
  "$COMPILATION_ERRORS_FILE" "$TEST_FAILURES_FILE" "$COVERAGE_GAPS_FILE" "$ACTIONABLE_ITEMS_FILE"
fi

# Exit code based on high priority items
if [[ $HIGH_PRIORITY_COUNT -gt 0 ]]; then
    exit 1
fi
exit 0
