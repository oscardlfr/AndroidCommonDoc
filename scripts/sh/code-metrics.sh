#!/usr/bin/env bash
set -euo pipefail

# code-metrics.sh -- Per-module code metrics (LOC, files, public functions).
#
# Usage:
#   code-metrics.sh <project_root> [--modules mod1,mod2]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
MODULES_FILTER=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--modules mod1,mod2]"
            echo ""
            echo "Counts .kt files, LOC, test files, and public functions per module."
            echo "Outputs JSON to stdout."
            exit 0
            ;;
        --modules)
            MODULES_FILTER="$2"
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

SETTINGS="$PROJECT_ROOT/settings.gradle.kts"
if [[ ! -f "$SETTINGS" ]]; then
    SETTINGS="$PROJECT_ROOT/settings.gradle"
fi
if [[ ! -f "$SETTINGS" ]]; then
    echo '{"error":"settings.gradle.kts not found"}' >&2
    exit 1
fi

# --- Discover modules ---
discover_modules() {
    grep -oE 'include\s*\(\s*"[^"]+"' "$SETTINGS" 2>/dev/null \
        | sed 's/include\s*(\s*"//;s/"//' \
        || true
}

JSON_MODULES=""

while IFS= read -r mod; do
    [[ -z "$mod" ]] && continue

    if [[ -n "$MODULES_FILTER" ]]; then
        if ! echo ",$MODULES_FILTER," | grep -q ",${mod},"; then
            continue
        fi
    fi

    mod_path="${mod//:///}"
    mod_path="${mod_path#/}"
    full_path="$PROJECT_ROOT/$mod_path"
    [[ ! -d "$full_path" ]] && continue

    prod_loc=0
    test_loc=0
    files=0
    public_fns=0

    # Production code
    while IFS= read -r f; do
        files=$((files + 1))
        loc=$(wc -l < "$f" 2>/dev/null | tr -d ' \r')
        prod_loc=$((prod_loc + loc))
        fns=$(grep -cE '^\s*(public\s+)?fun\s+' "$f" 2>/dev/null || echo "0")
        # Exclude private/internal/protected
        priv=$(grep -cE '^\s*(private|internal|protected)\s+fun\s+' "$f" 2>/dev/null || echo "0")
        public_fns=$((public_fns + fns - priv))
    done < <(find "$full_path" -name "*.kt" -not -path "*/build/*" \
        -not -path "*/test/*" -not -path "*/androidTest/*" -not -path "*/commonTest/*" 2>/dev/null || true)

    # Test code
    while IFS= read -r f; do
        loc=$(wc -l < "$f" 2>/dev/null | tr -d ' \r')
        test_loc=$((test_loc + loc))
    done < <(find "$full_path" -name "*.kt" -not -path "*/build/*" \
        \( -path "*/test/*" -o -path "*/androidTest/*" -o -path "*/commonTest/*" \) 2>/dev/null || true)

    entry="{\"name\":\"$mod\",\"prod_loc\":$prod_loc,\"test_loc\":$test_loc,\"files\":$files,\"public_fns\":$public_fns}"

    if [[ -n "$JSON_MODULES" ]]; then
        JSON_MODULES="$JSON_MODULES,$entry"
    else
        JSON_MODULES="$entry"
    fi
done < <(discover_modules)

echo "{\"modules\":[$JSON_MODULES]}"
exit 0
