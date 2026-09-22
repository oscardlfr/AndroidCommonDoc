#!/usr/bin/env bash
# bats-handoff.sh — sole parser + selector for run-bats.sh evidence handoffs.
#
# SOURCED INTERFACE (used by emit-qg-result.sh):
#   source scripts/sh/lib/bats-handoff.sh
#   select_bats_handoff --repo-root <path> --head <sha> [--since <ts>] [--require-scope full]
#     Always returns 0. Result communicated via globals (never a filesystem-path leak
#     restriction here — this is the trusted in-process interface, not the CLI payload):
#       BH_STATUS  ok|stale|scope-mismatch|absent|malformed
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
# generalized to a shared library; each stage strictly narrows the previous one's survivors).
# Pass 3 is split into two SEQUENTIAL sub-passes (3a: freshness, 3b: scope) rather than one
# combined loop, so "genuinely stale" and "fresh but wrong scope" are two distinct, correctly
# named outcomes — collapsing them (the pre-split behavior) misreported a targeted-scope
# handoff as "stale" even when it was the freshest thing on disk (arch-platform ruling,
# Section A4 follow-up: a reporting-accuracy defect, not an exploitable one — every affected
# case already blocked the mint, it just named the wrong reason):
#   1. absent         — zero allowlisted candidate files exist, or zero have BATS_HEAD == --head.
#   2. malformed      — >=1 HEAD-matching candidate, but none has ALL completeness fields
#                        (BATS_RUN_ID/BATS_GENERATED_AT/BATS_OK/BATS_NOT_OK/BATS_EXPECTED/
#                        BATS_TOTAL/BATS_COMPLETE/BATS_VERDICT) present AND regex-valid.
#   3. stale          — >=1 well-formed HEAD-matching candidate (Pass 3a), but NONE satisfies
#                        BATS_GENERATED_AT >= --since (lexicographic, same %Y-%m-%dT%H:%M:%SZ
#                        format as report.started_at — no `date -d`). Scope is not consulted
#                        at this stage — genuinely nothing fresh enough exists, full stop.
#   4. scope-mismatch — >=1 freshness-qualifying candidate from Pass 3a (Pass 3b), but none
#                        satisfies scope: when --require-scope full is given, BATS_SCOPE=="full"
#                        (absent scope is REJECTED, NEVER defaulted to full — all 78 pre-Wave-A
#                        handoffs lack this field). Fresh evidence exists, just never at the
#                        required scope.
#   5. ok             — >=1 candidate qualifying on BOTH freshness and scope; the one with MAX
#                        BATS_GENERATED_AT is selected (deterministic tie-break, mirrors the
#                        original loop).
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
_BH_RE_DIGEST='^([0-9a-f]{64}|none)$'
_BH_RE_SHA256='^[0-9a-f]{64}$'
_BH_RE_TARGET_DIGEST='^([0-9a-f]{40}|[0-9a-f]{64}|none)$'
_BH_RE_TOKEN='^[A-Za-z0-9._-]+$'

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
    local repo_root="" head="" since="" require_scope="" require_plan_digest="" require_wave_slug=""
    local require_target_digest="" require_env_fingerprint="" require_agreeing="1"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo-root)     repo_root="$2"; shift 2 ;;
            --head)          head="$2"; shift 2 ;;
            --since)         since="$2"; shift 2 ;;
            --require-scope) require_scope="$2"; shift 2 ;;
            --plan-digest) require_plan_digest="$2"; shift 2 ;;
            --wave-slug) require_wave_slug="$2"; shift 2 ;;
            --target-digest) require_target_digest="$2"; shift 2 ;;
            --environment-fingerprint) require_env_fingerprint="$2"; shift 2 ;;
            --require-agreeing) require_agreeing="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    BH_STATUS="absent"
    BH_HEAD=""; BH_RUN_ID=""; BH_OK=""; BH_NOT_OK=""; BH_EXPECTED=""; BH_TOTAL=""
    BH_COMPLETE=""; BH_SCOPE=""; BH_GENERATED_AT=""; BH_PATH=""
    BH_PLAN_DIGEST=""; BH_WAVE_SLUG=""; BH_TARGET_DIGEST=""; BH_ENV_FINGERPRINT=""
    BH_STARTED_AT=""; BH_FINISHED_AT=""; BH_LOG_DIGEST=""; BH_TOOL_VERSIONS=""
    BH_AGREEMENT_COUNT="0"; BH_RUN_IDS=""; BH_LOG_DIGESTS=""
    if [[ ! "$require_agreeing" =~ $_BH_RE_UINT || "$require_agreeing" -lt 1 ]]; then
        BH_STATUS="malformed"
        return 0
    fi

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

    # Pass 3a: freshness-qualifying subset of well_formed — since ONLY, scope not consulted.
    # A candidate failing only the since bound is genuinely "stale"; a candidate failing only
    # scope is a DIFFERENT reality ("scope-mismatch", Pass 3b below) — checking both in one
    # pass would misreport which one actually happened.
    local fresh=()
    for f in "${well_formed[@]}"; do
        generated_at="$(handoff_get "$f" "BATS_GENERATED_AT")"
        [[ -z "$since" || "$generated_at" > "$since" || "$generated_at" == "$since" ]] || continue
        fresh+=("$f")
    done
    if [[ "${#fresh[@]}" -eq 0 ]]; then
        BH_STATUS="stale"
        return 0
    fi

    # Pass 3b: from the freshness-qualifying subset only, apply scope and track MAX
    # generated_at deterministically (same logic as before the split, just now over `fresh`
    # instead of `well_formed`).
    local candidates=()
    local scope_matches=0
    local scope plan_digest wave_slug target_digest env_fingerprint started_at finished_at log_digest log_identity tool_versions
    for f in "${fresh[@]}"; do
        generated_at="$(handoff_get "$f" "BATS_GENERATED_AT")"

        scope="$(handoff_get "$f" "BATS_SCOPE")"
        if [[ "$require_scope" == "full" ]]; then
            # Absent/non-"full" scope is REJECTED here — never defaulted to "full".
            [[ "$scope" == "full" ]] || continue
        elif [[ -n "$scope" ]]; then
            [[ "$scope" =~ $_BH_RE_SCOPE ]] || continue
        fi
        scope_matches=$((scope_matches + 1))
        plan_digest="$(handoff_get "$f" "BATS_PLAN_DIGEST")"
        wave_slug="$(handoff_get "$f" "BATS_WAVE_SLUG")"
        target_digest="$(handoff_get "$f" "BATS_TARGET_DIGEST")"
        env_fingerprint="$(handoff_get "$f" "BATS_ENV_FINGERPRINT")"
        started_at="$(handoff_get "$f" "BATS_STARTED_AT")"
        finished_at="$(handoff_get "$f" "BATS_FINISHED_AT")"
        log_digest="$(handoff_get "$f" "BATS_LOG_DIGEST")"
        log_identity="$(handoff_get "$f" "BATS_LOG_IDENTITY")"
        tool_versions="$(handoff_get "$f" "BATS_TOOL_VERSIONS")"
        if [[ -n "$require_plan_digest" || -n "$require_wave_slug" || -n "$require_target_digest" || -n "$require_env_fingerprint" || "$require_agreeing" -gt 1 ]]; then
            if [[ ! "$plan_digest" =~ $_BH_RE_DIGEST || ! "$wave_slug" =~ $_BH_RE_TOKEN \
                || ! "$target_digest" =~ $_BH_RE_TARGET_DIGEST || ! "$env_fingerprint" =~ $_BH_RE_DIGEST \
                || ! "$started_at" =~ $_BH_RE_TS || ! "$finished_at" =~ $_BH_RE_TS \
    || "$finished_at" < "$started_at" || ! "$log_digest" =~ $_BH_RE_SHA256 \
    || ! "$log_identity" =~ $_BH_RE_SHA256 \
                || ! "$tool_versions" =~ $_BH_RE_TOKEN ]]; then
                BH_STATUS="malformed"
                return 0
            fi
            [[ -z "$require_plan_digest" || "$plan_digest" == "$require_plan_digest" ]] || continue
            [[ -z "$require_wave_slug" || "$wave_slug" == "$require_wave_slug" ]] || continue
            [[ -z "$require_target_digest" || "$target_digest" == "$require_target_digest" ]] || continue
            [[ -z "$require_env_fingerprint" || "$env_fingerprint" == "$require_env_fingerprint" ]] || continue
        fi
        candidates+=("$f")
    done

    if [[ "${#candidates[@]}" -eq 0 ]]; then
        if [[ "$scope_matches" -gt 0 ]]; then BH_STATUS="provenance-mismatch"; else BH_STATUS="scope-mismatch"; fi
        return 0
    fi

    local best="" best_gen="" best_signature="" signature candidate run_id
    local unique_run_ids="" unique_log_digests="" unique_log_identities="" agreement_count=0 log_digest log_identity
    for f in "${candidates[@]}"; do
        signature="$(handoff_get "$f" BATS_HEAD)|$(handoff_get "$f" BATS_SCOPE)|$(handoff_get "$f" BATS_PLAN_DIGEST)|$(handoff_get "$f" BATS_WAVE_SLUG)|$(handoff_get "$f" BATS_TARGET_DIGEST)|$(handoff_get "$f" BATS_ENV_FINGERPRINT)|$(handoff_get "$f" BATS_TOOL_VERSIONS)|$(handoff_get "$f" BATS_OK)|$(handoff_get "$f" BATS_NOT_OK)|$(handoff_get "$f" BATS_EXPECTED)|$(handoff_get "$f" BATS_TOTAL)|$(handoff_get "$f" BATS_COMPLETE)|$(handoff_get "$f" BATS_VERDICT)"
        if [[ -z "$best_signature" ]]; then
            best_signature="$signature"
        elif [[ "$signature" != "$best_signature" ]]; then
            BH_STATUS="provenance-mismatch"
            return 0
        fi
        run_id="$(handoff_get "$f" BATS_RUN_ID)"
        log_digest="$(handoff_get "$f" BATS_LOG_DIGEST)"
        log_identity="$(handoff_get "$f" BATS_LOG_IDENTITY)"
        case ",$unique_run_ids," in *,"$run_id",*) continue ;; esac
        case ",$unique_log_identities," in *,"$log_identity",*) continue ;; esac
        case ",$unique_run_ids," in
            *)
                if [[ -n "$unique_run_ids" ]]; then unique_run_ids+=","; fi
                unique_run_ids+="$run_id"
                if [[ -n "$unique_log_digests" ]]; then unique_log_digests+=","; fi
                unique_log_digests+="$log_digest"
                if [[ -n "$unique_log_identities" ]]; then unique_log_identities+=","; fi
                unique_log_identities+="$log_identity"
                agreement_count=$((agreement_count + 1))
                ;;
        esac
        generated_at="$(handoff_get "$f" BATS_GENERATED_AT)"
        if [[ -z "$best_gen" || "$generated_at" > "$best_gen" ]]; then
            best="$f"; best_gen="$generated_at"
        fi
    done
    if [[ "$agreement_count" -lt "$require_agreeing" ]]; then
        BH_STATUS="insufficient-agreement"
        return 0
    fi
    BH_AGREEMENT_COUNT="$agreement_count"
    BH_RUN_IDS="$unique_run_ids"
    BH_LOG_DIGESTS="$unique_log_digests"

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
    BH_PLAN_DIGEST="$(handoff_get "$best" BATS_PLAN_DIGEST)"
    BH_WAVE_SLUG="$(handoff_get "$best" BATS_WAVE_SLUG)"
    BH_TARGET_DIGEST="$(handoff_get "$best" BATS_TARGET_DIGEST)"
    BH_ENV_FINGERPRINT="$(handoff_get "$best" BATS_ENV_FINGERPRINT)"
    BH_STARTED_AT="$(handoff_get "$best" BATS_STARTED_AT)"
    BH_FINISHED_AT="$(handoff_get "$best" BATS_FINISHED_AT)"
    BH_LOG_DIGEST="$(handoff_get "$best" BATS_LOG_DIGEST)"
    BH_TOOL_VERSIONS="$(handoff_get "$best" BATS_TOOL_VERSIONS)"
    return 0
}

