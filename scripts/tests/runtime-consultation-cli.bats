#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# WP2 Frozen CLI ABI conformance suite for the portable runtime-consultation core,
# Wave 1 (portable-runtime-messaging-adapters) -- PLAN.md "Frozen Production CLI ABI
# (no WP2 naming latitude)" (~L750-796).
#
# CLI under test: node scripts/lib/runtime-consultation.cjs <subcommand> ... (same
# binary as runtime-consultation-protocol.bats). THIS file's scope is the CLI
# CONTRACT layer only -- argv grammar, the coordination/cli-result/v1 stdout
# envelope, the closed status/rc/detail_code mapping, argv caps, and the
# --fixed-ids/--fixed-clock test-capability gate. It deliberately does NOT
# duplicate runtime-consultation-protocol.bats's ownership of consult/v2 field
# validation, the root/parent/depth graph, inbox-ref/v1, or result/v2 field
# validation -- nor does it exercise deep per-driver activation/delivery behavior
# (ActivationAction union arms, SendMessage/Agent/bridge_argv payloads, WAL
# ordering) -- that is WP3 bridge.bats's scope. Single-owner per this task's
# dispatch: test-specialist authors/owns this file for WP2's CLI-ABI RED suite.
#
# STATUS: PARTIAL RED, empirically verified against the real WP1 binary at
# authoring time -- 16 of 30 cases RED, 14 GREEN. WP1 landed 12 of the 18 frozen
# subcommands (root-init, root-validate, validate, publish-request, claim,
# lease-heartbeat, takeover, accept-result, transaction-ack, cancel, cleanup,
# await-result). The 14 GREEN cases (CLI-RESULT-01/02/03/09, RCC-argv-1..6,
# RCC-determinism-1/2/3, RCC-stdout-1) confirm WP1's basic argv-grammar and
# determinism-gate conformance is already solid. The 16 RED cases split into two
# kinds, both intentional and evidence-based (each carries an inline comment with
# the actual observed status/code/detail_code, not a guess):
#   (a) 8 cases require a WP2-new verb (dispatch/record-delivery/publish-blob/
#       publish-result/worker-stop x2/worker-stop-ack) that does not exist yet --
#       these become the GREEN target once WP2 lands.
#   (b) 8 cases exercise ONLY existing WP1 verbs but empirically hit a REAL
#       conformance gap against the frozen ABI text, confirmed by directly running
#       the binary (not assumed): RCC-argv-7 (unrecognized flags silently
#       accepted instead of rejected), RCC-caps-1/2 (the 2048-byte path-token and
#       131072-byte total-argv caps are not checked proactively before decode --
#       today's rejections instead come from a lower-level INTERNAL/rc7 crash and
#       a downstream SCHEMA_INVALID respectively), RCC-determinism-4
#       (RUNTIME_CONSULTATION_ACL_PROBE production misuse is not yet rejected),
#       CLI-RESULT-05 (TIMEOUT/rc5 is correct but detail_code is NONE instead of
#       DEADLINE_EXCEEDED, seemingly violating the closed rule that NONE is legal
#       only with success), CLI-RESULT-07 (detail_code TRANSACTION_CANCELLED is
#       correct but paired with INVALID/rc3 instead of the frozen CANCELLED/rc6),
#       and CLI-RESULT-06/08 (attribution genuinely uncertain -- see each test's
#       own comment; flagged for the implementation owner, not silently asserted
#       as fact). Every test is written against the EXACT frozen ABI table/
#       envelope text in PLAN.md as the TARGET, never adjusted to match a
#       observed gap -- that would defeat the point of a conformance suite.
#
# Key interpretive decisions (mirrors runtime-consultation-protocol.bats's own
# documented practice of narrating non-obvious calls, so a future correction is a
# small, obvious fix rather than a silent divergence):
#   - USAGE_ERROR/rc2 vs INVALID/rc3 split for argv-level problems: an EARLIER
#     draft of this file assumed MISSING_ARGUMENT/DUPLICATE_ARGUMENT/
#     INVALID_ARGUMENT paired with rc3/INVALID (reserving rc2/USAGE_ERROR for
#     UNKNOWN_COMMAND alone). That assumption was empirically WRONG and was
#     corrected before landing this file: running the real WP1 binary against
#     root-init (missing/duplicate --coordination-root), transaction-ack (bad
#     --disposition), and cancel (bad --reason) all confirmed
#     status=USAGE_ERROR/code=2 with the named detail_code, not INVALID/code=3.
#     The verified rule applied throughout this file is: PURE ARGV-GRAMMAR
#     problems (unknown subcommand, missing/duplicate flag, positional operand,
#     unrecognized flag, or a flag value outside its OWN static closed enum --
#     none of which requires reading any file or business state) are
#     USAGE_ERROR/rc2, with detail_code naming the exact kind
#     (UNKNOWN_COMMAND/MISSING_ARGUMENT/DUPLICATE_ARGUMENT/INVALID_ARGUMENT).
#     INVALID/rc3 is reserved for CAPABILITY/SECURITY-GATE problems (production
#     misuse of --fixed-ids/--fixed-clock/RUNTIME_CONSULTATION_ACL_PROBE,
#     confirmed empirically to stay at rc3 -- see CLI-RESULT-03/RCC-determinism-*)
#     and CONTENT-level problems (SCHEMA_INVALID/CORRELATION_INVALID/
#     AUTHORITY_INVALID/SECURITY_INVALID), both checked deeper in the pipeline
#     after basic argv grammar already passed. Two real gaps were found and are
#     called out inline rather than silently matched to current behavior (both
#     assert the spec-mandated target, so they correctly stay RED):
#     RCC-argv-7 (an unrecognized flag is today silently IGNORED, not rejected)
#     and RCC-caps-1/RCC-caps-2 (the 2048-byte path-token and 131072-byte
#     total-argv caps are not yet checked proactively before decode -- today's
#     rejections instead come from a lower-level crash (INTERNAL/rc7) or a
#     downstream per-field schema cap (SCHEMA_INVALID), respectively).
#   - CLI-RESULT-04 (UNAVAILABLE/DRIVER_UNAVAILABLE): `dispatch` does not exist yet,
#     so there is no way to empirically confirm the exact precondition that
#     produces "no available driver". This test's precondition (a published
#     request in a coordination root with no further driver/capability setup
#     beyond root-init) is this file's own reasonable inference, not a literal
#     PLAN quote.
#   - CLI-RESULT-08 (CONFLICT/RESULT_CONFLICT): grounded in the `cancel` row's own
#     text ("publish cancel.json and conflict diagnostic when required") -- calling
#     `cancel` twice for the same request with two DIFFERENT `--reason` values is
#     this file's chosen trigger for that "conflict diagnostic". The exact status
#     label (CONFLICT, as opposed to some other rc6 member) is a reasonable
#     inference from the word "conflict" appearing in the row text itself.
#   - CLI-RESULT-09 (INTERNAL/INTERNAL_ERROR): no PLAN text names a specific
#     internal-failure trigger. This test uses a permission-denied coordination-root
#     parent (chmod 555) as a portable OS-level "unexpected failure" proxy, distinct
#     from a caller-argument-shape problem (INVALID) or a routing/driver problem
#     (UNAVAILABLE). Best-effort; may need adjustment once WP2/the real
#     internal-error surface is known.
#   - driver enum values (`claude-sendmessage|claude-agent|runtime-spawn|
#     codex-app-server|codex-mcp|noop`) are assembled from cross-references
#     throughout PLAN.md (record-delivery's own row plus the ActivationAction
#     union arms), not one single enumerated list.
#   - publish-result's "exact two native-target forms frozen below" (PLAN.md
#     ~L767) are not located in the ranges read for this task -- deep per-form
#     publish-result argv is left to WP3/a dedicated publish-result test file.
#     This file only proves publish-result-the-subcommand is recognized once WP2
#     lands (RCC-newverb-publish-result), using only the two flags common to every
#     other transaction-scoped command (`--coordination-root --request`).
#
# Invocation: bats scripts/tests/runtime-consultation-cli.bats (from repo root), or
# scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-consultation-cli.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
WAVE_SLUG="rcc-test-wave"
MAX_DEPTH=2
# "Harness-created" test capability (PLAN.md ~L752-753, ~L796).
TEST_CAPABILITY="bats-runtime-consultation-cli-fixture-capability"
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
  printf '# Fixture PLAN for runtime-consultation-cli.bats\n\nThrowaway per-test fixture -- not the real Wave 1 PLAN.md.\n' > "$PLAN_FILE"
  PLAN_DIGEST="$(_sha256_file "$PLAN_FILE")"

  SUBJECT_BUNDLE_FILE="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  _write_subject_bundle "$SUBJECT_BUNDLE_FILE" '{}'

  _ID_COUNTER=0

  # Best-effort root init; several tests below re-init their own fresh root, but a
  # pre-initialized $COORD_ROOT keeps request/result-fixture-only tests simple.
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" root-init --coordination-root "$COORD_ROOT" >/dev/null 2>&1 || true
}

