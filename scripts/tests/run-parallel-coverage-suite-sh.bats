#!/usr/bin/env bats
#
# Bats RED tests for scripts/sh/run-parallel-coverage-suite.sh thin-wrap.
# test-infra: mocked — kmp-test binary shim via PATH injection.
# These tests assert thin-wrap CLI behavior that does NOT exist in the
# current fat script, so all cases must FAIL RED until toolkit-specialist
# completes the thin-wrap (Steps 2+4).
#
# arch-testing V2 cases: 5 required.
# Contract surface (V3): coverage-full-report.md MUST contain:
#   "## AI-Optimized Summary"
#   TOTAL_COVERAGE=<N.N>%
#   CLASSES_ANALYZED=<N>

SCRIPT="$BATS_TEST_DIRNAME/../sh/run-parallel-coverage-suite.sh"

# JSON fixture matching RUNNER-CAPABILITIES.md §1.6 schema
KMP_TEST_SUCCESS_JSON='{
  "tool": "kmp-test",
  "subcommand": "parallel",
  "version": "0.7.0",
  "project_root": "/tmp/fake-project",
  "exit_code": 0,
  "duration_ms": 5000,
  "tests": {"total": 42, "passed": 42, "failed": 0, "skipped": 0},
  "modules": ["core-foo", "core-bar"],
  "coverage": {"tool": "kover", "missed_lines": 0},
  "errors": [],
  "warnings": [],
  "skipped": []
}'

KMP_TEST_COVERAGE_JSON='{
  "tool": "kmp-test",
  "subcommand": "coverage",
  "version": "0.7.0",
  "project_root": "/tmp/fake-project",
  "exit_code": 0,
  "duration_ms": 1000,
  "tests": {"total": 0, "passed": 0, "failed": 0, "skipped": 0},
  "modules": ["core-foo", "core-bar"],
  "coverage": {"tool": "kover", "missed_lines": 0},
  "errors": [],
  "warnings": [],
  "skipped": []
}'

setup() {
  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin-$$"
  FAKE_PROJECT="${BATS_TEST_TMPDIR}/fake-project-$$"
  mkdir -p "$FAKE_BIN" "$FAKE_PROJECT"

  # Shim: records all args to a log file, emits success JSON, exits 0
  cat > "$FAKE_BIN/kmp-test" <<'SHIM'
#!/usr/bin/env bash
echo "$@" >> "${BATS_TEST_TMPDIR}/kmp-test-args.log"
case "$1" in
  parallel)
    cat << 'JSON'
{"tool":"kmp-test","subcommand":"parallel","version":"0.7.0","project_root":"/tmp/fake-project","exit_code":0,"duration_ms":5000,"tests":{"total":42,"passed":42,"failed":0,"skipped":0},"modules":["core-foo","core-bar"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}
JSON
    # Thin-wrap must write coverage-full-report.md with AI-Optimized Summary
    exit 0
    ;;
  coverage)
    cat << 'JSON'
{"tool":"kmp-test","subcommand":"coverage","version":"0.7.0","project_root":"/tmp/fake-project","exit_code":0,"duration_ms":1000,"tests":{"total":0,"passed":0,"failed":0,"skipped":0},"modules":["core-foo","core-bar"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}
JSON
    exit 0
    ;;
  changed)
    cat << 'JSON'
{"tool":"kmp-test","subcommand":"changed","version":"0.7.0","project_root":"/tmp/fake-project","exit_code":0,"duration_ms":2000,"tests":{"total":10,"passed":10,"failed":0,"skipped":0},"modules":["core-foo"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}
JSON
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
SHIM
  chmod +x "$FAKE_BIN/kmp-test"

  # Create a minimal project directory so --project-root is valid
  echo 'rootProject.name = "test"' > "$FAKE_PROJECT/settings.gradle.kts"
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/fake-bin-$$" \
         "${BATS_TEST_TMPDIR}/fake-project-$$" \
         "${BATS_TEST_TMPDIR}/kmp-test-args.log" \
         "$FAKE_PROJECT/coverage-full-report.md" 2>/dev/null || true
}

