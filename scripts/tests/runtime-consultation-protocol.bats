#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Protocol/schema tests for the portable runtime-consultation core, Wave 1
# (portable-runtime-messaging-adapters), WP1 -- PLAN.md "Internal Transaction Records --
# Complete Field Tables (R2-C4)" and "Subject-vs-Producer Model + Root/Parent/Depth".
#
# CLI under test: node scripts/lib/runtime-consultation.cjs <subcommand> ... (Frozen
# Production CLI ABI, PLAN.md ~L750-796). This file owns `consult/v2` (request), the
# root/parent/depth validation table, `inbox-ref/v1`, the `coordination/cli-result/v1`
# stdout envelope shape, and (per the Fallback Matrix -> test crosswalk row 10) the
# `FM-10-invalid-result-rejected` case against `result/v2`. Path-Manifest confirms sole
# ownership: "scripts/tests/runtime-consultation-protocol.bats -- test-specialist . WP1 . self".
#
# Per the Path-Manifest's own `.claude/hooks/coordination-artifact.js` annotation (PLAN.md
# L1289: "runtime-consultation-protocol.bats (new v2 branch)"), this file also carries a
# small `RCP-artifactv2-*` section covering that file's additive, not-yet-wired
# `hasValidV2InboxRef(dir, ctx)` require()-API function -- a thin wrapper that delegates
# schema/correlation/durability to this file's own CLI-under-test (`validate --kind
# inbox-ref-v1`) via a subprocess boundary, then applies its own freshness re-check on top.
# This does not change the "sole ownership of `runtime-consultation.cjs` testing" claim
# above for the CLI surface itself; it is an adjacent, manifest-directed addition, not a
# scope rewrite.
#
# STATUS: RED. `scripts/lib/runtime-consultation.cjs` does not exist yet (WP1 has not
# landed). Every test below is expected to FAIL now -- `node` will report the module
# missing and exit non-zero, which trips the very first `[ "$status" -eq ... ]` assertion
# in each test before any later JSON-shape assertion runs. These tests are written
# against the EXACT frozen contract so they become the GREEN target once WP1 lands.
#
# Key interpretive decisions (documented so a future correction is a small, obvious
# fix rather than a silent divergence -- mirrors coordination-artifact-validation.bats's
# own practice of narrating non-obvious calls):
#   - `validate`'s grammar is the NEW named-flag form frozen in the CLI ABI table
#     (`--coordination-root --kind --artifact`), NOT the OLD positional
#     `coordination-artifact.js validate <kind> <file> <slug>` form used by
#     coordination-artifact-validation.bats (a different script/schema generation).
#   - `--kind` values used here (`consult-v2`, `inbox-ref-v1`, `result-v2`) follow the
#     `<schema-name>-<version>` convention implied by the dispatch's own
#     "validate --kind consult-v2" example; PLAN.md does not spell the exact enum.
#   - Every invocation sets `NODE_ENV=test` + `RUNTIME_CONSULTATION_TEST_CAPABILITY`
#     (the "harness-created" test capability the CLI ABI requires for `--fixed-ids`/
#     `--fixed-clock`). WP1/WP4's `role-command-grant/v1` authority layer (tested by
#     `runtime-consultation-role-gate.bats`, not this file) is assumed to be bypassable
#     under the same test capability for direct-CLI protocol tests -- this file is
#     scoped to protocol/schema validation, not grant/authority enforcement.
#   - `detail_code` per rejection: SCHEMA_INVALID for field-shape/structural violations
#     (missing/empty/oversized question, forbidden content, malformed/oversized
#     content_ref, lifetime bounds, unknown fields); CORRELATION_INVALID for
#     root/parent/depth graph violations and result/request correlation mismatches;
#     AUTHORITY_INVALID for the role-policy mediated-chain guard. All three are members
#     of the closed detail_code enum (PLAN.md ~L781); the specific choice per case is
#     this file's own reasonable inference, not a literal PLAN quote.
#   - Lifetime-boundary tests use a fixed historical `created_at`/`expiry` pair (not
#     "now") on the assumption that `validate` checks the created_at/expiry STRUCTURAL
#     relationship, not live wall-clock freshness -- `validate` is documented as
#     "full schema/path/authority validation, no mutation", a static check.
#
# Invocation: bats scripts/tests/runtime-consultation-protocol.bats (from repo root),
# or scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-consultation-protocol.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
# Additive v2 branch (see header note above): coordination-artifact.js's require()-only
# hasValidV2InboxRef(dir, ctx) wraps this file's own `validate --kind inbox-ref-v1` CLI
# surface over a subprocess boundary -- exercised by the RCP-artifactv2-* section below.
HOOK_ARTIFACT="$BATS_TEST_DIRNAME/../../.claude/hooks/coordination-artifact.js"
WAVE_SLUG="rcp-test-wave"
MAX_DEPTH=2
# "Harness-created" test capability (PLAN.md ~L752-753, ~L796): this bats suite IS the
# harness for direct-CLI protocol testing, so it mints its own fixed token here.
TEST_CAPABILITY="bats-runtime-consultation-protocol-fixture-capability"
# Matches _write_request's own default request_id/root_request_id (64 lowercase-hex-safe
# 'a' characters) so path-building code and the JSON defaults never drift apart.
DEFAULT_REQUEST_ID="$(printf 'a%.0s' {1..64})"

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
  printf '# Fixture PLAN for runtime-consultation-protocol.bats\n\nThrowaway per-test fixture -- not the real Wave 1 PLAN.md.\n' > "$PLAN_FILE"
  PLAN_DIGEST="$(_sha256_file "$PLAN_FILE")"

  SUBJECT_BUNDLE_FILE="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  _write_subject_bundle "$SUBJECT_BUNDLE_FILE" '{}'

  _ID_COUNTER=0

  # Best-effort root init; swallowed on failure since the implementation does not exist
  # yet (RED phase) -- every @test below independently proves its own RED failure via
  # its own exit-code/JSON-shape assertions, not via setup() succeeding.
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" root-init --coordination-root "$COORD_ROOT" >/dev/null 2>&1 || true
}