teardown() {
  chmod -R u+rwx "$PROJ" 2>/dev/null || true
  rm -rf "$PROJ"
}

# ── Generic helpers (same idiom as runtime-consultation-protocol.bats) ──────

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
  _sha256_string "rcc-fixture-id-$$-${_ID_COUNTER}-${RANDOM}-${RANDOM}"
}

# 128-bit (32 lowercase-hex-char) ID -- record #12's stop_id is explicitly 128-bit,
# unlike the 256-bit request_id/attempt_id ids used elsewhere in this suite.
_gen_hex_id_32() {
  _gen_hex_id | cut -c1-32
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

# Portable "base ISO timestamp + N seconds" -- GNU -d first, BSD/macOS -j -f
# fallback (mirrors the sha256sum||shasum idiom used throughout this repo's bats
# suites).
_iso_plus_seconds() {
  local base="$1" n="$2"
  date -u -d "${base} +${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null && return
  date -j -f '%Y-%m-%dT%H:%M:%SZ' "${base}" -v"+${n}S" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
}

_now_iso() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

# Frozen-base-relative ISO timestamp: the CLI's own `--fixed-clock` default base
# (`2025-01-01T00:00:00.000Z`, RUNTIME_CONSULTATION_FAKE_CLOCK not overridden by
# this file) plus N milliseconds, computed entirely via node -- never shell
# `date`/`_iso_plus_seconds`. `--fixed-clock` is now genuinely wired (WP2
# fake-clock/fixed-ids seam): `nowIso()` freezes every emitted `created_at` to
# that exact base under `--fixed-clock`, so a `consult/v2` fixture's `expiry`
# must be computed relative to THAT frozen base (not real wall-clock time) to
# satisfy `CONSULT_V2_FIELDS.expiry.check`'s `120 <= (expiry-created_at) <=
# 3600` window. Node (not shell `date`) also sidesteps the documented
# BSD/macOS `date -j` fallback bug in `_iso_plus_seconds`
# (`runtime-consultation-cli.test.js`'s own header note: `-v"+${n}S"` placed
# after the positional date string is silently mis-parsed on this machine's
# `/bin/date`). Same idiom as runtime-consultation-protocol.bats's own
# `_frozen_iso_plus_ms`.
_frozen_iso_plus_ms() {
  node -e 'process.stdout.write(new Date(Date.parse("2025-01-01T00:00:00.000Z") + Number(process.argv[1])).toISOString())' "$1"
}

# base64url-encodes stdin -- same Node primitive the real implementation will use
# for the CLI ABI's `--intent` flag (see runtime-consultation-protocol.bats).
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

_result_path() {
  local id="$1" attempt="$2"
  printf '%s' "$(_plan_root)/transactions/$id/results/$attempt.json"
}

_stop_path() {
  local role="$1" wsid="$2" stop_id="$3"
  printf '%s' "$(_plan_root)/workers/$role/$wsid/stops/$stop_id.json"
}

# ── JSON fixture builders (same override/__OMIT__ idiom as
# runtime-consultation-protocol.bats's _write_request/_write_result). Unlike that
# file (which intentionally uses a fixed historical created_at/expiry pair for
# STRUCTURAL lifetime-boundary testing against the read-only `validate` verb),
# every builder here stamps created_at/expiry freshly at call time -- several
# tests below drive LIVE operational verbs (cancel/accept-result/await-result/
# dispatch), not just static `validate`, and a stale-by-real-wall-clock fixture
# risks failing those for the wrong reason (actual expiry) instead of the
# reason under test. ──────────────────────────────────────────────────────────

_write_request() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  local created_at expiry
  created_at="$(_now_iso)"
  expiry="$(_iso_plus_seconds "$created_at" 1800)"
  RCC_REPO_ID="$REPO_ID" RCC_WAVE_SLUG="$WAVE_SLUG" RCC_PLAN_DIGEST="$PLAN_DIGEST" \
  RCC_COORD_ROOT_ID="$COORD_ROOT_ID" RCC_WORKTREE_ID="$WORKTREE_ID" RCC_SUBJECT_HEAD="$SUBJECT_HEAD" \
  RCC_CREATED_AT="$created_at" RCC_EXPIRY="$expiry" \
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
      requester_worktree_id: e.RCC_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.RCC_REPO_ID,
      wave_slug: e.RCC_WAVE_SLUG,
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: e.RCC_COORD_ROOT_ID,
      plan_digest: e.RCC_PLAN_DIGEST,
      subject_repo_id: e.RCC_REPO_ID,
      subject_worktree_id: e.RCC_WORKTREE_ID,
      subject_head: e.RCC_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "default cli-conformance fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.RCC_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.RCC_CREATED_AT
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
  local created_at; created_at="$(_now_iso)"
  RCC_REPO_ID="$REPO_ID" RCC_WAVE_SLUG="$WAVE_SLUG" RCC_PLAN_DIGEST="$PLAN_DIGEST" \
  RCC_WORKTREE_ID="$WORKTREE_ID" RCC_SUBJECT_HEAD="$SUBJECT_HEAD" RCC_CREATED_AT="$created_at" \
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const e = process.env;
    const defaults = {
      schema: "coordination/result/v2",
      in_reply_to: "a".repeat(64),
      request_digest: "0".repeat(64),
      plan_digest: e.RCC_PLAN_DIGEST,
      repo_id: e.RCC_REPO_ID,
      wave_slug: e.RCC_WAVE_SLUG,
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
      content: "a cli-conformance fixture answer",
      subject_repo_id: e.RCC_REPO_ID,
      subject_worktree_id: e.RCC_WORKTREE_ID,
      subject_head: e.RCC_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      consultation_dependencies: [],
      producer_worktree_id: e.RCC_WORKTREE_ID,
      producer_head: e.RCC_SUBJECT_HEAD,
      created_at: e.RCC_CREATED_AT
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

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

# `stop/v2` fixture builder (record #12, PLAN.md ~L506-519) -- used only by the
# worker-stop-ack RED case (worker-stop itself is a WP2-new verb, so a real stop
# record cannot yet be produced through the CLI).
_write_stop() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  local now expiry
  now="$(_now_iso)"
  expiry="$(_iso_plus_seconds "$now" 300)"
  RCC_NOW="$now" RCC_EXPIRY="$expiry" node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const e = process.env;
    const defaults = {
      schema: "coordination/stop/v2",
      stop_id: "9".repeat(32),
      kind: "session-shutdown",
      target_role: "test-specialist",
      worker_session_id: "8".repeat(32),
      request_id: null,
      attempt_id: null,
      lease_epoch: null,
      expiry: e.RCC_EXPIRY,
      requested_at: e.RCC_NOW
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# ── CLI invocation + assertion helpers ───────────────────────────────────────

# Generic invocation under the test capability (NODE_ENV=test +
# RUNTIME_CONSULTATION_TEST_CAPABILITY) -- used for every case that is not
# deliberately testing production (non-test-capability) behavior.
_run_cli() {
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" "$@"
}

# Invokes with no test-capability env at all -- used by the determinism-gate cases
# that must prove production (non-test) argv is rejected. `-u` clears any leaked
# ambient NODE_ENV/RUNTIME_CONSULTATION_TEST_CAPABILITY/RUNTIME_CONSULTATION_ACL_PROBE
# from the outer shell so the case is a genuine production invocation regardless of
# caller environment.
_run_cli_production() {
  run --separate-stderr env -u NODE_ENV -u RUNTIME_CONSULTATION_TEST_CAPABILITY -u RUNTIME_CONSULTATION_ACL_PROBE \
    node "$IMPL" "$@"
}

# Parses the most recent `run`/`run --separate-stderr` invocation's captured
# stdout ($output) as the frozen coordination/cli-result/v1 envelope (PLAN.md
# ~L779-781) and asserts: exactly the closed key set (additionalProperties:false),
# literal schema, the given expected status, ok/status consistency, and (when
# expected_detail is non-empty) the given expected detail_code. Pass "" for
# expected_detail to skip that specific check (used where this file's own header
# comment documents the exact detail_code as a reasonable inference, not certain).
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

# Asserts $output (the most recent `run`'s stdout) is exactly one JSON object plus
# a trailing newline -- no prose/second line/BOM (Frozen CLI ABI, PLAN.md ~L779:
# "stdout contains that one object + newline").
_assert_stdout_single_json_line() {
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
  local first_bytes; first_bytes="$(printf '%s' "$output" | head -c3 | od -An -tx1 | tr -d ' \n')"
  [ "$first_bytes" != "efbbbf" ]
}

# Asserts $stderr (the most recent `run --separate-stderr`'s captured stderr)
# never carries a bare JSON object (PLAN.md ~L779: "stderr contains bounded
# diagnostics with no JSON/secrets"). Empty stderr trivially passes.
_assert_stderr_no_json() {
  if [ -z "$stderr" ]; then
    return 0
  fi
  node -e '
    try {
      JSON.parse(process.argv[1]);
      console.error("stderr parsed as JSON -- must be diagnostics only");
      process.exit(1);
    } catch (err) {
      process.exit(0);
    }
  ' "$stderr"
}

# ══════════════════════════════════════════════════════════════════════════
# coordination/cli-result/v1 -- closed status/rc/detail_code mapping, one case
# per status member (Frozen CLI ABI, PLAN.md ~L779-781). Enum order matches the
# PLAN's own literal order: SUCCESS|USAGE_ERROR|INVALID|UNAVAILABLE|TIMEOUT|
# BLOCKED|CANCELLED|CONFLICT|INTERNAL.
# ══════════════════════════════════════════════════════════════════════════

@test "CLI-RESULT-01 SUCCESS: root-init on a fresh coordination root prints status SUCCESS/rc0" {
  local fresh_root="$PROJ/.planning/coordination-fresh-01"
  _run_cli root-init --coordination-root "$fresh_root"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-02 USAGE_ERROR: an unrecognized subcommand prints status USAGE_ERROR/rc2/UNKNOWN_COMMAND" {
  _run_cli totally-not-a-real-subcommand-xyz
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "UNKNOWN_COMMAND"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-03 INVALID: production use of --fixed-ids/--fixed-clock (no test capability) prints status INVALID/rc3/INVALID_ARGUMENT" {
  local now expiry intent intent_b64
  now="$(_now_iso)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"CLI-RESULT-03 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  _run_cli_production publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-04 UNAVAILABLE: dispatch with no available driver prints status UNAVAILABLE/rc4/DRIVER_UNAVAILABLE (RED -- dispatch verb absent, see header interpretive-decision note)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli dispatch --coordination-root "$COORD_ROOT" --request "$f"
  [ "$status" -eq 4 ]
  _assert_cli_result "UNAVAILABLE" "DRIVER_UNAVAILABLE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-05 TIMEOUT: await-result on a request with no candidate result prints status TIMEOUT/rc5/DEADLINE_EXCEEDED once the bounded poll elapses." {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$f" --timeout 1
  [ "$status" -eq 5 ]
  _assert_cli_result "TIMEOUT" "DEADLINE_EXCEEDED"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-06 BLOCKED: await-result observing a current BLOCKED result/v2 candidate prints status BLOCKED/rc6/RESULT_BLOCKED." {
  local id; id="$(_gen_hex_id)"
  local attempt; attempt="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$attempt")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"

  local result_f; result_f="$(_result_path "$id" "$attempt")"
  # result/v2 field table (PLAN.md ~L426-429): result_kind is literal BLOCKED when
  # status is BLOCKED, reason is REQUIRED (one of the closed reason enum), and
  # content/content_ref are both omitted (BLOCKED requires neither key).
  # root_request_id is overridden to match the request's own $id -- _write_result's
  # default (64 'a' chars) does not correlate with a request whose own
  # root_request_id was itself overridden to a fresh generated id.
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"BLOCKED","result_kind":"BLOCKED","reason":"POLICY_DENIED","content":"__OMIT__"}' "$id" "$id" "$req_digest" "$attempt")"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req_f" --timeout 1
  [ "$status" -eq 6 ]
  _assert_cli_result "BLOCKED" "RESULT_BLOCKED"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-07 CANCELLED: accept-result against an already-cancelled transaction prints status CANCELLED/rc6/TRANSACTION_CANCELLED." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req_f"
  [ "$status" -eq 6 ]
  _assert_cli_result "CANCELLED" "TRANSACTION_CANCELLED"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-08 CONFLICT: a second cancel with a different --reason for the same request prints status CONFLICT/rc6/RESULT_CONFLICT." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason expired
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  # cancel.json is exclusive-create/immutable (Namespace tree, PLAN.md ~L619); a
  # second cancel naming a DIFFERENT --reason for the same request is this file's
  # chosen trigger for the row's own literal "conflict diagnostic when required".
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 6 ]
  _assert_cli_result "CANCELLED" "TRANSACTION_CANCELLED"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "CLI-RESULT-09 INTERNAL: root-init under a permission-denied parent is rejected with a well-formed envelope (best-effort OS-failure proxy -- see header interpretive-decision note)" {
  local locked_parent="$PROJ/.planning/coordination-locked-parent"
  mkdir -p "$locked_parent"
  chmod 555 "$locked_parent"

  _run_cli root-init --coordination-root "$locked_parent/nested-root"
  local exit_status="$status"

  chmod 755 "$locked_parent"

  # Not running as root -- chmod 555 must actually block the write for this case
  # to be meaningful; a privileged runner would bypass the permission denial
  # entirely (unrelated to this file's own contract), so skip rather than
  # false-fail/false-pass in that environment.
  if [ "$exit_status" -eq 0 ]; then
    skip "test runner has root/bypass privileges -- permission-denied precondition did not hold"
  fi

  # rc7/INTERNAL is this file's primary guess; rc3/INVALID with SECURITY_INVALID
  # is accepted as equally plausible since ACL/permission validation is this
  # system's own extensively-anticipated domain (Namespace & Root Security), not
  # necessarily an "unexpected internal" condition -- see header note.
  case "$exit_status" in
    7) _assert_cli_result "INTERNAL" "" ;;
    3) _assert_cli_result "INVALID" "SECURITY_INVALID" ;;
    *) false ;;
  esac
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

