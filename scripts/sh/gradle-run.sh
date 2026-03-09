#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Universal Gradle Runner with smart retry logic for KMP/Android projects.
#
# Implements intelligent retry strategy:
#   - Attempt 1: Fast run
#   - Attempt 2: Stop daemons + Clean + Run
# Automatically detects compilation errors vs environment issues.
#
# Usage:
#   ./gradle-run.sh <module> <task> [options]
#   ./gradle-run.sh --project-root ~/Projects/MyProject core:data desktopTest
#   ./gradle-run.sh - build   # Root project build
#
# Options:
#   --project-root <path>   Project root (default: current directory)
#   --platform <auto|android|desktop>
#   --test-type <all|common|androidUnit|androidInstrumented|desktop>
#   --search-pattern <regex>
#   --skip-coverage
#   --timeout <seconds>     Default: 300
# =============================================================================

# Defaults
PROJECT_ROOT="$(pwd)"
MODULE=""
TASK=""
PLATFORM="auto"
TEST_TYPE=""
SEARCH_PATTERN=""
SKIP_COVERAGE=false
COVERAGE_TOOL="auto"
TIMEOUT=300
ADDITIONAL_ARGS=()

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"; shift 2 ;;
        --platform)
            PLATFORM="$2"; shift 2 ;;
        --test-type)
            TEST_TYPE="$2"; shift 2 ;;
        --search-pattern)
            SEARCH_PATTERN="$2"; shift 2 ;;
        --skip-coverage)
            SKIP_COVERAGE=true; shift ;;
        --coverage-tool)
            COVERAGE_TOOL="$2"; shift 2 ;;
        --timeout)
            TIMEOUT="$2"; shift 2 ;;
        --)
            shift; ADDITIONAL_ARGS+=("$@"); break ;;
        -*)
            ADDITIONAL_ARGS+=("$1"); shift ;;
        *)
            if [[ -z "$MODULE" ]]; then
                MODULE="$1"
            elif [[ -z "$TASK" ]]; then
                TASK="$1"
            else
                ADDITIONAL_ARGS+=("$1")
            fi
            shift
            ;;
    esac
done

# Source coverage detection library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/coverage-detect.sh"

START_TIME=$(date +%s)
LOG_FILE="$PROJECT_ROOT/gradle-run-error.log"

# Color helpers
color_cyan="\033[36m"
color_green="\033[32m"
color_red="\033[31m"
color_yellow="\033[33m"
color_magenta="\033[35m"
color_gray="\033[90m"
color_reset="\033[0m"

write_step() {
    local message="$1"
    local color="${2:-$color_cyan}"
    echo ""
    echo -e "${color}>>> ${message}${color_reset}"
    echo ""
}

get_project_type() {
    local root="$1"
    if [[ -d "$root/desktopApp" ]]; then
        echo "kmp-desktop"; return
    fi
    if [[ -f "$root/app/build.gradle.kts" ]]; then
        echo "android"; return
    fi
    local settings_path="$root/settings.gradle.kts"
    if [[ -f "$settings_path" ]]; then
        if grep -qE "desktopApp|iosApp|macosApp" "$settings_path" 2>/dev/null; then
            echo "kmp-desktop"; return
        fi
    fi
    echo "android"
}

get_test_task() {
    local project_type="$1"
    local requested_platform="$2"

    if [[ "$requested_platform" == "desktop" ]]; then
        echo "desktopTest"; return
    fi
    if [[ "$requested_platform" == "android" ]]; then
        echo "testDebugUnitTest"; return
    fi
    # Auto-detect
    if [[ "$project_type" == "kmp-desktop" ]]; then
        echo "desktopTest"; return
    fi
    echo "testDebugUnitTest"
}

# Returns space-separated list of tasks (for "all" type)
get_test_task_by_type() {
    local test_type="$1"
    local project_type="$2"

    case "$test_type" in
        common)
            echo "desktopTest" ;;
        androidUnit)
            echo "testDebugUnitTest" ;;
        androidInstrumented)
            echo "connectedDebugAndroidTest" ;;
        desktop)
            echo "desktopTest" ;;
        all)
            if [[ "$project_type" == "kmp-desktop" ]]; then
                echo "desktopTest testDebugUnitTest"
            else
                echo "testDebugUnitTest"
            fi
            ;;
        *)
            get_test_task "$project_type" "auto"
            ;;
    esac
}

