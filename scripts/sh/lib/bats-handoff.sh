#!/usr/bin/env bash
# bats-handoff.sh — sole parser + selector for run-bats.sh evidence handoffs.
#
# SOURCED INTERFACE (used by emit-qg-result.sh):
#   source scripts/sh/lib/bats-handoff.sh
#   select_bats_handoff --repo-root <path> --head <sha> [--since <ts>] [--require-scope full]
#     Always returns 0. Result communicated via globals (never a filesystem-path leak
#     restriction here — this is the trusted in-process interface, not the CLI payload):
#       BH_STATUS  ok|stale|absent|malformed
#       BH_HEAD BH_RUN_ID BH_OK BH_NOT_OK BH_EXPECTED BH_TOTAL BH_COMPLETE BH_SCOPE
#       BH_GENERATED_AT BH_PATH   (all set only when BH_STATUS=ok; "" otherwise)
#   handoff_get <file> <key>
#     Prints one KEY=value's value. Parsed key-by-key via grep+cut — NEVER sources the file.
#   count_head_candidates --repo-root <path> --head <sha>
#     Prints (stdout) the count of allowlisted candidate files whose BATS_HEAD matches.
#     Diagnostic only — never used for gating; lets a caller's fail message distinguish
#     "zero candidates for this commit" from "candidates exist but none qualify".
#
# STANDALONE CLI (used by emit-push-proof.sh):
#   bash scripts/sh/lib/bats-handoff.sh select --repo-root <path> --head <sha> [--since <ts>]
#        [--require-scope full] --format json
#   Prints exactly one JSON object to stdout:
#     {status, head, run_id, ok, not_ok, expected, total, complete, scope, generated_at}
#   ALWAYS exits 0 — meaning lives entirely in "status". A non-zero exit here would abort
#   emit-push-proof.sh / emit-qg-result.sh, both of which run under `set -euo pipefail`.
#   No filesystem paths appear in the JSON payload — the selected path is logged to stderr
#   only (informational; never parsed by a caller).
#
# SELECTION ALGORITHM (ported verbatim from the pre-Wave-A emit-qg-result.sh:269-308 loop,
# generalized to a shared library; each stage strictly narrows the previous one's survivors):
#   1. absent    — zero allowlisted candidate files exist, or zero have BATS_HEAD == --head.
#   2. malformed — >=1 HEAD-matching candidate, but none has ALL completeness fields
#                  (BATS_RUN_ID/BATS_GENERATED_AT/BATS_OK/BATS_NOT_OK/BATS_EXPECTED/BATS_TOTAL/
#                  BATS_COMPLETE/BATS_VERDICT) present AND regex-valid.
#   3. stale     — >=1 well-formed HEAD-matching candidate, but none satisfies BOTH
#                  BATS_GENERATED_AT >= --since (lexicographic, same %Y-%m-%dT%H:%M:%SZ format
#                  as report.started_at — no `date -d`) AND, when --require-scope full is given,
#                  BATS_SCOPE == "full" (absent scope is REJECTED, NEVER defaulted to full —
#                  all 78 pre-Wave-A handoffs lack this field).
#   4. ok        — >=1 qualifying candidate; the one with MAX BATS_GENERATED_AT is selected
#                  (deterministic tie-break, mirrors the original loop).
#
# SECURITY (three independent layers; see arch-platform's PREP verdict Q1 for the threat model
# this closes — injection + path-disclosure, NOT forgery of a well-formed, correct-HEAD file):
#   - Filename allowlist at enumeration: ^bats-result\.[A-Za-z0-9T-]+\.env$ (no colons —
#     Windows-safe). A file failing this is never opened — its CONTENT is never parsed at all.
#   - Never `source`s a scratch file. handoff_get parses one known KEY=value line via
#     grep+cut, mirroring the proven emit-qg-result.sh:167-171 pattern. A tampered value can
#     contain shell metacharacters; they are never evaluated.
#   - Every field is validated against a tight, quote-free regex BEFORE it is trusted or
#     printed. A field failing its regex makes the WHOLE candidate not-well-formed (folds
#     into "malformed") — it is never silently coerced, truncated, or partially trusted.
#
# set -e/pipefail note (feedback_set_e_pipefail_grep_assignment_abort): a bare
# `var="$(handoff_get ...)"` would abort this whole script under `set -euo pipefail` the
# instant a queried key is genuinely absent from a candidate file (grep exits 1; pipefail
# propagates it through head/cut even though they themselves succeed) — exactly the case a
# legacy handoff missing BATS_SCOPE hits on every single call. Guarded once, inside
# handoff_get's own trailing `|| true`, so every call site is protected without having to
# remember it. Do not remove that `|| true` as "dead code" — it is load-bearing.
#
# bash-3.2-safe: no declare -A, no mapfile.

set -euo pipefail