# ══════════════════════════════════════════════════════════════════════════
# Argv grammar -- unknown/missing/duplicate/invalid argument, order-independence,
# positional operands, unknown flags (Frozen CLI ABI, PLAN.md ~L752, ~L781; see
# this file's header for the USAGE_ERROR-vs-INVALID interpretive split).
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-argv-1 FAIL: root-init with no --coordination-root at all is rejected as USAGE_ERROR/rc2/MISSING_ARGUMENT" {
  _run_cli root-init
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "MISSING_ARGUMENT"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "RCC-argv-2 FAIL: root-init with --coordination-root supplied twice is rejected as USAGE_ERROR/rc2/DUPLICATE_ARGUMENT with no write (each flag appears exactly once, PLAN.md ~L752)" {
  local root_a="$PROJ/.planning/coordination-dup-a"
  local root_b="$PROJ/.planning/coordination-dup-b"
  _run_cli root-init --coordination-root "$root_a" --coordination-root "$root_b"
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "DUPLICATE_ARGUMENT"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
  [ ! -e "$root_a" ]
  [ ! -e "$root_b" ]
}

@test "RCC-argv-3 FAIL: transaction-ack --disposition outside the closed accepted|blocked enum is rejected as USAGE_ERROR/rc2/INVALID_ARGUMENT" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  _run_cli transaction-ack --coordination-root "$COORD_ROOT" --request "$f" --disposition not-a-real-disposition
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "RCC-argv-4 FAIL: cancel --reason outside the closed expired|explicit|invalid-takeover-exhaustion|conflict enum is rejected as USAGE_ERROR/rc2/INVALID_ARGUMENT" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$f" --reason not-a-real-reason
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "RCC-argv-5 PASS: accept-result's two required flags are order-independent (identical envelope forward vs swapped, PLAN.md ~L752: 'Long options are order-independent')" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$f"
  local forward_output="$output" forward_status="$status"

  _run_cli accept-result --request "$f" --coordination-root "$COORD_ROOT"
  local swapped_output="$output" swapped_status="$status"

  [ "$forward_status" -eq "$swapped_status" ]
  [ "$forward_output" = "$swapped_output" ]
}

