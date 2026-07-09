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
#                          skipped silently if bats is not resolvable; not valid with --eval-only)
#   <bats-targets...>      Bats targets (default: scripts/tests directory)
#
# Rules (all four are complementary — none subsumes another; now recorded as fact
# variables and evaluated once at the end, rather than exiting mid-evaluation, so a
# handoff is ALWAYS written in run mode — see "Exit taxonomy" below):
#   - ok_ct == 0                             => no tests ran
#   - not_ok > 0                             => print "FAIL: N not-ok" + lines
#   - zero or multiple ^1..N plan lines      => malformed / merged TAP
#   - (ok_ct + not_ok) != expected            => partial / truncated run
#   - bats warning "Executed X instead of Y" => teardown race / over-count
#   - all above satisfied                    => print "PASS: 0 not-ok, <ok_ct> ok"
#
# Exit taxonomy (content-driven, NOT bats's own exit code; checked in this fixed order,
# mirroring the pre-Wave-A script's own check order — the FIRST unmet condition wins):
#   0  clean          — ok>0, not_ok==0, and the run is complete (single plan line,
#                        total==expected, no Executed-warning).
#   1  tests-failed   — not_ok>0 (checked before completeness — a complete-but-failing run
#                        is still exit 1, not 2; this is the D3 un-conflation fix).
#   2  no-evidence-or-incomplete — ok==0 (includes bats unresolvable and log missing),
#                        or the run is otherwise incomplete: zero/multiple plan lines,
#                        --expected mismatch, total != expected, or an Executed-warning.
#
# Full-run mode ALWAYS writes a run-id-bound handoff (gitignored scratch; atomic temp+mv),
# regardless of which exit code above applies — fixes D1 (previously nine mid-evaluation
# `exit 1` sites terminated the script before the handoff-writing code was ever reached,
# so only a fully-clean run left evidence behind at all):
#   .androidcommondoc/bats-result.<BATS_RUN_ID>.env
# --eval-only MUST NOT write a handoff.
#
# Handoff fields: BATS_OK/NOT_OK/EXPECTED/TOTAL/COMPLETE/VERDICT/LOG/HEAD/RUN_ID/GENERATED_AT
# (all pre-existing) plus, new in this wave:
#   BATS_SCOPE            full iff no positional target was given (quality-gater invokes
#                         with no args); targeted otherwise.
#   BATS_TARGET_DIGEST    git hash-object --stdin over the sorted target list.
#   BATS_ENV_FINGERPRINT  advisory only — never gating, never a mint input.
#
# No silent install: bats is invoked via `npx --no-install bats`, preceded by a
# resolvability probe. If bats cannot be resolved without a network install, no install is
# attempted — this produces exit 2 and an honest no-evidence handoff instead.
#
# CI-PARITY: keep the completeness-CHECKING logic (not-ok / plan-line / total / Executed-
# warning detection) identical to .github/workflows/reusable-shell-tests.yml — pinned by
# scripts/tests/ci-bats-parity.bats. The 0/1/2 exit-code taxonomy above is local to this
# script; CI's workflow YAML has no dependency on it (ci-bats-parity.bats never asserts an
# exit code or references run-bats.sh).

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
EXPLICIT_TARGETS=false

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
            EXPLICIT_TARGETS=true
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

# _bats_resolvable — true iff bats can be run WITHOUT a network install attempt.
_bats_resolvable() {
    command -v npx >/dev/null 2>&1 && npx --no-install bats --version >/dev/null 2>&1
}

# ── Derived fields (computed regardless of outcome; scope reflects caller intent) ─────────
# NOTE: deliberately `if/fi`, not a bare `[[ ]] && var=...` — the latter's exit status IS
# the test's when the test is false (no explicit target given, the common case), which
# would abort this whole script under `set -e` on every default invocation.
BATS_SCOPE="full"
if [[ "$EXPLICIT_TARGETS" == "true" ]]; then
    BATS_SCOPE="targeted"
fi

