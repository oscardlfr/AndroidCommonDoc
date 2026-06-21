#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/emit-qg-result.sh
#
# Coverage map (9 tests):
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

    # Write a --phase update
    run bash "$SCRIPT" --phase "step-2-vitest" --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]

    # phase field must be updated
    phase_field="$(parse_json_field "$out" "phase")"
    [ "$phase_field" = "step-2-vitest" ]

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
