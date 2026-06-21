#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/emit-qg-result.sh
#
# Coverage map (12 tests):
#   #QR1  status:pass when report all-PASS + clean bats log
#   #QR2  status:fail when bats log has ^not ok (even if bats exited 0)
#   #QR3  empty bats log → status:fail (no evidence = not pass)
#   #QR4  head field matches git rev-parse HEAD of isolated repo
#   #QR5  --init writes status:running + updated_at (heartbeat init)
#   #QR6  GUARDRAIL (a): qg-result.json written to gitignored .planning/wave-<slug>/
#         does NOT trip emit-push-proof.sh run-qg clean-tree assertion
#   #QR7  GUARDRAIL (b): verify-proof behaves identically with vs without
#         qg-result.json present (not consumed by verify-proof)
#   #QR8  --phase <name> updates phase + updated_at on existing file
#   #QR9  REGRESSION: 1..0 bats log (plan present, zero ok) → status:fail, bats_ok:0
#         (CI parity: emit-qg-result must treat zero-ok as no evidence)
#   #QR10 VALID handoff (HEAD + non-empty run-id + generated_at >= started_at +
#         complete) → status:pass, suite_summary.bats_ok sourced from handoff
#   #QR11 INVALID handoff → status:fail + bats_complete:false; two sub-cases:
#         (a) generated_at < started_at (previous-QG leftover rejected → fallback + partial)
#         (b) HEAD mismatch (rejected → fallback + partial → fail)
#   #QR12 NO handoff present → fallback to clean complete TAP log → status:pass
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# Fixtures written via --report / --bats-log / --out; NEVER touch live state.
#
# Mirrors fixture pattern from emit-push-proof.bats.

SCRIPT="$BATS_TEST_DIRNAME/../sh/emit-qg-result.sh"
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
    git -C "$REPO" checkout -b feature/test-qr --quiet

    ACDOC="$REPO/.androidcommondoc"
    mkdir -p "$ACDOC"

    # .gitignore: hide .androidcommondoc/ and .planning/wave*/ (mirrors real repo)
    printf '.androidcommondoc/\n.planning/wave*/\n' > "$REPO/.gitignore"

    # Capture HEAD after initial setup (re-captured after fixture commit in QR4/QR6/QR7)
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"
}

teardown() {
    rm -rf "$REPO"
}

# ── Helpers ───────────────────────────────────────────────────────────────────

# write_clean_bats_log <path> — a minimal bats log with 2 ok lines and a plan
write_clean_bats_log() {
    local path="$1"
    printf '1..2\nok 1 first\nok 2 second\n' > "$path"
}

# write_not_ok_bats_log <path> — a bats log with a not ok line (simulates bats exit-0 false-green)
write_not_ok_bats_log() {
    local path="$1"
    printf '1..2\nok 1 first\nnot ok 2 fails\n' > "$path"
}

# write_report_all_pass <path> — minimal QG report with all required steps PASS
write_report_all_pass() {
    local path="$1"
    python3 - "$path" "$MANIFEST_SRC" << 'PYEOF'
import json, sys
report_path   = sys.argv[1]
manifest_path = sys.argv[2]
manifest = json.load(open(manifest_path, encoding='utf-8'))
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({'step': rs['id'], 'ran': True, 'result': 'PASS'})
for cs in manifest.get('conditional_steps', []):
    # required=False so emit-qg-result.sh evaluator treats SKIP as non-blocking
    steps.append({'step': cs['id'], 'ran': False, 'result': 'SKIP',
                  'required': False,
                  'reason': 'predicate false in isolated test repo'})
report = {
    'deliberation': {
        'architects_consulted': ['arch-platform', 'arch-testing', 'arch-integration'],
        'incorporated_at': '2026-06-21T00:00:00Z',
    },
    'pre_pr_coverage': {'status': 'PASS', 'modules': 1},
    'discovered_rules': [
        {'rule': 'two-stamp-gate', 'verified_by': 'pre-push-hook.bats'},
    ],
    'steps': steps,
}
with open(report_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2)
    f.write('\n')
PYEOF
}

# parse_json_field <file> <field> — prints the value of a top-level JSON field
parse_json_field() {
    local file="$1"
    local field="$2"
    python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get(sys.argv[2], ''))
