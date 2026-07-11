#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/emit-push-proof.sh run-qg subcommand — D-7 wave_plan_present
# predicate enforcement (BL-W47 ex-PR4).
#
# Coverage map (6 tests):
#   #WP1: predicate TRUE → path-manifest-audit SKIP → inconsistent-skip (exit 2)
#   #WP2: predicate FALSE → path-manifest-audit SKIP+reason → PASS (exit 0)
#   #WP3: predicate TRUE → path-manifest-audit absent → step-coverage-gap (exit 2)
#   #WP4: predicate TRUE → path-manifest-audit PASS → valid (exit 0)
#   #WP5: invalid slug (../evil) → predicate returns FALSE → SKIP+reason → PASS (exit 0)
#   #WP6: manifest digest consistency after regen
#
# TDD: tests #WP1–#WP5 are RED until toolkit lands Part A (wave_plan_present predicate
# + slug-threading in emit-push-proof.sh). #WP6 may pass immediately if manifest digest
# is already stable.
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# Mirrors fixture pattern from test-push-proof-gate.bats.
#
# Wave A additions (Section A4 evidence binding): #EP-ENUM, #EP-DUP, #EP-UNK, #EP-UNK+,
# #EP-EV3-6/EV7/EV8/EV9a-b/EV10a-b, #EP-BESPOKE. Die-code-to-test mapping renumbered
# mid-wave (canonical, per team-lead's post-16ae614 confirmation): #EP-EV3=targeted-scope
# (test-suite-evidence-partial), #EP-EV4=foreign-HEAD (test-suite-evidence-absent),
# #EP-EV7=generated_at<started_at (test-suite-evidence-stale) — commit 16ae614 split
# bats-handoff.sh's Pass 3 into freshness-then-scope sub-passes mid-wave, making
# test-suite-evidence-stale reachable and changing #EP-EV3's expected die-code from
# -absent to -partial. See each test's own header comment for details.

EMITTER="$BATS_TEST_DIRNAME/../sh/emit-push-proof.sh"
MANIFEST_SRC="$BATS_TEST_DIRNAME/../../quality-gate-manifest.json"
SCRIPTS_SRC="$BATS_TEST_DIRNAME/.."

setup() {
  REPO="$(mktemp -d)"
  git init "$REPO" --quiet
  git -C "$REPO" config user.email "test@test.com"
  git -C "$REPO" config user.name "Test"
  git -C "$REPO" config core.autocrlf false
  git -C "$REPO" commit --allow-empty --quiet -m "feat(core): init"
  git -C "$REPO" checkout -b feature/test-wp --quiet
  ACDOC="$REPO/.androidcommondoc"
  mkdir -p "$ACDOC"

  # .gitignore: hide .androidcommondoc/ and .planning/wave*/ from git status
  # (required by the new clean-tree assertion in run-qg).
  printf '.androidcommondoc/\n.planning/wave*/\n' > "$REPO/.gitignore"
  # Note: emit-push-proof.bats has no resolver_stub helper, so no .test-req-roles
  # or resolve-required-roles.js overrides to ignore here.

  # Copy live manifest into isolated repo (needed by emitter's manifest-drift check)
  cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

  # Mirror scripts/sh/ into isolated repo so the emitter can find lib/ dependencies
  # at $REPO_ROOT/scripts/sh/ (mirrors real deployment).
  # Also copy qg-registry-integrity.sh + rehash-registry.sh (called by the new
  # committed-tree integrity block in run-qg).
  # wave qg-artifact-binding: run-qg now ALSO invokes emit-rule-inventory.sh and
  # emit-pre-pr-report.sh, mint-internal, strictly after the registry re-run.
  mkdir -p "$REPO/scripts/sh/lib"
  cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"           "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh"        "$REPO/scripts/sh/lib/"
  cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"           "$REPO/scripts/sh/lib/"
  cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"      "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/rehash-registry.sh"            "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/emit-rule-inventory.sh"        "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/emit-pre-pr-report.sh"         "$REPO/scripts/sh/"

  # H1 (push-authority-bootstrap): do NOT copy install-git-hooks.sh into the
  # fixture — its own SCRIPT_DIR-relative transitive deps (pre-commit-hook.sh,
  # lib/wave-slug.sh, commit-msg-hook.sh) are not staged here, so a copied
  # installer would abort under set -euo pipefail before ever reaching the
  # pre-push-hook cp, silently defeating this setup() edit for every test in
  # this file. Instead: copy pre-push-hook.sh (the canonical source
  # verify-git-hooks.sh's hook-drifted check compares against) and
  # verify-git-hooks.sh itself (the sibling script emit-push-proof.sh's new
  # Part-4 precondition invokes) into $REPO/scripts/sh/, then invoke the REAL
  # installer from $SCRIPTS_SRC against the isolated $REPO. This installs a
  # canonical, byte-identical pre-push hook into $REPO/.git/hooks/ — invisible
  # to `git status`, so it cannot trip the clean-tree assertion below — which
  # is what keeps every existing PASS-mint test in this file green under the
  # new hook-binding precondition.
  cp "$SCRIPTS_SRC/sh/pre-push-hook.sh"              "$REPO/scripts/sh/"
  cp "$SCRIPTS_SRC/sh/verify-git-hooks.sh"           "$REPO/scripts/sh/"
  bash "$SCRIPTS_SRC/sh/install-git-hooks.sh" "$REPO"

  # Commit ALL fixtures so the tree is CLEAN before run-qg.
  # Temp repos have NO skills/ directory → run-qg does NOT pass --require-registry
  # → registry-integrity step returns n/a → only the clean-tree assertion needs satisfying.
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): initial fixture commit"

  # RE-CAPTURE HEAD_SHA AFTER the fixture commit (architect-flagged highest-prob bug:
  # HEAD-binding in write-verdict verify-final uses the live HEAD).
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
}

teardown() {
  rm -rf "$REPO"
}

# ── Fixture writers ───────────────────────────────────────────────────────────

# write_valid_bats_handoff — writes a well-formed, full-scope, HEAD-bound bats handoff
# into $ACDOC (Wave A: run-qg's test-suite-evidence-* check requires real evidence
# behind any claimed "test-suite": PASS step). HEAD is re-derived from git at call time
# (never a cached shell variable) so this stays correct even for tests that commit
# further after setup(). generated_at is captured after the caller's own started_at
# timestamp, satisfying select_bats_handoff's --since floor (real wall-clock ordering
# only moves forward within one test).
write_valid_bats_handoff() {
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  local generated_at
  generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local run_id="wave-a-fixture-$$-${RANDOM}"
  mkdir -p "$ACDOC"
  {
    printf 'BATS_OK=%s\n'           "42"
    printf 'BATS_NOT_OK=%s\n'       "0"
    printf 'BATS_EXPECTED=%s\n'     "42"
    printf 'BATS_TOTAL=%s\n'        "42"
    printf 'BATS_COMPLETE=%s\n'     "true"
    printf 'BATS_VERDICT=%s\n'      "pass"
    printf 'BATS_LOG=%s\n'          "/dev/null"
    printf 'BATS_HEAD=%s\n'         "$head"
    printf 'BATS_RUN_ID=%s\n'       "$run_id"
    printf 'BATS_GENERATED_AT=%s\n' "$generated_at"
    printf 'BATS_SCOPE=%s\n'        "full"
  } > "$ACDOC/bats-result.${run_id}.env"
}