BATS_TARGET_DIGEST="$(printf '%s\n' "${TARGETS[@]}" | sort | git hash-object --stdin 2>/dev/null || echo "")"
BATS_ENV_FINGERPRINT="$(uname -s 2>/dev/null || echo unknown)-$(uname -m 2>/dev/null || echo unknown)-bash${BASH_VERSION:-unknown}"

# ── Fact variables (populated below; defaults are the "worst case" — no evidence) ────────
FACT_BATS_UNRESOLVABLE=false
FACT_LOG_MISSING=false
FACT_OK=0
FACT_NOT_OK=0
FACT_PLAN_COUNT=0
FACT_EXPECTED=0
FACT_TOTAL=0
FACT_PLAN_MALFORMED=false
FACT_EXPECTED_MISMATCH=false
FACT_TOTAL_MISMATCH=false
FACT_EXECUTED_WARNING=false

# ── Run bats (unless --eval-only) ─────────────────────────────────────────────
# No silent install: probe resolvability first; absent bats sets a fact, never installs.
if [[ "$EVAL_ONLY" == "false" ]]; then
    mkdir -p "$(dirname "$LOG")"
    if _bats_resolvable; then
        bats_rc=0
        npx --no-install bats "${TARGETS[@]}" > "$LOG" 2>&1 || bats_rc=$?
        echo "[run-bats] bats exited $bats_rc (content-authoritative eval follows)" >&2
    else
        FACT_BATS_UNRESOLVABLE=true
        echo "[run-bats] ERROR: bats not resolvable via 'npx --no-install' — no install attempted" >&2
    fi
fi

# ── Evaluate log (shared: run + eval-only modes) ──────────────────────────────
# A stale $LOG from a prior invocation must never be consulted when bats itself could not
# run this time — the unresolvable fact short-circuits before the file-existence check.
if [[ "$FACT_BATS_UNRESOLVABLE" == "true" ]]; then
    echo "[run-bats] INFO: skipping log evaluation — bats was not resolvable" >&2
elif [[ ! -f "$LOG" ]]; then
    echo "[run-bats] ERROR: log file not found: $LOG" >&2
    FACT_LOG_MISSING=true
