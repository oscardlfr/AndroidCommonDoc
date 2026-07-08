#!/usr/bin/env bash
# emit-qg-result.sh — Writes .planning/wave-<slug>/qg-result.json (gitignored).
#
# Orchestrator-facing QG verdict signal. NOT a substitute for push-proof.json.
# NOT consumed by verify-proof, pre-push, or quality-gate-manifest.json.
# Never touches emit-push-proof.sh, verify-proof, or push-proof.json.
# Doc-contract for degraded-env fail semantics: docs/agents/qg-proof-push-gate.md
# ("qg-result.json Schema" section, Boundary list).
#
# Modes:
#   --init               Write status:running, started_at, head
#   --phase <name>       Bump updated_at + phase (heartbeat)
#   (default / final)    Discover run-bats handoff OR re-grep log → compute verdict →
#                        write status:pass|fail. Exit 0 iff pass.
#
# Usage:
#   emit-qg-result.sh --init [--out <path>|--slug <slug> --project-root <path>]
#   emit-qg-result.sh --phase <name> [--out <path>|--slug <slug> --project-root <path>]
#   emit-qg-result.sh [--report <path>] [--bats-log <path>] [--out <path>|--slug <slug> --project-root <path>]
#
# Options:
#   --init                  Initialise a fresh qg-result.json with status:running
#   --phase <name>          Update phase heartbeat only
#   --report <path>         QG report JSON (default: .androidcommondoc/quality-gate-report.json)
#   --bats-log <path>       Bats log (default: .androidcommondoc/suite-bats.log)
#   --out <path>            Override output path entirely (skips slug resolution; useful in tests)
#   --slug <slug>           Override wave slug (only used when --out is not given)
#   --project-root <path>   Project root (default: ANDROID_COMMON_DOC or script parent)
#
# Schema:
#   {schema_version, status(running|pass|fail), head, wave_slug, phase?,
#    started_at, updated_at, steps[],
#    suite_summary{bats_total,bats_not_ok,bats_ok,bats_expected,bats_complete}}
#
# Fail-safe rules (final mode):
#   - Missing report file          => status:fail
#   - No bats evidence (ok==0)     => status:fail  (1..0 plan-only log is NOT evidence)
#   - not_ok > 0                   => status:fail
#   - Completeness check fails     => status:fail  (partial / truncated run)
#   - Any required step !PASS      => status:fail
#   - All above OK                 => status:pass, exit 0
#
# Handoff discovery (final mode, LD2):
#   run-bats.sh (full-run) writes .androidcommondoc/bats-result.<RUN_ID>.env.
#   emit discovers the best valid candidate: HEAD-match + run-id non-empty +
#   BATS_GENERATED_AT >= started_at + completeness fields well-formed.
#   If none valid, falls back to re-grepping the TAP log with the same 4-part check.
#   SECURITY: handoff files are parsed key-by-key — NOT blindly sourced.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/wave-slug.sh"

# ── Defaults ──────────────────────────────────────────────────────────────────
PROJECT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
MODE="final"
PHASE_NAME=""
REPORT_PATH=""
BATS_LOG_PATH=""
OUT_PATH=""
SLUG_OVERRIDE=""

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --init)
            MODE="init"
            shift
            ;;
        --phase)
            MODE="phase"
            PHASE_NAME="$2"
            shift 2
            ;;
        --report)
            REPORT_PATH="$2"
            shift 2
            ;;
        --bats-log)
            BATS_LOG_PATH="$2"
            shift 2
            ;;
        --out)
            OUT_PATH="$2"
            shift 2
            ;;
        --slug)
            SLUG_OVERRIDE="$2"
            shift 2
            ;;
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0
            ;;
        *)
            echo "[emit-qg-result] ERROR: unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

# ── Resolve output path ───────────────────────────────────────────────────────
if [[ -z "$OUT_PATH" ]]; then
    # Resolve slug
    if [[ -n "$SLUG_OVERRIDE" ]]; then
        WAVE_SLUG="$SLUG_OVERRIDE"
    else
        WAVE_SLUG="$(get_wave_slug "$PROJECT_ROOT")"
    fi
    if [[ -z "$WAVE_SLUG" ]]; then
        echo "[emit-qg-result] ERROR: could not resolve wave slug. Set CLAUDE_WAVE_SLUG or use --slug." >&2
        exit 1
    fi
    OUT_PATH="$PROJECT_ROOT/.planning/wave-${WAVE_SLUG}/qg-result.json"