# write_custom_bats_handoff <head> <generated_at> <ok> <not_ok> <expected> <complete>
#                           <verdict> <scope> [<run_id>]
# Full control for evidence-check tests (#EP-EV*) — unlike write_valid_bats_handoff
# (always golden), lets a caller construct a specific invalid/edge-case handoff.
write_custom_bats_handoff() {
  local head="$1" generated_at="$2" ok="$3" not_ok="$4" expected="$5"
  local complete="$6" verdict="$7" scope="$8" run_id="${9:-custom-$$-${RANDOM}}"
  local total=$(( ok + not_ok ))
  mkdir -p "$ACDOC"
  {
    printf 'BATS_OK=%s\n'           "$ok"
    printf 'BATS_NOT_OK=%s\n'       "$not_ok"
    printf 'BATS_EXPECTED=%s\n'     "$expected"
    printf 'BATS_TOTAL=%s\n'        "$total"
    printf 'BATS_COMPLETE=%s\n'     "$complete"
    printf 'BATS_VERDICT=%s\n'      "$verdict"
    printf 'BATS_LOG=%s\n'          "/dev/null"
    printf 'BATS_HEAD=%s\n'         "$head"
    printf 'BATS_RUN_ID=%s\n'       "$run_id"
    printf 'BATS_GENERATED_AT=%s\n' "$generated_at"
    printf 'BATS_SCOPE=%s\n'        "$scope"
  } > "$ACDOC/bats-result.${run_id}.env"
}

# clear_handoffs — removes every handoff written so far (including the default golden
# one write_quality_gate_report's own write_valid_bats_handoff call leaves behind), so
# an evidence test starts from a clean slate before writing its own specific fixture.
clear_handoffs() {
  rm -f "$ACDOC"/bats-result.*.env 2>/dev/null || true
}

# write_valid_artifact_receipts — writes HEAD-bound, fresh, status:PASS
# secret-scan-report.json + doc-validator-report.json into $ACDOC (wave
# qg-artifact-binding, W1). These are the ONLY two required_steps[] entries the
# generic artifact-binding loop binds (registry-hash and pre-pr are both
# mint_rederived, excluded structurally — see #LOOP-ORDER below) — every
# run-qg-to-PASS fixture in this file must stage both, else run-qg dies
# artifact-binding-absent before ever reaching the caller's own intended outcome.
# HEAD is re-derived fresh from git at call time (never a cached shell variable,
# mirroring write_valid_bats_handoff's own established pattern); generated_at is
# captured "now" (after the caller's own started_at), satisfying the loop's
# freshness window.
write_valid_artifact_receipts() {
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  local generated_at
  generated_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  mkdir -p "$ACDOC"
  printf '{"status":"PASS","reason_code":"OK","tool":"trufflehog","version":"test","count":0,"head":"%s","generated_at":"%s"}\n' \
    "$head" "$generated_at" > "$ACDOC/secret-scan-report.json"
  printf '{"step":"doc-validator-parity","ran":true,"result":"PASS","status":"PASS","head":"%s","generated_at":"%s","summary":"test fixture"}\n' \
    "$head" "$generated_at" > "$ACDOC/doc-validator-report.json"
}

# override_artifact_receipt_field <file_basename> <field> <json_value>
# Mutates a single field inside a staged artifact receipt (secret-scan-report.json or
# doc-validator-report.json) in place — used by #AB-HEAD/#AB-STALE/#AB-STATUS to
# construct a specific invalid/edge-case receipt on top of the golden default
# write_valid_artifact_receipts writes. Mirrors override_report_started_at's
# established pattern in this same file (never silently patch away the field a
# test's own name says it tests).
override_artifact_receipt_field() {
  local file_basename="$1" field="$2" value_json="$3"
  python3 - "$ACDOC/$file_basename" "$field" "$value_json" <<'PYEOF'
import json, sys
path, field, value_json = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, encoding='utf-8') as f:
    r = json.load(f)
r[field] = json.loads(value_json)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2)
    f.write('\n')
PYEOF
}

# recompute_and_repaste_digest <manifest_path>
# Recomputes protocol_digest via the SAME canonical algorithm as
# scripts/sh/lib/manifest-digest.sh's canonical_digest() and overwrites the
# manifest's protocol_digest field in place. Any fixture mutating
# required_steps[]/conditional_steps[] (e.g. #MED-NEG below) MUST call this, else
# manifest-drift (an earlier, unrelated check) fires first and masks the die-code
# actually under test (R6 trap).
recompute_and_repaste_digest() {
  local manifest_path="$1"
  python3 - "$manifest_path" <<'PYEOF'
import hashlib, json, sys
path = sys.argv[1]
m = json.load(open(path, encoding='utf-8'))
req  = json.dumps(m['required_steps'],   sort_keys=True, separators=(',', ':'))
cond = json.dumps(m['conditional_steps'], sort_keys=True, separators=(',', ':'))
combined = (req + cond).encode('utf-8').replace(b'\r\n', b'\n')
m['protocol_digest'] = hashlib.sha256(combined).hexdigest()
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, indent=2)
    f.write('\n')
PYEOF
}

# write_rule_sources — creates minimal REAL rule-inventory sources inside $REPO
# (docs/guides/project-constraints.md with 2 "## " headers, .commitlintrc.json with
# valid_scopes) so emit-rule-inventory.sh generates a non-empty inventory with
# predictable ids: pc:rule-one, pc:rule-two, commitlint:valid-scopes. Commits them
# immediately (else the clean-tree assertion at step 4A sees untracked files) and
# leaves HEAD advanced — callers must derive HEAD/write verdicts/report AFTER this.
write_rule_sources() {
  mkdir -p "$REPO/docs/guides"
  printf '%s\n' \
    '# Project Constraints' \
    '' \
    '## Rule One' \
    'Do the first thing.' \
    '' \
    '## Rule Two' \
    'Do the second thing.' \
    > "$REPO/docs/guides/project-constraints.md"
  # "fixtures" is in valid_scopes because this file's own fixture-commit convention
  # (e.g. "test(fixtures): add rule sources", committed right below) uses that scope —
  # a REAL .commitlintrc.json now exists in $REPO, so emit-pre-pr-report.sh's own
  # commit_lint check runs for real over base..head and must not spuriously FAIL
  # against this fixture's own commit history (that would be an accidental
  # cross-interaction with the UNRELATED W4 managed-key contract, not this section's
  # subject).
  printf '%s\n' '{"valid_scopes": ["core", "tests", "fixtures"]}' > "$REPO/.commitlintrc.json"
  git -C "$REPO" add -A
  git -C "$REPO" commit --quiet -m "test(fixtures): add rule sources"
  # Re-capture HEAD_SHA (no `local` — deliberately updates the caller's variable, same
  # pattern as #CI1's re-capture in qg-committed-integrity.bats): write_arch_verdicts's
  # default head argument is "${2:-$HEAD_SHA}", so callers relying on that default
  # (rather than passing HEAD explicitly) must see the POST-commit sha, not setup()'s
  # stale one — else verdict-head-binding fires before rule-coverage-gap is ever reached.
  HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
}

