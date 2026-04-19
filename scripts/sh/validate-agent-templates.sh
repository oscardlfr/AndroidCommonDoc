#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/audit-append.sh" 2>/dev/null || true

# validate-agent-templates.sh — Deterministic agent template linter.
#
# Validates agent templates for structural correctness, role keyword contracts,
# imperative instruction style, and tool-body cross-references.
# All checks are pure grep/awk — no AI reasoning needed.
#
# Usage:
#   ./validate-agent-templates.sh [--templates-dir DIR] [--agents-dir DIR] [--show-details] [--check CHECK,...]
#
# Checks:
#   frontmatter          Required YAML fields: name, description, tools, model, token_budget
#   role-keywords        Per-role mandatory terms (PM: TeamCreate, arch: APPROVE, etc.)
#   imperative-style     H2 sections must start with imperative verbs, not passive prose
#   tool-body-xref       Body tool references match frontmatter tools declaration
#   anti-patterns        Known bad patterns: passive team descriptions, missing triggers
#   size-limits          Templates ≤300 lines, no exceptions

# --- Color helpers ---
RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
CYAN='\033[36m'
GRAY='\033[90m'
RESET='\033[0m'

# --- Argument parsing ---
TEMPLATES_DIR=""
AGENTS_DIR=""
SHOW_DETAILS=false
CHECKS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --templates-dir)
            TEMPLATES_DIR="$2"
            shift 2
            ;;
        --agents-dir)
            AGENTS_DIR="$2"
            shift 2
            ;;
        --show-details)
            SHOW_DETAILS=true
            shift
            ;;
        --check)
            CHECKS="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--templates-dir DIR] [--agents-dir DIR] [--show-details] [--check CHECK,...]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Auto-detect directories
if [[ -z "$TEMPLATES_DIR" ]]; then
    # Try common locations
    for candidate in "setup/agent-templates" "../AndroidCommonDoc/setup/agent-templates"; do
        if [[ -d "$candidate" ]]; then
            TEMPLATES_DIR="$candidate"
            break
        fi
    done
fi

if [[ -z "$AGENTS_DIR" ]]; then
    if [[ -d ".claude/agents" ]]; then
        AGENTS_DIR=".claude/agents"
    fi
fi

should_run() {
    [[ -z "$CHECKS" ]] && return 0
    echo ",$CHECKS," | grep -q ",$1,"
}

ERRORS=0
WARNINGS=0
TOTAL_CHECKS=0
TOTAL_FILES=0

report_check() {
    local name="$1"
    local count="$2"
    local severity="$3"
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    if [[ $count -eq 0 ]]; then
        echo -e "  ${GREEN}[OK]${RESET} $name"
    elif [[ "$severity" == "ERROR" ]]; then
        echo -e "  ${RED}[FAIL]${RESET} $name -- $count issues"
        ERRORS=$((ERRORS + count))
    else
        echo -e "  ${YELLOW}[WARN]${RESET} $name -- $count issues"
        WARNINGS=$((WARNINGS + count))
    fi
}

detail() {
    if [[ "$SHOW_DETAILS" == "true" ]]; then
        echo -e "    ${GRAY}$1${RESET}"
    fi
}

