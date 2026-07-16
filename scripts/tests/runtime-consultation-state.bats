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
  # Portable node-based ISO (base + n seconds). No GNU/BSD `date` divergence: the
  # old `date -j -f ... -v"+${n}S"` BSD fallback silently corrupted output when a
  # positional was consumed. Strips milliseconds to preserve this helper's
  # historical no-ms `%Y-%m-%dT%H:%M:%SZ` shape.
  node -e 'process.stdout.write(new Date(Date.parse(process.argv[1]) + Number(process.argv[2]) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"))' "$base" "$n"
}

# Portable node-based current-UTC ISO (no shell `date`); no-ms shape to match _iso_plus_seconds.
_iso_now() {
  node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))'
}

# Codex NO-GO round 3 (blocker 2, cleanup item 6): a full recursive disk snapshot
# {path, type, mode, digest} of everything under $1, sorted, one line per entry --
# for proving a FAILED call caused literally ZERO bytes of mutation, not merely that
# some narrower proxy (an entry count, a single file's presence) stayed the same.
# Verbatim convention from runtime-consultation-protocol.bats's own `_snapshot_tree`.
_snapshot_tree() {
  local root="$1"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const root = process.argv[1];
    const out = [];
    function walk(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.relative(root, full);
        const lst = fs.lstatSync(full);
        let type = "other";
        let digest = "";
        if (lst.isDirectory()) { type = "dir"; walk(full); }
        else if (lst.isSymbolicLink()) { type = "symlink"; }
        else if (lst.isFile()) {
          type = "file";
          digest = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        }
        out.push(rel + "\t" + type + "\t" + (lst.mode & 0o777).toString(8) + "\t" + digest);
      }
    }
    if (fs.existsSync(root)) walk(root);
    out.sort();
    process.stdout.write(out.join("\n"));
  ' "$root"
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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

# Section 4 (six deterministic interleavings): polls (bounded, no fixed sleep-and-hope
# guess) for a backgrounded process's `testRendezvous` "-ready" sentinel to appear under
# $1/txndir, matching the production RENDEZVOUS_MAX_WAIT_MS=5000/RENDEZVOUS_POLL_MS=20
# budget. Fails loud (never hangs the suite) if the sentinel never appears.
_wait_for_rendezvous_ready() {
  local txndir="$1" name="$2" tries=0
  while [ ! -f "$txndir/.rendezvous-${name}-ready" ]; do
    tries=$((tries + 1))
    if [ "$tries" -gt 300 ]; then
      echo "rendezvous '$name' ready-sentinel never appeared under $txndir" >&2
      return 1
    fi
    sleep 0.02
  done
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

@test "DUR-J-Gap1-ack-blocked-nlink2 FAIL: transaction-ack --disposition blocked must not answer 'no BLOCKED result' while a BLOCKED candidate is still in the nlink==2 in-flight window -- findResultWithStatus reports DURABILITY_UNPROVEN, never treats PENDING as absent" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"BLOCKED","result_kind":"BLOCKED","reason":"CONSULTATION_FAILED","content":"__OMIT__"}' "$rid" "$req_digest" "$rid" "$aid")"
  # Put the BLOCKED result candidate in the reader-rejected nlink==2 in-flight window: a
  # scan that skips it as if absent would falsely answer "no BLOCKED result exists".
  local result_tmp; result_tmp="$(dirname "$result_f")/.${aid}.tmp-owner"
  ln "$result_f" "$result_tmp"
  _run_cli transaction-ack --coordination-root "$COORD_ROOT" --request "$req" --disposition blocked --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-J-Gap2-await-symlink-result-STOP FAIL (allowlist NEGATIVE): await-result must PROPAGATE + STOP on a result candidate that is a symlink (SECURITY_INVALID), never catch-all-swallow it and keep polling to a generic timeout" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local real_target="$PROJ/evil-symlink-result-target.json"
  _write_result "$real_target" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  mkdir -p "$(dirname "$result_f")"
  ln -s "$real_target" "$result_f"
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "DUR-J-Gap2-await-nlink2-result-STOP FAIL (allowlist NEGATIVE): await-result must PROPAGATE + STOP (DURABILITY_UNPROVEN) on a result candidate in the nlink==2 in-flight window, never keep polling past it" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local result_tmp; result_tmp="$(dirname "$result_f")/.${aid}.tmp-owner"
  ln "$result_f" "$result_tmp"
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-J-Gap2-await-malformed-result-STOP FAIL (allowlist NEGATIVE): await-result must PROPAGATE + STOP (SCHEMA_INVALID) on a durable but malformed result candidate, never keep polling past it" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  mkdir -p "$(dirname "$result_f")"
  printf 'this is not valid json at all' > "$result_f"
  chmod 0600 "$result_f"
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "DUR-J-Gap2-await-stale-correlation-STOP (Section 8 correction): a stale CORRELATION_INVALID candidate (a durable, shape-valid result whose request_digest does not match) PROPAGATES + STOPs immediately -- CORRELATION_INVALID is REMOVED from the pollable allowlist, never laundered into a generic TIMEOUT" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  # A durable, shape-valid ANSWERED result whose request_digest is deliberately WRONG
  # (all zeros): validateResultV2 rejects it CORRELATION_INVALID. Section 8: only
  # AUTHORITY_INVALID (proof the attempt itself is superseded) remains pollable -- a
  # stale/wrong-digest candidate is an honest correlation failure, surfaced immediately.
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "0000000000000000000000000000000000000000000000000000000000000000" "$rid" "$aid")"
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 3
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
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
  [ "$status" -eq 6 ]
  _assert_cli_result "BLOCKED" "RESULT_BLOCKED"
}

@test "STATE-10 PASS: PUBLISHED -> SUPERSEDED via takeover once active-lease-expired eligibility holds" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(_iso_now)"
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
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
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "CC-03 crash cut after-barrier1-before-unlink: a GENUINE owner-only 0600 durable target nlink==2 is recovery-eligible but cleanup NEVER auto-completes the unlink (Codex NO-GO round 2, blocker 1: no fd-bound unlink primitive) -- cleanup reports DURABILITY_UNPROVEN, the crash-orphaned temp is left in place, the target stays reader-rejected nlink==2" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # A genuine publishNoClobber target is owner-only 0600; reproduce that exactly so
  # reconcile recognizes it as a genuine, fully-proven crash-cut pair.
  chmod 0600 "$result_f"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  # The crash-orphaned temp is deliberately LEFT untouched -- a path-based unlink here
  # cannot be proven to target the accredited inode (Codex round-2 blocker 1) -- and the
  # target stays at the reader-rejected nlink==2 window.
  [ -e "$temp_f" ]
  local target_nlink; target_nlink="$(node -e 'process.stdout.write(String(require("fs").lstatSync(process.argv[1]).nlink))' "$result_f")"
  [ "$target_nlink" -eq 2 ]
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "CC-04 crash cut after-unlink-before-barrier2: a genuine standalone stray temp is left in place by cleanup (Codex NO-GO round 2, blocker 1) -- the ALREADY-durable, unrelated target is untouched and still validates" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # Temp already unlinked from the target (nlink==1 on the target); a separate,
  # non-hardlinked stray owner-tagged temp file remains (directory-fsync replay window).
  # A genuine stray carries the owner-only 0600 mode every publish temp is created with.
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  printf '%s' "$(cat "$result_f")" > "$temp_f"
  chmod 0600 "$temp_f"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  # The genuine stray is identified but deliberately NOT removed; the already-durable,
  # UNRELATED target (never hardlinked to it) remains untouched and valid regardless.
  [ -e "$temp_f" ]
  _run_validate result-v2 "$result_f"
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

@test "DUR-H-reconcile-promotes-nongenuine FAIL: cleanup must NOT promote a durability-unproven, non-genuine (wrong-mode 0644) hard-linked companion out of the reader-rejected nlink==2 window into reader-acceptable nlink==1 -- reconcile blindly unlinks any temp-named sibling without proving it is an owner-confined 0600 regular file" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # A genuine publishNoClobber/publishReplace temp is owner-only 0600; _write_result
  # leaves 0644. Force the world-readable 0644 mode explicitly and hard-link a temp
  # sibling so the target sits in the reader-rejected nlink==2 durability window.
  chmod 0644 "$result_f"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  # Precondition: the non-genuine 0644 target is rejected by a reader -- the exact-0600 mode
  # gate fires first (SECURITY_INVALID); the nlink==2 window is a second reason it is not durable.
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
  # Cleanup must LEAVE this non-genuine 0644 pair untouched (reconcile verifies owner/mode/
  # regular-file before unlinking), so the target stays a rejected 0644 nlink==2 record and a
  # reader STILL rejects it -- reconcile never launders it into an acceptable one.
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "DUR-J-cleanup-confused-deputy-display: cleanup's own request_id DISPLAY value for a transaction A whose request.json is durable/closed-shape but internally embeds request_id:B must be null, never the fabricated B, and must not mutate disk" {
  # Codex NO-GO round 4 (fixed) / round 5 (persistent regression test added): a
  # request.json stored at transaction A's own canonical path but internally
  # embedding a DIFFERENT request_id (B) -- the same confused-deputy shape as the
  # round-3 blocker-1 finding, applied here to cleanup's own response envelope rather
  # than an authoritative reader. cmdCleanup now reuses readCanonicalRequestRecord
  # (the same canonical validation every other authoritative reader uses) for this
  # DISPLAY-only field; on identity mismatch the response omits the id (null) rather
  # than echoing the unearned foreign identity. Reconciliation (the actual work
  # cleanup performs) is entirely unaffected -- there is nothing to reconcile in this
  # fixture (no temp siblings), so cleanup still returns rc0/SUCCESS overall.
  local id_a; id_a="$(_gen_hex_id)"
  local id_b; id_b="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_a; req_a="$(_request_path "$id_a")"
  # Stored AT transaction A's own path, but the content claims to BE request B.
  _write_request "$req_a" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id_b" "$id_b" "$aid")"

  local before; before="$(_snapshot_tree "$COORD_ROOT")"

  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req_a" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local got_request_id; got_request_id="$(node -e 'console.log(JSON.parse(process.argv[1]).request_id)' "$output")"
  [ "$got_request_id" = "null" ]

  local after; after="$(_snapshot_tree "$COORD_ROOT")"
  [ "$before" = "$after" ]
}

# ══════════════════════════════════════════════════════════════════════════
# Section 7: accredited DUR-H recovery. Fixtures use the REAL production
# no-clobber temp filename: .{target-basename}.{pid}.{16-lowercase-hex}.tmp-owner.
# ══════════════════════════════════════════════════════════════════════════

