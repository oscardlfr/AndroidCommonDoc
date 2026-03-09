#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/audit-append.sh"

# pattern-lint.sh — Deterministic code pattern checks.
#
# Checks patterns that agents currently waste model tokens on.
# All checks are pure grep/find — no AI reasoning needed.
#
# Usage:
#   ./pattern-lint.sh [--project-root DIR] [--show-details] [--check CHECK,...] [--fix]
#
# Checks:
#   cancellation-rethrow   CancellationException not rethrown in catch blocks
#   mutable-shared-flow    MutableSharedFlow in non-test production code
#   forbidden-jvm-imports  java.time.*, java.text.*, java.security.* in commonMain
#   println-in-prod        println()/System.err.println() in production code
#   todo-crash             TODO("Not yet implemented") crash points
#   system-time            System.currentTimeMillis() in commonMain
#   run-blocking           runBlocking outside test code
#   global-scope           GlobalScope usage

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
GRAY='\033[90m'
RESET='\033[0m'

# --- Argument parsing ---
PROJECT_ROOT="$(pwd)"
SHOW_DETAILS=false
CHECKS=""  # empty = all
FIX_MODE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --show-details)
            SHOW_DETAILS=true
            shift
            ;;
        --check)
            CHECKS="$2"
            shift 2
            ;;
        --fix)
            FIX_MODE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--project-root DIR] [--show-details] [--check CHECK,...] [--fix]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Determine which checks to run
should_run() {
    [[ -z "$CHECKS" ]] && return 0
    echo ",$CHECKS," | grep -q ",$1,"
}

ERRORS=0
WARNINGS=0
TOTAL_CHECKS=0

# Common grep excludes for performance (skip node_modules, .gradle, .git, build)
GREP_EXCLUDES=(--exclude-dir=node_modules --exclude-dir=.gradle --exclude-dir=.git --exclude-dir=build)

# Helper: scan production .kt files, excluding test dirs and test/fake files
scan_prod() {
    local base_dir="$1"
    local pattern="$2"
    grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "$pattern" "$base_dir" 2>/dev/null \
        | grep -v "/test/" | grep -v "/androidTest/" | grep -v "/commonTest/" \
        | grep -v "/build/" \
        | grep -v "Test.kt:" | grep -v "Fake" | grep -v "Mock" || true
}

report_check() {
    local name="$1"
    local count="$2"
    local severity="$3"  # ERROR or WARNING
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [[ $count -eq 0 ]]; then
        echo -e "  ${GREEN}[OK]${RESET} $name"
    elif [[ "$severity" == "ERROR" ]]; then
        echo -e "  ${RED}[FAIL]${RESET} $name -- $count issues"
        ERRORS=$((ERRORS + count))
    else
        echo -e "  ${YELLOW}[WARN]${RESET} $name -- $count issues"
        WARNINGS=$((WARNINGS + count))
    fi
}

show_details() {
    local base_dir="$1"
    local pattern="$2"
    local max_lines="${3:-10}"
    if [[ "$SHOW_DETAILS" == "true" ]]; then
        scan_prod "$base_dir" "$pattern" | head -"$max_lines" | while IFS= read -r line; do
            echo -e "    ${GRAY}$line${RESET}"
        done
    fi
}

echo -e "${CYAN}Pattern Lint${RESET} -- $(basename "$PROJECT_ROOT")"
echo ""

