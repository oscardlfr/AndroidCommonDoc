#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Tests for scripts/sh/write-coordination-artifact.sh (Wave 2: portable-coordination-artifacts).
# Canonical generic writer, per the script's own header comment (read directly from source --
# this file replaces an earlier draft written against PLAN.md's prose spec before the script
# landed; several stdin/body assumptions in that draft were WRONG and are corrected here):
#
#   write-coordination-artifact.sh --kind {message|consult|request|approval|result|stop} \
#       --from <role> --to <role> [--file <path> ...] [--re <id>] [--slug <wave-slug>]
#
# BODY (stdin) IS A JSON OBJECT, not free text -- shallow-merged UNDER the auto-stamped
# envelope (envelope always wins on key collision: schema/wave_slug/from/to/created_at/head/
# plan_sha256/request_id/files can never be spoofed via stdin). Non-empty stdin that fails to
# parse as a JSON object is exit 2. Required per kind:
#   result:   body.status in {ready-for-review, done, blocked}
#   request:  body.kind (e.g. "scope-extension"); body.kind=="scope-extension" needs >=1 --file
#   approval: body.decision in {authorized, denied}; body.request_kind; approver defaults to --from
#   message/consult/stop: no required body fields; stdin may be empty.
#
# FIELDS WRITTEN: schema (coordination/<kind>/v1), wave_slug, from, to, created_at, +
# head/plan_sha256 for message/result/request/approval (NOT consult/stop), + files[] (only
# when --file given), + request_id (request: filename stem <from>-<ts>; approval: --re value).
#
# OUTPUT PATHS (per kind, from the script's own header comment):
#   message   inbox/<to>/<from>-<ts>.json          (+ outbox/<from>/<from>-<ts>.json mirror)
#   consult   inbox/context-provider/consult-<ts>.json   (--to MUST be context-provider)
#   result    results/<from>/<from>-<ts>.json
#   request   requests/<body.kind>/<from>-<ts>.json
#   approval  approvals/<--re value>.json            (--re REQUIRED for this kind)
#   stop      stop-<to>.flag  (flat; empty stdin -> bare zero-byte presence file, no JSON at all)
#
# EXIT CODES: 0 success; 1 usage/argument error; 2 integrity violation (fail-closed, no bypass).
#
# CORE NON-VACUITY MANDATE (mirrors write-specialist-dispatch.bats): "current" fixtures derive
# head/plan_sha256 from a REAL `git rev-parse HEAD` + REAL sha256 of the seeded PLAN.md computed
# at test-run time -- never hardcoded matching constants.
#
# Isolation: mktemp -d + throwaway git init + CLAUDE_WAVE_SLUG env override -- NEVER touches the
# live .planning/wave-portable-coordination-artifacts/.
#
# Invocation: bats scripts/tests/write-coordination-artifact.bats (from repo root)

SCRIPT="$BATS_TEST_DIRNAME/../sh/write-coordination-artifact.sh"
WAVE_SLUG="wca-test-wave"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" -c user.email=test@example.com -c user.name=test \
      commit -q --allow-empty -m init 2>/dev/null
  unset CLAUDE_WAVE_SLUG
}

teardown() {
  rm -rf "$PROJ"
}

# ── Helpers ──────────────────────────────────────────────────────────────────

_seed_plan() {
  local slug="${1:-$WAVE_SLUG}"
  mkdir -p "$PROJ/.planning/wave-$slug"
  printf '# Plan\n\nSome plan content for %s.\n' "$slug" > "$PROJ/.planning/wave-$slug/PLAN.md"
}

_real_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_real_head() { git -C "$PROJ" rev-parse HEAD; }

# _json_get <file> <field> -- prints a top-level JSON field's value (bool -> true/false,
# list -> compact JSON re-serialization, absent -> the literal string "MISSING", else raw).
_json_get() {
  python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
k = sys.argv[2]
if k not in d:
    print('MISSING')
    sys.exit(0)
v = d[k]
if isinstance(v, bool):
    print('true' if v else 'false')
elif isinstance(v, list):
    print(json.dumps(v))
elif v is None:
    print('null')
else:
    print(v)
" "$1" "$2"
}

