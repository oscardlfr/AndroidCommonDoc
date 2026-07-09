#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/emit-qg-result.sh
#
# Coverage map (35 tests). #QR24-33 are Wave A additions (fail_class taxonomy,
# bats_complete/bats_verdict un-conflation, fail_class-never-a-mint-input, --init
# dual-stamp); #QR34 was added after ab6b0c8 taught fail_class about scope-mismatch
# mid-wave — see the "Wave A" section further down for their own header comments.
# #QR6/#QR7/#QR10/#QR13 also carry Wave A fixture repairs — see their own comments.
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
#   #QR13 --init resets quality-gate-report.json (REPORT_PATH) to {"steps":[]}
#   #QR14 foreign-HEAD SHA in step reason → freshness lib exits 1 (foreign HEAD blocked)
#   #QR15 stale bats-count in reason → freshness lib exits 1 (count mismatch blocked)
#   #QR16 PASS-semantics word in FAIL step reason → freshness lib exits 1
#   #QR17 well-formed carry metadata (byte-identical file) → freshness lib exits 0
#   #QR18 incomplete carry (missing current_head) → freshness lib exits 1
#   #QR19 non-byte-identical carry → freshness lib exits 1 (not byte-identical)
#   #QR20 false-positive guard A: merge-base SHA not in HEAD context → exits 0
#   #QR21 false-positive guard B: non-bats-context integers → exits 0
#   #QR22 BL-W4-4 REGRESSION: 7 required PASS + 1 conditional SKIP (no 'required' key)
#         → status:pass (manifest-membership lookup, not blind per-step default)
#   #QR23 BL-W4-4 sibling REGRESSION (Codex #3): 7 required PASS + 1 conditional FAIL
#         (no 'required' key) → status:fail (a conditional step that RAN and FAILED is
#         NOT exempt — only a legitimately-SKIPped one is; complements QR22)
#
# Isolation: every test uses mktemp -d + git init + teardown rm -rf.
# Fixtures written via --report / --bats-log / --out; NEVER touch live state.
#
# Mirrors fixture pattern from emit-push-proof.bats.

SCRIPT="$BATS_TEST_DIRNAME/../sh/emit-qg-result.sh"
EMITTER="$BATS_TEST_DIRNAME/../sh/emit-push-proof.sh"
MANIFEST_SRC="$BATS_TEST_DIRNAME/../../quality-gate-manifest.json"
SCRIPTS_SRC="$BATS_TEST_DIRNAME/.."
FRESHNESS_LIB="$BATS_TEST_DIRNAME/../sh/lib/qg-report-freshness.sh"

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