" "$file" "$field"
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR1  status:pass when report all-PASS + clean bats log
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR1 PASS: all-pass report + clean bats log → qg-result.json status=pass, exit 0" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_clean_bats_log "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "pass" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR2  status:fail when bats log has ^not ok (even if bats exit was 0)
# This is the headline false-green fix: content is authoritative.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR2 FAIL: bats log has ^not ok → qg-result.json status=fail, exit 1" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_not_ok_bats_log "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --slug "test-slug"
    [ "$status" -eq 1 ]
    [ -f "$out" ]
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "fail" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR3  empty bats log → status:fail (no run evidence = not pass)
# A dead/empty suite MUST NOT read green — matches run-bats.sh behaviour.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR3 FAIL: empty bats log → qg-result.json status=fail (no evidence), exit 1" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    printf '' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --slug "test-slug"
    [ "$status" -eq 1 ]
    [ -f "$out" ]
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "fail" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR4  head field matches git rev-parse HEAD of isolated repo
# Verifies that the HEAD written into qg-result.json is bound to the
# current commit, not a stale or placeholder value.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR4 PASS: head field in qg-result.json matches git rev-parse HEAD" {
    # Make a real commit in the isolated repo so HEAD is stable
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR4"
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_clean_bats_log "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]
    head_field="$(parse_json_field "$out" "head")"
    [ "$head_field" = "$HEAD_SHA" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR5  --init writes status:running + updated_at (heartbeat init)
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR5 PASS: --init writes status:running + updated_at field" {
    local out="$REPO/qg-result.json"

    run bash "$SCRIPT" --init --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "running" ]
    # updated_at must be present and non-empty
    updated_at="$(parse_json_field "$out" "updated_at")"
    [ -n "$updated_at" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR6  GUARDRAIL (a): qg-result.json written to gitignored .planning/wave-<slug>/
#         does NOT trip the emit-push-proof.sh run-qg clean-tree assertion.
#
# Scenario:
#   1. Set up an isolated git repo with all required fixtures committed.
#   2. Write qg-result.json into .planning/wave-test-slug/ (gitignored path).
#   3. Run emit-push-proof.sh --subcommand run-qg.
#   4. Assert it exits 0 (clean-tree assertion passes because .planning/wave*/
#      is gitignored and git status --porcelain returns empty for it).
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR6 GUARDRAIL: qg-result.json in gitignored .planning/wave-slug/ does not dirty the tree for run-qg" {
    # Mirror emit-push-proof.bats fixture setup
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"
    mkdir -p "$REPO/scripts/sh/lib"
    cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"            "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh"         "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"            "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/resolve-required-roles.js"  "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"       "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/rehash-registry.sh"             "$REPO/scripts/sh/"

    # Commit all fixtures — tree must be clean before run-qg
    git -C "$REPO" add -A
    git -C "$REPO" commit --quiet -m "test(fixtures): QR6 fixture commit"
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

    # Write a valid QG report
    write_report_all_pass "$ACDOC/quality-gate-report.json"

    # Write arch verdicts for the slug
    local slug="test-slug"
    local wave_dir="$REPO/.planning/wave-$slug"
    mkdir -p "$wave_dir"
    for role in arch-testing arch-platform arch-integration; do
        cat > "$wave_dir/$role-verdict.md" << EOF
# $role verdict

**Phase**: PREP
**Timestamp**: 2026-06-21T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $HEAD_SHA
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-21T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
    done

    # Write PLAN.md (needed by wave_plan_present predicate)
    printf '### Wave Class\n- **Class**: HARNESS\n### Spawn Table\n| Role | Count | Reason |\n|---|---|---|\n| arch-testing | 1 | test |\n' \
        > "$wave_dir/PLAN.md"

    # Write the path-manifest-audit step as PASS so run-qg does not block on it
    write_report_all_pass "$ACDOC/quality-gate-report.json"
    python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" << 'PYEOF'
import json, sys
rpt_path = sys.argv[1]
mfst_path = sys.argv[2]
rpt = json.load(open(rpt_path, encoding='utf-8'))
mfst = json.load(open(mfst_path, encoding='utf-8'))
by_id = {s['step']: s for s in rpt['steps']}
by_id['path-manifest-audit'] = {'step': 'path-manifest-audit', 'ran': True, 'result': 'PASS',
                                 'reason': 'All touched files in manifest.'}
by_id['production-file-verify'] = {'step': 'production-file-verify', 'ran': True, 'result': 'PASS'}
rpt['steps'] = list(by_id.values())
with open(rpt_path, 'w', encoding='utf-8') as f:
    json.dump(rpt, f, indent=2); f.write('\n')
PYEOF

    # NOW write qg-result.json into the gitignored path (the key action under test)
    local qg_out="$wave_dir/qg-result.json"
    run bash "$SCRIPT" --init --out "$qg_out" --project-root "$REPO" --slug "$slug"
    [ "$status" -eq 0 ]
    [ -f "$qg_out" ]

    # Confirm qg-result.json is gitignored (git status must NOT list it)
    local dirty_lines
    dirty_lines="$(git -C "$REPO" status --porcelain 2>/dev/null || true)"
    # .planning/wave*/qg-result.json must not appear in git status --porcelain
    ! echo "$dirty_lines" | grep -q "qg-result.json"

    # Run emit-push-proof.sh run-qg — must exit 0 (clean-tree assertion passes)
    run bash -c "CLAUDE_WAVE_SLUG='$slug' bash '$REPO/scripts/sh/emit-push-proof.sh' --subcommand run-qg --repo-root '$REPO'"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR7  GUARDRAIL (b): verify-proof behaves identically with vs without
#         qg-result.json present (not consumed by verify-proof).
#
# Scenario:
#   1. Run run-qg to mint a push-proof.json (without qg-result.json).
#   2. Record exit status.
#   3. Write qg-result.json into .planning/wave-<slug>/.
#   4. Run verify-proof with the same pushed-sha.
#   5. Assert same exit status — qg-result.json is transparent to verify-proof.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR7 GUARDRAIL: verify-proof behaves identically with vs without qg-result.json" {
    # Mirror emit-push-proof.bats fixture setup
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"
    mkdir -p "$REPO/scripts/sh/lib"
    cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"            "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh"         "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"            "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/resolve-required-roles.js"  "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"       "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/rehash-registry.sh"             "$REPO/scripts/sh/"

    git -C "$REPO" add -A
    git -C "$REPO" commit --quiet -m "test(fixtures): QR7 fixture commit"
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

    write_report_all_pass "$ACDOC/quality-gate-report.json"

    local slug="test-slug"
    local wave_dir="$REPO/.planning/wave-$slug"
    mkdir -p "$wave_dir"
    for role in arch-testing arch-platform arch-integration; do
        cat > "$wave_dir/$role-verdict.md" << EOF
# $role verdict

**Phase**: PREP
**Timestamp**: 2026-06-21T00:00:00Z
**Status**: APPROVED-PREP

---

**HEAD**: $HEAD_SHA
**Phase**: VERIFY-FINAL
**Timestamp**: 2026-06-21T00:00:00Z
**Status**: APPROVED-VERIFY-FINAL
EOF
    done

    printf '### Wave Class\n- **Class**: HARNESS\n### Spawn Table\n| Role | Count | Reason |\n|---|---|---|\n| arch-testing | 1 | test |\n' \
        > "$wave_dir/PLAN.md"

    python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" << 'PYEOF'
import json, sys
rpt_path = sys.argv[1]
mfst_path = sys.argv[2]
rpt = json.load(open(rpt_path, encoding='utf-8'))
by_id = {s['step']: s for s in rpt['steps']}
by_id['path-manifest-audit'] = {'step': 'path-manifest-audit', 'ran': True, 'result': 'PASS',
                                 'reason': 'All touched files in manifest.'}
by_id['production-file-verify'] = {'step': 'production-file-verify', 'ran': True, 'result': 'PASS'}
rpt['steps'] = list(by_id.values())
with open(rpt_path, 'w', encoding='utf-8') as f:
    json.dump(rpt, f, indent=2); f.write('\n')
PYEOF

    # Step 1: run-qg WITHOUT qg-result.json — record the outcome
    run bash -c "CLAUDE_WAVE_SLUG='$slug' bash '$REPO/scripts/sh/emit-push-proof.sh' --subcommand run-qg --repo-root '$REPO'"
    local rq_status="$status"
    [ "$rq_status" -eq 0 ]

    # Verify push-proof.json was created
    [ -f "$ACDOC/push-proof.json" ]

    # Step 2: NOW write qg-result.json into the gitignored path
    local qg_out="$wave_dir/qg-result.json"
    bash "$SCRIPT" --init --out "$qg_out" --project-root "$REPO" --slug "$slug"
    [ -f "$qg_out" ]

    # Step 3: verify-proof — must behave identically (qg-result.json not consumed)
    run bash -c "bash '$REPO/scripts/sh/emit-push-proof.sh' --subcommand verify-proof --pushed-sha '$HEAD_SHA' --repo-root '$REPO'"
    # verify-proof must exit 0 (PASS) regardless of qg-result.json presence
    # (it only reads push-proof.json + quality-gate-manifest.json + quality-gate-report.json)
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR8  --phase <name> updates phase + updated_at on existing file
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR8 PASS: --phase <name> updates phase field and updated_at on existing file" {
    local out="$REPO/qg-result.json"

    # First write an --init file
    run bash "$SCRIPT" --init --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]

    # Record initial updated_at
    local before_updated_at
    before_updated_at="$(parse_json_field "$out" "updated_at")"

    # Write a --phase update (sleep 1 so updated_at can advance at second resolution)
    sleep 1
    run bash "$SCRIPT" --phase "step-2-vitest" --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]

    # phase field must be updated
    phase_field="$(parse_json_field "$out" "phase")"
    [ "$phase_field" = "step-2-vitest" ]

    # updated_at must have advanced (heartbeat regression guard)
    local after_updated_at
    after_updated_at="$(parse_json_field "$out" "updated_at")"
    [ "$after_updated_at" != "$before_updated_at" ]

    # status must still be running (not changed by --phase)
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "running" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR9  REGRESSION: 1..0 bats log (plan present, zero ok) → status:fail, bats_ok:0
#
# A TAP log containing only "1..0" has a plan line but ZERO ok lines.
# Before the fix, emit-qg-result.sh would read ok_raw=0 but only check
# BATS_NOT_OK > 0 to fail — a "1..0" log has 0 not-ok AND 0 ok, so
# BATS_EVIDENCE was never set to true, meaning it correctly fails on
# BATS_EVIDENCE==false.  This test pins that contract explicitly so any
# regression (e.g. changing the ok>0 evidence guard) is caught.
#
# Contract:
#   - exit 1 (verdict = fail)
#   - status field = "fail"
#   - suite_summary.bats_ok = 0  (matches CI: ok_ct==0 is the zero-evidence sentinel)
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR9 REGRESSION: 1..0 bats log (plan present, zero ok) → status:fail, bats_ok:0 (CI parity)" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # Only a TAP plan line — no ok or not ok lines (simulates 1..0 zero-test suite)
    printf '1..0\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --slug "test-slug"
    [ "$status" -eq 1 ]
    [ -f "$out" ]

    # status must be fail
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "fail" ]

    # bats_ok in suite_summary must be 0
    bats_ok_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_ok', -1))
