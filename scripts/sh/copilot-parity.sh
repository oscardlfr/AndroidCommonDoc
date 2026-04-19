#!/usr/bin/env bash
set -euo pipefail

# copilot-parity.sh -- Verify parity between skills/ and setup/copilot-templates/.
#
# Checks:
#   1. Every skill with copilot: true has a .prompt.md template
#   2. No orphaned templates for skills with copilot: false or missing skills
#   3. No templates with empty implementation blocks
#   4. Skills have the copilot frontmatter field
#
# Usage:
#   copilot-parity.sh [--project-root DIR] [--fix] [--verbose]
#
# Exit codes:
#   0 = parity OK
#   1 = parity violations found

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

FIX=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 [--project-root DIR] [--fix] [--verbose]"
            echo ""
            echo "Checks parity between skills/ and setup/copilot-templates/."
            echo ""
            echo "Options:"
            echo "  --project-root DIR  Project root (default: auto-detect)"
            echo "  --fix               Auto-fix by running copilot-adapter.sh --clean"
            echo "  --verbose           Show OK entries too"
            exit 0
            ;;
        --project-root)
            TOOLKIT_ROOT="$2"
            shift 2
            ;;
        --fix)
            FIX=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

SKILLS_DIR="$TOOLKIT_ROOT/skills"
TEMPLATES_DIR="$TOOLKIT_ROOT/setup/copilot-templates"

MISSING=()
ORPHANED=()
EMPTY=()
NO_FIELD=()
OK_COUNT=0

# Helper: extract a frontmatter field value
extract_field() {
    local file="$1" field="$2"
    awk -v f="$field" '
        /^---$/{n++; next}
        n>=2{exit}
        n==1 && $0 ~ "^"f":"{
            sub("^"f":[[:space:]]*\"?", "")
            sub("\"?[[:space:]]*$", "")
            print
            exit
        }
    ' "$file"
}

echo "Copilot Template Parity Check"
echo "  Skills:    $SKILLS_DIR"
echo "  Templates: $TEMPLATES_DIR"
echo ""

# --- Check 1: FRONTMATTER — every skill must have copilot: field ---
echo "FRONTMATTER:"
for skill_dir in "$SKILLS_DIR"/*/; do
    skill_file="$skill_dir/SKILL.md"
    [[ -f "$skill_file" ]] || continue
    name=$(basename "$skill_dir")

    copilot_val=$(extract_field "$skill_file" "copilot")
    if [[ -z "$copilot_val" ]]; then
        NO_FIELD+=("$name")
        echo "  [MISSING] $name -- no 'copilot:' field in SKILL.md frontmatter"
    elif $VERBOSE; then
        echo "  [OK]      $name -- copilot: $copilot_val"
    fi
done
echo ""

# --- Check 2: COVERAGE — copilot: true skills must have templates ---
echo "COVERAGE:"
for skill_dir in "$SKILLS_DIR"/*/; do
    skill_file="$skill_dir/SKILL.md"
    [[ -f "$skill_file" ]] || continue
    name=$(extract_field "$skill_file" "name")
    [[ -z "$name" ]] && name=$(basename "$skill_dir")

    copilot_val=$(extract_field "$skill_file" "copilot")
    [[ "$copilot_val" != "true" ]] && continue

    template_file="$TEMPLATES_DIR/$name.prompt.md"
    if [[ ! -f "$template_file" ]]; then
        MISSING+=("$name")
        echo "  [MISSING] $name -- copilot: true but no template at $name.prompt.md"
    else
        OK_COUNT=$((OK_COUNT + 1))
        $VERBOSE && echo "  [OK]      $name -- template exists"
    fi
done
echo ""

