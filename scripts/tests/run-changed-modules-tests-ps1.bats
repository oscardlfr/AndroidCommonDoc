#!/usr/bin/env bats
#
# Bats tests for scripts/ps1/run-changed-modules-tests.ps1 thin-wrap.
# test-infra: mocked — kmp-test binary shim via PATH injection.
#   Git-Bash/MSYS (cygpath): kmp-test.cmd delegate -> bash.exe directly; PATH separator = ;
#   WSL (wslpath, no cygpath): kmp-test.cmd delegate -> wsl.exe re-entry (bash is a Linux
#     ELF binary genuine Windows PowerShell/cmd.exe can never exec directly, UNC path or
#     not -- interop only runs Linux->Windows, never the reverse); PATH separator = ;
#   Genuine Linux, no Windows interop: bash shim directly (pwsh on Linux executes
#     shebanged scripts); PATH separator = :
#
# arch-testing V2 cases: 5 required.

SCRIPT="$BATS_TEST_DIRNAME/../ps1/run-changed-modules-tests.ps1"
FIXTURE_ROOT="$BATS_TEST_DIRNAME/../../.androidcommondoc/bats-fixtures"

setup() {
  if ! command -v pwsh >/dev/null 2>&1 && ! command -v powershell.exe >/dev/null 2>&1; then
    skip "neither pwsh nor powershell.exe on PATH; cannot run ps1 bats"
  fi

  # WSL_WIN_PS=1: WSL re-entering genuine Windows PowerShell via interop (wslpath
  # present, cygpath absent, no Linux-native pwsh). wslpath on a /tmp path yields a
  # UNC path Windows PowerShell cannot reliably PATH-resolve a bare command name
  # through, so this mode alone needs drive-backed fixtures instead of /tmp.
  WSL_WIN_PS=0
  if command -v wslpath >/dev/null 2>&1 && ! command -v cygpath >/dev/null 2>&1 \
     && ! command -v pwsh >/dev/null 2>&1 && command -v powershell.exe >/dev/null 2>&1; then
    WSL_WIN_PS=1
  fi

  if [[ "$WSL_WIN_PS" -eq 1 ]]; then
    mkdir -p "$FIXTURE_ROOT"
    FAKE_BIN="$FIXTURE_ROOT/fake-bin-$$"
    FAKE_PROJECT="$FIXTURE_ROOT/fake-project-$$"
  else
    FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin-$$"
    FAKE_PROJECT="${BATS_TEST_TMPDIR}/fake-project-$$"
  fi
  mkdir -p "$FAKE_BIN" "$FAKE_PROJECT"
  ARGS_LOG="$FAKE_BIN/kmp-test-args.log"

  # Bash shim: records args, emits JSON fixture. Derives its own directory
  # instead of reading BATS_TEST_TMPDIR, which does not cross the wsl.exe
  # re-entry below (Windows -> WSL does not propagate the caller's env).
  cat > "$FAKE_BIN/kmp-test" <<'SHIM'
#!/usr/bin/env bash
SHIM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "$@" >> "$SHIM_DIR/kmp-test-args.log"
case "$1" in
  changed)
    echo '{"tool":"kmp-test","subcommand":"changed","version":"0.7.0","project_root":"/tmp/fake","exit_code":0,"duration_ms":2000,"tests":{"total":10,"passed":10,"failed":0,"skipped":0},"modules":["core-foo"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}'
    exit 0 ;;
  *)
    exit 0 ;;
esac
SHIM
  chmod +x "$FAKE_BIN/kmp-test"

  # On Windows (cygpath available): add .cmd delegate so pwsh finds the shim.
  # On Linux: pwsh executes the bash shim directly via shebang + exec bit.
  #
  # The delegate calls bash by its fully-resolved absolute path, never a bare
  # `bash` lookup: PowerShell's call-operator spawns a .cmd delegate through a
  # nested cmd.exe, and on a real Windows PowerShell 5.1 host that nested
  # cmd.exe inherited an EMPTY %PATH% from its parent -- so a bare `bash` call
  # there is not portable. Resolving the path once here, from this same
  # shell, removes that dependency entirely.
  if command -v cygpath >/dev/null 2>&1; then
    local bash_abs
    bash_abs="$(cygpath -w "$(command -v bash)")"
    cat > "$FAKE_BIN/kmp-test.cmd" <<CMD
