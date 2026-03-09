#!/usr/bin/env bash
set -euo pipefail

# Generates SBOM (Software Bill of Materials) for KMP/Android projects.
#
# Uses CycloneDX Gradle plugin to generate JSON SBOM files.
# Auto-detects modules with CycloneDX configured, or generates for specific module.
#
# Usage:
#   ./generate-sbom.sh --project-root DIR [--module MODULE] [--all]
#
# Examples:
#   ./generate-sbom.sh --project-root ~/Projects/MyApp
#   ./generate-sbom.sh --project-root ~/Projects/MyApp --module androidApp
#   ./generate-sbom.sh --project-root ~/Projects/MyApp --all

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
WHITE='\033[37m'
RESET='\033[0m'

# --- Argument parsing ---
PROJECT_ROOT=""
MODULE=""
ALL=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --module)
            MODULE="$2"
            shift 2
            ;;
        --all)
            ALL=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 --project-root DIR [--module MODULE] [--all]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
    echo "ERROR: --project-root is required."
    exit 1
fi

# --- Auto-detect modules with CycloneDX configured ---
get_sbom_modules() {
    local root="$1"
    local modules=()
    local candidates=("androidApp" "desktopApp" "shared-ios" "app" "iosApp" "macosApp")

    for candidate in "${candidates[@]}"; do
        local build_file="$root/$candidate/build.gradle.kts"
        if [[ -f "$build_file" ]]; then
            if grep -q "cyclonedx" "$build_file" 2>/dev/null; then
                modules+=("$candidate")
            fi
        fi
    done

    echo "${modules[@]}"
}

echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  SBOM Generator (CycloneDX)${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo -e "${WHITE}Project: ${PROJECT_ROOT}${RESET}"
echo ""

# --- Determine which modules to process ---
MODULES_TO_PROCESS=()

if [[ -n "$MODULE" ]]; then
    MODULES_TO_PROCESS=("$MODULE")
else
    read -ra MODULES_TO_PROCESS <<< "$(get_sbom_modules "$PROJECT_ROOT")"
fi

if [[ ${#MODULES_TO_PROCESS[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No modules with CycloneDX configuration found.${RESET}"
    echo -e "${YELLOW}Ensure your build.gradle.kts includes the cyclonedx plugin.${RESET}"
    exit 1
fi

echo -e "${WHITE}Modules to process: $(IFS=', '; echo "${MODULES_TO_PROCESS[*]}")${RESET}"
echo ""

SUCCESS_COUNT=0
FAIL_COUNT=0

ORIG_DIR="$(pwd)"
cd "$PROJECT_ROOT"

for mod in "${MODULES_TO_PROCESS[@]}"; do
    echo -e "${YELLOW}Generating SBOM for ${mod}...${RESET}"

    if ./gradlew ":${mod}:cyclonedxDirectBom" --quiet > /dev/null 2>&1; then
        echo -e "  ${GREEN}[OK] ${mod}${RESET}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        echo -e "  ${RED}[ERROR] Failed to generate SBOM for ${mod}${RESET}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
done

cd "$ORIG_DIR"

echo ""
echo -e "${CYAN}Generated SBOM files:${RESET}"

SBOM_FILES=()
while IFS= read -r -d '' file; do
    SBOM_FILES+=("$file")
done < <(find "$PROJECT_ROOT" -type f -name "bom-*.json" -print0 2>/dev/null || true)

if [[ ${#SBOM_FILES[@]} -gt 0 ]]; then
    for file in "${SBOM_FILES[@]}"; do
        relative_path="${file#"$PROJECT_ROOT"}"
        relative_path="${relative_path#/}"
        # Get file size in KB
        if [[ "$(uname)" == "Darwin" ]]; then
            size_bytes=$(stat -f%z "$file" 2>/dev/null || echo 0)
        else
            size_bytes=$(stat -c%s "$file" 2>/dev/null || echo 0)
        fi
        size_kb=$(awk "BEGIN {printf \"%.1f\", $size_bytes / 1024}")
        echo -e "  ${WHITE}- ${relative_path} (${size_kb} KB)${RESET}"
    done
else
    echo -e "  ${YELLOW}(no SBOM files found)${RESET}"
fi

echo ""
if [[ $FAIL_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}Summary: ${SUCCESS_COUNT} succeeded, ${FAIL_COUNT} failed${RESET}"
    exit 1
else
    echo -e "${GREEN}Summary: ${SUCCESS_COUNT} succeeded, ${FAIL_COUNT} failed${RESET}"
fi