get_compilation_errors() {
    local log_path="$1"
    if [[ ! -f "$log_path" ]]; then
        return
    fi

    # Broad match for "e: " lines (Kotlin compiler errors)
    local found
    found=$(grep -n '^\s*e: ' "$log_path" 2>/dev/null | head -20) || true

    if [[ -z "$found" ]]; then
        found=$(grep -n 'FAILED' "$log_path" 2>/dev/null | head -20) || true
    fi

    if [[ -z "$found" ]]; then
        found=$(grep -n -A 10 'What went wrong:' "$log_path" 2>/dev/null | head -30) || true
    fi

    echo "$found"
}

show_errors() {
    local errors="$1"
    local custom_pattern="${2:-}"

    if [[ -z "$errors" && -z "$custom_pattern" ]]; then
        echo -e "  ${color_gray}No structured Kotlin errors found.${color_reset}"
        return
    fi

    if [[ -n "$errors" ]]; then
        echo ""
        echo -e "${color_yellow}--- Compilation/Test Errors ---${color_reset}"

        local count=0
        while IFS= read -r line; do
            if [[ $count -ge 20 ]]; then break; fi
            echo -e "  ${color_red}${line}${color_reset}"
            count=$((count + 1))
        done <<< "$errors"
    fi

    if [[ -n "$custom_pattern" && -f "$LOG_FILE" ]]; then
        echo ""
        echo -e "${color_cyan}--- Custom Search: '${custom_pattern}' ---${color_reset}"
        local matches
        matches=$(grep -E -A 5 -B 2 "$custom_pattern" "$LOG_FILE" 2>/dev/null | head -50) || true
        if [[ -z "$matches" ]]; then
            echo -e "  ${color_gray}No matches found.${color_reset}"
        else
            while IFS= read -r line; do
                echo -e "  ${color_magenta}${line}${color_reset}"
            done <<< "$matches"
        fi
    fi
}

test_daemon_error() {
    local log_content="$1"
    local exit_code="${2:-0}"

    if [[ "$exit_code" -eq 124 ]]; then return 0; fi
    if echo "$log_content" | grep -q "DaemonDisappearedException"; then return 0; fi
    if echo "$log_content" | grep -q "Metaspace"; then return 0; fi
    if echo "$log_content" | grep -q "OutOfMemoryError"; then return 0; fi
    if echo "$log_content" | grep -q "TimeoutException"; then return 0; fi
    if echo "$log_content" | grep -q "GradleConnectionException"; then return 0; fi
    if echo "$log_content" | grep -qE "The execution of .* failed"; then return 0; fi
    return 1
}

