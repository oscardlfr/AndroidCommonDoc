#!/usr/bin/env bash
# install-copilot-prompts.sh - Install GitHub Copilot prompt files into Android/KMP projects
#
# Usage:
#   bash install-copilot-prompts.sh [OPTIONS]
#
# Options:
#   --dry-run         Preview changes without writing files
#   --force           Overwrite existing prompt files
#   --projects LIST   Comma-separated project names (default: auto-discover)
#   --set-env         Add ANDROID_COMMON_DOC to shell profile (~/.zshrc or ~/.bashrc)
#   --help            Show this help message

set -euo pipefail

# Resolve script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DOC="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/copilot-templates"
PARENT_DIR="$(cd "$COMMON_DOC/.." && pwd)"

# Defaults
DRY_RUN=false
FORCE=false
PROJECTS=""
SET_ENV=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    head -n 12 "$0" | tail -n 10 | sed 's/^# \?//'
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
        --set-env) SET_ENV=true; shift ;;
        --help|-h) usage ;;
        *) log_err "Unknown option: $1"; usage ;;
    esac
done

echo "========================================"
echo "  GitHub Copilot Prompts Installer"
echo "========================================"
echo ""
log_info "Common doc path: $COMMON_DOC"
log_info "Templates dir: $TEMPLATES_DIR"
echo ""

# Validate templates directory
if [ ! -d "$TEMPLATES_DIR" ]; then
    log_err "Templates directory not found: $TEMPLATES_DIR"
    exit 1
fi

# Set environment variable
if [ "$SET_ENV" = true ]; then
    SHELL_PROFILE=""
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_PROFILE="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_PROFILE="$HOME/.bashrc"
    elif [ -f "$HOME/.bash_profile" ]; then
        SHELL_PROFILE="$HOME/.bash_profile"
    fi

    if [ -n "$SHELL_PROFILE" ]; then
        ENV_LINE="export ANDROID_COMMON_DOC=\"$COMMON_DOC\""
        if grep -q "ANDROID_COMMON_DOC" "$SHELL_PROFILE" 2>/dev/null; then
            log_warn "ANDROID_COMMON_DOC already set in $SHELL_PROFILE"
        else
            if [ "$DRY_RUN" = true ]; then
                log_info "[DRY RUN] Would append to $SHELL_PROFILE: $ENV_LINE"
            else
                echo "" >> "$SHELL_PROFILE"
                echo "# AndroidCommonDoc - Copilot prompts" >> "$SHELL_PROFILE"
                echo "$ENV_LINE" >> "$SHELL_PROFILE"
                log_ok "Added ANDROID_COMMON_DOC to $SHELL_PROFILE"
                log_info "Run 'source $SHELL_PROFILE' to activate"
            fi
        fi
    else
        log_warn "No shell profile found (.zshrc, .bashrc, .bash_profile)"
    fi
fi

# --- ANDROID_COMMON_DOC env var guard ---
# Consuming projects use $ANDROID_COMMON_DOC at runtime (wrapper templates reference this path).
# Placed after --set-env processing so users can set the variable first, then the guard validates it.
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

