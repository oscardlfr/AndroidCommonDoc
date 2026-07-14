#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# State-machine/race/crash-cut tests for the portable runtime-consultation core,
# Wave 1 (portable-runtime-messaging-adapters), WP1 -- PLAN.md "Transition State
# Table + Lock Algorithm", "Attempt Authority", "Accepted-Result Authority",
# "Ordered Runtime Loop + Per-Driver Execution Branches", and the internal record
# field tables (claim/active-lease/delivery/activation-intent-WAL/result/
# accepted-result/ack/cancel/conflict/takeover). Path-Manifest confirms sole
# ownership: "scripts/tests/runtime-consultation-state.bats -- test-specialist .
# WP1 . self". Sibling `runtime-consultation-protocol.bats` owns consult/v2
# field-shape + root/parent/depth + inbox-ref/v1 + the cli-result envelope shape
# (its own FM-10 case) -- this file reuses its helper conventions verbatim
# (setup/teardown shape, `_sha256_*`/`_gen_hex_id`, IMPL path, NODE_ENV=test +
# RUNTIME_CONSULTATION_TEST_CAPABILITY invocation) rather than diverging.
#
# STATUS: RED. `scripts/lib/runtime-consultation.cjs` does not exist yet. Every
# test below fails GENUINELY now: `node` reports the module missing (exit 1),
# which trips the first exact-exit-code assertion (never a weak `-ne`) before
# any later JSON-shape/structural assertion runs.
#
# Interpretive decisions (undocumented-by-PLAN specifics; a future correction is
# a small, obvious fix rather than a silent divergence -- mirrors protocol.bats's
# own practice):
#   - `--kind` enum values follow the `<schema-name>-<version>` convention:
#     `claim-v1`, `active-lease-v1`, `delivery-v1`, `activation-intent-v1`,
#     `result-v2` (shared with protocol.bats), `accepted-result-v1`, `ack-v1`,
#     `cancel-v1`, `takeover-v1`. PLAN.md does not spell the exact enum.
#   - `publish-result`'s "exact two native-target forms frozen below" (CLI ABI
#     table) were outside this file's directed PLAN.md read ranges and are NOT
#     fabricated here: every test builds candidate-result state via direct
#     fixture construction (as protocol.bats's `_write_result` already does) and
#     exercises only the fully-specified `claim`/`takeover`/`accept-result`/
#     `cancel`/`lease-heartbeat`/`transaction-ack`/`cleanup`/`validate` verbs.
#   - FM-12 (same-digest duplicate candidate idempotent) is exercised as: a
#     valid current candidate resolves to a completely normal, unblocked
#     ANSWERED/ACCEPTED path with no conflict artifact -- the observable
#     contract "idempotent" implies -- rather than re-invoking an unknown
#     publish-result grammar twice.
#   - FM-13 (different candidate -> cancel+STOP) is exercised via the fully
#     specified `cancel --reason conflict` resolution path against a
#     pre-staged two-candidate disk state, since the upstream detection point
#     lives inside the unread `publish-result` grammar.
#   - Boundary/liveness tests (TO-04, LEASE-CC-*) use REAL relative timestamps
#     captured via `date -u` at test time (never `--fixed-clock`, whose baked
#     reference instant is not spelled out in this file's read ranges) so the
#     eventual implementation's own real clock and this file's fixture
#     timestamps stay mutually consistent without guessing a fixed epoch.
#   - `validate`-rejections are always rc3/status INVALID; the specific
#     `detail_code` (SCHEMA_INVALID/CORRELATION_INVALID/AUTHORITY_INVALID/
#     DURABILITY_UNPROVEN) is this file's own reasonable inference per case,
#     left unpinned (empty string to `_assert_cli_result`) where genuinely
#     more than one closed value is plausible.
#
# Invocation: scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-consultation-state.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
WAVE_SLUG="rcs-test-wave"
TEST_CAPABILITY="bats-runtime-consultation-state-fixture-capability"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null

  COORD_ROOT="$PROJ/.planning/coordination"
  mkdir -p "$COORD_ROOT"

  REPO_ID="$(_compute_repo_id)"
  WORKTREE_ID="$(_compute_worktree_id)"
  COORD_ROOT_ID="$(_sha256_string "$(cd "$COORD_ROOT" && pwd -P)")"
  SUBJECT_HEAD="$(git -C "$PROJ" rev-parse HEAD)"

  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  PLAN_FILE="$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"
  printf '# Fixture PLAN for runtime-consultation-state.bats\n\nThrowaway per-test fixture -- not the real Wave 1 PLAN.md.\n' > "$PLAN_FILE"
  PLAN_DIGEST="$(_sha256_file "$PLAN_FILE")"

  _ID_COUNTER=0

  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" root-init --coordination-root "$COORD_ROOT" >/dev/null 2>&1 || true
}

teardown() {
  rm -rf "$PROJ"
}

# ── Generic helpers (verbatim conventions from runtime-consultation-protocol.bats) ──