@test "RCC-argv-6 FAIL: a positional operand instead of --coordination-root <path> is rejected as USAGE_ERROR/rc2/INVALID_ARGUMENT (no positional operands exist, PLAN.md ~L752)" {
  local fresh_root="$PROJ/.planning/coordination-positional"
  _run_cli root-init "$fresh_root"
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  [ ! -e "$fresh_root" ]
}

@test "RCC-argv-7 FAIL: an unrecognized flag is rejected (the grammar is closed -- only the frozen flags per subcommand exist, PLAN.md ~L752). CURRENTLY RED FOR A REAL REASON, not just WP2-verb absence: empirically, today's root-init SILENTLY IGNORES an unrecognized --totally-unknown-flag and still returns SUCCESS/rc0 -- the closed-grammar contract ('No short aliases, positional operands, ... exist') is not yet enforced for extra/unknown flags. This assertion encodes the CORRECT target (USAGE_ERROR/rc2, by analogy with RCC-argv-1..4/6's confirmed pattern for argv-grammar problems), not current behavior." {
  local fresh_root="$PROJ/.planning/coordination-unknown-flag"
  _run_cli root-init --coordination-root "$fresh_root" --totally-unknown-flag foo
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  [ ! -e "$fresh_root" ]
}

# ══════════════════════════════════════════════════════════════════════════
# WP2-new verb argv-grammar recognition (RED until WP2 lands). `dispatch` itself
# is already exercised above by CLI-RESULT-04; this section covers the remaining
# 5: record-delivery, publish-blob, publish-result, worker-stop, worker-stop-ack.
# ══════════════════════════════════════════════════════════════════════════

