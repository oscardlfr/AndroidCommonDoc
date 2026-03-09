#!/usr/bin/env bash
set -euo pipefail

# Analyzes SBOM files for dependency statistics, licenses, and potential concerns.
#
# Parses CycloneDX JSON SBOM files and provides:
# - Component count and types
# - Top publishers and dependency groups
# - License distribution
# - Potential concerns (GPL, missing versions)
#
# Requires: python3
#
# Usage:
#   ./analyze-sbom.sh --project-root DIR [--module MODULE] [--sbom-path PATH]
#
# Examples:
#   ./analyze-sbom.sh --project-root ~/Projects/MyApp
#   ./analyze-sbom.sh --project-root ~/Projects/MyApp --module androidApp
#   ./analyze-sbom.sh --project-root ~/Projects/MyApp --sbom-path androidApp/build/reports/bom-android.json

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
DARK_YELLOW='\033[93m'
CYAN='\033[36m'
WHITE='\033[37m'
RESET='\033[0m'

# --- Argument parsing ---
PROJECT_ROOT=""
MODULE=""
SBOM_PATH=""

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
        --sbom-path)
            SBOM_PATH="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 --project-root DIR [--module MODULE] [--sbom-path PATH]"
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

# Check python3 availability
if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 is required for JSON parsing."
    exit 1
fi

# --- Find SBOM file ---
SBOM_FILE=""

if [[ -n "$SBOM_PATH" ]]; then
    if [[ "$SBOM_PATH" == /* ]]; then
        SBOM_FILE="$SBOM_PATH"
    else
        SBOM_FILE="$PROJECT_ROOT/$SBOM_PATH"
    fi
    if [[ ! -f "$SBOM_FILE" ]]; then
        SBOM_FILE=""
    fi
elif [[ -n "$MODULE" ]]; then
    SBOM_FILE=$(find "$PROJECT_ROOT/$MODULE" -type f -name "bom-*.json" 2>/dev/null | head -1 || true)
else
    SBOM_FILE=$(find "$PROJECT_ROOT" -type f -name "bom-*.json" 2>/dev/null | head -1 || true)
fi

if [[ -z "$SBOM_FILE" || ! -f "$SBOM_FILE" ]]; then
    echo -e "${RED}ERROR: No SBOM file found.${RESET}"
    echo -e "${YELLOW}Run generate-sbom.sh first to generate SBOM files.${RESET}"
    exit 1
fi

RELATIVE_PATH="${SBOM_FILE#"$PROJECT_ROOT"}"
RELATIVE_PATH="${RELATIVE_PATH#/}"

echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  SBOM Analysis${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo -e "${WHITE}File: ${RELATIVE_PATH}${RESET}"
echo ""

# --- Use python3 for all JSON analysis ---
python3 -c "
import json, sys
from collections import Counter

with open('$SBOM_FILE', 'r') as f:
    sbom = json.load(f)

# Metadata
meta = sbom.get('metadata', {})
print('\033[33mMETADATA:\033[0m')
print(f\"  Generated:  {meta.get('timestamp', 'N/A')}\")
print(f\"  Format:     {sbom.get('bomFormat', 'N/A')} v{sbom.get('specVersion', 'N/A')}\")
comp_meta = meta.get('component', {})
print(f\"  Component:  {comp_meta.get('name', 'N/A')}\")
serial = sbom.get('serialNumber', '')
if serial:
    print(f'  Serial:     {serial}')
print()

# Components
components = sbom.get('components', [])
if not components:
    print('\033[33mNo components found in SBOM.\033[0m')
    sys.exit(0)

print('\033[33mDEPENDENCIES:\033[0m')
print(f'  Total components: {len(components)}')

# Group by type
type_counts = Counter(c.get('type', 'unknown') for c in components)
for t, count in type_counts.most_common():
    print(f'  - {t}: {count}')
print()

# Top publishers
print('\033[33mTOP PUBLISHERS:\033[0m')
publishers = [c.get('publisher', '') for c in components if c.get('publisher')]
if publishers:
    for pub, count in Counter(publishers).most_common(10):
        print(f'  {count:3d} - {pub}')
else:
    print('  (no publisher info available)')
print()

# Top dependency groups
print('\033[33mTOP DEPENDENCY GROUPS:\033[0m')
groups = [c.get('group', '') for c in components if c.get('group')]
if groups:
    for grp, count in Counter(groups).most_common(15):
        print(f'  {count:3d} - {grp}')
else:
    print('  (no group info available)')
print()

# Licenses
print('\033[33mLICENSES:\033[0m')
with_license = [c for c in components if c.get('licenses')]
without_license = [c for c in components if not c.get('licenses')]
print(f'  With license info:    {len(with_license)}')
print(f'  Without license info: {len(without_license)}')

all_licenses = []
for c in with_license:
    for lic in c.get('licenses', []):
        l = lic.get('license', {})
        lid = l.get('id') or l.get('name')
        if lid:
            all_licenses.append(lid)

if all_licenses:
    print()
    print('  Most common licenses:')
    for name, count in Counter(all_licenses).most_common(10):
        print(f'    {count:3d} - {name}')
print()

# Potential concerns
print('\033[33mPOTENTIAL CONCERNS:\033[0m')

# GPL check
gpl_components = []
for c in components:
    for lic in c.get('licenses', []):
        l = lic.get('license', {})
        lid = (l.get('id') or '') + (l.get('name') or '')
        if 'GPL' in lid:
            gpl_components.append(c)
            break

if gpl_components:
    print(f'  \033[31mWARNING: {len(gpl_components)} component(s) with GPL license\033[0m')
    for gc in gpl_components[:5]:
        print(f\"    \033[93m- {gc.get('group', '')}:{gc.get('name', '')}\033[0m\")
    if len(gpl_components) > 5:
        print(f'    \033[93m... and {len(gpl_components) - 5} more\033[0m')
else:
    print('  \033[32m[OK] No GPL-licensed dependencies\033[0m')

# Unknown versions
unknown = [c for c in components if not c.get('version') or c.get('version') == 'unspecified']
if unknown:
    print(f'  \033[93m[NOTE] {len(unknown)} component(s) with unspecified version\033[0m')
else:
    print('  \033[32m[OK] All components have version specified\033[0m')

# Deprecated check
deprecated = [c for c in components if c.get('pedigree', {}).get('notes', '') and 'deprecated' in c.get('pedigree', {}).get('notes', '').lower()]
if deprecated:
    print(f'  \033[33m[WARN] {len(deprecated)} deprecated component(s)\033[0m')

print()
"
