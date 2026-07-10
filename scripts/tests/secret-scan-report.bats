#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/secret-scan-report.sh — fail-closed secret scanner producer.
#
# Coverage:
#   #SS-1: present + 0 findings → PASS / OK / exit 0
#   #SS-2: absent everywhere    → FAIL / SCANNER_UNAVAILABLE / exit 1 (no PASS / SKIPPED)
#   #SS-3: present + non-zero   → FAIL / SCANNER_ERROR / exit 1
#   #SS-4: present + ≥1 finding → FAIL / SECRETS_FOUND / exit 1
#   #SS-5: local-bin fallback   → resolves $HOME/.local/bin/trufflehog → PASS
#   #SS-6: TRUFFLEHOG_BIN env   → honored over PATH
#   #SS-7: twin-drift guard     → both quality-gater.md twins identical + wiring strings
#
# Isolation: every test uses a fresh tmpdir for HOME, PATH, and TRUFFLEHOG_BIN.

SCRIPT="$BATS_TEST_DIRNAME/../sh/secret-scan-report.sh"
REPO_ROOT="$BATS_TEST_DIRNAME/../.."

setup() {
  WORK="$(mktemp -d)"
  # Isolated output dir: secret-scan-report.sh writes .androidcommondoc/ relative to cwd
  SCAN_DIR="$(mktemp -d)"
  # wave qg-artifact-binding (W2): secret-scan-report.sh now stamps head/generated_at
  # into every payload site (envelope normalization, so the QG mint's generic
  # artifact-binding loop can HEAD/freshness-bind this receipt). git-init SCAN_DIR so
  # `head` resolves to a REAL sha (not the script's "unknown" fallback) — proves the
  # field is genuinely HEAD-bound, not a static placeholder.
  git -C "$SCAN_DIR" init --quiet
  git -C "$SCAN_DIR" config user.email "test@test.com"
  git -C "$SCAN_DIR" config user.name "Test"
  git -C "$SCAN_DIR" commit --allow-empty --quiet -m "init"
  SCAN_HEAD="$(git -C "$SCAN_DIR" rev-parse HEAD)"
}

teardown() {
  rm -rf "$WORK" "$SCAN_DIR"
}

# ── Mock factory ──────────────────────────────────────────────────────────────
# make_mock_trufflehog BIN_PATH VERSION_OUTPUT SCAN_RC SCAN_OUTPUT
#   Creates a mock trufflehog script at BIN_PATH.
#   VERSION_OUTPUT: printed on --version
#   SCAN_RC:        exit code for filesystem ... invocations
#   SCAN_OUTPUT:    stdout emitted during filesystem scan (JSONL findings; empty=0 findings)
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

