#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for the coordination-artifact validator (.claude/hooks/coordination-artifact.js),
# Wave 2 (portable-coordination-artifacts).
#
# CLI under test: node .claude/hooks/coordination-artifact.js validate <kind> <file> <slug>
#   exit 0 = valid   (all 4 ArtifactValidation fields true: exists, validMarker, headBound, fresh)
#   exit 2 = invalid (fail-closed on ANY field false, or malformed/unreadable input)
#
# ArtifactValidation contract (ADR-001 Sec3.2 / PLAN.md "Read/validate contract", relayed via
# the arch-testing dispatch since specialist-dispatch-protocol.md / the ADR are docs/** —
# gate-blocked for direct Read by this specialist):
#   - exists:      the resolved artifact file is present AT THE EXPECTED CONFINED PATH for its
#                  kind (realpath-confined under .planning/wave-<slug>/..., no traversal/symlink-escape)
#   - validMarker: correct `schema` (coordination/<kind>/v1, matching the CLI's <kind> arg) +
#                  kind-specific required fields present and well-formed
#   - headBound:   N/A for consult/stop; result/request/approval require `head` to be an
#                  ancestor of (or equal to) current HEAD (git merge-base --is-ancestor,
#                  mirrors premature-execution-gate.js:57)
#   - fresh:       consult -> wave_slug match + created_at within CONSULT_TTL_SECONDS;
#                  result/request/approval -> wave_slug match + plan_sha256 == sha256(PLAN.md)
#
# Isolation: mktemp -d + throwaway git init (mirrors write-specialist-dispatch.bats /
# slug-resolution-matrix.bats) -- NEVER touches the live
# .planning/wave-portable-coordination-artifacts/. result/request/approval tests seed a
# throwaway PLAN.md and use the REAL git-computed head/plan_sha256 (CORE NON-VACUITY MANDATE,
# mirrors write-specialist-dispatch.bats) -- never hardcoded matching constants.
#
# Invocation: bats scripts/tests/coordination-artifact-validation.bats (from repo root)

VALIDATOR="$BATS_TEST_DIRNAME/../../.claude/hooks/coordination-artifact.js"
WAVE_SLUG="cav-test-wave"
# Single source of truth (arch-testing/team-lead ratified): read constants via
# `node coordination-artifact.js const <NAME>` rather than hardcoding a duplicate
# that could drift from the validator's own values.
CONSULT_TTL_SECONDS="$(node "$VALIDATOR" const CONSULT_TTL_SECONDS)"
MAX_CONSULT_BYTES="$(node "$VALIDATOR" const MAX_CONSULT_BYTES)"
# Directional-TTL future-skew bound (team-lead / STOP-9 hardening). Falls back to the
# documented default (300s) if the validator doesn't export this constant yet, so the
# REST of this suite doesn't crash on a bare arithmetic expansion of an empty string
# while toolkit-specialist's edit is still landing -- CAV-consult-10/11 below are the
# only cases that actually depend on this value being live/correct.
MAX_CONSULT_FUTURE_SKEW_SECONDS="$(node "$VALIDATOR" const MAX_CONSULT_FUTURE_SKEW_SECONDS 2>/dev/null || echo 300)"
# Syntactically-valid 40-hex commit SHA that cannot exist in a fresh throwaway
# repo's tiny object graph -- `git merge-base --is-ancestor` on it fails
# (non-zero, "not a valid commit"), which the validator must treat identically
# to "genuinely diverged" (both are simply "not an ancestor" -> invalid).
NON_ANCESTOR_HEAD="abcdef1234567890abcdef1234567890abcdef12"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
}

teardown() {
  rm -rf "$PROJ"
}

# ── Generic helpers ──────────────────────────────────────────────────────────

