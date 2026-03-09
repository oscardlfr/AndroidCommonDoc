#!/usr/bin/env bash
set -euo pipefail

# unused-strings.sh -- Find unused Android string resources.
#
# Usage:
#   unused-strings.sh <project_root> [--module <path>]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
MODULE_PATH=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--module <path>]"
            echo ""
            echo "Finds string resources defined in strings.xml that are not referenced"
            echo "in any .kt or .xml file. Outputs JSON to stdout."
            exit 0
            ;;
        --module)
            MODULE_PATH="$2"
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

SEARCH_ROOT="$PROJECT_ROOT"
if [[ -n "$MODULE_PATH" ]]; then
    SEARCH_ROOT="$PROJECT_ROOT/$MODULE_PATH"
fi

if [[ ! -d "$SEARCH_ROOT" ]]; then
    echo "{\"error\":\"directory not found: $SEARCH_ROOT\"}" >&2
    exit 1
fi

# --- Find all strings.xml files ---
STRING_FILES=()
while IFS= read -r f; do
    STRING_FILES+=("$f")
done < <(find "$SEARCH_ROOT" -name "strings.xml" -not -path "*/build/*" 2>/dev/null || true)

if [[ ${#STRING_FILES[@]} -eq 0 ]]; then
    echo '{"total":0,"unused":[]}'
    exit 0
fi

# --- Extract all string names ---
declare -A STRING_NAMES  # name -> file
TOTAL=0

for sf in "${STRING_FILES[@]}"; do
    while IFS= read -r name; do
        [[ -z "$name" ]] && continue
        STRING_NAMES["$name"]="$sf"
        TOTAL=$((TOTAL + 1))
    done < <(grep -oE '<string\s+name="[^"]+"' "$sf" 2>/dev/null \
        | sed 's/<string\s*name="//;s/"//' || true)
done

# --- Check references in .kt and .xml files ---
UNUSED_JSON=""
UNUSED_COUNT=0

for name in "${!STRING_NAMES[@]}"; do
    file="${STRING_NAMES[$name]}"

    # Check R.string.X, Res.string.X, @string/X patterns
    found=false
    if grep -rq --include="*.kt" --exclude-dir=build "R\.string\.$name\b\|Res\.string\.$name\b" "$PROJECT_ROOT" 2>/dev/null; then
        found=true
    fi
    if [[ "$found" == "false" ]]; then
        if grep -rq --include="*.xml" --exclude-dir=build "@string/$name" "$PROJECT_ROOT" 2>/dev/null; then
            found=true
        fi
    fi

    if [[ "$found" == "false" ]]; then
        rel_file="${file#$PROJECT_ROOT/}"
        entry="{\"name\":\"$name\",\"file\":\"$rel_file\"}"
        if [[ -n "$UNUSED_JSON" ]]; then
            UNUSED_JSON="$UNUSED_JSON,$entry"
        else
            UNUSED_JSON="$entry"
        fi
        UNUSED_COUNT=$((UNUSED_COUNT + 1))
    fi
done

echo "{\"total\":$TOTAL,\"unused_count\":$UNUSED_COUNT,\"unused\":[$UNUSED_JSON]}"
exit 0