@test "DUR-H-01 wrong encoded target: a temp encoding a target basename that does not exist in the directory is left as a durable orphan -- reconcile never falls back to inode-only matching" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  chmod 0600 "$result_f"
  # Temp encodes a basename that does not exist in this directory at all.
  local temp_f; temp_f="$(dirname "$result_f")/.nonexistent-target.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  # Codex P1-3: an unresolvable derived companion is 'ambiguous' -- cleanup itself now
  # reports DURABILITY_UNPROVEN (never a silent SUCCESS) even though the orphan is
  # correctly LEFT UNTOUCHED (never promoted on a guess).
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -e "$temp_f" ]
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-H-02 noncanonical temp: a temp name missing the pid/hex components does not match the production grammar -- reconcile never touches it" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  chmod 0600 "$result_f"
  # Missing the pid/hex components entirely -- does not match the production grammar.
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.tmp-owner"
  ln "$result_f" "$temp_f"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  [ -e "$temp_f" ]
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-H-03 hardlink outside directory: a temp whose real second link lives OUTSIDE this directory does not validate a same-named target here -- dev/ino mismatch, orphan retained" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  chmod 0600 "$result_f"
  # A SEPARATE file elsewhere, hardlinked to the temp -- the temp's true companion is
  # OUTSIDE the results/ directory, not the same-named result_f here.
  local elsewhere; elsewhere="$PROJ/elsewhere-companion.json"
  printf '%s' "$(cat "$result_f")" > "$elsewhere"
  chmod 0600 "$elsewhere"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$elsewhere" "$temp_f"
  # Codex P1-3: a dev/ino mismatch against the derived companion is 'ambiguous' --
  # cleanup itself now reports DURABILITY_UNPROVEN even though both files are correctly
  # LEFT UNTOUCHED (never conflated on a name match alone).
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -e "$temp_f" ]
  [ -e "$elsewhere" ]
  # result_f itself was NEVER linked to the temp -- it stays a genuinely durable,
  # standalone nlink==1 record throughout.
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "DUR-H-04 symlink target: a temp whose derived target path is a SYMLINK is rejected at open (O_NOFOLLOW) -- orphan retained, the symlink and its victim untouched" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  mkdir -p "$(dirname "$result_f")"
  # The temp's real hardlink companion (x) is unrelated to result_f -- result_f is a
  # SYMLINK, never the temp's actual second link.
  local x; x="$(dirname "$result_f")/.x-companion.json"
  printf 'x content' > "$x"
  chmod 0600 "$x"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$x" "$temp_f"
  local evil; evil="$PROJ/evil-symlink-victim.json"
  printf 'attacker content' > "$evil"
  ln -s "$evil" "$result_f"
  # Codex P1-3: a symlinked derived target is rejected at open -- 'ambiguous' -- so
  # cleanup itself now reports DURABILITY_UNPROVEN even though the symlink and its
  # victim are correctly LEFT UNTOUCHED (never followed).
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -e "$temp_f" ]
  [ -L "$result_f" ]
  local evil_content; evil_content="$(cat "$evil")"
  [ "$evil_content" = "attacker content" ]
}

@test "DUR-H-05 temp/target path swap: a temp encoding 'expected' but hardlinked to 'malicious' is rejected -- dev/ino mismatch against the DERIVED name, never promoted merely because SOME inode-linked file exists" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  chmod 0600 "$result_f"
  local malicious; malicious="$(dirname "$result_f")/malicious.json"
  printf 'malicious content' > "$malicious"
  chmod 0600 "$malicious"
  # Temp ENCODES result_f's own basename ("$aid.json") but is ACTUALLY hardlinked to
  # malicious.json -- an attempt to promote malicious.json's identity onto result_f's
  # own name via inode confusion.
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$malicious" "$temp_f"
  # Codex P1-3: a dev/ino mismatch against the derived (genuinely-named) target is
  # 'ambiguous' -- cleanup itself now reports DURABILITY_UNPROVEN even though both
  # files are correctly LEFT UNTOUCHED (never conflated by name alone).
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -e "$temp_f" ]
  # result_f (the genuinely-named, standalone target) remains valid and UNTOUCHED --
  # never conflated with malicious.json's inode.
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local malicious_content; malicious_content="$(cat "$malicious")"
  [ "$malicious_content" = "malicious content" ]
}

@test "DUR-H-06 digest/metadata drift: a genuine crash-cut pair that MUTATES between the companion-proof and the byte-compare is rejected, never promoted on stale metadata" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  chmod 0600 "$result_f"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_READ_MUTATE=grow \
    node "$IMPL" cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  # Codex P1-3: a mid-recovery byte/metadata drift is 'ambiguous'/'drift' -- cleanup
  # itself now reports DURABILITY_UNPROVEN even though the pair is correctly LEFT a
  # durable orphan (the drift was caught before any barrier/unlink).
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -e "$temp_f" ]
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

# DUR-H-07 (unlink failure), DUR-H-08 (barrier2 failure), DUR-H-09 (final
# revalidation failure), and DUR-H-11 (mismatch + final lstat interaction) were
# REMOVED here (Codex NO-GO round 2, blocker 1): `reconcileOneNoClobberTemp` no
# longer performs a temp-unlink, a post-unlink barrier2, or a post-unlink
# revalidation/final-lstat step at all -- see the function's own doc comment for why
# (no portable primitive can bind a path-based unlink to a previously fd-accredited
# inode). Their fault-injection seams (`RUNTIME_CONSULTATION_FAULT_RECONCILE_UNLINK`/
# `_REVALIDATE`/`_FINAL_LSTAT`, plus the `reconcile-barrier1`/`reconcile-barrier2`
# `fsyncDir` labels) no longer exist in the implementation; keeping these tests would
# have them pass VACUOUSLY (their injected faults now do nothing, yet their
# assertions happen to still hold for an unrelated reason -- the new
# always-STOP-before-unlinking behavior). CC-03/CC-04 (rewritten, same file) now
# cover the genuine-pair/genuine-stray happy paths under the new behavior; DUR-H-01
# through DUR-H-06 (unresolvable/foreign/symlinked/swapped companion, mid-read drift)
# are UNCHANGED and still exercise real, reachable code.

@test "DUR-H-10 (Codex gap #4) temp fstat failure: a genuine crash-cut temp whose OWN initial fstat fails (after a successful open) is a FAILURE, not a benign skip -- cleanup reports DURABILITY_UNPROVEN and the pair is left untouched" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  chmod 0600 "$result_f"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT=1 \
    node "$IMPL" cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  # Neither the temp nor the target was touched -- the fstat failure happened before
  # any decision about genuineness could even be made.
  [ -e "$temp_f" ]
  local target_nlink; target_nlink="$(node -e 'process.stdout.write(String(require("fs").lstatSync(process.argv[1]).nlink))' "$result_f")"
  [ "$target_nlink" -eq 2 ]
}

# DUR-H-11 (mismatch + final lstat interaction) REMOVED alongside DUR-H-07/08/09
# above -- same reason, see that comment block.

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

@test "DUR-J-takeover-nlink2 FAIL: a non-durable (nlink==2) takeover.json must never change attempt authority -- the fd-bound durable-read gate STOPs with DURABILITY_UNPROVEN rather than letting an in-flight takeover fence the prior attempt's claim" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$aid")"
  # Put takeover.json in the reader-rejected nlink==2 window (owner-tagged temp still
  # hard-linked -- a publish/refresh crash-cut): the takeover has NOT durably
  # committed, so it must not exercise attempt authority. Pre-DUR-J the raw read
  # accepts it and fences the old claim (AUTHORITY_INVALID) -- a non-durable artifact
  # exercising authority, the defect.
  local to_tmp; to_tmp="$(dirname "$to_f")/.takeover.json.${new_aid}.tmp-owner"
  ln "$to_f" "$to_tmp"
  local old_claim_f; old_claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$old_claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  _run_validate claim-v1 "$old_claim_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-J-claim-nlink2-heartbeat FAIL: a non-durable (nlink==2) claim must not drive a lease heartbeat -- the fd-bound durable-read gate STOPs with DURABILITY_UNPROVEN" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  # Put the claim in the reader-rejected nlink==2 window (owner-tagged temp still linked).
  local claim_tmp; claim_tmp="$(dirname "$claim_f")/.claim.${aid}.tmp-owner"
  ln "$claim_f" "$claim_tmp"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s"}' "$aid")"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-J-lease-nlink2-heartbeat FAIL: a non-durable (nlink==2) EXISTING active-lease must not be silently treated as 'no lease' by a refresh -- the durable-read gate STOPs with DURABILITY_UNPROVEN rather than laundering the in-flight lease" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s"}' "$aid")"
  # Put the EXISTING lease in the reader-rejected nlink==2 window.
  local lease_tmp; lease_tmp="$(dirname "$lease_f")/.active-lease.${aid}.tmp-owner"
  ln "$lease_f" "$lease_tmp"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-J-request-nlink2 FAIL: a non-durable (nlink==2) request.json must not participate in any transaction operation -- the fd-bound durable-read gate STOPs with DURABILITY_UNPROVEN" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  # Put request.json in the reader-rejected nlink==2 window (owner-tagged temp still linked).
  local req_tmp; req_tmp="$(dirname "$req")/.request.json.tmp-owner"
  ln "$req" "$req_tmp"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "SCHEMA-REQUEST-CLAIM-01 FAIL (Codex P1-2): claim rejects a request.json missing a required CONSULT_V2_FIELDS field -- SCHEMA_INVALID, no claim/lease published" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","target_role":"__OMIT__"}' "$rid" "$rid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  [ ! -e "$claim_f" ]
  [ ! -e "$lease_f" ]
}

@test "SCHEMA-REQUEST-CLAIM-02 FAIL (Codex P1-2): claim rejects a request.json carrying an unknown extra field -- SCHEMA_INVALID (additionalProperties:false), no claim/lease published" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","unexpected_field":"attacker-controlled"}' "$rid" "$rid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  [ ! -e "$claim_f" ]
}

@test "SCHEMA-REQUEST-HEARTBEAT-01 FAIL (Codex P1-2): lease-heartbeat rejects a request.json missing a required CONSULT_V2_FIELDS field -- SCHEMA_INVALID, existing lease untouched" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local fresh_now; fresh_now="$(_iso_now)"
  local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s","target_role":"__OMIT__"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
  local before_hb; before_hb="$(_sha256_file "$lease_f")"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  [ "$(_sha256_file "$lease_f")" = "$before_hb" ]
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
# WP3 correction, AUTH-01/02/03: takeover authority is fabricatable
# (PLAN.md ~L702: "otherwise invalid (STOP)"). readTakeoverIfValid previously
# trusted a durable takeover.json on a SHAPE-ONLY check (schema + hex
# new_attempt_id + integer new_lease_epoch) and any OTHER durable-but-wrong-shape
# takeover silently fell through to `null` -- resolveAuthoritativeAttempt then
# silently kept the STILL-INITIAL attempt authoritative, exactly the fabricated-
# authority class AUTH-06/07 already closed for accepted-result. Each case below
# is a REAL transaction (`_write_request`, matching claim/lease vehicle) with a
# hand-fabricated, durable (nlink==1), shape-plausible-but-invalid takeover.json
# -- `claim` is the simplest command reaching resolveAuthoritativeAttempt.
# ══════════════════════════════════════════════════════════════════════════