teardown() {
  rm -rf "$PROJ"
}

# ── Generic helpers ──────────────────────────────────────────────────────────

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

# Core-generated-shaped fixture ID: 64 lowercase-hex chars (>=32 required by the
# request_id/attempt_id field constraint), unique per call within a test run.
_gen_hex_id() {
  _ID_COUNTER=$((_ID_COUNTER + 1))
  _sha256_string "rcp-fixture-id-$$-${_ID_COUNTER}-${RANDOM}-${RANDOM}"
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

# Portable "base ISO timestamp + N seconds" -- GNU -d first, BSD/macOS -j -f fallback
# (mirrors the sha256sum||shasum idiom used throughout this repo's bats suites).
_iso_plus_seconds() {
  local base="$1" n="$2"
  date -u -d "${base} +${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null && return
  date -j -f '%Y-%m-%dT%H:%M:%SZ' "${base}" -v"+${n}S" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
}

# base64url-encodes stdin. Node's own Buffer "base64url" encoding is used deliberately --
# the CLI ABI's `--intent`/`--content` flags are documented as base64url, and the real
# implementation will use the same Node primitive, so this stays byte-consistent with it.
_base64url_encode() {
  node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))'
}

# ── Path helpers (Namespace & Root Security tree, PLAN.md ~L602-628) ────────

_plan_root() {
  printf '%s' "$COORD_ROOT/$REPO_ID/$WAVE_SLUG/$PLAN_DIGEST"
}

_request_path() {
  local id="$1"
  printf '%s' "$(_plan_root)/transactions/$id/request.json"
}

_inbox_path() {
  local role="$1" id="$2"
  printf '%s' "$(_plan_root)/inbox/$role/$id.json"
}

_result_path() {
  local id="$1" attempt="$2"
  printf '%s' "$(_plan_root)/transactions/$id/results/$attempt.json"
}

# ── JSON fixture builders ────────────────────────────────────────────────────
# Each builder merges a small JSON "overrides" object over a fully-populated default
# object covering every field in the record's PLAN.md field table, so a test only
# needs to name the field(s) actually under test. A value of the literal string
# "__OMIT__" in overrides deletes that key from the merged result (used for
# "missing required field" cases). Built via `node -e` rather than fragile printf/sed
# string surgery, since several fields (question, content_ref) need exact byte-length
# or nested-object control that plain shell string building cannot do safely.

