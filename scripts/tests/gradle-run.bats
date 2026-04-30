#!/usr/bin/env bats
#
# Smoke tests for scripts/sh/gradle-run.sh — the kmp-test-runner v0.6.2 wrapper.
# Style: mirrors scripts/tests/generate-template.bats (BL-W32-06a).

SCRIPT="$BATS_TEST_DIRNAME/../sh/gradle-run.sh"
PS1_SCRIPT="$BATS_TEST_DIRNAME/../ps1/gradle-run.ps1"

setup_file() {
  if ! command -v kmp-test >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
    skip "neither kmp-test nor npx on PATH; cannot run gradle-run.bats"
  fi
}

setup() {
  mkdir -p "${BATS_TEST_TMPDIR:-/tmp}"
}

teardown() {
  rm -rf "${BATS_TEST_TMPDIR:-/tmp}/fake-kmp-test-$$" 2>/dev/null || true
}

# ── Script existence ──────────────────────────────────────────────────────────

@test "gradle-run.sh exists and is executable" {
  [ -f "$SCRIPT" ]
  [ -x "$SCRIPT" ]
}

@test "gradle-run.ps1 exists" {
  [ -f "$PS1_SCRIPT" ]
}

# ── parity: PS1 gradle-run is kmp-test-runner wrapper ─────────────────────────

@test "parity: PS1 gradle-run is kmp-test-runner wrapper" {
  grep -q "kmp-test\|kmp_test" "$PS1_SCRIPT"
}

# ── --help ────────────────────────────────────────────────────────────────────

@test "gradle-run: --help exits 0" {
  run bash "$SCRIPT" --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"kmp-test"* ]] || [[ "$output" == *"Usage"* ]]
}

# ── Error: missing kmp-test-runner ───────────────────────────────────────────

@test "gradle-run: missing kmp-test-runner prints helpful error" {
  local fake_dir="${BATS_TEST_TMPDIR:-/tmp}/fake-empty-$$"
  mkdir -p "$fake_dir"
  # Provide a PATH that has bash/env/sh but NOT kmp-test or npx.
  local bash_dir
  bash_dir="$(dirname "$(command -v bash)")"
  run env PATH="$bash_dir" bash "$SCRIPT"
  [ "$status" -eq 1 ]
  [[ "$output" == *"npm install -g kmp-test-runner"* ]]
}

# ── Deprecation warnings ──────────────────────────────────────────────────────

@test "gradle-run: --platform flag emits deprecation warning" {
  run bash "$SCRIPT" --dry-run --platform android
  [[ "$output" == *"deprecated"* ]]
}

# ── Subcommand selection ──────────────────────────────────────────────────────

@test "gradle-run: --test-type androidUnit selects android subcommand" {
  run bash "$SCRIPT" --dry-run --test-type androidUnit
  [[ "$output" == *"android"* ]]
}

# ── Flag translation ──────────────────────────────────────────────────────────

@test "gradle-run: --skip-coverage maps to --no-coverage" {
  run bash "$SCRIPT" --dry-run --skip-coverage
  [[ "$output" == *"--no-coverage"* ]]
}

@test "gradle-run: positional module maps to --module-filter" {
  run bash "$SCRIPT" --dry-run :core-network-ktor
  [[ "$output" == *"--module-filter :core-network-ktor"* ]]
}

# ── Exit code propagation ─────────────────────────────────────────────────────

@test "gradle-run: exit code propagated from kmp-test" {
  local fake_dir="${BATS_TEST_TMPDIR:-/tmp}/fake-kmp-test-$$"
  mkdir -p "$fake_dir"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$fake_dir/kmp-test"
  chmod +x "$fake_dir/kmp-test"
  run env PATH="$fake_dir:$PATH" bash "$SCRIPT" parallel
  [ "$status" -eq 1 ]
}