@test "TAKEOVER-AUTH-1 FAIL: a durable takeover.json missing required fields (wrong-shape) STOPs -- never silently falls back to the initial attempt" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s","reason":"__OMIT__","eligibility_kind":"__OMIT__","eligibility_snapshot":"__OMIT__"}' "$rid" "$new_aid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "TAKEOVER-AUTH-2 FAIL: a durable, fully shape-valid takeover.json bound to a DIFFERENT (foreign) request_id STOPs (confused-deputy)" {
  local rid aid new_aid foreign_rid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"; foreign_rid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$foreign_rid" "$new_aid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "TAKEOVER-AUTH-3 FAIL: a durable, fully shape-valid takeover.json whose superseded_attempt_id does NOT match the request's real initial_attempt_id STOPs" {
  local rid aid new_aid fake_superseded; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"; fake_superseded="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  [ "$fake_superseded" != "$aid" ]
  local to_f; to_f="$(_takeover_path "$rid")"
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s"}' "$rid" "$new_aid" "$fake_superseded")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "TAKEOVER-AUTH-4 FAIL: a durable, fully shape-valid takeover.json whose new_lease_epoch is not EXACTLY the one legitimate successor epoch (initial+1) STOPs" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","initial_lease_epoch":0}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  # Not a "greater than initial" laxity check -- there is exactly ONE legitimate
  # takeover per transaction (computeTakeoverEligibility's own no-clobber existence
  # check enforces this), so ONLY initial_lease_epoch+1 (here: 1) is correct; 99
  # (still nominally "greater than 0") must be rejected too, not merely epoch<=0.
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s","new_lease_epoch":99}' "$rid" "$new_aid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "TAKEOVER-AUTH-5 FAIL: a durable, fully shape-valid takeover.json whose reason does not match its own eligibility_kind pairing STOPs" {
  local rid aid new_aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"; new_aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local to_f; to_f="$(_takeover_path "$rid")"
  # eligibility_kind=confirmed-failed-before-commit must pair with
  # reason=confirmed-failed-before-commit (never lease-expired, the default) --
  # cmdTakeover itself never produces this combination; only a fabrication would.
  _write_takeover "$to_f" "$(printf '{"request_id":"%s","new_attempt_id":"%s","superseded_attempt_id":"%s","eligibility_kind":"confirmed-failed-before-commit"}' "$rid" "$new_aid" "$aid")"
  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
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

@test "DUR-J-result-nlink2-takeover FAIL: a non-durable (nlink==2) ANSWERED result must not drive a takeover eligibility decision -- the fd-bound durable-read gate STOPs with DURABILITY_UNPROVEN instead of counting a non-durable result as a committed answer" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  # Put the result in the reader-rejected nlink==2 window.
  local result_tmp; result_tmp="$(dirname "$result_f")/.result.${aid}.tmp-owner"
  ln "$result_f" "$result_tmp"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-J-lease-nlink2-takeover FAIL: a non-durable (nlink==2) active-lease must not participate in takeover eligibility -- the fd-bound durable-read gate STOPs with DURABILITY_UNPROVEN instead of reading its lease_expiry off a non-durable record" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(_iso_now)"
  local req_created; req_created="$(_iso_plus_seconds "$now" -10)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$now")"
  local fresh_expiry; fresh_expiry="$(_iso_plus_seconds "$now" 300)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$now" "$fresh_expiry")"
  # Put the active-lease in the reader-rejected nlink==2 window.
  local lease_tmp; lease_tmp="$(dirname "$lease_f")/.active-lease.${aid}.tmp-owner"
  ln "$lease_f" "$lease_tmp"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "TO-02 FAIL: takeover is rejected when no eligibility predicate holds (fresh, unexpired claim+lease)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(_iso_now)"
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
  local now; now="$(_iso_now)"
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
  local now; now="$(_iso_now)"
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
  local now; now="$(_iso_now)"
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
  local now; now="$(_iso_now)"
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

@test "DUR-G-replace-dir-fsync-fail-closed FAIL: a lease refresh must report DURABILITY_UNPROVEN when publishReplace's parent-directory barrier cannot be flushed (replace dir-fsync fault injected)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local fresh_now; fresh_now="$(_iso_now)"
  local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
  # An existing active-lease -> the heartbeat takes the publishReplace refresh path
  # (cmdLeaseHeartbeat's `if (existing)` branch). The 'replace' dir-fsync barrier is
  # forced to fail in isolation: the current impl leaves publishReplace's fsyncDir
  # call UNCHECKED (a confessed fail-open) and still reports SUCCESS -- the DUR-G
  # defect. A refresh whose parent-directory entry never flushed has not been proven
  # durable (PLAN.md ~L677); it must surface DURABILITY_UNPROVEN, not SUCCESS.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=replace \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

# ══════════════════════════════════════════════════════════════════════════
# Durable transition lock (DUR-J items 5-9, PLAN.md ~L677/~L690)
# ══════════════════════════════════════════════════════════════════════════

@test "LOCK-01 acquire barrier: a lock-acquire fsync fault after the exclusive mkdir fails closed (DURABILITY_UNPROVEN) AND retains the .lock as a durable orphan (proves mkdir precedes fsync)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local txndir; txndir="$(dirname "$req")"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=lock-acquire \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -d "$txndir/.lock" ]
}

@test "LOCK-02 release barrier: a lock-release fsync fault after the rmdir fails closed (DURABILITY_UNPROVEN) with the .lock already removed (proves rmdir precedes fsync; release is not best-effort)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local txndir; txndir="$(dirname "$req")"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=lock-release \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ ! -e "$txndir/.lock" ]
}

@test "LOCK-03 release rmdir: a lock-release rmdir fault fails closed (DURABILITY_UNPROVEN) and RETAINS the .lock (release is not best-effort)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local txndir; txndir="$(dirname "$req")"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR=1 \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -d "$txndir/.lock" ]
}

@test "LOCK-04 PRE_RENAME: a publishReplace temp-fsync fault (BEFORE rename) fails closed (DURABILITY_UNPROVEN), RELEASES the lock (.lock gone), and leaves the prior lease intact" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local fresh_now; fresh_now="$(_iso_now)"
  local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
  local txndir; txndir="$(dirname "$req")"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC=1 \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ ! -e "$txndir/.lock" ]
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "LOCK-05 POST_RENAME_UNPROVEN: a publishReplace directory-barrier fault (AFTER rename) fails closed (DURABILITY_UNPROVEN) and POISONS the lock -- the .lock is retained as a durable orphan so later actors timeout+STOP" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local fresh_now; fresh_now="$(_iso_now)"
  local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
  local txndir; txndir="$(dirname "$req")"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=replace \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  [ -d "$txndir/.lock" ]
}

@test "LOCK-06 reentrancy: a lease-refresh heartbeat reads the existing lease UNDER the threaded token and publishReplaces under the SAME lock -- completing SUCCESS with no second acquire / no deadlock" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local fresh_now; fresh_now="$(_iso_now)"
  local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "LOCK-07 takeover under same token: the eligibility lease read AND the takeover transition run under the SAME durable lock -- an expired lease is read under the threaded token and the takeover completes SUCCESS (no token error, no deadlock)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(_iso_now)"
  local req_created; req_created="$(_iso_plus_seconds "$now" -100)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","initial_lease_epoch":0,"created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$req_created")"
  local expired; expired="$(_iso_plus_seconds "$now" -10)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$req_created" "$expired")"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

# LOCK-09 (reconcile-barrier1 fsync fault) REMOVED (Codex NO-GO round 2, blocker 1):
# `reconcileOneNoClobberTemp` no longer checks any 'reconcile-barrier1'/
# 'reconcile-barrier2' fsyncDir label at all (there is no more unlink to make durable
# in the first place). The `RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=reconcile-barrier1`
# injection is now inert, and the test's assertions degenerated into an exact
# duplicate of CC-03's (same file) genuine-pair scenario. See CC-03 for the current
# coverage of this scenario.

@test "LOCK-10 POST_RENAME outer-catch: EVERY post-rename throwable (barrier/open/fstat1/read/fstat2/lstat/close) is caught, poisons the lock, and retains .lock -- DURABILITY_UNPROVEN, never a partial success" {
  local step
  for step in barrier open fstat1 read fstat2 lstat close; do
    local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
    local req; req="$(_request_path "$rid")"
    local fresh_now; fresh_now="$(_iso_now)"
    local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
    _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
    local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
    _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
    local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
    local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
    _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
    local txndir; txndir="$(dirname "$req")"
    run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME="$step" \
      node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
    [ "$status" -eq 3 ] || { echo "step=$step status=$status (expected 3)"; false; }
    _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
    [ -d "$txndir/.lock" ] || { echo "step=$step: .lock was NOT retained (poison failed)"; false; }
  done
}

@test "LOCK-11 clean-failure + release-failure: when fn fails cleanly (accepted-result already exists -> AUTHORITY_INVALID) AND the lock release then fails (rmdir fault), the PRIMARY result is the release's DURABILITY_UNPROVEN (original cause preserved internally)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local ar; ar="$(_accepted_result_path "$rid")"
  _write_accepted_result "$ar" "{}"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR=1 \
    node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req" --reason expired --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "READ-MUTATE reader hardening: a chmod / rewrite(same-inode,same-size) / added-hardlink / growth / path-rebind mid-read is caught by the BigInt snapshot comparison -- DURABILITY_UNPROVEN, never PRESENT" {
  local kind
  for kind in chmod rewrite hardlink grow rebind; do
    local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
    local req; req="$(_request_path "$rid")"
    _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
    local req_digest; req_digest="$(_sha256_file "$req")"
    local result_f; result_f="$(_result_path "$rid" "$aid")"
    _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
    run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_FAULT_READ_MUTATE="$kind" \
      node "$IMPL" validate --coordination-root "$COORD_ROOT" --kind result-v2 --artifact "$result_f"
    [ "$status" -eq 3 ] || { echo "kind=$kind status=$status (expected 3)"; false; }
    _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  done
}

@test "READ-MODE reader hardening: an authoritative record that is 0644 or 0444 is rejected SECURITY_INVALID (exact owner-only 0600 required, matching the real writer), never accepted" {
  local m
  for m in 0644 0444; do
    local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
    local req; req="$(_request_path "$rid")"
    _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
    local req_digest; req_digest="$(_sha256_file "$req")"
    local result_f; result_f="$(_result_path "$rid" "$aid")"
    _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
    chmod "$m" "$result_f"
    _run_validate result-v2 "$result_f"
    [ "$status" -eq 3 ] || { echo "mode=$m status=$status (expected 3)"; false; }
    _assert_cli_result "INVALID" "SECURITY_INVALID"
  done
}