_write_request() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  RCP_REPO_ID="$REPO_ID" RCP_WAVE_SLUG="$WAVE_SLUG" RCP_PLAN_DIGEST="$PLAN_DIGEST" \
  RCP_COORD_ROOT_ID="$COORD_ROOT_ID" RCP_WORKTREE_ID="$WORKTREE_ID" RCP_SUBJECT_HEAD="$SUBJECT_HEAD" \
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
      requester_worktree_id: e.RCP_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.RCP_REPO_ID,
      wave_slug: e.RCP_WAVE_SLUG,
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: e.RCP_COORD_ROOT_ID,
      plan_digest: e.RCP_PLAN_DIGEST,
      subject_repo_id: e.RCP_REPO_ID,
      subject_worktree_id: e.RCP_WORKTREE_ID,
      subject_head: e.RCP_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "default bats fixture question",
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
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_inbox_ref() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/inbox-ref/v1",
      request_id: "a".repeat(64),
      request_digest: "0".repeat(64),
      kind: "consult",
      target_role: "arch-testing",
      created_at: "2025-01-01T00:00:05Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

_write_result() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/result/v2",
      in_reply_to: "a".repeat(64),
      request_digest: "0".repeat(64),
      plan_digest: "e".repeat(64),
      repo_id: "e".repeat(64),
      wave_slug: "rcp-test-wave",
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
      content: "a fixture answer",
      subject_repo_id: "e".repeat(64),
      subject_worktree_id: "2".repeat(64),
      subject_head: "5".repeat(40),
      subject_scope_digest: "d".repeat(64),
      consultation_dependencies: [],
      producer_worktree_id: "2".repeat(64),
      producer_head: "5".repeat(40),
      created_at: "2025-01-01T00:05:00Z"
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# `subject-bundle-manifest/v1` fixture builder (PLAN.md ~L647, ~L804 -- the
# `publish-request --subject-bundle` flag). Same override/`__OMIT__` idiom as this
# file's other builders. The manifest is intentionally minimal (schema + entries array
# only) -- deep per-entry validation is WP2/WP3, not exercised by this WP1 test file
# (see runtime-consultation.cjs's own SUBJECT_BUNDLE_MANIFEST_V1_FIELDS comment). The
# manifest must NOT carry subject_scope_digest itself -- that value is always DERIVED
# by the CLI (sha256 of this exact validated manifest), never caller-supplied.
_write_subject_bundle() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/subject-bundle-manifest/v1",
      entries: []
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# Publishes a real, content-addressed blob under the current plan-root's blobs/ dir
# (Namespace & Root Security: `blobs/<sha256>`, filename IS the blob's own sha256) and
# echoes "<sha256> <byte-size>" for building a well-formed content_ref handle.
_publish_test_blob() {
  local content="$1"
  local blobdir; blobdir="$(_plan_root)/blobs"
  mkdir -p "$blobdir"
  local tmp; tmp="$(mktemp)"
  printf '%s' "$content" > "$tmp"
  local sha; sha="$(_sha256_file "$tmp")"
  local size; size="$(wc -c < "$tmp" | tr -d ' ')"
  cp "$tmp" "$blobdir/$sha"
  rm -f "$tmp"
  printf '%s %s' "$sha" "$size"
}

# Builds a valid root->depth-N chain of consult/v2 fixtures sharing one root_request_id,
# each parented on the previous node, depth strictly incrementing. Populates the global
# arrays CHAIN_ID[0..n] / CHAIN_PATH[0..n] (deliberately not `local` so callers can read
# them after the call returns).
_build_chain() {
  local n="$1"
  local i
  CHAIN_ID=()
  CHAIN_PATH=()
  for ((i = 0; i <= n; i++)); do
    CHAIN_ID[$i]="$(_gen_hex_id)"
  done
  local root_id="${CHAIN_ID[0]}"
  for ((i = 0; i <= n; i++)); do
    local overrides path
    if [ "$i" -eq 0 ]; then
      overrides="$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0}' "${CHAIN_ID[0]}" "$root_id")"
    else
      overrides="$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":%d}' "${CHAIN_ID[$i]}" "$root_id" "${CHAIN_ID[$((i - 1))]}" "$i")"
    fi
    path="$(_request_path "${CHAIN_ID[$i]}")"
    _write_request "$path" "$overrides"
    CHAIN_PATH[$i]="$path"
  done
}

# ── CLI invocation + assertion helpers ───────────────────────────────────────

_run_validate() {
  local kind="$1" artifact="$2"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" validate --coordination-root "$COORD_ROOT" --kind "$kind" --artifact "$artifact"
}