" "$out")"
    [ "$bats_ok_field" = "0" ]
}

# ── Helpers for handoff tests ─────────────────────────────────────────────────

# write_handoff <dir> <run_id> <head> <generated_at> <ok> <not_ok> <expected> <complete> <verdict>
# Writes a synthetic .androidcommondoc/bats-result.<run_id>.env handoff file
# mirroring the format emitted by run-bats.sh (one KEY=VALUE per line, no eval).
write_handoff() {
    local dir="$1"
    local run_id="$2"
    local head="$3"
    local generated_at="$4"
    local ok="$5"
    local not_ok="$6"
    local expected="$7"
    local complete="$8"
    local verdict="$9"
    local total=$(( ok + not_ok ))

    mkdir -p "$dir"
    local path="$dir/bats-result.${run_id}.env"
    printf 'BATS_OK=%s\n'           "$ok"           >  "$path"
    printf 'BATS_NOT_OK=%s\n'       "$not_ok"       >> "$path"
    printf 'BATS_EXPECTED=%s\n'     "$expected"      >> "$path"
    printf 'BATS_TOTAL=%s\n'        "$total"         >> "$path"
    printf 'BATS_COMPLETE=%s\n'     "$complete"      >> "$path"
    printf 'BATS_VERDICT=%s\n'      "$verdict"       >> "$path"
    printf 'BATS_LOG=%s\n'          "/dev/null"      >> "$path"
    printf 'BATS_HEAD=%s\n'         "$head"          >> "$path"
    printf 'BATS_RUN_ID=%s\n'       "$run_id"        >> "$path"
    printf 'BATS_GENERATED_AT=%s\n' "$generated_at"  >> "$path"
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR10  VALID handoff → status:pass; bats_ok sourced from the handoff
#
# A .androidcommondoc/bats-result.<RUN_ID>.env file that satisfies ALL four
# validation criteria (HEAD match, non-empty run-id, BATS_GENERATED_AT >=
# started_at, completeness fields present) must be selected by emit-qg-result.sh
# and the counts it recorded (BATS_OK=1631) must appear verbatim in the emitted
# qg-result.json suite_summary.bats_ok — proving the handoff is consumed, not
# the TAP log.
#
# The TAP fallback log is intentionally written with a DIFFERENT ok count (2)
# so any regression that falls back to the log is immediately caught.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR10 PASS: VALID handoff (HEAD + run-id + generated_at>=started_at + complete) → status:pass, bats_ok from handoff" {
    # 1. Commit a file so HEAD is a real sha
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR10"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # 2. Write --init first (to set started_at in the JSON so handoff discovery has a gate)
    local started_at
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    python3 -c "
import json, sys
obj = {'schema_version': 1, 'status': 'running', 'started_at': sys.argv[1],
       'head': sys.argv[2], 'wave_slug': 'test-slug', 'updated_at': sys.argv[1],
       'steps': [], 'suite_summary': {}}
with open(sys.argv[3], 'w') as f: json.dump(obj, f, indent=2); f.write('\n')
" "$started_at" "$current_head" "$out"

    # 3. Write a VALID handoff with BATS_OK=1631 (distinctive sentinel)
    #    BATS_GENERATED_AT is 1 second AFTER started_at — satisfies >=
    local generated_at
    generated_at="$(date -u -d '+1 second' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
                    python3 -c "from datetime import datetime,timedelta,timezone; \
                    t=datetime.now(timezone.utc)+timedelta(seconds=1); \
                    print(t.strftime('%Y-%m-%dT%H:%M:%SZ'))")"

    write_handoff "$ACDOC" "run-abc-1" "$current_head" "$generated_at" \
                  1631 0 1631 true pass

    # 4. Write the fallback TAP log with a DIFFERENT ok count (2) —
    #    ensures the test fails if emit falls back to the log instead of the handoff
    printf '1..2\nok 1 first\nok 2 second\n' > "$log"

    # 5. Write all-pass report
    write_report_all_pass "$rpt"

    # 6. Run emit in final mode, pointing at the REPO root so it can find the handoff
    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]

    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "pass" ]

    # bats_ok must be 1631 (from the handoff), NOT 2 (from the fallback log)
    bats_ok_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_ok', -1))