_sha256_string() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

_sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

_gen_hex_id() {
  _ID_COUNTER=$((_ID_COUNTER + 1))
  _sha256_string "rcs-fixture-id-$$-${_ID_COUNTER}-${RANDOM}-${RANDOM}"
}

_compute_repo_id() {
  local common_dir resolved
  common_dir="$(git -C "$PROJ" rev-parse --path-format=absolute --git-common-dir)"
  resolved="$(cd "$common_dir" 2>/dev/null && pwd -P)" || resolved="$common_dir"
  _sha256_string "$resolved"
}

_compute_worktree_id() {
  local toplevel resolved
  toplevel="$(git -C "$PROJ" rev-parse --show-toplevel)"
  resolved="$(cd "$toplevel" 2>/dev/null && pwd -P)" || resolved="$toplevel"
  _sha256_string "$resolved"
}

_iso_plus_seconds() {
  local base="$1" n="$2"
  date -u -d "${base} +${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null && return
  date -j -f '%Y-%m-%dT%H:%M:%SZ' "${base}" -v"+${n}S" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
}

# ── Path helpers (Namespace & Root Security tree, PLAN.md ~L602-628) ─────────

_plan_root() { printf '%s' "$COORD_ROOT/$REPO_ID/$WAVE_SLUG/$PLAN_DIGEST"; }
_request_path() { printf '%s' "$(_plan_root)/transactions/$1/request.json"; }
_claim_path() { printf '%s' "$(_plan_root)/transactions/$1/claims/$2.json"; }
_active_lease_path() { printf '%s' "$(_plan_root)/transactions/$1/active-leases/$2.json"; }
_result_path() { printf '%s' "$(_plan_root)/transactions/$1/results/$2.json"; }

# ── JSON fixture builders (merge small overrides over a fully-populated default,
# "__OMIT__" deletes a key -- same idiom as protocol.bats's builders) ──────────

