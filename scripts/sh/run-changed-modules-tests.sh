#!/usr/bin/env bash
# BL-W32-06e: Thin wrapper around kmp-test-runner v0.9.0 `changed` subcommand.
# Replaces 256-line script that delegated to run-parallel-coverage-suite.sh.
# Git change detection, module-to-path mapping, and test dispatch are now
# inside kmp-test-runner internals. L0 retains: --include-shared glue,
# --show-modules-only → --dry-run translation, wrapper --dry-run echo,
# --exclude-coverage deprecation warning.
set -euo pipefail

# --- Detection cascade ------------------------------------------------------ #
if command -v kmp-test >/dev/null 2>&1; then
  KMP_TEST_CMD="kmp-test"
elif command -v npx >/dev/null 2>&1; then
  KMP_TEST_CMD="npx kmp-test-runner@0.9.0"
else
  echo "ERROR: kmp-test-runner not found. Install: npm install -g kmp-test-runner@0.9.0" >&2
  exit 1
fi

# --- Defaults --------------------------------------------------------------- #
PROJECT_ROOT=""
INCLUDE_SHARED=false
TEST_TYPE=""
STAGED_ONLY=false
SHOW_MODULES_ONLY=false
MIN_MISSED_LINES=0
COVERAGE_TOOL=""
EXCLUDE_COVERAGE=""
DRY_RUN=false

SHARED_ROOT="/c/Users/34645/AndroidStudioProjects/shared-kmp-libs"

# --- Flag parser ------------------------------------------------------------ #
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root)       PROJECT_ROOT="$2";        shift 2 ;;
    --include-shared)     INCLUDE_SHARED=true;      shift ;;
    --test-type)          TEST_TYPE="$2";           shift 2 ;;
    --staged-only)        STAGED_ONLY=true;         shift ;;
    --show-modules-only)  SHOW_MODULES_ONLY=true;   shift ;;
    --max-failures)       shift 2 ;;
    --min-missed-lines)   MIN_MISSED_LINES="$2";    shift 2 ;;
    --coverage-tool)      COVERAGE_TOOL="$2";       shift 2 ;;
    --dry-run)            DRY_RUN=true;             shift ;;
    --exclude-coverage)
      echo "WARNING: --exclude-coverage deprecated — degraded to --exclude-modules; tests will be skipped instead of just excluded from coverage. See GAP-05." >&2
      EXCLUDE_COVERAGE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: run-changed-modules-tests.sh --project-root <path> [OPTIONS]"
      echo ""
      echo "Thin wrapper around kmp-test-runner v0.9.0 changed subcommand."
      echo ""
      echo "Options:"
      echo "  --include-shared            Include changes in shared-kmp-libs"
      echo "  --test-type <type>          all | common | androidUnit | androidInstrumented | desktop"
      echo "  --staged-only               Only consider staged files (git add)"
      echo "  --show-modules-only         Show detected modules without running tests"
      echo "  --min-missed-lines <N>      Min missed lines for gaps report. Default: 0"
      echo "  --coverage-tool <tool>      jacoco | kover | auto | none"
      echo "  --exclude-coverage <list>   DEPRECATED — use --exclude-modules"
      echo "  --dry-run                   Print assembled kmp-test command, exit 0"
      echo "  -h | --help                 Show this help"
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
  echo "ERROR: --project-root is required." >&2
  exit 1
fi

# --- Build CMD array -------------------------------------------------------- #
CMD=($KMP_TEST_CMD changed)
CMD+=(--project-root "$PROJECT_ROOT")
[[ "$STAGED_ONLY" == true ]]       && CMD+=(--staged-only)
[[ "$SHOW_MODULES_ONLY" == true ]] && CMD+=(--dry-run)
[[ -n "$TEST_TYPE" ]]              && CMD+=(--test-type "$TEST_TYPE")
[[ -n "$COVERAGE_TOOL" ]]          && CMD+=(--coverage-tool "$COVERAGE_TOOL")
[[ "$MIN_MISSED_LINES" -gt 0 ]]    && CMD+=(--min-missed-lines "$MIN_MISSED_LINES")
[[ -n "$EXCLUDE_COVERAGE" ]]       && CMD+=(--exclude-modules "$EXCLUDE_COVERAGE")

# --include-shared: pass shared-kmp-libs root so runner detects changes there
if [[ "$INCLUDE_SHARED" == true ]]; then
  CMD+=(--project-root "$SHARED_ROOT")
fi

# --- Wrapper --dry-run (Strategy A — arch-testing addendum) ----------------- #
# Echo assembled command to stdout, exit 0, NO runner invocation.
if [[ "$DRY_RUN" == true ]]; then
  echo "DRY-RUN: ${CMD[*]}"
  exit 0
fi

# --- Invoke runner ---------------------------------------------------------- #
exec "${CMD[@]}"
