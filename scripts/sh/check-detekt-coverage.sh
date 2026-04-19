#!/usr/bin/env bash
set -euo pipefail

# check-detekt-coverage.sh — Diagnose which modules have Detekt tasks vs which should
#
# Reports:
# - Modules with Detekt tasks (plugin applied correctly)
# - KMP modules WITHOUT Detekt tasks (plugin missing)
# - Whether detekt.multiplatform.disabled is set
#
# Usage:
#   check-detekt-coverage.sh --project-root /path/to/project

PROJECT_ROOT="$(pwd)"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root) PROJECT_ROOT="$2"; shift 2 ;;
        --help|-h)
            echo "Usage: $0 --project-root DIR"
            echo "Diagnoses Detekt task coverage across all modules."
            exit 0
            ;;
        *) echo "Unknown: $1" >&2; exit 2 ;;
    esac
done

cd "$PROJECT_ROOT"

echo "Detekt Coverage Diagnostic"
echo "  Project: $PROJECT_ROOT"
echo ""

# Check for the disable property
if grep -rq "detekt.multiplatform.disabled" gradle.properties 2>/dev/null; then
    echo "⚠ detekt.multiplatform.disabled found in gradle.properties!"
    grep "detekt.multiplatform.disabled" gradle.properties
    echo ""
fi

# List all modules
echo "=== Module Analysis ==="
TOTAL=0
WITH_DETEKT=0
WITHOUT_DETEKT=0
KMP_WITHOUT=0

for build_file in $(find . -name "build.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" -not -path "*/build-logic/*" | sort); do
    dir=$(dirname "$build_file")
    module=$(echo "$dir" | sed 's|^\./||' | tr '/' ':')
    [[ "$module" == "." ]] && module="root"
    TOTAL=$((TOTAL + 1))

    # Detect module type
    is_kmp=false
    is_android=false
    has_toolkit=false

    grep -qE 'kotlin\("multiplatform"\)|org\.jetbrains\.kotlin\.multiplatform|libs\.plugins\.kotlin[Mm]ultiplatform|libs\.plugins\.kotlin\.multiplatform' "$build_file" 2>/dev/null && is_kmp=true
    grep -qE 'com\.android\.(library|application)|libs\.plugins\.android' "$build_file" 2>/dev/null && is_android=true
    grep -qE 'androidcommondoc\.toolkit|id\("dev\.detekt"\)' "$build_file" 2>/dev/null && has_toolkit=true

    type="unknown"
    $is_kmp && type="KMP"
    $is_android && ! $is_kmp && type="Android"
    ! $is_kmp && ! $is_android && type="JVM/other"

    if $has_toolkit; then
        echo "  [✅ detekt] $module ($type)"
        WITH_DETEKT=$((WITH_DETEKT + 1))
    elif $is_kmp; then
        echo "  [❌ NO detekt] $module ($type) ← needs androidcommondoc.toolkit"
        WITHOUT_DETEKT=$((WITHOUT_DETEKT + 1))
        KMP_WITHOUT=$((KMP_WITHOUT + 1))
    elif $is_android; then
        echo "  [❌ NO detekt] $module ($type)"
        WITHOUT_DETEKT=$((WITHOUT_DETEKT + 1))
    else
        echo "  [--] $module ($type) — skip (no Kotlin source)"
    fi
done

echo ""
echo "=== Summary ==="
echo "  Total modules: $TOTAL"
echo "  With Detekt:   $WITH_DETEKT"
echo "  Without:       $WITHOUT_DETEKT"
echo "  KMP without:   $KMP_WITHOUT"

if [[ $KMP_WITHOUT -gt 0 ]]; then
    echo ""
    echo "Fix: Apply androidcommondoc.toolkit to each KMP module:"
    echo "  Option 1 (recommended): Add to your convention plugin:"
    echo "    plugins { id(\"androidcommondoc.toolkit\") }"
    echo "  Option 2 (quick): Add to root build.gradle.kts:"
    echo "    subprojects { apply(plugin = \"androidcommondoc.toolkit\") }"
fi

# JSON output
echo ""
echo "{\"total\":$TOTAL,\"with_detekt\":$WITH_DETEKT,\"without\":$WITHOUT_DETEKT,\"kmp_without\":$KMP_WITHOUT}"
