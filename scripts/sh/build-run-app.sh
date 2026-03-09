#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Build, install and run Android/Desktop apps with automatic log capture.
#
# Automates the complete debug workflow:
#   - Android: build -> uninstall -> install -> clear logcat -> launch -> capture logs
#   - Desktop: build and run with stdout capture
#
# Exit codes: 0=success, 1=build fail, 2=install fail, 3=launch fail, 4=no device
#
# Usage:
#   ./build-run-app.sh --project-root ~/Projects/MyProject android
#   ./build-run-app.sh --project-root ~/Projects/MyProject desktop
#   ./build-run-app.sh --project-root ~/Projects/MyProject android --filter "HUE,MQTT" --clean
#
# Options:
#   --project-root <path>   Project root (required)
#   --filter <tags>         Comma-separated log tags (default: CLAUDE_DEBUG)
#   --device <serial>       ADB device serial
#   --flavor <name>         Android build flavor (default: demo)
#   --duration <seconds>    Log capture duration (default: 30)
#   --clean                 Force clean build
#   --json                  Output JSON format
# =============================================================================

# Defaults
PROJECT_ROOT=""
TARGET="auto"
FILTER="CLAUDE_DEBUG"
DEVICE=""
CLEAN=false
FLAVOR="demo"
LOG_DURATION=30
OUTPUT_FORMAT="human"
IS_JSON=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"; shift 2 ;;
        --filter)
            FILTER="$2"; shift 2 ;;
        --device)
            DEVICE="$2"; shift 2 ;;
        --flavor)
            FLAVOR="$2"; shift 2 ;;
        --duration)
            LOG_DURATION="$2"; shift 2 ;;
        --clean)
            CLEAN=true; shift ;;
        --json)
            IS_JSON=true; OUTPUT_FORMAT="json"; shift ;;
        android|desktop|demo|prod)
            TARGET="$1"; shift ;;
        *)
            if [[ -z "$PROJECT_ROOT" && ! "$1" =~ ^-- ]]; then
                PROJECT_ROOT="$1"
            elif [[ "$TARGET" == "auto" && ! "$1" =~ ^- ]]; then
                TARGET="$1"
            fi
            shift
            ;;
    esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
    echo "Error: --project-root is required"
    echo "Usage: ./build-run-app.sh --project-root <path> [android|desktop] [options]"
    exit 1
fi

# Color helpers
color_cyan="\033[36m"
color_green="\033[32m"
color_red="\033[31m"
color_yellow="\033[33m"
color_gray="\033[90m"
color_reset="\033[0m"

# Result tracking (stored as variables for JSON output)
RESULT_STATUS="unknown"
RESULT_STEPS=()
RESULT_ERRORS=()
RESULT_BUILD_LOG=""
RESULT_DEBUG_LOG=""
RESULT_FULL_LOG=""
RESULT_DEVICE_SERIAL=""
RESULT_DEVICE_MODEL=""
RESULT_APP_PACKAGE=""
RESULT_APP_ACTIVITY=""
RESULT_APP_APK=""
PROJECT_NAME=$(basename "$PROJECT_ROOT")
START_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S")

write_step() {
    local step="$1"
    local status="$2"
    local message="${3:-}"
    RESULT_STEPS+=("${step}|${status}|${message}")

    if [[ "$IS_JSON" == "false" ]]; then
        local icon
        case "$status" in
            start)   icon="[...]" ;;
            success) icon="[OK]" ;;
            fail)    icon="[FAIL]" ;;
            skip)    icon="[SKIP]" ;;
            *)       icon="[?]" ;;
        esac
        local color
        case "$status" in
            start)   color="$color_yellow" ;;
            success) color="$color_green" ;;
            fail)    color="$color_red" ;;
            skip)    color="$color_yellow" ;;
            *)       color="$color_reset" ;;
        esac
        local text
        if [[ -n "$message" ]]; then
            text="$icon $step - $message"
        else
            text="$icon $step"
        fi
        echo -e "${color}${text}${color_reset}"
    fi
}

write_info() {
    if [[ "$IS_JSON" == "false" ]]; then
        echo -e "    ${color_gray}$1${color_reset}"
    fi
}

write_error_custom() {
    RESULT_ERRORS+=("$1")
    if [[ "$IS_JSON" == "false" ]]; then
        echo -e "${color_red}[ERROR] $1${color_reset}"
    fi
}