# Parses the most recent `run --separate-stderr` invocation's captured stdout ($output)
# as the frozen coordination/cli-result/v1 envelope (PLAN.md ~L779-781) and asserts:
# exactly the closed key set (additionalProperties:false), literal schema, the given
# expected status, ok/status consistency, and (when expected_detail is non-empty) the
# given expected detail_code. Pass "" for expected_detail to skip that specific check
# (used where more than one closed detail_code is plausibly correct for a rejection).
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

# Invokes coordination-artifact.js's require()-API hasValidV2InboxRef(dir, ctx) directly --
# it has no CLI verb of its own (see HOOK_ARTIFACT's header note). extra_ctx_json is an
# optional JSON object string merged over the default
# {coordRoot, projectRoot, runtimeConsultationPath} ctx; defaults to "{}" when omitted or
# empty. Two deliberate departures from the arch-testing spec's literal harness snippet,
# both harness-only fixes (no impl file touched), covered by RCP-artifactv2-1's initial RED:
#   - Default value: NOT the spec's literal `"${2:-\{\}}"` -- verified empirically that
#     bash's brace-escaping inside a default-value expansion drops only the SECOND
#     backslash, producing the 3-char string `\{}` (invalid JSON) whenever the caller omits
#     $2, which 4 of the 5 cases below do. Replaced with a plain -z guard.
#   - runtimeConsultationPath: always explicitly defaulted to $IMPL (the real CLI under
#     test), NOT left to isV2InboxRefCandidateValid's own
#     `path.join(ctx.projectRoot, 'scripts', 'lib', 'runtime-consultation.cjs')` fallback.
#     This file's $PROJ fixture (mktemp -d + bare `git init`, per setup()) intentionally has
#     no scripts/lib/ of its own -- passing $PROJ as ctx.projectRoot without this override
#     made the fallback resolve to a path that never exists, so the delegate spawnSync
#     always failed regardless of candidate content (proven by RCP-artifactv2-1 going RED:
#     a well-formed, fresh candidate returned false instead of true). RCP-artifactv2-4 still
#     independently overrides this same field to a genuinely-broken path via extra_ctx_json
#     (Object.assign below applies overrides AFTER this default, so it wins as intended).
# $status is always expected 0 -- hasValidV2InboxRef never throws by contract.
_run_has_valid_v2_inbox_ref() {
  local dir="$1"
  local extra_ctx_json="$2"
  if [ -z "$extra_ctx_json" ]; then
    extra_ctx_json='{}'
  fi
  run --separate-stderr node -e '
    const { hasValidV2InboxRef } = require(process.argv[1]);
    const dir = process.argv[2];
    const ctx = Object.assign(
      { coordRoot: process.argv[3], projectRoot: process.argv[4], runtimeConsultationPath: process.argv[6] },
      JSON.parse(process.argv[5])
    );
    process.stdout.write(hasValidV2InboxRef(dir, ctx) ? "true" : "false");
  ' "$HOOK_ARTIFACT" "$dir" "$COORD_ROOT" "$PROJ" "$extra_ctx_json" "$IMPL"
}

