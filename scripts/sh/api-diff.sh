#!/usr/bin/env bash
set -euo pipefail

# api-diff.sh -- Detect public API changes between git refs.
#
# Usage:
#   api-diff.sh <project_root> [--base main] [--head HEAD] [--scope commonMain|all]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
BASE_REF="main"
HEAD_REF="HEAD"
SCOPE="all"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--base main] [--head HEAD] [--scope commonMain|all]"
            echo ""
            echo "Parses git diff for public API changes (fun, class, interface, val, var)."
            echo "Classifies as breaking, additions, or compatible. Outputs JSON to stdout."
            exit 0
            ;;
        --base)
            BASE_REF="$2"
            shift 2
            ;;
        --head)
            HEAD_REF="$2"
            shift 2
            ;;
        --scope)
            SCOPE="$2"
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

cd "$PROJECT_ROOT"

# --- Get diff ---
DIFF_FILTER=""
if [[ "$SCOPE" == "commonMain" ]]; then
    DIFF_FILTER="*/commonMain/*.kt"
else
    DIFF_FILTER="*.kt"
fi

DIFF_OUTPUT=$(git diff "$BASE_REF...$HEAD_REF" -- "$DIFF_FILTER" 2>/dev/null || echo "")

if [[ -z "$DIFF_OUTPUT" ]]; then
    echo '{"breaking":[],"additions":[],"compatible":0}'
    exit 0
fi

# --- Parse diff for API changes ---
BREAKING=""
ADDITIONS=""
COMPATIBLE=0

# Removed public API symbols = breaking
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    symbol=$(echo "$line" | sed 's/^-\s*//' | sed 's/{.*//' | xargs)
    entry="{\"change\":\"removed\",\"symbol\":\"$(echo "$symbol" | sed 's/"/\\"/g')\"}"
    if [[ -n "$BREAKING" ]]; then
        BREAKING="$BREAKING,$entry"
    else
        BREAKING="$entry"
    fi
done < <(echo "$DIFF_OUTPUT" | grep -E '^\-\s*(public\s+)?(fun |class |interface |val |var |object |enum )' \
    | grep -v '^\-\-\-' | grep -v 'private\|internal\|protected' || true)

# Added public API symbols = additions
while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    symbol=$(echo "$line" | sed 's/^+\s*//' | sed 's/{.*//' | xargs)
    entry="{\"change\":\"added\",\"symbol\":\"$(echo "$symbol" | sed 's/"/\\"/g')\"}"
    if [[ -n "$ADDITIONS" ]]; then
        ADDITIONS="$ADDITIONS,$entry"
    else
        ADDITIONS="$entry"
    fi
done < <(echo "$DIFF_OUTPUT" | grep -E '^\+\s*(public\s+)?(fun |class |interface |val |var |object |enum )' \
    | grep -v '^\+\+\+' | grep -v 'private\|internal\|protected' || true)

# Count lines that changed but are not API-level
COMPATIBLE=$(echo "$DIFF_OUTPUT" | grep -cE '^\+[^\+]' 2>/dev/null || echo "0")

echo "{\"breaking\":[$BREAKING],\"additions\":[$ADDITIONS],\"compatible\":$COMPATIBLE}"
exit 0
