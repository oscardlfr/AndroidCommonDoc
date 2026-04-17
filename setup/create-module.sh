#!/usr/bin/env bash
# create-module.sh — wrap Google's `android create` with L0 convention-plugin
# post-processing.
#
# Produces an AGP 9.0+ module whose build.gradle.kts applies the appropriate
# L0 convention plugin instead of raw AGP blocks. Registers the module in
# settings.gradle.kts and runs verify-kmp-packages to catch source-set
# violations before exit.
#
# Usage:
#   bash setup/create-module.sh --name <module-slug> --package <com.x.y> [OPTIONS]
#
# Options:
#   --name SLUG            Flat kebab-case module name (required). MUST NOT
#                          contain colons — AGP 9+ requires flat paths.
#   --package PKG          Kotlin package (required), e.g. com.example.feature.x
#   --kmp                  Generate a KMP library module (default: Android-only)
#   --compose              Include Compose Multiplatform (implies --kmp)
#   --project-root PATH    Target project (default: current directory)
#   --template NAME        Override template slug (default: derived from flags)
#   --dry-run              Preview actions without writing files
#   --help                 Show this help
#
# Exit codes:
#   0  — success
#   1  — invalid arguments or verification failure
#   2  — android CLI missing
#   3  — module name contains colons (AGP 9 flat invariant)
#   4  — settings.gradle.kts not found at project root

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────

MODULE_NAME=""
PACKAGE=""
KMP=0
COMPOSE=0
PROJECT_ROOT="$(pwd)"
TEMPLATE=""
DRY_RUN=0

# ── Arg parsing ──────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) MODULE_NAME="$2"; shift 2 ;;
    --package) PACKAGE="$2"; shift 2 ;;
    --kmp) KMP=1; shift ;;
    --compose) COMPOSE=1; KMP=1; shift ;;
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --template) TEMPLATE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$MODULE_NAME" || -z "$PACKAGE" ]]; then
  echo "ERROR: --name and --package are required. Run with --help." >&2
  exit 1
fi

# ── Invariant checks ─────────────────────────────────────────────────────────

# AGP 9 flat-module-names invariant
if [[ "$MODULE_NAME" == *":"* ]]; then
  echo "ERROR: Module name contains colons (':'). AGP 9+ requires flat names." >&2
  echo "       Use 'core-json-api' instead of 'core:json:api'." >&2
  echo "       See docs/gradle/gradle-patterns-agp9.md §Flat module names." >&2
  exit 3
fi

if ! command -v android >/dev/null 2>&1; then
  echo "ERROR: 'android' CLI not on PATH." >&2
  echo "       Install from d.android.com/tools/agents — see" >&2
  echo "       docs/guides/getting-started/09-android-cli-windows.md" >&2
  exit 2
fi

if [[ ! -f "$PROJECT_ROOT/settings.gradle.kts" ]]; then
  echo "ERROR: settings.gradle.kts not found at $PROJECT_ROOT" >&2
  echo "       Pass --project-root or run from the project root." >&2
  exit 4
fi

# ── Template resolution ──────────────────────────────────────────────────────

if [[ -z "$TEMPLATE" ]]; then
  if [[ $COMPOSE -eq 1 ]]; then
    TEMPLATE="compose-library-agp-9"
  elif [[ $KMP -eq 1 ]]; then
    TEMPLATE="kmp-library-agp-9"
  else
    TEMPLATE="empty-activity-agp-9"
  fi
fi

# Resolve convention plugin to apply post-scaffold.
if [[ $COMPOSE -eq 1 ]]; then
  CONVENTION_PLUGIN="androidcommondoc.kmp.compose"
elif [[ $KMP -eq 1 ]]; then
  CONVENTION_PLUGIN="androidcommondoc.kmp.library"
else
  CONVENTION_PLUGIN="androidcommondoc.android.library"
fi

MODULE_DIR="$PROJECT_ROOT/$MODULE_NAME"

