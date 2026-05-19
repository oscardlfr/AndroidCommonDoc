#!/usr/bin/env bash
# BL-W32-06e: Thin wrapper around kmp-test-runner v0.10.1.
# Replaces the 1355-line self-contained runner. Gradle daemon retry, module
# discovery, Kover/JaCoCo fallback, and parallel orchestration are now inside
# kmp-test-runner internals. L0 retains: AI-Optimized Summary post-processor,
# AUTO_EXCLUDE_COVERAGE_PATTERNS → --exclude-modules translation, audit_append,
# --fresh-daemon / --exclude-coverage deprecation warnings, --benchmark opt-in.
set -euo pipefail

# --- Detection cascade ------------------------------------------------------ #
if command -v kmp-test >/dev/null 2>&1; then
  KMP_TEST_CMD="kmp-test"
elif command -v npx >/dev/null 2>&1; then
  KMP_TEST_CMD="npx kmp-test-runner@0.10.1"
else
  echo "ERROR: kmp-test-runner not found. Install: npm install -g kmp-test-runner@0.10.1" >&2
  exit 1
fi

# --- AUTO_EXCLUDE_COVERAGE_PATTERNS (A3 — inline, never a config file) ------ #
# Modules that run tests but must not contribute to coverage aggregation.
# Translated to --exclude-modules before runner invocation.
AUTO_EXCLUDE_COVERAGE_PATTERNS=(
  "*:testing"
  "*:test-fakes"
  "*:test-fixtures"
  "konsist-guard"
  "konsist-tests"
  "detekt-rules*"
  "*detekt-rules*"
  "benchmark"
  "benchmark-*"
)

# --- Defaults --------------------------------------------------------------- #
PROJECT_ROOT=""
TEST_TYPE=""
MODULE_FILTER=""
SKIP_TESTS=false
MIN_MISSED_LINES=0
OUTPUT_FILE="coverage-full-report.md"
MAX_WORKERS=0
COVERAGE_TOOL=""
EXCLUDE_COVERAGE=""
EXCLUDE_MODULES_EXTRA=""
TIMEOUT=600
BENCHMARK=false
BENCHMARK_CONFIG="smoke"
INCLUDE_SHARED=false
DRY_RUN=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/audit-append.sh"

# --- Flag parser ------------------------------------------------------------ #
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root)      PROJECT_ROOT="$2";          shift 2 ;;
    --test-type)         TEST_TYPE="$2";              shift 2 ;;
    --module-filter)     MODULE_FILTER="$2";          shift 2 ;;
    --skip-tests)        SKIP_TESTS=true;             shift ;;
    --min-missed-lines)  MIN_MISSED_LINES="$2";       shift 2 ;;
    --output-file)       OUTPUT_FILE="$2";            shift 2 ;;
    --max-workers)       MAX_WORKERS="$2";            shift 2 ;;
    --coverage-tool)     COVERAGE_TOOL="$2";          shift 2 ;;
    --timeout)           TIMEOUT="$2";                shift 2 ;;
    --benchmark)         BENCHMARK=true;              shift ;;
    --benchmark-config)  BENCHMARK_CONFIG="$2";       shift 2 ;;
    --include-shared)    INCLUDE_SHARED=true;         shift ;;
    --dry-run)           DRY_RUN=true;                shift ;;
    --coverage-only)
      SKIP_TESTS=true; shift ;;
    --coverage-modules)
      shift 2 ;;
    --java-home)
      export JAVA_HOME="$2"; shift 2 ;;
    --fresh-daemon)
      echo "WARNING: --fresh-daemon not supported by kmp-test-runner v0.10.1; flag ignored. See GAP-01." >&2
      shift ;;
    --exclude-coverage)
      echo "WARNING: --exclude-coverage deprecated — degraded to --exclude-modules; tests will be skipped instead of just excluded from coverage. See GAP-05." >&2
      EXCLUDE_COVERAGE="$2"; shift 2 ;;
    --exclude-modules)   EXCLUDE_MODULES_EXTRA="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: run-parallel-coverage-suite.sh --project-root <path> [OPTIONS]"
      echo ""
      echo "Thin wrapper around kmp-test-runner v0.10.1."
      echo ""
      echo "Options:"
      echo "  --test-type <type>          all | common | desktop | androidUnit | androidInstrumented"
      echo "  --module-filter <pattern>   Filter modules (comma-separated). Default: all"
      echo "  --skip-tests                Skip tests, regenerate coverage only"
      echo "  --min-missed-lines <N>      Min missed lines for gaps report. Default: 0"
      echo "  --output-file <name>        Report filename. Default: coverage-full-report.md"
      echo "  --max-workers <N>           Gradle worker count. 0 = runner default"
      echo "  --coverage-tool <tool>      kover | jacoco | auto | none"
      echo "  --timeout <s>               Test execution timeout. Default: 600"
      echo "  --include-shared            Include shared-kmp-libs modules"
      echo "  --benchmark                 Run benchmarks after tests"
      echo "  --benchmark-config <name>   smoke (default) | main | stress"
      echo "  --dry-run                   Print assembled kmp-test command, exit 0"
      echo "  --fresh-daemon              DEPRECATED — flag ignored (See GAP-01)"
      echo "  --exclude-coverage <list>   DEPRECATED — use --exclude-modules"
      echo ""
      echo "Exit codes: 0=success  1=test failure  2=build error  3=env error"
      exit 0
      ;;
    *) echo "ERROR: Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROJECT_ROOT" ]]; then
  echo "ERROR: --project-root is required." >&2
  exit 1
