#!/usr/bin/env bash
set -euo pipefail

# Compares version catalogs between KMP projects to detect discrepancies.
#
# Parses libs.versions.toml files from multiple projects and compares
# them against a source of truth. Reports version discrepancies,
# missing dependencies, and outdated versions.
#
# Compatible with bash 3.2+ (macOS default) and bash 5+.
#
# Usage:
#   ./check-version-sync.sh [--source-of-truth DIR] [--projects DIR1,DIR2,...] [--output-format human|json] [--ignore-extra]
#   ./check-version-sync.sh --from-manifest <path/to/versions-manifest.json> --projects DIR1,DIR2,...
#
# Examples:
#   ./check-version-sync.sh --projects "../MyProject,../MyApp"
#   ./check-version-sync.sh --source-of-truth "../shared-libs" --output-format json
#   ./check-version-sync.sh --from-manifest versions-manifest.json --projects "../MyApp"

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
DARK_YELLOW='\033[93m'
CYAN='\033[36m'
MAGENTA='\033[35m'
WHITE='\033[37m'
GRAY='\033[90m'
RESET='\033[0m'

# --- Argument parsing ---
SOURCE_OF_TRUTH="../shared-libs"
FROM_MANIFEST=""
PROJECTS_ARG=""
OUTPUT_FORMAT="human"
IGNORE_EXTRA=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source-of-truth)
            SOURCE_OF_TRUTH="$2"
            shift 2
            ;;
        --from-manifest)
            FROM_MANIFEST="$2"
            shift 2
            ;;
        --projects)
            PROJECTS_ARG="$2"
            shift 2
            ;;
        --output-format)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        --ignore-extra)
            IGNORE_EXTRA=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--source-of-truth DIR | --from-manifest FILE] [--projects DIR1,DIR2,...] [--output-format human|json] [--ignore-extra]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# --- Temp directory for key-value stores (bash 3.2 compat, no associative arrays) ---
TMPWORK="${TMPDIR:-/tmp}/check-version-sync.$$"
mkdir -p "$TMPWORK"
trap 'rm -rf "$TMPWORK"' EXIT

