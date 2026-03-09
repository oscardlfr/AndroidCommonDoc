#!/usr/bin/env bash
# lint-resources.sh -- Validate string resource naming conventions
# Checks: snake_case keys, required prefixes, {category}_{entity}_{descriptor} format,
#          cross-module duplicates, Compose/Swift key sync.

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
PROJECT_ROOT="$(pwd)"
MODULE_PATH=""
STRICT_MODE=false
SHOW_DETAILS=false
CHECK_SWIFT_SYNC=false
OUTPUT_FORMAT="human"

# ── Usage ─────────────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
Usage: lint-resources.sh [OPTIONS]

Options:
  --project-root PATH   Project root directory (default: cwd)
  --module-path  PATH   Specific module to check (relative to project root)
  --strict               Fail on warnings (prefix/format) in addition to errors
  --show-details         Show matched lines for each violation
  --check-swift-sync     Compare Compose keys against .xcstrings
  --output-format FMT    Output format: human | json (default: human)
  --help                 Show this help
EOF
    exit 0
}

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)  PROJECT_ROOT="$2";      shift 2 ;;
        --module-path)   MODULE_PATH="$2";        shift 2 ;;
        --strict)        STRICT_MODE=true;        shift   ;;
        --show-details)  SHOW_DETAILS=true;       shift   ;;
        --check-swift-sync) CHECK_SWIFT_SYNC=true; shift  ;;
        --output-format) OUTPUT_FORMAT="$2";      shift 2 ;;
        --help)          usage ;;
        *)               echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# ── Globals ───────────────────────────────────────────────────────────────────
ERRORS=0
WARNINGS=0
FILES_CHECKED=0
TOTAL_KEYS=0
declare -a ERROR_MSGS=()
declare -a WARN_MSGS=()

# All keys across modules for duplicate detection
declare -A ALL_KEYS=()
declare -a DUPLICATE_MSGS=()

# Known prefixes from compose-resources-usage.md
KNOWN_PREFIXES="common_|error_|a11y_"

# ── Find strings.xml files ───────────────────────────────────────────────────
search_root="$PROJECT_ROOT"
if [[ -n "$MODULE_PATH" ]]; then
    search_root="$PROJECT_ROOT/$MODULE_PATH"
fi

mapfile -t STRING_FILES < <(find "$search_root" -path "*/composeResources/values/strings.xml" -type f 2>/dev/null || true)