@echo off
"$bash_abs" "%~dp0kmp-test" %*
CMD
  elif [[ "$WSL_WIN_PS" -eq 1 ]]; then
    # bash is a Linux ELF binary Windows can never exec, even via UNC --
    # re-enter WSL through wsl.exe (absolute path; see bash_abs above).
    local wsl_abs
    wsl_abs="$(wslpath -w "$(command -v wsl.exe)")"
    cat > "$FAKE_BIN/kmp-test.cmd" <<CMD
@echo off
"$wsl_abs" -d $WSL_DISTRO_NAME -- "$FAKE_BIN/kmp-test" %*
CMD
  fi

  echo 'rootProject.name = "test"' > "$FAKE_PROJECT/settings.gradle.kts"

  # Determine pwsh executable
  if command -v pwsh >/dev/null 2>&1; then
    PWSH="pwsh"
  else
    PWSH="powershell.exe"
  fi
  if ! "$PWSH" -NoProfile -Command "exit 0" >/dev/null 2>&1; then
    skip "PowerShell is discoverable but not executable from this Bash runtime"
  fi

  # Convert paths and choose PATH separator per OS.
  # Windows (cygpath/WSL_WIN_PS): Windows paths + ; separator.
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
  elif [[ "$WSL_WIN_PS" -eq 1 ]]; then
    WIN_SCRIPT="$(wslpath -w "$SCRIPT")"
    WIN_PROJECT="$(wslpath -w "$FAKE_PROJECT")"
    WIN_FAKE_BIN="$(wslpath -w "$FAKE_BIN")"
    PATH_SEP=";"
  fi
}

teardown() {
  rm -rf "$FAKE_BIN" "$FAKE_PROJECT" 2>/dev/null || true
}

# ── Case 1: happy path — kmp-test changed subcommand invoked; exit 0 ─────────

@test "run-changed-modules-tests.ps1: happy path invokes kmp-test changed subcommand" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ "$status" -eq 0 ]
  [ -f "$ARGS_LOG" ]
  grep -qE "^changed|changed " "$ARGS_LOG"
}

# ── Case 2: -StagedOnly flag forwarded to runner ─────────────────────────────

@test "run-changed-modules-tests.ps1: -StagedOnly forwarded to kmp-test changed" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -StagedOnly" \
    2>&1
  [ -f "$ARGS_LOG" ]
  grep -q "\-\-staged-only" "$ARGS_LOG"
}

# ── Case 3: -IncludeShared — runner invoked with --project-root for shared-kmp-libs ──

@test "run-changed-modules-tests.ps1: -IncludeShared passes --project-root for shared-kmp-libs" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -IncludeShared" \
    2>&1
  [ -f "$ARGS_LOG" ]
  grep -q "shared-kmp-libs" "$ARGS_LOG"
}

# ── Case 4: -ShowModulesOnly — maps to kmp-test changed --dry-run (Strategy B) ──

@test "run-changed-modules-tests.ps1: -ShowModulesOnly maps to kmp-test changed --dry-run" {
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$WIN_FAKE_BIN$PATH_SEP' + \$env:PATH; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT' -ShowModulesOnly" \
    2>&1
  [ -f "$ARGS_LOG" ]
  grep -q "\-\-dry-run" "$ARGS_LOG"
  grep -qE "^changed|changed " "$ARGS_LOG"
}

# ── Case 5: missing kmp-test binary — non-zero exit + error message ──────────

@test "run-changed-modules-tests.ps1: missing kmp-test exits non-zero with error" {
  local empty_dir
  empty_dir="${FAKE_PROJECT}/empty-path-$$"
  mkdir -p "$empty_dir"
  local empty_win_dir="$empty_dir"
  if command -v cygpath >/dev/null 2>&1; then
    empty_win_dir="$(cygpath -w "$empty_dir")"
  elif command -v wslpath >/dev/null 2>&1; then
    empty_win_dir="$(wslpath -w "$empty_dir")"
  fi
  run "$PWSH" -NoProfile -ExecutionPolicy Bypass \
    -Command "\$env:PATH = '$empty_win_dir'; & '$WIN_SCRIPT' -ProjectRoot '$WIN_PROJECT'" \
    2>&1
  [ "$status" -ne 0 ]
  [[ "$output" == *"kmp-test"* ]]
}