# --- TOML parser: extracts [versions] section key=value pairs ---
# Writes lines of "key=value" to stdout
parse_version_catalog() {
    local path="$1"
    if [[ ! -f "$path" ]]; then
        echo "WARNING: Version catalog not found: $path" >&2
        return
    fi

    local in_versions=false
    while IFS= read -r line; do
        # Trim whitespace
        line="${line#"${line%%[![:space:]]*}"}"
        line="${line%"${line##*[![:space:]]}"}"

        # Skip empty and comments
        [[ -z "$line" || "$line" == \#* ]] && continue

        # Detect sections
        if [[ "$line" == "[versions]" ]]; then
            in_versions=true
            continue
        elif [[ "$line" == \[* ]]; then
            in_versions=false
            continue
        fi

        # Parse key = "value" in versions section
        if [[ "$in_versions" == true ]]; then
            # Use sed to extract key and value
            local key value
            key=$(echo "$line" | sed -nE 's/^([a-zA-Z0-9_-]+)[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p')
            value=$(echo "$line" | sed -nE 's/^([a-zA-Z0-9_-]+)[[:space:]]*=[[:space:]]*"([^"]+)".*/\2/p')
            if [[ -n "$key" && -n "$value" ]]; then
                echo "${key}=${value}"
            fi
        fi
    done < "$path"
}

# Store key-value pairs as files: dir/key contains value
store_versions() {
    local dir="$1"
    mkdir -p "$dir"
    local key value
    while IFS='=' read -r key value; do
        [[ -z "$key" ]] && continue
        echo "$value" > "$dir/$key"
    done
}

# Get a version from a store directory
get_version() {
    local dir="$1" key="$2"
    if [[ -f "$dir/$key" ]]; then
        cat "$dir/$key"
    fi
}

# Check if a key exists in a store directory
has_version() {
    local dir="$1" key="$2"
    [[ -f "$dir/$key" ]]
}

# List all keys in a store directory
list_keys() {
    local dir="$1"
    if [[ -d "$dir" ]]; then
        ls "$dir" 2>/dev/null
    fi
}

# --- Version comparison: returns -1, 0, or 1 ---
compare_versions() {
    local v1="$1" v2="$2"
    [[ "$v1" == "$v2" ]] && echo 0 && return

    # Strip pre-release suffix for numeric comparison
    local v1_clean="${v1%%-*}" v2_clean="${v2%%-*}"

    local IFS='.'
    set -- $v1_clean
    local -a parts1=("$@")
    set -- $v2_clean
    local -a parts2=("$@")

    local max=${#parts1[@]}
    if [[ ${#parts2[@]} -gt $max ]]; then max=${#parts2[@]}; fi

    local i p1 p2
    for ((i = 0; i < max; i++)); do
        p1="${parts1[$i]:-0}"
        p2="${parts2[$i]:-0}"

        # Handle non-numeric gracefully
        if [[ "$p1" =~ ^[0-9]+$ && "$p2" =~ ^[0-9]+$ ]]; then
            if [[ $p1 -lt $p2 ]]; then echo -1; return; fi
            if [[ $p1 -gt $p2 ]]; then echo 1; return; fi
        else
            if [[ "$p1" < "$p2" ]]; then echo -1; return; fi
            if [[ "$p1" > "$p2" ]]; then echo 1; return; fi
        fi
    done

    echo 0
}

# --- JSON manifest parser: extracts versions object as key=value pairs ---
# Requires python3 (available on all target platforms)
parse_manifest_json() {
    local path="$1"
    if [[ ! -f "$path" ]]; then
        echo "WARNING: versions-manifest.json not found: $path" >&2
        return
    fi
    python3 - "$path" <<'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    d = json.load(f)
versions = d.get("versions", {})
for k, v in versions.items():
    # Skip non-version notes (string values containing spaces are notes, not versions)
    if isinstance(v, str) and " " not in v:
        print(f"{k}={v}")
PYEOF
}

# --- Resolve paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"

# --- Resolve source of truth ---
SOURCE_NAME=""
SOURCE_STORE="$TMPWORK/source"

if [[ -n "$FROM_MANIFEST" ]]; then
    # Mode: compare against versions-manifest.json directly
    if [[ "$FROM_MANIFEST" != /* ]]; then
        FROM_MANIFEST="$(pwd)/$FROM_MANIFEST"
    fi
    if [[ ! -f "$FROM_MANIFEST" ]]; then
        echo "ERROR: versions-manifest.json not found: $FROM_MANIFEST" >&2
        exit 2
    fi
    SOURCE_NAME="versions-manifest.json"
    parse_manifest_json "$FROM_MANIFEST" | store_versions "$SOURCE_STORE"

    # Validate: manifest must have at least one version entry
    if [[ -z "$(list_keys "$SOURCE_STORE")" ]]; then
        echo "ERROR: versions-manifest.json has no entries in .versions — check file format" >&2
        exit 2
    fi
else
    # Mode: compare against another project's libs.versions.toml
    if [[ "$SOURCE_OF_TRUTH" != /* ]]; then
        SOURCE_OF_TRUTH="$BASE_DIR/$SOURCE_OF_TRUTH"
    fi
    SOURCE_TOML="$SOURCE_OF_TRUTH/gradle/libs.versions.toml"
    if [[ ! -f "$SOURCE_TOML" ]]; then
        echo "ERROR: Source of truth not found: $SOURCE_TOML" >&2
        exit 2
    fi
    SOURCE_NAME="$(basename "$SOURCE_OF_TRUTH")"
    parse_version_catalog "$SOURCE_TOML" | store_versions "$SOURCE_STORE"
fi
PROJECTS=()
if [[ -n "$PROJECTS_ARG" ]]; then
    IFS=',' read -ra PROJECTS <<< "$PROJECTS_ARG"
else
    # Auto-detect: look for sibling dirs with version catalogs
    PARENT_DIR="$(dirname "$BASE_DIR")"
    for candidate in "$PARENT_DIR"/*/; do
        if [[ -f "${candidate}gradle/libs.versions.toml" ]]; then
            PROJECTS+=("$candidate")
        fi
    done
fi

# --- Results tracking ---
TOTAL_PROJECTS=${#PROJECTS[@]}
TOTAL_DISCREPANCIES=0
PROJECTS_WITH_ISSUES=0

# Accumulate output data
PROJECT_NAMES=()
PROJECT_DISC_FILES=()
PROJECT_EXTRA_FILES=()

# For JSON output
JSON_PROJECTS=""

# --- Compare each project ---
for project_path in "${PROJECTS[@]}"; do
    # Resolve relative paths
    if [[ "$project_path" != /* ]]; then
        project_path="$BASE_DIR/$project_path"
    fi
    project_path="${project_path%/}"

    toml_path="$project_path/gradle/libs.versions.toml"
    project_name="$(basename "$project_path")"

    if [[ ! -f "$toml_path" ]]; then
        echo "WARNING: Version catalog not found for project: $project_name" >&2
        continue
    fi

    # Parse project versions into temp store
    PROJ_STORE="$TMPWORK/proj_${project_name}"
    parse_version_catalog "$toml_path" | store_versions "$PROJ_STORE"

    # Track per-project results in temp files
    DISC_FILE="$TMPWORK/disc_${project_name}"
    EXTRA_FILE="$TMPWORK/extra_${project_name}"
    : > "$DISC_FILE"
    : > "$EXTRA_FILE"
    disc_count=0
    extra_count=0

    # Check for discrepancies (versions in both but different)
    for key in $(list_keys "$SOURCE_STORE"); do
        if has_version "$PROJ_STORE" "$key"; then
            source_val=$(get_version "$SOURCE_STORE" "$key")
            project_val=$(get_version "$PROJ_STORE" "$key")

            if [[ "$source_val" != "$project_val" ]]; then
                cmp=$(compare_versions "$source_val" "$project_val")
                if [[ $cmp -gt 0 ]]; then
                    status="outdated"
                elif [[ $cmp -lt 0 ]]; then
                    status="ahead"
                else
                    status="different"
                fi

                disc_count=$((disc_count + 1))
                echo "${key}|${project_val}|${source_val}|${status}" >> "$DISC_FILE"
            fi
        fi
    done

    # Check for extra dependencies (in project but not in source)
    if [[ "$IGNORE_EXTRA" == false ]]; then
        for key in $(list_keys "$PROJ_STORE"); do
            if ! has_version "$SOURCE_STORE" "$key"; then
                extra_count=$((extra_count + 1))
                proj_val=$(get_version "$PROJ_STORE" "$key")
                echo "${key}|${proj_val}" >> "$EXTRA_FILE"
            fi
        done
    fi

    TOTAL_DISCREPANCIES=$((TOTAL_DISCREPANCIES + disc_count))
    if [[ $disc_count -gt 0 || $extra_count -gt 0 ]]; then
        PROJECTS_WITH_ISSUES=$((PROJECTS_WITH_ISSUES + 1))
    fi

    PROJECT_NAMES+=("$project_name")
    PROJECT_DISC_FILES+=("$DISC_FILE")
    PROJECT_EXTRA_FILES+=("$EXTRA_FILE")

    # Build JSON if needed
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        disc_json="["
        first=true
        while IFS='|' read -r dkey dproj dsrc dstatus; do
            [[ -z "$dkey" ]] && continue
            [[ "$first" == true ]] && first=false || disc_json="${disc_json},"
            disc_json="${disc_json}{\"dependency\":\"${dkey}\",\"projectVersion\":\"${dproj}\",\"sourceVersion\":\"${dsrc}\",\"status\":\"${dstatus}\"}"
        done < "$DISC_FILE"
        disc_json="${disc_json}]"

        extra_json="["
        first=true
        while IFS='|' read -r ekey ever; do
            [[ -z "$ekey" ]] && continue
            [[ "$first" == true ]] && first=false || extra_json="${extra_json},"
            extra_json="${extra_json}{\"dependency\":\"${ekey}\",\"version\":\"${ever}\"}"
        done < "$EXTRA_FILE"
        extra_json="${extra_json}]"

        proj_json="{\"name\":\"${project_name}\",\"discrepancies\":${disc_json},\"extraDependencies\":${extra_json}}"
        [[ -n "$JSON_PROJECTS" ]] && JSON_PROJECTS="${JSON_PROJECTS},"
        JSON_PROJECTS="${JSON_PROJECTS}${proj_json}"
    fi
done

# --- Output ---
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    echo "{\"sourceOfTruth\":\"${SOURCE_NAME}\",\"summary\":{\"totalProjects\":${TOTAL_PROJECTS},\"totalDiscrepancies\":${TOTAL_DISCREPANCIES},\"projectsWithIssues\":${PROJECTS_WITH_ISSUES}},\"projects\":[${JSON_PROJECTS}]}"
    if [[ $TOTAL_DISCREPANCIES -gt 0 ]]; then exit 1; fi
    exit 0
fi

# --- Human-readable output ---
echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  Version Sync Check Report${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo ""
echo -ne "Source of Truth: "
echo -e "${YELLOW}${SOURCE_NAME}${RESET}"
echo "Projects Checked: ${TOTAL_PROJECTS}"
echo ""

if [[ $TOTAL_DISCREPANCIES -eq 0 && $PROJECTS_WITH_ISSUES -eq 0 ]]; then
    echo -e "${GREEN}All versions are in sync!${RESET}"
    echo ""
    exit 0
fi

for idx in "${!PROJECT_NAMES[@]}"; do
    project_name="${PROJECT_NAMES[$idx]}"
    disc_file="${PROJECT_DISC_FILES[$idx]}"
    extra_file="${PROJECT_EXTRA_FILES[$idx]}"
    disc_count=$(wc -l < "$disc_file" | tr -d ' ')
    extra_count=$(wc -l < "$extra_file" | tr -d ' ')

    echo "----------------------------------------"
    echo -ne "Project: "
    echo -e "${YELLOW}${project_name}${RESET}"

    if [[ $disc_count -eq 0 && $extra_count -eq 0 ]]; then
        echo -ne "  Status: "
        echo -e "${GREEN}OK${RESET}"
        continue
    fi

    if [[ $disc_count -gt 0 ]]; then
        echo ""
        echo -e "${RED}  Version Discrepancies:${RESET}"
        echo "  ----------------------"

        while IFS='|' read -r dkey dproj dsrc dstatus; do
            [[ -z "$dkey" ]] && continue
            case "$dstatus" in
                outdated) color="$YELLOW" ;;
                ahead)    color="$CYAN" ;;
                *)        color="$MAGENTA" ;;
            esac
            echo -e "    ${dkey}: ${color}${dproj}${RESET} (source: ${dsrc}) ${color}[${dstatus}]${RESET}"
        done < "$disc_file"
    fi

    if [[ $extra_count -gt 0 ]]; then
        echo ""
        echo -e "${DARK_YELLOW}  Extra Dependencies (not in source):${RESET}"
        echo "  ------------------------------------"

        while IFS='|' read -r ekey ever; do
            [[ -z "$ekey" ]] && continue
            echo -e "${GRAY}    ${ekey}: ${ever}${RESET}"
        done < "$extra_file"
    fi
done

echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}Summary:${RESET}"
echo "  Total Discrepancies: ${TOTAL_DISCREPANCIES}"
echo "  Projects with Issues: ${PROJECTS_WITH_ISSUES} / ${TOTAL_PROJECTS}"
echo -e "${CYAN}========================================${RESET}"
echo ""

if [[ $TOTAL_DISCREPANCIES -gt 0 ]]; then
    echo -e "${YELLOW}Suggested Actions:${RESET}"
    echo "  1. Update project versions to match source of truth"
    echo "  2. Or update source of truth if project has newer versions"
    echo "  3. Run './gradlew build' after updating to verify compatibility"
    echo ""
    exit 1
fi

exit 0