if [[ ${#STRING_FILES[@]} -eq 0 ]]; then
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        echo '{"status":"skip","message":"No strings.xml files found","files_checked":0}'
    else
        echo "No composeResources/values/strings.xml files found under: $search_root"
    fi
    exit 0
fi

# ── Lint a single strings.xml ────────────────────────────────────────────────
lint_file() {
    local file="$1"
    local rel_path="${file#"$PROJECT_ROOT"/}"
    local file_errors=0
    local file_warnings=0

    FILES_CHECKED=$((FILES_CHECKED + 1))

    # Extract string names: <string name="key_name">
    local keys
    keys=$(grep -oP '<string\s+name="\K[^"]+' "$file" 2>/dev/null || true)

    if [[ -z "$keys" ]]; then
        return
    fi

    while IFS= read -r key; do
        TOTAL_KEYS=$((TOTAL_KEYS + 1))

        # ── ERROR: camelCase detection ────────────────────────────────────
        if [[ "$key" =~ [a-z][A-Z] ]]; then
            ERROR_MSGS+=("ERROR [$rel_path] Key '$key' uses camelCase -- must use snake_case")
            file_errors=$((file_errors + 1))
        fi

        # ── ERROR: uppercase letters (except in camelCase, caught above) ──
        if [[ "$key" =~ [A-Z] && ! "$key" =~ [a-z][A-Z] ]]; then
            ERROR_MSGS+=("ERROR [$rel_path] Key '$key' contains uppercase -- must use lowercase snake_case")
            file_errors=$((file_errors + 1))
        fi

        # ── ERROR: spaces or special chars ────────────────────────────────
        if [[ "$key" =~ [^a-z0-9_] ]]; then
            ERROR_MSGS+=("ERROR [$rel_path] Key '$key' contains invalid characters -- only lowercase, digits, underscores allowed")
            file_errors=$((file_errors + 1))
        fi

        # ── WARNING: missing known prefix ─────────────────────────────────
        if [[ ! "$key" =~ ^($KNOWN_PREFIXES) ]]; then
            # Check if it looks like a feature prefix (feature_something)
            if [[ ! "$key" =~ ^[a-z]+_.+ ]]; then
                WARN_MSGS+=("WARN  [$rel_path] Key '$key' has no category prefix -- expected {category}_{entity}_{descriptor}")
                file_warnings=$((file_warnings + 1))
            fi
        fi

        # ── WARNING: too few segments ─────────────────────────────────────
        local segment_count
        segment_count=$(echo "$key" | tr -cd '_' | wc -c)
        if [[ "$segment_count" -lt 1 ]]; then
            WARN_MSGS+=("WARN  [$rel_path] Key '$key' has no underscore -- expected at least {category}_{descriptor}")
            file_warnings=$((file_warnings + 1))
        fi

        # ── Cross-module duplicate tracking ───────────────────────────────
        if [[ -n "${ALL_KEYS[$key]+x}" ]]; then
            local prev_file="${ALL_KEYS[$key]}"
            if [[ "$prev_file" != "$rel_path" ]]; then
                DUPLICATE_MSGS+=("WARN  Key '$key' defined in both '$prev_file' and '$rel_path'")
            fi
        else
            ALL_KEYS[$key]="$rel_path"
        fi

    done <<< "$keys"

    ERRORS=$((ERRORS + file_errors))
    WARNINGS=$((WARNINGS + file_warnings))
}

# ── Swift sync check ─────────────────────────────────────────────────────────
check_swift_sync() {
    local xcstrings_files
    mapfile -t xcstrings_files < <(find "$PROJECT_ROOT" -name "*.xcstrings" -type f 2>/dev/null || true)

    if [[ ${#xcstrings_files[@]} -eq 0 ]]; then
        WARN_MSGS+=("WARN  No .xcstrings files found -- Swift sync check skipped")
        return
    fi

    # Collect all Compose keys
    local compose_keys
    compose_keys=$(printf '%s\n' "${!ALL_KEYS[@]}" | sort)

    for xcfile in "${xcstrings_files[@]}"; do
        local rel_xcfile="${xcfile#"$PROJECT_ROOT"/}"
        # Extract keys from xcstrings JSON
        local swift_keys
        swift_keys=$(grep -oP '"([a-z][a-z0-9_]+)"(?=\s*:)' "$xcfile" 2>/dev/null | tr -d '"' | sort || true)

        # Keys in Compose but not in Swift
        local missing_in_swift
        missing_in_swift=$(comm -23 <(echo "$compose_keys") <(echo "$swift_keys") || true)
        if [[ -n "$missing_in_swift" ]]; then
            while IFS= read -r k; do
                WARN_MSGS+=("WARN  Key '$k' exists in Compose resources but missing from '$rel_xcfile'")
                WARNINGS=$((WARNINGS + 1))
            done <<< "$missing_in_swift"
        fi

        # Keys in Swift but not in Compose
        local missing_in_compose
        missing_in_compose=$(comm -13 <(echo "$compose_keys") <(echo "$swift_keys") || true)
        if [[ -n "$missing_in_compose" ]]; then
            while IFS= read -r k; do
                WARN_MSGS+=("WARN  Key '$k' exists in '$rel_xcfile' but missing from Compose resources")
                WARNINGS=$((WARNINGS + 1))
            done <<< "$missing_in_compose"
        fi
    done
}

# ── Main ──────────────────────────────────────────────────────────────────────
for f in "${STRING_FILES[@]}"; do
    lint_file "$f"
done

if [[ "$CHECK_SWIFT_SYNC" == true ]]; then
    check_swift_sync
fi

# ── Output ────────────────────────────────────────────────────────────────────
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    # JSON output
    exit_code=0
    if [[ $ERRORS -gt 0 ]]; then exit_code=1; fi
    if [[ "$STRICT_MODE" == true && $WARNINGS -gt 0 ]]; then exit_code=1; fi

    echo "{"
    echo "  \"status\": \"$([ $exit_code -eq 0 ] && echo 'pass' || echo 'fail')\","
    echo "  \"files_checked\": $FILES_CHECKED,"
    echo "  \"total_keys\": $TOTAL_KEYS,"
    echo "  \"errors\": $ERRORS,"
    echo "  \"warnings\": $WARNINGS,"
    echo "  \"duplicates\": ${#DUPLICATE_MSGS[@]}"
    echo "}"
    exit $exit_code
fi

# Human-readable output
echo "=== Resource Lint Report ==="
echo "Files checked: $FILES_CHECKED"
echo "Total keys:    $TOTAL_KEYS"
echo ""

if [[ ${#ERROR_MSGS[@]} -gt 0 ]]; then
    echo "── ERRORS ──────────────────────────────────────────"
    for msg in "${ERROR_MSGS[@]}"; do echo "  $msg"; done
    echo ""
fi

if [[ ${#DUPLICATE_MSGS[@]} -gt 0 ]]; then
    echo "── DUPLICATES ──────────────────────────────────────"
    for msg in "${DUPLICATE_MSGS[@]}"; do echo "  $msg"; done
    echo ""
fi

if [[ ${#WARN_MSGS[@]} -gt 0 && ("$SHOW_DETAILS" == true || "$STRICT_MODE" == true) ]]; then
    echo "── WARNINGS ────────────────────────────────────────"
    for msg in "${WARN_MSGS[@]}"; do echo "  $msg"; done
    echo ""
fi

echo "── SUMMARY ─────────────────────────────────────────"
echo "Errors:     $ERRORS"
echo "Warnings:   $WARNINGS"
echo "Duplicates: ${#DUPLICATE_MSGS[@]}"

if [[ $ERRORS -gt 0 ]]; then
    echo "Status:     FAILED"
    exit 1
elif [[ "$STRICT_MODE" == true && $WARNINGS -gt 0 ]]; then
    echo "Status:     FAILED (strict mode)"
    exit 1
else
    echo "Status:     PASSED"
    exit 0
fi