# ══════════════════════════════════════════════════════════════════════════
# consult/v2 request -- field-shape validation (record #1, PLAN.md ~L272-303)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-request-1 PASS: valid root consult/v2 request (root_request_id==request_id, parent null, depth 0) validates" {
  local f; f="$(_request_path "$DEFAULT_REQUEST_ID")"
  _write_request "$f" '{}'
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-request-2 FAIL: missing question is rejected" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","question":"__OMIT__"}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-3 FAIL: empty question is rejected" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","question":""}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-4 FAIL: question of 8193 encoded bytes is rejected" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local q; q="$(head -c 8193 /dev/zero | tr '\0' 'a')"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","question":"%s"}' "$id" "$id" "$q")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-5 PASS: question of exactly 8192 encoded bytes validates" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local q; q="$(head -c 8192 /dev/zero | tr '\0' 'a')"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","question":"%s"}' "$id" "$id" "$q")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-request-6 FAIL: inline request 'content' key is rejected (only content_ref is legal)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content":"inline content is not part of consult/v2"}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-7 FAIL: malformed content_ref (wrong type, not a handle object) is rejected" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":"not-a-handle-object"}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-8 FAIL: content_ref size beyond 10485760 bytes (>10MB) is rejected" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local fake_digest; fake_digest="$(printf 'f%.0s' {1..64})"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":10485761,"digest":"%s"}}' "$id" "$id" "$fake_digest" "$fake_digest")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-9 PASS: well-formed content_ref referencing a real blob validates (question-plus-ref)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local blob_sha blob_size
  read -r blob_sha blob_size <<< "$(_publish_test_blob "RCP-request-9 fixture blob content")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":%s,"digest":"%s"}}' "$id" "$id" "$blob_sha" "$blob_size" "$blob_sha")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-request-10 FAIL: expiry at created_at+119s is rejected (below the 120s floor)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local created="2025-01-01T00:00:00Z"
  local expiry; expiry="$(_iso_plus_seconds "$created" 119)"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","created_at":"%s","expiry":"%s"}' "$id" "$id" "$created" "$expiry")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-11 PASS: expiry at created_at+120s validates (the 120s floor is inclusive)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local created="2025-01-01T00:00:00Z"
  local expiry; expiry="$(_iso_plus_seconds "$created" 120)"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","created_at":"%s","expiry":"%s"}' "$id" "$id" "$created" "$expiry")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-request-12 PASS: expiry at created_at+3600s validates (the 3600s ceiling is inclusive)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local created="2025-01-01T00:00:00Z"
  local expiry; expiry="$(_iso_plus_seconds "$created" 3600)"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","created_at":"%s","expiry":"%s"}' "$id" "$id" "$created" "$expiry")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-request-13 FAIL: expiry at created_at+3601s is rejected (above the 3600s ceiling)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local created="2025-01-01T00:00:00Z"
  local expiry; expiry="$(_iso_plus_seconds "$created" 3601)"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","created_at":"%s","expiry":"%s"}' "$id" "$id" "$created" "$expiry")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-request-14 FAIL: unknown/additional field is rejected (additionalProperties:false)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","totally_unknown_field_xyz":"nope"}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# root/parent/depth validation table (PLAN.md ~L659-671)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-graph-1 PASS: nested request with depth==parent.depth+1 and the same root_request_id validates" {
  _build_chain 1
  _run_validate consult-v2 "${CHAIN_PATH[1]}"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-graph-2 PASS: nested request at exactly max_depth(2) validates" {
  _build_chain 2
  _run_validate consult-v2 "${CHAIN_PATH[2]}"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-graph-3 FAIL: nested request beyond max_depth(2) is rejected (depth overflow)" {
  _build_chain 3
  _run_validate consult-v2 "${CHAIN_PATH[3]}"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "RCP-graph-4 FAIL: parent exists at the correct depth but declares a different root_request_id -> cross-root rejected" {
  local parent_id; parent_id="$(_gen_hex_id)"
  local parent_f; parent_f="$(_request_path "$parent_id")"
  _write_request "$parent_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0}' "$parent_id" "$parent_id")"

  local child_id; child_id="$(_gen_hex_id)"
  local other_root; other_root="$(_gen_hex_id)"
  local child_f; child_f="$(_request_path "$child_id")"
  _write_request "$child_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1}' "$child_id" "$other_root" "$parent_id")"

  _run_validate consult-v2 "$child_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "RCP-graph-5 FAIL: parent_request_id does not resolve to any existing request -> rejected" {
  local child_id; child_id="$(_gen_hex_id)"
  local ghost_parent; ghost_parent="$(_gen_hex_id)"
  local child_f; child_f="$(_request_path "$child_id")"
  _write_request "$child_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1}' "$child_id" "$child_id" "$ghost_parent")"
  _run_validate consult-v2 "$child_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "RCP-graph-6 FAIL: a 2-node parent cycle (A<->B) is rejected (no cycles)" {
  local id_a; id_a="$(_gen_hex_id)"
  local id_b; id_b="$(_gen_hex_id)"
  local f_a; f_a="$(_request_path "$id_a")"
  local f_b; f_b="$(_request_path "$id_b")"
  # A claims B as parent; B claims A as parent -- walking pointers from either one
  # revisits the other forever and never reaches an actual root.
  _write_request "$f_a" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1}' "$id_a" "$id_a" "$id_b")"
  _write_request "$f_b" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1}' "$id_b" "$id_a" "$id_a")"
  _run_validate consult-v2 "$f_a"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Role-policy mediated-chain guard (PLAN.md ~L668, ~L671)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-role-policy-1 FAIL: direct specialist -> context-provider request is rejected at depth 0 (mediated-chain guard)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","source_role":"test-specialist","target_role":"context-provider"}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "RCP-role-policy-2 FAIL: direct specialist -> context-provider request is rejected at a nested depth too (regardless of depth)" {
  local root_id; root_id="$(_gen_hex_id)"
  local root_f; root_f="$(_request_path "$root_id")"
  _write_request "$root_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0,"source_role":"test-specialist","target_role":"arch-testing"}' "$root_id" "$root_id")"

  local child_id; child_id="$(_gen_hex_id)"
  local child_f; child_f="$(_request_path "$child_id")"
  _write_request "$child_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1,"source_role":"test-specialist","target_role":"context-provider"}' "$child_id" "$root_id" "$root_id")"

  _run_validate consult-v2 "$child_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# inbox-ref/v1 (record #2, PLAN.md ~L305-316)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-inbox-ref-1 PASS: valid inbox-ref referencing an existing, matching request validates" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing"}' "$id" "$digest")"

  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCP-inbox-ref-2 FAIL (INBOX-REF-01 spirit): request_id containing traversal characters cannot redirect the reference" {
  local evil_id="../../../../etc/passwd"
  local ref_f; ref_f="$(_inbox_path "arch-testing" "traversal-fixture")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","target_role":"arch-testing"}' "$evil_id")"
  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-inbox-ref-3 FAIL: request_digest does not match the real request.json bytes (stale/tampered) is rejected" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"

  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  local wrong_digest; wrong_digest="$(printf '0%.0s' {1..64})"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing"}' "$id" "$wrong_digest")"

  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "RCP-inbox-ref-4 FAIL: an extra path-like field is rejected (additionalProperties:false)" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing","path":"/etc/passwd"}' "$id" "$digest")"

  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# coordination-artifact.js hasValidV2InboxRef (v2 branch, Path-Manifest L1289)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-artifactv2-1 PASS: a well-formed, correlated, fresh inbox-ref/v1 candidate makes hasValidV2InboxRef return true" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing","created_at":"%s"}' "$id" "$digest" "$now")"

  _run_has_valid_v2_inbox_ref "$(dirname "$ref_f")"
  [ "$status" -eq 0 ]
  [ "$output" = "true" ]
}

