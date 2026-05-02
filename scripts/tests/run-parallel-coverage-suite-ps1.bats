#!/usr/bin/env bats
#
# Bats tests for scripts/ps1/run-parallel-coverage-suite.ps1 thin-wrap.
# test-infra: mocked — kmp-test binary shim via PATH injection.
#   Windows: kmp-test.cmd delegate → bash shim; PATH separator = ;
#   Linux:   bash shim directly (pwsh on Linux executes shebanged scripts); PATH separator = :
# Per-case: $env:PATH = "$WIN_FAKE_BIN<sep>$env:PATH" injected before & $WIN_SCRIPT
#
# arch-testing V2 cases: 5 required + 1 split = 6 total.

SCRIPT="$BATS_TEST_DIRNAME/../ps1/run-parallel-coverage-suite.ps1"

setup() {
  if ! command -v pwsh >/dev/null 2>&1 && ! command -v powershell.exe >/dev/null 2>&1; then
    skip "neither pwsh nor powershell.exe on PATH; cannot run ps1 bats"
  fi

  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin-$$"
  FAKE_PROJECT="${BATS_TEST_TMPDIR}/fake-project-$$"
  mkdir -p "$FAKE_BIN" "$FAKE_PROJECT"

  # Bash shim: records args, emits JSON fixture per subcommand
  cat > "$FAKE_BIN/kmp-test" <<'SHIM'
#!/usr/bin/env bash
echo "$@" >> "${BATS_TEST_TMPDIR}/kmp-test-args.log"
case "$1" in
  parallel)
    echo '{"tool":"kmp-test","subcommand":"parallel","version":"0.7.0","project_root":"/tmp/fake","exit_code":0,"duration_ms":5000,"tests":{"total":42,"passed":42,"failed":0,"skipped":0},"modules":["core-foo"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}'
    exit 0 ;;
  coverage)
    echo '{"tool":"kmp-test","subcommand":"coverage","version":"0.7.0","project_root":"/tmp/fake","exit_code":0,"duration_ms":1000,"tests":{"total":0,"passed":0,"failed":0,"skipped":0},"modules":["core-foo"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}'
    exit 0 ;;
  *)
    exit 0 ;;
esac
SHIM
  chmod +x "$FAKE_BIN/kmp-test"

  # On Windows (cygpath available): add .cmd delegate so pwsh finds the shim.
  # On Linux: pwsh executes the bash shim directly via shebang + exec bit.
  if command -v cygpath >/dev/null 2>&1; then
    cat > "$FAKE_BIN/kmp-test.cmd" <<'CMD'
@echo off
bash "%~dp0kmp-test" %*
CMD
  fi

  echo 'rootProject.name = "test"' > "$FAKE_PROJECT/settings.gradle.kts"

  # Determine pwsh executable
  if command -v pwsh >/dev/null 2>&1; then
    PWSH="pwsh"
  else
    PWSH="powershell.exe"
  fi

  # Convert paths and choose PATH separator per OS.
  # Windows (cygpath): Windows paths + ; separator.
  # Linux: Unix paths + : separator.
  WIN_SCRIPT="$SCRIPT"
  WIN_PROJECT="$FAKE_PROJECT"
  WIN_FAKE_BIN="$FAKE_BIN"
  PATH_SEP=":"
  if command -v cygpath >/dev/null 2>&1; then
    WIN_SCRIPT="$(cygpath -w "$SCRIPT")"
    WIN_PROJECT="$(cygpath -w "$FAKE_PROJECT")"
    WIN_FAKE_BIN="$(cygpath -w "$FAKE_BIN")"
    PATH_SEP=";"
  fi
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/fake-bin-$$" \
         "${BATS_TEST_TMPDIR}/fake-project-$$" \
         "${BATS_TEST_TMPDIR}/kmp-test-args.log" 2>/dev/null || true
}

# ── Case 1a: happy path — kmp-test parallel --json invoked ───────────────────

@test "run-parallel-coverage-suite.ps1: happy path invokes kmp-test parallel --json" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "parallel" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  grep -q "\-\-json" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 1b: happy path — coverage-full-report.md contains AI-Summary block ──

@test "run-parallel-coverage-suite.ps1: happy path — coverage-full-report.md contains AI-Optimized Summary" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ -f "$FAKE_PROJECT/coverage-full-report.md" ]
  grep -q "## AI-Optimized Summary" "$FAKE_PROJECT/coverage-full-report.md"
  grep -q "TOTAL_COVERAGE=" "$FAKE_PROJECT/coverage-full-report.md"
  grep -q "CLASSES_ANALYZED=" "$FAKE_PROJECT/coverage-full-report.md"
}

# ── Case 2: -SkipTests — invokes kmp-test coverage (NOT parallel) ────────────

@test "run-parallel-coverage-suite.ps1: -SkipTests invokes kmp-test coverage subcommand" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -SkipTests" \
    2>&1
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -qE "^coverage|coverage " "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  ! grep -qE "^parallel|parallel --" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 3: -DryRun — Strategy A: wrapper echoes DRY-RUN; kmp-test NOT invoked ──

@test "run-parallel-coverage-suite.ps1: -DryRun echoes DRY-RUN line to stdout; kmp-test not invoked" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -DryRun" \
    2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY-RUN: kmp-test"* ]]
  ! [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  ! [ -f "$FAKE_PROJECT/coverage-full-report.md" ]
}

# ── Case 4: missing kmp-test binary — non-zero exit + error message ──────────

@test "run-parallel-coverage-suite.ps1: missing kmp-test exits non-zero with error" {
  local empty_dir
  empty_dir="${BATS_TEST_TMPDIR}/empty-path-$$"
  mkdir -p "$empty_dir"
  local empty_win_dir="$empty_dir"
  if command -v cygpath >/dev/null 2>&1; then
    empty_win_dir="$(cygpath -w "$empty_dir")"
  fi
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$empty_win_dir'; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ "$status" -ne 0 ]
  [[ "$output" == *"kmp-test"* ]]
  ! [ -f "$FAKE_PROJECT/coverage-full-report.md" ]
}

# ── Case 5: -ExcludeCoverage — translates to --exclude-modules; deprecation warning ──

@test "run-parallel-coverage-suite.ps1: -ExcludeCoverage translates to --exclude-modules with deprecation warning" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -ExcludeCoverage 'core-foo,core-bar'" \
    2>&1
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "\-\-exclude-modules" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  ! grep -q "\-\-exclude-coverage" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  [[ "$output" == *"deprecated"* ]]
}