# ── Case 1: happy path — kmp-test parallel --json invoked; report contains AI-Summary block ──

@test "run-parallel-coverage-suite.sh: happy path invokes kmp-test parallel --json" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --project-root "$FAKE_PROJECT"
  # Thin-wrap must call kmp-test with 'parallel' and '--json'
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "parallel" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  grep -q "\-\-json" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

@test "run-parallel-coverage-suite.sh: happy path — coverage-full-report.md contains AI-Optimized Summary" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --project-root "$FAKE_PROJECT"
  [ -f "$FAKE_PROJECT/coverage-full-report.md" ]
  grep -q "## AI-Optimized Summary" "$FAKE_PROJECT/coverage-full-report.md"
  grep -q "TOTAL_COVERAGE=" "$FAKE_PROJECT/coverage-full-report.md"
  grep -q "CLASSES_ANALYZED=" "$FAKE_PROJECT/coverage-full-report.md"
}

# ── Case 2: --skip-tests — invokes kmp-test coverage (NOT parallel) ──────────

@test "run-parallel-coverage-suite.sh: --skip-tests invokes kmp-test coverage subcommand" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --project-root "$FAKE_PROJECT" --skip-tests
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  # Must use 'coverage' subcommand, NOT 'parallel'
  grep -q "^coverage" "${BATS_TEST_TMPDIR}/kmp-test-args.log" || \
    grep -q " coverage " "${BATS_TEST_TMPDIR}/kmp-test-args.log" || \
    grep -qE "^coverage$|^coverage " "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  ! grep -qE "^parallel|parallel --" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 3: --dry-run — Strategy A: wrapper echoes DRY-RUN line; does NOT invoke kmp-test ──
# arch-testing addendum: wrapper exits 0 without invoking runner; grep stdout for DRY-RUN line.

@test "run-parallel-coverage-suite.sh: --dry-run echoes DRY-RUN line to stdout; kmp-test not invoked" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --project-root "$FAKE_PROJECT" --dry-run
  [ "$status" -eq 0 ]
  # Wrapper must print DRY-RUN: kmp-test <subcommand> to stdout (Strategy A)
  [[ "$output" == *"DRY-RUN: kmp-test"* ]]
  # kmp-test must NOT have been invoked (no args log written)
  ! [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  # No report written
  ! [ -f "$FAKE_PROJECT/coverage-full-report.md" ]
}

# ── Case 4: missing kmp-test binary — non-zero exit + error message ──────────

@test "run-parallel-coverage-suite.sh: missing kmp-test exits non-zero with error" {
  local empty_dir="${BATS_TEST_TMPDIR}/empty-path-$$"
  mkdir -p "$empty_dir"
  local bash_dir
  bash_dir="$(dirname "$(command -v bash)")"
  run env PATH="$bash_dir:$empty_dir" bash "$SCRIPT" --project-root "$FAKE_PROJECT"
  [ "$status" -ne 0 ]
  # Must print error message about missing kmp-test
  [[ "$output" == *"kmp-test"* ]]
  # Must NOT write coverage-full-report.md
  ! [ -f "$FAKE_PROJECT/coverage-full-report.md" ]
}

# ── Case 5: --exclude-coverage — translates to --exclude-modules; deprecation warning ──

@test "run-parallel-coverage-suite.sh: --exclude-coverage translates to --exclude-modules with deprecation warning" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" \
    --project-root "$FAKE_PROJECT" \
    --exclude-coverage "core-foo,core-bar"
  # Thin-wrap must forward --exclude-modules (not --exclude-coverage) to kmp-test
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "\-\-exclude-modules" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  ! grep -q "\-\-exclude-coverage" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  # Must emit deprecation warning to stderr
  [[ "$output" == *"deprecated"* ]] || [[ "$stderr" == *"deprecated"* ]]
}