" "$out")"
    [ "$bats_ok_field" = "1631" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR11a  INVALID handoff: BATS_GENERATED_AT < started_at → rejected → fallback
#          + partial log → status:fail + bats_complete:false
#
# A handoff from a PREVIOUS QG run on the same HEAD has a BATS_GENERATED_AT
# that pre-dates the current QG's started_at.  The discovery logic must reject
# it (criterion iii).  With no valid handoff the fallback re-greps the TAP log;
# the fixture log is partial (2 ok out of 1..5) → completeness fails → status:fail.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR11a FAIL: handoff BATS_GENERATED_AT < started_at (previous-QG leftover rejected) → fallback + partial log → status:fail" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR11a"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # started_at is NOW; handoff generated_at is BEFORE started_at → stale
    local started_at
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    local old_generated_at="2020-01-01T00:00:00Z"

    python3 -c "
import json, sys
obj = {'schema_version': 1, 'status': 'running', 'started_at': sys.argv[1],
       'head': sys.argv[2], 'wave_slug': 'test-slug', 'updated_at': sys.argv[1],
       'steps': [], 'suite_summary': {}}
with open(sys.argv[3], 'w') as f: json.dump(obj, f, indent=2); f.write('\n')
" "$started_at" "$current_head" "$out"

    # Stale handoff: generated_at predates started_at → must be rejected
    write_handoff "$ACDOC" "run-stale-1" "$current_head" "$old_generated_at" \
                  1631 0 1631 true pass

    # Fallback log is PARTIAL: 2 ok but plan says 1..5 → completeness fails
    printf '1..5\nok 1 alpha\nok 2 beta\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 1 ]
    [ -f "$out" ]

    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "fail" ]

    bats_complete_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_complete', 'MISSING'))