# ══════════════════════════════════════════════════════════════════════════
# fsyncDir close fail-closed (correction pass Section 0.1): a directory
# barrier is proven ONLY when open + fsync + the PRIMARY close all succeed.
# Each barrierLabel below is faulted via a DEDICATED close-only seam
# (RUNTIME_CONSULTATION_FAULT_DIR_CLOSE) so fsync itself genuinely succeeds
# and only the real primary close is forced to fail -- never a second,
# already-closed-fd close manufacturing an unrelated EBADF.
# ══════════════════════════════════════════════════════════════════════════

@test "FSYNCDIR-CLOSE-01 barrier1/barrier2/replace/lock-acquire/lock-release: a directory-close fault (fsync succeeds, the PRIMARY close fails) makes fsyncDir report unproven -- never a swallowed-close SUCCESS" {
  local label
  for label in barrier1 barrier2 replace lock-acquire lock-release; do
    local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
    local req; req="$(_request_path "$rid")"
    local fresh_now; fresh_now="$(_iso_now)"
    local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
    _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
    if [ "$label" = "barrier1" ] || [ "$label" = "barrier2" ]; then
      local intent intent_b64 subject_bundle
      intent="$(printf '{"target_role":"arch-testing","question":"FSYNCDIR-CLOSE %s fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$label" "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
      intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
      subject_bundle="$PROJ/.planning/coordination-subject-bundle-dirclose-$label.json"
      printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
      run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
        RUNTIME_CONSULTATION_FAULT_DIR_CLOSE="$label" \
        node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
          --subject-bundle "$subject_bundle" --intent "$intent_b64"
    else
      local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
      _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
      local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
      local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
      _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"
      run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
        RUNTIME_CONSULTATION_FAULT_DIR_CLOSE="$label" \
        node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
    fi
    [ "$status" -eq 3 ] || { echo "label=$label status=$status (expected 3)"; false; }
    _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  done
}

# FSYNCDIR-CLOSE-02 (reconcile-barrier1 directory-CLOSE fault) REMOVED alongside
# LOCK-09 (same file) -- same reason: `reconcileOneNoClobberTemp` no longer checks
# any 'reconcile-barrier1' fsyncDir label (Codex NO-GO round 2, blocker 1). See CC-03
# for the current coverage of the genuine-pair scenario; FSYNCDIR-CLOSE-01 (same
# file) still covers the writer-side barrier1/barrier2/replace/lock-acquire/
# lock-release close-fault seams, all of which are UNCHANGED and still real.

# ══════════════════════════════════════════════════════════════════════════
# publishNoClobber EEXIST loser cleanup (correction pass Section 0.2): the
# PLAN binding is "losers clean temp + flush" -- a checked unlink of the
# loser's OWN temp, then a checked directory barrier, BEFORE any idempotent-
# success or race-loss classification. Either failing must fail closed
# DURABILITY_UNPROVEN, never an idempotent SUCCESS.
# ══════════════════════════════════════════════════════════════════════════

@test "LOSER-CLEANUP-01 unlink failure: a no-clobber EEXIST loser whose OWN temp-cleanup unlink fails reports DURABILITY_UNPROVEN -- never idempotent SUCCESS, even though the pre-existing target is byte-identical" {
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"LOSER-CLEANUP unlink-fault fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-loser-unlink.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  mkdir -p "$(_plan_root)"
  cp "$PLAN_FILE" "$(_plan_root)/plan_ref"
  chmod 0600 "$(_plan_root)/plan_ref"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK=1 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "LOSER-CLEANUP-02 directory-fsync failure: a no-clobber EEXIST loser whose OWN temp-cleanup directory barrier fails reports DURABILITY_UNPROVEN -- never idempotent SUCCESS, even though the pre-existing target is byte-identical" {
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"LOSER-CLEANUP barrier-fault fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-loser-barrier.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  mkdir -p "$(_plan_root)"
  cp "$PLAN_FILE" "$(_plan_root)/plan_ref"
  chmod 0600 "$(_plan_root)/plan_ref"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=loser-cleanup \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "LOSER-CLEANUP-03 successful cleanup: a no-clobber EEXIST loser against a byte-identical target succeeds idempotently AND its own owned temp is durably removed (no leftover .tmp-owner sibling)" {
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"LOSER-CLEANUP success fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-loser-ok.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  mkdir -p "$(_plan_root)"
  cp "$PLAN_FILE" "$(_plan_root)/plan_ref"
  chmod 0600 "$(_plan_root)/plan_ref"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local leftover; leftover="$(ls "$(_plan_root)"/.plan_ref.*.tmp-owner 2>/dev/null | head -1)"
  [ -z "$leftover" ]
}

# ══════════════════════════════════════════════════════════════════════════
# publishNoClobber post-barrier2 revalidation (Codex P1-1): the writer's own
# SUCCESS claim must be fd-bound PROVEN -- identity (bound to the original
# temp), bytes, metadata, and nlink==1 -- not merely inferred from the
# barriers having reported clean. Three independent deterministic attacks,
# each of which the pre-fix implementation reports as CLI SUCCESS.
# ══════════════════════════════════════════════════════════════════════════

@test "NOCLOBBER-REVALIDATE-01 (Codex P1-1) temp-swap-before-link: an attacker swapping the temp's content between our fsync and our linkSync must NOT report CLI SUCCESS -- the post-link identity binding rejects the foreign inode" {
  # Targets `publish-request`, NOT `claim`: cmdClaim happens to re-read its own
  # just-published claim under the lock before publishing the lease, which would
  # incidentally catch a garbage-byte swap too (a JSON-parse failure) and mask whether
  # THIS fix (identity binding inside publishNoClobber itself) is what is really doing
  # the rejecting. cmdPublishRequest's FIRST publishNoClobber call materializes
  # `plan_ref` and returns with no secondary read of it -- proving the writer's OWN
  # revalidation, and nothing else, is what prevents a false SUCCESS here (matches
  # Codex's own repro: "CLI SUCCESS, target contiene attacker").
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"NOCLOBBER-REVALIDATE-01 swap fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-noclobber-swap.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PRELINK=swap \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  # The attack must have genuinely happened (test not vacuous): plan_ref now holds the
  # attacker's swapped bytes, yet the CLI still correctly refused to call it SUCCESS.
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ -f "$plan_ref" ]
  grep -q "RUNTIME_CONSULTATION_TEST_ATTACKER_SWAP_CONTENT" "$plan_ref"
}

@test "NOCLOBBER-REVALIDATE-01b (Codex NO-GO round 2, missing-evidence item 3) same-bytes/different-inode swap isolates identity binding: an attacker's replacement carries the EXACT SAME bytes we wrote (never differs in content) but is a DIFFERENT inode -- must still NOT report CLI SUCCESS, proving the post-link check is dev/ino identity, not merely a byte comparison" {
  # A byte-only comparator would see IDENTICAL content here and have no basis to
  # reject -- so any rejection in this specific scenario is attributable SOLELY to
  # the dev/ino identity check (expectedIdentity), isolated from byte comparison
  # entirely. See NOCLOBBER-REVALIDATE-01 for why `publish-request`/`plan_ref` (not
  # `claim`) is the target.
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"NOCLOBBER-REVALIDATE-01b swap-same-bytes fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-noclobber-swap-same-bytes.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PRELINK=swap-same-bytes \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "NOCLOBBER-REVALIDATE-02 (Codex P1-1) target-delete-after-link: a target deleted after barrier 2 but before the final revalidation must NOT report CLI SUCCESS over an absent target" {
  # See NOCLOBBER-REVALIDATE-01 for why `publish-request`/`plan_ref` (not `claim`) is
  # the target.
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"NOCLOBBER-REVALIDATE-02 delete fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-noclobber-delete.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PREVALIDATE=delete \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ ! -e "$plan_ref" ]
}

@test "NOCLOBBER-REVALIDATE-03 (Codex P1-1) added-hardlink-after-link: a second hardlink added after barrier 2 but before the final revalidation must NOT report CLI SUCCESS over a target that is no longer nlink==1" {
  # See NOCLOBBER-REVALIDATE-01 for why `publish-request`/`plan_ref` (not `claim`) is
  # the target.
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"NOCLOBBER-REVALIDATE-03 hardlink fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-noclobber-hardlink.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PREVALIDATE=hardlink \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ -e "$plan_ref" ]
  local nlink; nlink="$(node -e 'process.stdout.write(String(require("fs").lstatSync(process.argv[1]).nlink))' "$plan_ref")"
  [ "$nlink" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Writer temp mode: exact 0600 independent of umask (correction pass Section
# 0.3). `open(..., 0o600)`'s requested mode is subject to the PROCESS umask;
# `fchmodSync` is not. Both publishNoClobber's and publishReplace's temps must
# be forced to EXACT owner-only 0600 via fchmod (+ fstat-proven) regardless of
# an unusually restrictive umask, and fail closed if that cannot be proven.
# ══════════════════════════════════════════════════════════════════════════

@test "UMASK-0600-01 publishNoClobber exact 0600 independent of umask: under a restrictive process umask that would otherwise strip owner bits, both the claim and the initial-lease temps are fchmod-hardened to EXACT 0600 -- claim succeeds and a subsequent reader/validate accepts both durable outputs" {
  # bats isolates each @test in its own forked process (verified separately) so a
  # umask left changed at test-end can never leak to another test; the explicit
  # save/restore below is still done around exactly the fault-affected span. Plain
  # `run` (no --separate-stderr) is used here deliberately: bats' own
  # --separate-stderr machinery creates ITS OWN scratch file for the redirect, and
  # doing so under an active restrictive umask denies bats itself write access to
  # it (a `trap ... RETURN` restore was also tried and rejected -- it conflicts
  # with bats' internal RETURN-trap use in `run`). The CLI never writes to stderr
  # on its SUCCESS path, so plain `run`'s combined-output $output is already clean
  # JSON here.
  #
  # `claim` is used rather than `publish-request` or `lease-heartbeat`: Section 4
  # moved the initial active-lease publish INSIDE claim's own lock (heartbeat no
  # longer creates a missing initial lease at all), so `claim` alone now exercises
  # BOTH publishNoClobber call sites (the claim election, then the initial lease,
  # under the lock) in one call. A umask restrictive enough to strip 0600's owner-
  # write bit ALSO strips owner-write from any brand-new DIRECTORY `mkdirSync`
  # creates (0777-requested, subject to the identical umask bit position) --
  # `publish-request` mints several never-seen-before directories (the plan-root
  # tree, a fresh `transactions/<request_id>/`), which would confound this test
  # with an unrelated directory-creation failure. Pre-creating `claims/` and
  # `active-leases/` under the NORMAL umask (before the restrictive window opens)
  # isolates exactly the TEMP FILE mode this section is scoped to -- no new
  # directory is created while the restrictive umask is active.
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  mkdir -p "$(dirname "$claim_f")" "$(dirname "$lease_f")"

  local old_umask; old_umask="$(umask)"
  umask 0277
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids
  umask "$old_umask"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  [ -f "$claim_f" ]
  local claim_mode; claim_mode="$(node -e 'process.stdout.write((require("fs").lstatSync(process.argv[1]).mode & 0o777).toString(8))' "$claim_f")"
  [ "$claim_mode" = "600" ]
  [ -f "$lease_f" ]
  local lease_mode; lease_mode="$(node -e 'process.stdout.write((require("fs").lstatSync(process.argv[1]).mode & 0o777).toString(8))' "$lease_f")"
  [ "$lease_mode" = "600" ]
  _run_validate claim-v1 "$claim_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "UMASK-0600-02 publishNoClobber fchmod/fstat failure fail-closed: a temp-hardening fault reports DURABILITY_UNPROVEN before any write/fsync/link -- the target is never created" {
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"UMASK-0600 fchmod-fault fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-umask-fault.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fchmod \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ ! -e "$plan_ref" ]
}

@test "UMASK-0600-02b (Codex NO-GO round 2, missing-evidence item 1) publishNoClobber PROVING fstat failure fail-closed: fchmod itself succeeds for real (mode genuinely forced to 0600) but the SEPARATE proving fstat afterward fails -- DURABILITY_UNPROVEN, target never created" {
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"UMASK-0600 fstat-fault fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-umask-fstat-fault.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fstat \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ ! -e "$plan_ref" ]
}

@test "UMASK-0600-03 publishReplace temp hardening: exact 0600 independent of umask for the active-lease refresh temp, and a fchmod/fstat fault fails closed PRE_RENAME (prior lease intact)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local fresh_now; fresh_now="$(_iso_now)"
  local fresh_req_expiry; fresh_req_expiry="$(_iso_plus_seconds "$fresh_now" 3600)"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$fresh_now" "$fresh_req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$(_iso_now)" "$(_iso_plus_seconds "$(_iso_now)" 300)")"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fchmod \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  # Plain `run` (no --separate-stderr) while the restrictive umask is active -- see
  # UMASK-0600-01's comment for why (bats' own --separate-stderr scratch file
  # creation is itself subject to the active umask).
  local old_umask; old_umask="$(umask)"
  umask 0277
  run env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-ids
  umask "$old_umask"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local mode; mode="$(node -e 'process.stdout.write((require("fs").lstatSync(process.argv[1]).mode & 0o777).toString(8))' "$lease_f")"
  [ "$mode" = "600" ]
}

# ══════════════════════════════════════════════════════════════════════════
# Section 4: transactional boundaries -- six deterministic interleavings via
# capability-gated rendezvous (RUNTIME_CONSULTATION_TEST_RENDEZVOUS), never
# timing sleeps. Each pauses ONE process at an exact point, lets a SECOND
# process complete a full operation, then resumes and re-checks the first.
# ══════════════════════════════════════════════════════════════════════════

@test "XACT-01 claim/takeover interleaving: claim publishes claim -> pauses before its lock -> an eligible takeover commits -> claim resumes -> no initial lease for the now-superseded attempt" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local txndir; txndir="$(dirname "$req")"

  local claim_out claim_rc_file; claim_out="$(mktemp)"; claim_rc_file="$(mktemp)"
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=claim-pre-lock \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req" --role arch-testing --fixed-ids >"$claim_out" 2>&1; echo $? >"$claim_rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txndir" claim-pre-lock

  # claim.json is now durably published (the ELECTION, outside the lock) -- compute its
  # accredited digest and make an eligible takeover for this EXACT attempt (confirmed-
  # failed-before-commit is immediately eligible, no deadline wait needed -- TO-03b's
  # pattern).
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  [ -f "$claim_f" ]
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local delivery_f; delivery_f="$(_delivery_path "$rid" "$aid")"
  _write_delivery "$delivery_f" "$(printf '{"request_id":"%s","attempt_id":"%s","claim_digest":"%s","delivered":false,"outcome":"confirmed-failed-before-commit","detail_code":"CONFIRMED_PRECOMMIT_FAILURE"}' "$rid" "$aid" "$claim_digest")"
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  touch "$txndir/.rendezvous-claim-pre-lock-go"
  wait "$claim_pid"
  local claim_rc; claim_rc="$(cat "$claim_rc_file")"
  [ "$claim_rc" -eq 3 ] || { cat "$claim_out"; false; }
  local claim_json; claim_json="$(cat "$claim_out")"
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") { console.error("unexpected claim result: " + process.argv[1]); process.exit(1); }
  ' "$claim_json"

  # The initial (now-superseded) attempt must have NO active-lease -- claim never
  # published one for a takeover-superseded attempt.
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  [ ! -e "$lease_f" ]
}

@test "XACT-02 heartbeat refresh blocks a later takeover: heartbeat holds the lock and refreshes BEFORE expiry -- a later takeover observes the extended lease and is rejected (not yet expired)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local now; now="$(_iso_now)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$now" 3600)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$now" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  # A lease expiring in a few seconds -- still LIVE right now.
  local near_expiry; near_expiry="$(_iso_plus_seconds "$now" 5)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","ttl_seconds":300,"last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$now" "$near_expiry")"

  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  # The refresh must have EXTENDED lease_expiry well past the original near-expiry.
  local new_expiry; new_expiry="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lease_expiry)' "$lease_f")"
  [ "$new_expiry" != "$near_expiry" ]

  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "XACT-03 heartbeat/takeover interleaving: heartbeat pauses before its lock -> takeover commits at expiry -> heartbeat resumes, acquires the lock LATER, and rejects the now-superseded authority -- prior lease bytes are untouched" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local now; now="$(_iso_now)"
  local req_created; req_created="$(_iso_plus_seconds "$now" -1)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$req_created")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  # An ALREADY-expired lease (expired 1 second ago) -- the takeover below is eligible
  # (active-lease-expired) the moment it runs.
  local expired; expired="$(_iso_plus_seconds "$now" -1)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","ttl_seconds":300,"last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$req_created" "$expired")"
  local lease_bytes_before; lease_bytes_before="$(_sha256_file "$lease_f")"
  local txndir; txndir="$(dirname "$req")"

  local hb_out hb_rc_file; hb_out="$(mktemp)"; hb_rc_file="$(mktemp)"
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=heartbeat-pre-lock \
      node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" >"$hb_out" 2>&1; echo $? >"$hb_rc_file" ) &
  local hb_pid=$!

  _wait_for_rendezvous_ready "$txndir" heartbeat-pre-lock

  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  touch "$txndir/.rendezvous-heartbeat-pre-lock-go"
  wait "$hb_pid"
  local hb_rc; hb_rc="$(cat "$hb_rc_file")"
  [ "$hb_rc" -eq 3 ] || { cat "$hb_out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") { console.error("unexpected heartbeat result: " + process.argv[1]); process.exit(1); }
  ' "$(cat "$hb_out")"

  # Prior lease bytes must be UNTOUCHED by the rejected heartbeat.
  local lease_bytes_after; lease_bytes_after="$(_sha256_file "$lease_f")"
  [ "$lease_bytes_before" = "$lease_bytes_after" ]
}

