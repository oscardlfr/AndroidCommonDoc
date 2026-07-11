#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/emit-pre-pr-report.sh (wave qg-artifact-binding, W3) — the QG
# mint-internal derived-artifact producer that composes pre-pr-report.json from
# already-bound/authoritative inputs (never re-runs anything heavy).
#
# Coverage map (21 tests):
#   #EPR1  PASS: all 3 inputs coherent (secret-scan PASS, registry-hash clean, no
#          violating commits) → status=PASS, all 3 checks PASS, head/generated_at
#          present, exit 0
#   #EPR2  secret-scan-report.json absent → checks.secret_scan=FAIL → status=FAIL
#   #EPR3  secret-scan-report.json status=FAIL → checks.secret_scan=FAIL → status=FAIL
#   #EPR4  registry-hash-report.json absent → checks.registry_hash_freshness=FAIL
#   #EPR5  registry-hash-report.json result=clean → registry_hash_freshness=PASS
#   #EPR6  registry-hash-report.json result=n/a → registry_hash_freshness=PASS
#          (n/a means "nothing to check", not a failure)
#   #EPR7  registry-hash-report.json result=drift → registry_hash_freshness=FAIL
#   #EPR8  commit with an invalid scope → commit_lint=FAIL + commit_lint_violations
#          names the offending subject
#   #EPR9  commit with a valid scope → commit_lint=PASS
#   #EPR10 commit with no scope prefix at all, but still conventionally formatted
#          → commit_lint=PASS (nothing to validate). Fixture subject repaired in
#          the P1 fix-round (abfe58a, real commit-lint): the old fixture text was
#          itself non-conventional prose, which the new format check now correctly
#          rejects — proving "no scope" requires a well-formed type+colon subject,
#          not just any text lacking parens.
#   #EPR11 no .commitlintrc.json at all → commit_lint=PASS regardless of any commit's
#          scope (empty valid_scopes short-circuits the scope check; the fixture
#          subject is still conventionally formatted, so format enforcement — which
#          stays active even with zero valid_scopes — does not itself fail this one)
#   #EPR12 any single managed check FAIL → overall status=FAIL (cross-check all())
#   #EPR13 evidence_digests carries sha256 for BOTH secret-scan-report.json and
#          doc-validator-report.json; doc-validator-report.json is digested-only,
#          never becomes a "checks" key (it is not a managed key)
#   #EPR14 exit code is ALWAYS 0 regardless of internal PASS/FAIL — this script
#          REPORTS, it does not gate
#   #EPR15 explicit --base-sha/--head-sha override honored verbatim (mirrors how
#          the mint invokes it, passing both already-computed values)
#
# Real commit-lint semantics (P1 fix-round, abfe58a — mirrors commit-msg-hook.sh's
# CC_PATTERN/type-enum instead of the old scope-only match):
#   #EPR16 invalid TYPE, otherwise-valid scope ("wip(core): x") → commit_lint=FAIL
#          (format check catches what scope-only matching would have missed —
#          "core" alone would have passed the OLD check)
#   #EPR17 non-conventional subject, no type/scope structure at all
#          ("just some text") → commit_lint=FAIL
#   #EPR18 well-formed subject, invalid SCOPE ("feat(bogus): x") → commit_lint=FAIL
#   #EPR19 POSITIVE CONTROL: well-formed subject, valid scope ("feat(scripts): x")
#          → commit_lint=PASS
#   #EPR20 POSITIVE CONTROL: a Merge commit subject is exempt from format/scope
#          checking entirely (fast-pass, mirrors commit-msg-hook.sh)
#   #EPR21 POSITIVE CONTROL: compound scope ("core-error-sdk") matches valid_scopes
#          via its first segment ("core") — mirrors commit-msg-hook.sh +
#          commit-scope-validation-gate.js's compound-scope handling
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# Never reads live .androidcommondoc/ or live .commitlintrc.json.

SCRIPT="$BATS_TEST_DIRNAME/../sh/emit-pre-pr-report.sh"

setup() {
  REPO="$(mktemp -d)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" commit --allow-empty --quiet -m "init"
  ACDOC="$REPO/.androidcommondoc"
  mkdir -p "$ACDOC"
}