" "$out")"
    [ "$bats_complete_field" = "False" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR11b  INVALID handoff: BATS_HEAD != current HEAD → rejected → fallback
#          + partial log → status:fail + bats_complete:false
#
# A handoff produced against a different commit (different HEAD) must be
# rejected by criterion (i).  The fallback again uses a partial log → fail.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR11b FAIL: handoff BATS_HEAD != current HEAD (HEAD mismatch rejected) → fallback + partial log → status:fail" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR11b"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    local started_at
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    local generated_at
    generated_at="$(date -u -d '+1 second' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || \
                    python3 -c "from datetime import datetime,timedelta,timezone; \
                    t=datetime.now(timezone.utc)+timedelta(seconds=1); \
                    print(t.strftime('%Y-%m-%dT%H:%M:%SZ'))")"

    python3 -c "
import json, sys
obj = {'schema_version': 1, 'status': 'running', 'started_at': sys.argv[1],
       'head': sys.argv[2], 'wave_slug': 'test-slug', 'updated_at': sys.argv[1],
       'steps': [], 'suite_summary': {}}
with open(sys.argv[3], 'w') as f: json.dump(obj, f, indent=2); f.write('\n')
" "$started_at" "$current_head" "$out"

    # Handoff uses a WRONG HEAD (deadbeef…) — must be rejected by criterion (i)
    local wrong_head="deadbeef0000000000000000000000000000000000"
    write_handoff "$ACDOC" "run-wrong-head-1" "$wrong_head" "$generated_at" \
                  1631 0 1631 true pass

    # Fallback log is PARTIAL
    printf '1..5\nok 1 alpha\nok 2 beta\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 1 ]
    [ -f "$out" ]

    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "fail" ]

    bats_complete_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_complete', 'MISSING'))