# ── #SS-1: present + 0 findings → PASS ───────────────────────────────────────
@test "#SS-1 PASS: scanner present, 0 findings → status:PASS reason_code:OK exit 0" {
  local mock_bin="$WORK/bin/trufflehog"
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "0" ""

  run bash -c "
    export TRUFFLEHOG_BIN='$mock_bin'
    cd '$SCAN_DIR'
    bash '$SCRIPT' .
  "
  [ "$status" -eq 0 ]

  local report="$SCAN_DIR/.androidcommondoc/secret-scan-report.json"
  [ -f "$report" ]

  # status must be PASS
  local status_val
  status_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['status'])" "$report")"
  [ "$status_val" = "PASS" ]

  # reason_code must be OK
  local rc_val
  rc_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['reason_code'])" "$report")"
  [ "$rc_val" = "OK" ]

  # count must be 0
  local count_val
  count_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['count'])" "$report")"
  [ "$count_val" = "0" ]

  # tool must be the mock basename
  local tool_val
  tool_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['tool'])" "$report")"
  [ "$tool_val" = "trufflehog" ]

  # wave qg-artifact-binding (W2): the PASS payload site (:112 as of this wave) must
  # carry head (bound to SCAN_DIR's real commit, not "unknown") and a parseable
  # generated_at — these are what the QG mint's generic artifact-binding loop reads.
  local head_val
  head_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('head',''))" "$report")"
  [ "$head_val" = "$SCAN_HEAD" ]
  local generated_at_val
  generated_at_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('generated_at',''))" "$report")"
  [[ "$generated_at_val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ── #SS-2: absent everywhere → SCANNER_UNAVAILABLE ───────────────────────────
@test "#SS-2 FAIL: no scanner anywhere → status:FAIL reason_code:SCANNER_UNAVAILABLE exit 1" {
  # Isolated HOME with empty .local/bin; stripped PATH; TRUFFLEHOG_BIN unset
  local fake_home="$WORK/home"
  mkdir -p "$fake_home/.local/bin"

  run bash -c "
    export HOME='$fake_home'
    export PATH='/usr/bin:/bin'
    unset TRUFFLEHOG_BIN
    cd '$SCAN_DIR'
    bash '$SCRIPT' .
  "
  [ "$status" -eq 1 ]

  local report="$SCAN_DIR/.androidcommondoc/secret-scan-report.json"
  [ -f "$report" ]

  local report_text
  report_text="$(cat "$report")"

  # Must not contain PASS
  [[ "$report_text" != *'"PASS"'* ]]
  # Must not contain SKIPPED
  [[ "$report_text" != *'"SKIPPED"'* ]]

  local status_val
  status_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['status'])" "$report")"
  [ "$status_val" = "FAIL" ]

  local rc_val
  rc_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['reason_code'])" "$report")"
  [ "$rc_val" = "SCANNER_UNAVAILABLE" ]

  # wave qg-artifact-binding (W2): the SCANNER_UNAVAILABLE payload site (:68 as of this
  # wave) must ALSO carry head/generated_at — envelope normalization is additive on
  # every write-site, not just the PASS path.
  local head_val
  head_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('head',''))" "$report")"
  [ "$head_val" = "$SCAN_HEAD" ]
  local generated_at_val
  generated_at_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('generated_at',''))" "$report")"
  [[ "$generated_at_val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ── #SS-3: present + non-zero exit → SCANNER_ERROR ───────────────────────────
@test "#SS-3 FAIL: scanner exits non-zero → status:FAIL reason_code:SCANNER_ERROR exit 1" {
  local mock_bin="$WORK/bin/trufflehog"
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "1" ""

  run bash -c "
    export TRUFFLEHOG_BIN='$mock_bin'
    cd '$SCAN_DIR'
    bash '$SCRIPT' .
  "
  [ "$status" -eq 1 ]

  local report="$SCAN_DIR/.androidcommondoc/secret-scan-report.json"
  [ -f "$report" ]

  local status_val
  status_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['status'])" "$report")"
  [ "$status_val" = "FAIL" ]

  local rc_val
  rc_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['reason_code'])" "$report")"
  [ "$rc_val" = "SCANNER_ERROR" ]

  # wave qg-artifact-binding (W2): the SCANNER_ERROR payload site (:101 as of this wave)
  # must ALSO carry head/generated_at.
  local head_val
  head_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('head',''))" "$report")"
  [ "$head_val" = "$SCAN_HEAD" ]
  local generated_at_val
  generated_at_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('generated_at',''))" "$report")"
  [[ "$generated_at_val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ── #SS-4: present + ≥1 JSONL finding → SECRETS_FOUND ───────────────────────
@test "#SS-4 FAIL: scanner emits ≥1 finding JSONL line → status:FAIL reason_code:SECRETS_FOUND count≥1 exit 1" {
  local mock_bin="$WORK/bin/trufflehog"
  # One non-empty JSONL line counts as one finding
  local finding_line='{"DetectorName":"TestDetector","Raw":"fake-secret","Verified":true}'
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "0" "$finding_line"

  run bash -c "
    export TRUFFLEHOG_BIN='$mock_bin'
    cd '$SCAN_DIR'
    bash '$SCRIPT' .
  "
  [ "$status" -eq 1 ]

  local report="$SCAN_DIR/.androidcommondoc/secret-scan-report.json"
  [ -f "$report" ]

  local status_val
  status_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['status'])" "$report")"
  [ "$status_val" = "FAIL" ]

  local rc_val
  rc_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['reason_code'])" "$report")"
  [ "$rc_val" = "SECRETS_FOUND" ]

  local count_val
  count_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['count'])" "$report")"
  [ "$count_val" -ge 1 ]

  # wave qg-artifact-binding (W2): the SECRETS_FOUND payload site (:117 as of this
  # wave) must ALSO carry head/generated_at.
  local head_val
  head_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('head',''))" "$report")"
  [ "$head_val" = "$SCAN_HEAD" ]
  local generated_at_val
  generated_at_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r.get('generated_at',''))" "$report")"
  [[ "$generated_at_val" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ── #SS-5: local-bin fallback ─────────────────────────────────────────────────
@test "#SS-5 PASS: trufflehog NOT on PATH but at \$HOME/.local/bin/trufflehog → resolves + PASS" {
  local fake_home="$WORK/home"
  local local_bin="$fake_home/.local/bin"
  mkdir -p "$local_bin"
  local mock_bin="$local_bin/trufflehog"
  make_mock_trufflehog "$mock_bin" "trufflehog 3.82.0" "0" ""

  run bash -c "
    export HOME='$fake_home'
    export PATH='/usr/bin:/bin'
    unset TRUFFLEHOG_BIN
    cd '$SCAN_DIR'
    bash '$SCRIPT' .
  "
  [ "$status" -eq 0 ]

  local report="$SCAN_DIR/.androidcommondoc/secret-scan-report.json"
  [ -f "$report" ]

  local status_val
  status_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['status'])" "$report")"
  [ "$status_val" = "PASS" ]
}

# ── #SS-6: TRUFFLEHOG_BIN honored over PATH ───────────────────────────────────
@test "#SS-6 PASS: \$TRUFFLEHOG_BIN set → used even when a different trufflehog on PATH" {
  # PATH mock returns SCANNER_ERROR; TRUFFLEHOG_BIN mock returns PASS
  local path_mock="$WORK/path_bin/trufflehog"
  make_mock_trufflehog "$path_mock" "trufflehog-path 3.0.0" "2" ""

  local env_mock="$WORK/env_bin/trufflehog"
  make_mock_trufflehog "$env_mock" "trufflehog-env 3.82.0" "0" ""

  run bash -c "
    export TRUFFLEHOG_BIN='$env_mock'
    export PATH='$WORK/path_bin:/usr/bin:/bin'
    cd '$SCAN_DIR'
    bash '$SCRIPT' .
  "
  [ "$status" -eq 0 ]

  local report="$SCAN_DIR/.androidcommondoc/secret-scan-report.json"
  [ -f "$report" ]

  local status_val
  status_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['status'])" "$report")"
  [ "$status_val" = "PASS" ]

  # Confirm the env mock was used (its version string should appear in report)
  local ver_val
  ver_val="$(python3 -c "import json,sys; r=json.load(open(sys.argv[1])); print(r['version'])" "$report")"
  [[ "$ver_val" == *"trufflehog-env"* ]]
}