@test "RCP-artifactv2-2 FAIL: malformed inbox-ref/v1 content (missing required 'kind') makes the delegate CLI reject it, and hasValidV2InboxRef returns false" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing","created_at":"%s","kind":"__OMIT__"}' "$id" "$digest" "$now")"

  # Sanity: confirm this candidate really is rejected by the delegate CLI itself (not
  # merely unscanned) -- distinguishes this case from RCP-artifactv2-3's "no candidates
  # found" path and RCP-artifactv2-4's "delegate unreachable" path.
  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"

  _run_has_valid_v2_inbox_ref "$(dirname "$ref_f")"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

@test "RCP-artifactv2-3 FAIL: an absent or empty inbox directory makes hasValidV2InboxRef return false without throwing" {
  # 3a: dir was never created at all -- hits the fs.opendirSync catch.
  local never_created; never_created="$PROJ/.planning/coordination/never-created-dir"
  _run_has_valid_v2_inbox_ref "$never_created"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]

  # 3b: dir exists but has zero entries -- scan loop completes with an empty candidates array.
  local empty_dir; empty_dir="$PROJ/.planning/coordination/empty-inbox-dir"
  mkdir -p "$empty_dir"
  _run_has_valid_v2_inbox_ref "$empty_dir"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

@test "RCP-artifactv2-4 FAIL: a broken delegate-CLI path (non-zero child exit) makes hasValidV2InboxRef return false without throwing" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local now; now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing","created_at":"%s"}' "$id" "$digest" "$now")"

  # Otherwise-well-formed candidate (same fixture shape as RCP-artifactv2-1) is required so
  # the scan loop actually reaches the delegate call -- points runtimeConsultationPath at a
  # file that does not exist, so spawnSync's child (node <missing-path> validate ...) fails
  # to load the module and exits non-zero deterministically (isV2InboxRefCandidateValid's
  # `r.error || r.status !== 0` guard), with zero timeout/flakiness risk.
  local broken_cli_ctx; broken_cli_ctx="$(printf '{"runtimeConsultationPath":"%s/does-not-exist.cjs"}' "$PROJ")"
  _run_has_valid_v2_inbox_ref "$(dirname "$ref_f")" "$broken_cli_ctx"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