else
    # Still need slug for the JSON field — derive from OUT_PATH dir name if not given
    if [[ -n "$SLUG_OVERRIDE" ]]; then
        WAVE_SLUG="$SLUG_OVERRIDE"
    else
        WAVE_SLUG="$(get_wave_slug "$PROJECT_ROOT" || true)"
        if [[ -z "$WAVE_SLUG" ]]; then
            # Best-effort: extract from parent dir name
            WAVE_SLUG="$(basename "$(dirname "$OUT_PATH")" | sed 's/^wave-//' || echo "unknown")"
        fi
    fi
fi

# ── Resolve defaults for report / bats log / manifest ─────────────────────────
if [[ -z "$REPORT_PATH" ]]; then
    REPORT_PATH="$PROJECT_ROOT/.androidcommondoc/quality-gate-report.json"
fi
if [[ -z "$BATS_LOG_PATH" ]]; then
    BATS_LOG_PATH="$PROJECT_ROOT/.androidcommondoc/suite-bats.log"
fi
# MANIFEST_PATH mirrors emit-push-proof.sh's derivation: the root-level
# quality-gate-manifest.json is the sole source of required/conditional step ids
# (READ-only — no schema change, no protocol_digest involvement here).
MANIFEST_PATH="$PROJECT_ROOT/quality-gate-manifest.json"

# ── Helpers ───────────────────────────────────────────────────────────────────
get_head() {
    git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"
}

now_utc() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

atomic_write() {
    local target="$1"
    local content="$2"
    local tmpfile
    tmpfile="${TMPDIR:-/tmp}/emit-qg-result-$$.json"
    mkdir -p "$(dirname "$target")"
    printf '%s\n' "$content" > "$tmpfile"
    mv "$tmpfile" "$target"
}

# parse_handoff_key FILE KEY
# Extracts a single value from a handoff .env file by parsing the known KEY=value
# line explicitly — NOT via `source`. A tampered file cannot execute code this way.
parse_handoff_key() {
    local file="$1"
    local key="$2"
    grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2-
}

# ── Mode: --init ──────────────────────────────────────────────────────────────
if [[ "$MODE" == "init" ]]; then
    HEAD="$(get_head)"
    NOW="$(now_utc)"
    # Reset report scratch so prior-run prose cannot survive into this QG run.
    printf '{"steps":[]}\n' > "$REPORT_PATH"
    PAYLOAD="$(python3 -c "
import json, sys

head = sys.argv[1]
wave_slug = sys.argv[2]
now = sys.argv[3]

obj = {
    'schema_version': 1,
    'status': 'running',
    'head': head,
    'wave_slug': wave_slug,
    'phase': 'init',
    'started_at': now,
    'updated_at': now,
    'steps': [],
    'suite_summary': {},
}
print(json.dumps(obj, indent=2))
" "$HEAD" "$WAVE_SLUG" "$NOW" 2>/dev/null || echo '{"schema_version":1,"status":"running","error":"serialization-failed"}')"

    atomic_write "$OUT_PATH" "$PAYLOAD"
    echo "[emit-qg-result] --init written: $OUT_PATH" >&2
    exit 0
fi

# ── Mode: --phase ─────────────────────────────────────────────────────────────
if [[ "$MODE" == "phase" ]]; then
    NOW="$(now_utc)"
    # Read existing file if present; otherwise start a minimal object
    EXISTING="{}"
    if [[ -f "$OUT_PATH" ]]; then
        EXISTING="$(cat "$OUT_PATH")"
    fi
    PAYLOAD="$(python3 -c "
import json, sys

existing_raw = sys.argv[1]
phase_name = sys.argv[2]
now = sys.argv[3]

try:
    obj = json.loads(existing_raw)
except Exception:
    obj = {}

obj['phase'] = phase_name
obj['updated_at'] = now
obj.setdefault('status', 'running')
print(json.dumps(obj, indent=2))
" "$EXISTING" "$PHASE_NAME" "$NOW" 2>/dev/null || echo '{"schema_version":1,"status":"running","error":"phase-update-failed"}')"

    atomic_write "$OUT_PATH" "$PAYLOAD"
    echo "[emit-qg-result] --phase '$PHASE_NAME' written: $OUT_PATH" >&2
    exit 0
fi

# ── Mode: final (default) ─────────────────────────────────────────────────────
HEAD="$(get_head)"
NOW="$(now_utc)"

# Read existing to preserve started_at
EXISTING_JSON="{}"
if [[ -f "$OUT_PATH" ]]; then
    EXISTING_JSON="$(cat "$OUT_PATH")"
fi

