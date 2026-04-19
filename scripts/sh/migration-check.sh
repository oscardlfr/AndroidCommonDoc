#!/usr/bin/env bash
set -euo pipefail

# migration-check.sh -- Validate DB migration sequences and flag destructive ops.
#
# Usage:
#   migration-check.sh <project_root> [--db-type room|sqldelight|auto]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
DB_TYPE="auto"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--db-type room|sqldelight|auto]"
            echo ""
            echo "Auto-detects DB type, validates migration version sequences,"
            echo "and flags destructive operations. Outputs JSON to stdout."
            exit 0
            ;;
        --db-type)
            DB_TYPE="$2"
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

# --- Auto-detect DB type ---
if [[ "$DB_TYPE" == "auto" ]]; then
    if find "$PROJECT_ROOT" -name "*.sq" -not -path "*/build/*" 2>/dev/null | grep -q .; then
        DB_TYPE="sqldelight"
    elif grep -rq "androidx.room" "$PROJECT_ROOT" --include="*.kts" --include="*.gradle" 2>/dev/null; then
        DB_TYPE="room"
    else
        echo '{"db_type":"none","migrations":[],"gaps":[],"destructive":[]}'
        exit 0
    fi
fi

MIGRATIONS_JSON=""
GAPS_JSON=""
DESTRUCTIVE_JSON=""
VERSIONS=()

if [[ "$DB_TYPE" == "room" ]]; then
    # Room: look for Migration(X, Y) patterns
    while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        from=$(echo "$line" | grep -oE 'Migration\s*\(\s*[0-9]+' | grep -oE '[0-9]+')
        to=$(echo "$line" | grep -oE 'Migration\s*\([0-9]+\s*,\s*[0-9]+' | grep -oE '[0-9]+' | tail -1)
        [[ -z "$from" || -z "$to" ]] && continue

        rel_file="${file#$PROJECT_ROOT/}"
        entry="{\"from\":$from,\"to\":$to,\"file\":\"$rel_file\"}"
        if [[ -n "$MIGRATIONS_JSON" ]]; then
            MIGRATIONS_JSON="$MIGRATIONS_JSON,$entry"
        else
            MIGRATIONS_JSON="$entry"
        fi
        VERSIONS+=("$from" "$to")
    done < <(grep -rn --include="*.kt" --exclude-dir=build 'Migration\s*(' "$PROJECT_ROOT" 2>/dev/null || true)

    # Check for destructive ops in migration files
    while IFS= read -r line; do
        file=$(echo "$line" | cut -d: -f1)
        rel_file="${file#$PROJECT_ROOT/}"
        op=$(echo "$line" | grep -oiE 'DROP\s+(TABLE|COLUMN)\s+\w+' || echo "destructive_op")
        entry="{\"file\":\"$rel_file\",\"operation\":\"$(echo "$op" | sed 's/"/\\"/g')\"}"
        if [[ -n "$DESTRUCTIVE_JSON" ]]; then
            DESTRUCTIVE_JSON="$DESTRUCTIVE_JSON,$entry"
        else
            DESTRUCTIVE_JSON="$entry"
        fi
    done < <(grep -rniE 'DROP\s+(TABLE|COLUMN)' "$PROJECT_ROOT" --include="*.kt" --exclude-dir=build 2>/dev/null || true)

elif [[ "$DB_TYPE" == "sqldelight" ]]; then
    # SQLDelight: look for .sqm migration files (V{N}.sqm)
    while IFS= read -r f; do
        basename_f=$(basename "$f")
        version=$(echo "$basename_f" | grep -oE '[0-9]+' | head -1)
        [[ -z "$version" ]] && continue
        rel_file="${f#$PROJECT_ROOT/}"
        entry="{\"version\":$version,\"file\":\"$rel_file\"}"
        if [[ -n "$MIGRATIONS_JSON" ]]; then
            MIGRATIONS_JSON="$MIGRATIONS_JSON,$entry"
        else
            MIGRATIONS_JSON="$entry"
        fi
        VERSIONS+=("$version")

        # Check for destructive ops
        if grep -qiE 'DROP\s+(TABLE|COLUMN)' "$f" 2>/dev/null; then
            op=$(grep -oiE 'DROP\s+(TABLE|COLUMN)\s+\w+' "$f" 2>/dev/null | head -1)
            d_entry="{\"file\":\"$rel_file\",\"operation\":\"$(echo "$op" | sed 's/"/\\"/g')\"}"
            if [[ -n "$DESTRUCTIVE_JSON" ]]; then
                DESTRUCTIVE_JSON="$DESTRUCTIVE_JSON,$d_entry"
            else
                DESTRUCTIVE_JSON="$d_entry"
            fi
        fi
    done < <(find "$PROJECT_ROOT" -name "*.sqm" -not -path "*/build/*" 2>/dev/null | sort || true)
fi

# --- Check for gaps in version sequence ---
if [[ ${#VERSIONS[@]} -gt 0 ]]; then
    SORTED_VERSIONS=($(printf '%s\n' "${VERSIONS[@]}" | sort -un))
    for ((i=1; i<${#SORTED_VERSIONS[@]}; i++)); do
        prev="${SORTED_VERSIONS[$((i-1))]}"
        curr="${SORTED_VERSIONS[$i]}"
        expected=$((prev + 1))
        if [[ "$curr" -ne "$expected" ]]; then
            gap_entry="{\"expected\":$expected,\"found\":$curr}"
            if [[ -n "$GAPS_JSON" ]]; then
                GAPS_JSON="$GAPS_JSON,$gap_entry"
            else
                GAPS_JSON="$gap_entry"
            fi
        fi
    done
fi

echo "{\"db_type\":\"$DB_TYPE\",\"migrations\":[$MIGRATIONS_JSON],\"gaps\":[$GAPS_JSON],\"destructive\":[$DESTRUCTIVE_JSON]}"
exit 0