@test "RCP-artifactv2-5 FAIL: a schema-valid but stale candidate (created_at beyond CONSULT_TTL_SECONDS) makes hasValidV2InboxRef return false even though the delegate CLI alone would accept it" {
  local ttl; ttl="$(node "$HOOK_ARTIFACT" const CONSULT_TTL_SECONDS)"

  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  # Computed via node rather than this file's shell-only _iso_plus_seconds: that helper
  # bakes a literal "+" into both its GNU (-d) and BSD (-v) date-delta flags, so it cannot
  # safely take a negative offset on either branch (BSD -v"+-NS" in particular is not a
  # valid flag value). Node's Date arithmetic has no such GNU/BSD divergence. Deliberately
  # NOT overriding ctx.now -- this must be stale against the validator's own real
  # Date.now(), the same comparison a live hook invocation would make.
  local stale_created
  stale_created="$(node -e '
    const ttlSeconds = Number(process.argv[1]);
    const staleMs = Date.now() - (ttlSeconds + 3600) * 1000;
    process.stdout.write(new Date(staleMs).toISOString().replace(/\.\d{3}Z$/, "Z"));
  ' "$ttl")"

  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing","created_at":"%s"}' "$id" "$digest" "$stale_created")"

  # Sanity: validateInboxRefV1 itself enforces no freshness bound (facts 7/8 in the
  # cross-verify note), so the delegate CLI alone still accepts this candidate -- proves the
  # rejection below comes from hasValidV2InboxRef's own freshness re-check, not the delegate.
  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  _run_has_valid_v2_inbox_ref "$(dirname "$ref_f")"
  [ "$status" -eq 0 ]
  [ "$output" = "false" ]
}

# ══════════════════════════════════════════════════════════════════════════
# publish-request end-to-end (Frozen CLI ABI, PLAN.md ~L761)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-publish-1 PASS: publish-request creates a valid root request (root_request_id==request_id, parent null, depth 0)" {
  local now expiry intent intent_b64
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-1 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  node -e '
    const fs = require("fs");
    const data = JSON.parse(process.argv[1]);
    const req = JSON.parse(fs.readFileSync(data.artifact_ref, "utf8"));
    if (req.root_request_id !== req.request_id) { console.error("root_request_id != request_id"); process.exit(1); }
    if (req.parent_request_id !== null) { console.error("parent_request_id not null for root"); process.exit(1); }
    if (req.depth !== 0) { console.error("depth not 0 for root"); process.exit(1); }
  ' "$output"
}

@test "RCP-publish-2 PASS: a second publish-request with parent_request_id creates a valid nested request (depth==parent.depth+1, same root)" {
  local now expiry intent intent_b64
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-2 root fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  local root_request_id; root_request_id="$(node -e 'console.log(JSON.parse(process.argv[1]).request_id)' "$output")"

  local child_expiry child_intent child_intent_b64
  child_expiry="$(_iso_plus_seconds "$now" 1800)"
  # Same target_role as the root (arch-testing) deliberately -- this test isolates
  # depth/root linkage, not role-policy (see RCP-role-policy-* for that guard).
  child_intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-2 nested fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","parent_request_id":"%s"}' "$child_expiry" "$root_request_id")"
  child_intent_b64="$(printf '%s' "$child_intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$child_intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  node -e '
    const fs = require("fs");
    const data = JSON.parse(process.argv[1]);
    const rootId = process.argv[2];
    const child = JSON.parse(fs.readFileSync(data.artifact_ref, "utf8"));
    if (child.root_request_id !== rootId) { console.error("root mismatch"); process.exit(1); }
    if (child.parent_request_id !== rootId) { console.error("parent mismatch"); process.exit(1); }
    if (child.depth !== 1) { console.error("depth not 1"); process.exit(1); }
  ' "$output" "$root_request_id"
}

@test "RCP-publish-3 FAIL: a caller-supplied request_id in the intent is rejected (IDs are core-generated, R2-C7)" {
  local now expiry intent intent_b64
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-3 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","request_id":"caller-chosen-id-not-allowed"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -ne 0 ]
  # Either INVALID_ARGUMENT (argv/intent decode-time) or SCHEMA_INVALID (intent-object
  # additionalProperties:false) are plausible for this exact rejection -- assert the
  # certain part (status/ok/shape), not a specific detail_code.
  _assert_cli_result "INVALID" ""
}