_write_request() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  RCS_REPO_ID="$REPO_ID" RCS_WAVE_SLUG="$WAVE_SLUG" RCS_PLAN_DIGEST="$PLAN_DIGEST" \
  RCS_COORD_ROOT_ID="$COORD_ROOT_ID" RCS_WORKTREE_ID="$WORKTREE_ID" RCS_SUBJECT_HEAD="$SUBJECT_HEAD" \
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const e = process.env;
    const defaults = {
      schema: "coordination/consult/v2",
      request_id: "a".repeat(64),
      root_request_id: "a".repeat(64),
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "test-specialist",
      target_role: "arch-testing",
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      requester_worktree_id: e.RCS_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.RCS_REPO_ID,
      wave_slug: e.RCS_WAVE_SLUG,
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: e.RCS_COORD_ROOT_ID,
      plan_digest: e.RCS_PLAN_DIGEST,
      subject_repo_id: e.RCS_REPO_ID,
      subject_worktree_id: e.RCS_WORKTREE_ID,
      subject_head: e.RCS_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "state fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: "2025-01-01T01:00:00Z",
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: "2025-01-01T00:00:00Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_claim() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  RCS_WORKTREE_ID="$WORKTREE_ID" node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const e = process.env;
    const defaults = {
      schema: "coordination/claim/v1",
      request_id: "a".repeat(64),
      attempt_id: "f".repeat(64),
      lease_epoch: 0,
      claimant_role: "arch-testing",
      claimant_worktree_id: e.RCS_WORKTREE_ID,
      claimant_instance_id: "c".repeat(64),
      worker_session_id: null,
      target_role_profile_digest: "b".repeat(64),
      driver: "noop",
      created_at: "2025-01-01T00:00:10Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_active_lease() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/active-lease/v1",
      attempt_id: "f".repeat(64),
      lease_epoch: 0,
      holder_role: "arch-testing",
      claimant_instance_id: "c".repeat(64),
      worker_session_id: null,
      claim_digest: "1".repeat(64),
      ttl_seconds: 300,
      heartbeat_interval_seconds: 60,
      last_heartbeat_at: "2025-01-01T00:00:10Z",
      lease_expiry: "2025-01-01T00:05:10Z",
      created_at: "2025-01-01T00:00:10Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_result() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  RCS_REPO_ID="$REPO_ID" RCS_WAVE_SLUG="$WAVE_SLUG" RCS_PLAN_DIGEST="$PLAN_DIGEST" \
  RCS_WORKTREE_ID="$WORKTREE_ID" RCS_SUBJECT_HEAD="$SUBJECT_HEAD" \
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const e = process.env;
    const defaults = {
      schema: "coordination/result/v2",
      in_reply_to: "a".repeat(64),
      request_digest: "0".repeat(64),
      plan_digest: e.RCS_PLAN_DIGEST,
      repo_id: e.RCS_REPO_ID,
      wave_slug: e.RCS_WAVE_SLUG,
      protocol_profile: "runtime-consultation/v1",
      max_depth: 2,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      root_request_id: "a".repeat(64),
      parent_request_id: null,
      depth: 0,
      attempt_id: "f".repeat(64),
      lease_epoch: 0,
      driver: "noop",
      claimant_instance_id: "c".repeat(64),
      worker_session_id: null,
      claim_digest: "1".repeat(64),
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      from_role: "arch-testing",
      to_role: "test-specialist",
      result_kind: "TEST_RESULT",
      status: "ANSWERED",
      reason: null,
      content: "a state-fixture answer",
      subject_repo_id: e.RCS_REPO_ID,
      subject_worktree_id: e.RCS_WORKTREE_ID,
      subject_head: e.RCS_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      consultation_dependencies: [],
      producer_worktree_id: e.RCS_WORKTREE_ID,
      producer_head: e.RCS_SUBJECT_HEAD,
      created_at: "2025-01-01T00:05:00Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# ── CLI invocation + assertion helpers ───────────────────────────────────────

_run_cli() {
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" "$@"
}

_run_validate() {
  local kind="$1" artifact="$2"
  _run_cli validate --coordination-root "$COORD_ROOT" --kind "$kind" --artifact "$artifact"
}

# Parses the most recent `run --separate-stderr` invocation's captured stdout
# ($output) as the frozen coordination/cli-result/v1 envelope (PLAN.md ~L779-781)
# -- identical closed-key contract to protocol.bats's own `_assert_cli_result`.
_assert_cli_result() {
  local expected_status="$1" expected_detail="$2"
  node -e '
    let data;
    try {
      data = JSON.parse(process.argv[1]);
    } catch (err) {
      console.error("stdout is not valid JSON: " + err.message);
      process.exit(1);
    }
    const expectedStatus = process.argv[2];
    const expectedDetail = process.argv[3];
    const allowedKeys = ["schema","command","ok","status","code","request_id","artifact_ref","detail_code","content_ref","activation_action"];
    const keys = Object.keys(data);
    const extra = keys.filter((k) => !allowedKeys.includes(k));
    const missing = allowedKeys.filter((k) => !keys.includes(k));
    if (extra.length) { console.error("unexpected extra keys: " + extra.join(",")); process.exit(1); }
    if (missing.length) { console.error("missing required keys: " + missing.join(",")); process.exit(1); }
    if (data.schema !== "coordination/cli-result/v1") { console.error("wrong schema: " + data.schema); process.exit(1); }
    if (data.status !== expectedStatus) { console.error("expected status " + expectedStatus + " got " + data.status); process.exit(1); }
    if (expectedDetail && data.detail_code !== expectedDetail) { console.error("expected detail_code " + expectedDetail + " got " + data.detail_code); process.exit(1); }
    if (typeof data.ok !== "boolean") { console.error("ok is not boolean"); process.exit(1); }
    if ((data.status === "SUCCESS") !== data.ok) { console.error("ok/status inconsistent"); process.exit(1); }
  ' "$output" "$expected_status" "$expected_detail"
}

# ══════════════════════════════════════════════════════════════════════════
# Transition State Table: PUBLISHED -> CLAIMED -> ANSWERED -> ACCEPTED
# (PLAN.md ~L685-698)
# ══════════════════════════════════════════════════════════════════════════

@test "STATE-01 PASS: claim succeeds against the advertised initial_attempt_id (PUBLISHED -> CLAIMED)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-02 FAIL: claim/v1 staged against an attempt_id that is neither initial_attempt_id nor a takeover's new_attempt_id is rejected" {
  local rid aid other; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; other="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$other")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$other")"
  _run_validate claim-v1 "$claim_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "STATE-03 PASS: a valid claim/v1 record validates via validate --kind claim-v1" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  _run_validate claim-v1 "$claim_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-04 FAIL: claim/v1 missing claimant_role is rejected (additionalProperties/required-field schema check)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","claimant_role":"__OMIT__"}' "$rid" "$aid")"
  _run_validate claim-v1 "$claim_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "STATE-05 PASS: a valid active-lease/v1 record validates via validate --kind active-lease-v1" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s"}' "$aid")"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-06 PASS: CLAIMED -> ANSWERED via an immutable candidate result/v2 matching the current claim" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-07 PASS: ANSWERED -> ACCEPTED via accept-result (requester-only, exclusive-create of accepted-result.json)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-08 PASS: a protocol-valid BLOCKED result validates, and transaction-ack --disposition blocked succeeds (never an answer)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"BLOCKED","result_kind":"BLOCKED","reason":"CONSULTATION_FAILED","content":"__OMIT__"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_cli transaction-ack --coordination-root "$COORD_ROOT" --request "$req" --disposition blocked --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-09 FAIL: accept-result is rejected for a transaction whose only result is BLOCKED (never accepted as an answer)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"BLOCKED","result_kind":"BLOCKED","reason":"CONSULTATION_FAILED","content":"__OMIT__"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

@test "STATE-10 PASS: PUBLISHED -> SUPERSEDED via takeover once active-lease-expired eligibility holds" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_created; req_created="$(_iso_plus_seconds "$now" -600)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  # Request itself is still comfortably unexpired (expires at now+3000ish); only this
  # specific attempt's active-lease (below) has gone stale -- isolates lease eligibility
  # from the separate, request-level expiry/cancellation path.
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local stale_heartbeat; stale_heartbeat="$(_iso_plus_seconds "$now" -400)"
  local stale_expiry; stale_expiry="$(_iso_plus_seconds "$now" -100)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$stale_heartbeat" "$stale_expiry")"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(process.argv[1]);
    const oldAttempt = process.argv[2];
    const to = JSON.parse(fs.readFileSync(data.artifact_ref, "utf8"));
    if (to.new_attempt_id === oldAttempt) { console.error("new_attempt_id did not change"); process.exit(1); }
    if (to.superseded_attempt_id !== oldAttempt) { console.error("superseded_attempt_id mismatch"); process.exit(1); }
    if (to.new_lease_epoch <= 0) { console.error("new_lease_epoch not strictly increasing"); process.exit(1); }
  ' "$output" "$aid"
}

