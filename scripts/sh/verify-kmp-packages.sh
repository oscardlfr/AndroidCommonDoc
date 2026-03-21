#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/audit-append.sh"

# Verify KMP package organization and detect forbidden imports.
#
# Validates Kotlin Multiplatform architecture by checking:
# - commonMain has no platform-specific imports
# - Platform source sets use appropriate code
# - Pure Kotlin in platform sets that could be in commonMain
# - expect/actual consistency
#
# Usage:
#   ./verify-kmp-packages.sh [--project-root DIR] [--module-path PATH] [--show-details] [--strict]
#
# Examples:
#   ./verify-kmp-packages.sh --module-path "core/data"
#   ./verify-kmp-packages.sh --project-root "../MyProject" --strict --show-details

# --- Color helpers ---
RED='\033[31m'
DARK_RED='\033[91m'
GREEN='\033[32m'
YELLOW='\033[33m'
DARK_YELLOW='\033[93m'
CYAN='\033[36m'
WHITE='\033[37m'
GRAY='\033[90m'
RESET='\033[0m'

# --- Argument parsing ---
PROJECT_ROOT="$(pwd)"
MODULE_PATH=""
SHOW_DETAILS=false
STRICT_MODE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --module-path)
            MODULE_PATH="$2"
            shift 2
            ;;
        --show-details)
            SHOW_DETAILS=true
            shift
            ;;
        --strict)
            STRICT_MODE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--project-root DIR] [--module-path PATH] [--show-details] [--strict]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

ERROR_COUNT=0
WARNING_COUNT=0

if [[ -n "$MODULE_PATH" ]]; then
    SEARCH_PATH="$PROJECT_ROOT/$MODULE_PATH"
else
    SEARCH_PATH="$PROJECT_ROOT"
fi

echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  KMP Package Verification${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo -e "${WHITE}Path: ${SEARCH_PATH}${RESET}"
echo ""

# --- Forbidden imports for commonMain ---
# Each entry: "regex_pattern|description"
FORBIDDEN_IN_COMMON_MAIN=(
    # Android
    'android\.|Android SDK'
    'androidx\.|AndroidX'
    'javax\.inject|Java Inject (use Koin)'
    'dagger\.|Dagger (use Koin)'
    # JVM-only
    'java\.io\.File\b|java.io.File (use Okio)'
    'java\.nio\.|java.nio (use Okio)'
    # Desktop-only
    'javax\.swing|Swing UI'
    'java\.awt|AWT UI'
    # iOS-only
    'platform\.Foundation|iOS Foundation'
    'platform\.UIKit|iOS UIKit'
    'platform\.darwin|Darwin APIs'
    # Frameworks
    'Room|Room Database (use SQLDelight)'
    'Retrofit|Retrofit (use Ktor)'
    'Firebase|Firebase (platform-specific)'
)

# --- Allowlist for commonMain (Compose Multiplatform re-exports) ---
# CMP re-exports androidx.compose.* from commonMain — these are false positives.
# Pattern: if a file imports androidx.compose.* but nothing else from android/androidx,
# it is using CMP and the import is legitimate in commonMain.
# Format: "regex_pattern" — any import matching this is exempt from FORBIDDEN_IN_COMMON_MAIN
COMMON_MAIN_ALLOWLIST=(
    'androidx\.compose\.'
    'androidx\.datastore\.'
    'androidx\.collection\.'
    'androidx\.annotation\.'
    'androidx\.lifecycle\.'
    'androidx\.paging\.'
)

# --- Platform patterns (expected in their respective source sets) ---
# Associative arrays require bash 4+; use positional lookup for bash 3.2 compat
PLATFORM_DIRS=("androidMain" "desktopMain" "iosMain" "appleMain" "jvmMain")
PLATFORM_PATTERNS_androidMain='android\.|androidx\.|javax\.inject'
PLATFORM_PATTERNS_desktopMain='javax\.swing|java\.awt|javax\.sound'
PLATFORM_PATTERNS_iosMain='platform\.Foundation|platform\.UIKit|platform\.darwin'
PLATFORM_PATTERNS_appleMain='platform\.Foundation|platform\.darwin'
PLATFORM_PATTERNS_jvmMain='java\.io\.|java\.nio\.|javax\.'

get_platform_patterns() {
    local dir="$1"
    case "$dir" in
        androidMain) echo "$PLATFORM_PATTERNS_androidMain" ;;
        desktopMain) echo "$PLATFORM_PATTERNS_desktopMain" ;;
        iosMain)     echo "$PLATFORM_PATTERNS_iosMain" ;;
        appleMain)   echo "$PLATFORM_PATTERNS_appleMain" ;;
        jvmMain)     echo "$PLATFORM_PATTERNS_jvmMain" ;;
    esac
}

# --- Find commonMain/shared files ---
COMMON_DIRS=("commonMain" "shared")
COMMON_FILES=()