# override_report_started_at <new_value_or_empty>
# Patches quality-gate-report.json's started_at field directly — removes it entirely
# when new_value is the empty string. Used by #EP-EV7/8/9.
override_report_started_at() {
  local new_val="$1"
  python3 - "$ACDOC/quality-gate-report.json" "$new_val" <<'PYEOF'
import json, sys
path, new_val = sys.argv[1], sys.argv[2]
r = json.load(open(path, encoding='utf-8'))
if new_val == "":
    r.pop('started_at', None)
else:
    r['started_at'] = new_val
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
}

# write_quality_gate_report — writes a valid .androidcommondoc/quality-gate-report.json
# $1=extra_steps_json (default "") — JSON list of step objects to merge/replace
# $2=override_deliberation_json (default "") — JSON object to override deliberation block
# $3=head_override (default "") — see below
#
# Wave A: also stamps report.started_at and writes a matching valid bats handoff (via
# write_valid_bats_handoff) BY DEFAULT — every caller of this helper builds a report
# whose test-suite step defaults to PASS, so run-qg's report-started-at-* and
# test-suite-evidence-* checks now fire unconditionally, before any of this helper's
# callers' own intended die-code is ever reached.
#
# report.head ($3): defaults to a freshly-derived current HEAD (never a cached shell
# variable, mirroring write_valid_bats_handoff's own established pattern) — but
# #EP-HEADMISMATCH/#EP-HEADABSENT exist SPECIFICALLY to exercise report.head itself, and
# auto-binding it correctly here would make them vacuous (same lesson as #QR10/11a/11b/12:
# a shared helper must never silently overwrite the field a test's own name says it tests).
# Pass a specific 40-hex value to force report-head-mismatch, or "__OMIT__" to delete the
# key entirely (report-head-absent) — never patch this default away from tests that own it.
write_quality_gate_report() {
  local extra_steps="${1:-}"
  local override_deliberation="${2:-}"
  local head_override="${3:-}"
  local started_at
  started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local report_head
  if [[ "$head_override" == "__OMIT__" ]]; then
    report_head=""
  elif [[ -n "$head_override" ]]; then
    report_head="$head_override"
  else
    report_head="$(git -C "$REPO" rev-parse HEAD)"
  fi
  python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" \
      "${extra_steps}" "${override_deliberation}" "$started_at" "$report_head" <<'PYEOF'
import json, sys

report_path         = sys.argv[1]
manifest_path       = sys.argv[2]
extra_steps_raw     = sys.argv[3]
override_delib_raw  = sys.argv[4]
started_at          = sys.argv[5]
report_head         = sys.argv[6]

manifest = json.load(open(manifest_path, encoding='utf-8'))

# Build required steps all PASS
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})

# Build conditional steps.
# production-file-verify must be PASS because the fixture commit includes .sh scripts
# (task_is_code_changes=TRUE fires for non-doc, non-yaml files like .sh).
# All other conditional steps default to SKIP with reason.
for cs in manifest.get('conditional_steps', []):
    if cs['id'] == 'production-file-verify':
        steps.append({"step": cs['id'], "ran": True, "result": "PASS"})
    else:
        steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                      "reason": "predicate false in isolated test repo"})

# Apply extra overrides (JSON list of step objects to merge/replace)
if extra_steps_raw.strip():
    extras = json.loads(extra_steps_raw)
    by_id = {s['step']: s for s in steps}
    for e in extras:
        by_id[e['step']] = e
    steps = list(by_id.values())

# Default deliberation block (all 3 required roles)
deliberation = {
    "architects_consulted": ["arch-platform", "arch-testing", "arch-integration"],
    "incorporated_at": "2026-06-14T00:00:00Z",
}
if override_delib_raw.strip():
    override = json.loads(override_delib_raw)
    deliberation.update(override)

report = {
    "started_at": started_at,
    "deliberation": deliberation,
    # wave qg-artifact-binding (W4): managed-key-subset contract — write_valid_
    # artifact_receipts (called below) stages a matching status:PASS secret-scan
    # receipt; this repo has no skills/ dir (registry-hash is n/a -> PASS) and no
    # .commitlintrc.json by default (commit_lint has nothing to check -> PASS). Tests
    # that call write_rule_sources add a REAL .commitlintrc.json but its scopes never
    # appear in a conventional-commit subject in these fixtures, so commit_lint stays
    # PASS there too.
    "pre_pr_coverage": {
        "status": "PASS", "modules": 3,
        "secret_scan": "PASS", "registry_hash_freshness": "PASS", "commit_lint": "PASS",
    },
    "discovered_rules": [
        {"rule": "two-stamp-gate", "rule_id": "two-stamp-gate", "verified_by": "pre-push-hook.bats"}
    ],
    "steps": steps,
}
# Only add "head" when report_head is non-empty — "__OMIT__" resolves to an empty
# string in bash, so the key is genuinely ABSENT here, not present-with-empty-value
# (report-head-absent's fixture must delete the key, not merely blank it).
if report_head:
    report["head"] = report_head
with open(report_path, "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
    f.write('\n')
PYEOF
  write_valid_bats_handoff
  write_valid_artifact_receipts
}

# write_arch_verdicts — writes APPROVED-VERIFY-FINAL + HEAD-bound verdicts for all 3
# required roles into .planning/wave-<slug>/
# $1=slug, $2=head_sha (default HEAD_SHA)
write_arch_verdicts() {
  local slug="$1"
  local head="${2:-$HEAD_SHA}"
  local wave_dir="$REPO/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  for role in arch-testing arch-platform arch-integration; do
    cat > "$wave_dir/$role-verdict.md" <<EOF
# $role verdict — wave-$slug

**Phase**: PREP
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $head
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-14T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
  done
}

# write_plan — writes a minimal PLAN.md into .planning/wave-<slug>/
# $1=slug
write_plan() {
  local slug="$1"
  local wave_dir="$REPO/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  printf '### Wave Class\n- **Class**: HARNESS\n### Spawn Table\n| Role | Count | Reason |\n|---|---|---|\n| arch-platform | 1 | test |\n' \
    > "$wave_dir/PLAN.md"
}

