#!/usr/bin/env bash
set -euo pipefail

# gradle-config-check.sh -- Check Gradle config hygiene (convention plugins, hardcoded versions).
#
# Usage:
#   gradle-config-check.sh <project_root> [--strict]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
PROJECT_ROOT=""
STRICT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 <project_root> [--strict]"
            echo ""
            echo "Checks convention plugin usage, hardcoded versions, and buildscript blocks."
            echo "Outputs JSON to stdout."
            exit 0
            ;;
        --strict)
            STRICT=true
            shift
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

FINDINGS=""
add_finding() {
    local module="$1" issue="$2" detail="$3"
    entry="{\"module\":\"$module\",\"issue\":\"$issue\",\"detail\":\"$(echo "$detail" | sed 's/"/\\"/g')\"}"
    if [[ -n "$FINDINGS" ]]; then
        FINDINGS="$FINDINGS,$entry"
    else
        FINDINGS="$entry"
    fi
}

# --- Check 1: buildscript {} blocks (should use plugins {} DSL instead) ---
while IFS= read -r file; do
    rel="${file#$PROJECT_ROOT/}"
    module=$(dirname "$rel")
    if grep -q 'buildscript\s*{' "$file" 2>/dev/null; then
        add_finding "$module" "buildscript_block" "Uses legacy buildscript{} block instead of plugins{} DSL"
    fi
done < <(find "$PROJECT_ROOT" -name "build.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" 2>/dev/null || true)

# --- Check 2: Hardcoded versions in build files ---
while IFS= read -r file; do
    rel="${file#$PROJECT_ROOT/}"
    module=$(dirname "$rel")

    # Look for version strings like "1.2.3" in implementation/api lines
    while IFS= read -r match; do
        [[ -z "$match" ]] && continue
        # Skip version catalog references (libs.versions.*)
        if echo "$match" | grep -q 'libs\.\|catalog\.\|version\.ref'; then
            continue
        fi
        detail=$(echo "$match" | sed 's/^\s*//' | head -c 120)
        add_finding "$module" "hardcoded_version" "$detail"
    done < <(grep -nE '(implementation|api|compileOnly|runtimeOnly)\s*\(\s*"[^"]+:[0-9]+\.' "$file" 2>/dev/null || true)
done < <(find "$PROJECT_ROOT" -name "build.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" -not -path "*/build-logic/*" 2>/dev/null || true)

# --- Check 3: Convention plugin usage (strict mode) ---
if [[ "$STRICT" == "true" ]]; then
    # Check if build-logic/ exists
    if [[ ! -d "$PROJECT_ROOT/build-logic" ]]; then
        add_finding "project" "no_build_logic" "No build-logic/ directory found for convention plugins"
    fi

    # Check for modules not using convention plugins
    while IFS= read -r file; do
        rel="${file#$PROJECT_ROOT/}"
        module=$(dirname "$rel")
        [[ "$module" == "." ]] && continue
        [[ "$module" == "build-logic"* ]] && continue

        if ! grep -qE 'id\s*\(\s*"[a-z]+\.(android|kotlin|kmp)\.' "$file" 2>/dev/null; then
            if grep -qE 'plugins\s*\{' "$file" 2>/dev/null; then
                # Has plugins block but no convention plugin
                has_convention=false
                if grep -qE 'alias\s*\(libs\.plugins\.' "$file" 2>/dev/null; then
                    has_convention=true
                fi
                if [[ "$has_convention" == "false" ]]; then
                    add_finding "$module" "no_convention_plugin" "Module does not use a convention plugin"
                fi
            fi
        fi
    done < <(find "$PROJECT_ROOT" -name "build.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" 2>/dev/null || true)
fi

# --- Check 4: Duplicate plugin applications ---
while IFS= read -r file; do
    rel="${file#$PROJECT_ROOT/}"
    module=$(dirname "$rel")
    dup_count=$(grep -cE '^\s*id\s*\(' "$file" 2>/dev/null | tr -d '\r' || echo "0")
    if [[ "$dup_count" -gt 10 ]]; then
        add_finding "$module" "excessive_plugins" "Module applies $dup_count plugins directly"
    fi
done < <(find "$PROJECT_ROOT" -name "build.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" 2>/dev/null || true)

echo "{\"findings\":[$FINDINGS]}"
exit 0