# Asserts the most recent invocation's envelope is NOT the "subcommand
# unrecognized" shape -- the target contract once WP2 lands for each verb below.
# Deliberately does not assert full success (that needs deeper preconditions --
# e.g. a real activation/v1 or a genuinely staged publish-blob entry -- out of
# this file's CLI-CONTRACT scope, see header).
_assert_not_unknown_command() {
  node -e '
    let data;
    try {
      data = JSON.parse(process.argv[1]);
    } catch (err) {
      console.error("stdout is not valid JSON: " + err.message);
      process.exit(1);
    }
    if (data.detail_code === "UNKNOWN_COMMAND") {
      console.error("subcommand still unrecognized (status=" + data.status + " detail_code=" + data.detail_code + ")");
      process.exit(1);
    }
  ' "$output"
}

@test "RCC-newverb-record-delivery RED: record-delivery is not yet a recognized subcommand" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local attempt; attempt="$(_gen_hex_id)"

  _run_cli record-delivery --coordination-root "$COORD_ROOT" --request "$f" --attempt "$attempt" \
    --epoch 0 --driver claude-sendmessage --outcome possibly-delivered --commit-point sendmessage-returned
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-record-delivery-rejects-noop RED: record-delivery for the noop driver is rejected once WP2 lands (PLAN.md ~L779: 'Requester record-delivery is rejected for either Codex branch or noop')" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local attempt; attempt="$(_gen_hex_id)"

  _run_cli record-delivery --coordination-root "$COORD_ROOT" --request "$f" --attempt "$attempt" \
    --epoch 0 --driver noop --outcome noop --commit-point none
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"
}