# ─────────────────────────────────────────────────────────────────────────────
# #WP1  predicate TRUE + path-manifest-audit SKIP → inconsistent-skip
# PLAN.md present → wave_plan_present=TRUE. Report has SKIP (no reason justifying it).
# Expect: exit 2 with inconsistent-skip or path-manifest-audit in output.
# TDD: RED until Part A lands wave_plan_present enforcement in emit-push-proof.sh.
# ─────────────────────────────────────────────────────────────────────────────
@test "#WP1 BLOCK: wave_plan_present TRUE + path-manifest-audit SKIP → inconsistent-skip (exit 2)" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report '[{"step":"path-manifest-audit","ran":false,"result":"SKIP"}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"inconsistent-skip"* ]] || [[ "$output" == *"path-manifest-audit"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #WP2  predicate FALSE + path-manifest-audit SKIP+reason → PASS
# No .planning/wave-nonexistent-slug/PLAN.md → wave_plan_present=FALSE.
# SKIP+reason is legitimate when predicate is FALSE.
# Expect: exit 0.
# TDD: RED until Part A lands — currently SKIP without enforcement passes trivially
# but the predicate logic may not exist yet to confirm FALSE → allowed.
# ─────────────────────────────────────────────────────────────────────────────
@test "#WP2 PASS: wave_plan_present FALSE + path-manifest-audit SKIP+reason is valid (exit 0)" {
  # No write_plan — .planning/wave-nonexistent-slug/PLAN.md does not exist
  write_arch_verdicts "nonexistent-slug"
  write_quality_gate_report '[{"step":"path-manifest-audit","ran":false,"result":"SKIP","reason":"No active wave PLAN.md found"}]'
  run bash -c "CLAUDE_WAVE_SLUG='nonexistent-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #WP3  predicate TRUE + path-manifest-audit absent → step-coverage-gap
# PLAN.md present → wave_plan_present=TRUE. Step absent from report entirely.
# Expect: exit 2 with step-coverage-gap or path-manifest-audit in output.
# TDD: RED until Part A — step-coverage-gap check may fire without predicate
# enforcement but this confirms the structural coverage check is in play.
# ─────────────────────────────────────────────────────────────────────────────
@test "#WP3 BLOCK: wave_plan_present TRUE + path-manifest-audit absent from report → step-coverage-gap (exit 2)" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  # Write report with path-manifest-audit explicitly removed from steps[]. This test
  # builds its own report inline (bypassing write_quality_gate_report), so Wave A's
  # started_at + handoff are added here explicitly — report-started-at-* and
  # test-suite-evidence-* (test-suite defaults to PASS below) would otherwise fire
  # before ever reaching the step-coverage-gap check this test exists to exercise.
  local started_at
  started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  # 51b0d63: report-head-* requires report.head present and equal to current HEAD;
  # re-derived fresh from git, never a cached variable.
  local report_head
  report_head="$(git -C "$REPO" rev-parse HEAD)"
  python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" "$started_at" "$report_head" <<'PYEOF'
import json, sys
manifest = json.load(open(sys.argv[2], encoding='utf-8'))
started_at = sys.argv[3]
report_head = sys.argv[4]
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})
# Deliberately omit path-manifest-audit from conditional steps.
# production-file-verify must be PASS because the fixture commit includes .sh scripts
# (task_is_code_changes=TRUE); otherwise inconsistent-skip fires before step-coverage-gap.
for cs in manifest.get('conditional_steps', []):
    if cs['id'] == 'production-file-verify':
        steps.append({"step": cs['id'], "ran": True, "result": "PASS"})
    elif cs['id'] != 'path-manifest-audit':
        steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                      "reason": "predicate false in isolated test repo"})