invoke_gradle() {
    local task_name="$1"
    local module_name="$2"
    local clean_first="${3:-false}"
    local stop_daemon_first="${4:-false}"
    local timeout_sec="${5:-300}"
    shift 5
    local extra_args=("$@")

    if [[ "$stop_daemon_first" == "true" ]]; then
        write_step "Strategy: Stopping Daemons + Clean + Run" "$color_magenta"
        echo -e "${color_gray}Stopping Gradle daemons...${color_reset}"
        ./gradlew --stop >/dev/null 2>&1 || true
    elif [[ "$clean_first" == "true" ]]; then
        write_step "Strategy: Clean + Run" "$color_magenta"
    else
        write_step "Strategy: Fast Run" "$color_magenta"
    fi

    if [[ "$clean_first" == "true" || "$stop_daemon_first" == "true" ]]; then
        echo -e "${color_gray}Cleaning...${color_reset}"
        if [[ "$module_name" == "-" || -z "$module_name" ]]; then
            ./gradlew clean --console=plain >/dev/null 2>&1 || true
        else
            local clean_task=":${module_name}:clean"
            ./gradlew "$clean_task" --console=plain >/dev/null 2>&1 || true
        fi
    fi

    echo -e "${color_cyan}Running task: ${task_name} (timeout: ${timeout_sec}s)${color_reset}"

    local gradle_task
    if [[ "$module_name" == "-" || -z "$module_name" ]]; then
        gradle_task="$task_name"
    else
        gradle_task=":${module_name}:${task_name}"
    fi

    local all_args=("$gradle_task" "--console=plain" "--stacktrace")
    if [[ ${#extra_args[@]} -gt 0 ]]; then
        all_args+=("${extra_args[@]}")
    fi

    local temp_log
    temp_log="${TMPDIR:-/tmp}/gradle-run-$(date +%Y%m%d-%H%M%S).log"

    local gradle_pid
    local elapsed=0
    local interval=15

    # Run Gradle in background
    ./gradlew "${all_args[@]}" >"$temp_log" 2>&1 &
    gradle_pid=$!

    while kill -0 "$gradle_pid" 2>/dev/null; do
        sleep "$interval"
        elapsed=$((elapsed + interval))

        local mins=$((elapsed / 60))
        local secs=$((elapsed % 60))
        echo -e "  ${color_gray}[${mins}m${secs}s] Still running...${color_reset}"

        if [[ $elapsed -ge $timeout_sec ]]; then
            echo -e "${color_red}[TIMEOUT] Exceeded ${timeout_sec}s! Killing...${color_reset}"
            kill "$gradle_pid" 2>/dev/null || true
            # Kill any lingering Gradle worker processes
            pkill -f "GradleWorkerMain" 2>/dev/null || true
            sleep 2
            break
        fi
    done

    # Wait for process to finish and get exit code
    local raw_exit=0
    wait "$gradle_pid" 2>/dev/null || raw_exit=$?

    local cmd_output=""
    if [[ -f "$temp_log" ]]; then
        cmd_output=$(cat "$temp_log")
        rm -f "$temp_log"
    fi

    local exit_code
    if [[ $elapsed -ge $timeout_sec ]]; then
        exit_code=124
    else
        exit_code=$raw_exit
    fi

    local timed_out="false"
    if [[ $elapsed -ge $timeout_sec ]]; then
        timed_out="true"
    fi

    # Return values via global variables (bash doesn't support returning associative arrays)
    RESULT_EXIT_CODE=$exit_code
    RESULT_OUTPUT="$cmd_output"
    RESULT_TIMED_OUT="$timed_out"
}

# --- Main Logic ---

cleanup() {
    # Return to original directory on exit
    cd "$OLDPWD" 2>/dev/null || true
}
trap cleanup EXIT

if [[ -z "$TASK" ]]; then
    echo -e "${color_yellow}Usage: ./gradle-run.sh [--project-root <path>] <module> <task> [args...]${color_reset}"
    echo ""
    echo -e "${color_cyan}Examples:${color_reset}"
    echo "  ./gradle-run.sh core:data desktopTest"
    echo "  ./gradle-run.sh --project-root ~/Projects/MyProject core:domain test"
    echo "  ./gradle-run.sh - build   # Root project build"
    exit 1
fi

OLDPWD="$(pwd)"
cd "$PROJECT_ROOT"

project_type=$(get_project_type "$PROJECT_ROOT")
echo -e "${color_gray}Project Type: ${project_type}${color_reset}"

# Resolve test task if generic "test" was requested
if [[ "$TASK" == "test" ]]; then
    if [[ -n "$TEST_TYPE" ]]; then
        resolved_tasks=$(get_test_task_by_type "$TEST_TYPE" "$project_type")
        # Check if multiple tasks (space-separated)
        task_count=$(echo "$resolved_tasks" | wc -w)
        if [[ $task_count -gt 1 ]]; then
            echo -e "${color_cyan}Test Type 'all' specified - will run: ${resolved_tasks}${color_reset}"
        fi
        # Use first task
        TASK=$(echo "$resolved_tasks" | awk '{print $1}')
        echo -e "${color_gray}Test Type: ${TEST_TYPE} -> Task: ${TASK}${color_reset}"
    else
        TASK=$(get_test_task "$project_type" "$PLATFORM")
        echo -e "${color_gray}Resolved Task: ${TASK}${color_reset}"
    fi
fi

attempt=1
max_attempts=2
RESULT_EXIT_CODE=1
RESULT_OUTPUT=""
RESULT_TIMED_OUT="false"

while [[ $attempt -le $max_attempts ]]; do
    clean="false"
    stop="false"

    if [[ $attempt -eq 2 ]]; then
        clean="true"
        stop="true"
        # Also stop shared-libs daemons (composite build)
        shared_path="$(dirname "$PROJECT_ROOT")/shared-libs"
        if [[ -d "$shared_path" ]]; then
            echo -e "${color_gray}Stopping shared-libs daemons...${color_reset}"
            (
                cd "$shared_path"
                ./gradlew --stop >/dev/null 2>&1 || true
                ./gradlew clean --console=plain >/dev/null 2>&1 || true
            )
        fi
    fi

    invoke_gradle "$TASK" "$MODULE" "$clean" "$stop" "$TIMEOUT" "${ADDITIONAL_ARGS[@]+"${ADDITIONAL_ARGS[@]}"}"

    if [[ $RESULT_EXIT_CODE -eq 0 ]]; then
        end_time=$(date +%s)
        total_duration=$((end_time - START_TIME))
        total_min=$((total_duration / 60))
        total_sec=$((total_duration % 60))

        echo ""
        echo -e "${color_green}========================================${color_reset}"
        echo -e "${color_green}  BUILD SUCCESSFUL${color_reset}"
        printf "${color_green}  Total Duration: %02d:%02d${color_reset}\n" "$total_min" "$total_sec"
        echo -e "${color_green}========================================${color_reset}"

        # Generate coverage report if this was a test task
        if [[ "$SKIP_COVERAGE" == "false" && "$TASK" == *test* && "$MODULE" != "-" && -n "$MODULE" ]]; then
            # Resolve coverage tool
            cov_tool="$COVERAGE_TOOL"
            if [[ "$cov_tool" == "auto" ]]; then
                build_file="$PROJECT_ROOT/${MODULE//://}/build.gradle.kts"
                cov_tool="$(detect_coverage_tool "$build_file")"
            fi
            is_desktop="false"
            if [[ "$PLATFORM" == "desktop" || "$project_type" == "kmp-desktop" ]]; then
                is_desktop="true"
            fi
            cov_task_name="$(get_coverage_gradle_task "$cov_tool" "" "$is_desktop")"
            if [[ -n "$cov_task_name" ]]; then
                echo ""
                echo -e "${color_cyan}Generating coverage report ($(get_coverage_display_name "$cov_tool"))...${color_reset}"
                full_cov_task=":${MODULE}:${cov_task_name}"
                if ./gradlew "$full_cov_task" --console=plain >/dev/null 2>&1; then
                    echo -e "${color_green}Coverage report generated.${color_reset}"
                fi
            fi
        fi
        exit 0
    fi

    # Save output to log file
    echo "$RESULT_OUTPUT" > "$LOG_FILE"

    is_daemon=false
    if test_daemon_error "$RESULT_OUTPUT" "$RESULT_EXIT_CODE"; then
        is_daemon=true
    fi

    echo -e "${color_red}Attempt ${attempt} failed. (Exit Code: ${RESULT_EXIT_CODE})${color_reset}"

    if [[ $attempt -lt $max_attempts ]]; then
        if [[ "$is_daemon" == "true" ]]; then
            echo -e "${color_yellow}Detected Daemon/Resource error. Escalating...${color_reset}"
            attempt=3  # Jump to full reset
            continue
        fi
        echo -e "${color_yellow}Retrying...${color_reset}"
    fi

    attempt=$((attempt + 1))
done

# Timeout-specific reporting
if [[ "$RESULT_TIMED_OUT" == "true" ]]; then
    echo ""
    echo -e "${color_red}[TIMEOUT] Module ${MODULE} timed out after ${TIMEOUT}s${color_reset}"
    echo -e "${color_yellow}[TIMEOUT] Possible causes: infinite loop, deadlock, OOM${color_reset}"
    echo -e "${color_yellow}[TIMEOUT] Try: --clean --module ${MODULE}${color_reset}"
fi

# Final Failure
echo ""
echo -e "${color_red}Final Attempt Failed.${color_reset}"
echo -e "${color_yellow}Full log saved to: ${LOG_FILE}${color_reset}"

# Show errors
final_errors=""
if [[ "$TASK" == *test* ]]; then
    assertion_errors=$(grep -A 10 "AssertionError" "$LOG_FILE" 2>/dev/null | head -30) || true
    final_errors="$assertion_errors"
fi
compilation_errors=$(get_compilation_errors "$LOG_FILE")
if [[ -n "$compilation_errors" ]]; then
    if [[ -n "$final_errors" ]]; then
        final_errors="${final_errors}
${compilation_errors}"
    else
        final_errors="$compilation_errors"
    fi
fi

show_errors "$final_errors" "$SEARCH_PATTERN"

exit 1