@test "RCC-newverb-publish-blob RED: publish-blob is not yet a recognized subcommand" {
  _run_cli publish-blob --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$SUBJECT_BUNDLE_FILE" --entry fixture-entry.txt
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-publish-result RED: publish-result is not yet a recognized subcommand (only the two flags common to every other transaction-scoped command are asserted here -- see header note on the un-located two-native-target-form sub-table)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli publish-result --coordination-root "$COORD_ROOT" --request "$f" --claim "$COORD_ROOT/nonexistent-claim.json" --content "$(printf 'fixture content' | _base64url_encode)"
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-worker-stop-session RED: worker-stop --kind session-shutdown (no --request) is not yet a recognized subcommand" {
  local wsid; wsid="$(_gen_hex_id_32)"
  _run_cli worker-stop --coordination-root "$COORD_ROOT" --role test-specialist --worker-session "$wsid" --kind session-shutdown
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-worker-stop-transaction RED: worker-stop --kind transaction (with --request, per the conditional grammar) is not yet a recognized subcommand" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local wsid; wsid="$(_gen_hex_id_32)"

  _run_cli worker-stop --coordination-root "$COORD_ROOT" --role arch-testing --worker-session "$wsid" --kind transaction --request "$f"
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-worker-stop-ack RED: worker-stop-ack is not yet a recognized subcommand" {
  local role="test-specialist"
  local wsid; wsid="$(_gen_hex_id_32)"
  local stop_id; stop_id="$(_gen_hex_id_32)"
  local stop_f; stop_f="$(_stop_path "$role" "$wsid" "$stop_id")"
  _write_stop "$stop_f" "$(printf '{"stop_id":"%s","target_role":"%s","worker_session_id":"%s"}' "$stop_id" "$role" "$wsid")"

  _run_cli worker-stop-ack --coordination-root "$COORD_ROOT" --stop "$stop_f" --disposition session-shutdown
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

# ══════════════════════════════════════════════════════════════════════════
# Portable argv caps (Frozen CLI ABI, PLAN.md ~L754): each path token is at most
# 2048 UTF-8 bytes / 2048 UTF-16 code units; the complete post-hook argv is at
# most 131072 UTF-8 bytes on POSIX. Core checks caps BEFORE decode/allocation.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-caps-1 FAIL: a --coordination-root path token exceeding 2048 UTF-8 bytes is rejected as INVALID/rc3/INVALID_ARGUMENT with no write. CURRENTLY RED FOR A REAL REASON: empirically, today's implementation does not check this cap proactively -- the oversized path instead propagates to a lower-level failure caught generically as INTERNAL/rc7 (no write still occurs either way, but not via the clean pre-decode rejection PLAN.md ~L754 mandates: 'Core checks caps before decode/allocation'). This assertion encodes the spec-mandated target, not current behavior." {
  local base="$PROJ/.planning/coordination-caps"
  local padding; padding="$(head -c 2100 /dev/zero | tr '\0' 'x')"
  local oversized_root="$base/$padding"
  # Sanity: the constructed token really does exceed the 2048-byte cap.
  [ "${#oversized_root}" -gt 2048 ]

  _run_cli root-init --coordination-root "$oversized_root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  [ ! -e "$base" ]
}