# ── #SS-7: static wiring contract — both quality-gater.md twins identical ─────
@test "#SS-7 TWIN WIRING: both quality-gater.md twins contain required strings and are identical" {
  # Twin paths relative to repo root (not agent templates — doc-updater owns them)
  local twin_a="$REPO_ROOT/setup/agent-templates/quality-gater.md"
  local twin_b="$REPO_ROOT/.claude/agents/quality-gater.md"

  # Both twins must exist
  [ -f "$twin_a" ] || skip "setup/agent-templates/quality-gater.md not found"
  [ -f "$twin_b" ] || skip ".claude/agents/quality-gater.md not found"

  # Each twin must contain the wiring strings that prove secret-scan-report.sh
  # is the authoritative scanner producer referenced in the quality-gater protocol.
  for twin in "$twin_a" "$twin_b"; do
    grep -q "secret-scan-report.sh" "$twin" \
      || { echo "MISSING: 'secret-scan-report.sh' in $twin" >&2; return 1; }
    grep -q "do NOT proceed to Step 10" "$twin" \
      || { echo "MISSING: 'do NOT proceed to Step 10' in $twin" >&2; return 1; }
    grep -q "Step S: Secret Scan" "$twin" \
      || { echo "MISSING: 'Step S: Secret Scan' in $twin" >&2; return 1; }
  done

  # Twins must be byte-identical (no drift)
  diff "$twin_a" "$twin_b" \
    || { echo "TWIN DRIFT: $twin_a and $twin_b differ" >&2; return 1; }
}