@test "STATE-11 PASS: any non-terminal transaction -> EXPIRED via cancel --reason expired" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req" --reason expired --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-12 PASS: any non-terminal transaction -> CANCELLED (explicit) via cancel --reason explicit" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req" --reason explicit --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "STATE-13 FAIL: accept-result is rejected when no candidate result exists yet" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

# ── Additional path helpers + builders for delivery/WAL/takeover records ────

_delivery_path() { printf '%s' "$(_plan_root)/transactions/$1/delivery/$2.json"; }
_activation_intent_path() { printf '%s' "$(_plan_root)/transactions/$1/delivery/$2.intent.json"; }
_takeover_path() { printf '%s' "$(_plan_root)/transactions/$1/takeover.json"; }

_write_delivery() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/delivery/v1",
      request_id: "a".repeat(64),
      attempt_id: "f".repeat(64),
      lease_epoch: 0,
      driver: "noop",
      claim_digest: null,
      commit_point: null,
      commit_point_at: null,
      created_at: "2025-01-01T00:00:05Z",
      delivered: false,
      outcome: null,
      detail_code: "NONE"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_activation_intent() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/activation-intent/v1",
      request_digest: "0".repeat(64),
      attempt_id: "f".repeat(64),
      lease_epoch: 0,
      driver: "claude-sendmessage",
      commit_point_pending: true,
      created_at: "2025-01-01T00:00:03Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_takeover() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/takeover/v1",
      request_id: "a".repeat(64),
      new_attempt_id: "9".repeat(64),
      new_lease_epoch: 1,
      superseded_attempt_id: "f".repeat(64),
      reason: "lease-expired",
      eligibility_kind: "active-lease-expired",
      eligibility_snapshot: {
        claim_digest: "1".repeat(64),
        lease_digest: "3".repeat(64),
        last_heartbeat_at: "2025-01-01T00:00:10Z",
        lease_expiry: "2025-01-01T00:05:10Z"
      },
      eligibility_deadline: "2025-01-01T00:05:10Z",
      eligibility_observed_at: "2025-01-01T00:05:11Z",
      takeover_at: "2025-01-01T00:05:12Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# ══════════════════════════════════════════════════════════════════════════
# Lock algorithm: exclusive mkdir .lock/, orphan-lock never age-reclaimed
# (PLAN.md ~L673-675)
# ══════════════════════════════════════════════════════════════════════════

@test "LOCK-ORPHAN-01: a pre-existing orphaned .lock/ directory is never age-reclaimed -- the waiting operation times out" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local lock_dir; lock_dir="$(dirname "$req")/.lock"
  mkdir -p "$lock_dir"
  # Orphaned: no live owner, artificially aged well past any plausible bounded wait --
  # never age-reclaimed means this age alone must NOT unblock the operation.
  touch -t 202001010000 "$lock_dir" 2>/dev/null || touch -d '2020-01-01' "$lock_dir" 2>/dev/null || true
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 5 ]
  _assert_cli_result "TIMEOUT" ""
}

# ══════════════════════════════════════════════════════════════════════════
# Portable no-clobber primitive + crash cuts (PLAN.md ~L679-683)
# ══════════════════════════════════════════════════════════════════════════

@test "NC-READ-01: a reader never accepts the nlink==2 window as durable" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  # Simulate the in-flight window between linkSync(temp,target) and unlink(temp):
  # an owner-tagged same-dir temp still hard-linked to the target (nlink==2).
  local temp_f; temp_f="$(dirname "$claim_f")/.${aid}.tmp-owner"
  ln "$claim_f" "$temp_f"
  _run_validate claim-v1 "$claim_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "CC-01 crash cut before link: only an owner-tagged temp exists, target path absent" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  mkdir -p "$(dirname "$result_f")"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.tmp-owner"
  printf '{"schema":"coordination/result/v2"}' > "$temp_f"
  # result_f itself was never linked -- validate must treat it as absent/invalid,
  # never as partially-durable.
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