for dir in "${COMMON_DIRS[@]}"; do
    if [[ -d "$SEARCH_PATH" ]]; then
        while IFS= read -r -d '' file; do
            COMMON_FILES+=("$file")
        done < <(find "$SEARCH_PATH" -type f -name "*.kt" -path "*/src/${dir}/*" \
            ! -path "*/test/*" ! -path "*/build/*" -print0 2>/dev/null || true)
    fi
done

if [[ ${#COMMON_FILES[@]} -gt 0 ]]; then
    echo -e "${YELLOW}Checking commonMain/shared packages...${RESET}"
    echo -e "${WHITE}Found ${#COMMON_FILES[@]} Kotlin files${RESET}"
    echo ""

    for file in "${COMMON_FILES[@]}"; do
        relative_path="${file#"$PROJECT_ROOT"}"
        relative_path="${relative_path#/}"
        content=$(cat "$file" 2>/dev/null || true)

        [[ -z "$content" ]] && continue

        for entry in "${FORBIDDEN_IN_COMMON_MAIN[@]}"; do
            pattern="${entry%%|*}"
            description="${entry#*|}"

            if echo "$content" | grep -qE "import\s+${pattern}"; then
                # Check allowlist: if every matching import is covered by an allowlist pattern, skip
                allowed=true
                while IFS= read -r import_line; do
                    import_path="${import_line#*import }"
                    import_path="${import_path%% *}"
                    match_in_allowlist=false
                    for allow_pattern in "${COMMON_MAIN_ALLOWLIST[@]}"; do
                        if echo "$import_path" | grep -qE "$allow_pattern"; then
                            match_in_allowlist=true
                            break
                        fi
                    done
                    if [[ "$match_in_allowlist" == false ]]; then
                        allowed=false
                        break
                    fi
                done < <(echo "$content" | grep -E "import\s+${pattern}")

                if [[ "$allowed" == true ]]; then
                    continue
                fi

                ERROR_COUNT=$((ERROR_COUNT + 1))
                echo -e "${RED}[ERROR] ${relative_path}${RESET}"
                echo -e "${DARK_RED}        Forbidden import: ${description}${RESET}"

                if [[ "$SHOW_DETAILS" == true ]]; then
                    # Show up to 3 matching lines with line numbers
                    echo "$content" | grep -nE "$pattern" | head -3 | while IFS= read -r line; do
                        linenum="${line%%:*}"
                        linecontent="${line#*:}"
                        linecontent="${linecontent#"${linecontent%%[![:space:]]*}"}"
                        echo -e "${GRAY}        Line ${linenum}: ${linecontent}${RESET}"
                    done
                fi
                echo ""
            fi
        done
    done

    if [[ $ERROR_COUNT -eq 0 ]]; then
        echo -e "${GREEN}[OK] All commonMain/shared files are KMP-compatible${RESET}"
    fi
else
    echo -e "${GRAY}[INFO] No commonMain/shared packages found${RESET}"
fi

echo ""

# --- Check platform source sets for misplaced pure Kotlin ---
for platform_dir in "${PLATFORM_DIRS[@]}"; do
    PLATFORM_FILES=()

    while IFS= read -r -d '' file; do
        PLATFORM_FILES+=("$file")
    done < <(find "$SEARCH_PATH" -type f -name "*.kt" -path "*/src/${platform_dir}/*" \
        ! -path "*/test/*" ! -path "*/build/*" -print0 2>/dev/null || true)

    [[ ${#PLATFORM_FILES[@]} -eq 0 ]] && continue

    echo -e "${YELLOW}Checking ${platform_dir} for misplaced pure Kotlin...${RESET}"
    echo -e "${WHITE}Found ${#PLATFORM_FILES[@]} Kotlin files${RESET}"
    echo ""

    expected_patterns=$(get_platform_patterns "$platform_dir")

    for file in "${PLATFORM_FILES[@]}"; do
        relative_path="${file#"$PROJECT_ROOT"}"
        relative_path="${relative_path#/}"
        content=$(cat "$file" 2>/dev/null || true)

        [[ -z "$content" ]] && continue

        # Check if file has actual declarations (legitimate platform code)
        if echo "$content" | grep -qE '\bactual\s+(fun|class|interface|val|var|typealias)'; then
            continue
        fi

        # Check if file uses any platform-specific APIs
        has_platform_code=false
        # Split patterns by pipe and check each
        IFS='|' read -ra pat_array <<< "$expected_patterns"
        for pat in "${pat_array[@]}"; do
            if echo "$content" | grep -qE "$pat"; then
                has_platform_code=true
                break
            fi
        done

        if [[ "$has_platform_code" == false ]]; then
            WARNING_COUNT=$((WARNING_COUNT + 1))
            echo -e "${YELLOW}[WARN] ${relative_path}${RESET}"
            echo -e "${DARK_YELLOW}       Pure Kotlin file in ${platform_dir} - consider moving to commonMain${RESET}"

            if [[ "$SHOW_DETAILS" == true ]]; then
                echo -e "${GRAY}       No platform-specific imports found${RESET}"
            fi
            echo ""
        fi
    done
done

# --- Check expect/actual consistency ---
echo ""
echo -e "${YELLOW}Checking expect/actual consistency...${RESET}"

EXPECT_FILES=()
while IFS= read -r -d '' file; do
    EXPECT_FILES+=("$file")
done < <(find "$SEARCH_PATH" -type f -name "*.kt" -path "*/src/commonMain/*" \
    ! -path "*/build/*" -print0 2>/dev/null || true)

EXPECT_NAMES=()
EXPECT_TYPES=()
EXPECT_SOURCES=()

for file in "${EXPECT_FILES[@]}"; do
    content=$(cat "$file" 2>/dev/null || true)
    [[ -z "$content" ]] && continue

    # Extract expect declarations (first match per file for simplicity, like the PS1)
    while IFS= read -r match; do
        etype=$(echo "$match" | sed -E 's/^expect\s+(fun|class|interface)\s+.*/\1/')
        ename=$(echo "$match" | sed -E 's/^expect\s+(fun|class|interface)\s+([A-Za-z0-9_]+).*/\2/')
        if [[ -n "$ename" ]]; then
            EXPECT_NAMES+=("$ename")
            EXPECT_TYPES+=("$etype")
            EXPECT_SOURCES+=("$file")
        fi
    done < <(grep -oE 'expect\s+(fun|class|interface)\s+[A-Za-z0-9_]+' "$file" 2>/dev/null || true)
done

if [[ ${#EXPECT_NAMES[@]} -gt 0 ]]; then
    echo -e "${WHITE}Found ${#EXPECT_NAMES[@]} expect declaration(s)${RESET}"

    for i in "${!EXPECT_NAMES[@]}"; do
        ename="${EXPECT_NAMES[$i]}"
        etype="${EXPECT_TYPES[$i]}"

        actual_found=false
        for platform_dir in "${PLATFORM_DIRS[@]}"; do
            ACTUAL_FILES=()
            while IFS= read -r -d '' file; do
                ACTUAL_FILES+=("$file")
            done < <(find "$SEARCH_PATH" -type f -name "*.kt" -path "*/src/${platform_dir}/*" -print0 2>/dev/null || true)

            for actual_file in "${ACTUAL_FILES[@]}"; do
                if grep -qE "actual\s+${etype}\s+${ename}" "$actual_file" 2>/dev/null; then
                    actual_found=true
                    break
                fi
            done
            [[ "$actual_found" == true ]] && break
        done

        if [[ "$actual_found" == false && "$SHOW_DETAILS" == true ]]; then
            echo -e "${DARK_YELLOW}  [?] expect ${etype} ${ename} - no actual found (may be in composite build)${RESET}"
        fi
    done
fi

# --- Summary ---
echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN}  SUMMARY${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo ""

if [[ ${#COMMON_FILES[@]} -gt 0 ]]; then
    echo -e "${WHITE}commonMain/shared files checked: ${#COMMON_FILES[@]}${RESET}"
    if [[ $ERROR_COUNT -gt 0 ]]; then
        echo -e "${RED}KMP violations: ${ERROR_COUNT}${RESET}"
    else
        echo -e "${GREEN}KMP violations: ${ERROR_COUNT}${RESET}"
    fi
fi

if [[ $WARNING_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}Potential misplacements: ${WARNING_COUNT}${RESET}"
else
    echo -e "${GREEN}Potential misplacements: ${WARNING_COUNT}${RESET}"
fi

echo ""

# Append audit record
if [[ $ERROR_COUNT -gt 0 ]]; then
    _kmp_result="fail"
elif [[ $WARNING_COUNT -gt 0 ]]; then
    _kmp_result="warn"
else
    _kmp_result="pass"
fi
_kmp_extra='"errors":'"${ERROR_COUNT}"',"warnings":'"${WARNING_COUNT}"
audit_append "$PROJECT_ROOT" "kmp_verify" "$_kmp_result" "$_kmp_extra"

if [[ $ERROR_COUNT -gt 0 ]]; then
    echo -e "${RED}[FAILED] KMP verification failed${RESET}"
    echo -e "${RED}Action: Move files with forbidden imports to platform-specific source sets${RESET}"
    exit 1
elif [[ $WARNING_COUNT -gt 0 && "$STRICT_MODE" == true ]]; then
    echo -e "${YELLOW}[FAILED] KMP verification failed (strict mode)${RESET}"
    echo -e "${YELLOW}Action: Consider moving pure Kotlin files from platform sets to commonMain${RESET}"
    exit 1
elif [[ $WARNING_COUNT -gt 0 ]]; then
    echo -e "${YELLOW}[PASSED with warnings] KMP verification passed${RESET}"
    echo -e "${YELLOW}Recommendation: Consider moving pure Kotlin files to commonMain${RESET}"
    exit 0
else
    echo -e "${GREEN}[PASSED] KMP verification passed${RESET}"
    exit 0
fi