@test "XACT-04 now==lease_expiry boundary: a heartbeat observing now EXACTLY equal to lease_expiry is rejected as expired (strict less-than, never <=)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local base="2025-01-01T00:00:00Z"
  local far_expiry; far_expiry="$(_iso_plus_seconds "$base" 3600)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$base" "$far_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$base")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  # lease_expiry EXACTLY equals the --fixed-clock base (no advance) "now" heartbeat
  # below will observe.
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","ttl_seconds":300,"last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$base" "$base")"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --fixed-clock
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "XACT-05 publish-result/takeover interleaving: publish-result prepares for the OLD attempt -> pauses before its lock -> takeover commits -> publisher resumes and is rejected -- no result created for the superseded attempt" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local now; now="$(_iso_now)"
  local req_created; req_created="$(_iso_plus_seconds "$now" -1)"
  # expiry must be within CONSULT_V2_FIELDS' [120,3600]s window of created_at -- exactly
  # 3600s here (this test's cmdPublishResult path now runs the full closed-shape check
  # on the request, unlike cmdClaim/cmdLeaseHeartbeat's lighter-weight request read).
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$req_created")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  # An ALREADY-expired lease -- the takeover below is eligible (active-lease-expired)
  # the moment it runs.
  local expired; expired="$(_iso_plus_seconds "$now" -1)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$req_created" "$expired")"
  local txndir; txndir="$(dirname "$req")"
  local content_b64; content_b64="$(printf 'hello world' | _base64url_encode)"
  local result_f; result_f="$(_result_path "$rid" "$aid")"

  local pr_out pr_rc_file; pr_out="$(mktemp)"; pr_rc_file="$(mktemp)"
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=publish-result-pre-lock \
      node "$IMPL" publish-result --coordination-root "$COORD_ROOT" --request "$req" --claim "$claim_f" --content "$content_b64" >"$pr_out" 2>&1; echo $? >"$pr_rc_file" ) &
  local pr_pid=$!

  _wait_for_rendezvous_ready "$txndir" publish-result-pre-lock

  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  touch "$txndir/.rendezvous-publish-result-pre-lock-go"
  wait "$pr_pid"
  local pr_rc; pr_rc="$(cat "$pr_rc_file")"
  [ "$pr_rc" -eq 3 ] || { cat "$pr_out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") { console.error("unexpected publish-result result: " + process.argv[1]); process.exit(1); }
  ' "$(cat "$pr_out")"

  [ ! -e "$result_f" ]
}

@test "XACT-06 active-lease-v1 validate under an orphaned lock: a held .lock (writer crashed/hung mid-replace) makes the validator timeout+STOP -- it never trusts the visible nlink==1 bytes alone" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s"}' "$rid" "$aid")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s"}' "$aid" "$claim_digest")"
  local txndir; txndir="$(dirname "$req")"
  # Simulate an orphaned lock: a writer crashed/hung mid-replace, leaving .lock held
  # even though the lease bytes are already visible at nlink==1.
  mkdir "$txndir/.lock"
  _run_validate active-lease-v1 "$lease_f"
  [ "$status" -eq 5 ]
  _assert_cli_result "TIMEOUT" "DEADLINE_EXCEEDED"
}

# ══════════════════════════════════════════════════════════════════════════
# Section 8: await/enumeration correctness.
# ══════════════════════════════════════════════════════════════════════════

