#!/usr/bin/env bash
# run-bats.sh — Authoritative bats result wrapper.
#
# Runs npx bats against the given targets and evaluates the output log.
# Exit-code is determined by the CONTENT of the log (^not ok count), NOT
# by bats's own exit code — fixing the well-known bats false-green bug where
# npx bats exits 0 even when `not ok` lines are present.
#
# Usage:
#   run-bats.sh [--log <path>] [--eval-only] [--project-root <path>]
#               [--expected <N>] [--cross-check-count] [<bats-targets...>]
#
# Options:
#   --log <path>           Log file path (default: .androidcommondoc/suite-bats.log)
#   --eval-only            Skip running bats; evaluate the existing log file only
#   --project-root <path>  Project root override (default: ANDROID_COMMON_DOC or script parent)
#   --expected <N>         Assert that the plan line 1..N equals N (optional override)
#   --cross-check-count    Cross-check ok_ct against `npx bats --count` (full-run mode only;
#                          skipped silently if npx is absent; not valid with --eval-only)
#   <bats-targets...>      Bats targets (default: scripts/tests directory)
#
# Rules (all four are complementary — none subsumes another):
#   - ok_ct == 0                             => error + exit 1 (no tests ran)
#   - not_ok > 0                             => print "FAIL: N not-ok" + lines, exit 1
#   - zero or multiple ^1..N plan lines      => error + exit 1 (malformed / merged TAP)
#   - (ok_ct + not_ok) != expected           => error + exit 1 (partial / truncated run)
#   - bats warning "Executed X instead of Y" => error + exit 1 (teardown race / over-count)
#   - all above satisfied                    => print "PASS: 0 not-ok, <ok_ct> ok", exit 0
#
# Full-run mode also writes a run-id-bound handoff (gitignored scratch; atomic temp+mv):
#   .androidcommondoc/bats-result.<BATS_RUN_ID>.env
# --eval-only MUST NOT write a handoff.
#
# CI-PARITY: keep this completeness logic identical to
#   .github/workflows/reusable-shell-tests.yml — pinned by scripts/tests/ci-bats-parity.bats

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/wave-slug.sh"

# ── Defaults ──────────────────────────────────────────────────────────────────
ROOT="${ANDROID_COMMON_DOC:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
LOG=""
EVAL_ONLY=false
TARGETS=()
EXPECTED_OVERRIDE=""
CROSS_CHECK=false

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
        --expected)
            EXPECTED_OVERRIDE="$2"
            shift 2
            ;;
        --cross-check-count)
            CROSS_CHECK=true
            shift
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
    TARGETS=( "$ROOT/scripts/tests" )
fi

# ── Generate a unique run-id ONCE at start ────────────────────────────────────
# Format: <UTC-timestamp>-<pid>-<random> — sortable + unique per invocation.
# Used in the handoff filename and BATS_RUN_ID field (full-run mode only).
BATS_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"

# ── Helpers ───────────────────────────────────────────────────────────────────
get_head() {
    git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "unknown"
}