# Extract YAML frontmatter field value (between --- delimiters)
get_frontmatter_field() {
    local file="$1"
    local field="$2"
    awk -v field="$field" '
        /^---$/ { fm++; next }
        fm == 1 && $0 ~ "^"field":" { sub(/^[^:]+:[[:space:]]*/, ""); gsub(/["'\'']/, ""); print; exit }
        fm >= 2 { exit }
    ' "$file"
}

# Extract body content (after second ---)
get_body() {
    local file="$1"
    awk '
        /^---$/ { fm++; next }
        fm >= 2 { print }
    ' "$file"
}

# Check if line is inside a fenced code block
# Returns list of body lines NOT inside code fences
get_body_no_fences() {
    local file="$1"
    get_body "$file" | awk '
        /^```/ { fence = !fence; next }
        !fence { print }
    '
}

echo -e "${CYAN}Agent Template Validator${RESET}"
echo ""

# Collect all template files to validate
declare -a ALL_FILES=()

if [[ -n "$TEMPLATES_DIR" && -d "$TEMPLATES_DIR" ]]; then
    echo -e "Templates: ${CYAN}$TEMPLATES_DIR${RESET}"
    while IFS= read -r f; do
        [[ "$(basename "$f")" == "README.md" ]] && continue
        ALL_FILES+=("$f")
    done < <(find "$TEMPLATES_DIR" -name "*.md" -type f 2>/dev/null | sort)
fi

if [[ -n "$AGENTS_DIR" && -d "$AGENTS_DIR" ]]; then
    echo -e "Agents:    ${CYAN}$AGENTS_DIR${RESET}"
    while IFS= read -r f; do
        ALL_FILES+=("$f")
    done < <(find "$AGENTS_DIR" -name "*.md" -type f 2>/dev/null | sort)
fi

TOTAL_FILES=${#ALL_FILES[@]}
echo -e "Files:     ${TOTAL_FILES}"
echo ""

if [[ $TOTAL_FILES -eq 0 ]]; then
    echo -e "${RED}No template files found.${RESET}"
    exit 1
fi

# =========================================================================
# Check 1: Frontmatter completeness
# =========================================================================
if should_run "frontmatter"; then
    echo -e "${CYAN}Check 1: Frontmatter completeness${RESET}"
    fm_errors=0
    REQUIRED_FIELDS=("name" "description" "tools")
    RECOMMENDED_FIELDS=("model" "token_budget")

    for f in "${ALL_FILES[@]}"; do
        fname="$(basename "$f")"
        for field in "${REQUIRED_FIELDS[@]}"; do
            val=$(get_frontmatter_field "$f" "$field")
            if [[ -z "$val" ]]; then
                detail "$fname: missing REQUIRED field '$field'"
                fm_errors=$((fm_errors + 1))
            fi
        done
        for field in "${RECOMMENDED_FIELDS[@]}"; do
            val=$(get_frontmatter_field "$f" "$field")
            if [[ -z "$val" ]]; then
                detail "$fname: missing recommended field '$field'"
            fi
        done
    done
    report_check "Frontmatter required fields (name, description, tools)" "$fm_errors" "ERROR"
fi

# =========================================================================
# Check 2: Role keyword contracts
# =========================================================================
if should_run "role-keywords"; then
    echo -e "${CYAN}Check 2: Role keyword contracts${RESET}"
    rk_errors=0

    check_keywords() {
        local file="$1"
        shift
        local fname="$(basename "$file")"
        local body
        body=$(get_body "$file")
        local tools_field
        tools_field=$(get_frontmatter_field "$file" "tools")
        for keyword in "$@"; do
            # Check body OR frontmatter tools (some keywords like Write are tool names)
            if ! echo "$body" | grep -qi "$keyword"; then
                if ! echo "$tools_field" | grep -qi "$keyword"; then
                    detail "$fname: missing required keyword '$keyword'"
                    rk_errors=$((rk_errors + 1))
                fi
            fi
        done
    }

    for f in "${ALL_FILES[@]}"; do
        name=$(get_frontmatter_field "$f" "name")
        case "$name" in
            project-manager)
                check_keywords "$f" "TeamCreate" "SendMessage" "FORBIDDEN" "ALLOWED" "IMMEDIATELY"
                ;;
            planner)
                check_keywords "$f" "SendMessage" "Execution Plan" "Planning Team"
                ;;
            quality-gater)
                check_keywords "$f" "SendMessage" "PASS" "FAIL" "Step 0" "Step 1" "Step 2" "Compose UI Tests"
                ;;
            arch-testing|arch-platform|arch-integration)
                check_keywords "$f" "SendMessage" "APPROVE" "ESCALATE"
                ;;
            context-provider)
                check_keywords "$f" "MANDATORY" "Read"
                ;;
            doc-updater)
                check_keywords "$f" "MANDATORY" "Write"
                ;;
            doc-migrator)
                check_keywords "$f" "Full Migration" "Gap Fill" "Realignment" "Script-first"
                ;;
        esac
    done
    report_check "Role keyword contracts (per-role required terms)" "$rk_errors" "ERROR"
fi

# =========================================================================
# Check 3: Imperative style — H2 sections should start with action verbs
# =========================================================================
if should_run "imperative-style"; then
    echo -e "${CYAN}Check 3: Imperative instruction style${RESET}"
    imp_warnings=0

    # Passive patterns that indicate documentation instead of instructions
    PASSIVE_PATTERNS=(
        "^Teams are "
        "^Agents are "
        "^Work is "
        "^The team "
        "^This section describes"
        "^The following "
        "^In this model"
    )

    for f in "${ALL_FILES[@]}"; do
        fname="$(basename "$f")"
        body_no_fences=$(get_body_no_fences "$f")

        for pattern in "${PASSIVE_PATTERNS[@]}"; do
            hits=$(echo "$body_no_fences" | grep -c "$pattern" 2>/dev/null || true)
            if [[ $hits -gt 0 ]]; then
                detail "$fname: passive prose detected — '$pattern' ($hits occurrences)"
                imp_warnings=$((imp_warnings + hits))
            fi
        done
    done
    report_check "Imperative instruction style (no passive prose)" "$imp_warnings" "WARN"
fi

# =========================================================================
# Check 4: Tool-body cross-reference
# =========================================================================
if should_run "tool-body-xref"; then
    echo -e "${CYAN}Check 4: Tool-body cross-reference${RESET}"
    xref_warnings=0

    # Tool call patterns to detect in body (outside code fences)
    declare -A TOOL_PATTERNS=(
        ["TeamCreate"]="TeamCreate("
        ["Agent"]="Agent("
        ["SendMessage"]="SendMessage("
        ["Write"]="Write("
        ["Edit"]="Edit("
    )

    for f in "${ALL_FILES[@]}"; do
        fname="$(basename "$f")"
        tools_field=$(get_frontmatter_field "$f" "tools")
        body_no_fences=$(get_body_no_fences "$f")

        for tool in "${!TOOL_PATTERNS[@]}"; do
            pattern="${TOOL_PATTERNS[$tool]}"
            # Check if body references the tool (outside fences)
            if echo "$body_no_fences" | grep -q "$pattern" 2>/dev/null; then
                # Check if tool is in frontmatter
                if ! echo "$tools_field" | grep -qi "$tool"; then
                    # Special case: Agent() in PM is via the Agent tool
                    # Special case: examples showing what NOT to do (WRONG patterns)
                    if echo "$body_no_fences" | grep -B1 "$pattern" | grep -qi "WRONG\|NEVER\|FORBIDDEN\|CANNOT\|example"; then
                        continue
                    fi
                    detail "$fname: body references '$tool' but not in frontmatter tools"
                    xref_warnings=$((xref_warnings + 1))
                fi
            fi
        done
    done
    report_check "Tool-body cross-reference (body matches frontmatter)" "$xref_warnings" "WARN"
fi

# =========================================================================
# Check 5: Anti-pattern detection
# =========================================================================
if should_run "anti-patterns"; then
    echo -e "${CYAN}Check 5: Anti-pattern detection${RESET}"
    ap_warnings=0

    for f in "${ALL_FILES[@]}"; do
        fname="$(basename "$f")"
        name=$(get_frontmatter_field "$f" "name")
        body_no_fences=$(get_body_no_fences "$f")

        # PM-specific: must have execution trigger
        if [[ "$name" == "project-manager" ]]; then
            # Hub refactor: PM content may be split across sub-docs in docs/agents/
            # Build combined body: template + all pm-*.md sub-docs
            pm_combined="$body_no_fences"
            pm_docs_dir="$(dirname "$(dirname "$f")")/docs/agents"
            for subdoc in pm-session-setup pm-dispatch-topology pm-verification-gates pm-quality-doc-pipeline pm-phase-execution; do
                subdoc_path="$pm_docs_dir/${subdoc}.md"
                if [[ -f "$subdoc_path" ]]; then
                    pm_combined="$pm_combined
$(cat "$subdoc_path")"
                fi
            done
            if ! echo "$pm_combined" | grep -q "IMMEDIATELY"; then
                detail "$fname: PM missing IMMEDIATELY execution trigger"
                ap_warnings=$((ap_warnings + 1))
            fi
            if ! echo "$pm_combined" | grep -q "STOP PLANNING\|PHASE TRANSITIONS ARE AUTOMATIC"; then
                detail "$fname: PM missing phase transition enforcement rule"
                ap_warnings=$((ap_warnings + 1))
            fi
            if ! echo "$pm_combined" | grep -q "PHASE TRANSITIONS ARE AUTOMATIC"; then
                detail "$fname: PM missing automatic phase transition rule"
                ap_warnings=$((ap_warnings + 1))
            fi
            if ! echo "$pm_combined" | grep -q "DISPOSABLE"; then
                detail "$fname: PM missing DISPOSABLE dev rule"
                ap_warnings=$((ap_warnings + 1))
            fi
        fi

        # Architect-specific: must NOT have Write/Edit in tools
        if [[ "$name" == arch-* ]]; then
            tools_field=$(get_frontmatter_field "$f" "tools")
            if echo "$tools_field" | grep -qi "Write\|Edit"; then
                detail "$fname: Architect has Write/Edit in tools — architects are read-only"
                ap_warnings=$((ap_warnings + 1))
            fi
        fi

        # Planner/quality-gater: must be "peer" not "sub-agent"
        if [[ "$name" == "planner" || "$name" == "quality-gater" ]]; then
            if echo "$body_no_fences" | grep -qi "sub-agent spawned by PM"; then
                detail "$fname: describes self as sub-agent — should be 'team peer'"
                ap_warnings=$((ap_warnings + 1))
            fi
        fi

        # General: named Agent() calls (devs should be anonymous)
        if [[ "$name" == "project-manager" ]]; then
            named_agent_calls=$(echo "$body_no_fences" | grep -c 'Agent(name=' 2>/dev/null || true)
            wrong_markers=$(echo "$body_no_fences" | grep -c 'WRONG' 2>/dev/null || true)
            # Subtract WRONG examples from count
            real_named=$((named_agent_calls - wrong_markers))
            if [[ $real_named -gt 0 ]]; then
                detail "$fname: has $real_named Agent(name=...) calls outside WRONG examples — devs should be anonymous"
                ap_warnings=$((ap_warnings + 1))
            fi
        fi
    done
    report_check "Anti-pattern detection (known bad patterns)" "$ap_warnings" "WARN"
fi

# =========================================================================
# Check 6: Size limits
# =========================================================================
if should_run "size-limits"; then
    echo -e "${CYAN}Check 6: Size limits (agents ≤400, docs ≤300)${RESET}"
    sz_errors=0

    for f in "${ALL_FILES[@]}"; do
        fname="$(basename "$f")"
        lines=$(wc -l < "$f" | tr -d ' \r')
        # Agent templates: 400 lines (orchestrators are complex)
        # Doc files: 300 lines (handled by validate-doc-structure)
        if [[ $lines -gt 400 ]]; then
            detail "$fname: $lines lines (limit: 400)"
            sz_errors=$((sz_errors + 1))
        fi
    done
    report_check "Size limits (all agents ≤400 lines)" "$sz_errors" "ERROR"
fi

# =========================================================================
# Check 7: Template version present and matches MIGRATIONS.json
# =========================================================================
if should_run "version"; then
    echo -e "${CYAN}Check 7: Template versioning${RESET}"
    ver_errors=0

    MIGRATIONS_FILE=""
    if [[ -n "$TEMPLATES_DIR" && -f "$TEMPLATES_DIR/MIGRATIONS.json" ]]; then
        MIGRATIONS_FILE="$TEMPLATES_DIR/MIGRATIONS.json"
    fi

    for f in "${ALL_FILES[@]}"; do
        fname="$(basename "$f")"
        name=$(get_frontmatter_field "$f" "name")
        ver=$(get_frontmatter_field "$f" "template_version")

        # Only check templates (setup/agent-templates/), not production agents (.claude/agents/)
        if [[ "$f" == *"agent-templates"* ]]; then
            if [[ -z "$ver" ]]; then
                detail "$fname: missing template_version in frontmatter"
                ver_errors=$((ver_errors + 1))
            elif [[ -n "$MIGRATIONS_FILE" && -n "$name" ]]; then
                # Skip templates with placeholder names (e.g., {{DOMAIN}}-specialist)
                if [[ "$name" == *"{{"* ]]; then
                    continue
                fi
                # Verify version exists in MIGRATIONS.json
                if ! grep -q "\"$ver\"" "$MIGRATIONS_FILE" 2>/dev/null || ! grep -q "\"$name\"" "$MIGRATIONS_FILE" 2>/dev/null; then
                    detail "$fname: version $ver or name $name not in MIGRATIONS.json"
                    ver_errors=$((ver_errors + 1))
                fi
            fi
        fi
    done
    report_check "Template versioning (template_version present + in MIGRATIONS.json)" "$ver_errors" "ERROR"
fi

# =========================================================================
# Summary
# =========================================================================
echo ""
echo -e "${CYAN}Summary${RESET}"
echo -e "  Files:    $TOTAL_FILES"
echo -e "  Checks:   $TOTAL_CHECKS"

if [[ $ERRORS -eq 0 && $WARNINGS -eq 0 ]]; then
    echo -e "  Result:   ${GREEN}ALL PASS${RESET}"
elif [[ $ERRORS -eq 0 ]]; then
    echo -e "  Warnings: ${YELLOW}$WARNINGS${RESET}"
    echo -e "  Result:   ${YELLOW}PASS with warnings${RESET}"
else
    echo -e "  Errors:   ${RED}$ERRORS${RESET}"
    echo -e "  Warnings: ${YELLOW}$WARNINGS${RESET}"
    echo -e "  Result:   ${RED}BLOCKED${RESET}"
fi

# Append to audit log
RESULT_STATUS="pass"
[[ $ERRORS -gt 0 ]] && RESULT_STATUS="fail"
[[ $WARNINGS -gt 0 && $ERRORS -eq 0 ]] && RESULT_STATUS="warn"
if type audit_append &>/dev/null 2>&1; then
    audit_append "$(pwd)" "validate-agent-templates" "$RESULT_STATUS" "\"errors\":$ERRORS,\"warnings\":$WARNINGS,\"files\":$TOTAL_FILES,\"checks\":$TOTAL_CHECKS" 2>/dev/null || true
fi

# Exit code: non-zero if errors
[[ $ERRORS -eq 0 ]]