# _path_without_python3 <bin_dir> -- populates bin_dir with symlinks to common tools EXCEPT
# python3/python, so PATH="$bin_dir" simulates a python3-less environment for the fail-closed test.
_path_without_python3() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  local tool
  for tool in bash sh git mkdir printf date dirname basename awk sha256sum shasum cat rm ln mv \
              sed grep tr head wc mktemp env realpath readlink true false cp; do
    local real
    real="$(command -v "$tool" 2>/dev/null)" || continue
    ln -sf "$real" "$bin_dir/$tool" 2>/dev/null || true
  done
}

# ══════════════════════════════════════════════════════════════════════════
# Path confinement -- escape/traversal/../-in-slug rejection. None of these reach
# stdin-body parsing (slug resolution / --file confinement / HEAD+PLAN checks all
# happen before BODY_RAW is read), so plain stdin text is fine here.
# ══════════════════════════════════════════════════════════════════════════

@test "WCA-conf-1 FAIL: traversal slug (../evil) exits 2, nothing written" {
  run bash -c "cd '$PROJ' && printf '' | bash '$SCRIPT' \
    --kind consult --from test-specialist --to context-provider --slug '../evil'"
  [ "$status" -eq 2 ]
  [ ! -d "$PROJ/.planning/wave-../evil" ]
}

@test "WCA-conf-2 FAIL: protected slug (develop) exits 2" {
  run bash -c "cd '$PROJ' && printf '' | bash '$SCRIPT' \
    --kind consult --from test-specialist --to context-provider --slug develop"
  [ "$status" -eq 2 ]
}

@test "WCA-conf-3 FAIL: --file resolving outside the repo (absolute /tmp/foo) exits 2, nothing written" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind request --from test-specialist --to arch-testing --file /tmp/foo --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  [ ! -d "$PROJ/.planning/wave-$WAVE_SLUG/requests" ]
}

@test "WCA-conf-4 FAIL: --file with ../ escape exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind request --from test-specialist --to arch-testing --file ../foo --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-conf-5 FAIL: unresolvable HEAD (fresh repo, no commit) exits 2 for a head-bound kind" {
  local empty_proj
  empty_proj="$(mktemp -d)"
  git -C "$empty_proj" init -q 2>/dev/null
  mkdir -p "$empty_proj/.planning/wave-$WAVE_SLUG"
  printf '# Plan\n' > "$empty_proj/.planning/wave-$WAVE_SLUG/PLAN.md"
  run bash -c "cd '$empty_proj' && printf '{\"status\":\"done\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind result --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
  rm -rf "$empty_proj"
}

# ══════════════════════════════════════════════════════════════════════════
# Usage errors (exit 1, distinct from integrity violations at exit 2)
# ══════════════════════════════════════════════════════════════════════════

@test "WCA-usage-1 FAIL: missing --kind exits 1" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 1 ]
}

@test "WCA-usage-2 FAIL: unknown flag exits 1" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind consult --from test-specialist --to context-provider --bogus-flag x --slug '$WAVE_SLUG'"
  [ "$status" -eq 1 ]
}

@test "WCA-usage-3 FAIL: invalid --kind exits 2 (kind IS validated, not a bare usage error)" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind bogus-kind --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-usage-4 FAIL: --kind consult with --to != context-provider exits 2" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind consult --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-usage-5 FAIL: --kind approval without --re exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"decision\":\"authorized\",\"request_kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind approval --from arch-testing --to test-specialist --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Schema stamping -- coordination/<kind>/v1, wave_slug/from/to/created_at always;
# head+plan_sha256 present for message/result/request/approval, ABSENT for consult/stop.
# ══════════════════════════════════════════════════════════════════════════

@test "WCA-schema-1 PASS: --kind consult (empty stdin) stamps coordination/consult/v1, head+plan_sha256 ABSENT" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind consult --from test-specialist --to context-provider --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/inbox/context-provider"
  local matches=("$dir"/consult-*.json)
  [ -f "${matches[0]}" ]
  local f="${matches[0]}"
  [ "$(_json_get "$f" schema)" = "coordination/consult/v1" ]
  [ "$(_json_get "$f" wave_slug)" = "$WAVE_SLUG" ]
  [ "$(_json_get "$f" from)" = "test-specialist" ]
  [ "$(_json_get "$f" to)" = "context-provider" ]
  [ "$(_json_get "$f" created_at)" != "MISSING" ]
  [ "$(_json_get "$f" head)" = "MISSING" ]
  [ "$(_json_get "$f" plan_sha256)" = "MISSING" ]
}