# ── Value-validation regexes (applied before a candidate is trusted OR printed) ──────────
_BH_RE_HEAD='^([0-9a-f]{40}|unknown)$'
_BH_RE_RUN_ID='^[A-Za-z0-9._-]+$'
_BH_RE_UINT='^[0-9]+$'
_BH_RE_BOOL='^(true|false)$'
_BH_RE_VERDICT='^(pass|fail)$'
_BH_RE_SCOPE='^(full|targeted)$'
_BH_RE_TS='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
_BH_RE_FILENAME='^bats-result\.[A-Za-z0-9T-]+\.env$'

# handoff_get FILE KEY
# Extracts a single value from a handoff .env file by parsing the known KEY=value line
# explicitly — NOT via `source`. A tampered file cannot execute code this way. The trailing
# `|| true` neutralizes pipefail propagation when KEY is genuinely absent (see header note).
handoff_get() {
    local file="$1"
    local key="$2"
    grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

# count_head_candidates --repo-root R --head H
# Diagnostic-only: prints (stdout) the count of allowlisted candidate files whose
# BATS_HEAD == H. Never consulted for gating — purely to make a caller's fail message
# distinguish "no evidence for this commit at all" from "evidence exists but disqualified".
count_head_candidates() {
    local repo_root="" head=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo-root) repo_root="$2"; shift 2 ;;
            --head)      head="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    local dir="$repo_root/.androidcommondoc"
    local count=0
    if [[ -d "$dir" ]]; then
        local f base h
        for f in "$dir"/bats-result.*.env; do
            [[ -f "$f" ]] || continue
            base="$(basename "$f")"
            [[ "$base" =~ $_BH_RE_FILENAME ]] || continue
            h="$(handoff_get "$f" "BATS_HEAD")"
            # `if/fi`, not a bare `[[ ]] && count=...` — the latter's exit status is the
            # test's own when it's false (the common case here), which would abort this
            # whole sourced script under `set -e` on the very first non-matching file.
            if [[ -n "$h" && "$h" == "$head" ]]; then
                count=$((count + 1))
            fi
        done
    fi
    printf '%s' "$count"
    return 0
}

# select_bats_handoff --repo-root R --head H [--since S] [--require-scope full]
# Sourced-interface selector. Always returns 0 — result communicated via BH_* globals.
select_bats_handoff() {
    local repo_root="" head="" since="" require_scope=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo-root)     repo_root="$2"; shift 2 ;;
            --head)          head="$2"; shift 2 ;;
            --since)         since="$2"; shift 2 ;;
            --require-scope) require_scope="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    BH_STATUS="absent"
    BH_HEAD=""; BH_RUN_ID=""; BH_OK=""; BH_NOT_OK=""; BH_EXPECTED=""; BH_TOTAL=""
    BH_COMPLETE=""; BH_SCOPE=""; BH_GENERATED_AT=""; BH_PATH=""

    local dir="$repo_root/.androidcommondoc"
    [[ -d "$dir" ]] || return 0

    # Pass 1: allowlisted candidates whose BATS_HEAD matches (content of non-matching files
    # is never inspected further).
    local head_matches=()
    local f base h
    for f in "$dir"/bats-result.*.env; do
        [[ -f "$f" ]] || continue
        base="$(basename "$f")"
        [[ "$base" =~ $_BH_RE_FILENAME ]] || continue
        h="$(handoff_get "$f" "BATS_HEAD")"
        [[ -n "$h" && "$h" =~ $_BH_RE_HEAD && "$h" == "$head" ]] || continue
        head_matches+=("$f")
    done
    [[ "${#head_matches[@]}" -gt 0 ]] || return 0   # BH_STATUS stays "absent"

    # Pass 2: well-formed subset — every completeness field present and regex-valid.
    local well_formed=()
    local run_id ok not_ok expected total complete verdict generated_at
    for f in "${head_matches[@]}"; do
        run_id="$(handoff_get "$f" "BATS_RUN_ID")"
        ok="$(handoff_get "$f" "BATS_OK")"
        not_ok="$(handoff_get "$f" "BATS_NOT_OK")"
        expected="$(handoff_get "$f" "BATS_EXPECTED")"
        total="$(handoff_get "$f" "BATS_TOTAL")"
        complete="$(handoff_get "$f" "BATS_COMPLETE")"
        verdict="$(handoff_get "$f" "BATS_VERDICT")"
        generated_at="$(handoff_get "$f" "BATS_GENERATED_AT")"

        [[ "$run_id"       =~ $_BH_RE_RUN_ID  ]] || continue
        [[ "$ok"           =~ $_BH_RE_UINT    ]] || continue
        [[ "$not_ok"       =~ $_BH_RE_UINT    ]] || continue
        [[ "$expected"     =~ $_BH_RE_UINT    ]] || continue
        [[ "$total"        =~ $_BH_RE_UINT    ]] || continue
        [[ "$complete"     =~ $_BH_RE_BOOL    ]] || continue
        [[ "$verdict"      =~ $_BH_RE_VERDICT ]] || continue
        [[ "$generated_at" =~ $_BH_RE_TS      ]] || continue

        well_formed+=("$f")
    done
    if [[ "${#well_formed[@]}" -eq 0 ]]; then
        BH_STATUS="malformed"
        return 0
    fi

    # Pass 3: qualifying subset (since + scope), tracking MAX generated_at deterministically.
    local best="" best_gen="" scope
    for f in "${well_formed[@]}"; do
        generated_at="$(handoff_get "$f" "BATS_GENERATED_AT")"
        [[ -z "$since" || "$generated_at" > "$since" || "$generated_at" == "$since" ]] || continue

        scope="$(handoff_get "$f" "BATS_SCOPE")"
        if [[ "$require_scope" == "full" ]]; then
            # Absent/non-"full" scope is REJECTED here — never defaulted to "full".
            [[ "$scope" == "full" ]] || continue
        elif [[ -n "$scope" ]]; then
            [[ "$scope" =~ $_BH_RE_SCOPE ]] || continue
        fi

        if [[ -z "$best_gen" || "$generated_at" > "$best_gen" ]]; then
            best_gen="$generated_at"
            best="$f"
        fi
    done

    if [[ -z "$best" ]]; then
        BH_STATUS="stale"
        return 0
    fi

    BH_STATUS="ok"
    BH_HEAD="$(handoff_get "$best" "BATS_HEAD")"
    BH_RUN_ID="$(handoff_get "$best" "BATS_RUN_ID")"
    BH_OK="$(handoff_get "$best" "BATS_OK")"
    BH_NOT_OK="$(handoff_get "$best" "BATS_NOT_OK")"
    BH_EXPECTED="$(handoff_get "$best" "BATS_EXPECTED")"
    BH_TOTAL="$(handoff_get "$best" "BATS_TOTAL")"
    BH_COMPLETE="$(handoff_get "$best" "BATS_COMPLETE")"
    BH_SCOPE="$(handoff_get "$best" "BATS_SCOPE")"
    BH_GENERATED_AT="$best_gen"
    BH_PATH="$best"
    return 0
}