# --- Check 1: CancellationException not rethrown ---
if should_run "cancellation-rethrow"; then
    ce_hits=0
    if [[ -d "$PROJECT_ROOT" ]]; then
        ce_hits=$({ grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" -E 'catch\s*\([^)]*:\s*(Exception|Throwable)\)' "$PROJECT_ROOT" 2>/dev/null \
            | grep -v "/test/" | grep -v "/androidTest/" | grep -v "/commonTest/" \
            | grep -v "/build/" \
            | grep -v "Test.kt:" || true; } | wc -l | tr -d ' ')
    fi
    report_check "cancellation-rethrow" "$ce_hits" "ERROR"
    if [[ "$SHOW_DETAILS" == "true" ]] && [[ $ce_hits -gt 0 ]]; then
        { grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" -E 'catch\s*\([^)]*:\s*(Exception|Throwable)\)' "$PROJECT_ROOT" 2>/dev/null \
            | grep -v "/test/" | grep -v "/androidTest/" | grep -v "/commonTest/" \
            | grep -v "/build/" \
            | grep -v "Test.kt:" || true; } | head -10 | while IFS= read -r line; do
            echo -e "    ${GRAY}$line${RESET}"
        done
    fi
fi

# --- Check 2: MutableSharedFlow in production code ---
if should_run "mutable-shared-flow"; then
    msf_hits=$(scan_prod "$PROJECT_ROOT" "MutableSharedFlow" | wc -l | tr -d ' ')
    report_check "mutable-shared-flow" "$msf_hits" "WARNING"
    show_details "$PROJECT_ROOT" "MutableSharedFlow"
fi

# --- Check 3: Forbidden JVM imports in commonMain ---
if should_run "forbidden-jvm-imports"; then
    jvm_hits=0
    for pattern in "import java.time" "import java.text" "import java.security"; do
        count=$({ grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "$pattern" "$PROJECT_ROOT" 2>/dev/null \
            | grep "/commonMain/" | grep -v "/build/" || true; } | wc -l | tr -d ' ')
        jvm_hits=$((jvm_hits + count))
    done
    report_check "forbidden-jvm-imports" "$jvm_hits" "ERROR"
    if [[ "$SHOW_DETAILS" == "true" ]] && [[ $jvm_hits -gt 0 ]]; then
        for pattern in "import java.time" "import java.text" "import java.security"; do
            { grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "$pattern" "$PROJECT_ROOT" 2>/dev/null \
                | grep "/commonMain/" | grep -v "/build/" || true; } | head -5 | while IFS= read -r line; do
                echo -e "    ${GRAY}$line${RESET}"
            done
        done
    fi
fi

# --- Check 4: println in production code ---
if should_run "println-in-prod"; then
    println_hits=$(scan_prod "$PROJECT_ROOT" "println(" | wc -l | tr -d ' ')
    syserr_hits=$(scan_prod "$PROJECT_ROOT" "System.err.println" | wc -l | tr -d ' ')
    sysout_hits=$(scan_prod "$PROJECT_ROOT" "System.out.print" | wc -l | tr -d ' ')
    total=$((println_hits + syserr_hits + sysout_hits))
    report_check "println-in-prod" "$total" "WARNING"
    if [[ "$SHOW_DETAILS" == "true" ]] && [[ $total -gt 0 ]]; then
        scan_prod "$PROJECT_ROOT" "println\|System.err.println\|System.out.print" | head -10 | while IFS= read -r line; do
            echo -e "    ${GRAY}$line${RESET}"
        done
    fi
fi

# --- Check 5: TODO("Not yet implemented") crash points ---
if should_run "todo-crash"; then
    todo_hits=$(scan_prod "$PROJECT_ROOT" 'TODO("Not yet implemented")' | wc -l | tr -d ' ')
    report_check "todo-crash" "$todo_hits" "ERROR"
    show_details "$PROJECT_ROOT" 'TODO("Not yet implemented")'
fi

# --- Check 6: System.currentTimeMillis() in commonMain ---
if should_run "system-time"; then
    time_hits=$({ grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "System.currentTimeMillis" "$PROJECT_ROOT" 2>/dev/null \
        | grep "/commonMain/" | grep -v "/build/" || true; } | wc -l | tr -d ' ')
    report_check "system-time" "$time_hits" "ERROR"
    if [[ "$SHOW_DETAILS" == "true" ]] && [[ $time_hits -gt 0 ]]; then
        { grep -rn --include="*.kt" "${GREP_EXCLUDES[@]}" "System.currentTimeMillis" "$PROJECT_ROOT" 2>/dev/null \
            | grep "/commonMain/" | grep -v "/build/" || true; } | head -10 | while IFS= read -r line; do
            echo -e "    ${GRAY}$line${RESET}"
        done
    fi
fi

# --- Check 7: runBlocking outside test code ---
if should_run "run-blocking"; then
    rb_hits=$(scan_prod "$PROJECT_ROOT" "runBlocking" | wc -l | tr -d ' ')
    report_check "run-blocking" "$rb_hits" "WARNING"
    show_details "$PROJECT_ROOT" "runBlocking"
fi

# --- Check 8: GlobalScope usage ---
if should_run "global-scope"; then
    gs_hits=$(scan_prod "$PROJECT_ROOT" "GlobalScope" | wc -l | tr -d ' ')
    report_check "global-scope" "$gs_hits" "WARNING"
    show_details "$PROJECT_ROOT" "GlobalScope"
fi

# --- Summary ---
echo ""
TOTAL=$((ERRORS + WARNINGS))
if [[ $TOTAL -eq 0 ]]; then
    echo -e "${GREEN}PASS${RESET} -- all $TOTAL_CHECKS checks clean"
    RESULT="pass"
elif [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}FAIL${RESET} -- $ERRORS errors, $WARNINGS warnings across $TOTAL_CHECKS checks"
    RESULT="fail"
else
    echo -e "${YELLOW}WARN${RESET} -- $WARNINGS warnings across $TOTAL_CHECKS checks"
    RESULT="warn"
fi

# Append to audit log
audit_append "$PROJECT_ROOT" "pattern_lint" "$RESULT" \
    "\"errors\":$ERRORS,\"warnings\":$WARNINGS,\"checks\":$TOTAL_CHECKS"

exit $( [[ $ERRORS -gt 0 ]] && echo 1 || echo 0 )