@test "WCA-schema-2 PASS: --kind stop with EMPTY stdin writes a bare zero-byte presence flag (no JSON envelope at all)" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind stop --from arch-testing --to test-specialist --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local f="$PROJ/.planning/wave-$WAVE_SLUG/stop-test-specialist.flag"
  [ -f "$f" ]
  [ ! -s "$f" ]
}

@test "WCA-schema-2b PASS: --kind stop with a JSON body DOES get the envelope (schema/wave_slug present, head/plan_sha256 ABSENT)" {
  run bash -c "cd '$PROJ' && printf '{\"reason\":\"done for the day\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind stop --from arch-testing --to test-specialist --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local f="$PROJ/.planning/wave-$WAVE_SLUG/stop-test-specialist.flag"
  [ -f "$f" ]
  [ -s "$f" ]
  [ "$(_json_get "$f" schema)" = "coordination/stop/v1" ]
  [ "$(_json_get "$f" wave_slug)" = "$WAVE_SLUG" ]
  [ "$(_json_get "$f" head)" = "MISSING" ]
  [ "$(_json_get "$f" plan_sha256)" = "MISSING" ]
}

@test "WCA-schema-3 PASS: --kind result stamps coordination/result/v1, head+plan_sha256 PRESENT and REAL" {
  _seed_plan
  local real_head real_plan_sha256
  real_head="$(_real_head)"
  real_plan_sha256="$(_real_sha256 "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md")"
  run bash -c "cd '$PROJ' && printf '{\"status\":\"done\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind result --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/results/test-specialist"
  local matches=("$dir"/test-specialist-*.json)
  [ -f "${matches[0]}" ]
  local f="${matches[0]}"
  [ "$(_json_get "$f" schema)" = "coordination/result/v1" ]
  [ "$(_json_get "$f" head)" = "$real_head" ]
  [ "$(_json_get "$f" plan_sha256)" = "$real_plan_sha256" ]
  [ "$(_json_get "$f" status)" = "done" ]
}

@test "WCA-schema-3b FAIL: --kind result with status outside the enum exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"status\":\"totally-made-up\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind result --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-schema-3c FAIL: --kind result with missing status field exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind result --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-schema-4 PASS: --kind request stamps coordination/request/v1, head+plan_sha256 PRESENT, request_id = filename stem" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind request --from test-specialist --to arch-testing --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/requests/scope-extension"
  local matches=("$dir"/test-specialist-*.json)
  [ -f "${matches[0]}" ]
  local f="${matches[0]}"
  local stem; stem="$(basename "$f" .json)"
  [ "$(_json_get "$f" schema)" = "coordination/request/v1" ]
  [ "$(_json_get "$f" request_id)" = "$stem" ]
  [ "$(_json_get "$f" head)" != "MISSING" ]
  [ "$(_json_get "$f" plan_sha256)" != "MISSING" ]
  [ "$(_json_get "$f" files)" = '["docs/foo.md"]' ]
}

@test "WCA-schema-4b FAIL: --kind request body.kind==scope-extension with NO --file exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind request --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-schema-4c FAIL: --kind request with missing body.kind field exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind request --from test-specialist --to arch-testing --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-schema-5 PASS: --kind approval --re <request_id> stamps coordination/approval/v1 with matching request_id, head+plan_sha256 PRESENT, approver defaults to --from" {
  _seed_plan
  local req_id="test-specialist-20260101T000000Z"
  run bash -c "cd '$PROJ' && printf '{\"decision\":\"authorized\",\"request_kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind approval --from arch-testing --to test-specialist --re '$req_id' --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local f="$PROJ/.planning/wave-$WAVE_SLUG/approvals/$req_id.json"
  [ -f "$f" ]
  [ "$(_json_get "$f" schema)" = "coordination/approval/v1" ]
  [ "$(_json_get "$f" request_id)" = "$req_id" ]
  [ "$(_json_get "$f" head)" != "MISSING" ]
  [ "$(_json_get "$f" plan_sha256)" != "MISSING" ]
  [ "$(_json_get "$f" approver)" = "arch-testing" ]
}