now_utc() {
    # Format matches qg-result.json started_at — required for lexicographic >= compare in emit.
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# ── Run bats (unless --eval-only) ────────────────────────────────────────────
if [[ "$EVAL_ONLY" == "false" ]]; then
    mkdir -p "$(dirname "$LOG")"
    bats_rc=0
    npx bats "${TARGETS[@]}" > "$LOG" 2>&1 || bats_rc=$?
    echo "[run-bats] bats exited $bats_rc (content-authoritative eval follows)" >&2
fi

# ── Evaluate log (shared: run + eval-only modes) ──────────────────────────────
if [[ ! -f "$LOG" ]]; then
    echo "[run-bats] ERROR: log file not found: $LOG" >&2
    exit 1
fi

# Strip \r ONCE from the entire log before any greps — prevents CRLF artifacts
# from entering count variables or the plan-N extraction on Windows-produced logs.
clean_log="$(tr -d '\r' < "$LOG")"

not_ok=$(grep -c "^not ok" <<< "$clean_log" || true)
not_ok=${not_ok:-0}
ok_ct=$(grep -c "^ok " <<< "$clean_log" || true)
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
    grep "^not ok" <<< "$clean_log" >&2 || true
    echo "--------------------" >&2
    exit 1
fi

# ── Completeness assertion (LD1 c/d) ─────────────────────────────────────────
# Leading ^ anchor is REQUIRED — matches only a real TAP plan line at line-start,
# not a mid-line occurrence. Trailing $ intentionally omitted so a trailing CR
# cannot break the match (CRLF safety already handled by clean_log above).
plan_count=$(grep -c "^1\.\.[0-9]" <<< "$clean_log" || true)
plan_count=${plan_count:-0}

if [[ "$plan_count" -eq 0 ]]; then
    echo "[run-bats] ERROR: no ^1..N plan line found in log — malformed TAP output" >&2
    exit 1
fi

if [[ "$plan_count" -gt 1 ]]; then
    echo "[run-bats] ERROR: ${plan_count} plan lines found — merged or partial TAP output (expected exactly 1)" >&2
    exit 1
fi

# Extract the N value from the single plan line (clean_log already stripped of \r)
expected_n=$(grep "^1\.\.[0-9]" <<< "$clean_log" | sed 's/^1\.\.\([0-9][0-9]*\).*/\1/')
expected_n=${expected_n:-0}

# --expected <N> override: assert plan N == caller-supplied N
if [[ -n "$EXPECTED_OVERRIDE" ]]; then
    if [[ "$expected_n" -ne "$EXPECTED_OVERRIDE" ]]; then
        echo "[run-bats] ERROR: plan says 1..${expected_n} but --expected ${EXPECTED_OVERRIDE}" >&2
        exit 1
    fi
fi

# Total (ok + not_ok) must equal expected N — catches partial/truncated/raced runs.
# teardown_file failures can make total > N, so we assert == N, never >= N.
total=$(( ok_ct + not_ok ))
if [[ "$total" -ne "$expected_n" ]]; then
    echo "[run-bats] ERROR: completeness check failed — ran $total / expected $expected_n (ok=$ok_ct, not_ok=$not_ok)" >&2
    exit 1
fi

# bats warning: `# bats warning: Executed X instead of expected Y tests`
# Emitted on teardown_file failures or shell races that inflate/deflate the count.
if grep -q "bats warning: Executed" <<< "$clean_log" 2>/dev/null; then
    echo "[run-bats] ERROR: bats emitted an 'Executed instead of expected' warning — test count mismatch" >&2
    grep "bats warning: Executed" <<< "$clean_log" >&2 || true
    exit 1
fi

# ── Optional cross-check: npx bats --count (full-run mode only) ───────────────
# Guarded by command -v npx; skipped silently if npx absent (never a hard fail).
# Not valid with --eval-only (no targets in scope for --count).
if [[ "$EVAL_ONLY" == "false" && "$CROSS_CHECK" == "true" ]]; then
    if command -v npx >/dev/null 2>&1; then
        count_n=$(npx bats --count "${TARGETS[@]}" 2>/dev/null || true)
        count_n=${count_n:-0}
        if [[ -n "$count_n" && "$count_n" -gt 0 && "$count_n" -ne "$expected_n" ]]; then
            echo "[run-bats] WARN: --cross-check-count: npx bats --count=$count_n vs plan 1..${expected_n}" >&2
        else
            echo "[run-bats] cross-check: npx bats --count=$count_n matches plan 1..${expected_n}" >&2
        fi
    else
        echo "[run-bats] INFO: --cross-check-count skipped (npx not on PATH)" >&2
    fi
fi

COMPLETE=true
VERDICT="pass"
echo "[run-bats] PASS: 0 not-ok, $ok_ct ok (expected $expected_n, complete=$COMPLETE)" >&2

# ── Write run-id-bound handoff (full-run mode only) ───────────────────────────
# Path: $ROOT/.androidcommondoc/bats-result.<BATS_RUN_ID>.env
# .androidcommondoc/ is gitignored scratch — won't trip clean-tree assertions.
# Written atomically via unique temp file + mv. --eval-only MUST NOT reach here.
if [[ "$EVAL_ONLY" == "false" ]]; then
    HANDOFF_DIR="$ROOT/.androidcommondoc"
    HANDOFF_PATH="$HANDOFF_DIR/bats-result.${BATS_RUN_ID}.env"
    HANDOFF_TMP="${HANDOFF_DIR}/bats-result-tmp-$$.${RANDOM}.env"

    mkdir -p "$HANDOFF_DIR"

    BATS_HEAD="$(get_head)"
    BATS_GENERATED_AT="$(now_utc)"

    # Write known keys via printf — no eval, no ambiguous shell expansion
    printf 'BATS_OK=%s\n'           "$ok_ct"              >  "$HANDOFF_TMP"
    printf 'BATS_NOT_OK=%s\n'       "$not_ok"             >> "$HANDOFF_TMP"
    printf 'BATS_EXPECTED=%s\n'     "$expected_n"         >> "$HANDOFF_TMP"
    printf 'BATS_TOTAL=%s\n'        "$total"              >> "$HANDOFF_TMP"
    printf 'BATS_COMPLETE=%s\n'     "$COMPLETE"           >> "$HANDOFF_TMP"
    printf 'BATS_VERDICT=%s\n'      "$VERDICT"            >> "$HANDOFF_TMP"
    printf 'BATS_LOG=%s\n'          "$LOG"                >> "$HANDOFF_TMP"
    printf 'BATS_HEAD=%s\n'         "$BATS_HEAD"          >> "$HANDOFF_TMP"
    printf 'BATS_RUN_ID=%s\n'       "$BATS_RUN_ID"        >> "$HANDOFF_TMP"
    printf 'BATS_GENERATED_AT=%s\n' "$BATS_GENERATED_AT"  >> "$HANDOFF_TMP"

    mv "$HANDOFF_TMP" "$HANDOFF_PATH"
    echo "[run-bats] handoff written: $HANDOFF_PATH" >&2
fi

exit 0
