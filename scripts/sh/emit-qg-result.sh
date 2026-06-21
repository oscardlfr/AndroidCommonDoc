#!/usr/bin/env bash
# emit-qg-result.sh — Writes .planning/wave-<slug>/qg-result.json (gitignored).
#
# Orchestrator-facing QG verdict signal. NOT a substitute for push-proof.json.
# NOT consumed by verify-proof, pre-push, or quality-gate-manifest.json.
# Never touches emit-push-proof.sh, verify-proof, or push-proof.json.
#
# Modes:
#   --init               Write status:running, started_at, head
#   --phase <name>       Bump updated_at + phase (heartbeat)
#   (default / final)    Read report + bats log → compute verdict →
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
#    started_at, updated_at, steps[], suite_summary{bats_total,bats_not_ok,bats_ok}}
#
# Fail-safe rules (final mode):
#   - Missing report file      => status:fail
#   - No bats evidence         => status:fail
#   - not_ok > 0               => status:fail
#   - Any required step !PASS  => status:fail
#   - All above OK             => status:pass, exit 0

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

# ── Resolve defaults for report / bats log ────────────────────────────────────
if [[ -z "$REPORT_PATH" ]]; then
    REPORT_PATH="$PROJECT_ROOT/.androidcommondoc/quality-gate-report.json"
fi
if [[ -z "$BATS_LOG_PATH" ]]; then
    BATS_LOG_PATH="$PROJECT_ROOT/.androidcommondoc/suite-bats.log"
fi

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

# ── Mode: --init ──────────────────────────────────────────────────────────────
if [[ "$MODE" == "init" ]]; then
    HEAD="$(get_head)"
    NOW="$(now_utc)"
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

# Evaluate bats log ────────────────────────────────────────────────────────────
BATS_EVIDENCE=false
BATS_NOT_OK=0
BATS_OK=0
BATS_TOTAL=0

if [[ -f "$BATS_LOG_PATH" ]]; then
    not_ok_raw=$(grep -c "^not ok" "$BATS_LOG_PATH" || true)
    BATS_NOT_OK=${not_ok_raw:-0}
    ok_raw=$(grep -c "^ok " "$BATS_LOG_PATH" || true)
    BATS_OK=${ok_raw:-0}
    plan_raw=$(grep -cE "^1\.\.[0-9]+" "$BATS_LOG_PATH" || true)
    plan_ct=${plan_raw:-0}

    if [[ "$BATS_OK" -gt 0 || "$plan_ct" -gt 0 ]]; then
        BATS_EVIDENCE=true
        BATS_TOTAL=$(( BATS_OK + BATS_NOT_OK ))
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
    steps = report.get('steps', [])
    steps_json = json.dumps(steps)
    all_pass = all(
        s.get('result', '') == 'PASS'
        for s in steps
        if s.get('required', True)
    )
    print(steps_json)
    print('all_required_pass=' + str(all_pass).lower())
except Exception as e:
    print('[]')
    print('all_required_pass=false')
" "$REPORT_PATH" 2>/dev/null || printf '[]\nall_required_pass=false')"

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
    FAIL_REASON="no bats run evidence in log: $BATS_LOG_PATH"
elif [[ "$BATS_NOT_OK" -gt 0 ]]; then
    FAIL_REASON="bats not_ok=$BATS_NOT_OK"
elif [[ "$ALL_REQUIRED_PASS" == "false" ]]; then
    FAIL_REASON="one or more required report steps not PASS"
else
    VERDICT="pass"
fi

# Build final JSON ─────────────────────────────────────────────────────────────
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
    },
}
if fail_reason:
    obj['fail_reason'] = fail_reason

print(json.dumps(obj, indent=2))
" "$EXISTING_JSON" "$HEAD" "$WAVE_SLUG" "$VERDICT" "$NOW" \
  "$STEPS_JSON" "$BATS_TOTAL" "$BATS_NOT_OK" "$BATS_OK" "$FAIL_REASON" \
  2>/dev/null || echo '{"schema_version":1,"status":"fail","error":"serialization-failed"}')"

atomic_write "$OUT_PATH" "$PAYLOAD"
echo "[emit-qg-result] final written: $OUT_PATH (status=$VERDICT)" >&2

if [[ "$VERDICT" == "pass" ]]; then
    exit 0
else
    exit 1
fi
