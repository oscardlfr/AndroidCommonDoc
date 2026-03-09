#!/usr/bin/env bash
# install-guard-tests.sh - Install Konsist guard test templates into a consuming project
#
# Usage:
#   bash install-guard-tests.sh --package PACKAGE [OPTIONS]
#
# Options:
#   --package PACKAGE  Consumer root package (required, e.g., com.example.myapp)
#   --target DIR       Consumer project directory (default: current directory)
#   --dry-run          Preview changes without writing files
#   --force            Overwrite existing guard test files
#   --help             Show this help message
#
# Examples:
#   bash install-guard-tests.sh --package com.example.myapp
#   bash install-guard-tests.sh --package com.example.myapp --target /path/to/MyApp --dry-run
#   bash install-guard-tests.sh --package com.example.myapp --force

set -euo pipefail

# Resolve script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_DOC="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$COMMON_DOC/guard-templates"

# Defaults
PACKAGE=""
TARGET="$(pwd)"
DRY_RUN=false
FORCE=false

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
        --package) PACKAGE="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --force) FORCE=true; shift ;;
        --help|-h) usage ;;
        *) log_err "Unknown option: $1"; usage ;;
    esac
done

echo "========================================"
echo "  Guard Test Template Installer"
echo "========================================"
echo ""

# Validate --package is provided
if [ -z "$PACKAGE" ]; then
    log_err "Missing required --package flag."
    log_err "Usage: bash install-guard-tests.sh --package com.example"
    exit 1
fi

# Validate templates directory exists
if [ ! -d "$TEMPLATES_DIR" ]; then
    log_err "Templates directory not found: $TEMPLATES_DIR"
    log_err "Ensure you are running from within the AndroidCommonDoc checkout."
    exit 1
fi

# Validate target is a Gradle project
if [ ! -f "$TARGET/settings.gradle.kts" ] && [ ! -f "$TARGET/settings.gradle" ]; then
    log_err "Target directory is not a Gradle project (no settings.gradle.kts found): $TARGET"
    exit 1
fi

# --- Detect Kotlin version from consumer's version catalog ---
KOTLIN_VERSION=""
VERSIONS_TOML="$TARGET/gradle/libs.versions.toml"
if [ -f "$VERSIONS_TOML" ]; then
    KOTLIN_VERSION=$(grep -E '^kotlin\s*=' "$VERSIONS_TOML" | head -1 | sed 's/.*"\(.*\)".*/\1/')
fi

if [ -z "$KOTLIN_VERSION" ]; then
    # Fallback: try to extract from build.gradle.kts plugin declarations
    KOTLIN_VERSION="2.3.10"
    log_warn "Could not detect Kotlin version from libs.versions.toml, using fallback: $KOTLIN_VERSION"
else
    log_ok "Detected Kotlin version: $KOTLIN_VERSION"
fi

log_info "Root package:    $PACKAGE"
log_info "Kotlin version:  $KOTLIN_VERSION"
log_info "Target project:  $TARGET"
log_info "Templates dir:   $TEMPLATES_DIR"
log_info "Dry run:         $DRY_RUN"
log_info "Force overwrite: $FORCE"
echo ""

# Compute paths
PACKAGE_PATH="${PACKAGE//\./\/}"
TARGET_DIR="$TARGET/konsist-guard"
KOTLIN_DIR="$TARGET_DIR/src/test/kotlin/$PACKAGE_PATH/konsist/guard"

# Counters
INSTALLED=0
SKIPPED=0
ERRORS=0

# --- Create directory structure ---
log_info "Creating directory structure..."
if [ "$DRY_RUN" = true ]; then
    log_info "  [DRY RUN] Would create: $KOTLIN_DIR"
else
    mkdir -p "$KOTLIN_DIR"
    log_ok "  Created: $KOTLIN_DIR"
fi

# --- Copy and substitute .kt.template files ---
log_info "Installing Kotlin guard test templates..."
for template in "$TEMPLATES_DIR"/*.kt.template; do
    [ ! -f "$template" ] && continue
    target_name="$(basename "$template" .template)"
    target_path="$KOTLIN_DIR/$target_name"

    if [ -f "$target_path" ] && [ "$FORCE" = false ]; then
        log_warn "  Skipping $target_name (exists, use --force to overwrite)"
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    if [ "$DRY_RUN" = true ]; then
        log_info "  [DRY RUN] Would generate: $target_name"
    else
        sed -e "s/__ROOT_PACKAGE__/$PACKAGE/g" -e "s/__KOTLIN_VERSION__/$KOTLIN_VERSION/g" "$template" > "$target_path"
        log_ok "  Generated: $target_name"
    fi
    INSTALLED=$((INSTALLED + 1))
done

# --- Copy and substitute build.gradle.kts.template ---
log_info "Installing build configuration..."
BUILD_TEMPLATE="$TEMPLATES_DIR/build.gradle.kts.template"
BUILD_TARGET="$TARGET_DIR/build.gradle.kts"

if [ -f "$BUILD_TEMPLATE" ]; then
    if [ -f "$BUILD_TARGET" ] && [ "$FORCE" = false ]; then
        log_warn "  Skipping build.gradle.kts (exists, use --force to overwrite)"
        SKIPPED=$((SKIPPED + 1))
    else
        if [ "$DRY_RUN" = true ]; then
            log_info "  [DRY RUN] Would generate: build.gradle.kts"
        else
            sed -e "s/__ROOT_PACKAGE__/$PACKAGE/g" -e "s/__KOTLIN_VERSION__/$KOTLIN_VERSION/g" "$BUILD_TEMPLATE" > "$BUILD_TARGET"
            log_ok "  Generated: build.gradle.kts"
        fi
        INSTALLED=$((INSTALLED + 1))
    fi
else
    log_err "  build.gradle.kts.template not found in $TEMPLATES_DIR"
    ERRORS=$((ERRORS + 1))
fi

# --- Modify consumer's settings.gradle.kts ---
log_info "Checking settings.gradle.kts..."
SETTINGS_FILE=""
if [ -f "$TARGET/settings.gradle.kts" ]; then
    SETTINGS_FILE="$TARGET/settings.gradle.kts"
elif [ -f "$TARGET/settings.gradle" ]; then
    SETTINGS_FILE="$TARGET/settings.gradle"
fi

if [ -n "$SETTINGS_FILE" ]; then
    if grep -q 'include.*konsist-guard\|include.*:konsist-guard' "$SETTINGS_FILE" 2>/dev/null; then
        log_warn "  include(\":konsist-guard\") already present in $(basename "$SETTINGS_FILE")"
    else
        if [ "$DRY_RUN" = true ]; then
            log_info "  [DRY RUN] Would append include(\":konsist-guard\") to $(basename "$SETTINGS_FILE")"
        else
            echo '' >> "$SETTINGS_FILE"
            echo '// Guard tests -- architecture enforcement via Konsist (generated by AndroidCommonDoc)' >> "$SETTINGS_FILE"
            echo 'include(":konsist-guard")' >> "$SETTINGS_FILE"
            log_ok "  Appended include(\":konsist-guard\") to $(basename "$SETTINGS_FILE")"
        fi
    fi
fi

# --- Summary ---
echo ""
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
if [ "$DRY_RUN" = false ] && [ "$ERRORS" -eq 0 ]; then
    log_ok "Guard tests installed successfully."
    log_info "Run tests with: cd $TARGET && ./gradlew :konsist-guard:test"
fi
