#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/scan-secrets.sh — Fix 2 exact contract.
#
# scan-secrets.sh contract (PATH-only scanner resolution):
#   present + error   (RC≠0) → stdout {"status":"FAIL","reason_code":"SCANNER_ERROR"} + exit 1
#   absent            (no trufflehog on PATH) → {"status":"SKIPPED",...} + exit 0
#   present + clean   (RC=0, empty out) → {"status":"PASS","reason_code":"OK"} + exit 0
#   present + findings (RC=0, JSONL out) → JSONL emitted to stdout + exit 0
#
# IMPORTANT: scan-secrets.sh resolves via PATH only (no $TRUFFLEHOG_BIN support).
# Mock injection is done exclusively via PATH manipulation.
#
# Coverage:
#   SSS-1: present + error (RC=1) → exit≠0 AND "FAIL" AND "SCANNER_ERROR" (ALL THREE)
#   SSS-2: absent (no trufflehog on PATH) → "SKIPPED" + exit 0
#   SSS-3: present + 0 findings (RC=0, empty) → "PASS" + "OK" + exit 0
#   SSS-4: present + findings (RC=0, JSONL) → exit 0 + JSONL in stdout
#
# Mock factory reused from secret-scan-report.bats.
# Isolation: every test uses a fresh tmpdir; PATH stripped to minimal safe set.

SCRIPT="$BATS_TEST_DIRNAME/../sh/scan-secrets.sh"

setup() {
  WORK="$(mktemp -d)"
}

teardown() {
  rm -rf "$WORK"
}

# ── Mock factory (same signature as secret-scan-report.bats) ─────────────────
# make_mock_trufflehog BIN_PATH VERSION_OUTPUT SCAN_RC SCAN_OUTPUT
#   Creates a mock trufflehog binary at BIN_PATH.
#   VERSION_OUTPUT: printed on --version
#   SCAN_RC:        exit code for filesystem ... invocations
#   SCAN_OUTPUT:    stdout emitted during filesystem scan (empty = 0 findings)
make_mock_trufflehog() {
  local bin_path="$1"
  local ver_out="$2"
  local scan_rc="$3"
  local scan_out="$4"
  mkdir -p "$(dirname "$bin_path")"
  cat > "$bin_path" <<MOCKEOF
#!/usr/bin/env sh
if [ "\$1" = "--version" ]; then
  printf '%s\n' '${ver_out}'
  exit 0
fi
# filesystem sub-command
printf '%s' '${scan_out}'
exit ${scan_rc}
MOCKEOF
  chmod +x "$bin_path"
}

# ─────────────────────────────────────────────────────────────────────────────
# SSS-1  present + error (mock RC=1) → exit≠0 AND "FAIL" AND "SCANNER_ERROR"
#
# All THREE assertions are required — "non-PASS" looseness is explicitly rejected.
# This covers the fail-closed contract: scanner error must never silently pass.
# ─────────────────────────────────────────────────────────────────────────────
@test "SSS-1 FAIL: present+error (RC=1) → exit≠0 AND status:FAIL AND reason_code:SCANNER_ERROR" {
  local mock_bin="$WORK/bin/trufflehog"
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "1" ""

  run bash -c "
    export PATH='$WORK/bin:/usr/bin:/bin'
    bash '$SCRIPT' '$WORK'
  "

  # 1. Exit must be non-zero (scanner error → exit 1)
  [ "$status" -ne 0 ]

  # 2. stdout must contain "FAIL" exactly (JSON field value)
  [[ "$output" == *'"status":"FAIL"'* ]] || [[ "$output" == *'"status": "FAIL"'* ]]

  # 3. stdout must contain "SCANNER_ERROR" exactly
  [[ "$output" == *'"reason_code":"SCANNER_ERROR"'* ]] || [[ "$output" == *'"reason_code": "SCANNER_ERROR"'* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# SSS-2  absent (no trufflehog on PATH) → "SKIPPED" + exit 0
#
# Uses an isolated PATH with no trufflehog binary to trigger the absent branch.
# ─────────────────────────────────────────────────────────────────────────────
@test "SSS-2 SKIP: absent (no trufflehog on PATH) → status:SKIPPED + exit 0" {
  # Isolated PATH with a known-empty bin dir (no trufflehog)
  local empty_bin="$WORK/empty_bin"
  mkdir -p "$empty_bin"

  run bash -c "
    export PATH='$empty_bin:/usr/bin:/bin'
    bash '$SCRIPT' '$WORK'
  "

  # Exit must be 0 (SKIPPED is not an error)
  [ "$status" -eq 0 ]

  # stdout must contain "SKIPPED"
  [[ "$output" == *'"status":"SKIPPED"'* ]] || [[ "$output" == *'"status": "SKIPPED"'* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# SSS-3  present + 0 findings (mock RC=0, empty output) → "PASS" + "OK" + exit 0
#
# The scan-secrets.sh contract: bare empty stdout → explicit PASS sentinel.
# Tests that the scanner emitting nothing is NOT treated as an error.
# ─────────────────────────────────────────────────────────────────────────────
@test "SSS-3 PASS: present+clean (RC=0, empty out) → status:PASS + reason_code:OK + exit 0" {
  local mock_bin="$WORK/bin/trufflehog"
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "0" ""

  run bash -c "
    export PATH='$WORK/bin:/usr/bin:/bin'
    bash '$SCRIPT' '$WORK'
  "

  # Exit must be 0
  [ "$status" -eq 0 ]

  # stdout must contain "PASS"
  [[ "$output" == *'"status":"PASS"'* ]] || [[ "$output" == *'"status": "PASS"'* ]]

  # stdout must contain "OK" reason_code
  [[ "$output" == *'"reason_code":"OK"'* ]] || [[ "$output" == *'"reason_code": "OK"'* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# SSS-4  present + findings (mock RC=0, JSONL output) → exit 0 + JSONL emitted
#
# When trufflehog finds secrets (RC=0, non-empty JSONL) the script must:
#   - exit 0 (findings processing is the TypeScript layer's job)
#   - emit the JSONL to stdout (NOT swallow it)
# ─────────────────────────────────────────────────────────────────────────────
@test "SSS-4 FINDINGS: present+JSONL (RC=0) → exit 0 + JSONL in stdout (not swallowed)" {
  local finding='{"DetectorName":"TestDetector","Raw":"fake-secret","Verified":true}'
  local mock_bin="$WORK/bin/trufflehog"
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "0" "$finding"

  run bash -c "
    export PATH='$WORK/bin:/usr/bin:/bin'
    bash '$SCRIPT' '$WORK'
  "

  # Exit must be 0 (findings → TypeScript layer decides severity)
  [ "$status" -eq 0 ]

  # JSONL must be present in stdout — not swallowed
  [[ "$output" == *"DetectorName"* ]]
  [[ "$output" == *"fake-secret"* ]]
}