" "$out")"
    [ "$bats_complete_field" = "False" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR12  NO handoff present → fallback to clean complete TAP log → status:pass
#
# When no .androidcommondoc/bats-result.*.env files exist (e.g. this is an
# --eval-only run, or the scratch dir was cleared), emit-qg-result.sh must
# fall back gracefully to re-grepping the TAP log and apply the same 4-part
# completeness assertion.  A clean complete log (1..N + N ok + 0 not ok) must
# still produce status:pass — confirming the fallback path is also green-capable.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR12 PASS: NO handoff present → fallback to complete TAP log → status:pass" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR12"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # Write --init so started_at is present (handoff discovery only runs if started_at exists)
    local started_at
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    python3 -c "
import json, sys
obj = {'schema_version': 1, 'status': 'running', 'started_at': sys.argv[1],
       'head': sys.argv[2], 'wave_slug': 'test-slug', 'updated_at': sys.argv[1],
       'steps': [], 'suite_summary': {}}
with open(sys.argv[3], 'w') as f: json.dump(obj, f, indent=2); f.write('\n')
" "$started_at" "$current_head" "$out"

    # Ensure no handoff files exist in ACDOC (freshly created dir in setup — should be empty)
    # (ACDOC is $REPO/.androidcommondoc; teardown removes the whole REPO)

    # Complete TAP log: 3 ok, plan 1..3, no not-ok, no Executed warning
    printf '1..3\nok 1 alpha\nok 2 beta\nok 3 gamma\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]

    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "pass" ]

    # bats_complete must be true (4-part completeness passed on the fallback log)
    bats_complete_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_complete', 'MISSING'))
" "$out")"
    [ "$bats_complete_field" = "True" ]
}
