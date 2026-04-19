#!/usr/bin/env bash
set -euo pipefail

# sync-gsd-skills.sh -- Sync skills from marketplace and L0 to ~/.gsd/agent/skills/.
#
# Usage:
#   sync-gsd-skills.sh [--dry-run] [--source marketplace|l0|all] [--verbose]

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- Argument parsing ---
DRY_RUN=false
SOURCE="all"
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 [--dry-run] [--source marketplace|l0|all] [--verbose]"
            echo ""
            echo "Discovers skills from marketplace (~/.claude/skills/),"
            echo "L0 (\$ANDROID_COMMON_DOC/skills/), and L0 agents."
            echo "Syncs new/changed files to ~/.gsd/agent/skills/."
            echo "Outputs JSON to stdout."
            exit 0
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --source)
            SOURCE="$2"
            shift 2
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

GSD_SKILLS_DIR="$HOME/.gsd/agent/skills"
MANIFEST_FILE="$GSD_SKILLS_DIR/.sync-manifest.json"

NEW_COUNT=0
UPDATED_COUNT=0
UNCHANGED_COUNT=0
DETAILS=""

add_detail() {
    local action="$1" name="$2" source_cat="$3" hash="$4"
    entry="{\"action\":\"$action\",\"name\":\"$name\",\"source\":\"$source_cat\",\"sha256\":\"$hash\"}"
    if [[ -n "$DETAILS" ]]; then
        DETAILS="$DETAILS,$entry"
    else
        DETAILS="$entry"
    fi
}

# --- Load existing manifest ---
declare -A MANIFEST_HASHES
if [[ -f "$MANIFEST_FILE" ]]; then
    while IFS='=' read -r key val; do
        [[ -z "$key" ]] && continue
        MANIFEST_HASHES["$key"]="$val"
    done < <(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    for entry in data.get('entries', []):
        print(f\"{entry['key']}={entry['sha256']}\")
except: pass
" "$MANIFEST_FILE" 2>/dev/null || true)
fi

# --- Compute SHA-256 ---
compute_sha() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        python3 -c "import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "$1"
    fi
}

# --- Process a skill file ---
NEW_MANIFEST_ENTRIES=""

process_file() {
    local file="$1" category="$2" name="$3"
    local key="$category/$name"

    if [[ ! -f "$file" ]]; then return; fi

    local hash
    hash=$(compute_sha "$file")

    local old_hash="${MANIFEST_HASHES[$key]:-}"

    if [[ "$hash" == "$old_hash" ]]; then
        UNCHANGED_COUNT=$((UNCHANGED_COUNT + 1))
        if [[ "$VERBOSE" == "true" ]]; then
            add_detail "unchanged" "$name" "$category" "$hash"
        fi
    elif [[ -z "$old_hash" ]]; then
        NEW_COUNT=$((NEW_COUNT + 1))
        add_detail "new" "$name" "$category" "$hash"
    else
        UPDATED_COUNT=$((UPDATED_COUNT + 1))
        add_detail "updated" "$name" "$category" "$hash"
    fi

    # Copy if not dry-run
    if [[ "$DRY_RUN" == "false" ]]; then
        local dest_dir="$GSD_SKILLS_DIR/$category/$name"
        mkdir -p "$dest_dir"
        cp "$file" "$dest_dir/SKILL.md"
    fi

    # Track for new manifest
    entry="{\"key\":\"$key\",\"sha256\":\"$hash\",\"source\":\"$file\"}"
    if [[ -n "$NEW_MANIFEST_ENTRIES" ]]; then
        NEW_MANIFEST_ENTRIES="$NEW_MANIFEST_ENTRIES,$entry"
    else
        NEW_MANIFEST_ENTRIES="$entry"
    fi
}

# --- Discover and process skills ---

# 1. Marketplace skills: ~/.claude/skills/*/SKILL.md
if [[ "$SOURCE" == "all" || "$SOURCE" == "marketplace" ]]; then
    for skill_dir in "$HOME"/.claude/skills/*/; do
        [[ ! -d "$skill_dir" ]] && continue
        skill_file="$skill_dir/SKILL.md"
        [[ ! -f "$skill_file" ]] && continue
        name=$(basename "$skill_dir")
        process_file "$skill_file" "marketplace" "$name"
    done
fi

# 2. L0 skills: $TOOLKIT_ROOT/skills/*/SKILL.md
if [[ "$SOURCE" == "all" || "$SOURCE" == "l0" ]]; then
    for skill_dir in "$TOOLKIT_ROOT"/skills/*/; do
        [[ ! -d "$skill_dir" ]] && continue
        skill_file="$skill_dir/SKILL.md"
        [[ ! -f "$skill_file" ]] && continue
        name=$(basename "$skill_dir")
        process_file "$skill_file" "l0" "$name"
    done

    # 3. L0 agents: $TOOLKIT_ROOT/.claude/agents/*.md
    for agent_file in "$TOOLKIT_ROOT"/.claude/agents/*.md; do
        [[ ! -f "$agent_file" ]] && continue
        name=$(basename "$agent_file" .md)
        process_file "$agent_file" "l0-agents" "$name"
    done
fi

# --- Write manifest ---
if [[ "$DRY_RUN" == "false" ]]; then
    mkdir -p "$GSD_SKILLS_DIR"
    echo "{\"synced_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\",\"entries\":[$NEW_MANIFEST_ENTRIES]}" > "$MANIFEST_FILE"
fi

echo "{\"new\":$NEW_COUNT,\"updated\":$UPDATED_COUNT,\"unchanged\":$UNCHANGED_COUNT,\"details\":[$DETAILS]}"
exit 0