@test "XACT-07-await-pending-becomes-present PASS: a result observed PENDING (nlink==2) that transitions to nlink==1 before the deadline yields SUCCESS" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  # Background: after a brief delay, complete the crash-cut (unlink the temp) so the
  # target transitions from PENDING (nlink==2) to durable (nlink==1) WHILE await polls.
  ( sleep 0.3; rm -f "$temp_f" ) &
  local bg_pid=$!
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 3
  wait "$bg_pid"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "XACT-08-await-persistent-pending FAIL: a result that stays PENDING (nlink==2) through the whole deadline reports DURABILITY_UNPROVEN, never a generic TIMEOUT" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  # The temp is NEVER removed -- the target stays PENDING for the whole deadline.
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "XACT-09-await-superseded-not-eclipse PASS: after a takeover, an OLD (lexicographically-first) attempt's own leftover result never eclipses the NEW attempt's valid current result -- await observes the canonical current-attempt path directly, never a sorted entries[0] scan" {
  # aid is the lexicographically-SMALLEST possible valid hex id (64 zeros) -- a
  # random new_attempt_id from a real takeover is virtually certain to sort AFTER
  # it, so an entries[0]-style scan would have picked the OLD result here first.
  local rid; rid="$(_gen_hex_id)"
  local aid="0000000000000000000000000000000000000000000000000000000000000000"
  local now; now="$(_iso_now)"
  local req_created; req_created="$(_iso_plus_seconds "$now" -1)"
  local req_expiry; req_expiry="$(_iso_plus_seconds "$req_created" 3600)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$rid" "$rid" "$aid" "$req_created" "$req_expiry")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local claim_f; claim_f="$(_claim_path "$rid" "$aid")"
  _write_claim "$claim_f" "$(printf '{"request_id":"%s","attempt_id":"%s","created_at":"%s"}' "$rid" "$aid" "$req_created")"
  local claim_digest; claim_digest="$(_sha256_file "$claim_f")"
  local expired; expired="$(_iso_plus_seconds "$now" -1)"
  local lease_f; lease_f="$(_active_lease_path "$rid" "$aid")"
  _write_active_lease "$lease_f" "$(printf '{"attempt_id":"%s","claim_digest":"%s","last_heartbeat_at":"%s","lease_expiry":"%s"}' "$aid" "$claim_digest" "$req_created" "$expired")"

  # Takeover FIRST -- a valid ANSWERED result for the initial attempt would (correctly)
  # block takeover eligibility, so the old attempt's leftover result must be written
  # AFTER the takeover commits (a late/stray writer, unaware it has been superseded).
  _run_cli takeover --coordination-root "$COORD_ROOT" --request "$req"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local to_f; to_f="$(_takeover_path "$rid")"
  local new_aid; new_aid="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).new_attempt_id)' "$to_f")"
  [ "$new_aid" != "$aid" ]
  # Confirm the intended ordering actually holds (guards the test itself against a
  # freak all-zeros random id, which would make this assertion meaningless).
  local sorted_first; sorted_first="$(printf '%s\n%s\n' "$aid.json" "$new_aid.json" | sort | head -1)"
  [ "$sorted_first" = "$aid.json" ]

  local old_result_f; old_result_f="$(_result_path "$rid" "$aid")"
  _write_result "$old_result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"

  local new_result_f; new_result_f="$(_result_path "$rid" "$new_aid")"
  _write_result "$new_result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","lease_epoch":1,"status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$new_aid")"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 3
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local artifact_ref; artifact_ref="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ "$artifact_ref" = "$new_result_f" ]
}

@test "XACT-10-accept-result-enumeration-EACCES FAIL: accept-result reports DURABILITY_UNPROVEN (never the ENOENT-only 'no candidate' CORRELATION_INVALID) when the results/ directory cannot be enumerated (EACCES)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local results_dir; results_dir="$(dirname "$(_result_path "$rid" "$aid")")"
  mkdir -p "$results_dir"
  chmod 000 "$results_dir"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  local rc="$status"
  chmod 700 "$results_dir"
  [ "$rc" -eq 3 ]
  # An EACCES enumeration failure must be its OWN distinct DURABILITY_UNPROVEN STOP --
  # never silently folded into the "genuinely no candidate yet" CORRELATION_INVALID an
  # ENOENT (truly-missing directory) legitimately produces.
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
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

@test "F3-noconcurrent-accept-01: two truly concurrent accept-result invocations for the same current candidate -- exactly one succeeds, the loser observes AUTHORITY_INVALID (not TRANSACTION_CANCELLED)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  local out1 out2; out1="$(mktemp)"; out2="$(mktemp)"
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids >"$out1" 2>&1; echo $? >> "$out1" ) &
  local pid1=$!
  ( set +e; NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids >"$out2" 2>&1; echo $? >> "$out2" ) &
  local pid2=$!
  wait "$pid1" || true
  wait "$pid2" || true
  local rc1 rc2; rc1="$(tail -n1 "$out1")"; rc2="$(tail -n1 "$out2")"
  local body1 body2; body1="$(head -n1 "$out1")"; body2="$(head -n1 "$out2")"
  rm -f "$out1" "$out2"
  # Same exact-sum/differ idiom as DX-noconcurrent-01 above (exactly one winner
  # rc0, one loser rc3), now applied to the withLock-serialized accept-result path
  # instead of claim's own publishNoClobber-EEXIST race: the loser's own
  # `fs.existsSync(acceptedResultPathFor(txnDir))` check (inside withLock, run
  # strictly after the winner released the lock) deterministically observes the
  # winner's already-published accepted-result.json and rejects AUTHORITY_INVALID
  # -- never TRANSACTION_CANCELLED (no cancel.json exists in this fixture at all).
  [ "$((rc1 + rc2))" -eq 3 ]
  [ "$rc1" -ne "$rc2" ]
  local loser_body
  if [ "$rc1" -eq 3 ]; then loser_body="$body1"; else loser_body="$body2"; fi
  node -e '
    let data;
    try { data = JSON.parse(process.argv[1]); } catch (err) { console.error("loser stdout is not valid JSON: " + err.message); process.exit(1); }
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected loser INVALID/AUTHORITY_INVALID, got " + data.status + "/" + data.detail_code);
      process.exit(1);
    }
  ' "$loser_body"
}

@test "RESULT-TO-01: a valid current candidate result that wins first blocks a subsequent takeover" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  local now; now="$(_iso_now)"
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
  local now; now="$(_iso_now)"
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
  [ "$status" -eq 6 ]
  _assert_cli_result "CANCELLED" "TRANSACTION_CANCELLED"
}

@test "CANCEL-VS-AWAIT-01 FAIL: await-result observes CANCELLED once cancel.json has already committed (the await-result half of the cancel/terminal contract -- mirrors CANCEL-VS-ACCEPT-01's accept-result half; this is the regression case that would have caught fix D, await-result's cancelled-txn detail_code)" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req" --reason explicit --fixed-ids
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req" --timeout 1
  [ "$status" -eq 6 ]
  _assert_cli_result "CANCELLED" "TRANSACTION_CANCELLED"
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

@test "SCHEMA-RESULT-REQUEST-01 (Codex NO-GO round 2 blocker 3, missing-evidence item 5) FAIL: a well-correlated result/v2 candidate is rejected when its OWN request.json is schema-invalid -- validateResultV2 now enforces CONSULT_V2_FIELDS on the request, not merely a digest match, zero mutation" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  # Missing a required CONSULT_V2_FIELDS field (expected_result_kind) -- otherwise a
  # completely ordinary request the result's own fields correctly mirror/correlate
  # against (its digest is still computable over the malformed bytes).
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","expected_result_kind":"__OMIT__"}' "$rid" "$rid" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","root_request_id":"%s","attempt_id":"%s","status":"ANSWERED"}' "$rid" "$req_digest" "$rid" "$aid")"
  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  # Zero mutation: no accepted-result.json was ever created.
  local ar; ar="$(dirname "$req")/accepted-result.json"
  [ ! -e "$ar" ]
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

# ══════════════════════════════════════════════════════════════════════════
# WP1 durability correction, pass 2 (RED): no-clobber directory-fsync fail-open
# + nlink==2 accepted-as-idempotent-SUCCESS (PLAN.md ~L679-683 violation).
# `publishNoClobber`'s two directory-fsync barriers (fsyncDir, runtime-
# consultation.cjs ~L527-547) are genuinely reachable-fault-injectable via
# RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=1 (test-capability-gated, PLAN.md
# ~L752-753 -- same seam class as RUNTIME_CONSULTATION_FAKE_CLOCK/
# RUNTIME_CONSULTATION_FORCE_PLATFORM). Both cases below are RED against the
# CURRENT impl by construction, not by fixture mistake: fsyncDir's own catch{}
# still swallows the injected failure (fail-open), and publishNoClobber's
# allowIdenticalIdempotent byte-compare branch never re-checks the target's
# nlink before accepting a re-publish as SUCCESS. The impl fix (fail-closed) is
# a later, separate pass -- not made here.
# ══════════════════════════════════════════════════════════════════════════

# base64url-encodes stdin (verbatim convention from runtime-consultation-
# protocol.bats's own `_base64url_encode` -- the CLI ABI's `--intent`/`--content`
# flags are base64url).
_base64url_encode() {
  node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))'
}

# Frozen-base-relative ISO timestamp (verbatim convention from
# runtime-consultation-protocol.bats's own `_frozen_iso_plus_ms`): the CLI's
# `--fixed-clock` default base (2025-01-01T00:00:00.000Z) plus N milliseconds,
# computed via node so it stays exactly consistent with `nowIso()`'s own frozen
# base under `--fixed-clock` (never real wall-clock `date`).
_frozen_iso_plus_ms() {
  node -e 'process.stdout.write(new Date(Date.parse("2025-01-01T00:00:00.000Z") + Number(process.argv[1])).toISOString())' "$1"
}