@test "CC-02 crash cut link-before-barrier1: nlink==2 immediately after link is non-authoritative" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.tmp-owner"
  ln "$result_f" "$temp_f"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "CC-03 crash cut after-barrier1-before-unlink: durable target nlink==2 is recovery-cleanup eligible" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.tmp-owner"
  ln "$result_f" "$temp_f"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "CC-04 crash cut after-unlink-before-barrier2: target link already durable, a stray temp unlink replay is safe" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # Temp already unlinked from the target (nlink==1 on the target); a separate,
  # non-hardlinked stray owner-tagged temp file remains (directory-fsync replay window).
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.tmp-owner"
  printf '%s' "$(cat "$result_f")" > "$temp_f"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "CC-05 crash cut after barrier2: fully complete publication validates normally (baseline)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "WAL-01 PASS: an activation-intent WAL with no terminal receipt/delivery validates (possibly-delivered recovery source)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local wal_f; wal_f="$(_activation_intent_path "$rid" "$aid")"
  _write_activation_intent "$wal_f" "$(printf '{"request_digest":"%s","attempt_id":"%s"}' "$req_digest" "$aid")"
  _run_validate activation-intent-v1 "$wal_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

# ══════════════════════════════════════════════════════════════════════════
# Attempt Authority: per-attempt/epoch fencing (PLAN.md ~L700-704)
# ══════════════════════════════════════════════════════════════════════════

@test "AUTH-FENCE-01 FAIL: an old claim/v1 for the pre-takeover attempt_id is fenced out once takeover.json has committed" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$aid")"
  local old_claim_f; old_claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$old_claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  _run_validate claim-v1 "$old_claim_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "AUTH-FENCE-02 FAIL: old-heartbeat-after-takeover -- lease-heartbeat for the superseded attempt is rejected" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local old_claim_f; old_claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$old_claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s"}' "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$aid")"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$old_claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Takeover eligibility (PLAN.md ~L700-704, ~L821, ~L1431 "TO-01..04")
# ══════════════════════════════════════════════════════════════════════════

@test "TO-01 FAIL: a second takeover after one has already committed is rejected (only one permitted takeover)" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$aid")"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

@test "TO-02 FAIL: takeover is rejected when no eligibility predicate holds (fresh, unexpired claim+lease)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_created; req_created="$(_iso_plus_seconds "$now" -10)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$now")"
  local fresh_expiry; fresh_expiry="$(_iso_plus_seconds "$now" 300)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$now" "$fresh_expiry")"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "TO-03a PASS: no-claim branch -- after activation-liveness expiry with no competing claim, takeover wins the fence" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local old_created; old_created="$(_iso_plus_seconds "$now" -2000)"
  local valid_expiry; valid_expiry="$(_iso_plus_seconds "$old_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$old_created" "$valid_expiry")"
  # No claims/ entry at all -- the no-claim branch.
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "TO-03b PASS: claimed-bridge branch -- confirmed-failed-before-commit delivery bound to the exact claim_digest makes takeover immediately eligible" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","driver":"codex-app-server"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local delivery_f; delivery_f="$(_delivery_path "$rid" "$aid")"
  _write_delivery "$delivery_f" "$(printf '{"request_id":"%s","attempt_id":"%s","driver":"codex-app-server","claim_digest":"%s","delivered":false,"outcome":"confirmed-failed-before-commit","detail_code":"CONFIRMED_PRECOMMIT_FAILURE"}' "$rid" "$aid" "$claim_digest")"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "TO-04 FAIL: no-claim ambiguous activation (WAL present, no terminal receipt) cannot reactivate before liveness expiry" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$now" "$req_expiry")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local wal_f; wal_f="$(_activation_intent_path "$rid" "$aid")"
  _write_activation_intent "$wal_f" "$(printf '{"request_digest":"%s","attempt_id":"%s","created_at":"%s"}' "$req_digest" "$aid" "$now")"
  # No claim, no delivery/result -- ambiguous, and the request was just published:
  # activation-liveness has not yet expired, so takeover must be rejected (must win
  # the fence first, not just observe ambiguity).
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "TO-04-claim-no-lease-boundary-not-yet FAIL: takeover rejected 5s after an unleased claim (below the 10s effective deadline)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_created; req_created="$(_iso_plus_seconds "$now" -20)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_created; claim_created="$(_iso_plus_seconds "$now" -5)"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$claim_created")"
  # No active-lease file at all -- claim-without-lease branch, only 5s elapsed.
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "TO-04-claim-no-lease-boundary-passed PASS: takeover eligible 11s after an unleased claim (past the 10s effective deadline)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_created; req_created="$(_iso_plus_seconds "$now" -20)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_created; claim_created="$(_iso_plus_seconds "$now" -11)"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$claim_created")"
  # No active-lease file at all -- claim-without-lease branch, 11s elapsed (past the
  # min(claim+10s, activation expiry, request expiry-60s) deadline; the other two
  # bounds are set far in the future by the request overrides above).
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