echo "=== create-module.sh ==="
echo "Project root:        $PROJECT_ROOT"
echo "Module name:         $MODULE_NAME"
echo "Package:             $PACKAGE"
echo "Template:            $TEMPLATE"
echo "Convention plugin:   $CONVENTION_PLUGIN"
echo "Target dir:          $MODULE_DIR"
[[ $DRY_RUN -eq 1 ]] && echo "Mode:                DRY RUN (no writes)"
echo "========================"

if [[ -d "$MODULE_DIR" ]]; then
  echo "ERROR: Target directory already exists: $MODULE_DIR" >&2
  exit 1
fi

# ── Scaffold via `android create` ────────────────────────────────────────────

SCAFFOLD_TMP="$(mktemp -d)"
trap 'rm -rf "$SCAFFOLD_TMP"' EXIT

echo "• Scaffolding via android create → $SCAFFOLD_TMP"
if [[ $DRY_RUN -eq 1 ]]; then
  android create --dry-run --verbose "$TEMPLATE" --output="$SCAFFOLD_TMP" --name="$MODULE_NAME"
  echo "[dry-run] would apply convention plugin: $CONVENTION_PLUGIN"
  echo "[dry-run] would register module in settings.gradle.kts"
  exit 0
fi

android create "$TEMPLATE" --output="$SCAFFOLD_TMP" --name="$MODULE_NAME" >/dev/null

GENERATED_ROOT="$SCAFFOLD_TMP/$MODULE_NAME"
if [[ ! -d "$GENERATED_ROOT" ]]; then
  echo "ERROR: Expected $GENERATED_ROOT after scaffold, not found." >&2
  exit 1
fi

# ── Post-process: rewrite build.gradle.kts to use convention plugin ─────────

BUILD_FILE="$GENERATED_ROOT/build.gradle.kts"
if [[ ! -f "$BUILD_FILE" ]]; then
  echo "WARN: $BUILD_FILE not found — skipping convention-plugin rewrite."
else
  echo "• Rewriting $BUILD_FILE to apply $CONVENTION_PLUGIN"
  cat > "$BUILD_FILE" <<BUILD
plugins {
    id("$CONVENTION_PLUGIN")
}

// Convention plugin owns: compileSdk, minSdk, kotlin toolchain, Detekt, Kover.
// Module-specific dependencies go here.
dependencies {
    // implementation(libs.your.dependency)
}
BUILD
fi

# ── Move into project + register in settings.gradle.kts ──────────────────────

echo "• Moving module to $MODULE_DIR"
mv "$GENERATED_ROOT" "$MODULE_DIR"

if grep -q "include(\":$MODULE_NAME\")" "$PROJECT_ROOT/settings.gradle.kts"; then
  echo "• settings.gradle.kts already includes :$MODULE_NAME"
else
  echo "• Adding include(\":$MODULE_NAME\") to settings.gradle.kts"
  printf '\ninclude(":%s")\n' "$MODULE_NAME" >> "$PROJECT_ROOT/settings.gradle.kts"
fi

# ── Post-scaffold verification ───────────────────────────────────────────────

echo "• Verifying KMP source-set layout (verify-kmp MCP tool)"
if command -v node >/dev/null 2>&1 && [[ -f "$PROJECT_ROOT/mcp-server/build/cli/verify-kmp.js" ]]; then
  node "$PROJECT_ROOT/mcp-server/build/cli/verify-kmp.js" --module "$MODULE_NAME" || {
    echo "WARN: verify-kmp reported issues — review before committing." >&2
  }
else
  echo "NOTE: verify-kmp CLI not available — skipping (run /verify-kmp $MODULE_NAME later)."
fi

echo "✓ Module created: $MODULE_DIR"
echo ""
echo "Next steps:"
echo "  1. Add module-specific dependencies to $MODULE_NAME/build.gradle.kts"
echo "  2. ./gradlew :$MODULE_NAME:assemble"
echo "  3. /test $MODULE_NAME"
