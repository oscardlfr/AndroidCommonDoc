#!/usr/bin/env bash
set -euo pipefail

# Scans SBOM files for known vulnerabilities using Trivy.
#
# Requires Trivy to be installed:
#   macOS:  brew install trivy
#   Linux:  See https://aquasecurity.github.io/trivy/
#
# Usage:
#   ./scan-sbom.sh --project-root DIR [--module MODULE] [--severity LEVEL]
#
# Examples:
#   ./scan-sbom.sh --project-root ~/Projects/MyApp
#   ./scan-sbom.sh --project-root ~/Projects/MyApp --module androidApp
#   ./scan-sbom.sh --project-root ~/Projects/MyApp --severity "CRITICAL"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/audit-append.sh"

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
WHITE='\033[37m'
GRAY='\033[90m'
RESET='\033[0m'

# --- Argument parsing ---
PROJECT_ROOT=""
MODULE=""
SEVERITY="HIGH,CRITICAL"

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
        --severity)
            SEVERITY="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 --project-root DIR [--module MODULE] [--severity LEVEL]"
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

# --- Find Trivy executable ---
find_trivy() {
    # Check if trivy is in PATH
    if command -v trivy &> /dev/null; then
        command -v trivy
        return
    fi

    # Check Homebrew location (macOS)
    if [[ -x "/opt/homebrew/bin/trivy" ]]; then
        echo "/opt/homebrew/bin/trivy"
        return
    fi

    # Check /usr/local/bin (Linux / older Homebrew)
    if [[ -x "/usr/local/bin/trivy" ]]; then
        echo "/usr/local/bin/trivy"
        return
    fi

    # Check snap location (Linux)
    if [[ -x "/snap/bin/trivy" ]]; then
        echo "/snap/bin/trivy"
        return
    fi

    echo ""
}

echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  SBOM Vulnerability Scanner (Trivy)${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo -e "${WHITE}Project: ${PROJECT_ROOT}${RESET}"
echo -e "${WHITE}Severity filter: ${SEVERITY}${RESET}"
echo ""

# --- Find Trivy ---
TRIVY_PATH=$(find_trivy)

if [[ -z "$TRIVY_PATH" ]]; then
    echo -e "${RED}ERROR: Trivy is not installed.${RESET}"
    echo ""
    echo -e "${YELLOW}Install Trivy using one of these methods:${RESET}"
    echo "  macOS:  brew install trivy"
    echo "  Linux:  See https://aquasecurity.github.io/trivy/"
    exit 1
fi

echo -e "${GRAY}Using Trivy: ${TRIVY_PATH}${RESET}"
echo ""

# --- Find SBOM files ---
SBOM_FILES=()

if [[ -n "$MODULE" ]]; then
    while IFS= read -r -d '' file; do
        SBOM_FILES+=("$file")
    done < <(find "$PROJECT_ROOT/$MODULE" -type f -name "bom-*.json" -print0 2>/dev/null || true)
else
    while IFS= read -r -d '' file; do
        SBOM_FILES+=("$file")
    done < <(find "$PROJECT_ROOT" -type f -name "bom-*.json" -print0 2>/dev/null || true)
fi

if [[ ${#SBOM_FILES[@]} -eq 0 ]]; then
    echo -e "${YELLOW}No SBOM files found.${RESET}"
    echo -e "${YELLOW}Run generate-sbom.sh first to generate SBOM files.${RESET}"
    exit 1
fi

TOTAL_VULNERABILITIES=0
CVE_CRITICAL=0
CVE_HIGH=0
CVE_MEDIUM=0
CVE_LOW=0
RESULT_FILES=()
RESULT_COUNTS=()

for sbom in "${SBOM_FILES[@]}"; do
    relative_path="${sbom#"$PROJECT_ROOT"}"
    relative_path="${relative_path#/}"

    echo -e "${YELLOW}Scanning: ${relative_path}${RESET}"
    printf '%0.s-' {1..60}
    echo ""

    # Run Trivy — human output for display, JSON for structured counts
    output=$("$TRIVY_PATH" sbom --severity "$SEVERITY" "$sbom" 2>&1) || true
    json_output=$("$TRIVY_PATH" sbom --severity "$SEVERITY" --format json "$sbom" 2>/dev/null) || true

    # Display human output
    echo "$output"

    # Parse per-severity counts from JSON (fallback: total only from human output)
    if [[ -n "$json_output" ]]; then
        sev_counts=$(python3 -c "
import json, sys
try:
    d = json.loads('''$json_output''')
    counts = {'CRITICAL':0,'HIGH':0,'MEDIUM':0,'LOW':0}
    for result in d.get('Results', []):
        for vuln in result.get('Vulnerabilities', []):
            sev = vuln.get('Severity','').upper()
            if sev in counts:
                counts[sev] += 1
    print(counts['CRITICAL'], counts['HIGH'], counts['MEDIUM'], counts['LOW'])
except:
    print('0 0 0 0')
" 2>/dev/null || echo "0 0 0 0")
        _c=$(echo "$sev_counts" | awk '{print $1}')
        _h=$(echo "$sev_counts" | awk '{print $2}')
        _m=$(echo "$sev_counts" | awk '{print $3}')
        _l=$(echo "$sev_counts" | awk '{print $4}')
        CVE_CRITICAL=$((CVE_CRITICAL + _c))
        CVE_HIGH=$((CVE_HIGH + _h))
        CVE_MEDIUM=$((CVE_MEDIUM + _m))
        CVE_LOW=$((CVE_LOW + _l))
        file_count=$((_c + _h + _m + _l))
    else
        # Fallback: parse "Total: N" from human output
        file_count=0
        if echo "$output" | grep -qoE "Total: [0-9]+"; then
            file_count=$(echo "$output" | grep -oE "Total: [0-9]+" | head -1 | grep -oE "[0-9]+")
            CVE_HIGH=$((CVE_HIGH + file_count))  # conservative: count as HIGH if unknown breakdown
        fi
    fi

    if [[ "${file_count:-0}" -gt 0 ]]; then
        TOTAL_VULNERABILITIES=$((TOTAL_VULNERABILITIES + file_count))
        RESULT_FILES+=("$relative_path")
        RESULT_COUNTS+=("$file_count")
    fi

    echo ""
done

# --- Summary ---
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  Scan Summary${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo -e "${WHITE}Files scanned: ${#SBOM_FILES[@]}${RESET}"

if [[ $TOTAL_VULNERABILITIES -gt 0 ]]; then
    echo -e "${RED}Total vulnerabilities: ${TOTAL_VULNERABILITIES}${RESET}"
    [[ $CVE_CRITICAL -gt 0 ]] && echo -e "${RED}  CRITICAL: ${CVE_CRITICAL}${RESET}"
    [[ $CVE_HIGH -gt 0 ]]     && echo -e "${RED}  HIGH:     ${CVE_HIGH}${RESET}"
    [[ $CVE_MEDIUM -gt 0 ]]   && echo -e "${YELLOW}  MEDIUM:   ${CVE_MEDIUM}${RESET}"
    [[ $CVE_LOW -gt 0 ]]      && echo -e "${YELLOW}  LOW:      ${CVE_LOW}${RESET}"
    for i in "${!RESULT_FILES[@]}"; do
        echo -e "${YELLOW}  - ${RESULT_FILES[$i]}: ${RESULT_COUNTS[$i]} vulnerabilities${RESET}"
    done
    echo ""
    echo -e "${YELLOW}Review the output above for details.${RESET}"
    _sbom_result="fail"
    [[ $CVE_CRITICAL -eq 0 ]] && _sbom_result="warn"
else
    echo -e "${GREEN}No vulnerabilities found at severity: ${SEVERITY}${RESET}"
    _sbom_result="pass"
fi

# Append audit record
_sbom_extra='"cve_critical":'"${CVE_CRITICAL}"',"cve_high":'"${CVE_HIGH}"',"cve_medium":'"${CVE_MEDIUM}"',"cve_low":'"${CVE_LOW}"',"files_scanned":'"${#SBOM_FILES[@]}"',"severity_filter":"'"${SEVERITY}"'"'
audit_append "$PROJECT_ROOT" "sbom_scan" "$_sbom_result" "$_sbom_extra"

if [[ $_sbom_result == "fail" ]]; then
    exit 1
else
    exit 0
fi