# ── CLI ────────────────────────────────────────────────────────────────────────────────
_bh_cli_select() {
    local repo_root="" head="" since="" require_scope="" format="json"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo-root)     repo_root="$2"; shift 2 ;;
            --head)          head="$2"; shift 2 ;;
            --since)         since="$2"; shift 2 ;;
            --require-scope) require_scope="$2"; shift 2 ;;
            --format)        format="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    [[ -n "$repo_root" ]] || repo_root="$(pwd)"

    select_bats_handoff --repo-root "$repo_root" --head "$head" --since "$since" --require-scope "$require_scope"

    if [[ -n "$BH_PATH" ]]; then
        echo "[bats-handoff] INFO: selected $BH_PATH (status=$BH_STATUS)" >&2
    else
        echo "[bats-handoff] INFO: no qualifying handoff (status=$BH_STATUS, head=$head)" >&2
    fi

    local ok_n="${BH_OK:-0}" not_ok_n="${BH_NOT_OK:-0}" expected_n="${BH_EXPECTED:-0}" total_n="${BH_TOTAL:-0}"
    # `if/fi`, not a bare `[[ ]] && var=...` — see count_head_candidates for why.
    local complete_lit="false"
    if [[ "${BH_COMPLETE:-}" == "true" ]]; then
        complete_lit="true"
    fi

    printf '{"status":"%s","head":"%s","run_id":"%s","ok":%s,"not_ok":%s,"expected":%s,"total":%s,"complete":%s,"scope":"%s","generated_at":"%s"}\n' \
        "$BH_STATUS" "$BH_HEAD" "$BH_RUN_ID" "$ok_n" "$not_ok_n" "$expected_n" "$total_n" "$complete_lit" "$BH_SCOPE" "$BH_GENERATED_AT"
    return 0
}

# Only dispatch as a CLI when this file is executed directly, not sourced.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    _BH_SUBCOMMAND="${1:-}"
    # `if/fi`, not a bare `[[ ]] && shift` — see count_head_candidates for why (this one
    # fires whenever the CLI is invoked with zero arguments at all).
    if [[ $# -gt 0 ]]; then
        shift
    fi
    case "$_BH_SUBCOMMAND" in
        select)
            _bh_cli_select "$@"
            exit 0
            ;;
        *)
            echo "[bats-handoff] ERROR: unknown or missing subcommand '$_BH_SUBCOMMAND' (must be 'select')" >&2
            printf '{"status":"malformed","head":"","run_id":"","ok":0,"not_ok":0,"expected":0,"total":0,"complete":false,"scope":"","generated_at":""}\n'
            exit 0
            ;;
    esac
fi
