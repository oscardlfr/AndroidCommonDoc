#!/usr/bin/env bats
#
# Bats RED tests for scripts/ps1/run-changed-modules-tests.ps1 thin-wrap.
# test-infra: mocked — kmp-test binary shim via PATH injection (Option A).
#   - kmp-test (bash) + kmp-test.cmd (Windows .cmd delegate → bash shim)
#   - Per-case: $env:PATH = "$WIN_FAKE_BIN;$env:PATH" injected before & $WIN_SCRIPT
# All cases must FAIL RED against current fat script.
#
# arch-testing V2 cases: 5 required.

SCRIPT="$BATS_TEST_DIRNAME/../ps1/run-changed-modules-tests.ps1"

setup() {
  if ! command -v pwsh >/dev/null 2>&1 && ! command -v powershell.exe >/dev/null 2>&1; then
    skip "neither pwsh nor powershell.exe on PATH; cannot run ps1 bats"
  fi

  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin-$$"
  FAKE_PROJECT="${BATS_TEST_TMPDIR}/fake-project-$$"
  mkdir -p "$FAKE_BIN" "$FAKE_PROJECT"

  # Bash shim: records args, emits JSON fixture
  cat > "$FAKE_BIN/kmp-test" <<'SHIM'
#!/usr/bin/env bash
echo "$@" >> "${BATS_TEST_TMPDIR}/kmp-test-args.log"
case "$1" in
  changed)
    echo '{"tool":"kmp-test","subcommand":"changed","version":"0.7.0","project_root":"/tmp/fake","exit_code":0,"duration_ms":2000,"tests":{"total":10,"passed":10,"failed":0,"skipped":0},"modules":["core-foo"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}'
    exit 0 ;;
  *)
    exit 0 ;;
esac
SHIM
  chmod +x "$FAKE_BIN/kmp-test"

  # .cmd shim: delegates to bash shim so pwsh can execute it as a command
  cat > "$FAKE_BIN/kmp-test.cmd" <<'CMD'
@echo off
bash "%~dp0kmp-test" %*
CMD

  echo 'rootProject.name = "test"' > "$FAKE_PROJECT/settings.gradle.kts"

  # Determine pwsh executable
  if command -v pwsh >/dev/null 2>&1; then
    PWSH="pwsh"
  else
    PWSH="powershell.exe"
  fi

  # Convert paths for PowerShell on Windows
  WIN_SCRIPT="$SCRIPT"
  WIN_PROJECT="$FAKE_PROJECT"
  WIN_FAKE_BIN="$FAKE_BIN"
  if command -v cygpath >/dev/null 2>&1; then
    WIN_SCRIPT="$(cygpath -w "$SCRIPT")"
    WIN_PROJECT="$(cygpath -w "$FAKE_PROJECT")"
    WIN_FAKE_BIN="$(cygpath -w "$FAKE_BIN")"
  fi
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/fake-bin-$$" \
         "${BATS_TEST_TMPDIR}/fake-project-$$" \
         "${BATS_TEST_TMPDIR}/kmp-test-args.log" 2>/dev/null || true
}

# ── Case 1: happy path — kmp-test changed subcommand invoked; exit 0 ─────────

@test "run-changed-modules-tests.ps1: happy path invokes kmp-test changed subcommand" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN;' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ "$status" -eq 0 ]
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -qE "^changed|changed " "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 2: -StagedOnly flag forwarded to runner ─────────────────────────────

@test "run-changed-modules-tests.ps1: -StagedOnly forwarded to kmp-test changed" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN;' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -StagedOnly" \
    2>&1
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "\-\-staged-only" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 3: -IncludeShared — runner invoked with --project-root for shared-kmp-libs ──

@test "run-changed-modules-tests.ps1: -IncludeShared passes --project-root for shared-kmp-libs" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN;' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -IncludeShared" \
    2>&1
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "shared-kmp-libs" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 4: -ShowModulesOnly — maps to kmp-test changed --dry-run (Strategy B) ──

@test "run-changed-modules-tests.ps1: -ShowModulesOnly maps to kmp-test changed --dry-run" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN;' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -ShowModulesOnly" \
    2>&1
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "\-\-dry-run" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  grep -qE "^changed|changed " "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 5: missing kmp-test binary — non-zero exit + error message ──────────

@test "run-changed-modules-tests.ps1: missing kmp-test exits non-zero with error" {
  local empty_win_dir
  empty_win_dir="${BATS_TEST_TMPDIR}/empty-path-$$"
  mkdir -p "$empty_win_dir"
  if command -v cygpath >/dev/null 2>&1; then
    empty_win_dir="$(cygpath -w "$empty_win_dir")"
  fi
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$empty_win_dir'; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ "$status" -ne 0 ]
  [[ "$output" == *"kmp-test"* ]]
}
