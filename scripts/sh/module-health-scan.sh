#!/usr/bin/env bash
set -euo pipefail

# module-health-scan.sh -- Per-module health metrics (source files, test files, LOC).
#
# Usage:
#   module-health-scan.sh <project_root> [--modules mod1,mod2] [--format json|text]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
MODULES_FILTER=""
FORMAT="json"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--modules mod1,mod2] [--format json|text]"
            echo ""
            echo "Scans Gradle modules for source/test file counts and lines of code."
            echo "Outputs JSON to stdout, errors to stderr."
            exit 0
            ;;
        --modules)
            MODULES_FILTER="$2"
            shift 2
            ;;
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --format)
            FORMAT="$2"
            shift 2
            ;;
        *)
            if [[ -z "$PROJECT_ROOT" ]]; then
                PROJECT_ROOT="$1"
            else
                echo "Unknown option: $1" >&2
                exit 1
            fi
            shift
            ;;
    esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
    echo '{"error":"project_root is required"}' >&2
    exit 1
fi

if [[ ! -d "$PROJECT_ROOT" ]]; then
    echo "{\"error\":\"directory not found: $PROJECT_ROOT\"}" >&2
    exit 1
fi

SETTINGS="$PROJECT_ROOT/settings.gradle.kts"
if [[ ! -f "$SETTINGS" ]]; then
    SETTINGS="$PROJECT_ROOT/settings.gradle"
fi
if [[ ! -f "$SETTINGS" ]]; then
    echo '{"error":"settings.gradle.kts not found"}' >&2
    exit 1
fi

# --- Discover modules from settings file ---
discover_modules() {
    grep -oE 'include\s*\(\s*"[^"]+"' "$SETTINGS" 2>/dev/null \
        | sed 's/include\s*(\s*"//;s/"//' \
        || true
}

MODULES=()
while IFS= read -r mod; do
    [[ -z "$mod" ]] && continue
    if [[ -n "$MODULES_FILTER" ]]; then
        if echo ",$MODULES_FILTER," | grep -q ",${mod},"; then
            MODULES+=("$mod")
        fi
    else
        MODULES+=("$mod")
    fi
done < <(discover_modules)

# --- Scan each module ---
JSON_MODULES=""
for mod in "${MODULES[@]}"; do
    # Convert :core:domain to core/domain
    mod_path="${mod//:///}"
    mod_path="${mod_path#/}"  # strip leading slash
    full_path="$PROJECT_ROOT/$mod_path"

    if [[ ! -d "$full_path" ]]; then
        continue
    fi

    src_files=0
    test_files=0
    loc=0

    # Count source .kt files (exclude test dirs and build)
    while IFS= read -r f; do
        src_files=$((src_files + 1))
        loc=$((loc + $(wc -l < "$f" 2>/dev/null || echo 0)))
    done < <(find "$full_path" -name "*.kt" -not -path "*/build/*" \
        -not -path "*/test/*" -not -path "*/androidTest/*" -not -path "*/commonTest/*" \
        -not -path "*/androidUnitTest/*" -not -path "*/desktopTest/*" \
        -not -path "*/iosTest/*" -not -path "*/jvmTest/*" 2>/dev/null || true)

    # Count test .kt files (all test source sets including platform-specific)
    test_files=$(find "$full_path" -name "*.kt" -not -path "*/build/*" \
        \( -path "*/test/*" -o -path "*/androidTest/*" -o -path "*/commonTest/*" \
           -o -path "*/androidUnitTest/*" -o -path "*/desktopTest/*" \
           -o -path "*/iosTest/*" -o -path "*/jvmTest/*" \) 2>/dev/null | wc -l | tr -d ' \r')

    entry="{\"name\":\"$mod\",\"src_files\":$src_files,\"test_files\":$test_files,\"loc\":$loc}"

    if [[ -n "$JSON_MODULES" ]]; then
        JSON_MODULES="$JSON_MODULES,$entry"
    else
        JSON_MODULES="$entry"
    fi
done

# --- Output ---
if [[ "$FORMAT" == "text" ]]; then
    echo "Module Health Scan: $(basename "$PROJECT_ROOT")"
    echo "$JSON_MODULES" | tr ',' '\n' | sed 's/[{}"]//g'
else
    echo "{\"modules\":[$JSON_MODULES]}"
fi

exit 0
