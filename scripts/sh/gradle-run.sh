#!/usr/bin/env bash
# BL-W32-06a: Thin wrapper around kmp-test-runner v0.8.1.
# Replaces the 497-line self-contained runner (daemon retry, Kover fallback,
# JDK detection). All of that logic is now inside kmp-test-runner internals.
set -euo pipefail

# --- Detection cascade ------------------------------------------------------ #
if command -v kmp-test >/dev/null 2>&1; then
  KMP_TEST_CMD="kmp-test"
elif command -v npx >/dev/null 2>&1; then
  KMP_TEST_CMD="npx kmp-test-runner@0.8.1"
else
  echo "ERROR: kmp-test-runner not found. Install: npm install -g kmp-test-runner@0.8.1" >&2
  exit 1
fi

# --- Flag parser ------------------------------------------------------------ #
PROJECT_ROOT=""
MODULE=""
TEST_TYPE=""
SKIP_COV=false
COV_TOOL=""
TIMEOUT=""
DRY_RUN=false
PASSTHROUGH_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root) PROJECT_ROOT="$2"; shift 2 ;;
    --test-type)    TEST_TYPE="$2";    shift 2 ;;
    --skip-coverage) SKIP_COV=true;   shift ;;
    --coverage-tool) COV_TOOL="$2";   shift 2 ;;
    --timeout)      TIMEOUT="$2";     shift 2 ;;
    --dry-run)      DRY_RUN=true;     shift ;;
    --platform)
      echo "WARNING: --platform is deprecated and ignored. Use --test-type instead." >&2
      shift 2 ;;
    --search-pattern)
      echo "WARNING: --search-pattern is deprecated and ignored. Use kmp-test errors[].code discriminator instead." >&2
      shift 2 ;;
    --help|-h)
      echo "Usage: gradle-run.sh [options] [<module>]"
      echo ""
      echo "Thin wrapper around kmp-test-runner v0.8.1 (kmp-test)."
      echo ""
      echo "Options:"
      echo "  --project-root <path>     Project root (default: pwd)"
      echo "  --test-type <type>        all|common|desktop|androidUnit|androidInstrumented"
      echo "  --skip-coverage           Pass --no-coverage to kmp-test"
      echo "  --coverage-tool <tool>    Pass-through to --coverage-tool"
      echo "  --timeout <s>             Test execution timeout in seconds"
      echo "  --dry-run                 Print constructed command, exit 0"
      echo "  --platform                DEPRECATED — warn and ignore"
      echo "  --search-pattern          DEPRECATED — use errors[].code instead"
      echo ""
      echo "Exit codes: 0=success  1=test failure  2=build error  3=env error"
      exit 0
      ;;
    --)
      shift; PASSTHROUGH_ARGS+=("$@"); break ;;
    -*)
      PASSTHROUGH_ARGS+=("$1"); shift ;;
    *)
      if [[ -z "$MODULE" ]]; then
        MODULE="$1"
      fi
      shift ;;
  esac
done

# --- Subcommand selection --------------------------------------------------- #
# all|common|desktop|"" → parallel subcommand
# androidUnit|androidInstrumented → android subcommand
case "${TEST_TYPE:-all}" in
  androidUnit|androidInstrumented) SUBCOMMAND="android" ;;
  all|common|desktop|"")           SUBCOMMAND="parallel" ;;
  *)                               SUBCOMMAND="parallel" ;;
esac

# --- Build CMD array -------------------------------------------------------- #
CMD=($KMP_TEST_CMD $SUBCOMMAND)
[[ -n "$PROJECT_ROOT" ]]   && CMD+=(--project-root "$PROJECT_ROOT")
[[ -n "$MODULE" ]]         && CMD+=(--module-filter "$MODULE")
[[ -n "$TEST_TYPE" ]]      && CMD+=(--test-type "$TEST_TYPE")
[[ "$SKIP_COV" == true ]]  && CMD+=(--no-coverage)
[[ -n "$COV_TOOL" ]]       && CMD+=(--coverage-tool "$COV_TOOL")
[[ -n "$TIMEOUT" ]]        && CMD+=(--timeout "$TIMEOUT")
[[ "$DRY_RUN" == true ]]   && CMD+=(--dry-run)
CMD+=("${PASSTHROUGH_ARGS[@]:-}")

if [[ "$DRY_RUN" == true ]]; then
  echo "DRY-RUN: ${CMD[*]}"
  exit 0
fi

"${CMD[@]}"; exit $?