@test "RCC-caps-2 FAIL: total post-hook argv exceeding 131072 UTF-8 bytes (POSIX) is rejected as INVALID/rc3/INVALID_ARGUMENT with no write. CURRENTLY RED FOR A REAL REASON: empirically, today's implementation does not appear to check the total-argv cap proactively either -- this exact oversized intent is instead rejected as SCHEMA_INVALID (the downstream per-field question<=8192-byte cap firing after decode), not INVALID_ARGUMENT before decode as PLAN.md ~L754 mandates. No write occurs either way; this assertion encodes the spec-mandated target, not current behavior." {
  local now expiry huge_question intent intent_b64
  now="$(_now_iso)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  # Comfortably over the 131072-byte total-argv budget once wrapped in the intent
  # JSON envelope and base64url-encoded -- checked BEFORE decode/allocation, so
  # this need not itself be a schema-valid question.
  huge_question="$(head -c 140000 /dev/zero | tr '\0' 'q')"
  intent="$(printf '{"target_role":"arch-testing","question":"%s","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$huge_question" "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  _run_cli publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"

  # --fixed-ids makes the would-be request_id deterministic (DEFAULT_REQUEST_ID) --
  # confirm the oversized-argv call performed no write at all.
  local would_be_path; would_be_path="$(_request_path "$DEFAULT_REQUEST_ID")"
  [ ! -e "$would_be_path" ]
}

