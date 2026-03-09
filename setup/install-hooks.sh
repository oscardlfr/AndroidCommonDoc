#!/usr/bin/env bash
# install-hooks.sh - Install Claude Code hook scripts into Android/KMP projects
#
# Usage:
#   bash install-hooks.sh [OPTIONS]
#
# Options:
#   --dry-run         Preview changes without writing files
#   --force           Overwrite existing hook files and settings
#   --projects LIST   Comma-separated project names (default: auto-discover)
#   --mode MODE       Hook severity: block or warn (default: block)
#   --help            Show this help message

set -euo pipefail

# Resolve script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DOC="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$COMMON_DOC/.claude/hooks"
PARENT_DIR="$(cd "$COMMON_DOC/.." && pwd)"

# Defaults
DRY_RUN=false
FORCE=false
PROJECTS=""
MODE="block"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    head -n 13 "$0" | tail -n 11 | sed 's/^# \?//'
    exit 0
}

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true; shift ;;
        --force) FORCE=true; shift ;;
        --projects) PROJECTS="$2"; shift 2 ;;
        --mode) MODE="$2"; shift 2 ;;
        --help|-h) usage ;;
        *) log_err "Unknown option: $1"; usage ;;
    esac
done

# Validate mode
if [[ "$MODE" != "block" && "$MODE" != "warn" ]]; then
    log_err "Invalid mode: $MODE (must be 'block' or 'warn')"
    exit 1
fi

# --- ANDROID_COMMON_DOC env var guard ---
# Consuming projects use $ANDROID_COMMON_DOC at runtime (hooks reference central scripts).
# Validate it's set and points to a real directory before doing any install work.
if [ -z "${ANDROID_COMMON_DOC:-}" ]; then
    log_err "ANDROID_COMMON_DOC environment variable is not set."
    log_err "Set it to the path of your AndroidCommonDoc checkout:"
    log_err ""
    log_err "  export ANDROID_COMMON_DOC=\"/path/to/AndroidCommonDoc\""
    log_err ""
    exit 1
fi

if [ ! -d "$ANDROID_COMMON_DOC" ]; then
    log_err "ANDROID_COMMON_DOC points to a path that does not exist or is not a directory:"
    log_err "  $ANDROID_COMMON_DOC"
    log_err ""
    log_err "Check for typos or update the variable:"
    log_err ""
    log_err "  export ANDROID_COMMON_DOC=\"/path/to/AndroidCommonDoc\""
    log_err ""
    exit 1
fi

echo "========================================"
echo "  Claude Code Hooks Installer"
echo "========================================"
echo ""
log_info "Common doc path: $COMMON_DOC"
log_info "Hooks source: $HOOKS_DIR"
log_info "Mode: $MODE"
echo ""

# Validate hooks directory
if [ ! -d "$HOOKS_DIR" ]; then
    log_err "Hooks directory not found: $HOOKS_DIR"
    exit 1
fi

# Validate hook scripts exist
HOOK_POST_WRITE="$HOOKS_DIR/detekt-post-write.sh"
HOOK_PRE_COMMIT="$HOOKS_DIR/detekt-pre-commit.sh"

if [ ! -f "$HOOK_POST_WRITE" ]; then
    log_err "Post-write hook not found: $HOOK_POST_WRITE"
    exit 1
fi
if [ ! -f "$HOOK_PRE_COMMIT" ]; then
    log_err "Pre-commit hook not found: $HOOK_PRE_COMMIT"
    exit 1
fi

log_ok "Found hook scripts: detekt-post-write.sh, detekt-pre-commit.sh"
echo ""

# Discover or parse projects
declare -a PROJECT_LIST

if [ -n "$PROJECTS" ]; then
    IFS=',' read -ra PROJECT_LIST <<< "$PROJECTS"