_now_iso()     { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
_now_compact() { date -u '+%Y%m%dT%H%M%SZ'; }

# Portable "N hours ago" -- GNU -d first, BSD/macOS -v fallback (mirrors the
# sha256sum||shasum idiom used throughout scripts/sh/*.sh in this repo).
_hours_ago_iso() {
  local n="$1"
  date -u -d "-${n} hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-"${n}"H '+%Y-%m-%dT%H:%M:%SZ'
}

# Portable "N seconds from now" -- same GNU/BSD fallback shape as _hours_ago_iso,
# used for the directional-TTL future-skew tests below.
_seconds_from_now_iso() {
  local n="$1"
  date -u -d "+${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+"${n}"S '+%Y-%m-%dT%H:%M:%SZ'
}

_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_seed_plan() {
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '# Plan\n\nSome plan content for %s.\n' "$WAVE_SLUG" > "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"
}

_real_head()          { git -C "$PROJ" rev-parse HEAD; }
_real_plan_sha256()   { _sha256_file "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"; }
# _advance_head — one more real commit so the CURRENT HEAD strictly descends
# from whatever HEAD was captured before calling this (used to build an
# unambiguous, non-self, strict-ancestor fixture).
_advance_head() { git -C "$PROJ" commit -q --allow-empty -m "advance" 2>/dev/null; }

_run_validate() {
  local kind="$1" file="$2" slug="$3"
  run bash -c "cd '$PROJ' && CLAUDE_PROJECT_DIR='$PROJ' node '$VALIDATOR' validate '$kind' '$file' '$slug'"
}

_write_oversized_file() {
  python3 -c "import sys; open(sys.argv[1], 'wb').write(b'0' * int(sys.argv[2]))" "$1" "$2"
}

# ── Kind-specific JSON builders (printf -- simple flat fields, no escaping needed) ──

_consult_json() {
  local wave_slug="$1" to="$2" created_at="$3" from="${4:-test-specialist}"
  printf '{"schema":"coordination/consult/v1","wave_slug":"%s","from":"%s","to":"%s","created_at":"%s"}' \
    "$wave_slug" "$from" "$to" "$created_at"
}

_result_json() {
  local wave_slug="$1" head="$2" plan_sha256="$3" status="$4" created_at="$5"
  printf '{"schema":"coordination/result/v1","wave_slug":"%s","from":"test-specialist","to":"arch-testing","head":"%s","plan_sha256":"%s","re_dispatch":"arch-testing-20260101T000000Z.json","status":"%s","files_touched":["scripts/tests/foo.bats"],"summary":"did the thing","detail":"details here","created_at":"%s"}' \
    "$wave_slug" "$head" "$plan_sha256" "$status" "$created_at"
}

_request_json() {
  local wave_slug="$1" head="$2" plan_sha256="$3" request_id="$4" kind="$5" files_json="$6" created_at="$7"
  printf '{"schema":"coordination/request/v1","wave_slug":"%s","from":"test-specialist","to":"arch-testing","head":"%s","plan_sha256":"%s","request_id":"%s","kind":"%s","files":%s,"created_at":"%s"}' \
    "$wave_slug" "$head" "$plan_sha256" "$request_id" "$kind" "$files_json" "$created_at"
}

_approval_json() {
  local wave_slug="$1" head="$2" plan_sha256="$3" request_id="$4" request_kind="$5" decision="$6" created_at="$7"
  printf '{"schema":"coordination/approval/v1","wave_slug":"%s","from":"arch-testing","to":"test-specialist","head":"%s","plan_sha256":"%s","request_id":"%s","request_kind":"%s","decision":"%s","approver":"arch-testing","created_at":"%s"}' \
    "$wave_slug" "$head" "$plan_sha256" "$request_id" "$request_kind" "$decision" "$created_at"
}

_stop_json() {
  local wave_slug="$1" role="$2" created_at="$3"
  printf '{"schema":"coordination/stop/v1","wave_slug":"%s","role":"%s","created_at":"%s"}' \
    "$wave_slug" "$role" "$created_at"
}

_message_json() {
  local wave_slug="$1" to="$2" head="$3" plan_sha256="$4" created_at="$5"
  printf '{"schema":"coordination/message/v1","wave_slug":"%s","from":"test-specialist","to":"%s","head":"%s","plan_sha256":"%s","created_at":"%s","body":"hello"}' \
    "$wave_slug" "$to" "$head" "$plan_sha256" "$created_at"
}

# Canonical confined path builders (PLAN.md "Canonical paths" table).
_consult_path()  { printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG/inbox/context-provider/consult-$(_now_compact).json"; }
_message_path()  { printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG/inbox/arch-testing/test-specialist-$(_now_compact).json"; }
_result_path()   { printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG/results/test-specialist/test-specialist-$(_now_compact).json"; }
_request_path()  { local id="$1" kind="$2"; printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG/requests/$kind/$id.json"; }
_approval_path() { local id="$1"; printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG/approvals/$id.json"; }
_stop_path()     { local role="$1"; printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG/stop-$role.flag"; }

# ══════════════════════════════════════════════════════════════════════════
# consult/v1
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-consult-1 PASS: valid fresh consult at the confined inbox path -> exit 0" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  _consult_json "$WAVE_SLUG" "context-provider" "$(_now_iso)" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-consult-2 FAIL: schema/kind mismatch (file claims result/v1, CLI asked for consult) -> exit 2" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "$WAVE_SLUG" "$(_real_head)" "deadbeef" "done" "$(_now_iso)" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-3 FAIL: wrong 'to' (not context-provider) -> exit 2" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  _consult_json "$WAVE_SLUG" "arch-testing" "$(_now_iso)" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-4 FAIL: wrong wave_slug -> exit 2" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  _consult_json "some-other-wave" "context-provider" "$(_now_iso)" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-5 FAIL: created_at beyond CONSULT_TTL_SECONDS -> exit 2 (stale)" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  _consult_json "$WAVE_SLUG" "context-provider" "$(_hours_ago_iso 13)" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-6 FAIL: non-JSON content -> exit 2 (fail-closed, not fail-open)" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  printf 'not valid json at all' > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-6b FAIL: empty file -> exit 2" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  : > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-7 FAIL: otherwise-valid content placed OUTSIDE the confined inbox dir -> exit 2 (out-of-confinement)" {
  local f="$PROJ/rogue-consult.json"
  _consult_json "$WAVE_SLUG" "context-provider" "$(_now_iso)" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-8 FAIL: symlink at the confined path resolving outside confinement -> exit 2 (symlink-escape)" {
  local outside="$PROJ/outside-escape"
  mkdir -p "$outside"
  _consult_json "$WAVE_SLUG" "context-provider" "$(_now_iso)" > "$outside/evil.json"
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  ln -s "$outside/evil.json" "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-9 FAIL: file does not exist -> exit 2 (exists=false)" {
  local f; f="$(_consult_path)"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ── Directional TTL (team-lead / STOP-9 /security-review hardening): valid window is
# [now - CONSULT_TTL_SECONDS, now + MAX_CONSULT_FUTURE_SKEW_SECONDS], not a symmetric
# Math.abs() window. CAV-consult-5 above (past-stale) and CAV-consult-1 (now) are
# unaffected -- both sit on the unchanged lower/at-zero bound. These two cover the NEW
# upper bound specifically: far-future rejected, near-future (clock-drift) tolerated.

@test "CAV-consult-10 FAIL: created_at far in the future (beyond MAX_CONSULT_FUTURE_SKEW_SECONDS) -> exit 2 (directional TTL)" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  # now + CONSULT_TTL_SECONDS + margin is unambiguously beyond the (much smaller)
  # future-skew allowance regardless of its exact configured value.
  _consult_json "$WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$((CONSULT_TTL_SECONDS + 60))")" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-consult-11 PASS: created_at slightly in the future, within MAX_CONSULT_FUTURE_SKEW_SECONDS -> exit 0 (clock-drift tolerance)" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  local skew_half=$((MAX_CONSULT_FUTURE_SKEW_SECONDS / 2))
  [ "$skew_half" -lt 1 ] && skew_half=1
  _consult_json "$WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$skew_half")" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-consult-12 FAIL: created_at within the OLD symmetric TTL window but beyond the NEW directional skew -> exit 2 (the actual security-review regression this closes)" {
  # Discriminating case (toolkit-specialist's own before/after repro): CAV-consult-10
  # above (now+TTL+margin) would ALSO have been rejected under the OLD
  # Math.abs(now-createdMs) > TTL check, so it can't prove the fix by itself -- a
  # created_at halfway into the TTL window (comfortably > the 5-min skew, comfortably
  # < the 12h TTL) is exactly the value that was WRONGLY valid pre-fix and must now be
  # rejected. If this ever regresses back to symmetric abs(), this is the one that
  # would flip from FAIL to (incorrectly) PASS.
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  local half_ttl=$((CONSULT_TTL_SECONDS / 2))
  _consult_json "$WAVE_SLUG" "context-provider" "$(_seconds_from_now_iso "$half_ttl")" > "$f"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# result/v1 -- HEAD-ancestry, plan_sha256 freshness, wave scoping
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-result-1 PASS: valid result, head is a STRICT ancestor of current HEAD, real plan_sha256 -> exit 0" {
  _seed_plan
  local stamped_head; stamped_head="$(_real_head)"
  _advance_head
  local f; f="$(_result_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "$WAVE_SLUG" "$stamped_head" "$(_real_plan_sha256)" "done" "$(_now_iso)" > "$f"
  _run_validate result "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-result-2 FAIL: non-ancestor head -> exit 2" {
  _seed_plan
  local f; f="$(_result_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "$WAVE_SLUG" "$NON_ANCESTOR_HEAD" "$(_real_plan_sha256)" "done" "$(_now_iso)" > "$f"
  _run_validate result "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-result-3 FAIL: stale/tampered plan_sha256 (does not match sha256(PLAN.md)) -> exit 2" {
  _seed_plan
  local f; f="$(_result_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "$WAVE_SLUG" "$(_real_head)" "0000000000000000000000000000000000000000000000000000000000000000" "done" "$(_now_iso)" > "$f"
  _run_validate result "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-result-4 FAIL: wrong wave_slug -> exit 2" {
  _seed_plan
  local f; f="$(_result_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "some-other-wave" "$(_real_head)" "$(_real_plan_sha256)" "done" "$(_now_iso)" > "$f"
  _run_validate result "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-result-5 FAIL: status outside the {ready-for-review,done,blocked} enum -> exit 2 (validMarker)" {
  _seed_plan
  local f; f="$(_result_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "totally-made-up-status" "$(_now_iso)" > "$f"
  _run_validate result "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# NOTE: the dispatch text read "non-ancestor AND exact-self -> invalid per
# specialist-dispatch-protocol.md:59", which would make head==currentHEAD
# invalid for result/request/approval -- the OPPOSITE of git's native
# is-ancestor semantics. A clarification was sent to arch-testing (SendMessage
# at drafting time, still outstanding as of this run). CONFIRMED by reading the
# LANDED implementation directly, though: isAncestor() in coordination-artifact.js
# is a byte-identical replica of premature-execution-gate.js's helper -- plain
# `git merge-base --is-ancestor obj.head currentHead`, no self-exclusion special
# case anywhere in isBaseArtifactValid(). Empirically green against that shipped
# code. Retained as its own case (rather than folded into CAV-result-1) so a
# future correction lands as a single, obvious flip if arch-testing's answer
# ever contradicts the shipped behavior. CAV-result-1 above (the primary "valid"
# fixture) deliberately uses a STRICT ancestor precisely so it stays correct
# under EITHER reading, independent of how this one resolves.
@test "CAV-result-6: head == current HEAD exactly (no commits since stamping) -> exit 0 (confirmed against the landed isAncestor(), which has no self-exclusion)" {
  _seed_plan
  local f; f="$(_result_path)"
  mkdir -p "$(dirname "$f")"
  _result_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "done" "$(_now_iso)" > "$f"
  _run_validate result "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# request/v1 -- kind=="scope-extension" requires non-empty files[]
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-request-1 PASS: valid scope-extension request with non-empty files[] -> exit 0" {
  _seed_plan
  local f; f="$(_request_path "test-specialist-$(_now_compact)" "scope-extension")"
  mkdir -p "$(dirname "$f")"
  _request_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "test-specialist-$(_now_compact)" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$f"
  _run_validate request "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-request-2 FAIL: scope-extension kind with EMPTY files[] -> exit 2 (schema requires non-empty)" {
  _seed_plan
  local f; f="$(_request_path "test-specialist-$(_now_compact)" "scope-extension")"
  mkdir -p "$(dirname "$f")"
  _request_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "test-specialist-$(_now_compact)" "scope-extension" '[]' "$(_now_iso)" > "$f"
  _run_validate request "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-request-3 FAIL: non-ancestor head -> exit 2" {
  _seed_plan
  local f; f="$(_request_path "test-specialist-$(_now_compact)" "scope-extension")"
  mkdir -p "$(dirname "$f")"
  _request_json "$WAVE_SLUG" "$NON_ANCESTOR_HEAD" "$(_real_plan_sha256)" "test-specialist-$(_now_compact)" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$f"
  _run_validate request "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-request-4 FAIL: wrong plan_sha256 -> exit 2" {
  _seed_plan
  local f; f="$(_request_path "test-specialist-$(_now_compact)" "scope-extension")"
  mkdir -p "$(dirname "$f")"
  _request_json "$WAVE_SLUG" "$(_real_head)" "0000000000000000000000000000000000000000000000000000000000000000" "test-specialist-$(_now_compact)" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$f"
  _run_validate request "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# approval/v1 -- approval->request linkage (row M), NO glob, exactly-one-confined-path
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-approval-1 PASS: valid approval referencing a genuinely-existing, valid, matching request -> exit 0" {
  _seed_plan
  local req_id="test-specialist-$(_now_compact)"
  local req_f; req_f="$(_request_path "$req_id" "scope-extension")"
  mkdir -p "$(dirname "$req_f")"
  _request_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$req_f"

  local appr_f; appr_f="$(_approval_path "$req_id")"
  mkdir -p "$(dirname "$appr_f")"
  _approval_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" "authorized" "$(_now_iso)" > "$appr_f"

  _run_validate approval "$appr_f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-approval-2 FAIL: approval references a request_id with NO corresponding request file (missing linkage) -> exit 2" {
  _seed_plan
  local req_id="ghost-request-$(_now_compact)"
  # Deliberately do NOT create the linked request file.
  local appr_f; appr_f="$(_approval_path "$req_id")"
  mkdir -p "$(dirname "$appr_f")"
  _approval_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" "authorized" "$(_now_iso)" > "$appr_f"
  _run_validate approval "$appr_f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-approval-3 FAIL: linked request file exists but is itself invalid (wrong wave_slug) -> exit 2 (forged/replay guard)" {
  _seed_plan
  local req_id="test-specialist-$(_now_compact)"
  local req_f; req_f="$(_request_path "$req_id" "scope-extension")"
  mkdir -p "$(dirname "$req_f")"
  # Linked request is present but invalid on its own terms (wrong wave).
  _request_json "some-other-wave" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$req_f"

  local appr_f; appr_f="$(_approval_path "$req_id")"
  mkdir -p "$(dirname "$appr_f")"
  _approval_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" "authorized" "$(_now_iso)" > "$appr_f"

  _run_validate approval "$appr_f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-approval-4 FAIL: request_id containing traversal characters -> exit 2 (no escape via linkage, no glob)" {
  _seed_plan
  # A crafted request_id trying to walk the linkage resolution outside
  # requests/<kind>/ -- must be rejected, never resolved via glob/traversal.
  local req_id="../../../../etc/passwd"
  local appr_f; appr_f="$(_approval_path "test-specialist-$(_now_compact)")"
  mkdir -p "$(dirname "$appr_f")"
  _approval_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" "authorized" "$(_now_iso)" > "$appr_f"
  _run_validate approval "$appr_f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-approval-5 FAIL: decision outside the {authorized,denied} enum -> exit 2 (validMarker)" {
  _seed_plan
  local req_id="test-specialist-$(_now_compact)"
  local req_f; req_f="$(_request_path "$req_id" "scope-extension")"
  mkdir -p "$(dirname "$req_f")"
  _request_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$req_f"

  local appr_f; appr_f="$(_approval_path "$req_id")"
  mkdir -p "$(dirname "$appr_f")"
  _approval_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" "maybe-later" "$(_now_iso)" > "$appr_f"

  _run_validate approval "$appr_f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-approval-6 FAIL: non-ancestor head on the approval itself (linked request otherwise valid) -> exit 2" {
  _seed_plan
  local req_id="test-specialist-$(_now_compact)"
  local req_f; req_f="$(_request_path "$req_id" "scope-extension")"
  mkdir -p "$(dirname "$req_f")"
  _request_json "$WAVE_SLUG" "$(_real_head)" "$(_real_plan_sha256)" "$req_id" "scope-extension" '["docs/foo.md"]' "$(_now_iso)" > "$req_f"

  local appr_f; appr_f="$(_approval_path "$req_id")"
  mkdir -p "$(dirname "$appr_f")"
  _approval_json "$WAVE_SLUG" "$NON_ANCESTOR_HEAD" "$(_real_plan_sha256)" "$req_id" "scope-extension" "authorized" "$(_now_iso)" > "$appr_f"

  _run_validate approval "$appr_f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# stop/v1 -- presence + role match is the signal; headBound N/A
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-stop-1 PASS: valid stop flag (schema + wave_slug + role match) -> exit 0" {
  local f; f="$(_stop_path "test-specialist")"
  mkdir -p "$(dirname "$f")"
  _stop_json "$WAVE_SLUG" "test-specialist" "$(_now_iso)" > "$f"
  _run_validate stop "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-stop-2 FAIL: wrong wave_slug -> exit 2" {
  local f; f="$(_stop_path "test-specialist")"
  mkdir -p "$(dirname "$f")"
  _stop_json "some-other-wave" "test-specialist" "$(_now_iso)" > "$f"
  _run_validate stop "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-stop-3 PASS: non-JSON stop body is TOLERATED -> exit 0 (presence+role IS the signal; body is optional per PLAN.md's 'stop/v1 (optional body)')" {
  # Verified against the shipped isStopFileValid(): a JSON-parse failure on a
  # non-empty body deliberately `return`s true (comment: "non-JSON body
  # tolerated — presence is the signal, body is optional") -- this is NOT the
  # same fail-closed contract as consult/result/request/approval, and is
  # correct by PLAN.md's own kind-specific description. Originally asserted
  # -eq 2 here by over-generalizing consult's "malformed -> 2" rule to every
  # kind; corrected after running this suite against the landed validator.
  local f; f="$(_stop_path "test-specialist")"
  mkdir -p "$(dirname "$f")"
  printf 'not json, but presence at the right path is all that matters' > "$f"
  _run_validate stop "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-stop-3b FAIL: JSON body present WITH a mismatched schema string -> exit 2 (when a body IS supplied and IS JSON, schema/wave_slug mismatches are still rejected)" {
  local f; f="$(_stop_path "test-specialist")"
  mkdir -p "$(dirname "$f")"
  printf '{"schema":"coordination/result/v1","wave_slug":"%s"}' "$WAVE_SLUG" > "$f"
  _run_validate stop "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-stop-4 FAIL: does not exist -> exit 2 (exists=false)" {
  local f; f="$(_stop_path "test-specialist")"
  _run_validate stop "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# message/v1 -- generic inbox artifact. CONFIRMED against the shipped
# validate(): message goes through the SAME isBaseArtifactValid() as
# result/request/approval (kind === 'message' falls into that shared branch
# and "base fields are the whole contract" — no kind-specific fields beyond
# base), so it IS head/plan_sha256-bound like the other post-PLAN kinds, NOT
# treated like consult's pre-PLAN/TTL model. (Originally scoped this section
# as "minimal, pending confirmation" before the validator landed; corrected
# after running this suite against it.)
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-message-1 PASS: valid message (schema/wave/head/plan_sha256 all bound) at the confined inbox path -> exit 0" {
  _seed_plan
  local f; f="$(_message_path)"
  mkdir -p "$(dirname "$f")"
  _message_json "$WAVE_SLUG" "arch-testing" "$(_real_head)" "$(_real_plan_sha256)" "$(_now_iso)" > "$f"
  _run_validate message "$f" "$WAVE_SLUG"
  [ "$status" -eq 0 ]
}

@test "CAV-message-2 FAIL: wrong wave_slug -> exit 2" {
  _seed_plan
  local f; f="$(_message_path)"
  mkdir -p "$(dirname "$f")"
  _message_json "some-other-wave" "arch-testing" "$(_real_head)" "$(_real_plan_sha256)" "$(_now_iso)" > "$f"
  _run_validate message "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-message-3 FAIL: malformed (non-JSON) -> exit 2" {
  local f; f="$(_message_path)"
  mkdir -p "$(dirname "$f")"
  printf 'not json' > "$f"
  _run_validate message "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

@test "CAV-message-4 FAIL: non-ancestor head -> exit 2 (message is head/plan_sha256-bound, same as result/request/approval)" {
  _seed_plan
  local f; f="$(_message_path)"
  mkdir -p "$(dirname "$f")"
  _message_json "$WAVE_SLUG" "arch-testing" "$NON_ANCESTOR_HEAD" "$(_real_plan_sha256)" "$(_now_iso)" > "$f"
  _run_validate message "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Cross-kind: oversized candidate (mirrors the CP-gate's MAX_CONSULT_BYTES
# guard at the validator's own direct-CLI entry point, not just the gate's
# directory scan).
# ══════════════════════════════════════════════════════════════════════════

@test "CAV-oversized-1 FAIL: consult candidate exceeding MAX_CONSULT_BYTES -> exit 2 (skipped-as-invalid)" {
  local f; f="$(_consult_path)"
  mkdir -p "$(dirname "$f")"
  _write_oversized_file "$f" "$((MAX_CONSULT_BYTES + 1))"
  _run_validate consult "$f" "$WAVE_SLUG"
  [ "$status" -eq 2 ]
}