# ══════════════════════════════════════════════════════════════════════════
# Durable active-lease provider + refresh crash cuts (PLAN.md ~L677)
# ══════════════════════════════════════════════════════════════════════════

@test "LEASE-CC-01 crash cut pre-replace: the prior complete lease is retained when a refresh never begins" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s"}' "$aid")"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "LEASE-CC-02 crash cut post-replace/pre-dir-fsync: a stray refresh temp does not corrupt reading the prior valid lease" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s"}' "$aid")"
  # Owner-tagged exclusive refresh temp sibling, left behind before the atomic replace
  # committed and before the parent-directory fsync -- not yet accepted as durable,
  # so it must not disturb reading of the still-current lease file.
  local temp_f; temp_f="$(dirname "$lease_f")/.${aid}.refresh-tmp-owner"
  printf '{"schema":"coordination/active-lease/v1","last_heartbeat_at":"2025-01-01T00:10:00Z"}' > "$temp_f"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "LEASE-CC-03 crash cut post-dir-fsync: the newly refreshed lease is eligible once fully durable" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","last_heartbeat_at":"2025-01-01T00:10:00Z","lease_expiry":"2025-01-01T00:15:00Z"}' "$aid")"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

# ══════════════════════════════════════════════════════════════════════════
# Race matrix (multiprocess, deterministic -- PLAN.md ~L1429-1431)
# ══════════════════════════════════════════════════════════════════════════

@test "ACT-01: two sequential claimers for the same advertised attempt/epoch -- exactly one wins, no flaky retry" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --worker-session first-racer --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --worker-session second-racer --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

@test "DX-noconcurrent-01: two truly concurrent claim invocations for the same attempt -- exactly one succeeds" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local out1 out2; out1="$(mktemp)"; out2="$(mktemp)"
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --worker-session racer-a --fixed-ids >"$out1" 2>&1; echo $? >> "$out1" ) &
  local pid1=$!
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --worker-session racer-b --fixed-ids >"$out2" 2>&1; echo $? >> "$out2" ) &
  local pid2=$!
  wait "$pid1" || true
  wait "$pid2" || true
  local rc1 rc2; rc1="$(tail -n1 "$out1")"; rc2="$(tail -n1 "$out2")"
  rm -f "$out1" "$out2"
  # Exactly one truly-parallel claimer wins (rc 0), the other loses (rc 3): sum==3
  # and the two codes differ. Impl absent right now both report rc 1 (module not
  # found), so sum==2 and rc1==rc2 -- both exact checks genuinely fail (not a weak
  # "-ne 0" style differential that impl-absence would trivially satisfy).
  [ "$((rc1 + rc2))" -eq 3 ]
  [ "$rc1" -ne "$rc2" ]
}

@test "RESULT-TO-01: a valid current candidate result that wins first blocks a subsequent takeover" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_created; req_created="$(_iso_plus_seconds "$now" -600)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local stale_expiry; stale_expiry="$(_iso_plus_seconds "$now" -100)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","lease_expiry":"%s"}' "$aid" "$stale_expiry")"
  # Even though the lease looks expired (would otherwise make takeover eligible), a
  # valid CURRENT candidate result already exists and must block the takeover -- the
  # same transition lock linearizes candidate-vs-takeover into one order.
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

@test "RESULT-TO-02: a committed takeover fences a late result from the superseded attempt (accept-result rejects it)" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Fallback Matrix -> test crosswalk rows owned by this file (PLAN.md ~L1454-1461)
# ══════════════════════════════════════════════════════════════════════════

@test "FM-06-takeover-one PASS: canonical worker dead (claimed, never leased) -- takeover succeeds exactly once" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local req_created; req_created="$(_iso_plus_seconds "$now" -30)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_created; claim_created="$(_iso_plus_seconds "$now" -20)"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$claim_created")"
  # No active-lease was ever published -- the worker died before its first heartbeat,
  # 20s ago, well past the 10s claim-without-lease effective deadline.
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "FM-07-degraded-receipt-accept PASS: a degraded/ambiguous delivery receipt does not block accepting a valid current result" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local delivery_f; delivery_f="$(_delivery_path "$rid" "$aid")"
  _write_delivery "$delivery_f" "$(printf '{"request_id":"%s","attempt_id":"%s","delivered":true,"commit_point":"sendmessage-returned","commit_point_at":"2025-01-01T00:00:07Z","outcome":"possibly-delivered"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "FM-08-delivered-no-result-timeout: delivered=true with no result ever appearing -- await-result times out" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local delivery_f; delivery_f="$(_delivery_path "$rid" "$aid")"
  _write_delivery "$delivery_f" "$(printf '{"request_id":"%s","attempt_id":"%s","delivered":true,"commit_point":"sendmessage-returned","commit_point_at":"2025-01-01T00:00:07Z","outcome":"possibly-delivered"}' "$rid" "$aid")"
  # No results/<attempt_id>.json ever appears -- bounded poll must time out, never
  # hang or fabricate success.
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 1
  [ "$status" -eq 5 ]
  _assert_cli_result "TIMEOUT" ""
}