# write_report_pass_with_conditional_skip <path> — #QR22 regression fixture (BL-W4-4).
# All 7 required_steps[] at PASS; exactly ONE conditional_steps[] entry at SKIP with NO
# 'required' key — real append_step_json output NEVER carries a 'required' field (unlike
# write_report_all_pass() above, which manually sets 'required': False on its SKIP
# entries). The old evaluator's blind per-step default (s.get('required', True)) treats
# a 'required'-less step as required, so this exact SKIP step would flip status:fail;
# the fix's quality-gate-manifest.json required_steps[].id / conditional_steps[].id
# membership lookup must not.
write_report_pass_with_conditional_skip() {
    local path="$1"
    python3 - "$path" "$MANIFEST_SRC" << 'PYEOF'
import json, sys
report_path   = sys.argv[1]
manifest_path = sys.argv[2]
manifest = json.load(open(manifest_path, encoding='utf-8'))
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({'step': rs['id'], 'ran': True, 'result': 'PASS'})
conditional_steps = manifest.get('conditional_steps', [])
assert conditional_steps, 'manifest must declare at least one conditional step'
first_conditional = conditional_steps[0]['id']
# Deliberately NO 'required' key — this is the exact shape that trips the old
# blind per-step default (s.get('required', True)).
steps.append({'step': first_conditional, 'ran': False, 'result': 'SKIP',
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

# write_report_pass_with_conditional_fail <path> — #QR23 regression fixture
# (BL-W4-4 sibling, Codex #3). All 7 required_steps[] at PASS; exactly ONE
# conditional_steps[] entry at FAIL (the step genuinely RAN and failed — not a
# legitimate predicate-false SKIP) with NO 'required' key, same non-vacuous shape as
# #QR22's helper. Complements QR22: a conditional step that RAN and FAILED must NOT be
# exempt the way a legitimately-SKIPped one is — only 'result': 'SKIP' is exempt.
# Regression: the current manifest-membership lookup filters required_steps[] purely by
# step-id membership in quality-gate-manifest.json's required_steps[].id, so a
# conditional step's 'result' value (SKIP or FAIL) is never inspected at all — a
# conditional FAIL is silently excluded from the required-set exactly like a
# conditional SKIP is, producing a false status:pass. The fix must additionally check:
# any step whose id is in conditional_steps[].id AND whose result == 'FAIL' also fails
# the report.
write_report_pass_with_conditional_fail() {
    local path="$1"
    python3 - "$path" "$MANIFEST_SRC" << 'PYEOF'
import json, sys
report_path   = sys.argv[1]
manifest_path = sys.argv[2]
manifest = json.load(open(manifest_path, encoding='utf-8'))
steps = []
for rs in manifest.get('required_steps', []):
    steps.append({'step': rs['id'], 'ran': True, 'result': 'PASS'})
conditional_steps = manifest.get('conditional_steps', [])
assert conditional_steps, 'manifest must declare at least one conditional step'
first_conditional = conditional_steps[0]['id']
# Deliberately NO 'required' key (mirrors #QR22's helper) — the manifest-membership
# lookup, not a hand-set field, must be what determines the outcome. 'ran': True
# distinguishes this from a legitimate SKIP (predicate evaluated true; the check
# actually executed and failed).
steps.append({'step': first_conditional, 'ran': True, 'result': 'FAIL',
              'reason': 'predicate true in isolated test repo; check genuinely failed'})
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

# write_freshness_report <path> <step_id> <result> <reason> [carried] [source_head] [current_head] [files_json]
# Writes a minimal QG report with a single step whose fields are given explicitly.
# Used by QR13-QR21 to exercise qg-report-freshness.sh without touching the main QG manifest path.
write_freshness_report() {
    local path="$1"
    local step_id="$2"
    local result="$3"
    local reason="$4"
    local carried="${5:-false}"
    local source_head="${6:-}"
    local current_head_val="${7:-}"
    local files_json="${8:-[]}"
    python3 - "$path" "$step_id" "$result" "$reason" "$carried" "$source_head" "$current_head_val" "$files_json" << 'PYEOF'
import json, sys
p              = sys.argv[1]
step_id        = sys.argv[2]
result         = sys.argv[3]
reason         = sys.argv[4]
carried_raw    = sys.argv[5]
source_head    = sys.argv[6]
current_head_v = sys.argv[7]
files_raw      = sys.argv[8]
carried = (carried_raw.lower() == 'true')
entry = {'step': step_id, 'ran': True, 'result': result, 'reason': reason}
if carried:
    entry['carried'] = True
if source_head:
    entry['source_head'] = source_head
if current_head_v:
    entry['current_head'] = current_head_v
try:
    entry['files'] = json.loads(files_raw)
except Exception:
    entry['files'] = []
r = {'steps': [entry]}
with open(p,'w',encoding='utf-8',newline='\n') as f: json.dump(r,f,indent=2); f.write('\n')
PYEOF
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR1  status:pass when report all-PASS + clean bats log
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR1 PASS: all-pass report + clean bats log → qg-result.json status=pass, exit 0" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # See #QR4's comment: the required_steps evaluator reads quality-gate-manifest.json
    # from --project-root, which now correctly resolves inside the isolated $REPO.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    write_clean_bats_log "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
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

    # See #QR4's comment: keeps this test's report side genuinely all-PASS, so the
    # fail it asserts is provably caused by the ^not ok log, not a missing manifest.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    write_not_ok_bats_log "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
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

    # See #QR4's comment: keeps this test's report side genuinely all-PASS, so the
    # fail it asserts is provably caused by the empty log, not a missing manifest.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    printf '' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
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

    # BL-W4-4: the required_steps evaluator now reads quality-gate-manifest.json from
    # --project-root (manifest-membership lookup, not a per-step 'required' default) —
    # mirrors the #QR6/#QR7 GUARDRAIL fixtures below, which already copy it in.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

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
    cp "$SCRIPTS_SRC/sh/lib/bats-handoff.sh"            "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"       "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/rehash-registry.sh"             "$REPO/scripts/sh/"

    # Commit all fixtures — tree must be clean before run-qg
    git -C "$REPO" add -A
    git -C "$REPO" commit --quiet -m "test(fixtures): QR6 fixture commit"
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

    local slug="test-slug"
    local wave_dir="$REPO/.planning/wave-$slug"
    mkdir -p "$wave_dir"

    # Write arch verdicts for the slug
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

    # Production order: --init FIRST (resets REPORT_PATH scratch), THEN build the report.
    # This matches the quality-gater template sequence: --init → steps populate report → mint.
    # C1 made --init reset quality-gate-report.json; so --init must precede report-building.
    local qg_out="$wave_dir/qg-result.json"
    run bash "$SCRIPT" --init --out "$qg_out" --project-root "$REPO" --slug "$slug"
    [ "$status" -eq 0 ]
    [ -f "$qg_out" ]

    # Build report AFTER --init (--init reset the file; now populate it fresh)
    write_report_all_pass "$ACDOC/quality-gate-report.json"
    # Wave A: --init already stamped started_at into this same file (D6 fix), but
    # write_report_all_pass above just overwrote the whole file without it — re-add it
    # here inline (scoped to #QR6/#QR7 only, per arch-testing's amendment: NOT a shared
    # write_report_all_pass() patch, which would contaminate #QR10/11a/11b/12's own
    # specific handoff scenarios). A valid full-scope HEAD-bound handoff is also needed
    # now that run-qg's test-suite-evidence-* check requires real evidence behind the
    # test-suite:PASS step write_report_all_pass builds by default.
    python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" << 'PYEOF'
import json, sys, datetime
rpt_path = sys.argv[1]
mfst_path = sys.argv[2]
rpt = json.load(open(rpt_path, encoding='utf-8'))
mfst = json.load(open(mfst_path, encoding='utf-8'))
by_id = {s['step']: s for s in rpt['steps']}
by_id['path-manifest-audit'] = {'step': 'path-manifest-audit', 'ran': True, 'result': 'PASS',
                                 'reason': 'All touched files in manifest.'}
by_id['production-file-verify'] = {'step': 'production-file-verify', 'ran': True, 'result': 'PASS'}
rpt['steps'] = list(by_id.values())
rpt['started_at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(rpt_path, 'w', encoding='utf-8') as f:
    json.dump(rpt, f, indent=2); f.write('\n')
PYEOF
    local qr6_head
    qr6_head="$(git -C "$REPO" rev-parse HEAD)"
    local qr6_run_id="qr6-fixture-$$-${RANDOM}"
    printf 'BATS_OK=%s\nBATS_NOT_OK=%s\nBATS_EXPECTED=%s\nBATS_TOTAL=%s\nBATS_COMPLETE=%s\nBATS_VERDICT=%s\nBATS_LOG=%s\nBATS_HEAD=%s\nBATS_RUN_ID=%s\nBATS_GENERATED_AT=%s\nBATS_SCOPE=%s\n' \
        42 0 42 42 true pass /dev/null "$qr6_head" "$qr6_run_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" full \
        > "$ACDOC/bats-result.${qr6_run_id}.env"

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
    cp "$SCRIPTS_SRC/sh/lib/bats-handoff.sh"            "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"       "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/rehash-registry.sh"             "$REPO/scripts/sh/"

    git -C "$REPO" add -A
    git -C "$REPO" commit --quiet -m "test(fixtures): QR7 fixture commit"
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

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

    # Production order: --init FIRST (resets REPORT_PATH scratch), THEN build the report.
    # C1 made --init reset quality-gate-report.json; --init must precede report-building so
    # the report seen by run-qg (step 1) and verify-proof (step 3) is byte-identical.
    local qg_out="$wave_dir/qg-result.json"
    bash "$SCRIPT" --init --out "$qg_out" --project-root "$REPO" --slug "$slug"

    # Build the report AFTER --init — the report that run-qg will hash into push-proof.json.
    write_report_all_pass "$ACDOC/quality-gate-report.json"
    # Wave A: --init already stamped started_at into this file (D6 fix), but
    # write_report_all_pass above just overwrote it without one — re-add it here inline
    # (scoped to #QR6/#QR7 only, mirroring #QR6's own comment). A valid full-scope
    # HEAD-bound handoff is also needed for run-qg's test-suite-evidence-* check.
    python3 - "$ACDOC/quality-gate-report.json" "$REPO/quality-gate-manifest.json" << 'PYEOF'
import json, sys, datetime
rpt_path = sys.argv[1]
mfst_path = sys.argv[2]
rpt = json.load(open(rpt_path, encoding='utf-8'))
by_id = {s['step']: s for s in rpt['steps']}
by_id['path-manifest-audit'] = {'step': 'path-manifest-audit', 'ran': True, 'result': 'PASS',
                                 'reason': 'All touched files in manifest.'}
by_id['production-file-verify'] = {'step': 'production-file-verify', 'ran': True, 'result': 'PASS'}
rpt['steps'] = list(by_id.values())
rpt['started_at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(rpt_path, 'w', encoding='utf-8') as f:
    json.dump(rpt, f, indent=2); f.write('\n')
PYEOF
    local qr7_run_id="qr7-fixture-$$-${RANDOM}"
    printf 'BATS_OK=%s\nBATS_NOT_OK=%s\nBATS_EXPECTED=%s\nBATS_TOTAL=%s\nBATS_COMPLETE=%s\nBATS_VERDICT=%s\nBATS_LOG=%s\nBATS_HEAD=%s\nBATS_RUN_ID=%s\nBATS_GENERATED_AT=%s\nBATS_SCOPE=%s\n' \
        42 0 42 42 true pass /dev/null "$HEAD_SHA" "$qr7_run_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" full \
        > "$ACDOC/bats-result.${qr7_run_id}.env"

    # Step 1: run-qg WITHOUT additional qg-result.json content — record the outcome.
    # qg-result.json exists (--init wrote it above) but is gitignored so clean-tree passes.
    run bash -c "CLAUDE_WAVE_SLUG='$slug' bash '$REPO/scripts/sh/emit-push-proof.sh' --subcommand run-qg --repo-root '$REPO'"
    local rq_status="$status"
    [ "$rq_status" -eq 0 ]

    # Verify push-proof.json was created
    [ -f "$ACDOC/push-proof.json" ]

    # Step 2: qg-result.json was already written by --init above; it's present in the gitignored path.
    [ -f "$qg_out" ]

    # Step 3: verify-proof — must behave identically (qg-result.json not consumed).
    # The report file is byte-identical to what run-qg hashed (no further writes occurred).
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

    # See #QR4's comment: keeps this test's report side genuinely all-PASS, so the
    # fail it asserts is provably caused by the zero-ok log, not a missing manifest.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    # Only a TAP plan line — no ok or not ok lines (simulates 1..0 zero-test suite)
    printf '1..0\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
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

# write_handoff <dir> <run_id> <head> <generated_at> <ok> <not_ok> <expected> <complete> <verdict> [<scope>]
# Writes a synthetic .androidcommondoc/bats-result.<run_id>.env handoff file
# mirroring the format emitted by run-bats.sh (one KEY=VALUE per line, no eval).
#
# Wave A fix: this helper never wrote BATS_SCOPE at all. emit-qg-result.sh's
# select_bats_handoff call unconditionally passes --require-scope full, so a
# scope-less handoff is now rejected in Pass 3b (status=scope-mismatch, not "ok") —
# breaking #QR10's premise (the handoff must be genuinely CONSUMED, not the fallback
# TAP log). scope defaults to "full" (quality-gater always invokes run-bats.sh with
# no explicit targets) so existing callers (#QR11a/#QR11b, which test rejection for
# an UNRELATED reason — stale generated_at / foreign head respectively — and are
# unaffected by scope either way) keep working without modification.
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
    local scope="${10:-full}"
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
    printf 'BATS_SCOPE=%s\n'        "$scope"         >> "$path"
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

    # BL-W4-4: required_steps evaluator now reads quality-gate-manifest.json from
    # --project-root (mirrors #QR6/#QR7 GUARDRAIL fixtures, which already copy it in).
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

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

    # BL-W4-4: required_steps evaluator now reads quality-gate-manifest.json from
    # --project-root (mirrors #QR6/#QR7 GUARDRAIL fixtures, which already copy it in).
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

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

# ─────────────────────────────────────────────────────────────────────────────
# #QR13  --init clears report scratch AND stamps it (REPORT_PATH reset + D6 fix)
#
# --init must overwrite $ACDOC/quality-gate-report.json's steps to [] regardless
# of prior content — prior-run prose cannot survive into the new QG run. Seeding
# that file with a stale step and verifying the reset confirms this.
#
# Wave A (D6 fix): --init no longer resets to a bare {"steps":[]} — it now ALSO
# stamps schema_version/started_at/head (the QG-session anchor run-qg's
# report-started-at-* check and select_bats_handoff's --since floor both validate
# against). This test's assertion is widened accordingly: steps==[] (the original
# reset guarantee) AND the three new stamped fields are present.
#
# CRITICAL: assert $ACDOC/quality-gate-report.json (REPORT_PATH), NOT qg-result.json.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR13 PASS: --init resets quality-gate-report.json steps to [] and stamps schema_version/started_at/head" {
    local out="$REPO/qg-result.json"
    local report_path="$ACDOC/quality-gate-report.json"

    # Seed the REPORT_PATH with a non-empty stale step
    python3 -c "
import json, sys
stale = {'steps': [{'step': 'stale-step', 'ran': True, 'result': 'PASS', 'reason': 'old run'}]}
with open(sys.argv[1],'w',encoding='utf-8') as f: json.dump(stale,f,indent=2); f.write('\n')
" "$report_path"

    # Verify seed is there before running --init
    steps_before="$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(len(d.get('steps',[]))) " "$report_path")"
    [ "$steps_before" = "1" ]

    # Run --init
    run bash "$SCRIPT" --init --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]

    # Assert REPORT_PATH's steps are reset to [] AND the D6 stamp fields are present.
    report_content="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
assert d.get('steps') == [], f'Expected steps==[], got {d.get(\"steps\")!r}'
assert d.get('schema_version') == 1, f'Expected schema_version==1, got {d.get(\"schema_version\")!r}'
assert d.get('started_at'), f'Expected non-empty started_at (D6 fix), got {d.get(\"started_at\")!r}'
assert 'head' in d, 'Expected head field present (D6 fix)'
print('ok')
" "$report_path")"
    [ "$report_content" = "ok" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR14  Foreign-HEAD reason blocked
#
# A report step whose reason references HEAD=<sha-that-is-not-current>
# must cause the freshness lib to exit 1 with stderr containing "foreign HEAD".
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR14 FAIL: foreign-HEAD SHA in step reason → lib exits 1, stderr=foreign HEAD" {
    # Real commit so we have a valid HEAD in the fixture repo
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR14"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    # Seed with a step whose reason contains HEAD=<stale-sha> (40 hex chars, not the current HEAD)
    write_freshness_report "$rpt" "bats-suite" "PASS" "bats PASS @ HEAD=deadbeef00000000000000000000000000000000"

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "1645" --repo-root "$REPO"
    [ "$status" -eq 1 ]
    [[ "$output" == *"foreign HEAD"* ]] || [[ "$stderr" == *"foreign HEAD"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR15  Stale bats-count reason blocked
#
# A reason containing "bats 9999 tests passed" when the authoritative count
# is FIXTURE_COUNT=1645 must cause exit 1 with stderr "bats count mismatch".
# Count is stored in a named var to avoid hardcoded literals in the test body.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR15 FAIL: stale bats-count in reason → lib exits 1, stderr=bats count mismatch" {
    local FIXTURE_COUNT=1645
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    write_freshness_report "$rpt" "bats-suite" "PASS" "bats 9999 tests passed"

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "$FIXTURE_COUNT" --repo-root "$REPO"
    [ "$status" -eq 1 ]
    [[ "$output" == *"bats count mismatch"* ]] || [[ "$stderr" == *"bats count mismatch"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR16  PASS-semantics on FAIL step blocked
#
# A step with result:FAIL whose reason contains "vitest PASS" (a PASS-semantics
# word) must cause exit 1 with stderr containing "PASS-semantics".
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR16 FAIL: PASS-semantics word in FAIL step reason → lib exits 1, stderr=PASS-semantics" {
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    write_freshness_report "$rpt" "vitest-step" "FAIL" "vitest PASS"

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "1645" --repo-root "$REPO"
    [ "$status" -eq 1 ]
    [[ "$output" == *"PASS-semantics"* ]] || [[ "$stderr" == *"PASS-semantics"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR17  Well-formed carry metadata accepted
#
# Two commits: commit 1 creates carry-file (source_head), commit 2 creates an
# UNRELATED file (current_head). The carry-file is NOT touched in commit 2.
# Step has carried:true + matching source_head/current_head + files:[<carry-file>].
# Lib must exit 0.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR17 PASS: well-formed carry metadata (byte-identical file) → lib exits 0" {
    # Commit 1: create the carry-file
    printf 'carried content\n' > "$REPO/carried-result.txt"
    git -C "$REPO" add carried-result.txt
    git -C "$REPO" commit --quiet -m "test: commit 1 for QR17 — carry-file"
    local source_head
    source_head="$(git -C "$REPO" rev-parse HEAD)"

    # Commit 2: create an unrelated file (carry-file NOT modified)
    printf 'unrelated\n' > "$REPO/other-file.txt"
    git -C "$REPO" add other-file.txt
    git -C "$REPO" commit --quiet -m "test: commit 2 for QR17 — unrelated file"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    write_freshness_report "$rpt" "carried-step" "PASS" "carried from prior run" \
        "true" "$source_head" "$current_head" '["carried-result.txt"]'

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "1645" --repo-root "$REPO"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR18  Incomplete carry metadata rejected
#
# Same setup as QR17 but current_head is OMITTED from the step.
# Lib must exit 1 (missing current_head field).
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR18 FAIL: carry with missing current_head → lib exits 1" {
    # Commit 1: create the carry-file
    printf 'carried content\n' > "$REPO/carried-result-qr18.txt"
    git -C "$REPO" add carried-result-qr18.txt
    git -C "$REPO" commit --quiet -m "test: commit 1 for QR18 — carry-file"
    local source_head
    source_head="$(git -C "$REPO" rev-parse HEAD)"

    # Commit 2: unrelated file
    printf 'unrelated\n' > "$REPO/other-file-qr18.txt"
    git -C "$REPO" add other-file-qr18.txt
    git -C "$REPO" commit --quiet -m "test: commit 2 for QR18 — unrelated file"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    # Omit current_head (pass empty string for that arg → write_freshness_report skips it)
    local rpt="$ACDOC/quality-gate-report.json"
    write_freshness_report "$rpt" "carried-step" "PASS" "carried from prior run" \
        "true" "$source_head" "" '["carried-result-qr18.txt"]'

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "1645" --repo-root "$REPO"
    [ "$status" -eq 1 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR19  Non-byte-identical carry rejected
#
# Two commits where the carry-file IS modified in commit 2.
# git diff --quiet returns non-zero → lib must exit 1 with stderr
# containing "not byte-identical".
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR19 FAIL: carry file modified between source_head and current_head → lib exits 1, stderr=not byte-identical" {
    # Commit 1: create carry-file with initial content
    printf 'version A\n' > "$REPO/carried-result-qr19.txt"
    git -C "$REPO" add carried-result-qr19.txt
    git -C "$REPO" commit --quiet -m "test: commit 1 for QR19 — carry-file v1"
    local source_head
    source_head="$(git -C "$REPO" rev-parse HEAD)"

    # Commit 2: MODIFY the carry-file (making it non-identical)
    printf 'version B\n' > "$REPO/carried-result-qr19.txt"
    git -C "$REPO" add carried-result-qr19.txt
    git -C "$REPO" commit --quiet -m "test: commit 2 for QR19 — carry-file v2 (modified)"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    write_freshness_report "$rpt" "carried-step" "PASS" "carried from prior run" \
        "true" "$source_head" "$current_head" '["carried-result-qr19.txt"]'

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "1645" --repo-root "$REPO"
    [ "$status" -eq 1 ]
    [[ "$output" == *"not byte-identical"* ]] || [[ "$stderr" == *"not byte-identical"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR20  False-positive guard A — merge-base SHA in non-HEAD context passes
#
# reason: "merge-base: deadbeef — no changes" does not match the HEAD_CONTEXT_RE
# because "merge-base:" has no HEAD prefix word. Current HEAD differs from deadbeef.
# Lib must exit 0 (no HEAD-context anchor → no match → no invariant A violation).
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR20 PASS: merge-base SHA in reason not in HEAD context → lib exits 0 (no false positive)" {
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    # "deadbeef" appears after "merge-base:" — NOT in a HEAD= / HEAD: / @ context
    write_freshness_report "$rpt" "some-step" "PASS" "merge-base: deadbeef00000000000000000000000000000000 — no changes"

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "1645" --repo-root "$REPO"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR21  False-positive guard B — unrelated integer does not trip count-coherence
#
# reason: "Detekt: 3 files checked; vitest 2593 passing" contains integers (3
# and 2593) but neither is preceded by the "bats" keyword. With authoritative
# count=FIXTURE_COUNT=1645, lib must exit 0 (BATS_COUNT_RE does not match).
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR21 PASS: non-bats-context integers in reason → lib exits 0 (no false count match)" {
    local FIXTURE_COUNT=1645
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local rpt="$ACDOC/quality-gate-report.json"
    write_freshness_report "$rpt" "detekt-step" "PASS" "Detekt: 3 files checked; vitest 2593 passing"

    run bash "$FRESHNESS_LIB" --report "$rpt" --head "$current_head" --bats-count "$FIXTURE_COUNT" --repo-root "$REPO"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR22  BL-W4-4 REGRESSION: 7 required_steps PASS + 1 conditional SKIP
#         (no 'required' key) → status:pass
#
# Old evaluator (L392-396): required_steps = [s for s in steps if s.get('required',
# True)] — every step (including a legitimately-SKIPped conditional one) defaults to
# required when the 'required' key is absent, which is how real append_step_json output
# always looks. A single conditional SKIP therefore flips status:fail. Fix reads
# quality-gate-manifest.json's own required_steps[].id / conditional_steps[].id
# membership instead of the blind per-step default.
#
# ANTI-VACUOUS-TEST NOTE: this fixture deliberately omits the 'required' key from the
# SKIP step (via write_report_pass_with_conditional_skip(), NOT write_report_all_pass()
# above, which hand-sets 'required': False — a field real output never carries and
# would make this test pass identically before AND after the fix). Here, the
# manifest-membership lookup — not a hand-set field — is what's under test.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR22 BL-W4-4 REGRESSION: 7 required PASS + 1 conditional SKIP (no 'required' key) → status:pass" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # See #QR4's comment: without this, the manifest-membership lookup fails closed
    # on a missing manifest (all_required_pass=false) regardless of the SKIP-exemption
    # logic under test — silently masking the very regression this test guards.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    write_clean_bats_log "$log"
    write_report_pass_with_conditional_skip "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "pass" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR23  BL-W4-4 sibling REGRESSION (Codex #3): 7 required_steps PASS + 1
#         conditional FAIL (no 'required' key) → status:fail
#
# Complements #QR22 (conditional SKIP is exempt) — a conditional step whose predicate
# was TRUE and which genuinely RAN and FAILED must NOT be exempt the same way. Current
# evaluator (post-BL-W4-4): required_steps = [s for s in steps if s.get('step') in
# required_ids] — this filters PURELY by step-id membership in
# quality-gate-manifest.json's required_steps[].id; a conditional step's own 'result'
# value is never inspected at all, so a conditional FAIL is silently excluded from the
# required-set exactly like a conditional SKIP is, producing a false status:pass.
#
# Empirically reproduced against the unfixed script before authoring this test (7
# required PASS + 1 conditional FAIL, manifest present in the isolated repo): status
# came back "pass", exit 0 — confirming the regression is real, not theoretical.
#
# ANTI-VACUOUS-TEST NOTE: mirrors #QR22's helper shape — no manual 'required' key (real
# append_step_json output never carries one), so the manifest-membership lookup is what
# determines the outcome, not a hand-set field.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR23 BL-W4-4 sibling REGRESSION (Codex #3): 7 required PASS + 1 conditional FAIL (no 'required' key) → status:fail" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # See #QR4's comment: without this, the manifest-membership lookup fails closed
    # on a missing manifest (all_required_pass=false) regardless of whether the
    # conditional-FAIL-is-not-exempt logic under test is reached at all — this test
    # would report status:fail even if that regression were reintroduced, silently.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    write_clean_bats_log "$log"
    write_report_pass_with_conditional_fail "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 1 ]
    [ -f "$out" ]
    status_field="$(parse_json_field "$out" "status")"
    [ "$status_field" = "fail" ]
}

# ═════════════════════════════════════════════════════════════════════════════
# Wave A — fail_class taxonomy, bats_complete/bats_verdict un-conflation,
# fail_class-never-a-mint-input, --init dual-stamp (#QR24-33)
# ═════════════════════════════════════════════════════════════════════════════

# write_started_at_qg_result <out_path> <head> — seeds a minimal --init-shaped
# qg-result.json so handoff discovery has a --since floor to validate against.
# Returns the started_at value on stdout.
write_started_at_qg_result() {
    local out_path="$1" head="$2"
    local started_at
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    python3 -c "
import json, sys
obj = {'schema_version': 1, 'status': 'running', 'started_at': sys.argv[1],
       'head': sys.argv[2], 'wave_slug': 'test-slug', 'updated_at': sys.argv[1],
       'steps': [], 'suite_summary': {}}
with open(sys.argv[3], 'w') as f: json.dump(obj, f, indent=2); f.write('\n')
" "$started_at" "$head" "$out_path"
    printf '%s' "$started_at"
}

# now_plus_1s — a timestamp 1 second after "now", for a handoff's generated_at to
# satisfy select_bats_handoff's --since floor (generated_at >= started_at).
now_plus_1s() {
    python3 -c "
from datetime import datetime, timedelta, timezone
print((datetime.now(timezone.utc) + timedelta(seconds=1)).strftime('%Y-%m-%dT%H:%M:%SZ'))
"
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR24  fail_class=clean when evidence is real, complete, and not_ok==0.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR24 fail_class=clean when evidence is real, complete, and not_ok==0" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # See #QR4's comment: without this, status flips to fail (missing-manifest
    # fail-closed) even though fail_class correctly reads "clean" — the exit-0
    # assertion below would fail for a reason unrelated to fail_class taxonomy.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    write_clean_bats_log "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "clean" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR25  fail_class=stale-evidence when a well-formed, HEAD-matching, full-scope
# handoff exists but its generated_at predates started_at (genuinely stale, not
# merely absent/malformed).
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR25 fail_class=stale-evidence when a well-formed HEAD-matching handoff predates started_at" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR25"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null

    # Well-formed, matching head, full scope (default) — but generated_at predates
    # started_at (2020, well before "now") -> genuinely stale.
    write_handoff "$ACDOC" "run-qr25-stale" "$current_head" "2020-01-01T00:00:00Z" \
                  1631 0 1631 true pass

    printf '1..3\nok 1 a\nok 2 b\nok 3 c\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "stale-evidence" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR26  fail_class=no-evidence when no handoff exists and the fallback TAP log has
# zero ok lines.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR26 fail_class=no-evidence when no handoff exists and the fallback log has zero ok lines" {
    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    # See #QR4's comment: keeps this test's report side genuinely all-PASS, so the
    # no-evidence fail_class it asserts is provably from the empty log, not the
    # separate (and here irrelevant) missing-manifest fail-closed path.
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"

    printf '' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" --project-root "$REPO" --slug "test-slug"
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "no-evidence" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR27  fail_class=suite-failed when the selected (valid, ok-status) handoff has
# not_ok>0 — bats-handoff.sh's own selection does not exclude a dirty run.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR27 fail_class=suite-failed when the selected handoff has not_ok>0" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR27"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null
    local generated_at
    generated_at="$(now_plus_1s)"
    write_handoff "$ACDOC" "run-qr27-dirty" "$current_head" "$generated_at" \
                  5 2 7 true fail

    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "suite-failed" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR28  fail_class=incomplete when the selected handoff has BATS_COMPLETE=false
# but not_ok==0 — a truncated run, not a failing one.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR28 fail_class=incomplete when the selected handoff has BATS_COMPLETE=false" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR28"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null
    local generated_at
    generated_at="$(now_plus_1s)"
    write_handoff "$ACDOC" "run-qr28-incomplete" "$current_head" "$generated_at" \
                  2 0 5 false fail

    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "incomplete" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR29  D3 un-conflation A: a COMPLETE run with real failures (complete=true,
# not_ok>0) must be bats_complete=true, bats_verdict=fail — distinguishable from
# a truncated run, which is bats_complete=false regardless of bats_verdict.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR29 D3 un-conflation A: complete=true + not_ok>0 → bats_complete=true, bats_verdict=fail" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR29"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null
    local generated_at
    generated_at="$(now_plus_1s)"
    # complete=true (all 7 tests accounted for), but 2 of them failed.
    write_handoff "$ACDOC" "run-qr29-complete-fail" "$current_head" "$generated_at" \
                  5 2 7 true fail

    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    local bats_complete_field bats_verdict_field
    bats_complete_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_complete', 'MISSING'))
" "$out")"
    bats_verdict_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_verdict', 'MISSING'))
" "$out")"
    [ "$bats_complete_field" = "True" ]
    [ "$bats_verdict_field" = "fail" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR30  D3 un-conflation B: a TRUNCATED run where every test that DID run passed
# (complete=false, not_ok=0) must be bats_complete=false, bats_verdict=pass —
# proving the two fields are genuinely independent, not merely two names for the
# same computation.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR30 D3 un-conflation B: complete=false + not_ok=0 → bats_complete=false, bats_verdict=pass" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR30"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null
    local generated_at
    generated_at="$(now_plus_1s)"
    # complete=false (truncated: 3 of an expected 10), but the 3 that ran all passed.
    write_handoff "$ACDOC" "run-qr30-incomplete-pass" "$current_head" "$generated_at" \
                  3 0 10 false pass

    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    local bats_complete_field bats_verdict_field
    bats_complete_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_complete', 'MISSING'))
" "$out")"
    bats_verdict_field="$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
print(d.get('suite_summary', {}).get('bats_verdict', 'MISSING'))
" "$out")"
    [ "$bats_complete_field" = "False" ]
    [ "$bats_verdict_field" = "pass" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR31  fail_class is qg-result.json-only and is NEVER read by the mint. Injects
# an obviously-wrong fail_class ("stale-evidence") into an otherwise fully-passing
# qg-result.json and confirms run-qg still mints successfully — proving fail_class
# has zero influence on the actual push-proof.json emitter, mirroring #QR6/#QR7's
# own GUARDRAIL pattern (a real run-qg mint via the copied emitter + its lib deps).
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR31 GUARDRAIL: fail_class is never a mint input — run-qg succeeds regardless of its value" {
    cp "$MANIFEST_SRC" "$REPO/quality-gate-manifest.json"
    mkdir -p "$REPO/scripts/sh/lib"
    cp "$SCRIPTS_SRC/sh/emit-push-proof.sh"            "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/lib/manifest-digest.sh"         "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/audit-append.sh"            "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/resolve-required-roles.js"  "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/lib/bats-handoff.sh"            "$REPO/scripts/sh/lib/"
    cp "$SCRIPTS_SRC/sh/qg-registry-integrity.sh"       "$REPO/scripts/sh/"
    cp "$SCRIPTS_SRC/sh/rehash-registry.sh"             "$REPO/scripts/sh/"

    git -C "$REPO" add -A
    git -C "$REPO" commit --quiet -m "test(fixtures): QR31 fixture commit"
    HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

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

    local qg_out="$wave_dir/qg-result.json"
    run bash "$SCRIPT" --init --out "$qg_out" --project-root "$REPO" --slug "$slug"
    [ "$status" -eq 0 ]

    write_report_all_pass "$ACDOC/quality-gate-report.json"
    python3 - "$ACDOC/quality-gate-report.json" << 'PYEOF'
import json, sys, datetime
rpt_path = sys.argv[1]
rpt = json.load(open(rpt_path, encoding='utf-8'))
by_id = {s['step']: s for s in rpt['steps']}
by_id['path-manifest-audit'] = {'step': 'path-manifest-audit', 'ran': True, 'result': 'PASS',
                                 'reason': 'All touched files in manifest.'}
by_id['production-file-verify'] = {'step': 'production-file-verify', 'ran': True, 'result': 'PASS'}
rpt['steps'] = list(by_id.values())
rpt['started_at'] = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
with open(rpt_path, 'w', encoding='utf-8') as f:
    json.dump(rpt, f, indent=2); f.write('\n')
PYEOF
    local qr31_run_id="qr31-fixture-$$-${RANDOM}"
    printf 'BATS_OK=%s\nBATS_NOT_OK=%s\nBATS_EXPECTED=%s\nBATS_TOTAL=%s\nBATS_COMPLETE=%s\nBATS_VERDICT=%s\nBATS_LOG=%s\nBATS_HEAD=%s\nBATS_RUN_ID=%s\nBATS_GENERATED_AT=%s\nBATS_SCOPE=%s\n' \
        42 0 42 42 true pass /dev/null "$HEAD_SHA" "$qr31_run_id" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" full \
        > "$ACDOC/bats-result.${qr31_run_id}.env"

    # Deliberately inject a WRONG fail_class into qg-result.json — run-qg never reads it.
    python3 -c "
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
d['fail_class'] = 'stale-evidence'
json.dump(d, open(sys.argv[1], 'w'), indent=2)
" "$qg_out"

    run bash -c "CLAUDE_WAVE_SLUG='$slug' bash '$REPO/scripts/sh/emit-push-proof.sh' --subcommand run-qg --repo-root '$REPO'"
    [ "$status" -eq 0 ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR32  fail_class precedence: stale-evidence > suite-failed. A genuinely-stale
# handoff exists (matching head, well-formed, full scope, too old) AND the
# fallback TAP log (which the stale handoff's rejection forces a fall-back to)
# itself contains a real failure. If precedence were wrong (e.g. suite-failed
# checked first), this would misreport as suite-failed instead.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR32 fail_class precedence: stale-evidence wins over suite-failed when both conditions could apply" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR32"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null

    write_handoff "$ACDOC" "run-qr32-stale" "$current_head" "2020-01-01T00:00:00Z" \
                  1631 0 1631 true pass

    # Fallback TAP log has a real failure — would classify as suite-failed on its own.
    printf '1..3\nok 1 a\nnot ok 2 b\nok 3 c\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "stale-evidence" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR33  --init stamps quality-gate-report.json AND qg-result.json with IDENTICAL
# started_at/head values (they "agree by construction" — the same NOW is reused
# for both writes), which is the anchor run-qg's report-started-at-* check and
# select_bats_handoff's --since floor both validate against.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR33 --init stamps quality-gate-report.json and qg-result.json with identical started_at/head" {
    local out="$REPO/qg-result.json"
    local report_path="$ACDOC/quality-gate-report.json"

    run bash "$SCRIPT" --init --out "$out" --project-root "$REPO" --slug "test-slug"
    [ "$status" -eq 0 ]
    [ -f "$out" ]
    [ -f "$report_path" ]

    local match
    match="$(python3 -c "
import json, sys
qg = json.load(open(sys.argv[1], encoding='utf-8'))
rpt = json.load(open(sys.argv[2], encoding='utf-8'))
assert qg.get('started_at'), 'started_at must be non-empty'
assert qg.get('started_at') == rpt.get('started_at'), f'started_at mismatch: qg={qg.get(\"started_at\")!r} rpt={rpt.get(\"started_at\")!r}'
assert qg.get('head') == rpt.get('head'), f'head mismatch: qg={qg.get(\"head\")!r} rpt={rpt.get(\"head\")!r}'
print('ok')
" "$out" "$report_path")"
    [ "$match" = "ok" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# #QR34  fail_class=scope-mismatch — a well-formed, HEAD-matching handoff that IS
# fresh enough (generated_at >= started_at) but scoped "targeted", not "full".
#
# Added after commit ab6b0c8 (landed mid-wave): emit-qg-result.sh's fail_class
# classifier originally had no scope-mismatch branch at all — bats-handoff.sh's Pass
# 3a/3b split (16ae614) had already taught the SELECTOR to distinguish "stale" from
# "scope-mismatch", but the CLASSIFIER here fell through straight to no-evidence,
# misreporting real, HEAD-matching, on-disk evidence as if there were none. Must be
# distinguishable from BOTH #QR25 (stale-evidence: nothing fresh enough exists at
# all) and #QR26 (no-evidence: no handoff, no ok lines) — this scenario has real,
# fresh, matching evidence that simply cannot be used because of its scope.
# ─────────────────────────────────────────────────────────────────────────────
@test "#QR34 fail_class=scope-mismatch when a fresh HEAD-matching handoff is scoped targeted, not full" {
    printf 'dummy\n' > "$REPO/dummy.txt"
    git -C "$REPO" add dummy.txt
    git -C "$REPO" commit --quiet -m "test: fixture commit for QR34"
    local current_head
    current_head="$(git -C "$REPO" rev-parse HEAD)"

    local out="$REPO/qg-result.json"
    local log="$REPO/bats.log"
    local rpt="$REPO/report.json"

    write_started_at_qg_result "$out" "$current_head" > /dev/null
    local generated_at
    generated_at="$(now_plus_1s)"
    write_handoff "$ACDOC" "run-qr34-targeted" "$current_head" "$generated_at" \
                  5 0 5 true pass "targeted"

    printf '1..3\nok 1 a\nok 2 b\nok 3 c\n' > "$log"
    write_report_all_pass "$rpt"

    run bash "$SCRIPT" --bats-log "$log" --report "$rpt" --out "$out" \
             --project-root "$REPO" --slug "test-slug"
    fail_class_field="$(parse_json_field "$out" "fail_class")"
    [ "$fail_class_field" = "scope-mismatch" ]
}