# Extract started_at from the existing qg-result.json for handoff validation.
# started_at is written at --init time; format is %Y-%m-%dT%H:%M:%SZ (same as
# BATS_GENERATED_AT in run-bats.sh handoff) enabling lexicographic >= compare.
STARTED_AT=$(python3 -c "
import json, sys
try:
    obj = json.loads(sys.argv[1])
    print(obj.get('started_at', ''))
except Exception:
    print('')
" "$EXISTING_JSON" 2>/dev/null || true)
STARTED_AT=${STARTED_AT:-}

# ── Handoff discovery (LD2) ───────────────────────────────────────────────────
# Enumerate .androidcommondoc/bats-result.*.env scratch files.
# A candidate is VALID iff ALL of:
#   (i)   BATS_HEAD == current HEAD
#   (ii)  BATS_RUN_ID non-empty
#   (iii) BATS_GENERATED_AT >= started_at (lexicographic; same UTC format — no date -d)
#   (iv)  completeness fields present and well-formed
# Among valid candidates, pick MAX BATS_GENERATED_AT (deterministic).
# SECURITY: parse known keys individually — never `source` the scratch file.

HANDOFF_DIR="$PROJECT_ROOT/.androidcommondoc"
BEST_HANDOFF=""
BEST_GENERATED_AT=""

if [[ -n "$STARTED_AT" ]]; then
    for env_file in "$HANDOFF_DIR"/bats-result.*.env; do
        [[ -f "$env_file" ]] || continue

        h_head=$(parse_handoff_key "$env_file" "BATS_HEAD")
        h_run_id=$(parse_handoff_key "$env_file" "BATS_RUN_ID")
        h_generated_at=$(parse_handoff_key "$env_file" "BATS_GENERATED_AT")
        h_expected=$(parse_handoff_key "$env_file" "BATS_EXPECTED")
        h_total=$(parse_handoff_key "$env_file" "BATS_TOTAL")
        h_ok=$(parse_handoff_key "$env_file" "BATS_OK")
        h_not_ok=$(parse_handoff_key "$env_file" "BATS_NOT_OK")
        h_complete=$(parse_handoff_key "$env_file" "BATS_COMPLETE")
        h_verdict=$(parse_handoff_key "$env_file" "BATS_VERDICT")

        # (i) HEAD must match
        [[ "$h_head" == "$HEAD" ]] || continue

        # (ii) RUN_ID must be non-empty
        [[ -n "$h_run_id" ]] || continue

        # (iii) BATS_GENERATED_AT >= started_at (lexicographic — both are %Y-%m-%dT%H:%M:%SZ)
        [[ -n "$h_generated_at" ]] || continue
        [[ "$h_generated_at" > "$STARTED_AT" || "$h_generated_at" == "$STARTED_AT" ]] || continue

        # (iv) completeness fields must be present and well-formed (non-empty)
        [[ -n "$h_expected" && -n "$h_total" && -n "$h_ok" && -n "$h_not_ok" && -n "$h_complete" && -n "$h_verdict" ]] || continue

        # Candidate is valid — track MAX by BATS_GENERATED_AT
        if [[ -z "$BEST_GENERATED_AT" || "$h_generated_at" > "$BEST_GENERATED_AT" ]]; then
            BEST_GENERATED_AT="$h_generated_at"
            BEST_HANDOFF="$env_file"
        fi
    done
else
    echo "[emit-qg-result] INFO: no started_at in qg-result.json — skipping handoff discovery, using fallback" >&2
fi

# ── Source suite_summary from best valid handoff (or fallback) ────────────────
BATS_EVIDENCE=false
BATS_NOT_OK=0
BATS_OK=0
BATS_TOTAL=0
BATS_EXPECTED=0
BATS_COMPLETE=false

if [[ -n "$BEST_HANDOFF" ]]; then
    echo "[emit-qg-result] INFO: using handoff: $BEST_HANDOFF (generated_at=$BEST_GENERATED_AT)" >&2

    BATS_OK=$(parse_handoff_key "$BEST_HANDOFF" "BATS_OK")
    BATS_OK=${BATS_OK:-0}
    BATS_NOT_OK=$(parse_handoff_key "$BEST_HANDOFF" "BATS_NOT_OK")
    BATS_NOT_OK=${BATS_NOT_OK:-0}
    BATS_EXPECTED=$(parse_handoff_key "$BEST_HANDOFF" "BATS_EXPECTED")
    BATS_EXPECTED=${BATS_EXPECTED:-0}
    BATS_TOTAL=$(parse_handoff_key "$BEST_HANDOFF" "BATS_TOTAL")
    BATS_TOTAL=${BATS_TOTAL:-0}
    h_complete_raw=$(parse_handoff_key "$BEST_HANDOFF" "BATS_COMPLETE")
    h_verdict_raw=$(parse_handoff_key "$BEST_HANDOFF" "BATS_VERDICT")

    # Bats verdict from handoff: COMPLETE==true AND VERDICT==pass AND NOT_OK==0
    if [[ "$h_complete_raw" == "true" && "$h_verdict_raw" == "pass" && "$BATS_NOT_OK" -eq 0 ]]; then
        BATS_COMPLETE=true
        BATS_EVIDENCE=true
    else
        BATS_COMPLETE=false
        # Treat as evidence if ok > 0 (for accurate count reporting), but verdict is fail
        if [[ "$BATS_OK" -gt 0 ]]; then
            BATS_EVIDENCE=true
        fi
    fi

else
    # ── Fallback: re-grep the TAP log + same 4-part completeness assertion ────────
    echo "[emit-qg-result] INFO: no valid handoff found — falling back to TAP log: $BATS_LOG_PATH" >&2

    if [[ -f "$BATS_LOG_PATH" ]]; then
        # Strip \r before all greps (CRLF safety — mirrors run-bats.sh)
        clean_log="$(tr -d '\r' < "$BATS_LOG_PATH")"

        not_ok_raw=$(grep -c "^not ok" <<< "$clean_log" || true)
        BATS_NOT_OK=${not_ok_raw:-0}
        ok_raw=$(grep -c "^ok " <<< "$clean_log" || true)
        BATS_OK=${ok_raw:-0}

        # Evidence requires at least one ok line
        if [[ "$BATS_OK" -gt 0 ]]; then
            BATS_EVIDENCE=true
            BATS_TOTAL=$(( BATS_OK + BATS_NOT_OK ))

            # 4-part completeness assertion (mirrors run-bats.sh LD1)
            plan_count=$(grep -c "^1\.\.[0-9]" <<< "$clean_log" || true)
            plan_count=${plan_count:-0}

            if [[ "$plan_count" -eq 1 ]]; then
                BATS_EXPECTED=$(grep "^1\.\.[0-9]" <<< "$clean_log" | sed 's/^1\.\.\([0-9][0-9]*\).*/\1/')
                BATS_EXPECTED=${BATS_EXPECTED:-0}

                has_exec_warning=false
                if grep -q "bats warning: Executed" <<< "$clean_log" 2>/dev/null; then
                    has_exec_warning=true
                fi

                if [[ "$BATS_TOTAL" -eq "$BATS_EXPECTED" && "$has_exec_warning" == "false" && "$BATS_NOT_OK" -eq 0 ]]; then
                    BATS_COMPLETE=true
                fi
            fi
            # plan_count != 1 → BATS_COMPLETE stays false (incomplete/malformed)
        fi
    fi
fi

# Evaluate report (steps) ──────────────────────────────────────────────────────
REPORT_EXISTS=false
STEPS_JSON="[]"
ALL_REQUIRED_PASS=true

if [[ -f "$REPORT_PATH" ]]; then
    REPORT_EXISTS=true
    EVAL_RESULT="$(python3 -c "
import json, sys

try:
    report = json.load(open(sys.argv[1], encoding='utf-8'))
    manifest = json.load(open(sys.argv[2], encoding='utf-8'))
    steps = report.get('steps', [])
    steps_json = json.dumps(steps)
    # Manifest-membership lookup (BL-W4-4): quality-gate-manifest.json's required_steps[].id
    # is the SOLE source of required-ness — report.steps[] entries never carry a 'required'
    # key (per append_step_json), so the old s.get('required', True) default treated every
    # step (incl. legitimately-SKIPped conditional ones) as required. Report step entries key
    # their id under 'step' (NOT 'id' — that key belongs to the manifest side only).
    required_ids = {rs.get('id') for rs in manifest.get('required_steps', [])}
    conditional_ids = {cs.get('id') for cs in manifest.get('conditional_steps', [])}
    required_steps = [s for s in steps if s.get('step') in required_ids]
    # Codex #3 fix: a conditional step that legitimately SKIPped must not flip the verdict
    # (that's the BL-W4-4 fix above), but a conditional step that RAN and FAILED must still
    # fail it — the manifest-membership filter alone would otherwise silently ignore a real
    # conditional failure just because it isn't in required_ids.
    failed_conditional_steps = [
        s for s in steps
        if s.get('step') in conditional_ids and s.get('result') == 'FAIL'
    ]
    all_pass = (
        bool(required_steps)
        and all(s.get('result', '') == 'PASS' for s in required_steps)
        and not failed_conditional_steps
    )
    print(steps_json)
    print('all_required_pass=' + str(all_pass).lower())
except Exception as e:
    print('[]')
    print('all_required_pass=false')
" "$REPORT_PATH" "$MANIFEST_PATH" 2>/dev/null || printf '[]\nall_required_pass=false')"

    STEPS_JSON="$(printf '%s' "$EVAL_RESULT" | head -1)"
    ALL_REQ_LINE="$(printf '%s' "$EVAL_RESULT" | tail -1)"
    if [[ "$ALL_REQ_LINE" != "all_required_pass=true" ]]; then
        ALL_REQUIRED_PASS=false
    fi
fi

# Determine verdict ────────────────────────────────────────────────────────────
VERDICT="fail"
FAIL_REASON=""

if [[ "$REPORT_EXISTS" == "false" ]]; then
    FAIL_REASON="report file not found: $REPORT_PATH"
elif [[ "$BATS_EVIDENCE" == "false" ]]; then
    FAIL_REASON="no bats run evidence (ok==0 or no log)"
elif [[ "$BATS_NOT_OK" -gt 0 ]]; then
    FAIL_REASON="bats not_ok=$BATS_NOT_OK"
elif [[ "$BATS_COMPLETE" == "false" ]]; then
    FAIL_REASON="bats completeness check failed (partial or truncated run; ok=$BATS_OK expected=$BATS_EXPECTED)"
elif [[ "$ALL_REQUIRED_PASS" == "false" ]]; then
    FAIL_REASON="one or more required report steps not PASS"
else
    VERDICT="pass"
fi

# Freshness check — if stale, override verdict to fail (blocking, no || true).
if [[ -f "$REPORT_PATH" ]]; then
    freshness_exit=0
    bash "$SCRIPT_DIR/lib/qg-report-freshness.sh" \
        --report "$REPORT_PATH" \
        --head   "$HEAD" \
        --bats-count "$BATS_OK" \
        --repo-root  "$PROJECT_ROOT" 2>&1 || freshness_exit=$?
    if [[ "$freshness_exit" -ne 0 ]]; then
        VERDICT="fail"
        FAIL_REASON="report-freshness check failed: stale step reasons detected (exit $freshness_exit)"
    fi
fi

# Build final JSON ─────────────────────────────────────────────────────────────
# suite_summary is extended with bats_expected + bats_complete (additive, backward-compatible)
PAYLOAD="$(python3 -c "
import json, sys

existing_raw = sys.argv[1]
head = sys.argv[2]
wave_slug = sys.argv[3]
verdict = sys.argv[4]
now = sys.argv[5]
steps_raw = sys.argv[6]
bats_total = int(sys.argv[7])
bats_not_ok = int(sys.argv[8])
bats_ok = int(sys.argv[9])
fail_reason = sys.argv[10]
bats_expected = int(sys.argv[11])
bats_complete_str = sys.argv[12]

try:
    existing = json.loads(existing_raw)
except Exception:
    existing = {}

steps = json.loads(steps_raw) if steps_raw and steps_raw != '[]' else []

obj = {
    'schema_version': 1,
    'status': verdict,
    'head': head,
    'wave_slug': wave_slug,
    'phase': 'final',
    'started_at': existing.get('started_at', now),
    'updated_at': now,
    'steps': steps,
    'suite_summary': {
        'bats_total': bats_total,
        'bats_not_ok': bats_not_ok,
        'bats_ok': bats_ok,
        'bats_expected': bats_expected,
        'bats_complete': bats_complete_str == 'true',
    },
}
if fail_reason:
    obj['fail_reason'] = fail_reason

print(json.dumps(obj, indent=2))
" "$EXISTING_JSON" "$HEAD" "$WAVE_SLUG" "$VERDICT" "$NOW" \
  "$STEPS_JSON" "$BATS_TOTAL" "$BATS_NOT_OK" "$BATS_OK" "$FAIL_REASON" \
  "$BATS_EXPECTED" "$BATS_COMPLETE" \
  2>/dev/null || echo '{"schema_version":1,"status":"fail","error":"serialization-failed"}')"

atomic_write "$OUT_PATH" "$PAYLOAD"
echo "[emit-qg-result] final written: $OUT_PATH (status=$VERDICT)" >&2

if [[ "$VERDICT" == "pass" ]]; then
    exit 0
else
    exit 1
fi