report = {
    "started_at": started_at,
    "head": report_head,
    "deliberation": {
        "architects_consulted": ["arch-platform", "arch-testing", "arch-integration"],
        "incorporated_at": "2026-06-14T00:00:00Z",
    },
    "pre_pr_coverage": {"status": "PASS", "modules": 3},
    "discovered_rules": [{"rule": "two-stamp-gate", "rule_id": "two-stamp-gate", "verified_by": "pre-push-hook.bats"}],
    "steps": steps,
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2); f.write('\n')
PYEOF
  write_valid_bats_handoff
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"step-coverage-gap"* ]] || [[ "$output" == *"path-manifest-audit"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #WP4  predicate TRUE + path-manifest-audit PASS → valid
# PLAN.md present → wave_plan_present=TRUE. Step ran=true result=PASS.
# Expect: exit 0.
# TDD: RED until Part A — run-qg must allow path-manifest-audit PASS when pred TRUE.
# ─────────────────────────────────────────────────────────────────────────────
@test "#WP4 PASS: wave_plan_present TRUE + path-manifest-audit PASS → valid (exit 0)" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report '[{"step":"path-manifest-audit","ran":true,"result":"PASS","reason":"All touched files in manifest. CLASS=HARNESS matches PLAN.md."}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #WP5  invalid slug → predicate FALSE → SKIP+reason valid → later fails elsewhere
# resolve_slug() does NOT validate CLAUDE_WAVE_SLUG's content (only its bash-level
# emptiness) — it returns "../evil" verbatim. The inline allowlist lives ONLY in
# eval_predicate('wave_plan_present'): re.match(r'^[A-Za-z0-9._-]+$') rejects "../evil"
# (contains "/") → predicate evaluates FALSE → path-manifest-audit's SKIP+reason is
# legitimate (pred_false + SKIP+reason -> valid) → the conditional-steps pass completes
# without misclassifying this as inconsistent-skip. That IS this test's load-bearing
# assertion. The run still fails LATER: wave_slug="../evil" flows unresolved into the
# verdict-file check's wave dir (.planning/wave-../evil/), which was deliberately never
# created (only wave-test-slug/ was) — exit 2, verdict-head-binding. Tightened per Wave
# A finding: the prior negative-only assertion (`output != *"inconsistent-skip"*`) would
# have kept passing even if this predicate path silently broke, since ANY other die
# reason (e.g. the report-started-at-absent this wave introduces) also lacks that
# substring — it would prove nothing without also pinning the real, specific reason.
# ─────────────────────────────────────────────────────────────────────────────
@test "#WP5 PASS (predicate layer): invalid slug ../evil → wave_plan_present FALSE → path-manifest-audit SKIP+reason valid; run fails later at verdict-head-binding, never inconsistent-skip" {
  # Create a wave dir that would match if slug were valid — proves slug check, not dir absence
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report '[{"step":"path-manifest-audit","ran":false,"result":"SKIP","reason":"No active wave PLAN.md found"}]'
  run bash -c "CLAUDE_WAVE_SLUG='../evil' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"verdict-head-binding"* ]]
  [[ "$output" != *"inconsistent-skip"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #WP6  manifest digest consistency
# quality-gate-manifest.json protocol_digest must match the canonical digest of its own
# content (excluding the protocol_digest field). Detects drift between manifest and digest.
# This test may GREEN immediately if the manifest digest is already stable.
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
# #SS-WP-1  secret-scan step result=FAIL → run-qg blocked (exit 2)
# The required step 'secret-scan' has result=FAIL — run-qg must reject the proof.
# ─────────────────────────────────────────────────────────────────────────────
@test "#SS-WP-1 BLOCK: secret-scan step result=FAIL → run-qg exits 2" {
  write_arch_verdicts "test-slug"
  # Override secret-scan to FAIL (it is a required step: ran=true, result=FAIL)
  write_quality_gate_report '[{"step":"secret-scan","ran":true,"result":"FAIL"}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  # Output must reference the blocking step
  [[ "$output" == *"secret-scan"* ]] || [[ "$output" == *"step-not-pass"* ]] || [[ "$output" == *"FAIL"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #SS-WP-2  secret-scan step result=SKIP → run-qg blocked (exit 2)
# secret-scan is a required step; SKIP is not an acceptable result.
# ─────────────────────────────────────────────────────────────────────────────
@test "#SS-WP-2 BLOCK: secret-scan step result=SKIP → run-qg exits 2" {
  write_arch_verdicts "test-slug"
  # Override secret-scan to SKIP (required step — SKIP is not PASS)
  write_quality_gate_report '[{"step":"secret-scan","ran":false,"result":"SKIP","reason":"skipped for test"}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"secret-scan"* ]] || [[ "$output" == *"step-not-pass"* ]] || [[ "$output" == *"SKIP"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #SS-WP-3  secret-scan step absent from steps[] → run-qg blocked (exit 2)
# A required step missing from the report triggers step-coverage-gap.
# ─────────────────────────────────────────────────────────────────────────────
@test "#SS-WP-3 BLOCK: secret-scan step absent from steps[] → run-qg exits 2 (step-coverage-gap)" {
  write_arch_verdicts "test-slug"
  # Write report with secret-scan explicitly removed from steps[]. This test builds its
  # own report inline (bypassing write_quality_gate_report), so Wave A's started_at +
  # handoff are added here explicitly — see #WP3's comment for why.
  local started_at
  started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  # 51b0d63: report-head-* requires report.head present and equal to current HEAD;
  # re-derived fresh from git, never a cached variable.
  local report_head
  report_head="$(git -C "$REPO" rev-parse HEAD)"
  python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" "$started_at" "$report_head" <<'PYEOF'
import json, sys
manifest = json.load(open(sys.argv[2], encoding='utf-8'))
started_at = sys.argv[3]
report_head = sys.argv[4]
steps = []
for rs in manifest.get('required_steps', []):
    if rs['id'] == 'secret-scan':
        continue  # deliberately omit secret-scan
    steps.append({"step": rs['id'], "ran": True, "result": "PASS"})
# production-file-verify: PASS (fixture has .sh files)
# All other conditional steps: SKIP
for cs in manifest.get('conditional_steps', []):
    if cs['id'] == 'production-file-verify':
        steps.append({"step": cs['id'], "ran": True, "result": "PASS"})
    else:
        steps.append({"step": cs['id'], "ran": False, "result": "SKIP",
                      "reason": "predicate false in isolated test repo"})
report = {
    "started_at": started_at,
    "head": report_head,
    "deliberation": {
        "architects_consulted": ["arch-platform", "arch-testing", "arch-integration"],
        "incorporated_at": "2026-06-14T00:00:00Z",
    },
    "pre_pr_coverage": {"status": "PASS", "modules": 3},
    "discovered_rules": [{"rule": "two-stamp-gate", "rule_id": "two-stamp-gate", "verified_by": "pre-push-hook.bats"}],
    "steps": steps,
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2); f.write('\n')
PYEOF
  write_valid_bats_handoff
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"secret-scan"* ]] || [[ "$output" == *"step-coverage-gap"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#WP6 PASS: quality-gate-manifest.json protocol_digest matches canonical digest" {
  local manifest="$MANIFEST_SRC"
  local stored_digest
  stored_digest="$(python3 - "$manifest" <<'PYEOF'
import json, sys
m = json.load(open(sys.argv[1], encoding='utf-8'))
print(m.get('protocol_digest', ''))
PYEOF
)"
  local canonical_digest
  canonical_digest="$(python3 - "$manifest" <<'PYEOF'
import hashlib, json, sys
# Canonical digest: matches manifest-digest.sh exactly.
# sha256(json(required_steps, sort+compact) + json(conditional_steps, sort+compact), CRLF->LF)
m = json.load(open(sys.argv[1], encoding='utf-8'))
req  = json.dumps(m['required_steps'],   sort_keys=True, separators=(',', ':'))
cond = json.dumps(m['conditional_steps'], sort_keys=True, separators=(',', ':'))
combined = (req + cond).encode('utf-8').replace(b'\r\n', b'\n')
print(hashlib.sha256(combined).hexdigest())
PYEOF
)"
  # Canonicalization mirrors scripts/sh/lib/manifest-digest.sh exactly.
  [ "$stored_digest" = "$canonical_digest" ]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave A — Section A4 evidence binding (new tests)
# ═════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
# #EP-ENUM  invalid-step-result — a step result outside {PASS,FAIL,SKIP} is rejected.
# Regression guard for the historical Wave 5 "PASS-DELTA-HONEST" shape.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-ENUM BLOCK: invalid-step-result — test-suite result='PASS-DELTA-HONEST' rejected" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report '[{"step":"test-suite","ran":true,"result":"PASS-DELTA-HONEST"}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"invalid-step-result"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-DUP  duplicate-step-id — two entries sharing a step id are rejected (closes the
# last-wins overwrite the step-index dict comprehension would otherwise silently do).
# write_quality_gate_report's own extra_steps merge already de-dupes by id, so the
# duplicate must be injected post-hoc to prove the CHECK, not just the fixture builder.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-DUP BLOCK: duplicate-step-id — two steps[] entries share the same id" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
dup = next(s for s in r['steps'] if s.get('step') == 'test-suite')
r['steps'].append(dict(dup))
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"duplicate-step-id"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-UNK  unknown-step-id — a step id outside required ∪ conditional ∪ informational
# is rejected.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-UNK BLOCK: unknown-step-id — a step id absent from all three manifest sets is rejected" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report '[{"step":"totally-made-up-step","ran":true,"result":"PASS"}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown-step-id"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-UNK+  POSITIVE CONTROL — the sole informational_steps entry ("report-freshness")
# is ACCEPTED, not rejected as unknown-step-id. Load-bearing: without this, #EP-UNK
# could pass against a gate that rejects EVERY step id unconditionally, proving nothing.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-UNK+ POSITIVE CONTROL: informational step 'report-freshness' is accepted (exit 0), never unknown-step-id" {
  # Deliberately NO write_plan — this test needs a fully PASSING run (unlike
  # #EP-ENUM/#EP-DUP/#EP-UNK, which die earlier in Section A4 regardless), so
  # wave_plan_present must stay FALSE, matching #WP2's pattern: path-manifest-audit's
  # default SKIP+reason (from write_quality_gate_report) is then legitimate rather than
  # an unrelated inconsistent-skip.
  write_arch_verdicts "test-slug"
  write_quality_gate_report '[{"step":"report-freshness","ran":true,"result":"PASS"}]'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
  [[ "$output" != *"unknown-step-id"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV1  test-suite-evidence-absent — no bats handoff exists at all.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV1 BLOCK: test-suite-evidence-absent — no bats handoff exists at all" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-absent"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV2  test-suite-evidence-absent — the only candidate handoff is malformed
# (empty run-id fails bats-handoff.sh's own well-formedness regex).
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV2 BLOCK: test-suite-evidence-absent — the only handoff is malformed (empty run-id)" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  printf 'BATS_OK=5\nBATS_NOT_OK=0\nBATS_EXPECTED=5\nBATS_TOTAL=5\nBATS_COMPLETE=true\nBATS_VERDICT=pass\nBATS_LOG=/dev/null\nBATS_HEAD=%s\nBATS_RUN_ID=\nBATS_GENERATED_AT=%s\nBATS_SCOPE=full\n' \
    "$head" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$ACDOC/bats-result.malformed-ev2.env"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-absent"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV3  test-suite-evidence-partial — a well-formed, HEAD-matching handoff that IS
# fresh enough (BATS_GENERATED_AT >= report.started_at) but scoped "targeted", not
# "full". Since commit 16ae614's Pass 3a/3b split (landed mid-wave), bats-handoff.sh
# reports this specific case as its own status="scope-mismatch" (distinct from
# genuine staleness, #EP-EV7) — emit-push-proof.sh's python dispatches that status
# directly to "test-suite-evidence-partial", making this check reachable (previously
# believed unreachable before 16ae614 landed; see #EP-EV7's comment for the fuller
# history). Canonical die-code pinned per team-lead's post-16ae614 confirmation.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV3 BLOCK: test-suite-evidence-partial — fresh but targeted-scope handoff (scope-mismatch)" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  write_custom_bats_handoff "$head" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" 5 0 5 true pass targeted
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-partial"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV4  test-suite-evidence-absent — a handoff bound to a DIFFERENT commit.
# select_bats_handoff's Pass 1 filters candidates by exact --head match before ANY
# later pass runs, so a foreign-head handoff is excluded at the library level
# (bats-handoff.sh reports its own status="absent" for this case) — distinct from
# #EP-EV7's genuinely-stale scenario (matching head, too old), which maps to its own
# dedicated die-code. This one is stable/unaffected by the 16ae614 Pass 3a/3b split
# (that split only concerns Pass 3, which never runs on a candidate Pass 1 rejected).
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV4 BLOCK: test-suite-evidence-absent — handoff bound to a foreign HEAD" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  write_custom_bats_handoff "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" 5 0 5 true pass full
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-absent"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV5  test-suite-evidence-partial — a well-formed, HEAD-matching, full-scope
# handoff with BATS_COMPLETE=false. Unlike scope, bats-handoff.sh's own
# well-formedness check does NOT require complete=="true" (only that the value
# matches ^(true|false)$), so this candidate IS selected as status="ok" — reaching,
# and legitimately exercising, emit-push-proof.sh's own complete-check.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV5 BLOCK: test-suite-evidence-partial — handoff has BATS_COMPLETE=false" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  write_custom_bats_handoff "$head" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" 5 0 5 false fail full
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-partial"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV6  test-suite-evidence-dirty — a well-formed, HEAD-matching, full-scope,
# complete handoff with not_ok>0. bats-handoff.sh's own selection does not exclude a
# dirty run (only emit-push-proof.sh's own dirty-check does).
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV6 BLOCK: test-suite-evidence-dirty — handoff has not_ok>0" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  write_custom_bats_handoff "$head" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" 5 2 7 true fail full
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-dirty"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV7  test-suite-evidence-stale — a well-formed, HEAD-MATCHING, full-scope
# handoff whose BATS_GENERATED_AT predates report.started_at (genuinely stale
# evidence for the RIGHT commit, unlike #EP-EV4's wrong-commit case).
#
# Landed mid-wave (commit 16ae614, arch-platform ruling): bats-handoff.sh's Pass 3
# used to fail one combined check (since AND scope together), so ANY non-"ok" result
# collapsed into a single library status and this die-code was unreachable via the
# CLI boundary. It is now split into Pass 3a (freshness only) then Pass 3b (scope,
# only over the freshness-qualifying subset), so "genuinely too old" (Pass 3a) and
# "fresh but wrong scope" (Pass 3b, see #EP-EV3) are reported as two different
# library statuses ("stale" vs "scope-mismatch"), and emit-push-proof.sh's python
# now dispatches on each SPECIFIC status value rather than collapsing every
# non-"ok" status into "-absent". This test would have been impossible to write
# honestly against the pre-16ae614 shape; it is added here because the production
# code changed underneath this wave while it was in progress. Canonical die-code
# pinned per team-lead's post-16ae614 confirmation.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV7 BLOCK: test-suite-evidence-stale — handoff matches HEAD but predates report.started_at" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  # started_at was just stamped (now); a handoff generated well before that is
  # genuinely stale evidence for the right commit.
  write_custom_bats_handoff "$head" "2020-01-01T00:00:00Z" 5 0 5 true pass full
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-stale"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV8  report-started-at-absent — report.started_at field is missing entirely.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV8 BLOCK: report-started-at-absent — report.started_at field is missing" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  override_report_started_at ""
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"report-started-at-absent"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV9a  report-started-at-implausible — started_at more than 86400s in the past
# (the intentional max-staleness bound, not unlimited replay protection).
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV9a BLOCK: report-started-at-implausible — started_at is far in the past" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  override_report_started_at "2020-01-01T00:00:00Z"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"report-started-at-implausible"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV9b  report-started-at-implausible — started_at more than SKEW_TOLERANCE (120s)
# in the future.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV9b BLOCK: report-started-at-implausible — started_at is in the future beyond skew tolerance" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  local future_ts
  future_ts="$(python3 -c "
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(seconds=600)).strftime('%Y-%m-%dT%H:%M:%SZ'))
")"
  override_report_started_at "$future_ts"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"report-started-at-implausible"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV10a  sanity floor, zero-case — ok=0 and expected=0 (nothing ran at all) maps
# to test-suite-evidence-absent, NOT -partial. A different bug class from #EP-EV10b:
# "nothing happened" vs. "something internally inconsistent happened".
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV10a BLOCK: sanity floor zero-case — ok=0,expected=0 → test-suite-evidence-absent" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  write_custom_bats_handoff "$head" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" 0 0 0 true pass full
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-absent"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-EV10b  sanity floor, Amendment-A bypass — ok=5,not_ok=0,total=5,expected=999,
# complete=true passes every OTHER check (status=ok, head matches, scope=full,
# complete=true, not_ok=0) but total != expected → test-suite-evidence-partial.
# Without this floor, a handoff claiming to have run only 5 of an expected 999 tests
# would still be accepted as "clean" evidence — this is the exact bypass Amendment A
# closes (a guard that cannot fail is worse than no guard).
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-EV10b BLOCK: sanity floor Amendment-A bypass — ok=5,not_ok=0,total=5,expected=999,complete=true → test-suite-evidence-partial" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  clear_handoffs
  local head
  head="$(git -C "$REPO" rev-parse HEAD)"
  write_custom_bats_handoff "$head" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" 5 0 999 true pass full
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"test-suite-evidence-partial"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-HEADMISMATCH / #EP-HEADABSENT / #EP-HEADMATCH / #EP-HEADORDER — 51b0d63's
# report-head-* check. emit-push-proof.sh previously had ZERO reads of report.head:
# --init wrote it, nothing ever compared it to git rev-parse HEAD. A report opened at
# commit A could be re-sealed and re-evidenced at a later commit B without a re-`--init`
# — started_at stays plausible (it's a floor, not a ceiling), the evidence lookup selects
# B's own fresh handoff, verdicts get re-supersede'd to B, the tree is clean, all steps
# pass — and the mint succeeds, binding report_digest to a report that still literally
# asserts commit A as its head. Observed live on this repo at the moment the gap was
# found: report.head pointed at an ancestor while HEAD had already moved past it via
# routine, unrelated work.
#
# RED confirmed against the pre-51b0d63 script (via `git show 16ae614:...` to scratch —
# scripts/sh/ never touched) before writing these assertions: both #EP-HEADMISMATCH and
# #EP-HEADABSENT minted a proof successfully (exit 0, push-proof.json written), because
# report.head was never read at all.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-HEADMISMATCH BLOCK: otherwise-valid report with report.head set to a DIFFERENT commit → report-head-mismatch, no proof minted" {
  # No write_plan here deliberately: wave_plan_present would default TRUE, but the
  # default report's path-manifest-audit is SKIP — an unrelated inconsistent-skip that
  # would fire first and mask the very check this test exists to exercise. write_plan's
  # own inconsistency is #WP1's subject, not this one's.
  write_arch_verdicts "test-slug"
  local wrong_head="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  write_quality_gate_report '' '' "$wrong_head"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"report-head-mismatch"* ]]
  [ ! -f "$ACDOC/push-proof.json" ]
  [ ! -f "$ACDOC/quality-gate.stamp" ]
  [ ! -f "$ACDOC/pre-pr.stamp" ]
}

@test "#EP-HEADABSENT BLOCK: otherwise-valid report with head key entirely absent (started_at present) → report-head-absent" {
  # __OMIT__ deletes the key entirely — report-head-absent must not rely on a sibling
  # check (report-started-at-absent) to catch this; started_at stays present and valid.
  # No write_plan (see #EP-HEADMISMATCH's comment) — avoids an unrelated inconsistent-skip.
  write_arch_verdicts "test-slug"
  write_quality_gate_report '' '' "__OMIT__"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"report-head-absent"* ]]
  [ ! -f "$ACDOC/push-proof.json" ]
  [ ! -f "$ACDOC/quality-gate.stamp" ]
  [ ! -f "$ACDOC/pre-pr.stamp" ]
}

@test "#EP-HEADMATCH ALLOW (positive control): report.head == current HEAD → run-qg mints proof" {
  # Proves #EP-HEADMISMATCH/#EP-HEADABSENT exercise a real check, not a mint that
  # refuses every report unconditionally — write_quality_gate_report's own default
  # (no override) binds head to the actual current HEAD, exactly like every other
  # passing #EP-* test already relies on.
  # No write_plan (see #EP-HEADMISMATCH's comment) — avoids an unrelated inconsistent-skip.
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
  [ -f "$ACDOC/push-proof.json" ]
}

@test "#EP-HEADORDER BLOCK: report-started-at-absent fires before report-head-mismatch when both are wrong (precedence pin)" {
  # Textual order in the script is report-started-at-* then report-head-* (the operator
  # sees the more specific cause first) — pinned here empirically, not assumed from
  # reading the source, since precedence is a runtime property of die()'s control flow.
  # No write_plan (see #EP-HEADMISMATCH's comment) — avoids an unrelated inconsistent-skip.
  write_arch_verdicts "test-slug"
  local wrong_head="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  write_quality_gate_report '' '' "$wrong_head"
  override_report_started_at ""
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"report-started-at-absent"* ]]
  [[ "$output" != *"report-head-mismatch"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #EP-BESPOKE  reconstruction of the historical Wave 5 in-the-wild bad report — the
# original is gone from disk (.androidcommondoc/ is gitignored; Wave B's own QG run
# overwrote it). Rebuilt from its description only: null pre_pr_coverage, null
# discovered_rules, no started_at, and a "bats-suite": "PASS-DELTA-HONEST" field. The
# exact first die-code is not pinned (deliberation-evidence-absent fires first in this
# reconstruction, ahead of the pre_pr_coverage/discovered_rules checks, since no
# "deliberation" block is present either) — any of them is sufficient to prove this
# historical shape is rejected, not minted.
# ─────────────────────────────────────────────────────────────────────────────
@test "#EP-BESPOKE BLOCK: reconstructed Wave 5 report (null pre_pr_coverage/discovered_rules, no started_at, PASS-DELTA-HONEST) is rejected, no proof minted" {
  write_plan "test-slug"
  write_arch_verdicts "test-slug"
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
report = {
    "pre_pr_coverage": None,
    "discovered_rules": None,
    "bats-suite": "PASS-DELTA-HONEST",
    "steps": [],
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2); f.write('\n')
PYEOF
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [ ! -f "$ACDOC/push-proof.json" ]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave qg-artifact-binding — W1 generic artifact binding (new tests)
#
# No write_plan in any of these (mirrors #EP-HEADMATCH's own comment): wave_plan_
# present would default TRUE and the default report's path-manifest-audit SKIP would
# then be an unrelated inconsistent-skip, firing inside Section 3 — BEFORE the
# artifact-binding loop (3c) this whole section exists to exercise ever runs.
# ═════════════════════════════════════════════════════════════════════════════

@test "#AB-POS PASS (positive control): both loop receipts present + fresh + PASS → run-qg mints proof (exit 0)" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
  [ -f "$ACDOC/push-proof.json" ]
}

@test "#AB-ABSENT BLOCK: secret-scan-report.json deleted (loop member) → artifact-binding-absent" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  rm -f "$ACDOC/secret-scan-report.json"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"artifact-binding-absent"* ]]
}

@test "#AB-HEAD BLOCK: secret-scan-report.json.head is a foreign sha → artifact-binding-head" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  override_artifact_receipt_field "secret-scan-report.json" "head" '"deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"artifact-binding-head"* ]]
}

@test "#AB-STALE BLOCK: doc-validator-report.json.generated_at predates report.started_at (loop member) → artifact-binding-stale" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  override_artifact_receipt_field "doc-validator-report.json" "generated_at" '"2020-01-01T00:00:00Z"'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"artifact-binding-stale"* ]]
}