teardown() {
  rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────

# write_secret_scan_receipt <status>
write_secret_scan_receipt() {
  local status="$1"
  printf '{"status":"%s","reason_code":"OK","tool":"trufflehog","version":"test","count":0}\n' \
    "$status" > "$ACDOC/secret-scan-report.json"
}

# write_doc_validator_receipt — minimal, coherent doc-validator receipt (only
# digested by this script, never itself a managed check).
write_doc_validator_receipt() {
  printf '{"step":"doc-validator-parity","ran":true,"result":"PASS","status":"PASS"}\n' \
    > "$ACDOC/doc-validator-report.json"
}

# write_registry_hash_receipt <result>
write_registry_hash_receipt() {
  local result="$1"
  printf '{"result":"%s"}\n' "$result" > "$ACDOC/registry-hash-report.json"
}

# write_commitlintrc <scope1> [<scope2> ...]
write_commitlintrc() {
  python3 -c "
import json, sys
print(json.dumps({'valid_scopes': sys.argv[1:]}))
" "$@" > "$REPO/.commitlintrc.json"
}

# report_field <jq-style dot-path> — reads a field from the emitted pre-pr-report.json
# (numeric path components index into a list, e.g. 'commit_lint_violations.0')
report_field() {
  python3 - "$ACDOC/pre-pr-report.json" "$1" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
val = data
for p in sys.argv[2].lstrip('.').split('.'):
    val = val[int(p)] if isinstance(val, list) else val[p]
print(val)
PYEOF
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR1 PASS: all 3 inputs coherent → status=PASS, all 3 checks PASS, head/generated_at present, exit 0" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  [ -f "$ACDOC/pre-pr-report.json" ]

  run report_field 'status'
  [ "$output" = "PASS" ]
  run report_field 'checks.secret_scan'
  [ "$output" = "PASS" ]
  run report_field 'checks.registry_hash_freshness'
  [ "$output" = "PASS" ]
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
  run report_field 'step'
  [ "$output" = "pre-pr" ]

  local head_sha
  head_sha="$(git -C "$REPO" rev-parse HEAD)"
  run report_field 'head'
  [ "$output" = "$head_sha" ]
  run report_field 'generated_at'
  [[ "$output" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR2 BLOCK-signal: secret-scan-report.json absent → checks.secret_scan=FAIL → status=FAIL" {
  # Deliberately no secret-scan-report.json written.
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.secret_scan'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR3 BLOCK-signal: secret-scan-report.json status=FAIL → checks.secret_scan=FAIL → status=FAIL" {
  write_secret_scan_receipt "FAIL"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.secret_scan'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR4 BLOCK-signal: registry-hash-report.json absent → checks.registry_hash_freshness=FAIL" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  # Deliberately no registry-hash-report.json written.

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.registry_hash_freshness'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR5 PASS-signal: registry-hash-report.json result=clean → registry_hash_freshness=PASS" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.registry_hash_freshness'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR6 PASS-signal: registry-hash-report.json result=n/a → registry_hash_freshness=PASS (nothing to check is not a failure)" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "n/a"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.registry_hash_freshness'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR7 BLOCK-signal: registry-hash-report.json result=drift → registry_hash_freshness=FAIL" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "drift"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.registry_hash_freshness'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR8 BLOCK-signal: commit with an invalid scope → commit_lint=FAIL + commit_lint_violations names it" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(badscope): introduce a violation"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
  run report_field 'commit_lint_violations.0'
  [[ "$output" == *"feat(badscope): introduce a violation"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR9 PASS-signal: commit with a valid scope → commit_lint=PASS" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): a legitimate change"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
  run report_field 'status'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR10 PASS-signal: commit with no scope prefix at all → commit_lint=PASS (nothing to validate)" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  # Repaired (P1 fix-round, abfe58a): the old fixture subject ("a plain subject
  # with no conventional-commit scope") was itself non-conventional prose — under
  # real commit-lint's format check it is now correctly a VIOLATION (invalid type),
  # not "nothing to validate". A subject that legitimately has no scope must still
  # be conventionally formatted (type + ": " + description) to exercise the
  # no-scope-present branch this test is named for.
  git -C "$REPO" commit --allow-empty --quiet -m "chore: a plain subject with no conventional-commit scope"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR11 PASS-signal: no .commitlintrc.json at all → commit_lint=PASS regardless of any commit's scope" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  # Deliberately no .commitlintrc.json — a scope that would fail if a restrictive
  # list existed must NOT be flagged when there is nothing to check against.
  git -C "$REPO" commit --allow-empty --quiet -m "feat(totally-made-up-scope): would fail if checked"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR12 status=FAIL when ANY single managed check fails, even if the other two are PASS (cross-check all())" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core"
  # ONLY commit_lint fails; secret_scan and registry_hash_freshness both PASS.
  git -C "$REPO" commit --allow-empty --quiet -m "feat(notallowed): the only failing check"

  run bash "$SCRIPT" --project-root "$REPO"
  run report_field 'checks.secret_scan'
  [ "$output" = "PASS" ]
  run report_field 'checks.registry_hash_freshness'
  [ "$output" = "PASS" ]
  run report_field 'checks.commit_lint'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR13 evidence_digests carries sha256 for both receipts; doc-validator-report.json is digested-only, never a checks key" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]

  run python3 -c "
import hashlib, json
d = json.load(open('$ACDOC/pre-pr-report.json', encoding='utf-8'))
digests = d['evidence_digests']
for rel in ('.androidcommondoc/secret-scan-report.json', '.androidcommondoc/doc-validator-report.json'):
    raw = open('$REPO/' + rel, 'rb').read().replace(b'\r\n', b'\n')
    expected = hashlib.sha256(raw).hexdigest()
    assert digests[rel] == expected, (rel, digests[rel], expected)
# doc-validator-report.json is digested for provenance only — never a managed
# 'checks' key (only secret_scan/registry_hash_freshness/commit_lint are managed).
assert set(d['checks'].keys()) == {'secret_scan', 'registry_hash_freshness', 'commit_lint'}, d['checks'].keys()
print('OK')
"
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR14 exit code is ALWAYS 0 regardless of internal PASS/FAIL — this script REPORTS, it does not gate" {
  # Every input deliberately absent/failing — status will be FAIL, but the script's
  # OWN exit code must still be 0 (the mint's own pre_pr_coverage cross-check is
  # what gates on this content, not this script's exit code).
  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR15 explicit --base-sha/--head-sha override is honored verbatim (mirrors how the mint invokes it)" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  local real_head foreign_head
  real_head="$(git -C "$REPO" rev-parse HEAD)"
  foreign_head="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"

  run bash "$SCRIPT" --project-root "$REPO" --base-sha "$real_head" --head-sha "$foreign_head"
  [ "$status" -eq 0 ]
  run report_field 'head'
  [ "$output" = "$foreign_head" ]
  [ "$output" != "$real_head" ]
}

# ═════════════════════════════════════════════════════════════════════════════
# P1 fix-round (abfe58a) — real commit-lint semantics. Mirrors commit-msg-hook.sh's
# CC_PATTERN (type restricted to a fixed enum, conventional "type(scope)?!?: desc"
# format) instead of the pre-fix scope-only match. #EPR16-18 are negatives that
# revert-one-element → red (each would have PASSED under the old scope-only check,
# proving they exercise the NEW format-validation behavior specifically, not just
# re-proving #EPR8's existing scope check). #EPR19-21 are their positive controls.
# ═════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR16 BLOCK-signal: invalid commit type (wip) with an otherwise-valid scope → commit_lint=FAIL (format enforced, not just scope)" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  # "core" alone IS in valid_scopes — the old scope-only check would have passed
  # this. Only the new type-enum/format check (CC_PATTERN) rejects "wip".
  git -C "$REPO" commit --allow-empty --quiet -m "wip(core): x"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
  run report_field 'commit_lint_violations.0'
  [[ "$output" == *"wip(core): x"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR17 BLOCK-signal: non-conventional subject with no type/scope structure at all → commit_lint=FAIL" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  git -C "$REPO" commit --allow-empty --quiet -m "just some text"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
  run report_field 'commit_lint_violations.0'
  [[ "$output" == *"just some text"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR18 BLOCK-signal: well-formed conventional subject with an invalid scope → commit_lint=FAIL" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(bogus): x"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "FAIL" ]
  run report_field 'status'
  [ "$output" = "FAIL" ]
  run report_field 'commit_lint_violations.0'
  [[ "$output" == *"feat(bogus): x"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR19 PASS-signal (positive control for #EPR16/18): well-formed conventional subject with a valid scope → commit_lint=PASS" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests" "scripts"
  git -C "$REPO" commit --allow-empty --quiet -m "feat(scripts): x"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
  run report_field 'status'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR20 PASS-signal (positive control for #EPR17): a Merge commit subject is exempt from format/scope checking (fast-pass)" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core" "tests"
  # Subject-text-only fast-pass (mirrors commit-msg-hook.sh) — does not require an
  # actual git-merge commit structurally, only a first line starting with "Merge ".
  git -C "$REPO" commit --allow-empty --quiet -m "Merge branch 'feature/foo' into develop"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
  run report_field 'status'
  [ "$output" = "PASS" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#EPR21 PASS-signal (positive control): compound scope (core-error-sdk) matches valid_scopes via its first segment (core)" {
  write_secret_scan_receipt "PASS"
  write_doc_validator_receipt
  write_registry_hash_receipt "clean"
  write_commitlintrc "core"
  git -C "$REPO" commit --allow-empty --quiet -m "fix(core-error-sdk): patch a subtle bug"

  run bash "$SCRIPT" --project-root "$REPO"
  [ "$status" -eq 0 ]
  run report_field 'checks.commit_lint'
  [ "$output" = "PASS" ]
  run report_field 'status'
  [ "$output" = "PASS" ]
}