@test "WCA-schema-5b FAIL: --kind approval with decision outside the enum exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"decision\":\"maybe-later\",\"request_kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind approval --from arch-testing --to test-specialist --re 'test-specialist-20260101T000000Z' --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-schema-5c FAIL: --kind approval with missing request_kind exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"decision\":\"authorized\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind approval --from arch-testing --to test-specialist --re 'test-specialist-20260101T000000Z' --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-schema-6 PASS: --kind message stamps coordination/message/v1, head+plan_sha256 PRESENT, mirrored into outbox/<from>/ with identical content" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind message --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/inbox/arch-testing"
  local matches=("$dir"/test-specialist-*.json)
  [ -f "${matches[0]}" ]
  local f="${matches[0]}"
  [ "$(_json_get "$f" schema)" = "coordination/message/v1" ]
  [ "$(_json_get "$f" head)" != "MISSING" ]
  [ "$(_json_get "$f" plan_sha256)" != "MISSING" ]

  local mirror="$PROJ/.planning/wave-$WAVE_SLUG/outbox/test-specialist/$(basename "$f")"
  [ -f "$mirror" ]
  diff "$f" "$mirror"
}

# ══════════════════════════════════════════════════════════════════════════
# Envelope wins on key collision -- stdin can never spoof schema/wave_slug/etc.
# ══════════════════════════════════════════════════════════════════════════

@test "WCA-spoof-1 PASS: stdin attempting to override wave_slug/schema is ignored -- envelope always wins" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"status\":\"done\",\"wave_slug\":\"attacker-wave\",\"schema\":\"coordination/evil/v1\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind result --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/results/test-specialist"
  local matches=("$dir"/test-specialist-*.json)
  local f="${matches[0]}"
  [ "$(_json_get "$f" wave_slug)" = "$WAVE_SLUG" ]
  [ "$(_json_get "$f" schema)" = "coordination/result/v1" ]
}

@test "WCA-spoof-2 FAIL: malformed (non-JSON) stdin body exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf 'not json at all' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind message --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

@test "WCA-spoof-3 FAIL: JSON array (not object) as stdin body exits 2" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '[1,2,3]' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind message --from test-specialist --to arch-testing --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Filename compact-UTC (no ':')
# ══════════════════════════════════════════════════════════════════════════

@test "WCA-fname-1 PASS: consult filename uses compact UTC timestamp with no colon" {
  run bash -c "cd '$PROJ' && printf '' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind consult --from test-specialist --to context-provider --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/inbox/context-provider"
  local matches=("$dir"/consult-*.json)
  local fname; fname="$(basename "${matches[0]}")"
  [[ "$fname" =~ ^consult-[0-9]{8}T[0-9]{6}Z\.json$ ]]
  [[ "$fname" != *":"* ]]
}

@test "WCA-fname-2 PASS: request filename uses compact UTC timestamp with no colon" {
  _seed_plan
  run bash -c "cd '$PROJ' && printf '{\"kind\":\"scope-extension\"}' | CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind request --from test-specialist --to arch-testing --file docs/foo.md --slug '$WAVE_SLUG'"
  [ "$status" -eq 0 ]
  local dir="$PROJ/.planning/wave-$WAVE_SLUG/requests/scope-extension"
  local matches=("$dir"/test-specialist-*.json)
  local fname; fname="$(basename "${matches[0]}")"
  [[ "$fname" =~ ^test-specialist-[0-9]{8}T[0-9]{6}Z\.json$ ]]
  [[ "$fname" != *":"* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# python3-missing -> fail-closed
# ══════════════════════════════════════════════════════════════════════════

@test "WCA-python3-missing FAIL: python3 absent from PATH -> fail-closed exit 2 (never silently skip JSON authoring)" {
  _seed_plan
  local bin_dir="$PROJ/.fake-bin"
  _path_without_python3 "$bin_dir"
  # Sanity: confirm the simulated PATH truly lacks python3 before trusting the main assertion.
  run bash -c "PATH='$bin_dir' command -v python3"
  [ "$status" -ne 0 ]

  run bash -c "cd '$PROJ' && printf '' | PATH='$bin_dir' CLAUDE_WAVE_SLUG='$WAVE_SLUG' bash '$SCRIPT' \
    --kind consult --from test-specialist --to context-provider --slug '$WAVE_SLUG'"
  [ "$status" -eq 2 ]
}
