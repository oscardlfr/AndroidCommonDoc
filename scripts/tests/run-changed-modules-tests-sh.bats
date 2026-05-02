#!/usr/bin/env bats
#
# Bats RED tests for scripts/sh/run-changed-modules-tests.sh thin-wrap.
# test-infra: mocked — kmp-test binary shim via PATH injection.
# All cases must FAIL RED against current fat script (which delegates to
# run-parallel-coverage-suite.sh, not kmp-test changed directly).
#
# arch-testing V2 cases: 5 required.

SCRIPT="$BATS_TEST_DIRNAME/../sh/run-changed-modules-tests.sh"
SHARED_ROOT="/c/Users/34645/AndroidStudioProjects/shared-kmp-libs"

setup() {
  FAKE_BIN="${BATS_TEST_TMPDIR}/fake-bin-$$"
  FAKE_PROJECT="${BATS_TEST_TMPDIR}/fake-project-$$"
  mkdir -p "$FAKE_BIN" "$FAKE_PROJECT"

  # kmp-test shim records all args for assertion
  cat > "$FAKE_BIN/kmp-test" <<'SHIM'
#!/usr/bin/env bash
echo "$@" >> "${BATS_TEST_TMPDIR}/kmp-test-args.log"
case "$1" in
  changed)
    echo '{"tool":"kmp-test","subcommand":"changed","version":"0.7.0","project_root":"/tmp/fake","exit_code":0,"duration_ms":2000,"tests":{"total":10,"passed":10,"failed":0,"skipped":0},"modules":["core-foo"],"coverage":{"tool":"kover","missed_lines":0},"errors":[],"warnings":[],"skipped":[]}'
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
SHIM
  chmod +x "$FAKE_BIN/kmp-test"

  echo 'rootProject.name = "test"' > "$FAKE_PROJECT/settings.gradle.kts"
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR}/fake-bin-$$" \
         "${BATS_TEST_TMPDIR}/fake-project-$$" \
         "${BATS_TEST_TMPDIR}/kmp-test-args.log" 2>/dev/null || true
}

# ── Case 1: happy path — kmp-test changed subcommand invoked; exit 0 ─────────

@test "run-changed-modules-tests.sh: happy path invokes kmp-test changed subcommand" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" --project-root "$FAKE_PROJECT"
  [ "$status" -eq 0 ]
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  # Thin-wrap must call kmp-test with 'changed' subcommand directly
  grep -q "^changed\b" "${BATS_TEST_TMPDIR}/kmp-test-args.log" || \
    grep -qE "^changed " "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 2: --staged-only flag forwarded to runner ───────────────────────────

@test "run-changed-modules-tests.sh: --staged-only forwarded to kmp-test changed" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" \
    --project-root "$FAKE_PROJECT" --staged-only
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "\-\-staged-only" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 3: --include-shared — runner invoked with second --project-root ──────

@test "run-changed-modules-tests.sh: --include-shared passes --project-root for shared-kmp-libs" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" \
    --project-root "$FAKE_PROJECT" --include-shared
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  # Thin-wrap must invoke kmp-test with a second --project-root pointing to shared-kmp-libs
  # OR call kmp-test twice (once per root). Either way, shared-kmp-libs path must appear.
  grep -q "shared-kmp-libs" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 4: --show-modules-only / --dry-run — kmp-test changed --dry-run; no test output ──

@test "run-changed-modules-tests.sh: --show-modules-only maps to kmp-test changed --dry-run" {
  run env PATH="$FAKE_BIN:$PATH" bash "$SCRIPT" \
    --project-root "$FAKE_PROJECT" --show-modules-only
  [ -f "${BATS_TEST_TMPDIR}/kmp-test-args.log" ]
  grep -q "\-\-dry-run" "${BATS_TEST_TMPDIR}/kmp-test-args.log"
  # Subcommand must be 'changed'
  grep -qE "^changed|changed " "${BATS_TEST_TMPDIR}/kmp-test-args.log"
}

# ── Case 5: missing kmp-test binary — non-zero exit + error message ──────────

@test "run-changed-modules-tests.sh: missing kmp-test exits non-zero with error" {
  local empty_dir="${BATS_TEST_TMPDIR}/empty-path-$$"
  mkdir -p "$empty_dir"
  local bash_dir
  bash_dir="$(dirname "$(command -v bash)")"
  run env PATH="$bash_dir:$empty_dir" bash "$SCRIPT" --project-root "$FAKE_PROJECT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"kmp-test"* ]]
}
