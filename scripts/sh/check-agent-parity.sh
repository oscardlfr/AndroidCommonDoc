#!/usr/bin/env bash
set -euo pipefail

# check-agent-parity.sh -- Verify parity between .claude/agents/ and GSD agents.
#
# Checks:
#   1. Every .claude/agents/*.md has a corresponding GSD agent
#   2. GSD agent content is not stale (derived from source)
#   3. No orphaned GSD agents without a .claude source
#
# Usage:
#   check-agent-parity.sh [--target user|project] [--project-root DIR] [--fix]
#
# Exit codes:
#   0 = parity OK
#   1 = parity violations found

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

TARGET="user"
PROJECT_ROOT=""
FIX=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 [--target user|project] [--project-root DIR] [--fix]"
            echo ""
            echo "Checks parity between .claude/agents/ and GSD subagents."
            echo ""
            echo "Options:"
            echo "  --target user|project  Where GSD agents live (default: user)"
            echo "  --project-root DIR     Source project root"
            echo "  --fix                  Auto-fix by running sync-gsd-agents.sh"
            exit 0
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --fix)
            FIX=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

[[ -n "$PROJECT_ROOT" ]] && TOOLKIT_ROOT="$PROJECT_ROOT"

CLAUDE_AGENTS_DIR="$TOOLKIT_ROOT/.claude/agents"

if [[ "$TARGET" == "user" ]]; then
    GSD_AGENTS_DIR="$HOME/.gsd/agent/agents"
else
    GSD_AGENTS_DIR="$TOOLKIT_ROOT/.gsd/agents"
fi

# --- Also check GSD skills location for synced skills ---
GSD_SKILLS_DIR="$HOME/.gsd/agent/skills/l0-agents"

MISSING=()
STALE=()
ORPHANED=()
OK_COUNT=0

# Helper: extract name from frontmatter
extract_name() {
    sed -n '/^---$/,/^---$/{/^name:/p}' "$1" | head -1 | sed 's/^name: *//' | sed 's/^["'"'"']//' | sed 's/["'"'"']$//'
}

# Helper: extract body after frontmatter
extract_body() {
    awk 'BEGIN{c=0} /^---$/{c++;next} c>=2{print}' "$1"
}

# Helper: normalize body for comparison (strip whitespace variance)
normalize() {
    sed 's/[[:space:]]*$//' | grep -v '^$' || true
}

echo "Agent Parity Check"
echo "  Source: $CLAUDE_AGENTS_DIR"
echo "  Target: $GSD_AGENTS_DIR"
echo ""

# --- Check 1: Every .claude agent has a GSD agent ---
for agent_file in "$CLAUDE_AGENTS_DIR"/*.md; do
    [[ ! -f "$agent_file" ]] && continue
    name=$(basename "$agent_file" .md)

    gsd_file="$GSD_AGENTS_DIR/${name}.md"

    if [[ ! -f "$gsd_file" ]]; then
        MISSING+=("$name")
        echo "  [MISSING] $name — no GSD agent at $gsd_file"
        continue
    fi

    # Compare bodies (content after frontmatter)
    source_body=$(extract_body "$agent_file" | normalize)
    gsd_body=$(extract_body "$gsd_file" | normalize)

    if [[ "$source_body" != "$gsd_body" ]]; then
        STALE+=("$name")
        echo "  [STALE]   $name — GSD agent body differs from .claude source"
    else
        OK_COUNT=$((OK_COUNT + 1))
        echo "  [OK]      $name"
    fi
done

# --- Check 2: No orphaned GSD agents that came from .claude ---
# Only flag agents that look like they were generated (have a matching .claude source pattern)
# Don't flag project-specific agents like dawsync-*
if [[ -d "$GSD_AGENTS_DIR" ]]; then
    for gsd_file in "$GSD_AGENTS_DIR"/*.md; do
        [[ ! -f "$gsd_file" ]] && continue
        name=$(basename "$gsd_file" .md)

        claude_file="$CLAUDE_AGENTS_DIR/${name}.md"

        # Skip agents that never had a .claude source (project-specific agents)
        # Heuristic: if it exists in l0-agents skills, it was synced from .claude
        if [[ ! -f "$claude_file" ]]; then
            if [[ -d "$GSD_SKILLS_DIR/$name" ]]; then
                ORPHANED+=("$name")
                echo "  [ORPHAN]  $name — GSD agent exists but .claude source was deleted"
            fi
        fi
    done
fi

echo ""

TOTAL_ISSUES=$(( ${#MISSING[@]} + ${#STALE[@]} + ${#ORPHANED[@]} ))

if [[ $TOTAL_ISSUES -eq 0 ]]; then
    echo "RESULT: PASS — $OK_COUNT agents in parity"
    echo '{"status":"pass","ok":'"$OK_COUNT"',"missing":0,"stale":0,"orphaned":0}'
    exit 0
fi

echo "RESULT: FAIL — $TOTAL_ISSUES issues found"
echo "  Missing: ${#MISSING[@]}"
echo "  Stale:   ${#STALE[@]}"
echo "  Orphaned: ${#ORPHANED[@]}"

if [[ "$FIX" == "true" ]]; then
    echo ""
    echo "Auto-fixing with sync-gsd-agents.sh..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    bash "$SCRIPT_DIR/sync-gsd-agents.sh" --target "$TARGET" --project-root "$TOOLKIT_ROOT" --verbose
    echo "Fix applied. Run this check again to verify."
fi

echo '{"status":"fail","ok":'"$OK_COUNT"',"missing":'"${#MISSING[@]}"',"stale":'"${#STALE[@]}"',"orphaned":'"${#ORPHANED[@]}"'}'
exit 1