@test "RCP-publish-4 PASS: two textually-different valid subject-bundle manifests at the same git HEAD produce different subject_scope_digest values (real-content digest, not a HEAD-only placeholder)" {
  local now expiry
  now="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  expiry="$(_iso_plus_seconds "$now" 1800)"

  local bundle_a bundle_b
  bundle_a="$PROJ/.planning/coordination-subject-bundle-a.json"
  bundle_b="$PROJ/.planning/coordination-subject-bundle-b.json"
  _write_subject_bundle "$bundle_a" '{"entries":[{"path":"fixture-a.txt"}]}'
  _write_subject_bundle "$bundle_b" '{"entries":[{"path":"fixture-b.txt"}]}'

  local intent_a intent_a_b64
  intent_a="$(printf '{"target_role":"arch-testing","question":"RCP-publish-4 fixture question A","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_a_b64="$(printf '%s' "$intent_a" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$bundle_a" --intent "$intent_a_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local output_a="$output"

  local intent_b intent_b_b64
  intent_b="$(printf '{"target_role":"arch-testing","question":"RCP-publish-4 fixture question B","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b_b64="$(printf '%s' "$intent_b" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$bundle_b" --intent "$intent_b_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local output_b="$output"

  node -e '
    const fs = require("fs");
    const dataA = JSON.parse(process.argv[1]);
    const dataB = JSON.parse(process.argv[2]);
    const reqA = JSON.parse(fs.readFileSync(dataA.artifact_ref, "utf8"));
    const reqB = JSON.parse(fs.readFileSync(dataB.artifact_ref, "utf8"));
    if (reqA.subject_head !== reqB.subject_head) { console.error("fixture bug: HEAD moved between publishes -- not an isolated-HEAD comparison"); process.exit(1); }
    if (reqA.subject_scope_digest === reqB.subject_scope_digest) { console.error("subject_scope_digest identical for two textually-different manifests at the same HEAD"); process.exit(1); }
  ' "$output_a" "$output_b"
}

# ══════════════════════════════════════════════════════════════════════════
# coordination/cli-result/v1 stdout envelope shape (Frozen CLI ABI, PLAN.md ~L779-781)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-cli-result-1: a successful validate prints exactly one closed-shape coordination/cli-result/v1 object on stdout" {
  local f; f="$(_request_path "$DEFAULT_REQUEST_ID")"
  _write_request "$f" '{}'
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  # _assert_cli_result already enforces the closed key set, literal schema, and
  # ok/status consistency -- this test names that contract explicitly per the ABI's
  # "additionalProperties:false" stdout envelope requirement.
  _assert_cli_result "SUCCESS" "NONE"
  # stdout must be exactly one JSON object plus a trailing newline -- no prose/second line.
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
}

@test "RCP-cli-result-2: a failing validate prints exactly one closed-shape coordination/cli-result/v1 object with status INVALID" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","question":"__OMIT__"}' "$id" "$id")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
}

# ══════════════════════════════════════════════════════════════════════════
# FM-10-invalid-result-rejected (Fallback Matrix -> test crosswalk row 10, PLAN.md
# ~L1458) -- result/v2 (record #6, PLAN.md ~L410-435)
# ══════════════════════════════════════════════════════════════════════════

@test "FM-10-invalid-result-rejected-1: an empty candidate result file is rejected" {
  local id attempt f
  id="$(_gen_hex_id)"
  attempt="$(_gen_hex_id)"
  f="$(_result_path "$id" "$attempt")"
  mkdir -p "$(dirname "$f")"
  : > "$f"
  _run_validate result-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "FM-10-invalid-result-rejected-2: an empty JSON object candidate result (missing every required field) is rejected" {
  local id attempt f
  id="$(_gen_hex_id)"
  attempt="$(_gen_hex_id)"
  f="$(_result_path "$id" "$attempt")"
  mkdir -p "$(dirname "$f")"
  printf '{}' > "$f"
  _run_validate result-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "FM-10-invalid-result-rejected-3: a result whose from_role does not match the request's target_role is rejected" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing","source_role":"test-specialist"}' "$id" "$id")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"

  local attempt; attempt="$(_gen_hex_id)"
  local result_f; result_f="$(_result_path "$id" "$attempt")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","request_digest":"%s","attempt_id":"%s","from_role":"toolkit-specialist","to_role":"test-specialist","repo_id":"%s","wave_slug":"%s","plan_digest":"%s","subject_repo_id":"%s","subject_worktree_id":"%s","subject_head":"%s"}' \
    "$id" "$req_digest" "$attempt" "$REPO_ID" "$WAVE_SLUG" "$PLAN_DIGEST" "$REPO_ID" "$WORKTREE_ID" "$SUBJECT_HEAD")"

  _run_validate result-v2 "$result_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}
