#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/lib/bats-handoff.sh — sole parser + selector for run-bats.sh
# evidence handoffs (Wave A, Step 1).
#
# Coverage map (12 tests):
#   #BH1  foreign HEAD (handoff bound to a different commit than --head) → rejected
#         (status=absent), even though otherwise well-formed.
#   #BH2  targeted-scope handoff rejected under --require-scope full → status=scope-mismatch
#         (Pass 3 is split into 3a/freshness then 3b/scope so a fresh-but-wrong-scope
#         candidate is never misreported as "stale").
#   #BH3  legacy handoff missing BATS_SCOPE entirely (pre-Wave-A shape) rejected under
#         --require-scope full → status=scope-mismatch. Absent scope is NEVER defaulted
#         to "full".
#   #BH4  BATS_GENERATED_AT older than --since rejected → status=stale (genuine
#         staleness — distinct from #BH2/#BH3's scope-mismatch).
#   #BH5  empty BATS_RUN_ID fails the well-formedness regex → status=malformed.
#   #BH6  two qualifying candidates → the one with MAX BATS_GENERATED_AT wins
#         (deterministic tie-break), proven via a distinctive BATS_OK sentinel.
#   #BH7  valid full-scope well-formed handoff accepted → status=ok; every JSON field
#         is sourced verbatim from the handoff.
#   #BH8  SECURITY command injection: a BATS_RUN_ID value containing a literal
#         $(touch <marker>) payload is parsed key-by-key (grep+cut), never executed —
#         the marker file is never created.
#   #BH9  count_head_candidates counts every HEAD-matching allowlisted file regardless
#         of scope or well-formedness (diagnostic-only; never used for gating).
#   #BH10 SECURITY value injection: a BATS_SCOPE value crafted to break out of the
#         CLI's printf-based JSON string never forges an extra key or corrupts the
#         payload — output stays one well-formed JSON object, status never "ok".
#   #BH11 SECURITY path injection: a file named bats-result.a","not_ok":0,"x":".env
#         fails the filename allowlist and is never opened/enumerated even though its
#         BATS_HEAD would otherwise match; separately, no payload value (even in a
#         legitimate "ok" acceptance) is ever a filesystem path.
#   #BH12 the CLI always exits 0 — status carries all meaning. Pins the set -euo
#         pipefail contract (a non-zero exit here would abort emit-push-proof.sh /
#         emit-qg-result.sh, both of which invoke this CLI/library under it). Covers
#         absent (no .androidcommondoc dir at all), malformed (empty run_id), unknown
#         subcommand, and missing subcommand.
#
# Isolation: every test uses mktemp -d + teardown rm -rf. No git init needed — unlike
# emit-push-proof.sh, bats-handoff.sh never calls git; --head is caller-supplied.
# Mirrors run-bats.bats's simpler (non-git) fixture pattern, the closest existing analog.

LIB="$BATS_TEST_DIRNAME/../sh/lib/bats-handoff.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    ACDOC="$WORK_DIR/.androidcommondoc"
    mkdir -p "$ACDOC"
    HEAD="1111111111111111111111111111111111111111"
    OTHER_HEAD="2222222222222222222222222222222222222222"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ── Fixture / assertion helpers ───────────────────────────────────────────────

# write_handoff <run_id> <head> <generated_at> <ok> <not_ok> <expected> <complete> <verdict> [<scope>]
# Writes $ACDOC/bats-result.<run_id>.env mirroring run-bats.sh's real field shape.
# scope is OMITTED entirely (not even the key) when the 9th arg is blank — reproduces
# the legacy (pre-Wave-A) handoff shape exercised by #BH3.
write_handoff() {
    local run_id="$1" head="$2" generated_at="$3"
    local ok="$4" not_ok="$5" expected="$6" complete="$7" verdict="$8" scope="${9:-}"
    local total=$(( ok + not_ok ))
    local path="$ACDOC/bats-result.${run_id}.env"
    {
        printf 'BATS_OK=%s\n'           "$ok"
        printf 'BATS_NOT_OK=%s\n'       "$not_ok"
        printf 'BATS_EXPECTED=%s\n'     "$expected"
        printf 'BATS_TOTAL=%s\n'        "$total"
        printf 'BATS_COMPLETE=%s\n'     "$complete"
        printf 'BATS_VERDICT=%s\n'      "$verdict"
        printf 'BATS_LOG=%s\n'          "/dev/null"
        printf 'BATS_HEAD=%s\n'         "$head"
        printf 'BATS_RUN_ID=%s\n'       "$run_id"
        printf 'BATS_GENERATED_AT=%s\n' "$generated_at"
        if [[ -n "$scope" ]]; then
            printf 'BATS_SCOPE=%s\n' "$scope"
        fi
    } > "$path"
}