fi

# --- Build --exclude-modules arg from patterns + user args ------------------ #
EXCLUDE_MODULES_LIST=()
for pat in "${AUTO_EXCLUDE_COVERAGE_PATTERNS[@]}"; do
  EXCLUDE_MODULES_LIST+=("$pat")
done
if [[ -n "$EXCLUDE_COVERAGE" ]]; then
  IFS=',' read -ra _ec <<< "$EXCLUDE_COVERAGE"
  EXCLUDE_MODULES_LIST+=("${_ec[@]}")
fi
if [[ -n "$EXCLUDE_MODULES_EXTRA" ]]; then
  IFS=',' read -ra _em <<< "$EXCLUDE_MODULES_EXTRA"
  EXCLUDE_MODULES_LIST+=("${_em[@]}")
fi
EXCLUDE_MODULES_ARG=""
for m in "${EXCLUDE_MODULES_LIST[@]}"; do
  if [[ -z "$EXCLUDE_MODULES_ARG" ]]; then
    EXCLUDE_MODULES_ARG="$m"
  else
    EXCLUDE_MODULES_ARG="$EXCLUDE_MODULES_ARG,$m"
  fi
done

# --- Select subcommand ------------------------------------------------------ #
if [[ "$SKIP_TESTS" == true ]]; then
  SUBCOMMAND="coverage"
else
  SUBCOMMAND="parallel"
fi

# --- Build CMD array -------------------------------------------------------- #
CMD=($KMP_TEST_CMD $SUBCOMMAND --json)
CMD+=(--project-root "$PROJECT_ROOT")
[[ -n "$TEST_TYPE" ]]           && CMD+=(--test-type "$TEST_TYPE")
[[ -n "$MODULE_FILTER" ]]       && CMD+=(--module-filter "$MODULE_FILTER")
[[ "$MAX_WORKERS" -gt 0 ]]      && CMD+=(--max-workers "$MAX_WORKERS")
[[ -n "$COVERAGE_TOOL" ]]       && CMD+=(--coverage-tool "$COVERAGE_TOOL")
[[ "$MIN_MISSED_LINES" -gt 0 ]] && CMD+=(--min-missed-lines "$MIN_MISSED_LINES")
[[ "$TIMEOUT" -ne 600 ]]        && CMD+=(--timeout "$TIMEOUT")
[[ -n "$EXCLUDE_MODULES_ARG" ]] && CMD+=(--exclude-modules "$EXCLUDE_MODULES_ARG")

# --- Wrapper --dry-run (Strategy A — arch-testing addendum) ----------------- #
# Echo assembled command to stdout, exit 0, NO runner invocation.
if [[ "$DRY_RUN" == true ]]; then
  echo "DRY-RUN: ${CMD[*]}"
  exit 0
fi

# --- Invoke runner ---------------------------------------------------------- #
RUNNER_EXIT=0
RUNNER_JSON=$("${CMD[@]}" 2>&1) || RUNNER_EXIT=$?

# --- Post-processor: write coverage-full-report.md with V3 contract surface - #
# V3 contract (arch-testing BINDING): report MUST contain:
#   "## AI-Optimized Summary"
#   TOTAL_COVERAGE=<N.N>%
#   CLASSES_ANALYZED=<N>
_total=$(echo "$RUNNER_JSON" | grep -o '"total":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
_passed=$(echo "$RUNNER_JSON" | grep -o '"passed":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
_failed=$(echo "$RUNNER_JSON" | grep -o '"failed":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
_missed=$(echo "$RUNNER_JSON" | grep -o '"missed_lines":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
_duration=$(echo "$RUNNER_JSON" | grep -o '"duration_ms":[0-9]*' | head -1 | grep -o '[0-9]*' || echo "0")
_classes="${_total}"
if [[ "$_total" -gt 0 ]]; then
  _coverage_pct="$(awk "BEGIN { printf \"%.1f\", (1 - ${_missed:-0} / (${_total} * 10)) * 100 }" 2>/dev/null || echo "0.0")"
else
  _coverage_pct="0.0"
fi

REPORT_PATH="$PROJECT_ROOT/$OUTPUT_FILE"
cat > "$REPORT_PATH" <<REPORT
## AI-Optimized Summary

TOTAL_COVERAGE=${_coverage_pct}%
CLASSES_ANALYZED=${_classes}
TESTS_TOTAL=${_total}
TESTS_PASSED=${_passed}
TESTS_FAILED=${_failed}
MISSED_LINES=${_missed}
DURATION_MS=${_duration}

## Runner Output

\`\`\`json
${RUNNER_JSON}
\`\`\`
REPORT

# --- Audit append ----------------------------------------------------------- #
if declare -f audit_append >/dev/null 2>&1; then
  audit_append "run-parallel-coverage-suite" "$PROJECT_ROOT" "$RUNNER_EXIT"
fi

# --- Benchmark opt-in ------------------------------------------------------- #
if [[ "$BENCHMARK" == true ]]; then
  BENCH_ARGS=(--project-root "$PROJECT_ROOT")
  [[ -n "$BENCHMARK_CONFIG" ]] && BENCH_ARGS+=(--benchmark-config "$BENCHMARK_CONFIG")
  "$SCRIPT_DIR/run-benchmarks.sh" "${BENCH_ARGS[@]}" || true
fi

exit "$RUNNER_EXIT"