# Count templates
PROMPT_COUNT=$(ls "$TEMPLATES_DIR"/*.prompt.md 2>/dev/null | wc -l)
log_info "Found $PROMPT_COUNT prompt templates"

# Count instruction templates
INSTRUCTION_COUNT=0
if [ -d "$TEMPLATES_DIR/instructions" ]; then
    INSTRUCTION_COUNT=$(ls "$TEMPLATES_DIR"/instructions/*.instructions.md 2>/dev/null | wc -l)
fi
log_info "Found $INSTRUCTION_COUNT instruction templates"
echo ""

# Variable substitution helper
substitute_variables() {
    local template_file="$1"
    local target_file="$2"
    local project_name="$3"
    local project_type="$4"
    local platforms="$5"

    sed \
        -e "s/{{PROJECT_NAME}}/$project_name/g" \
        -e "s/{{PROJECT_TYPE}}/$project_type/g" \
        -e "s/{{PLATFORMS}}/$platforms/g" \
        -e "s/{{TIMESTAMP}}/$(date -u +%Y-%m-%dT%H:%M:%SZ)/g" \
        "$template_file" > "$target_file"
}

# Install prompts
INSTALLED=0
SKIPPED=0
ERRORS=0

for project in "${PROJECT_LIST[@]}"; do
    project_dir="$PARENT_DIR/$project"
    if [ ! -d "$project_dir" ]; then
        log_warn "Project directory not found: $project_dir"
        ((ERRORS++))
        continue
    fi

    github_dir="$project_dir/.github"
    prompts_dir="$github_dir/prompts"
    instructions_dir="$github_dir/instructions"

    log_info "Installing prompts in: $project"

    # Detect project type and platforms
    PROJECT_TYPE="Android"
    PLATFORMS="Android"
    if [ -d "$project_dir/desktopApp" ] || grep -rq "kotlin.multiplatform" "$project_dir/build.gradle.kts" 2>/dev/null; then
        PROJECT_TYPE="KMP"
        PLATFORMS="Android, Desktop"
        [ -d "$project_dir/iosApp" ] && PLATFORMS="$PLATFORMS, iOS"
    fi

    if [ "$DRY_RUN" = false ]; then
        mkdir -p "$prompts_dir"
    fi

    # Install .prompt.md files
    for template in "$TEMPLATES_DIR"/*.prompt.md; do
        [ ! -f "$template" ] && continue
        template_name="$(basename "$template")"
        target_path="$prompts_dir/$template_name"

        if [ -f "$target_path" ] && [ "$FORCE" = false ]; then
            log_warn "  Skipping $template_name (exists, use --force to overwrite)"
            ((SKIPPED++))
            continue
        fi

        if [ "$DRY_RUN" = true ]; then
            log_info "  [DRY RUN] Would install: prompts/$template_name"
        else
            substitute_variables "$template" "$target_path" "$project" "$PROJECT_TYPE" "$PLATFORMS"
            log_ok "  Installed: prompts/$template_name"
        fi
        ((INSTALLED++))
    done

    # Install instruction files from instructions/ subdirectory
    if [ -d "$TEMPLATES_DIR/instructions" ] && [ "$INSTRUCTION_COUNT" -gt 0 ]; then
        if [ "$DRY_RUN" = false ]; then
            mkdir -p "$instructions_dir"
        fi

        for instr_template in "$TEMPLATES_DIR"/instructions/*.instructions.md; do
            [ ! -f "$instr_template" ] && continue
            instr_name="$(basename "$instr_template")"
            instr_target="$instructions_dir/$instr_name"

            if [ -f "$instr_target" ] && [ "$FORCE" = false ]; then
                log_warn "  Skipping instructions/$instr_name (exists, use --force to overwrite)"
                ((SKIPPED++))
                continue
            fi

            if [ "$DRY_RUN" = true ]; then
                log_info "  [DRY RUN] Would install: instructions/$instr_name"
            else
                substitute_variables "$instr_template" "$instr_target" "$project" "$PROJECT_TYPE" "$PLATFORMS"
                log_ok "  Installed: instructions/$instr_name"
            fi
            ((INSTALLED++))
        done
    fi

    # --- Deliver copilot-instructions-generated.md ---
    # Prefer the android-only filtered variant when PROJECT_TYPE is android-only.
    # The variant is generated by copilot-instructions-adapter.sh when run from
    # setup-toolkit.sh with ANDROID_COMMON_DOC_PROJECT_TYPE=android-only.
    _PROJ_TYPE="${ANDROID_COMMON_DOC_PROJECT_TYPE:-}"
    GENERATED_INSTRUCTIONS="$COMMON_DOC/setup/copilot-templates/copilot-instructions-generated.md"
    if [ "$_PROJ_TYPE" = "android-only" ] && \
       [ -f "$COMMON_DOC/setup/copilot-templates/copilot-instructions-android-only.md" ]; then
        GENERATED_INSTRUCTIONS="$COMMON_DOC/setup/copilot-templates/copilot-instructions-android-only.md"
        log_info "Using android-only filtered instructions (KMP sections excluded)"
    fi

    if [ -f "$GENERATED_INSTRUCTIONS" ]; then
        target_github_dir="$project_dir/.github"
        target_file="$target_github_dir/copilot-instructions.md"

        if [ -f "$target_file" ] && [ "$FORCE" = false ]; then
            log_info "copilot-instructions.md already exists in $project (use --force to overwrite)"
        elif [ "$DRY_RUN" = true ]; then
            log_info "[DRY RUN] Would copy copilot-instructions-generated.md -> $project/.github/copilot-instructions.md"
        else
            mkdir -p "$target_github_dir"
            [ -f "$target_file" ] && cp "$target_file" "${target_file}.bak"
            cp "$GENERATED_INSTRUCTIONS" "$target_file"
            log_ok "Installed copilot-instructions.md in $project"
            ((INSTALLED++))
        fi
    else
        log_warn "copilot-instructions-generated.md not found -- run adapters/generate-all.sh first to generate it"
        log_warn "Skipping copilot-instructions.md delivery (other files were still installed)"
    fi

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
log_info "Restart VS Code / GitHub Copilot in each project to detect new prompts."