@test "DUR-01-fsync-fail-open FAIL: publish-request must not report SUCCESS when the no-clobber publish's directory-fsync durability barriers cannot be flushed (dir-fsync fault injected)" {
  local now expiry intent intent_b64
  now="$(_iso_now)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-01 fsync-fault fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  local subject_bundle; subject_bundle="$PROJ/.planning/coordination-subject-bundle-dur01.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"

  # Both publishNoClobber directory barriers (barrier 1 after link, barrier 2 after
  # unlink -- runtime-consultation.cjs ~L582/~L586) are forced to fail via the WP1
  # fault-injection seam. The current impl's fsyncDir() swallows this into its
  # existing fail-open catch{} and still returns SUCCESS -- the defect this RED
  # case proves (PLAN.md ~L679 violation): a publish whose durability barriers
  # never flushed must not claim success.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=1 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-05-nlink2-idempotent-accept FAIL: a byte-identical re-publish is not accepted as an idempotent SUCCESS while the durable target's nlink is still 2 (not yet proven durable)" {
  local expiry intent intent_b64
  # --fixed-clock freezes created_at to the CLI's own frozen base; --fixed-ids
  # resets the per-process genId() counter to 0 -- together, two SEPARATE
  # fresh-process invocations of this exact publish-request (same plan/
  # subject-bundle/intent) mint byte-identical requestObj content, landing
  # publishNoClobber's own allowIdenticalIdempotent EEXIST/byte-compare branch
  # on the second call (runtime-consultation.cjs ~L573-579).
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-05 nlink2-idempotent fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  local subject_bundle; subject_bundle="$PROJ/.planning/coordination-subject-bundle-dur05.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"

  _run_cli publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local req_path; req_path="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ -f "$req_path" ]

  # Simulate the in-flight crash-cut window between linkSync(temp,target) and
  # unlink(temp) (same idiom as NC-READ-01/CC-02 above): an owner-tagged same-dir
  # temp still hard-linked to the durable target, so the target's own nlink is 2
  # -- not yet proven durable per publishNoClobber's own barrier-1/barrier-2
  # contract.
  local temp_f; temp_f="$(dirname "$req_path")/.dur-05-crash-cut.tmp-owner"
  ln "$req_path" "$temp_f"

  # Re-publish the IDENTICAL intent/plan/subject-bundle under the SAME
  # --fixed-ids --fixed-clock pair: a fresh process resets genId()'s counter to 0
  # and refreezes created_at to the same base, so this second invocation mints
  # byte-identical requestObj content and lands publishNoClobber's EEXIST/
  # allowIdenticalIdempotent byte-compare branch against the still-nlink==2
  # target above -- the current impl accepts this as SUCCESS without ever
  # re-checking nlink, which is the defect this RED case proves.
  _run_cli publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

# ══════════════════════════════════════════════════════════════════════════
# WP1 correction pass, AUTH-06/07 (RED): accepted-result is fabricatable
# authority (PLAN.md ~L710: "only a validated correlated artifact completes").
# `validateAcceptedResultV1` (runtime-consultation.cjs ~L1407-1425) checks only
# the closed field SHAPE (`ACCEPTED_RESULT_V1_FIELDS`) + `assertDurable`
# (nlink==1) -- it never re-verifies `request_digest` against the real
# request.json bytes, `result_digest`/`candidate_result_path` against a real
# result, `accepted_attempt_id`/`accepted_lease_epoch` against
# `resolveAuthoritativeAttempt`, or `routing_policy_digest`/
# `requester_instance_id` against anything. Worse, `cmdAwaitResult`'s poll loop
# (~L2446-2448) never even CALLS that already-weak validator: its very first
# check is a bare `fs.existsSync(acceptedResultPathFor(txnDir))` that returns
# SUCCESS the instant that path exists, regardless of content. A hand-written,
# shape-valid, durable-but-UNCORRELATED accepted-result.json therefore makes
# `await-result` wrongly report a real, still-open transaction complete.
#
# Genuinely RED by construction: the fabricated artifact below is published
# under a REAL transaction (via the actual `publish-request` CLI, never a
# `_write_request` hand fixture), was never claimed/resulted/legitimately
# accepted, carries closed-shape-valid `ACCEPTED_RESULT_V1_FIELDS` types
# throughout, is written via a plain `fs.writeFileSync` (nlink==1, so
# `assertDurable` -- and thus even a hypothetical "just call the validator"
# fix -- would not by itself catch it either), and every one of its
# request_digest/result_digest/candidate_result_path/accepted_attempt_id
# values is deliberately uncorrelated with anything real in the transaction.
# ══════════════════════════════════════════════════════════════════════════

@test "AUTH-06/07 FAIL: await-result wrongly completes a real transaction on a shape-valid but fully uncorrelated fabricated accepted-result.json (accepted-result authority is fabricatable)" {
  local expiry intent intent_b64
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"AUTH-06/07 fabricated-accepted-result fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  local subject_bundle; subject_bundle="$PROJ/.planning/coordination-subject-bundle-auth06.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"

  # A REAL transaction, published through the actual public `publish-request`
  # API (never a `_write_request` hand fixture) -- proves the attack succeeds
  # even when everything else about the transaction is entirely legitimate.
  _run_cli publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local req_path; req_path="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ -f "$req_path" ]
  local txn_dir; txn_dir="$(dirname "$req_path")"
  local real_req_digest; real_req_digest="$(_sha256_file "$req_path")"
  local real_attempt_id
  real_attempt_id="$(node -e '
    const fs = require("fs");
    console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).initial_attempt_id);
  ' "$req_path")"

  # Never claimed, never resulted, never legitimately accepted -- nothing
  # exists anywhere under txn_dir yet except request.json itself.

  # Fabricated, shape-valid, durable-but-UNCORRELATED accepted-result.json,
  # hand-written directly at the real path the impl itself derives
  # (acceptedResultPathFor(txnDir) == txnDir/accepted-result.json,
  # runtime-consultation.cjs ~L442-444) via `_write_accepted_result`'s plain
  # `fs.writeFileSync` -- nlink==1, exactly like every other fixture in this
  # file, so durability alone can never be the reason this gets rejected.
  local fake_req_digest fake_result_digest fake_attempt_id
  fake_req_digest="$(printf '9%.0s' {1..64})"
  fake_result_digest="$(printf '8%.0s' {1..64})"
  fake_attempt_id="$(printf '7%.0s' {1..64})"
  # Guards the fixture itself (not just the assertion below): these fabricated
  # 64-hex constants must actually diverge from the real request_digest/
  # initial_attempt_id above, or this test would not be exercising the claimed
  # defect at all (same rigor as RESULT-SUBJECT-MISMATCH-01's `wrong_subject_head`).
  [ "$fake_req_digest" != "$real_req_digest" ]
  [ "$fake_attempt_id" != "$real_attempt_id" ]

  local accepted_f; accepted_f="$txn_dir/accepted-result.json"
  _write_accepted_result "$accepted_f" "$(printf '{"request_digest":"%s","candidate_result_path":"results/%s.json","result_digest":"%s","accepted_attempt_id":"%s","accepted_lease_epoch":99}' "$fake_req_digest" "$fake_attempt_id" "$fake_result_digest" "$fake_attempt_id")"
  [ -f "$accepted_f" ]
  local accepted_nlink
  accepted_nlink="$(node -e '
    const fs = require("fs");
    console.log(fs.lstatSync(process.argv[1]).nlink);
  ' "$accepted_f")"
  [ "$accepted_nlink" -eq 1 ]
  # candidate_result_path references a results/ entry that was never written --
  # nothing was ever created under txn_dir/results/ in this test at all.
  [ ! -f "$txn_dir/results/${fake_attempt_id}.json" ]

  # The correct/secure contract (PLAN.md ~L710): only a validated CORRELATED
  # artifact completes the transaction -- a fabricated, uncorrelated
  # accepted-result.json must be rejected (INVALID; the specific
  # correlation-vs-authority detail_code is left unpinned per this file's own
  # convention for a not-yet-built correction where more than one closed value
  # is plausible), never SUCCESS. Genuinely RED right now: the current impl's
  # cmdAwaitResult returns SUCCESS/rc0 unconditionally on the mere existence of
  # this fabricated file, without ever running a validation/correlation pass.
  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req_path" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

@test "AUTH-06/07-ACK FAIL: transaction-ack --disposition accepted wrongly mints a legitimate-looking ack.json against a fully uncorrelated fabricated accepted-result.json (surface 2 of the same fabricatable-authority defect -- await-result was surface 1)" {
  local expiry intent intent_b64
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"AUTH-06/07-ACK fabricated-accepted-result fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  local subject_bundle; subject_bundle="$PROJ/.planning/coordination-subject-bundle-auth06ack.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"

  _run_cli publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local req_path; req_path="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  local txn_dir; txn_dir="$(dirname "$req_path")"
  local real_req_digest; real_req_digest="$(_sha256_file "$req_path")"

  local fake_req_digest fake_result_digest fake_attempt_id
  fake_req_digest="$(printf '9%.0s' {1..64})"
  fake_result_digest="$(printf '8%.0s' {1..64})"
  fake_attempt_id="$(printf '7%.0s' {1..64})"
  [ "$fake_req_digest" != "$real_req_digest" ]

  local accepted_f; accepted_f="$txn_dir/accepted-result.json"
  _write_accepted_result "$accepted_f" "$(printf '{"request_digest":"%s","candidate_result_path":"results/%s.json","result_digest":"%s","accepted_attempt_id":"%s","accepted_lease_epoch":99}' "$fake_req_digest" "$fake_attempt_id" "$fake_result_digest" "$fake_attempt_id")"
  [ -f "$accepted_f" ]

  # The correct/secure contract (PLAN.md ~L710) applies to EVERY authorizing
  # surface, not only await-result: transaction-ack must independently re-run the
  # same correlation check before minting a durable ack.json that permanently
  # records "accepted". Genuinely RED right now: cmdTransactionAck only checks
  # shape-valid PRESENCE (readJsonDurableOptional(...) !== null), never content.
  _run_cli transaction-ack --coordination-root "$COORD_ROOT" --request "$req_path" --disposition accepted --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
  [ ! -f "$txn_dir/ack.json" ]
}