# select_json <extra CLI args...> — runs the CLI's `select` subcommand against $WORK_DIR.
# --separate-stderr (bats 1.5+): the CLI writes its human-readable INFO/ERROR line to
# stderr and the JSON payload to stdout only — without this flag, bats' default combined
# capture would put both into $output and break json.loads (leading non-JSON text).
select_json() {
    run --separate-stderr bash "$LIB" select --repo-root "$WORK_DIR" "$@" --format json
}

# json_get <json-string> <field> — prints one field's value from a select JSON payload.
json_get() {
    python3 -c "
import json, sys
d = json.loads(sys.argv[1])
print(d.get(sys.argv[2], ''))
" "$1" "$2"
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH1 foreign HEAD (handoff bound to a different commit) → status=absent" {
    write_handoff "run-foreign" "$OTHER_HEAD" "2026-07-09T18:10:00Z" 5 0 5 true pass full
    select_json --head "$HEAD" --since "" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "absent" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH2 targeted-scope handoff rejected under --require-scope full → status=scope-mismatch" {
    # Pass 3 is split into 3a (freshness) then 3b (scope): a candidate that IS fresh
    # enough but fails only on scope gets its own distinct status, "scope-mismatch" —
    # collapsing it into "stale" would misreport a targeted-scope handoff as stale even
    # when it was the freshest thing on disk.
    write_handoff "run-targeted" "$HEAD" "2026-07-09T18:10:00Z" 5 0 5 true pass targeted
    select_json --head "$HEAD" --since "2026-07-09T18:00:00Z" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "scope-mismatch" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH3 legacy handoff missing BATS_SCOPE entirely rejected under --require-scope full → status=scope-mismatch" {
    write_handoff "run-legacy" "$HEAD" "2026-07-09T18:10:00Z" 5 0 5 true pass ""
    select_json --head "$HEAD" --since "2026-07-09T18:00:00Z" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "scope-mismatch" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH4 handoff BATS_GENERATED_AT older than --since rejected → status=stale" {
    write_handoff "run-old" "$HEAD" "2026-07-09T18:00:00Z" 5 0 5 true pass full
    select_json --head "$HEAD" --since "2026-07-09T19:00:00Z" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "stale" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# Empty BATS_RUN_ID fails _BH_RE_RUN_ID (requires >=1 char), so the only HEAD-matching
# candidate never enters `well_formed` at all → status=malformed. Distinct from
# "stale" (which means a candidate passed well-formedness but was excluded later).
# Written directly (not via write_handoff) so the FILENAME's run_id stays valid while
# only the FIELD's value is emptied.
# ─────────────────────────────────────────────────────────────────────────────
@test "#BH5 empty BATS_RUN_ID → status=malformed" {
    printf 'BATS_OK=5\nBATS_NOT_OK=0\nBATS_EXPECTED=5\nBATS_TOTAL=5\nBATS_COMPLETE=true\nBATS_VERDICT=pass\nBATS_LOG=/dev/null\nBATS_HEAD=%s\nBATS_RUN_ID=\nBATS_GENERATED_AT=2026-07-09T18:10:00Z\nBATS_SCOPE=full\n' \
        "$HEAD" > "$ACDOC/bats-result.run-emptyid.env"
    select_json --head "$HEAD" --since "" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "malformed" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH6 two qualifying candidates → handoff with MAX generated_at wins (deterministic tie-break)" {
    write_handoff "run-early" "$HEAD" "2026-07-09T18:05:00Z" 100 0 100 true pass full
    write_handoff "run-late"  "$HEAD" "2026-07-09T18:15:00Z" 200 0 200 true pass full
    select_json --head "$HEAD" --since "2026-07-09T18:00:00Z" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "ok" ]
    [ "$(json_get "$output" run_id)" = "run-late" ]
    [ "$(json_get "$output" ok)" = "200" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH7 valid full-scope well-formed handoff accepted → status=ok, all fields sourced from it" {
    write_handoff "run-happy" "$HEAD" "2026-07-09T18:10:00Z" 7 0 7 true pass full
    select_json --head "$HEAD" --since "2026-07-09T18:00:00Z" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "ok" ]
    [ "$(json_get "$output" head)" = "$HEAD" ]
    [ "$(json_get "$output" run_id)" = "run-happy" ]
    [ "$(json_get "$output" ok)" = "7" ]
    [ "$(json_get "$output" not_ok)" = "0" ]
    [ "$(json_get "$output" expected)" = "7" ]
    [ "$(json_get "$output" total)" = "7" ]
    [ "$(json_get "$output" complete)" = "True" ]
    [ "$(json_get "$output" scope)" = "full" ]
    [ "$(json_get "$output" generated_at)" = "2026-07-09T18:10:00Z" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# SECURITY: handoff_get parses one KEY=value line via grep+cut and NEVER `source`s the
# file. A value containing shell metacharacters (here, a literal $(touch <marker>)
# payload) must be treated as inert text regardless of what status it produces.
# ─────────────────────────────────────────────────────────────────────────────
@test "#BH8 SECURITY: \$(touch marker) payload in BATS_RUN_ID is parsed, never executed" {
    local marker="$WORK_DIR/pwned-bh8"
    printf 'BATS_OK=5\nBATS_NOT_OK=0\nBATS_EXPECTED=5\nBATS_TOTAL=5\nBATS_COMPLETE=true\nBATS_VERDICT=pass\nBATS_LOG=/dev/null\nBATS_HEAD=%s\nBATS_RUN_ID=%s\nBATS_GENERATED_AT=2026-07-09T18:10:00Z\nBATS_SCOPE=full\n' \
        "$HEAD" "\$(touch $marker)" > "$ACDOC/bats-result.cmdinj.env"
    select_json --head "$HEAD" --since "" --require-scope full
    [ "$status" -eq 0 ]
    [ ! -f "$marker" ]
}

# ─────────────────────────────────────────────────────────────────────────────
@test "#BH9 count_head_candidates counts HEAD-matching handoffs regardless of scope" {
    write_handoff "run-a" "$HEAD"       "2026-07-09T18:05:00Z" 3 0 3 true pass full
    write_handoff "run-b" "$HEAD"       "2026-07-09T18:06:00Z" 3 0 3 true pass targeted
    write_handoff "run-c" "$HEAD"       "2026-07-09T18:07:00Z" 3 0 3 true pass ""
    write_handoff "run-d" "$OTHER_HEAD" "2026-07-09T18:08:00Z" 3 0 3 true pass full
    run bash -c "source '$LIB' && count_head_candidates --repo-root '$WORK_DIR' --head '$HEAD'"
    [ "$status" -eq 0 ]
    [ "$output" = "3" ]
}

# ─────────────────────────────────────────────────────────────────────────────
# SECURITY: a BATS_SCOPE value engineered to break out of the CLI's printf-based JSON
# string (full","not_ok":0) must never forge an extra top-level key. Empirically, the
# malicious value is excluded during selection itself (fails the require-scope==full
# equality test verbatim, so it never becomes the winning candidate and BH_SCOPE is
# never even assigned from it) — the emitted JSON therefore stays exactly the 10
# expected keys, all zeroed/empty, and status is never "ok".
# ─────────────────────────────────────────────────────────────────────────────
@test "#BH10 SECURITY: BATS_SCOPE value-injection payload never forges the JSON object" {
    printf 'BATS_OK=5\nBATS_NOT_OK=0\nBATS_EXPECTED=5\nBATS_TOTAL=5\nBATS_COMPLETE=true\nBATS_VERDICT=pass\nBATS_LOG=/dev/null\nBATS_HEAD=%s\nBATS_RUN_ID=run-valueinj\nBATS_GENERATED_AT=2026-07-09T18:10:00Z\nBATS_SCOPE=full","not_ok":0\n' \
        "$HEAD" > "$ACDOC/bats-result.run-valueinj.env"
    select_json --head "$HEAD" --since "" --require-scope full
    [ "$status" -eq 0 ]
    local cli_json="$output"
    run python3 -c "
import json, sys
d = json.loads(sys.argv[1])
expected_keys = {'status','head','run_id','ok','not_ok','expected','total','complete','scope','generated_at'}
assert set(d.keys()) == expected_keys, f'unexpected keys: {set(d.keys())}'
assert d['status'] != 'ok', f'malicious scope must never be selected, got status={d[\"status\"]!r}'
print('OK')
" "$cli_json"
    [ "$status" -eq 0 ]
    [[ "$output" == *"OK"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# SECURITY: a candidate file whose NAME (not content) carries a JSON-breaking /
# path-like payload fails the filename allowlist (^bats-result\.[A-Za-z0-9T-]+\.env$)
# and is therefore never opened at all — its content, including a matching BATS_HEAD,
# never influences selection. Separately pins the general property that no payload
# value (even in a legitimate "ok" acceptance) is ever a filesystem path — BH_PATH is
# logged to stderr only and is never one of the serialized JSON keys.
# ─────────────────────────────────────────────────────────────────────────────
@test "#BH11 SECURITY: maliciously-named handoff file never enumerated; no payload value ever holds a path" {
    local malicious_name='bats-result.a","not_ok":0,"x":".env'
    printf 'BATS_OK=5\nBATS_NOT_OK=0\nBATS_EXPECTED=5\nBATS_TOTAL=5\nBATS_COMPLETE=true\nBATS_VERDICT=pass\nBATS_LOG=/dev/null\nBATS_HEAD=%s\nBATS_RUN_ID=malicious-run\nBATS_GENERATED_AT=2026-07-09T18:10:00Z\nBATS_SCOPE=full\n' \
        "$HEAD" > "$ACDOC/$malicious_name"
    [ -f "$ACDOC/$malicious_name" ]  # sanity: the file really exists on disk, BATS_HEAD would match

    select_json --head "$HEAD" --since "" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "absent" ]

    run bash -c "source '$LIB' && count_head_candidates --repo-root '$WORK_DIR' --head '$HEAD'"
    [ "$status" -eq 0 ]
    [ "$output" = "0" ]

    # General property, proven on a legitimate "ok" acceptance (not the malicious file).
    write_handoff "run-pathcheck" "$HEAD" "2026-07-09T18:11:00Z" 3 0 3 true pass full
    select_json --head "$HEAD" --since "2026-07-09T18:00:00Z" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "ok" ]
    local ok_json="$output"
    run python3 -c "
import json, sys
d = json.loads(sys.argv[1])
for k, v in d.items():
    assert '/' not in str(v), f'payload key {k!r} holds a path-like value: {v!r}'
print('OK')
" "$ok_json"
    [ "$status" -eq 0 ]
    [[ "$output" == *"OK"* ]]
}

# ─────────────────────────────────────────────────────────────────────────────
# The CLI always exits 0 — meaning lives entirely in "status". A non-zero exit here
# would abort emit-push-proof.sh / emit-qg-result.sh, both of which invoke this
# CLI/library under set -euo pipefail.
# ─────────────────────────────────────────────────────────────────────────────
@test "#BH12 CLI always exits 0 — absent, malformed, unknown subcommand, missing subcommand" {
    # absent: .androidcommondoc doesn't even exist for this repo-root.
    local empty_root="$WORK_DIR/no-acdoc-here"
    mkdir -p "$empty_root"
    run --separate-stderr bash "$LIB" select --repo-root "$empty_root" --head "$HEAD" --format json
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "absent" ]

    # malformed: empty BATS_RUN_ID (mirrors #BH5's fixture, in this test's own $ACDOC).
    printf 'BATS_OK=5\nBATS_NOT_OK=0\nBATS_EXPECTED=5\nBATS_TOTAL=5\nBATS_COMPLETE=true\nBATS_VERDICT=pass\nBATS_LOG=/dev/null\nBATS_HEAD=%s\nBATS_RUN_ID=\nBATS_GENERATED_AT=2026-07-09T18:10:00Z\nBATS_SCOPE=full\n' \
        "$HEAD" > "$ACDOC/bats-result.run-emptyid2.env"
    select_json --head "$HEAD" --since "" --require-scope full
    [ "$status" -eq 0 ]
    [ "$(json_get "$output" status)" = "malformed" ]

    # unknown subcommand.
    run bash "$LIB" bogus-subcommand
    [ "$status" -eq 0 ]

    # missing subcommand entirely.
    run bash "$LIB"
    [ "$status" -eq 0 ]
}
