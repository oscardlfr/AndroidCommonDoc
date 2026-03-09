#!/usr/bin/env bash
# setup-toolkit.sh - Unified setup for AndroidCommonDoc toolkit in a consuming project
#
# Usage:
#   bash setup-toolkit.sh --project-root PATH [OPTIONS]
#
# Options:
#   --project-root PATH   Consuming project root (required)
#   --dry-run             Preview changes without writing files
#   --force               Overwrite existing files and configurations
#   --skip-skills         Skip Claude Code skills installation
#   --skip-copilot        Skip Copilot prompts and instructions installation
#   --skip-hooks          Skip Claude Code hooks installation
#   --skip-gradle         Skip Gradle build file modifications entirely
#   --force-gradle        Wire convention plugin even if no build-logic/ found
#   --mode MODE           Hook severity: block or warn (default: block)
#   --help                Show this help message
#
# Gradle wiring is automatically skipped when no build-logic/ directory or
# existing includeBuild is found — projects without convention plugins use
# Detekt directly via --config detekt-l0-base.yml instead.

set -euo pipefail

# Resolve script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DOC="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
PROJECT_ROOT=""
DRY_RUN=false
FORCE=false
SKIP_SKILLS=false
SKIP_COPILOT=false
SKIP_HOOKS=false
SKIP_GRADLE=false
FORCE_GRADLE=false   # override auto-skip when no build-logic/ found
MODE="block"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

usage() {
    head -n 17 "$0" | tail -n 15 | sed 's/^# \?//'
    exit 0
}

log_info() { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root) PROJECT_ROOT="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --force) FORCE=true; shift ;;
        --skip-skills) SKIP_SKILLS=true; shift ;;
        --skip-copilot) SKIP_COPILOT=true; shift ;;
        --skip-hooks) SKIP_HOOKS=true; shift ;;
        --skip-gradle) SKIP_GRADLE=true; shift ;;
        --force-gradle) FORCE_GRADLE=true; shift ;;
        --mode) MODE="$2"; shift 2 ;;
        --help|-h) usage ;;
        *) log_err "Unknown option: $1"; usage ;;
    esac
done

# Validate required argument
if [ -z "$PROJECT_ROOT" ]; then
    log_err "--project-root is required"
    echo ""
    usage
fi

# Resolve to absolute path
PROJECT_ROOT="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd)" || {
    log_err "Project root not found: $PROJECT_ROOT"
    exit 1
}

# Validate mode
if [[ "$MODE" != "block" && "$MODE" != "warn" ]]; then
    log_err "Invalid mode: $MODE (must be 'block' or 'warn')"
    exit 1
fi

# --- ANDROID_COMMON_DOC env var guard ---
# Consuming projects use $ANDROID_COMMON_DOC at runtime (wrapper templates, hooks, etc.).
# Validate it's set and points to a real directory before doing any setup work.
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

# Validate it's a Gradle project
if [ ! -f "$PROJECT_ROOT/settings.gradle.kts" ] && [ ! -f "$PROJECT_ROOT/settings.gradle" ]; then
    log_err "Not a Gradle project (no settings.gradle.kts or settings.gradle): $PROJECT_ROOT"
    exit 1
fi

PROJECT_NAME="$(basename "$PROJECT_ROOT")"

echo ""
echo "========================================"
echo "  AndroidCommonDoc Toolkit Setup"
echo "========================================"
echo ""
log_info "Common doc: $COMMON_DOC"
log_info "Target project: $PROJECT_NAME ($PROJECT_ROOT)"
log_info "Mode: $MODE"
if [ "$DRY_RUN" = true ]; then
    log_warn "DRY RUN MODE -- no files will be modified"
fi
echo ""

# Track what was done
STEPS_DONE=()
STEPS_SKIPPED=()
STEPS_FAILED=()

# ============================================================
# Step 1: Modify settings.gradle.kts (convention plugin wiring)
# ============================================================
echo "----------------------------------------"
echo "  Step 1: Gradle settings (includeBuild)"
echo "----------------------------------------"

if [ "$SKIP_GRADLE" = true ]; then
    log_warn "Skipped (--skip-gradle)"
    STEPS_SKIPPED+=("Step 1: Gradle settings")