@test "DUR-C-barrier1-fail-leaves-nondurable FAIL: a directory barrier-1 failure must leave the target at nlink==2 (a later idempotent retry rejects it DURABILITY_UNPROVEN) -- never nlink==1, which breaks the PLAN.md ~L681 invariant (nlink==1 IMPLIES barrier-1-durable) and lets a reader/retry launder an unproven barrier as SUCCESS" {
  local expiry intent intent_b64 subject_bundle
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-C barrier1-fault fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-durc.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"

  # Publish #1: force ONLY directory barrier 1 to fail (independent seam). Fails
  # closed DURABILITY_UNPROVEN. Its first publishNoClobber (plan_ref) links the
  # target (nlink==2), barrier 1 fails -- the target must be LEFT at nlink==2.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=barrier1 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"

  # Publish #2: byte-identical (same --fixed-ids/--fixed-clock), NO fault -> hits
  # the idempotent EEXIST path against #1's leftover. If #1 left it nlink==2
  # (barrier-1 unproven), the retry must REJECT DURABILITY_UNPROVEN. CURRENTLY
  # RED: #1 unlinks its temp on barrier-1 failure, leaving nlink==1, so this
  # retry laundered a SUCCESS on an unproven barrier.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-D-barrier2-fail-closed FAIL: a directory barrier-2 failure (AFTER a successful temp-unlink, target already durably nlink==1 bytes-correct on disk) must still fail closed DURABILITY_UNPROVEN -- PLAN.md's 'writer returns only after barrier 2' contract, isolated from barrier-1/DUR-C" {
  # Codex gap: DUR-D was never formally defined/tested in isolation. barrier-1 (DUR-C,
  # target left nlink==2) and barrier-2 (this test, target already nlink==1) are
  # DIFFERENT unproven states -- DUR-C's own retry-based proof does not exercise this
  # one, since a barrier-2 failure leaves the target ALREADY byte-correct and durable
  # by every OTHER measure; only the flush proving the temp's removal is crash-durable
  # is unproven, and the writer's own contract is stricter than what the disk already
  # shows.
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-D barrier2-fault fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-durd.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  # Force ONLY directory barrier 2 to fail (independent seam): linkSync + barrier1 +
  # the temp-unlink ALL succeed for real -- only the barrier-2 flush itself is faulted.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_DIR_FSYNC=barrier2 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-E-unlink-fail-closed FAIL: if the post-barrier-1 temp-cleanup unlink fails, the target stays hard-linked (nlink==2, not durable) so the writer must fail closed DURABILITY_UNPROVEN -- never swallow the failure best-effort and return a non-durable SUCCESS" {
  local now expiry intent intent_b64 subject_bundle
  now="$(_iso_now)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-E unlink-fault fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-dure.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  # Directory barriers succeed; ONLY the post-barrier-1 temp-cleanup unlink is
  # forced to fail (seam). The target is then left hard-linked (nlink==2) --
  # assertDurable rejects it -- so returning SUCCESS is a non-durable success.
  # Must fail closed DURABILITY_UNPROVEN. CURRENTLY RED: the unlink failure is
  # swallowed best-effort and the publish returns SUCCESS.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK=1 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "DUR-B-temp-0600 FAIL: the owner-tagged publish temp is created owner-only (no group/other bits) -- 0o600, not 0o666 -- narrowing the pre-link window a concurrent same-directory reader could exploit" {
  local intent intent_b64 subject_bundle
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-B temp-mode fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(_iso_plus_seconds "$(_iso_now)" 1800)")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-durb.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  # The DUR-E unlink-fault leaves the fail-closed first-publishNoClobber temp
  # (plan_ref) on disk to inspect. A 0o666 create is group/other-accessible under
  # any umask below 0o066; the required owner-only 0o600 never is.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK=1 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64"
  [ "$status" -eq 3 ]
  local tmp; tmp="$(ls "$(_plan_root)"/.plan_ref.*.tmp-owner 2>/dev/null | head -1)"
  [ -n "$tmp" ]
  local grpother; grpother="$(node -e 'process.stdout.write(String(require("fs").lstatSync(process.argv[1]).mode & 0o077))' "$tmp")"
  [ "$grpother" = "0" ]
}

@test "DUR-F-idempotent-fd-bound FAIL: the EEXIST idempotent no-op must fd-bind the target with O_NOFOLLOW and require a regular file -- rejecting a symlinked target -- not read it by path (which follows the symlink and accepts an attacker-planted byte-identical file as the durable artifact)" {
  local expiry intent intent_b64 subject_bundle
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"DUR-F symlink-idempotent fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-durf.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  # Publish #1 -> real plan_ref (the first idempotent-eligible target).
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ -f "$plan_ref" ]
  # Replace the real plan_ref with a SYMLINK to a byte-identical file elsewhere.
  local evil; evil="$PROJ/evil-identical-plan-ref"
  cp "$plan_ref" "$evil"
  rm -f "$plan_ref"
  ln -s "$evil" "$plan_ref"
  # Publish #2 (identical) hits the plan_ref idempotent EEXIST path. It must NOT
  # accept the symlinked target. CURRENTLY RED: readFileSync follows the symlink,
  # byte-matches, and lstat(symlink).nlink===1 passes -> symlink accepted durable.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -ne 0 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "MISMATCH-ORDER-01 metadata drift wins over race-loss classification: a byte/size mismatch is RECORDED but fstat2+lstat still run -- if THEY also detect drift, that (not the byte mismatch) is what surfaces, proving the mismatch is never returned early" {
  local expiry intent intent_b64 subject_bundle
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"MISMATCH-ORDER fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-mismatch.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  # Publish #1 -> real plan_ref.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ -f "$plan_ref" ]
  # Overwrite plan_ref (same inode, still nlink==1, still exact 0600) with DIFFERENT,
  # SHORTER bytes -- a genuine size mismatch against the re-publish's expected payload.
  printf 'x' > "$plan_ref"
  chmod 0600 "$plan_ref"
  # Publish #2 (identical intent -> hits the plan_ref idempotent EEXIST path) with the
  # fstat2 post-open-comparator step ALSO faulted. CURRENTLY RED: the size mismatch is
  # thrown immediately (byteMismatch-tagged), so fstat2 is never reached, and the
  # caller remaps it to AUTHORITY_INVALID (race-loss) -- the fstat2 fault-injection seam
  # (proof fstat2 actually ran) never fires. Fixed: the mismatch is recorded, fstat2
  # STILL runs, its (non-byteMismatch-tagged) fault propagates raw and surfaces as
  # INTERNAL, never laundered into a race-loss classification.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME=fstat2 \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 7 ]
  _assert_cli_result "INTERNAL" "INTERNAL_ERROR"
}

@test "MISMATCH-ORDER-02 (Codex NO-GO round 2, missing-evidence item 2) a recorded byte mismatch that survives fstat2 (no drift there) still reaches the FINAL lstat step -- proving the lstat step itself, not just fstat2, is reached and can independently surface a fault" {
  local expiry intent intent_b64 subject_bundle
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"MISMATCH-ORDER-02 fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  subject_bundle="$PROJ/.planning/coordination-subject-bundle-mismatch2.json"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle"
  # Publish #1 -> real plan_ref.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  local plan_ref; plan_ref="$(_plan_root)/plan_ref"
  [ -f "$plan_ref" ]
  # Overwrite plan_ref (same inode, still nlink==1, still exact 0600) with DIFFERENT,
  # SHORTER bytes -- a genuine size mismatch against the re-publish's expected payload,
  # RECORDED (not thrown) by the comparator.
  printf 'x' > "$plan_ref"
  chmod 0600 "$plan_ref"
  # Publish #2 (identical intent -> hits the plan_ref idempotent EEXIST path) with ONLY
  # the FINAL lstat step faulted (fstat2 is untouched and genuinely clean/stable). If
  # the comparator wrongly returned the recorded byte mismatch as soon as fstat2 passed
  # -- never reaching lstat at all -- this would surface as the race-loss detail_code
  # instead of INTERNAL, and the lstat fault-injection seam would never fire.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME=lstat \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$subject_bundle" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 7 ]
  _assert_cli_result "INTERNAL" "INTERNAL_ERROR"
}

# ══════════════════════════════════════════════════════════════════════════
# Codex gap #2 (PLAN.md ~L698 "scan hard cap 1024 entries / 256 kept
# candidates"): listResultFiles/DUR-H recovery enumeration fail closed on an
# implausibly large directory rather than silently scanning/keeping an
# unbounded set.
# ══════════════════════════════════════════════════════════════════════════

@test "ENUM-CAP-01 (Codex gap #2): a results/ directory with more than 1024 raw entries fails closed DURABILITY_UNPROVEN rather than being silently scanned" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local results_dir; results_dir="$(dirname "$(_result_path "$rid" "$aid")")"
  mkdir -p "$results_dir"
  local i
  for i in $(seq 1 1025); do : > "$results_dir/filler-$i.txt"; done
  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "ENUM-CAP-02 (Codex gap #2, round 3 cleanup item 1) a results/ directory with more than 256 valid .json candidates (but under the 1024 raw-entry hard cap) keeps EXACTLY the first 256 sorted names (cand-0001..cand-0256), never the last 256 or merely 256-of-unspecified-identity" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local results_dir; results_dir="$(dirname "$(_result_path "$rid" "$aid")")"
  mkdir -p "$results_dir"
  local i
  for i in $(seq 1 300); do : > "$results_dir/$(printf 'cand-%04d' "$i").json"; done
  local kept
  kept="$(node -e '
    const impl = require(process.argv[1]);
    process.stdout.write(impl.listResultFiles(process.argv[2]).join(","));
  ' "$IMPL" "$(dirname "$results_dir")")"
  local expected
  expected="$(node -e '
    const out = [];
    for (let i = 1; i <= 256; i += 1) out.push("cand-" + String(i).padStart(4, "0") + ".json");
    process.stdout.write(out.join(","));
  ')"
  [ "$kept" = "$expected" ]
}

@test "ENUM-CAP-03 (Codex NO-GO round 2, missing-evidence item 4) DUR-H recovery enumeration (cleanup's own claims/ scan, NOT listResultFiles) fails closed on a directory with more than 1024 raw entries" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local claims_dir; claims_dir="$(dirname "$(_claim_path "$rid" "$aid")")"
  mkdir -p "$claims_dir"
  local i
  for i in $(seq 1 1025); do : > "$claims_dir/filler-$i.txt"; done
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "ENUM-CAP-04 (Codex NO-GO round 3, cleanup item 2) 257 genuine DUR-H-matching temp candidates (under the 1024 raw-entry hard cap, over the 256 kept-candidate cap) fails closed rc3 with ZERO mutation -- none of the 257 pairs touched" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local results_dir; results_dir="$(dirname "$(_result_path "$rid" "$aid")")"
  mkdir -p "$results_dir"
  local i target_name target_f temp_f
  for i in $(seq 1 257); do
    target_name="$(printf 'cand-%04d.json' "$i")"
    target_f="$results_dir/$target_name"
    printf '{"x":%s}' "$i" > "$target_f"
    chmod 0600 "$target_f"
    temp_f="$results_dir/.${target_name}.999999.$(printf '%016x' "$i").tmp-owner"
    ln "$target_f" "$temp_f"
  done
  local before; before="$(_snapshot_tree "$results_dir")"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  local after; after="$(_snapshot_tree "$results_dir")"
  [ "$before" = "$after" ]
}

@test "DUR-H-12 (Codex NO-GO round 2, missing-evidence item 4) a temp exceeding the 1 MiB max durable size is rejected 'ambiguous' before any size-derived read/allocation" {
  local rid aid; rid="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req; req="$(_request_path "$rid")"
  _write_request "$req" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$rid" "$rid" "$aid")"
  local result_f; result_f="$(_result_path "$rid" "$aid")"
  mkdir -p "$(dirname "$result_f")"
  # A raw oversized file -- reconcile's size bound fires on fstat.size alone, BEFORE
  # any attempt to parse/read it as a coordination record, so it need not be valid JSON.
  head -c 1100000 /dev/zero > "$result_f"
  chmod 0600 "$result_f"
  local temp_f; temp_f="$(dirname "$result_f")/.${aid}.json.999999.deadbeefcafebabe.tmp-owner"
  ln "$result_f" "$temp_f"
  # Codex NO-GO round 3, cleanup item 6: a full disk snapshot, not just a targeted
  # existence/nlink check, proves NOTHING under this directory changed at all.
  local before; before="$(_snapshot_tree "$(dirname "$result_f")")"
  _run_cli cleanup --coordination-root "$COORD_ROOT" --request "$req" --fixed-ids
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
  local after; after="$(_snapshot_tree "$(dirname "$result_f")")"
  [ "$before" = "$after" ]
}