# ── CLI ────────────────────────────────────────────────────────────────────────────────
_bh_cli_select() {
    local repo_root="" head="" since="" require_scope="" format="json" plan_digest="" wave_slug="" target_digest="" env_fingerprint="" require_agreeing="1"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --repo-root)     repo_root="$2"; shift 2 ;;
            --head)          head="$2"; shift 2 ;;
            --since)         since="$2"; shift 2 ;;
            --require-scope) require_scope="$2"; shift 2 ;;
            --format)        format="$2"; shift 2 ;;
            --plan-digest) plan_digest="$2"; shift 2 ;;
            --wave-slug) wave_slug="$2"; shift 2 ;;
            --target-digest) target_digest="$2"; shift 2 ;;
            --environment-fingerprint) env_fingerprint="$2"; shift 2 ;;
            --require-agreeing) require_agreeing="$2"; shift 2 ;;
            *) shift ;;
        esac
    done
    [[ -n "$repo_root" ]] || repo_root="$(pwd)"

    select_bats_handoff --repo-root "$repo_root" --head "$head" --since "$since" --require-scope "$require_scope" \
      --plan-digest "$plan_digest" --wave-slug "$wave_slug" --target-digest "$target_digest" \
      --environment-fingerprint "$env_fingerprint" --require-agreeing "$require_agreeing"

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

    printf '{"status":"%s","head":"%s","run_id":"%s","ok":%s,"not_ok":%s,"expected":%s,"total":%s,"complete":%s,"scope":"%s","generated_at":"%s","plan_digest":"%s","wave_slug":"%s","target_digest":"%s","environment_fingerprint":"%s","started_at":"%s","finished_at":"%s","log_digest":"%s","tool_versions":"%s","agreement_count":%s,"run_ids":"%s","log_digests":"%s"}\n' \
        "$BH_STATUS" "$BH_HEAD" "$BH_RUN_ID" "$ok_n" "$not_ok_n" "$expected_n" "$total_n" "$complete_lit" "$BH_SCOPE" "$BH_GENERATED_AT" "$BH_PLAN_DIGEST" "$BH_WAVE_SLUG" "$BH_TARGET_DIGEST" "$BH_ENV_FINGERPRINT" "$BH_STARTED_AT" "$BH_FINISHED_AT" "$BH_LOG_DIGEST" "$BH_TOOL_VERSIONS" "$BH_AGREEMENT_COUNT" "$BH_RUN_IDS" "$BH_LOG_DIGESTS"
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
