#!/usr/bin/env bash
set -euo pipefail

# Lists valid commit types and scopes from the project's commit-lint config.
# Types sourced from .github/workflows/reusable-commit-lint.yml (default: field).
# Scopes sourced from .commitlintrc.json (valid_scopes array).

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
RESET='\033[0m'

# --- Argument parsing ---
PROJECT_ROOT="$(pwd)"
FORMAT="human"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --format)
            FORMAT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--project-root DIR] [--format human|json]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# --- Validate format ---
if [[ "$FORMAT" != "human" && "$FORMAT" != "json" ]]; then
    echo -e "${RED}ERROR: --format must be 'human' or 'json', got: ${FORMAT}${RESET}" >&2
    exit 1
fi

TYPES_SOURCE=".github/workflows/reusable-commit-lint.yml"
SCOPES_SOURCE=".commitlintrc.json"

TYPES_FILE="${PROJECT_ROOT}/${TYPES_SOURCE}"
SCOPES_FILE="${PROJECT_ROOT}/${SCOPES_SOURCE}"

# --- Validate source files exist ---
if [[ ! -f "$TYPES_FILE" ]]; then
    echo -e "${RED}ERROR: Types source not found: ${TYPES_FILE}${RESET}" >&2
    exit 1
fi

if [[ ! -f "$SCOPES_FILE" ]]; then
    echo -e "${RED}ERROR: Scopes source not found: ${SCOPES_FILE}${RESET}" >&2
    exit 1
fi

# --- Parse valid_types from YAML default: field ---
# Matches: `        default: "feat,fix,docs,..."` (the valid_types input default)
TYPES_RAW=$(awk '
    /valid_types:/ { found_types=1 }
    found_types && /default:/ {
        match($0, /default:[[:space:]]*"([^"]+)"/, arr)
        if (arr[1] != "") { print arr[1]; exit }
        # fallback: unquoted default
        match($0, /default:[[:space:]]*([^[:space:]]+)/, arr2)
        if (arr2[1] != "") { print arr2[1]; exit }
    }
' "$TYPES_FILE")

if [[ -z "$TYPES_RAW" ]]; then
    echo -e "${RED}ERROR: Could not parse valid_types default from: ${TYPES_FILE}${RESET}" >&2
    exit 1
fi

# --- Parse valid_scopes from .commitlintrc.json ---
if ! command -v jq &>/dev/null; then
    echo -e "${RED}ERROR: jq is required but not found in PATH${RESET}" >&2
    exit 1
fi

SCOPES_RAW=$(jq -r '.valid_scopes | join(",")' "$SCOPES_FILE" 2>/dev/null || true)

if [[ -z "$SCOPES_RAW" ]]; then
    echo -e "${RED}ERROR: Could not parse valid_scopes from: ${SCOPES_FILE}${RESET}" >&2
    exit 1
fi

# --- Output ---
if [[ "$FORMAT" == "json" ]]; then
    TYPES_JSON=$(echo "$TYPES_RAW" | awk -F',' '{
        printf "["
        for (i=1; i<=NF; i++) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
            if (i > 1) printf ","
            printf "\"%s\"", $i
        }
        printf "]"
    }')
    SCOPES_JSON=$(echo "$SCOPES_RAW" | awk -F',' '{
        printf "["
        for (i=1; i<=NF; i++) {
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", $i)
            if (i > 1) printf ","
            printf "\"%s\"", $i
        }
        printf "]"
    }')
    printf '{\n'
    printf '  "valid_types": %s,\n' "$TYPES_JSON"
    printf '  "valid_scopes": %s,\n' "$SCOPES_JSON"
    printf '  "types_source": "%s",\n' "$TYPES_SOURCE"
    printf '  "scopes_source": "%s"\n' "$SCOPES_SOURCE"
    printf '}\n'
else
    # Human-readable: find line number of the default: field for types
    TYPES_LINE=$(grep -n 'default:.*feat' "$TYPES_FILE" | head -1 | cut -d: -f1)
    TYPES_LINE="${TYPES_LINE:-25}"
    SCOPES_LINE="2"

    echo ""
    echo -e "${CYAN}=== Valid commit TYPES (from ${TYPES_SOURCE}:${TYPES_LINE}) ===${RESET}"
    # Format as comma-separated, wrapping at ~80 chars
    echo "$TYPES_RAW" | tr ',' '\n' | sed 's/^[[:space:]]*//' | paste -sd ',' | sed 's/,/, /g'
    echo ""
    echo -e "${CYAN}=== Valid commit SCOPES (from ${SCOPES_SOURCE}:${SCOPES_LINE}) ===${RESET}"
    echo "$SCOPES_RAW" | tr ',' '\n' | sed 's/^[[:space:]]*//' | paste -sd ',' | sed 's/,/, /g'
    echo ""
    echo -e "${YELLOW}NOTE: TYPEs and SCOPEs are validated separately.${RESET}"
    echo -e "${YELLOW}'security' is a valid SCOPE but NOT a valid TYPE.${RESET}"
    echo "Use: chore(security): ... or fix(security): ..."
    echo "NOT: security(...): ..."
    echo ""
fi

exit 0