write_json_result() {
    python3 -c "
import json, sys

result = {
    'projectRoot': sys.argv[1],
    'projectName': sys.argv[2],
    'target': sys.argv[3],
    'startTime': sys.argv[4],
    'status': sys.argv[5],
    'logs': {
        'buildLog': sys.argv[6],
        'debugLog': sys.argv[7],
        'fullLog': sys.argv[8]
    },
    'device': {
        'serial': sys.argv[9],
        'model': sys.argv[10]
    },
    'app': {
        'package': sys.argv[11],
        'activity': sys.argv[12],
        'apkPath': sys.argv[13]
    },
    'errors': sys.argv[14].split(';;') if sys.argv[14] else [],
    'steps': []
}

# Parse steps
for step_str in sys.argv[15].split(';;'):
    if not step_str:
        continue
    parts = step_str.split('|', 2)
    if len(parts) >= 2:
        result['steps'].append({
            'step': parts[0],
            'status': parts[1],
            'message': parts[2] if len(parts) > 2 else ''
        })

print(json.dumps(result, indent=2))
" "$PROJECT_ROOT" "$PROJECT_NAME" "$TARGET" "$START_TIMESTAMP" "$RESULT_STATUS" \
  "$RESULT_BUILD_LOG" "$RESULT_DEBUG_LOG" "$RESULT_FULL_LOG" \
  "$RESULT_DEVICE_SERIAL" "$RESULT_DEVICE_MODEL" \
  "$RESULT_APP_PACKAGE" "$RESULT_APP_ACTIVITY" "$RESULT_APP_APK" \
  "$(IFS=';;'; echo "${RESULT_ERRORS[*]+"${RESULT_ERRORS[*]}"}")" \
  "$(IFS=';;'; echo "${RESULT_STEPS[*]+"${RESULT_STEPS[*]}"}")"
}

# Validation
if [[ ! -d "$PROJECT_ROOT" ]]; then
    write_error_custom "Project path does not exist: $PROJECT_ROOT"
    if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
    exit 1
fi

PROJECT_ROOT=$(cd "$PROJECT_ROOT" && pwd)
cd "$PROJECT_ROOT"

# Project detection
echo ""
echo -e "${color_cyan}========================================${color_reset}"
echo -e "${color_cyan}  Build & Run - ${PROJECT_NAME}${color_reset}"
echo -e "${color_cyan}========================================${color_reset}"
echo ""

has_desktop_app=false
has_android_app=false
has_android_app_module=false
[[ -d "$PROJECT_ROOT/desktopApp" ]] && has_desktop_app=true
[[ -d "$PROJECT_ROOT/app" ]] && has_android_app=true
[[ -d "$PROJECT_ROOT/androidApp" ]] && has_android_app_module=true

# Map target aliases
if [[ "$TARGET" == "demo" || "$TARGET" == "prod" ]]; then
    FLAVOR="$TARGET"
    TARGET="android"
fi

# Auto-detect target
if [[ "$TARGET" == "auto" ]]; then
    if [[ "$has_android_app" == "true" || "$has_android_app_module" == "true" ]]; then
        TARGET="android"
    elif [[ "$has_desktop_app" == "true" ]]; then
        TARGET="desktop"
    else
        write_error_custom "Cannot auto-detect target. Specify: android or desktop"
        if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
        exit 1
    fi
fi

write_info "Target: $TARGET"