else
    # Strip \r ONCE from the entire log before any greps — prevents CRLF artifacts
    # from entering count variables or the plan-N extraction on Windows-produced logs.
    clean_log="$(tr -d '\r' < "$LOG")"

    not_ok=$(grep -c "^not ok" <<< "$clean_log" || true)
    FACT_NOT_OK=${not_ok:-0}
    ok_ct=$(grep -c "^ok " <<< "$clean_log" || true)
    FACT_OK=${ok_ct:-0}

    # ok_ct == 0 → zero tests ran (a "1..0" plan-only log or dead suite MUST NOT read green)
    if [[ "$FACT_OK" -eq 0 ]]; then
        echo "[run-bats] ERROR: no ok lines in log (ok=$FACT_OK, not_ok=$FACT_NOT_OK) — no tests ran" >&2
        echo "[run-bats] Log: $LOG" >&2
    fi

    # Authoritative verdict: content-driven not-ok count
    if [[ "$FACT_NOT_OK" -gt 0 ]]; then
        echo "[run-bats] FAIL: $FACT_NOT_OK not-ok, $FACT_OK ok" >&2
        echo "--- not-ok lines ---" >&2
        grep "^not ok" <<< "$clean_log" >&2 || true
        echo "--------------------" >&2
    fi

    # ── Completeness assertion (LD1 c/d) ─────────────────────────────────────
    # Leading ^ anchor is REQUIRED — matches only a real TAP plan line at line-start,
    # not a mid-line occurrence. Trailing $ intentionally omitted so a trailing CR
    # cannot break the match (CRLF safety already handled by clean_log above).
    plan_count=$(grep -c "^1\.\.[0-9]" <<< "$clean_log" || true)
    FACT_PLAN_COUNT=${plan_count:-0}

    if [[ "$FACT_PLAN_COUNT" -eq 0 ]]; then
        echo "[run-bats] ERROR: no ^1..N plan line found in log — malformed TAP output" >&2
        FACT_PLAN_MALFORMED=true
    elif [[ "$FACT_PLAN_COUNT" -gt 1 ]]; then
        echo "[run-bats] ERROR: ${FACT_PLAN_COUNT} plan lines found — merged or partial TAP output (expected exactly 1)" >&2
        FACT_PLAN_MALFORMED=true
    else
        # Extract the N value from the single plan line (clean_log already stripped of \r)
        expected_n=$(grep "^1\.\.[0-9]" <<< "$clean_log" | sed 's/^1\.\.\([0-9][0-9]*\).*/\1/')
        FACT_EXPECTED=${expected_n:-0}

        # --expected <N> override: assert plan N == caller-supplied N
        if [[ -n "$EXPECTED_OVERRIDE" && "$FACT_EXPECTED" -ne "$EXPECTED_OVERRIDE" ]]; then
            echo "[run-bats] ERROR: plan says 1..${FACT_EXPECTED} but --expected ${EXPECTED_OVERRIDE}" >&2
            FACT_EXPECTED_MISMATCH=true
        fi

        # Total (ok + not_ok) must equal expected N — catches partial/truncated/raced runs.
        # teardown_file failures can make total > N, so we assert == N, never >= N.
        FACT_TOTAL=$(( FACT_OK + FACT_NOT_OK ))
        if [[ "$FACT_TOTAL" -ne "$FACT_EXPECTED" ]]; then
            echo "[run-bats] ERROR: completeness check failed — ran $FACT_TOTAL / expected $FACT_EXPECTED (ok=$FACT_OK, not_ok=$FACT_NOT_OK)" >&2
            FACT_TOTAL_MISMATCH=true
        fi
    fi

    # bats warning: `# bats warning: Executed X instead of expected Y tests`
    # Emitted on teardown_file failures or shell races that inflate/deflate the count.
    if grep -q "bats warning: Executed" <<< "$clean_log" 2>/dev/null; then
        echo "[run-bats] ERROR: bats emitted an 'Executed instead of expected' warning — test count mismatch" >&2
        grep "bats warning: Executed" <<< "$clean_log" >&2 || true
        FACT_EXECUTED_WARNING=true
    fi

    # ── Optional cross-check: npx bats --count (full-run mode only) ───────────
    # Never gates; skipped silently if bats is not resolvable (never a hard fail).
    # Not valid with --eval-only (no targets in scope for --count).
    if [[ "$EVAL_ONLY" == "false" && "$CROSS_CHECK" == "true" ]]; then
        if _bats_resolvable; then
            count_n=$(npx --no-install bats --count "${TARGETS[@]}" 2>/dev/null || true)
            count_n=${count_n:-0}
            if [[ -n "$count_n" && "$count_n" -gt 0 && "$count_n" -ne "$FACT_EXPECTED" ]]; then
                echo "[run-bats] WARN: --cross-check-count: npx bats --count=$count_n vs plan 1..${FACT_EXPECTED}" >&2
            else
                echo "[run-bats] cross-check: npx bats --count=$count_n matches plan 1..${FACT_EXPECTED}" >&2
            fi
        else
            echo "[run-bats] INFO: --cross-check-count skipped (bats not resolvable via npx --no-install)" >&2
        fi
    fi
fi

# ── Final verdict + exit code (fixed priority order, mirrors the pre-Wave-A checks) ──────
FACT_COMPLETE=false
if [[ "$FACT_PLAN_COUNT" -eq 1 && "$FACT_TOTAL" -eq "$FACT_EXPECTED" && "$FACT_EXECUTED_WARNING" == "false" ]]; then
    FACT_COMPLETE=true
fi

BATS_VERDICT="fail"
EXIT_CODE=0
if [[ "$FACT_OK" -eq 0 ]]; then
    EXIT_CODE=2