# --- Check 3: ORPHAN — templates without copilot: true skill ---
echo "ORPHANED:"
orphan_found=false
for template in "$TEMPLATES_DIR"/*.prompt.md; do
    [[ -f "$template" ]] || continue
    tname=$(basename "$template" .prompt.md)

    # Find the skill directory (match by name field or directory name)
    skill_found=false
    copilot_val=""
    for skill_dir in "$SKILLS_DIR"/*/; do
        skill_file="$skill_dir/SKILL.md"
        [[ -f "$skill_file" ]] || continue
        sname=$(extract_field "$skill_file" "name")
        [[ -z "$sname" ]] && sname=$(basename "$skill_dir")
        if [[ "$sname" == "$tname" ]]; then
            skill_found=true
            copilot_val=$(extract_field "$skill_file" "copilot")
            break
        fi
    done

    if ! $skill_found; then
        ORPHANED+=("$tname")
        echo "  [ORPHAN]  $tname.prompt.md -- no matching skill found"
        orphan_found=true
    elif [[ "$copilot_val" != "true" ]]; then
        ORPHANED+=("$tname")
        echo "  [ORPHAN]  $tname.prompt.md -- skill has copilot: $copilot_val"
        orphan_found=true
    elif $VERBOSE; then
        echo "  [OK]      $tname.prompt.md"
    fi
done
if ! $orphan_found; then
    echo "  [OK]      No orphaned templates"
fi
echo ""

# --- Check 4: EMPTY — templates with empty code blocks or empty instructions ---
echo "EMPTY:"
empty_found=false
for template in "$TEMPLATES_DIR"/*.prompt.md; do
    [[ -f "$template" ]] || continue
    tname=$(basename "$template" .prompt.md)

    if grep -q "^## Instructions" "$template"; then
        # Behavioral template: check for non-empty instructions
        has_content=$(awk '
            /^## Instructions/{found_section=1; next}
            found_section && /[^ \t]/{found=1}
            END{print found ? "yes" : "no"}
        ' "$template")
        if [[ "$has_content" == "no" ]]; then
            EMPTY+=("$tname")
            echo "  [EMPTY]   $tname.prompt.md -- instructions section is empty"
            empty_found=true
        elif $VERBOSE; then
            echo "  [OK]      $tname.prompt.md -- has instruction content"
        fi
    elif grep -q "^## Implementation" "$template"; then
        # Scripted template: check for empty code blocks
        has_content=$(awk '
            /^```bash$/{in_code=1; next}
            /^```powershell$/{in_code=1; next}
            /^```$/{in_code=0; next}
            in_code && /[^ \t]/{found=1}
            END{print found ? "yes" : "no"}
        ' "$template")
        if [[ "$has_content" == "no" ]]; then
            EMPTY+=("$tname")
            echo "  [EMPTY]   $tname.prompt.md -- implementation code blocks are empty"
            empty_found=true
        elif $VERBOSE; then
            echo "  [OK]      $tname.prompt.md -- has implementation content"
        fi
    else
        EMPTY+=("$tname")
        echo "  [EMPTY]   $tname.prompt.md -- no Implementation or Instructions section"
        empty_found=true
    fi
done
if ! $empty_found; then
    echo "  [OK]      No empty templates"
fi
echo ""

# --- Summary ---
TOTAL_ISSUES=$(( ${#MISSING[@]} + ${#ORPHANED[@]} + ${#EMPTY[@]} + ${#NO_FIELD[@]} ))

if [[ $TOTAL_ISSUES -eq 0 ]]; then
    echo "RESULT: PASS -- $OK_COUNT skills with copilot: true, all templates valid"
    echo '{"status":"pass","ok":'"$OK_COUNT"',"missing":0,"orphaned":0,"empty":0,"no_field":0}'
    exit 0
fi

echo "RESULT: FAIL -- $TOTAL_ISSUES issues found"
echo "  Missing templates: ${#MISSING[@]}"
echo "  Orphaned templates: ${#ORPHANED[@]}"
echo "  Empty templates: ${#EMPTY[@]}"
echo "  Missing copilot field: ${#NO_FIELD[@]}"

if $FIX; then
    echo ""
    echo "Auto-fixing with copilot-adapter.sh --clean..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    bash "$SCRIPT_DIR/../../adapters/copilot-adapter.sh" --clean
    echo "Fix applied. Run this check again to verify."
fi

echo '{"status":"fail","ok":'"$OK_COUNT"',"missing":'"${#MISSING[@]}"',"orphaned":'"${#ORPHANED[@]}"',"empty":'"${#EMPTY[@]}"',"no_field":'"${#NO_FIELD[@]}"'}'
exit 1