@test "#AB-STATUS BLOCK: doc-validator-report.json.status flipped to FAIL → artifact-binding-status" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  override_artifact_receipt_field "doc-validator-report.json" "status" '"FAIL"'
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"artifact-binding-status"* ]]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave qg-artifact-binding — W4 pre_pr_coverage managed-key-subset contract
# ═════════════════════════════════════════════════════════════════════════════

@test "#PPCD-POS PASS (positive control): every managed key's pre_pr_coverage status agrees with its receipt → exit 0" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
}

@test "#PPCD-NEG BLOCK: pre_pr_coverage managed key disagrees with its receipt → pre-pr-coverage-drift" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  # The receipt stays status:PASS (write_valid_artifact_receipts); the mint's derived
  # secret_scan status is therefore PASS — a report claiming FAIL for the same
  # managed key must die pre-pr-coverage-drift.
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['pre_pr_coverage']['secret_scan'] = 'FAIL'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"pre-pr-coverage-drift"* ]]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave qg-artifact-binding — W5 rule-inventory / rule-coverage-gap
# ═════════════════════════════════════════════════════════════════════════════

@test "#RCG-POS PASS: discovered_rules ⊇ mint-generated inventory (superset allowed) → exit 0" {
  write_rule_sources
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['discovered_rules'] = [
    {"rule": "Rule One", "rule_id": "pc:rule-one", "verified_by": "test"},
    {"rule": "Rule Two", "rule_id": "pc:rule-two", "verified_by": "test"},
    {"rule": "commitlint scopes", "rule_id": "commitlint:valid-scopes", "verified_by": "test"},
    {"rule": "extra rule not in inventory", "rule_id": "extra:not-in-inventory", "verified_by": "test"},
]
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
}