# ADB Setup (Android only)
ADB=""
selected_device=""
if [[ "$TARGET" == "android" ]]; then
    # Find ADB
    android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"

    if [[ -f "$android_sdk/platform-tools/adb" ]]; then
        ADB="$android_sdk/platform-tools/adb"
    elif command -v adb >/dev/null 2>&1; then
        ADB="adb"
    else
        write_error_custom "ADB not found. Set ANDROID_SDK_ROOT or ANDROID_HOME."
        if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
        exit 4
    fi

    write_info "ADB: $ADB"

    # Get devices
    # Read devices into array (Bash 3.2 compat — no mapfile)
    devices=()
    while IFS= read -r dev; do
        [[ -n "$dev" ]] && devices+=("$dev")
    done < <("$ADB" devices 2>&1 | grep -E '^\S+\s+device$' | awk '{print $1}')

    if [[ ${#devices[@]} -eq 0 ]]; then
        write_error_custom "No Android devices connected"
        write_info "Connect a device or start an emulator"
        RESULT_STATUS="no_device"
        if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
        exit 4
    fi

    # Select device
    if [[ -n "$DEVICE" ]]; then
        local_found=false
        for d in "${devices[@]}"; do
            if [[ "$d" == "$DEVICE" ]]; then
                local_found=true
                break
            fi
        done
        if [[ "$local_found" == "true" ]]; then
            selected_device="$DEVICE"
        else
            write_error_custom "Device not found: $DEVICE"
            write_info "Available devices: ${devices[*]}"
            exit 4
        fi
    elif [[ ${#devices[@]} -eq 1 ]]; then
        selected_device="${devices[0]}"
    else
        write_info "Multiple devices found: ${devices[*]}"
        selected_device="${devices[0]}"
        write_info "Using first device: $selected_device"
    fi

    RESULT_DEVICE_SERIAL="$selected_device"

    # Get device model
    RESULT_DEVICE_MODEL=$("$ADB" -s "$selected_device" shell getprop ro.product.model 2>&1 | tr -d '\r\n')
    write_info "Device: $selected_device ($RESULT_DEVICE_MODEL)"
fi

# Detect app package and activity
if [[ "$TARGET" == "android" ]]; then
    manifest_paths=(
        "$PROJECT_ROOT/app/src/main/AndroidManifest.xml"
        "$PROJECT_ROOT/androidApp/src/main/AndroidManifest.xml"
        "$PROJECT_ROOT/androidApp/src/androidMain/AndroidManifest.xml"
    )

    manifest=""
    for mp in "${manifest_paths[@]}"; do
        if [[ -f "$mp" ]]; then
            manifest="$mp"
            break
        fi
    done

    if [[ -n "$manifest" ]]; then
        manifest_content=$(cat "$manifest")

        # Extract package
        base_package=""
        if [[ "$manifest_content" =~ package=\"([^\"]+)\" ]]; then
            base_package="${BASH_REMATCH[1]}"
        fi

        # Try to find build.gradle.kts near manifest
        manifest_dir=$(dirname "$manifest")
        build_gradle=""
        if [[ -f "$manifest_dir/../build.gradle.kts" ]]; then
            build_gradle="$manifest_dir/../build.gradle.kts"
        else
            # Search common app module locations
            for bg_path in "$PROJECT_ROOT/app/build.gradle.kts" "$PROJECT_ROOT/androidApp/build.gradle.kts"; do
                if [[ -f "$bg_path" ]]; then
                    build_gradle="$bg_path"
                    break
                fi
            done
        fi

        if [[ -n "$build_gradle" && -f "$build_gradle" ]]; then
            gradle_content=$(cat "$build_gradle")

            if [[ "$FLAVOR" == "demo" ]] && echo "$gradle_content" | grep -qP 'demo\s*\{[^}]*applicationIdSuffix\s*=\s*"([^"]+)"' 2>/dev/null; then
                suffix=$(echo "$gradle_content" | grep -oP 'demo\s*\{[^}]*applicationIdSuffix\s*=\s*"\K[^"]+' 2>/dev/null || true)
                if [[ -n "$suffix" ]]; then
                    RESULT_APP_PACKAGE="${base_package}${suffix}"
                fi
            fi

            if [[ -z "$RESULT_APP_PACKAGE" ]]; then
                app_id=$(echo "$gradle_content" | grep -oP 'applicationId\s*=\s*"\K[^"]+' 2>/dev/null || true)
                if [[ -n "$app_id" ]]; then
                    RESULT_APP_PACKAGE="$app_id"
                    if [[ "$FLAVOR" == "demo" ]]; then
                        RESULT_APP_PACKAGE="${app_id}.demo"
                    fi
                else
                    RESULT_APP_PACKAGE="$base_package"
                    if [[ "$FLAVOR" == "demo" ]]; then
                        RESULT_APP_PACKAGE="${base_package}.demo"
                    fi
                fi
            fi
        else
            RESULT_APP_PACKAGE="$base_package"
        fi

        # Extract launcher activity (simplified regex - use python for complex XML)
        if [[ -z "$RESULT_APP_ACTIVITY" ]]; then
            RESULT_APP_ACTIVITY=$(python3 -c "
import re, sys
content = sys.argv[1]
# Find activity with MAIN action
m = re.search(r'<activity[^>]*android:name=\"([^\"]+)\"[^>]*>[\s\S]*?<action android:name=\"android.intent.action.MAIN\"', content)
if m:
    activity = m.group(1)
    base = sys.argv[2]
    if activity.startswith('.'):
        activity = base + activity
    elif '.' not in activity:
        activity = base + '.' + activity
    print(activity)
" "$manifest_content" "${base_package:-}" 2>/dev/null || true)
        fi
    fi

    write_info "Package: $RESULT_APP_PACKAGE"
    write_info "Activity: $RESULT_APP_ACTIVITY"
fi

# BUILD
echo ""
write_step "BUILD" "start"

gradle_args=("--quiet" "--no-daemon")
if [[ "$CLEAN" == "true" ]]; then
    gradle_args=("clean" "${gradle_args[@]}")
    write_info "Clean build requested"
fi

build_task=""
if [[ "$TARGET" == "android" ]]; then
    if [[ "$has_android_app" == "true" ]]; then
        flavor_cap="$(echo "${FLAVOR:0:1}" | tr '[:lower:]' '[:upper:]')${FLAVOR:1}"
        build_task=":app:assemble${flavor_cap}Debug"
    elif [[ "$has_android_app_module" == "true" ]]; then
        build_task=":androidApp:assembleDebug"
    fi
else
    build_task=":desktopApp:classes"
fi

gradle_args=("$build_task" "${gradle_args[@]}")
write_info "Task: ./gradlew ${gradle_args[*]}"

build_output=""
build_exit=0
build_output=$(./gradlew "${gradle_args[@]}" 2>&1) || build_exit=$?

if [[ $build_exit -ne 0 ]]; then
    write_step "BUILD" "fail" "Gradle build failed"

    build_log_path="$PROJECT_ROOT/app_build.log"
    echo "$build_output" > "$build_log_path"
    RESULT_BUILD_LOG="$build_log_path"

    # Extract errors
    echo "$build_output" | grep -E "(e: file:|error:|FAILURE)" | head -10 | while IFS= read -r err_line; do
        write_info "$err_line"
    done

    RESULT_STATUS="build_failed"
    if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
    exit 1
fi

write_step "BUILD" "success"

# FIND APK (Android only)
apk_path=""
if [[ "$TARGET" == "android" ]]; then
    apk_search_paths=(
        "$PROJECT_ROOT/app/build/outputs/apk/$FLAVOR/debug"
        "$PROJECT_ROOT/app/build/outputs/apk/debug"
        "$PROJECT_ROOT/androidApp/build/outputs/apk/debug"
    )

    for search_path in "${apk_search_paths[@]}"; do
        if [[ -d "$search_path" ]]; then
            found_apk=$(find "$search_path" -name "*.apk" -type f 2>/dev/null | head -1)
            if [[ -n "$found_apk" ]]; then
                apk_path="$found_apk"
                break
            fi
        fi
    done

    if [[ -z "$apk_path" ]]; then
        write_error_custom "APK not found in build outputs"
        RESULT_STATUS="apk_not_found"
        if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
        exit 1
    fi

    RESULT_APP_APK="$apk_path"
    write_info "APK: $apk_path"
fi

# UNINSTALL & INSTALL (Android only)
if [[ "$TARGET" == "android" ]]; then
    echo ""
    write_step "UNINSTALL" "start"

    uninstall_output=$("$ADB" -s "$selected_device" uninstall "$RESULT_APP_PACKAGE" 2>&1) || true
    if echo "$uninstall_output" | grep -q "Success"; then
        write_step "UNINSTALL" "success" "Removed existing app"
    else
        write_step "UNINSTALL" "skip" "App not installed"
    fi

    echo ""
    write_step "INSTALL" "start"

    install_output=""
    install_exit=0
    install_output=$("$ADB" -s "$selected_device" install "$apk_path" 2>&1) || install_exit=$?

    if [[ $install_exit -ne 0 ]] || echo "$install_output" | grep -q "Failure"; then
        write_step "INSTALL" "fail"

        if echo "$install_output" | grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE"; then
            write_info "Signature mismatch - try: adb uninstall $RESULT_APP_PACKAGE"
        elif echo "$install_output" | grep -q "INSTALL_FAILED_VERSION_DOWNGRADE"; then
            write_info "Version downgrade - uninstall first"
        else
            write_info "$install_output"
        fi

        RESULT_STATUS="install_failed"
        if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
        exit 2
    fi

    write_step "INSTALL" "success"
fi

# CLEAR LOGCAT & LAUNCH (Android only)
if [[ "$TARGET" == "android" ]]; then
    echo ""
    write_step "CLEAR LOGCAT" "start"
    "$ADB" -s "$selected_device" logcat -c >/dev/null 2>&1 || true
    write_step "CLEAR LOGCAT" "success"

    echo ""
    write_step "LAUNCH" "start"

    launch_output=""
    launch_exit=0
    launch_output=$("$ADB" -s "$selected_device" shell am start -n "$RESULT_APP_PACKAGE/$RESULT_APP_ACTIVITY" 2>&1) || launch_exit=$?

    if [[ $launch_exit -ne 0 ]] || echo "$launch_output" | grep -q "Error"; then
        write_step "LAUNCH" "fail"
        write_info "$launch_output"
        RESULT_STATUS="launch_failed"
        if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
        exit 3
    fi

    write_step "LAUNCH" "success"

    # Verify app is in foreground
    sleep 2
    focus_check=$("$ADB" -s "$selected_device" shell "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'" 2>&1) || true
    if echo "$focus_check" | grep -q "$RESULT_APP_PACKAGE"; then
        write_info "App is in foreground"
    else
        write_info "Warning: App may have crashed immediately"
    fi
fi

# CAPTURE LOGS
echo ""
write_step "CAPTURE LOGS" "start" "Filter: $FILTER, Duration: ${LOG_DURATION}s"

if [[ "$TARGET" == "android" ]]; then
    # Build grep pattern from filter tags
    IFS=',' read -ra filter_tags <<< "$FILTER"
    grep_pattern=$(IFS='|'; echo "${filter_tags[*]}")

    write_info "Capturing logs for $LOG_DURATION seconds..."
    write_info "Filter pattern: $grep_pattern"
    echo ""
    echo -e "${color_cyan}--- Live Logs ---${color_reset}"

    debug_log_path="$PROJECT_ROOT/app_debug.log"
    full_log_path="$PROJECT_ROOT/app_full.log"

    # Start logcat in background
    logcat_temp=$(mktemp "${TMPDIR:-/tmp}/logcat-XXXXXX")
    "$ADB" -s "$selected_device" logcat -v time > "$logcat_temp" 2>&1 &
    logcat_pid=$!

    # Monitor for duration, printing filtered lines live
    end_time=$((SECONDS + LOG_DURATION))
    while [[ $SECONDS -lt $end_time ]]; do
        if [[ -f "$logcat_temp" ]]; then
            grep -E "$grep_pattern" "$logcat_temp" 2>/dev/null | tail -5 | while IFS= read -r line; do
                echo -e "${color_yellow}${line}${color_reset}"
            done
        fi
        sleep 2
    done

    # Stop logcat
    kill "$logcat_pid" 2>/dev/null || true
    wait "$logcat_pid" 2>/dev/null || true

    # Also dump any remaining logcat
    "$ADB" -s "$selected_device" logcat -d -v time >> "$logcat_temp" 2>&1 || true

    # Filter and save
    grep -E "$grep_pattern" "$logcat_temp" 2>/dev/null > "$debug_log_path" || true
    tail -500 "$logcat_temp" > "$full_log_path" 2>/dev/null || true

    filtered_count=$(wc -l < "$debug_log_path" 2>/dev/null || echo "0")

    RESULT_DEBUG_LOG="$debug_log_path"
    RESULT_FULL_LOG="$full_log_path"

    echo ""
    echo -e "${color_cyan}--- End Logs ---${color_reset}"
    echo ""

    write_step "CAPTURE LOGS" "success" "$filtered_count filtered lines captured"
    write_info "Debug log: $debug_log_path"
    write_info "Full log: $full_log_path"

    # Check for crashes
    crash_lines=$(grep -E "FATAL|AndroidRuntime.*E/" "$logcat_temp" 2>/dev/null | head -10) || true
    if [[ -n "$crash_lines" ]]; then
        echo ""
        echo -e "${color_red}!!! CRASH DETECTED !!!${color_reset}"
        echo -e "${color_red}${crash_lines}${color_reset}"
    fi

    rm -f "$logcat_temp"

else
    # Desktop - run with output capture
    write_info "Running desktop app..."
    echo ""
    echo -e "${color_cyan}--- App Output ---${color_reset}"

    desktop_log_path="$PROJECT_ROOT/app_debug.log"
    ./gradlew :desktopApp:run --quiet 2>&1 | tee "$desktop_log_path"

    echo ""
    echo -e "${color_cyan}--- End Output ---${color_reset}"

    RESULT_DEBUG_LOG="$desktop_log_path"
    write_step "CAPTURE LOGS" "success"
fi

# SUMMARY
echo ""
echo -e "${color_cyan}========================================${color_reset}"
echo -e "${color_cyan}  Run Complete${color_reset}"
echo -e "${color_cyan}========================================${color_reset}"
echo ""

RESULT_STATUS="success"

echo -e "${color_green}Status: SUCCESS${color_reset}"
echo "Target: $TARGET"
if [[ "$TARGET" == "android" ]]; then
    echo "Device: $selected_device"
    echo "Package: $RESULT_APP_PACKAGE"
fi
echo ""
echo -e "${color_yellow}Log files:${color_reset}"
echo "  Debug: $RESULT_DEBUG_LOG"
if [[ -n "$RESULT_FULL_LOG" ]]; then
    echo "  Full:  $RESULT_FULL_LOG"
fi

if [[ "$IS_JSON" == "true" ]]; then write_json_result; fi
exit 0
