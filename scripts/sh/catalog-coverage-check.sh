#!/bin/bash
# =============================================================================
# catalog-coverage-check.sh (T-BUG-009)
#
# Detects hardcoded Gradle dependency versions in *.gradle.kts files that
# could use a version catalog alias instead. Flags as warnings (non-blocking)
# with a suggestion to migrate to the catalog.
#
# Usage:
#   ./catalog-coverage-check.sh [--project-root DIR] [--strict]
#
# Options:
#   --project-root DIR   Project root (default: cwd)
#   --strict             Exit 1 if any hardcoded version found (default: 0, warn only)
#
# Exit codes:
#   0  Clean (or warn-only mode with findings)
#   1  Strict mode + at least one finding
#   2  Script error
#
# Output format (stdout):
#   <gradle-file>:<line> <group>:<artifact>:<version> -> suggest catalog alias
# =============================================================================

set -euo pipefail

PROJECT_ROOT="${ANDROID_COMMON_DOC:-$(pwd)}"
STRICT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            sed -n '4,22p' "$0" | sed 's/^# //'
            exit 0
            ;;
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --strict)
            STRICT=true
            shift
            ;;
        *)
            echo "Unknown arg: $1" >&2
            exit 2
            ;;
    esac
done

cd "$PROJECT_ROOT" || exit 2

# Pattern matches:
#   implementation("group:artifact:1.2.3")
#   api("group.sub:artifact-name:v1.2.3")
#   testImplementation("group:artifact:1.0.0-SNAPSHOT")
# Excludes catalog accessors:
#   implementation(libs.xxx)
#   implementation(sharedLibs.xxx)
# Pattern: starts with implementation/api/etc, opens paren+string, captures
# triplet separated by two colons, ends with ".
HARDCODED_RE='^\s*(implementation|api|testImplementation|androidTestImplementation|compileOnly|runtimeOnly|ksp|kapt|annotationProcessor|classpath)\s*\(\s*"([^":]+):([^":]+):([^"]+)"'

FINDINGS=0
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Find all .gradle.kts files (excluding build/)
while IFS= read -r -d '' file; do
    while IFS= read -r line_data; do
        line_num="${line_data%%:*}"
        line_content="${line_data#*:}"

        if [[ "$line_content" =~ $HARDCODED_RE ]]; then
            group="${BASH_REMATCH[2]}"
            artifact="${BASH_REMATCH[3]}"
            version="${BASH_REMATCH[4]}"
            # Derive suggested catalog alias from artifact name
            alias="$(echo "$artifact" | tr '[:upper:]' '[:lower:]' | tr '.' '-')"
            printf "%s:%d  %s:%s:%s  -> consider libs.%s or sharedLibs.%s in your catalog\n" \
                "$file" "$line_num" "$group" "$artifact" "$version" "$alias" "$alias"
            FINDINGS=$((FINDINGS + 1))
        fi
    done < <(grep -nE '(implementation|api|testImplementation|androidTestImplementation|compileOnly|runtimeOnly|ksp|kapt|annotationProcessor|classpath)\s*\(\s*"[^":]+:[^":]+:[^"]+"' "$file" 2>/dev/null || true)
done < <(find . -name "*.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" -not -path "*/node_modules/*" -print0 2>/dev/null || true)

# ─────────────────────────────────────────────────────────────────────────────
# Check 2: Hyphen-notation catalog accessor in scripts/docs/templates
# Gradle generates dot-notation: libs.androidx.lifecycle.runtime.ktx
# Hyphen-notation (libs.androidx-lifecycle-runtime-ktx) is WRONG in grep patterns
# ─────────────────────────────────────────────────────────────────────────────
HYPHEN_FINDINGS=0
HYPHEN_RE='libs\.[a-z][a-z0-9]*(-[a-z][a-z0-9]*)+'

while IFS= read -r -d '' file; do
    while IFS= read -r line_data; do
        line_num="${line_data%%:*}"
        line_content="${line_data#*:}"
        printf "[WARN] Hyphen-notation catalog accessor in %s:%s — use dot-notation (libs.androidx.lifecycle.runtime.ktx)\n" \
            "$file" "$line_num"
        printf "  Found: %s\n" "$line_content"
        HYPHEN_FINDINGS=$((HYPHEN_FINDINGS + 1))
    done < <(grep -nE "$HYPHEN_RE" "$file" 2>/dev/null || true)
done < <(find . \( -name "*.sh" -o -name "*.ps1" -o -name "*.md" \) \
    -not -path "*/build/*" -not -path "*/.gradle/*" -not -path "*/node_modules/*" \
    -not -path "*/.git/*" -print0 2>/dev/null || true)

if [[ $HYPHEN_FINDINGS -gt 0 ]]; then
    echo "[WARN] dot-notation check: $HYPHEN_FINDINGS hyphen-notation catalog accessor(s) found in scripts/docs/templates"
    echo "Fix: replace libs.group-artifact with libs.group.artifact (Gradle generates dot-notation for version catalog)"
fi

echo
if [[ $FINDINGS -eq 0 ]]; then
    echo "[OK] catalog coverage: 0 hardcoded versions found"
    exit 0
else
    echo "[WARN] catalog coverage: $FINDINGS hardcoded version(s) found"
    echo "Fix: replace with libs.<alias> or sharedLibs.<alias> (add to versions catalog if absent)"
    if [[ "$STRICT" == "true" ]]; then
        exit 1
    fi
    exit 0
fi