@test "#RCG-NEG BLOCK: discovered_rules omits an id the mint-generated inventory contains → rule-coverage-gap" {
  write_rule_sources
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  # commitlint:valid-scopes is deliberately omitted — the freshly generated inventory
  # contains it (write_rule_sources' .commitlintrc.json), so the mint must die.
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['discovered_rules'] = [
    {"rule": "Rule One", "rule_id": "pc:rule-one", "verified_by": "test"},
    {"rule": "Rule Two", "rule_id": "pc:rule-two", "verified_by": "test"},
]
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"rule-coverage-gap"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #RIM-NEG  discovered-rule-missing-id (P2a fix-round addition, abfe58a) — a
# discovered_rules[] entry missing rule_id (or carrying an empty string) must die
# BEFORE the rule-coverage-gap diff above (#RCG-*) ever runs. Without this
# fail-closed check, entry.get('rule_id') is falsy, the bad entry silently drops
# out of discovered_ids (the old `if d.get('rule_id')` filter), and an extra,
# unidentified rule slips through the coverage diff undetected — the exact class
# of bug this check closes. #RCG-POS (above) already doubles as this same
# contract's positive control: every entry there already carries a non-empty
# rule_id, and that fixture is unchanged/still green.
# ─────────────────────────────────────────────────────────────────────────────
@test "#RIM-NEG BLOCK: discovered_rules entry missing rule_id (one key absent, one empty string) → discovered-rule-missing-id" {
  write_rule_sources
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  python3 - "$ACDOC/quality-gate-report.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
r = json.load(open(path, encoding='utf-8'))
r['discovered_rules'] = [
    {"rule": "Rule One", "rule_id": "pc:rule-one", "verified_by": "test"},
    {"rule": "Rule Two — rule_id key absent entirely", "verified_by": "test"},
    {"rule": "commitlint scopes — rule_id is empty string", "rule_id": "", "verified_by": "test"},
]
with open(path, 'w', encoding='utf-8') as f:
    json.dump(r, f, indent=2); f.write('\n')
PYEOF
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"discovered-rule-missing-id"* ]]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave qg-artifact-binding — W6 manifest-evidence-drift (R6 trap: digest MUST be
# recomputed+repasted in the same fixture edit, else manifest-drift fires first)
# ═════════════════════════════════════════════════════════════════════════════

@test "#MED-POS PASS: test-suite.evidence is require_scope=full/max_not_ok=0/require_complete=true (undisturbed manifest) → exit 0" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 0 ]
}

