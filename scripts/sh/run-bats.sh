#!/usr/bin/env bash
# run-bats.sh — Authoritative bats result wrapper.
#
# Runs npx bats against the given targets and evaluates the output log.
# Exit-code is determined by the CONTENT of the log (^not ok count), NOT
# by bats's own exit code — fixing the well-known bats false-green bug where
# npx bats exits 0 even when `not ok` lines are present.
#
# Usage:
#   run-bats.sh [--log <path>] [--eval-only] [--project-root <path>] [<bats-targets...>]
#
# Options:
#   --log <path>         Log file path (default: .androidcommondoc/suite-bats.log)
#   --eval-only          Skip running bats; evaluate the existing log file only
#   --project-root <path>  Project root override (default: ANDROID_COMMON_DOC or script parent)
#   <bats-targets...>    Bats targets (default: scripts/tests/*.bats)
#
# Rules:
#   - ok_ct == 0          => error + exit 1 (no ok lines = no tests ran; MUST NOT read green)
#   - not_ok > 0          => print "FAIL: N not-ok" + not-ok lines, exit 1
#   - else                => print "PASS: 0 not-ok, <ok_ct> ok", exit 0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/wave-slug.sh"

# ── Defaults ──────────────────────────────────────────────────────────────────
ROOT="${ANDROID_COMMON_DOC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
LOG=""
EVAL_ONLY=false
TARGETS=()

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --log)
            LOG="$2"
            shift 2
            ;;
        --eval-only)
            EVAL_ONLY=true
            shift
            ;;
        --project-root)
            ROOT="$2"
            shift 2
            ;;
        --help|-h)
            sed -n '2,/^$/p' "$0"
            exit 0
            ;;
        -*)
            echo "[run-bats] ERROR: unknown option: $1" >&2
            exit 1
            ;;
        *)
            TARGETS+=("$1")
            shift
            ;;
    esac
done

# ── Defaults (post-parse) ─────────────────────────────────────────────────────
if [[ -z "$LOG" ]]; then
    LOG="$ROOT/.androidcommondoc/suite-bats.log"
fi

if [[ "${#TARGETS[@]}" -eq 0 ]]; then
    TARGETS=("$ROOT/scripts/tests/*.bats")
fi

# ── Run bats (unless --eval-only) ────────────────────────────────────────────
if [[ "$EVAL_ONLY" == "false" ]]; then
    mkdir -p "$(dirname "$LOG")"
    bats_rc=0
    # shellcheck disable=SC2068
    npx bats ${TARGETS[@]} > "$LOG" 2>&1 || bats_rc=$?
    echo "[run-bats] bats exited $bats_rc (content-authoritative eval follows)" >&2
fi

# ── Evaluate log (shared: run + eval-only modes) ──────────────────────────────
if [[ ! -f "$LOG" ]]; then
    echo "[run-bats] ERROR: log file not found: $LOG" >&2
    exit 1
fi

not_ok=$(grep -c "^not ok" "$LOG" || true)
not_ok=${not_ok:-0}
ok_ct=$(grep -c "^ok " "$LOG" || true)
ok_ct=${ok_ct:-0}

# ok_ct == 0 → zero tests ran (a "1..0" plan-only log or dead suite MUST NOT read green)
if [[ "$ok_ct" -eq 0 ]]; then
    echo "[run-bats] ERROR: no ok lines in log (ok=$ok_ct, not_ok=$not_ok) — no tests ran" >&2
    echo "[run-bats] Log: $LOG" >&2
    exit 1
fi

# Authoritative verdict: content-driven not-ok count
if [[ "$not_ok" -gt 0 ]]; then
    echo "[run-bats] FAIL: $not_ok not-ok, $ok_ct ok" >&2
    echo "--- not-ok lines ---" >&2
    grep "^not ok" "$LOG" >&2 || true
    echo "--------------------" >&2
    exit 1
fi

echo "[run-bats] PASS: 0 not-ok, $ok_ct ok" >&2
exit 0