else
    SETTINGS_FILE="$PROJECT_ROOT/settings.gradle.kts"
    if [ ! -f "$SETTINGS_FILE" ]; then
        SETTINGS_FILE="$PROJECT_ROOT/settings.gradle"
    fi

    MARKER="// AndroidCommonDoc toolkit -- managed by setup script"

    if grep -qF "$MARKER" "$SETTINGS_FILE" 2>/dev/null; then
        log_info "Already configured (marker found), skipping"
        STEPS_SKIPPED+=("Step 1: Gradle settings (already configured)")
    else
        # ── Detect whether this project uses convention plugins at all ──
        # We look for an existing build-logic/ dir OR an existing includeBuild in settings.
        # If neither exists, the project doesn't use convention plugins and wiring our
        # build-logic/ would be noise.  We skip and suggest --force-gradle to override.
        HAS_BUILDLOGIC=false
        if [ -d "$PROJECT_ROOT/build-logic" ]; then
            HAS_BUILDLOGIC=true
        elif [ -d "$PROJECT_ROOT/convention-plugins" ]; then
            HAS_BUILDLOGIC=true
        elif [ -d "$PROJECT_ROOT/buildSrc" ]; then
            HAS_BUILDLOGIC=true
        elif grep -qE 'includeBuild\s*\(' "$SETTINGS_FILE" 2>/dev/null; then
            HAS_BUILDLOGIC=true
        fi

        if [ "$HAS_BUILDLOGIC" = false ] && [ "$FORCE_GRADLE" = false ]; then
            log_warn "No build-logic/ dir or existing includeBuild found in this project."
            log_warn "Skipping Gradle wiring — the project likely manages deps directly."
            log_warn ""
            log_warn "  The toolkit Detekt plugin still works via direct Detekt config"
            log_warn "  (--config path/to/detekt-l0-base.yml). No convention plugin needed."
            log_warn ""
            log_warn "  To wire the convention plugin anyway (e.g. if you're adding"
            log_warn "  build-logic/ yourself), re-run with --force-gradle."
            STEPS_SKIPPED+=("Step 1: Gradle settings (no build-logic/ in project — use --force-gradle to override)")
        else
            # Calculate relative path from consuming project to AndroidCommonDoc build-logic/
            REL_PATH=$(python3 -c "
import os, sys
consuming = sys.argv[1]
build_logic = os.path.join(sys.argv[2], 'build-logic')
rel = os.path.relpath(build_logic, consuming)
print(rel.replace(os.sep, '/'))
" "$PROJECT_ROOT" "$COMMON_DOC")

            INCLUDE_LINE="includeBuild(\"$REL_PATH\") $MARKER"

            if [ "$DRY_RUN" = true ]; then
                log_info "[DRY RUN] Would insert into $SETTINGS_FILE:"
                log_info "  $INCLUDE_LINE"
            else
                cp "$SETTINGS_FILE" "${SETTINGS_FILE}.bak"
                log_info "Backed up: $(basename "$SETTINGS_FILE") -> $(basename "$SETTINGS_FILE").bak"

                python3 -c "
import sys

settings_file = sys.argv[1]
include_line = sys.argv[2]

with open(settings_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Insert before first include( or includeBuild(, or at end
insert_idx = len(lines)
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('include(') or stripped.startswith('includeBuild('):
        insert_idx = i
        break

lines.insert(insert_idx, include_line + '\n')

with open(settings_file, 'w', encoding='utf-8') as f:
    f.writelines(lines)
" "$SETTINGS_FILE" "$INCLUDE_LINE"

                log_ok "Inserted includeBuild for build-logic (relative path: $REL_PATH)"
                log_info "Note: This adds the Detekt/toolkit plugin only."
                log_info "Your project's own build-logic/ (compileSdk, minSdk, test deps) is separate and unchanged."
            fi
            STEPS_DONE+=("Step 1: Gradle settings (includeBuild)")
        fi
    fi
fi
echo ""

# ============================================================
# Step 2: Modify module build.gradle.kts files (plugin application)
# ============================================================
echo "----------------------------------------"
echo "  Step 2: Module build files (plugin ID)"
echo "----------------------------------------"

if [ "$SKIP_GRADLE" = true ]; then
    log_warn "Skipped (--skip-gradle)"
    STEPS_SKIPPED+=("Step 2: Module build files")
elif [ "$HAS_BUILDLOGIC" = false ] && [ "$FORCE_GRADLE" = false ]; then
    log_warn "Skipped (no build-logic/ in project — use --force-gradle to override)"
    STEPS_SKIPPED+=("Step 2: Module build files (no build-logic/ in project)")
else
    PLUGIN_MARKER="// AndroidCommonDoc toolkit -- managed by setup script"
    PLUGIN_LINE="    id(\"androidcommondoc.toolkit\") $PLUGIN_MARKER"
    MODULES_MODIFIED=0

    # Find build.gradle.kts files that apply Android or KMP plugins
    while IFS= read -r build_file; do
        [ -z "$build_file" ] && continue

        # Check if it applies Android or KMP plugins
        if ! grep -qE "(com\.android\.application|com\.android\.library|kotlin\.multiplatform)" "$build_file" 2>/dev/null; then
            continue
        fi

        # Check if already has our marker
        if grep -qF "$PLUGIN_MARKER" "$build_file" 2>/dev/null; then
            log_info "  Already configured: $(echo "$build_file" | sed "s|$PROJECT_ROOT/||")"
            continue
        fi

        if [ "$DRY_RUN" = true ]; then
            log_info "  [DRY RUN] Would modify: $(echo "$build_file" | sed "s|$PROJECT_ROOT/||")"
        else
            # Create backup
            cp "$build_file" "${build_file}.bak"

            # Insert plugin ID inside plugins { } block, just before closing }
            python3 -c "
import sys

build_file = sys.argv[1]
plugin_line = sys.argv[2]

with open(build_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find plugins { } block and insert before its closing }
in_plugins = False
brace_depth = 0
insert_idx = None

for i, line in enumerate(lines):
    stripped = line.strip()

    if 'plugins' in stripped and '{' in stripped:
        in_plugins = True
        brace_depth = stripped.count('{') - stripped.count('}')
        if brace_depth == 0:
            # Single-line plugins block -- skip this edge case
            in_plugins = False
        continue

    if in_plugins:
        brace_depth += stripped.count('{') - stripped.count('}')
        if brace_depth <= 0:
            insert_idx = i
            break

if insert_idx is not None:
    lines.insert(insert_idx, plugin_line + '\n')
    with open(build_file, 'w', encoding='utf-8') as f:
        f.writelines(lines)
" "$build_file" "$PLUGIN_LINE"

            log_ok "  Modified: $(echo "$build_file" | sed "s|$PROJECT_ROOT/||")"
            ((MODULES_MODIFIED++))
        fi
    done < <(find "$PROJECT_ROOT" -name "build.gradle.kts" -not -path "*/build/*" -not -path "*/.gradle/*" -not -path "*/build-logic/*" -not -path "*/.claude/worktrees/*" -not -path "*/.git/*" 2>/dev/null)

    if [ "$MODULES_MODIFIED" -gt 0 ] || [ "$DRY_RUN" = true ]; then
        STEPS_DONE+=("Step 2: Module build files ($MODULES_MODIFIED modified)")
    else
        STEPS_SKIPPED+=("Step 2: Module build files (none found or all configured)")
    fi
fi
echo ""

# ============================================================
# Step 2.5: Generate Detekt baseline (suppress legacy issues)
# ============================================================
# Without a baseline, the first ./gradlew detekt run fails with every
# pre-existing issue in the project (~400 in a typical legacy codebase).
# The baseline captures all current issues as "accepted" so only NEW
# violations introduced after the integration will break the build.
# ============================================================
echo "----------------------------------------"
echo "  Step 2.5: Detekt baseline"
echo "----------------------------------------"

if [ "$DRY_RUN" = true ]; then
    log_info "[dry-run] Would run: ./gradlew detektBaseline (all modules)"
    STEPS_DONE+=("Step 2.5: Detekt baseline (dry run)")
elif [ ! -f "gradlew" ] && [ ! -f "gradlew.bat" ]; then
    log_warn "Skipped — no gradlew found in project root"
    STEPS_SKIPPED+=("Step 2.5: Detekt baseline (no gradlew)")
else
    log_info "Generating Detekt baseline to suppress pre-existing issues..."
    log_info "This may take a few minutes on first run."

    GRADLEW="./gradlew"
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        GRADLEW="./gradlew.bat"
    fi

    if $GRADLEW detektBaseline --continue -q 2>&1 | tee /tmp/detekt-baseline-$$.log | tail -5; then
        BASELINE_COUNT=$(find . -name "detekt-baseline.xml" 2>/dev/null | wc -l | tr -d ' ')
        log_success "Baseline generated ($BASELINE_COUNT module(s))"
        log_info "Pre-existing issues are now suppressed. Only NEW violations will fail the build."
        STEPS_DONE+=("Step 2.5: Detekt baseline ($BASELINE_COUNT modules)")
    else
        log_warn "detektBaseline completed with warnings (check /tmp/detekt-baseline-$$.log)"
        log_info "Tip: Run ./gradlew detektBaseline manually per module if the above failed."
        STEPS_DONE+=("Step 2.5: Detekt baseline (partial — check logs)")
    fi
fi
echo ""

# ============================================================
# Step 3: Sync L0 skills (registry-based materialization)
# ============================================================
echo "----------------------------------------"
echo "  Step 3: L0 Skill Sync"
echo "----------------------------------------"

if [ "$SKIP_SKILLS" = true ]; then
    log_warn "Skipped (--skip-skills)"
    STEPS_SKIPPED+=("Step 3: L0 Skill Sync")
else
    SYNC_CLI="$COMMON_DOC/mcp-server/src/sync/sync-l0-cli.ts"
    if [ ! -f "$SYNC_CLI" ]; then
        log_err "Sync CLI not found: $SYNC_CLI"
        STEPS_FAILED+=("Step 3: L0 Skill Sync (CLI not found)")
    else
        if [ "$DRY_RUN" = true ]; then
            log_info "[DRY RUN] Would run: npx tsx $SYNC_CLI --project-root $PROJECT_ROOT --l0-root $COMMON_DOC"
            STEPS_DONE+=("Step 3: L0 Skill Sync (dry run)")
        else
            log_info "Running L0 sync engine..."
            if (cd "$COMMON_DOC/mcp-server" && npx tsx "$SYNC_CLI" --project-root "$PROJECT_ROOT" --l0-root "$COMMON_DOC"); then
                STEPS_DONE+=("Step 3: L0 Skill Sync")
            else
                log_warn "Sync returned non-zero"
                STEPS_DONE+=("Step 3: L0 Skill Sync (partial)")
            fi
        fi
    fi
fi
echo ""

# ============================================================
# Step 4: Install Copilot prompts and instructions
# ============================================================
echo "----------------------------------------"
echo "  Step 4: Copilot prompts & instructions"
echo "----------------------------------------"

if [ "$SKIP_COPILOT" = true ]; then
    log_warn "Skipped (--skip-copilot)"
    STEPS_SKIPPED+=("Step 4: Copilot prompts & instructions")
else
    COPILOT_SCRIPT="$SCRIPT_DIR/install-copilot-prompts.sh"
    if [ ! -f "$COPILOT_SCRIPT" ]; then
        log_err "Copilot prompts installer not found: $COPILOT_SCRIPT"
        STEPS_FAILED+=("Step 4: Copilot prompts (script not found)")
    else
        COPILOT_ARGS=(--projects "$PROJECT_NAME")
        [ "$FORCE" = true ] && COPILOT_ARGS+=(--force)
        [ "$DRY_RUN" = true ] && COPILOT_ARGS+=(--dry-run)

        # Detect PROJECT_TYPE here so install-copilot-prompts.sh can filter KMP content
        _DETECTED_TYPE="kmp"
        if ! grep -rqE 'kotlin\("multiplatform"\)|id\("org\.jetbrains\.kotlin\.multiplatform"\)' \
                "$PROJECT_ROOT" --include="*.gradle.kts" 2>/dev/null; then
            _DETECTED_TYPE="android-only"
        fi
        export ANDROID_COMMON_DOC_PROJECT_TYPE="$_DETECTED_TYPE"

        if bash "$COPILOT_SCRIPT" "${COPILOT_ARGS[@]}"; then
            STEPS_DONE+=("Step 4: Copilot prompts")
        else
            log_warn "Copilot prompts installer returned non-zero (some prompts may have been skipped)"
            STEPS_DONE+=("Step 4: Copilot prompts (partial)")
        fi
    fi
fi
echo ""

# ============================================================
# Step 5: Install Claude Code hooks
# ============================================================
echo "----------------------------------------"
echo "  Step 5: Claude Code hooks"
echo "----------------------------------------"

if [ "$SKIP_HOOKS" = true ]; then
    log_warn "Skipped (--skip-hooks)"
    STEPS_SKIPPED+=("Step 5: Claude Code hooks")
else
    HOOKS_SCRIPT="$SCRIPT_DIR/install-hooks.sh"
    if [ ! -f "$HOOKS_SCRIPT" ]; then
        log_err "Hooks installer not found: $HOOKS_SCRIPT"
        STEPS_FAILED+=("Step 5: Claude Code hooks (script not found)")
    else
        HOOKS_ARGS=(--projects "$PROJECT_NAME" --mode "$MODE")
        [ "$FORCE" = true ] && HOOKS_ARGS+=(--force)
        [ "$DRY_RUN" = true ] && HOOKS_ARGS+=(--dry-run)

        if bash "$HOOKS_SCRIPT" "${HOOKS_ARGS[@]}"; then
            STEPS_DONE+=("Step 5: Claude Code hooks")
        else
            log_warn "Hooks installer returned non-zero"
            STEPS_DONE+=("Step 5: Claude Code hooks (partial)")
        fi
    fi
fi
echo ""

# ============================================================
# Step 6: Summary
# ============================================================
echo ""
echo "========================================"
echo "  Setup Complete: $PROJECT_NAME"
echo "========================================"
echo ""

if [ ${#STEPS_DONE[@]} -gt 0 ]; then
    echo "  Completed:"
    for step in "${STEPS_DONE[@]}"; do
        echo -e "    ${GREEN}+${NC} $step"
    done
fi

if [ ${#STEPS_SKIPPED[@]} -gt 0 ]; then
    echo "  Skipped:"
    for step in "${STEPS_SKIPPED[@]}"; do
        echo -e "    ${YELLOW}-${NC} $step"
    done
fi

if [ ${#STEPS_FAILED[@]} -gt 0 ]; then
    echo "  Failed:"
    for step in "${STEPS_FAILED[@]}"; do
        echo -e "    ${RED}!${NC} $step"
    done
fi

echo ""
echo "========================================"
echo "  Next Steps"
echo "========================================"
echo ""
echo "  1. Set ANDROID_COMMON_DOC environment variable (if not already set):"
echo "       export ANDROID_COMMON_DOC=\"$COMMON_DOC\""
echo ""
echo "  2. Build detekt-rules JAR:"
echo "       cd $COMMON_DOC/detekt-rules && ./gradlew assemble"
echo ""
echo "  3. If Gradle steps were skipped (no build-logic/ in your project):"
echo "       Use Detekt directly with the L0 config:"
echo "       --config $COMMON_DOC/detekt-rules/src/main/resources/config/detekt-l0-base.yml"
echo "       See: $COMMON_DOC/docs/guides/detekt-config.md"
echo ""
echo "  4. Sync Gradle in your project (only if convention plugin was wired)"
echo ""
echo "  5. Restart Claude Code session for hooks to take effect"
echo ""
echo "========================================"
echo "  Selective Adoption"
echo "========================================"
echo ""
echo "  Individual scripts for partial setup:"
echo "    cd $COMMON_DOC/mcp-server && npx tsx src/sync/sync-l0-cli.ts --project-root PROJECT --l0-root $COMMON_DOC"
echo "    bash $SCRIPT_DIR/install-copilot-prompts.sh --help"
echo "    bash $SCRIPT_DIR/install-hooks.sh --help"
echo ""