@test "#MED-NEG BLOCK: test-suite.evidence.require_scope mutated to 'targeted' + digest repasted → manifest-evidence-drift" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  python3 - "$REPO/quality-gate-manifest.json" <<'PYEOF'
import json, sys
path = sys.argv[1]
m = json.load(open(path, encoding='utf-8'))
ts_step = next(s for s in m['required_steps'] if s['id'] == 'test-suite')
ts_step['evidence']['require_scope'] = 'targeted'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, indent=2); f.write('\n')
PYEOF
  # R6 trap: without this recompute+repaste, manifest-drift (an earlier, unrelated
  # check) fires first and masks manifest-evidence-drift entirely.
  recompute_and_repaste_digest "$REPO/quality-gate-manifest.json"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"manifest-evidence-drift"* ]]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave qg-artifact-binding — R3 ordering: loop membership enumerated from the
# post-W6 manifest, proving BOTH registry-hash AND pre-pr are excluded (each via its
# own mint_rederived marker) — not incidentally, not by assertion. Pure static
# enumeration; never invokes the emitter.
# ═════════════════════════════════════════════════════════════════════════════

@test "#LOOP-ORDER STATIC: generic artifact-binding loop membership == exactly {secret-scan, doc-validator-parity}; registry-hash and pre-pr excluded via mint_rederived" {
  local result
  result="$(python3 - "$REPO/quality-gate-manifest.json" <<'PYEOF'
import json, sys
m = json.load(open(sys.argv[1], encoding='utf-8'))
loop = []
for rs in m.get('required_steps', []):
    if rs.get('kind') != 'automatable':
        continue
    if not rs.get('artifact'):
        continue
    if 'evidence' in rs:
        continue
    if rs.get('mint_rederived'):
        continue
    loop.append(rs['id'])
by_id = {rs['id']: rs for rs in m['required_steps']}
assert by_id['registry-hash'].get('mint_rederived') is True, "registry-hash must be mint_rederived"
assert by_id['pre-pr'].get('mint_rederived') is True, "pre-pr must be mint_rederived"
assert 'registry-hash' not in loop, "registry-hash must be excluded from the loop"
assert 'pre-pr' not in loop, "pre-pr must be excluded from the loop"
print(','.join(sorted(loop)))
PYEOF
)"
  [ "$result" = "doc-validator-parity,secret-scan" ]
}

# ═════════════════════════════════════════════════════════════════════════════
# H1 (push-authority-bootstrap) — Part 4 mint precondition: verify-git-hooks.sh
# must confirm the git-layer pre-push hook is installed and canonical before
# run-qg proceeds. setup() installs a canonical hook via the REAL
# install-git-hooks.sh (see setup()'s own comment for why the installer itself
# is never copied into the fixture). These two tests take that known-PASS
# baseline (same fixture shape as #MED-POS, a stable exit-0 regression pin)
# and break exactly one thing each (revert-one-prove-red): the installed hook
# is removed / tampered. This pins half (a) of H1's mechanical guarantee — the
# mint fail-closes unconditionally on hook absence/drift.
#
# TDD: RED-pending until the parallel toolkit-specialist lands emit-push-proof.sh's
# Part 4 gate (immediately after the template-size gate, before the registry-
# digest-record block) — today the hook state has no effect on run-qg's outcome.
# ═════════════════════════════════════════════════════════════════════════════

@test "#H1-HOOK-ABSENT BLOCK: pre-push hook removed after install → hook-binding-absent (exit != 0)" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  rm "$REPO/.git/hooks/pre-push"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-binding-absent"* ]]
}

@test "#H1-HOOK-DRIFTED BLOCK: installed pre-push hook tampered, marker kept → hook-binding-drifted (exit != 0)" {
  write_arch_verdicts "test-slug"
  write_quality_gate_report
  # Append a single byte to the END of the installed hook — keeps the
  # ACDOC-PRE-PUSH-GATE marker (near the top, line 2 of pre-push-hook.sh)
  # intact and the file executable, so only the sha256 drift check trips,
  # never hook-marker-missing or hook-not-executable.
  printf 'x' >> "$REPO/.git/hooks/pre-push"
  run bash -c "CLAUDE_WAVE_SLUG='test-slug' bash '$EMITTER' --subcommand run-qg --repo-root '$REPO'"
  [ "$status" -ne 0 ]
  [[ "$output" == *"hook-binding-drifted"* ]]
}