else
    log_info "Auto-discovering Android/KMP projects in $PARENT_DIR..."
    for dir in "$PARENT_DIR"/*/; do
        dir_name="$(basename "$dir")"
        # Skip AndroidCommonDoc itself
        [ "$dir_name" = "AndroidCommonDoc" ] && continue
        # Check for Gradle project markers
        if [ -f "$dir/build.gradle.kts" ] || [ -f "$dir/build.gradle" ] || [ -f "$dir/settings.gradle.kts" ] || [ -f "$dir/settings.gradle" ]; then
            PROJECT_LIST+=("$dir_name")
        fi
    done
fi

if [ ${#PROJECT_LIST[@]} -eq 0 ]; then
    log_warn "No projects found. Use --projects to specify manually."
    exit 0
fi

log_info "Projects to install: ${PROJECT_LIST[*]}"
echo ""

# Install hooks
INSTALLED=0
SKIPPED=0
ERRORS=0

for project in "${PROJECT_LIST[@]}"; do
    project_dir="$PARENT_DIR/$project"
    if [ ! -d "$project_dir" ]; then
        log_warn "Project directory not found: $project_dir"
        ERRORS=$((ERRORS + 1))
        continue
    fi

    target_hooks_dir="$project_dir/.claude/hooks"
    settings_file="$project_dir/.claude/settings.json"

    log_info "Installing hooks in: $project"

    # --- Step 1: Copy hook scripts ---
    if [ "$DRY_RUN" = false ]; then
        mkdir -p "$target_hooks_dir"
    fi

    for hook_file in "$HOOK_POST_WRITE" "$HOOK_PRE_COMMIT"; do
        hook_name="$(basename "$hook_file")"
        target_path="$target_hooks_dir/$hook_name"

        if [ -f "$target_path" ] && [ "$FORCE" = false ]; then
            log_warn "  Skipping $hook_name (exists, use --force to overwrite)"
            SKIPPED=$((SKIPPED + 1))
            continue
        fi

        if [ "$DRY_RUN" = true ]; then
            log_info "  [DRY RUN] Would copy: $hook_name -> $target_hooks_dir/"
        else
            cp "$hook_file" "$target_path"
            chmod +x "$target_path"
            log_ok "  Copied: $hook_name"
        fi
        INSTALLED=$((INSTALLED + 1))
    done

    # --- Step 2: Merge hooks into .claude/settings.json ---
    if [ "$DRY_RUN" = true ]; then
        log_info "  [DRY RUN] Would merge hook config into $settings_file"
    else
        # Create .claude/ directory if needed
        mkdir -p "$project_dir/.claude"

        # Backup existing settings.json
        if [ -f "$settings_file" ]; then
            cp "$settings_file" "${settings_file}.bak"
            log_info "  Backed up: settings.json -> settings.json.bak"
        fi

        # Use python3 for safe JSON merging.
        # NOTE: heredoc with single-quoted delimiter (<<'PYEOF') prevents bash from
        # expanding $CLAUDE_PROJECT_DIR — the literal $ passes through to Python.
        # Using -c "..." (double-quoted) fails on Windows MSYS2/Git Bash with
        # set -u: bash expands $CLAUDE_PROJECT_DIR before Python sees it → unbound variable.
        python3 - "$settings_file" "$MODE" <<'PYEOF'
import json, os, sys

settings_file = sys.argv[1]
mode = sys.argv[2]

# Load existing settings or create empty
if os.path.isfile(settings_file):
    with open(settings_file, 'r', encoding='utf-8') as f:
        settings = json.load(f)
else:
    settings = {}

# Define the hook entries we want to add
post_write_hook = {
    'matcher': 'Write|Edit',
    'hooks': [{
        'type': 'command',
        'command': '"$CLAUDE_PROJECT_DIR"/.claude/hooks/detekt-post-write.sh',
        'timeout': 30
    }]
}
pre_commit_hook = {
    'matcher': 'Bash',
    'hooks': [{
        'type': 'command',
        'command': '"$CLAUDE_PROJECT_DIR"/.claude/hooks/detekt-pre-commit.sh',
        'timeout': 60
    }]
}

# Initialize hooks structure if absent
if 'hooks' not in settings:
    settings['hooks'] = {}

hooks = settings['hooks']

# --- Merge PostToolUse ---
if 'PostToolUse' not in hooks:
    hooks['PostToolUse'] = []

# Check idempotency: skip if our matcher+command already exists
has_post_write = any(
    entry.get('matcher') == 'Write|Edit'
    and any('detekt-post-write' in h.get('command', '') for h in entry.get('hooks', []))
    for entry in hooks['PostToolUse']
)

if not has_post_write:
    hooks['PostToolUse'].append(post_write_hook)

# --- Merge PreToolUse ---
if 'PreToolUse' not in hooks:
    hooks['PreToolUse'] = []

# Check idempotency
has_pre_commit = any(
    entry.get('matcher') == 'Bash'
    and any('detekt-pre-commit' in h.get('command', '') for h in entry.get('hooks', []))
    for entry in hooks['PreToolUse']
)

if not has_pre_commit:
    hooks['PreToolUse'].append(pre_commit_hook)

# Write back with 2-space indentation
with open(settings_file, 'w', encoding='utf-8') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
PYEOF

        if [ $? -eq 0 ]; then
            log_ok "  Merged hook config into settings.json"
        else
            log_err "  Failed to merge hook config"
            ERRORS=$((ERRORS + 1))
        fi
    fi

    INSTALLED=$((INSTALLED + 1))
    echo ""
done

# Summary
echo "========================================"
echo "  Summary"
echo "========================================"
echo "  Installed: $INSTALLED"
echo "  Skipped:   $SKIPPED"
echo "  Errors:    $ERRORS"
echo "========================================"

if [ "$DRY_RUN" = true ]; then
    echo ""
    log_info "This was a dry run. No files were written."
    log_info "Remove --dry-run to install for real."
fi

echo ""
log_info "Restart Claude Code session (or use /hooks to review) for hooks to take effect."