elif [[ "$FACT_NOT_OK" -gt 0 ]]; then
    EXIT_CODE=1
elif [[ "$FACT_PLAN_MALFORMED" == "true" || "$FACT_EXPECTED_MISMATCH" == "true" || "$FACT_TOTAL_MISMATCH" == "true" || "$FACT_EXECUTED_WARNING" == "true" ]]; then
    EXIT_CODE=2
else
    EXIT_CODE=0
fi

if [[ "$FACT_NOT_OK" -eq 0 && "$FACT_COMPLETE" == "true" ]]; then
    BATS_VERDICT="pass"
fi

if [[ "$EXIT_CODE" -eq 0 ]]; then
    echo "[run-bats] PASS: 0 not-ok, $FACT_OK ok (expected $FACT_EXPECTED, complete=$FACT_COMPLETE)" >&2
fi

# ── Write run-id-bound handoff (full-run mode only, UNCONDITIONAL — fixes D1) ─────────────
# Path: $ROOT/.androidcommondoc/bats-result.<BATS_RUN_ID>.env
# .androidcommondoc/ is gitignored scratch — won't trip clean-tree assertions.
# Written atomically via unique temp file + mv. --eval-only MUST NOT reach here.
# UNCONDITIONAL means every exit-code outcome above still leaves an honest handoff behind,
# carrying the REAL BATS_VERDICT/BATS_COMPLETE and counts — not just a fully-clean run.
if [[ "$EVAL_ONLY" == "false" ]]; then
    HANDOFF_DIR="$ROOT/.androidcommondoc"
    HANDOFF_PATH="$HANDOFF_DIR/bats-result.${BATS_RUN_ID}.env"
    HANDOFF_TMP="${HANDOFF_DIR}/bats-result-tmp-$$.${RANDOM}.env"

    mkdir -p "$HANDOFF_DIR"

    BATS_HEAD="$(get_head)"
    BATS_GENERATED_AT="$(now_utc)"

    # Write known keys via printf — no eval, no ambiguous shell expansion
    printf 'BATS_OK=%s\n'               "$FACT_OK"              >  "$HANDOFF_TMP"
    printf 'BATS_NOT_OK=%s\n'           "$FACT_NOT_OK"          >> "$HANDOFF_TMP"
    printf 'BATS_EXPECTED=%s\n'         "$FACT_EXPECTED"        >> "$HANDOFF_TMP"
    printf 'BATS_TOTAL=%s\n'            "$FACT_TOTAL"           >> "$HANDOFF_TMP"
    printf 'BATS_COMPLETE=%s\n'         "$FACT_COMPLETE"        >> "$HANDOFF_TMP"
    printf 'BATS_VERDICT=%s\n'          "$BATS_VERDICT"         >> "$HANDOFF_TMP"
    printf 'BATS_LOG=%s\n'              "$LOG"                  >> "$HANDOFF_TMP"
    printf 'BATS_HEAD=%s\n'             "$BATS_HEAD"            >> "$HANDOFF_TMP"
    printf 'BATS_RUN_ID=%s\n'           "$BATS_RUN_ID"          >> "$HANDOFF_TMP"
    printf 'BATS_GENERATED_AT=%s\n'     "$BATS_GENERATED_AT"    >> "$HANDOFF_TMP"
    printf 'BATS_SCOPE=%s\n'            "$BATS_SCOPE"           >> "$HANDOFF_TMP"
    printf 'BATS_TARGET_DIGEST=%s\n'    "$BATS_TARGET_DIGEST"   >> "$HANDOFF_TMP"
    printf 'BATS_ENV_FINGERPRINT=%s\n'  "$BATS_ENV_FINGERPRINT" >> "$HANDOFF_TMP"

    mv "$HANDOFF_TMP" "$HANDOFF_PATH"
    echo "[run-bats] handoff written: $HANDOFF_PATH (verdict=$BATS_VERDICT complete=$FACT_COMPLETE)" >&2
fi

exit "$EXIT_CODE"