@test "FM-11-superseded-retained-invalid: a late result from a superseded attempt remains on disk but is invalid" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # The file itself remains present on disk (no newest-file-wins, no silent deletion)...
  [ -f "$result_f" ]
  # ...but validating it against the now-superseded attempt is invalid.
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "FM-12-duplicate-idempotent: a same-digest duplicate candidate resolves to a normal, unblocked ANSWERED/ACCEPTED path" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # A byte-identical retry of the exact same candidate content (e.g. after a
  # publisher crash-then-retry) must be idempotent: validation and acceptance both
  # proceed exactly as if only one candidate had ever been written -- no conflict.
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

# ── Additional path helpers + builders for accepted-result/ack/cancel records ──

_accepted_result_path() { printf '%s' "$(_plan_root)/transactions/$1/accepted-result.json"; }
_ack_path() { printf '%s' "$(_plan_root)/transactions/$1/ack.json"; }
_cancel_path() { printf '%s' "$(_plan_root)/transactions/$1/cancel.json"; }
_conflict_path() { printf '%s' "$(_plan_root)/transactions/$1/conflict/$2.json"; }

_write_accepted_result() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/accepted-result/v1",
      request_digest: "0".repeat(64),
      candidate_result_path: "results/" + "f".repeat(64) + ".json",
      result_digest: "2".repeat(64),
      accepted_attempt_id: "f".repeat(64),
      accepted_lease_epoch: 0,
      routing_policy_digest: "e".repeat(64),
      requester_instance_id: "c".repeat(64),
      accepted_at: "2025-01-01T00:10:00Z",
      schema_version: 1
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_ack() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/ack/v1",
      disposition: "accepted",
      in_reply_to_attempt_id: "f".repeat(64),
      acked_at: "2025-01-01T00:11:00Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_cancel() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/cancel/v1",
      request_id: "a".repeat(64),
      reason: "explicit",
      cancelled_at: "2025-01-01T00:12:00Z",
      cancelled_by: "c".repeat(64)
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_conflict() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/conflict/v1",
      attempt_id: "f".repeat(64),
      other_attempt_id: "9".repeat(64),
      detected_at: "2025-01-01T00:12:30Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# ══════════════════════════════════════════════════════════════════════════
# Remaining Fallback Matrix crosswalk row + terminal-retention + accepted-result
# authority (PLAN.md ~L696, ~L706-710, ~L1460)
# ══════════════════════════════════════════════════════════════════════════

@test "FM-13-conflict-cancel-stop: different valid current results for a request are resolved via cancel --reason conflict" {
  local rid aid1 aid2; rid="$(_gen_hex_id)"; aid1="$(_gen_hex_id)"; aid2="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid1")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  # Two different, otherwise-valid-looking candidate results under two distinct
  # attempt_ids for the same still-open request -- a conflict the system must
  # resolve by cancelling rather than silently picking either one (no newest-wins).
  local result1; result1="$(_result_path "$rid" "$aid1")"
  _write_result "$result1" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED","content":"candidate one"}' "$rid" "$req_digest" "$rid" "$aid1")"
  local result2; result2="$(_result_path "$rid" "$aid2")"
  _write_result "$result2" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED","content":"candidate two, genuinely different bytes"}' "$rid" "$req_digest" "$rid" "$aid2")"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req" --reason conflict --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "TERMINAL-NO-DELETE-01: cleanup never removes a terminal accepted-result.json" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local result_digest; result_digest="$(_sha256_file "$result_f")"
  local accepted_f; accepted_f="$(_accepted_result_path "$rid")"
  _write_accepted_result "$accepted_f" "$(printf '{"request_digest":"%s","candidate_result_path":"results/%s.json","result_digest":"%s","accepted_attempt_id":"%s"}' "$req_digest" "$aid" "$result_digest" "$aid")"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  [ -f "$accepted_f" ]
}

@test "ACCEPTED-RESULT-NO-COPY-01: accepted-result.json never copies or re-authorizes the target's content" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED","content":"secret-bearing answer text"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(process.argv[1]);
    const accepted = JSON.parse(fs.readFileSync(data.artifact_ref, "utf8"));
    if ("content" in accepted) { console.error("accepted-result.json must never copy content"); process.exit(1); }
    if (Object.prototype.hasOwnProperty.call(accepted, "content_ref")) { console.error("accepted-result.json must never copy content_ref"); process.exit(1); }
  ' "$output"
}

# ══════════════════════════════════════════════════════════════════════════
# Terminal mutual exclusion (accept-result vs cancel ordering, both halves) +
# Subject-vs-Producer correlation regression tests (PLAN.md ~L417-430, ~L657,
# ~L690 -- correctness-fix verification)
# ══════════════════════════════════════════════════════════════════════════