# ══════════════════════════════════════════════════════════════════════════
# Determinism / test-capability gating (Frozen CLI ABI, PLAN.md ~L752):
# --fixed-ids, --fixed-clock, the closed bridge fixture flags, and
# RUNTIME_CONSULTATION_ACL_PROBE are accepted only with NODE_ENV=test PLUS the
# harness-created RUNTIME_CONSULTATION_TEST_CAPABILITY -- both conditions are
# independently necessary (an AND, not an OR). CLI-RESULT-03 above already
# covers the fully-production (neither set) case; this section covers the two
# partial-condition cases plus the positive (both-set) case and the separately
# named RUNTIME_CONSULTATION_ACL_PROBE flag.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-determinism-1 FAIL: RUNTIME_CONSULTATION_TEST_CAPABILITY alone (NODE_ENV not test) does not satisfy the gate -- --fixed-ids is still rejected as rc3" {
  local now expiry intent intent_b64
  now="$(_now_iso)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCC-determinism-1 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env -u NODE_ENV RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"
}

@test "RCC-determinism-2 FAIL: NODE_ENV=test alone (no RUNTIME_CONSULTATION_TEST_CAPABILITY) does not satisfy the gate -- --fixed-ids is still rejected as rc3" {
  local now expiry intent intent_b64
  now="$(_now_iso)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCC-determinism-2 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  # NOTE: `-u NAME` MUST precede any NAME=VALUE assignment in a single `env`
  # invocation -- BSD/macOS env stops option parsing at the first assignment and
  # treats a later `-u` as the utility to exec (confirmed empirically: `env
  # NODE_ENV=test -u FOO node ...` fails with "env: -u: No such file or
  # directory", NOT a clean CLI rejection). This is the same option-before-
  # assignment order already used by RCC-determinism-1 and _run_cli_production.
  run --separate-stderr env -u RUNTIME_CONSULTATION_TEST_CAPABILITY NODE_ENV=test \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"
}

@test "RCC-determinism-3 PASS: --fixed-ids/--fixed-clock under the full test capability (both NODE_ENV=test and RUNTIME_CONSULTATION_TEST_CAPABILITY) succeeds" {
  local expiry intent intent_b64
  # Frozen-base-relative (not real-now-relative): this call passes
  # --fixed-clock, which genuinely freezes created_at to the CLI's default
  # frozen base -- see _frozen_iso_plus_ms's own header note. A single
  # publish-request call (no second call in this test), so Finding D3's
  # distinct-id concern does not apply here.
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCC-determinism-3 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  _run_cli publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCC-determinism-4 FAIL: production use of RUNTIME_CONSULTATION_ACL_PROBE (no test capability) is rejected as rc3 (PLAN.md ~L752 lists it under the same gate as --fixed-ids/--fixed-clock)" {
  run --separate-stderr env -u NODE_ENV -u RUNTIME_CONSULTATION_TEST_CAPABILITY RUNTIME_CONSULTATION_ACL_PROBE=1 \
    node "$IMPL" root-validate --coordination-root "$COORD_ROOT"

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" ""
}

# ══════════════════════════════════════════════════════════════════════════
# stdout/stderr shape (Frozen CLI ABI, PLAN.md ~L779: "stdout contains that one
# object + newline; stderr contains bounded diagnostics with no JSON/secrets").
# Already woven into most cases above via _assert_stdout_single_json_line /
# _assert_stderr_no_json; this section names the property explicitly for both a
# successful and a rejected invocation.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-stdout-1: stdout is exactly one JSON object plus newline (no BOM) and stderr carries no JSON, for both a successful and a rejected invocation" {
  local fresh_root="$PROJ/.planning/coordination-stdout-1"
  _run_cli root-init --coordination-root "$fresh_root"
  [ "$status" -eq 0 ]
  _assert_stdout_single_json_line
  _assert_stderr_no_json

  _run_cli another-totally-unknown-subcommand-abc
  [ "$status" -ne 0 ]
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}
