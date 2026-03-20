#!/usr/bin/env bash
set -euo pipefail

# sync-gsd-agents.sh -- Generate GSD subagent wrappers from .claude/agents/*.md
#
# GSD subagent resolves agents from:
#   - ~/.gsd/agent/agents/   (user-level)
#   - .gsd/agents/           (project-level)
#
# .claude/agents/*.md are Claude Code native agents.
# This script generates GSD-compatible wrappers so that `subagent` can invoke them.
#
# Usage:
#   sync-gsd-agents.sh [--target user|project] [--dry-run] [--verbose] [--project-root DIR]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Defaults ---
TARGET="user"
DRY_RUN=false
VERBOSE=false
PROJECT_ROOT=""

# --- Argument parsing ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 [--target user|project] [--dry-run] [--verbose] [--project-root DIR]"
            echo ""
            echo "Generates GSD subagent wrappers from .claude/agents/*.md files."
            echo ""
            echo "Options:"
            echo "  --target user|project  Where to write agents (default: user = ~/.gsd/agent/agents/)"
            echo "  --dry-run              Preview changes without writing"
            echo "  --verbose              Show per-agent details"
            echo "  --project-root DIR     Source project root (default: \$ANDROID_COMMON_DOC or script parent)"
            exit 0
            ;;
        --target)
            TARGET="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

[[ -n "$PROJECT_ROOT" ]] && TOOLKIT_ROOT="$PROJECT_ROOT"

CLAUDE_AGENTS_DIR="$TOOLKIT_ROOT/.claude/agents"
MODEL_PROFILES="$TOOLKIT_ROOT/.claude/model-profiles.json"

if [[ "$TARGET" == "user" ]]; then
    GSD_AGENTS_DIR="$HOME/.gsd/agent/agents"
else
    GSD_AGENTS_DIR="$TOOLKIT_ROOT/.gsd/agents"
fi

if [[ ! -d "$CLAUDE_AGENTS_DIR" ]]; then
    echo '{"error":"no .claude/agents/ directory found","generated":0}' >&2
    exit 1
fi

# --- Read current model profile ---
CURRENT_PROFILE=""
if [[ -f "$MODEL_PROFILES" ]]; then
    CURRENT_PROFILE=$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    print(data.get('current', 'balanced'))
except: print('balanced')
" "$MODEL_PROFILES" 2>/dev/null || echo "balanced")
fi

# --- Extract frontmatter fields from a .claude/agents/*.md file ---
extract_field() {
    local file="$1" field="$2"
    sed -n '/^---$/,/^---$/{/^'"$field"':/p}' "$file" | head -1 | sed 's/^'"$field"': *//' | sed 's/^["'"'"']//' | sed 's/["'"'"']$//'
}

# --- Extract body (everything after second ---) ---
extract_body() {
    local file="$1"
    awk 'BEGIN{c=0} /^---$/{c++;next} c>=2{print}' "$file"
}

# --- Resolve model for an agent name from model-profiles.json ---
resolve_model() {
    local agent_name="$1"
    if [[ -z "$CURRENT_PROFILE" || ! -f "$MODEL_PROFILES" ]]; then
        echo ""
        return
    fi
    python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    profile = data['profiles'].get(sys.argv[2], {})
    overrides = profile.get('overrides', {})
    if sys.argv[3] in overrides:
        print(overrides[sys.argv[3]])
    else:
        print(profile.get('default_model', ''))
except: print('')
" "$MODEL_PROFILES" "$CURRENT_PROFILE" "$agent_name" 2>/dev/null || echo ""
}

# --- Map Claude Code tools to GSD tools ---
map_tools() {
    local claude_tools="$1"
    # Normalize to lowercase, map to GSD tool names
    echo "$claude_tools" | tr '[:upper:]' '[:lower:]' | sed 's/grep/bash/g' | sed 's/glob/bash/g' | sed 's/agent/subagent/g' | tr ',' '\n' | sort -u | tr '\n' ',' | sed 's/,$//' | sed 's/^,//'
}

# --- Generate GSD agent wrapper ---
NEW_COUNT=0
UPDATED_COUNT=0
UNCHANGED_COUNT=0
SKIPPED_COUNT=0
DETAILS=""

compute_sha() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"
    fi
}

for agent_file in "$CLAUDE_AGENTS_DIR"/*.md; do
    [[ ! -f "$agent_file" ]] && continue

    name=$(extract_field "$agent_file" "name")
    description=$(extract_field "$agent_file" "description")
    claude_tools=$(extract_field "$agent_file" "tools")
    body=$(extract_body "$agent_file")

    [[ -z "$name" ]] && continue

    # Map tools
    gsd_tools=$(map_tools "$claude_tools")

    # Build GSD agent content
    gsd_content="---
name: ${name}
description: ${description}
tools: ${gsd_tools}
---

${body}"

    dest_file="$GSD_AGENTS_DIR/${name}.md"

    # Compare with existing
    if [[ -f "$dest_file" ]]; then
        # Check if content would change
        existing_sha=$(compute_sha "$dest_file")
        new_sha=$(echo "$gsd_content" | sha256sum 2>/dev/null | cut -d' ' -f1 || echo "$gsd_content" | shasum -a 256 | cut -d' ' -f1)

        if [[ "$existing_sha" == "$new_sha" ]]; then
            UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
            [[ "$VERBOSE" == "true" ]] && echo "  [OK]      $name" >&2
            continue
        else
            UPDATED_COUNT=$((UPDATED_COUNT + 1))
            [[ "$VERBOSE" == "true" ]] && echo "  [UPDATED] $name" >&2
        fi
    else
        NEW_COUNT=$((NEW_COUNT + 1))
        [[ "$VERBOSE" == "true" ]] && echo "  [NEW]     $name" >&2
    fi

    if [[ "$DRY_RUN" == "false" ]]; then
        mkdir -p "$GSD_AGENTS_DIR"
        echo "$gsd_content" > "$dest_file"
    fi
done

TOTAL=$((NEW_COUNT + UPDATED_COUNT + UNCHANGED_COUNT))
echo "{\"generated\":$TOTAL,\"new\":$NEW_COUNT,\"updated\":$UPDATED_COUNT,\"unchanged\":$UNCHANGED_COUNT,\"target\":\"$GSD_AGENTS_DIR\"}"
exit 0