@test "ACCEPT-VS-CANCEL-01 FAIL: cancel is rejected once accept-result has already produced accepted-result.json (terminal mutual exclusion)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req" --reason explicit --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "CANCEL-VS-ACCEPT-01 FAIL: accept-result is rejected once cancel has already committed cancel.json (the already-correct symmetric half)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req" --reason explicit --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "TRANSACTION_CANCELLED"
}

@test "RESULT-SUBJECT-MISMATCH-01 FAIL: a result/v2 candidate whose subject_head diverges from its request is rejected (a result for subject A is never reused for subject B)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  # Deliberately-different arbitrary hex value, guaranteed to diverge from the
  # fixture's real git-computed subject_head (a real commit SHA is never all zeros).
  local wrong_subject_head; wrong_subject_head="$(printf '0%.0s' {1..40})"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED","subject_head":"%s"}' "$rid" "$req_digest" "$rid" "$aid" "$wrong_subject_head")"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "SUBJECT-HEAD-DRIFT-01 FAIL: accept-result recomputes subject HEAD fresh and rejects once the subject's real HEAD has moved, even though the candidate result's subject_head still mirrors the (now-stale) request" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  # Result's subject_head correctly mirrors the request's (both default to the
  # real $SUBJECT_HEAD captured at setup) -- the mirror-check alone would PASS this;
  # only the SC-10 fresh recompute can catch what happens next.
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # Advance the subject's real git HEAD between request-publish and accept.
  git -C "$PROJ" commit -q --allow-empty -m "subject moved on"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Remaining internal-record schema coverage via validate --kind (PLAN.md ~L437-502)
# ══════════════════════════════════════════════════════════════════════════

@test "SCHEMA-ACCEPTED-RESULT-01 FAIL: accepted-result/v1 missing result_digest is rejected" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local accepted_f; accepted_f="$(_accepted_result_path "$rid")"
  _write_accepted_result "$accepted_f" "$(printf '{"request_digest":"%s","candidate_result_path":"results/%s.json","accepted_attempt_id":"%s","result_digest":"__OMIT__"}' "$req_digest" "$aid" "$aid")"
  _run_validate accepted-result-v1 "$accepted_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "SCHEMA-ACK-01 FAIL: ack/v1 with a disposition outside the accepted|blocked enum is rejected" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local ack_f; ack_f="$(_ack_path "$rid")"
  _write_ack "$ack_f" "$(printf '{"in_reply_to_attempt_id":"%s","disposition":"maybe"}' "$aid")"
  _run_validate ack-v1 "$ack_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "SCHEMA-CANCEL-01 FAIL: cancel/v1 with a reason outside the closed enum is rejected" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local cancel_f; cancel_f="$(_cancel_path "$rid")"
  _write_cancel "$cancel_f" "$(printf '{"request_id":"%s","reason":"changed-my-mind"}' "$rid")"
  _run_validate cancel-v1 "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "SCHEMA-CONFLICT-01 PASS: a well-formed conflict/v1 record validates via validate --kind conflict-v1" {
  local rid aid1 aid2; rid="$(_gen_hex_id)"; aid1="$(_gen_hex_id)"; aid2="$(_gen_hex_id)"
  local conflict_f; conflict_f="$(_conflict_path "$rid" "$aid1-$aid2")"
  _write_conflict "$conflict_f" "$(printf '{"attempt_id":"%s","other_attempt_id":"%s"}' "$aid1" "$aid2")"
  _run_validate conflict-v1 "$conflict_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "SCHEMA-CONFLICT-02 FAIL: conflict/v1 missing other_attempt_id is rejected" {
  local rid aid1 aid2; rid="$(_gen_hex_id)"; aid1="$(_gen_hex_id)"; aid2="$(_gen_hex_id)"
  local conflict_f; conflict_f="$(_conflict_path "$rid" "$aid1-$aid2")"
  _write_conflict "$conflict_f" "$(printf '{"attempt_id":"%s","other_attempt_id":"__OMIT__"}' "$aid1")"
  _run_validate conflict-v1 "$conflict_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "SCHEMA-CONFLICT-03 FAIL: conflict/v1 with an unknown extra field is rejected (additionalProperties:false)" {
  local rid aid1 aid2; rid="$(_gen_hex_id)"; aid1="$(_gen_hex_id)"; aid2="$(_gen_hex_id)"
  local conflict_f; conflict_f="$(_conflict_path "$rid" "$aid1-$aid2")"
  _write_conflict "$conflict_f" "$(printf '{"attempt_id":"%s","other_attempt_id":"%s","unexpected_extra_field":"nope"}' "$aid1" "$aid2")"
  _run_validate conflict-v1 "$conflict_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "SCHEMA-TAKEOVER-01 FAIL: takeover/v1 with new_lease_epoch not strictly greater than the superseded epoch is rejected" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","initial_lease_epoch":0}' "$rid" "$rid" "$aid")"
  local new_aid; new_aid="$(_gen_hex_id)"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s","new_lease_epoch":0}' "$rid" "$new_aid" "$aid")"
  _run_validate takeover-v1 "$to_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}
