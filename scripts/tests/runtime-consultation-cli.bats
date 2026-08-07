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
# STATUS (current, exact -- verify with `bats --count` / `bats -t` rather than
# trusting this line as it ages, see this file's own git-log-adjacent
# MUTATION-LEDGER.md for the mutation-testing evidence behind every fix):
# 94 passing + 1 explicitly `skip`'d = 95 total `^ok ` lines (a skip is ALSO
# an `^ok ` line per TAP convention -- it is not a separate, additional
# category to sum on top), 0 `not ok`. The skip is
# `CLI-RESULT-08`, the closed status enum's CONFLICT/
# rc6/RESULT_CONFLICT case (PLAN.md ~L789) -- DESIGN-BLOCKED, not faked and not
# silently folded into another case: no authorized production path yet exists
# to generate a genuine conflict distinct from an ordinary CANCELLED without a
# PLAN/schema decision (see that test's own `skip` message for the precise
# reason, and .planning/wave-portable-runtime-messaging-adapters/CONFLICT-DESIGN-R12.1.md
# -- an ESCALATION, not a design proposal, superseding R12: a HARD NO-GO found
# R12's own scope too narrow -- the "different candidate" question is broader
# than a same-attempt collision, and R12's two named alternatives were neither
# mutually exclusive nor complete. This track is STOPPED pending a single
# planner-backed decision across R12.1's own full list of coupled
# sub-questions, not further unilateral design).
# `RCC-cancel-confused-deputy-*` (4 tests) and the `RCC-cancel-{out-of-root,
# wrong-filename,cross-root,writer-*,cancelled-by-authority-mismatch}-*` tests
# below (6 tests) together verify every cancel.json reader (`cmdAwaitResult`,
# `cmdAcceptResult`, `cmdCancel`'s own already-cancelled check, `validateCancelV1`)
# and `cmdCancel`'s own writer independently enforce full canonical identity --
# exact filename, confinement under `--coordination-root`, a genuinely
# containing request.json, matching `request_id`, and `cancelled_by`
# CORRELATION against an identity already recorded in the request (PENDING_WP4:
# this is not cryptographic or grant-based authority that the caller is
# entitled to invoke the command at all -- PLAN.md's `role-command-grant/v1`,
# ~L580-592, is the real, unimplemented authority mechanism; see
# `accreditCancelRecord`'s own doc comment) -- rather than trusting mere path
# co-location or a bare shape check. See `accreditCancelRecord` in
# runtime-consultation.cjs (the single, shared accreditation chain every
# reader and writer routes through).
#
# This file went through several correction rounds in one session (multiple
# NO-GO/DESIGN-STOP cycles: a shared BSD-date fixture-bug fix, a rejected
# caller-driven CONFLICT fabrication, a rejected validateResultV2
# authority-fence bypass, and the cancel.json confused-deputy fix above). Per
# this project's own "history lives in git log, not in active docs"
# convention, that blow-by-blow narrative is NOT reproduced here -- it lives in
# git log/commit messages and the session transcript, where it won't go stale
# the next time this file changes. Every test targets the frozen ABI text
# as its goal, never adjusted to match an observed gap.
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
#     after basic argv grammar already passed. RCC-argv-7 (an unrecognized flag)
#     and RCC-caps-1/RCC-caps-2 (the 2048-byte path-token and 131072-byte
#     total-argv caps) were found RED against an earlier version of the
#     production implementation -- an unrecognized flag was silently IGNORED
#     rather than rejected, and both caps were enforced only downstream
#     (INTERNAL/rc7 and SCHEMA_INVALID respectively) rather than proactively
#     before decode. All three gaps have since been closed in
#     runtime-consultation.cjs and all three tests are current, genuine GREEN
#     (empirically re-verified, not merely inferred from a passing run) --
#     their own per-test comments are historical explanation of why each
#     assertion has this exact shape, not a claim that the gap still exists.
#   - CLI-RESULT-04 (UNAVAILABLE/DRIVER_UNAVAILABLE): `cmdDispatch`
#     (runtime-consultation.cjs) confirms this test's precondition empirically:
#     a published request in a coordination root that was only `root-init`'d
#     (no `routing-policies/<digest>.json` ever materialized for the plan-root)
#     is exactly the condition `cmdDispatch` treats as the legitimate "no driver
#     available" signal, throwing UNAVAILABLE/DRIVER_UNAVAILABLE before any
#     driver selection is attempted.
#   - CLI-RESULT-08 (CONFLICT/RESULT_CONFLICT) -- currently `skip`'d, DESIGN-
#     BLOCKED. PLAN.md record #10 ("Conflict diagnostic", ~L484-492) and the
#     Transition State Table (~L702) agree the underlying TRANSACTION state is
#     CANCELLED for both explicit and conflict reasons alike -- `cmdCancel`'s
#     write-side behavior needs no change. But PLAN.md ~L789's closed status
#     enum separately names CONFLICT, and the Ordered Runtime Loop's Failure
#     clause (~L831, "Conflicting current results -> cancel/v1 + harness
#     STOP/report") mirrors the already-implemented TIMEOUT/BLOCKED cases'
#     phrasing -- so a distinct, observable CONFLICT signal is mandatory
#     conformance coverage, not an optional nice-to-have. What is NOT yet
#     settled: WHERE it is legitimately detected. The real production write
#     path, `cmdPublishResult`, publishes to the single `results/<attempt_id>.json`
#     path for the one current `(attempt_id, lease_epoch)`; a second, differing
#     write today just loses the no-clobber race as a generic rejection, with
#     no recorded evidence of what the losing candidate claimed. Manufacturing
#     the scenario caller-side instead (a `cancel --reason conflict` call plus
#     counting distinct result filenames, which two DIFFERENT attempts --
#     e.g. across a takeover -- naturally produce) was tried twice in this
#     file's history and rejected both times: it cannot be evidenced without
#     either trusting an unverified caller claim or bypassing the single-
#     current-attempt authority fence `validateResultV2` exists to enforce.
#     Fixing this requires a decision on where the true race is linearized
#     (under `cmdPublishResult`'s existing transition lock) and whether the
#     `conflict/v1` schema (currently two separate attempt-identifying fields,
#     `attempt_id`/`other_attempt_id`, sized for two different ATTEMPTS rather
#     than "one attempt, two competing byte-streams") needs to change --
#     tracked as a pending design item, not implemented here.
#   - CLI-RESULT-09 (INTERNAL/INTERNAL_ERROR): no PLAN text names a specific
#     internal-failure trigger. This test uses a permission-denied coordination-root
#     parent (chmod 555) as a portable OS-level "unexpected failure" proxy, distinct
#     from a caller-argument-shape problem (INVALID) or a routing/driver problem
#     (UNAVAILABLE). Best-effort; may need adjustment if a more specific
#     internal-error surface is later named by PLAN.
#   - driver enum values (`claude-sendmessage|claude-agent|runtime-spawn|
#     codex-app-server|codex-mcp|noop`) are assembled from cross-references
#     throughout PLAN.md (record-delivery's own row plus the ActivationAction
#     union arms), not one single enumerated list.
#   - publish-result's "exact two native-target forms frozen below" (PLAN.md
#     ~L767) are not located in the ranges read for this task -- deep per-form
#     publish-result argv is left to WP3/a dedicated publish-result test file.
#     This file only proves publish-result-the-subcommand is recognized
#     (RCC-newverb-publish-result), using only the two flags common to every
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
#
# CORRECTION (WP2 CLI-conformance debt pass): `-v"+${n}S"` MUST precede `-f
# '%Y-%m-%dT%H:%M:%SZ' "${base}"` in the BSD/macOS branch. Placed after (the
# prior ordering), BSD `date` silently ignores BOTH the `-v` adjustment and the
# trailing output format -- it exits 0 and prints its OWN default ctime-style
# string (e.g. "Wed Jul 22 09:06:48 CEST 2026") unchanged from the input time,
# instead of erroring. That non-ISO, non-advanced string then fails
# `CONSULT_V2_FIELDS.expiry.check` (runtime-consultation.cjs `isIsoTimestamp`)
# wherever `_write_request`/`_write_stop` used it, which is exactly what made
# CLI-RESULT-04/05/06/07/08, RCC-argv-3/4, and
# RCC-newverb-record-delivery-rejects-noop fail with SCHEMA_INVALID before ever
# reaching the branch each test actually names -- a stale/broken FIXTURE, not a
# production defect (each target `cmdDispatch`/`cmdAwaitResult`/`cmdCancel`/
# `cmdTransactionAck`/`cmdRecordDelivery` guard was already correct and is
# unchanged by this fix). Empirically confirmed on this machine's `/bin/date`
# (BSD); GNU `date -d` (tried first, above) is unaffected either way.
_iso_plus_seconds() {
  local base="$1" n="$2"
  date -u -d "${base} +${n} seconds" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null && return
  date -j -v"+${n}S" -f '%Y-%m-%dT%H:%M:%SZ' "${base}" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
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

# Portable node-based inode read (no shell `stat`); identical helper to
# runtime-consultation-state.bats's own `_inode_of`. The prior
# `stat -f '%i' "$f" 2>/dev/null || stat -c '%i' "$f"` substitution was invalid under
# the PLAN-mandated GNU userland: GNU `stat -f` is --file-system, so BOTH '%i' and
# "$f" are FILE operands -- it writes multi-line filesystem statistics for "$f" to
# stdout, exits nonzero only on the bogus '%i' operand, and the `||` fallback then
# appends the real inode. Because the captured filesystem statistics vary between
# calls while the inode does not, an `=` comparison could report a FALSE RED and --
# more dangerously -- a `!=` comparison ("prove the setup really changed the inode")
# was a FALSE GREEN that passed vacuously. This helper reads the inode and nothing
# else. Same idiom as _frozen_iso_plus_ms above.
_inode_of() {
  node -e 'process.stdout.write(require("fs").statSync(process.argv[1], { bigint: true }).ino.toString())' "$1"
}

# Portable node-based file-mode reader, octal string (no shell `stat`). Same GNU
# `stat -f` = --file-system defect as _inode_of above: the prior
# `stat -f '%Mp%Lp' "$d" 2>/dev/null || stat -c '%a' "$d"` capture returned this
# directory's filesystem statistics followed by its mode, which then made the
# restoring `chmod` fail -- silently, because that chmod swallowed its own failure
# with `|| true`, leaving txnDir at 0777 instead of its original mode. Emits only
# the permission bits (mode & 0o7777) so the value is a valid chmod operand.
# NOTE: runtime-consultation-roots.bats's own mode helper is GNU-FIRST
# (`stat -c '%a'` then BSD fallback) and is therefore already safe -- unchanged.
_mode_of() {
  node -e 'process.stdout.write((require("fs").statSync(process.argv[1], { bigint: true }).mode & 0o7777n).toString(8))' "$1"
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$overrides" "$out"
}

# `stop/v2` fixture builder (record #12, PLAN.md ~L506-519) -- used to construct
# a stop/v2 record directly for RCC-newverb-worker-stop-ack's fixture needs,
# independent of a live worker-stop call (worker-stop itself is a fully
# registered command now, but this test's own scope is worker-stop-ack alone).
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$overrides" "$out"
}

# `cancel/v1` fixture builder that deliberately plants a FOREIGN `request_id`
# (Codex NO-GO round 5, confused-deputy gap) -- used only to prove
# cmdAwaitResult/cmdAcceptResult/cmdCancel's own already-cancelled check/
# validateCancelV1 each independently verify a durably-read cancel.json's own
# `request_id` against the transaction it is confined under, never trusting
# mere path co-location. No real writer (cmdCancel always stamps
# `reqObj.request_id` for the transaction it is actually processing) can ever
# produce this shape; it models a planted/copied/tampered record.
_write_foreign_cancel() {
  local out="$1" foreign_request_id="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const obj = {
      schema: "coordination/cancel/v1",
      request_id: process.argv[1],
      reason: "explicit",
      cancelled_at: "2025-01-01T00:00:00Z",
      cancelled_by: "foreign-instance"
    };
    fs.writeFileSync(process.argv[2], JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(process.argv[2], 0o600);
  ' "$foreign_request_id" "$out"
}

# General-purpose `cancel/v1` fixture builder (same override/__OMIT__ idiom as
# _write_request/_write_result/_write_stop above) -- used by the round-6 tests
# below that each need independent control over request_id/reason/cancelled_by
# to isolate ONE specific gap at a time (confinement-only, filename-only,
# cancelled_by-only). _write_foreign_cancel above is kept unchanged, exactly as
# the round-5 confused-deputy tests already depend on it.
_write_cancel_record() {
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
      cancelled_at: "2025-01-01T00:00:00Z",
      cancelled_by: "c".repeat(64)
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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

# Same idiom as runtime-consultation-state.bats's own Section-4 deterministic
# interleavings: polls (bounded, no fixed sleep-and-hope) for a backgrounded
# process's `testRendezvous` "-ready" sentinel, matching the production
# RENDEZVOUS_MAX_WAIT_MS=5000/RENDEZVOUS_POLL_MS=20 budget. Fails loud (never
# hangs the suite) if the sentinel never appears.
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

@test "CLI-RESULT-04 UNAVAILABLE: dispatch with no available driver prints status UNAVAILABLE/rc4/DRIVER_UNAVAILABLE" {
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

@test "CLI-RESULT-08 CONFLICT: PENDING DESIGN -- see this file's own 'Key interpretive decisions' section above for the current reasoning, and git history for the rejected prior attempts. Not yet settled: where a genuine two-candidate race for the SAME (attempt_id, lease_epoch) is legitimately detected and evidenced (the real production write path, cmdPublishResult, does not currently record one), and whether the conflict/v1 schema needs to change to represent it. Marked skip rather than faking a pass, reintroducing a rejected mechanism, or leaving a bare unexplained not-ok." {
  skip "DESIGN-BLOCKED: no authorized production path exists yet to generate a genuine CONFLICT distinct from CANCELLED; needs a design decision (and possibly a PLAN/schema delta) on where two candidates for the SAME (attempt_id, lease_epoch) can exist and how the losing one is evidenced -- not a CLI-conformance fix"
}

@test "RCC-await-result-explicit-cancel-still-cancelled: await-result observing a plain --reason explicit cancellation (the ordinary path, no conflicting candidates involved at all) still reports CANCELLED/rc6/TRANSACTION_CANCELLED -- regression proving the ordinary cancellation path is unaffected by CLI-RESULT-08 being pending." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req_f" --timeout 1
  [ "$status" -eq 6 ]
  _assert_cli_result "CANCELLED" "TRANSACTION_CANCELLED"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "RCC-cancel-second-call-observes-cancelled: a second cancel call with a different --reason for an already-cancelled request loses the cancel.json no-clobber race and itself reports the same terminal CANCELLED/rc6/TRANSACTION_CANCELLED disposition CLI-RESULT-07 observes via accept-result (distinct code path -- cmdCancel's OWN already-cancelled short-circuit, not cmdAwaitResult's observation logic)." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  # Codex NO-GO round 8: --reason expired now requires the request's own
  # expiry to have genuinely passed (cancelled_at >= expiry) -- a
  # deliberately already-expired fixture (both timestamps in the past,
  # 1800s apart to satisfy CONSULT_V2_FIELDS.expiry's 120..3600s window).
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","created_at":"2020-01-01T00:00:00Z","expiry":"2020-01-01T00:30:00Z"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason expired
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 6 ]
  _assert_cli_result "CANCELLED" "TRANSACTION_CANCELLED"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

# ══════════════════════════════════════════════════════════════════════════
# cancel.json confused-deputy suite (Codex NO-GO round 5, independent of the
# CONFLICT design-stop above): every cancel.json reader below only checked
# durability + CANCEL_V1_FIELDS shape, never that the record's OWN
# `request_id` matches the transaction it is confined under -- a foreign,
# schema-valid cancel/v1 (never producible by the real writer, which always
# stamps its OWN reqObj.request_id) planted or copied to THIS transaction's
# cancel.json path terminalized THIS transaction as CANCELLED. Fixed via the
# shared `accreditCancelRecord` check (its first version; broadened further by
# the round-6 suite below), mirroring `readCanonicalRequestRecord`'s identical
# request.json pattern.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-cancel-confused-deputy-await-result: await-result rejects a schema-valid cancel.json whose own request_id belongs to a DIFFERENT request, never treating it as this transaction's own CANCELLED terminal." {
  local id; id="$(_gen_hex_id)"
  local foreign_id; foreign_id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_foreign_cancel "$cancel_f" "$foreign_id"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req_f" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-confused-deputy-accept-result: accept-result rejects a schema-valid cancel.json whose own request_id belongs to a DIFFERENT request." {
  local id; id="$(_gen_hex_id)"
  local foreign_id; foreign_id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_foreign_cancel "$cancel_f" "$foreign_id"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-confused-deputy-cancel: cancel's own already-cancelled short-circuit rejects a schema-valid cancel.json whose own request_id belongs to a DIFFERENT request, rather than treating it as proof this transaction is already cancelled." {
  local id; id="$(_gen_hex_id)"
  local foreign_id; foreign_id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_foreign_cancel "$cancel_f" "$foreign_id"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-confused-deputy-validate: validate --kind cancel-v1 rejects a schema-valid cancel.json whose own request_id does not match the transaction directory it is stored under." {
  local id; id="$(_gen_hex_id)"
  local foreign_id; foreign_id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_foreign_cancel "$cancel_f" "$foreign_id"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# cancel/v1 canonical-reader suite, part 2 (Codex NO-GO round 6): the round-5
# fix above (`accreditCancelRecord`'s first version) only checked request_id
# self-consistency against basename(dirname()) -- it still accepted
# an artifact stored OUTSIDE the coordination root entirely (planRootFromArtifact's
# own confinement check is a minimum-depth check, not a genuine escape check),
# accepted a cancel-shaped record under any filename, let cmdCancel operate on a
# --request confined under a wholly DIFFERENT --coordination-root, and let
# cancelled_by hold any non-empty string while the writer stamped an unconnected
# fresh genId() instead of the PLAN-required requester_instance_id/
# timeout-authority. Each test below isolates exactly ONE of those four gaps.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-cancel-out-of-root-rejected: validate --kind cancel-v1 rejects a self-consistent cancel.json (correct filename, matching request_id, matching cancelled_by) whose containing transaction directory is not confined under --coordination-root at all." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local outside_dir="$PROJ/outside-root/$id"
  local req_f="$outside_dir/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"

  local cancel_f="$outside_dir/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","cancelled_by":"%s"}' "$id" "$requester")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-wrong-filename-rejected: validate --kind cancel-v1 rejects a self-consistent, fully-confined cancel/v1 record (matching request_id, matching cancelled_by) stored under any filename other than the canonical cancel.json." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local wrong_f; wrong_f="$(_plan_root)/transactions/$id/not-cancel.json"
  _write_cancel_record "$wrong_f" "$(printf '{"request_id":"%s","cancelled_by":"%s"}' "$id" "$(printf 'c%.0s' {1..64})")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$wrong_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-cross-root-rejected: cancel rejects a --request path that resolves under a DIFFERENT, independently root-init'd coordination root than the one passed via --coordination-root." {
  local other_root="$PROJ/.planning/coordination-other"
  _run_cli root-init --coordination-root "$other_root"
  [ "$status" -eq 0 ]

  local id; id="$(_gen_hex_id)"
  local other_plan_root="$other_root/$REPO_ID/$WAVE_SLUG/$PLAN_DIGEST"
  local other_req_f="$other_plan_root/transactions/$id/request.json"
  _write_request "$other_req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$other_req_f" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-writer-stamps-requester-identity: cancel --reason explicit stamps cancel.json's own cancelled_by with the REAL request's requester_instance_id, never an unconnected freshly-generated id." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  local stamped; stamped="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cancelled_by)' "$cancel_f")"
  [ "$stamped" = "$requester" ]
}

@test "RCC-cancel-writer-stamps-timeout-authority: cancel --reason expired stamps cancel.json's own cancelled_by with the literal timeout-authority -- regression alongside the requester-identity fix above, proving the expired branch is unaffected." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  # Codex NO-GO round 8: --reason expired now requires a genuinely-past expiry.
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","created_at":"2020-01-01T00:00:00Z","expiry":"2020-01-01T00:30:00Z"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason expired
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  local stamped; stamped="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cancelled_by)' "$cancel_f")"
  [ "$stamped" = "timeout-authority" ]
}

@test "RCC-cancel-cancelled-by-authority-mismatch-rejected: accept-result rejects an otherwise fully-confined, correctly-named, correctly-identified cancel.json whose cancelled_by matches neither the containing request's requester_instance_id nor timeout-authority for its own reason." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","reason":"explicit","cancelled_by":"some-unrelated-identity-not-requester-not-timeout-authority"}' "$id")"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# cancel/v1 canonical-reader suite, part 3 (Codex NO-GO round 8): the round-6
# accreditCancelRecord fix above still only proved LEXICAL confinement + a
# minimum-depth check, correlating only against basename(dirname()) -- a
# self-consistent request.json+cancel.json pair planted under an arbitrary
# <coordRoot>/junk/<id>/ directory (confined, but not at the real
# <repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id> namespace)
# passed. `assertGenuinelyConfinedUnderRoot`'s own path.relative/path.resolve
# were also purely lexical, never resolving an actual on-disk symlinked
# ancestor. `--request` itself was never required to be at its own canonical
# filename in cancel/accept-result/await-result, and accept-result/
# await-result had NO confinement check on `--request` at all. Finally, the
# bare `reason==='expired'` VALUE was accepted as sufficient proof of
# `timeout-authority`, and the containing request was only shape+ID checked,
# never the FULL consult-v2 graph/role-policy/content_ref pipeline. All fixed
# below; see accreditCancelRecord's own doc comment for the complete,
# reordered chain.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-cancel-namespace-not-canonical-rejected: validate --kind cancel-v1 rejects a self-consistent cancel.json (correct filename, matching request_id, matching cancelled_by, genuinely valid containing request) confined under --coordination-root but stored under an arbitrary junk/<id>/ directory rather than the exact <repo_id>/<wave_slug>/<plan_digest>/transactions/<request_id> namespace." {
  local id; id="$(_gen_hex_id)"
  local junk_dir="$COORD_ROOT/junk/$id"
  local req_f="$junk_dir/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f="$junk_dir/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","cancelled_by":"%s"}' "$id" "$(printf 'c%.0s' {1..64})")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-ancestor-symlink-rejected: validate --kind cancel-v1 rejects a self-consistent cancel.json whose containing transaction directory is reached through a symlinked intermediate directory that actually resolves outside --coordination-root, even though the path lexically appears confined at the correct depth." {
  local id; id="$(_gen_hex_id)"
  local real_outside="$PROJ/real-outside-target"
  mkdir -p "$real_outside"
  local plan_root; plan_root="$(_plan_root)"
  mkdir -p "$plan_root"
  ln -s "$real_outside" "$plan_root/transactions"

  local txn_dir="$plan_root/transactions/$id"
  local req_f="$txn_dir/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local cancel_f="$txn_dir/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","cancelled_by":"%s"}' "$id" "$(printf 'c%.0s' {1..64})")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-request-wrong-filename-rejected-cancel: cancel rejects a --request path whose basename is not the canonical request.json, even though its sibling request.json (same directory) is genuine and valid." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local wrong_f; wrong_f="$(_plan_root)/transactions/$id/not-request.json"
  cp "$req_f" "$wrong_f"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$wrong_f" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-request-wrong-filename-rejected-accept-result: accept-result rejects a --request path whose basename is not the canonical request.json." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local wrong_f; wrong_f="$(_plan_root)/transactions/$id/not-request.json"
  cp "$req_f" "$wrong_f"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$wrong_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-request-wrong-filename-rejected-await-result: await-result rejects a --request path whose basename is not the canonical request.json." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local wrong_f; wrong_f="$(_plan_root)/transactions/$id/not-request.json"
  cp "$req_f" "$wrong_f"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$wrong_f" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-request-out-of-root-rejected-accept-result: accept-result rejects a --request confined under a DIFFERENT, independently root-init'd coordination root than the one passed via --coordination-root (accept-result previously had no confinement check on --request at all)." {
  local other_root="$PROJ/.planning/coordination-other-accept"
  _run_cli root-init --coordination-root "$other_root"
  [ "$status" -eq 0 ]

  local id; id="$(_gen_hex_id)"
  local other_plan_root="$other_root/$REPO_ID/$WAVE_SLUG/$PLAN_DIGEST"
  local other_req_f="$other_plan_root/transactions/$id/request.json"
  _write_request "$other_req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$other_req_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-request-out-of-root-rejected-await-result: await-result rejects a --request confined under a DIFFERENT, independently root-init'd coordination root than the one passed via --coordination-root (await-result previously had no confinement check on --request at all)." {
  local other_root="$PROJ/.planning/coordination-other-await"
  _run_cli root-init --coordination-root "$other_root"
  [ "$status" -eq 0 ]

  local id; id="$(_gen_hex_id)"
  local other_plan_root="$other_root/$REPO_ID/$WAVE_SLUG/$PLAN_DIGEST"
  local other_req_f="$other_plan_root/transactions/$id/request.json"
  _write_request "$other_req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$other_req_f" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-expired-without-real-expiry-rejected: cancel --reason expired is rejected when the request's own expiry has not genuinely passed -- the bare --reason value is a caller claim, never proof of timeout authority." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason expired
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "RCC-cancel-expired-reader-rejects-premature-cancelled-at: validate --kind cancel-v1 rejects an otherwise fully-confined, correctly-named, correctly-identified cancel.json claiming reason=expired/cancelled_by=timeout-authority whose own cancelled_at precedes the containing request's own expiry." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","reason":"expired","cancelled_by":"timeout-authority","cancelled_at":"2020-01-01T00:00:00Z"}' "$id")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "RCC-cancel-container-request-full-validation-rejected: validate --kind cancel-v1 rejects a cancel.json whose containing request.json passes a shape+ID-only check but fails the FULL consult-v2 graph validation (a root request, parent_request_id null, whose root_request_id does not equal its own request_id)." {
  local id; id="$(_gen_hex_id)"
  local foreign_root_id; foreign_root_id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$foreign_root_id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","cancelled_by":"%s"}' "$id" "$(printf 'c%.0s' {1..64})")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "CANCEL-AUDIT-01 source-audit: the shape-check pattern assertClosedShape(o, CANCEL_V1_FIELDS) appears in exactly the three sanctioned cancel.json choke-point wrappers (readCanonicalCancelRecordOptional, readCanonicalCancelRecordRequired, classifyCanonicalCancelRecord), never inline at a command body -- mechanically enforces Codex NO-GO round 8's 'single choke point, no alternative readers' requirement." {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");
    const pattern = "assertClosedShape(o, CANCEL_V1_FIELDS)";
    const count = src.split(pattern).length - 1;
    if (count !== 3) {
      console.error("expected exactly 3 occurrences of " + pattern + ", found " + count);
      process.exit(1);
    }
    const lines = src.split("\n");
    const wrapperNames = ["readCanonicalCancelRecordOptional", "readCanonicalCancelRecordRequired", "classifyCanonicalCancelRecord"];
    for (const name of wrapperNames) {
      const startIdx = lines.findIndex((l) => l.startsWith("function " + name + "("));
      if (startIdx === -1) { console.error("missing wrapper function: " + name); process.exit(1); }
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i++) {
        if (/^(function |const [A-Z_]+ = \{|COMMANDS)/.test(lines[i])) { endIdx = i; break; }
      }
      const body = lines.slice(startIdx, endIdx).join("\n");
      if (!body.includes(pattern)) {
        console.error("wrapper " + name + " does not contain the expected shape-check pattern");
        process.exit(1);
      }
    }
  ' "$IMPL"
  [ "$status" -eq 0 ]
}

@test "CANCEL-AUDIT-02 source-audit: the ONLY literal references to the cancel.json filename and the ONLY calls to cancelPathFor() are inside the sanctioned choke-point wrappers, the one known writer, or cancelPathFor's own definition -- mechanically strengthens CANCEL-AUDIT-01 against a raw reader, an aliased field table, or a hand-rolled shape-check that never calls assertClosedShape at all (Codex NO-GO round 10: a bare textual count of one specific call pattern would not catch any of those)." {
  run node -e '
    const fs = require("fs");
    const src = fs.readFileSync(process.argv[1], "utf8");

    // 1. The literal filename string must appear in EXACTLY two places: cancelPathFor
    //    itself (the sole path constructor) and the filename check inside
    //    accreditCancelRecord. Anything else means a hand-rolled path.join(...,
    //    "cancel.json") exists somewhere, bypassing cancelPathFor entirely.
    const filenamePattern = "\x27cancel.json\x27";
    const filenameCount = src.split(filenamePattern).length - 1;
    if (filenameCount !== 2) {
      console.error("expected exactly 2 literal cancel.json filename references, found " + filenameCount);
      process.exit(1);
    }

    // 2. cancelPathFor() itself must be called EXACTLY 5 times (excluding its own
    //    definition) -- every one of the 5 legitimate call sites established across
    //    this pass and round 16 (cmdCancel reader, cmdCancel writer, cmdAcceptResult
    //    reader, cmdAwaitResult reader, and round 16 own cmdPublishResult
    //    terminal-exclusion reader -- PLAN.md ~L443 "absence of committed
    //    takeover/cancel/accept" requirement, previously missing entirely). A 6th
    //    call site would mean a new, unaudited consumer was added.
    const callPattern = "cancelPathFor(";
    const totalCallOccurrences = src.split(callPattern).length - 1;
    const defPattern = "function cancelPathFor(";
    const defOccurrences = src.split(defPattern).length - 1;
    if (defOccurrences !== 1) {
      console.error("expected exactly 1 cancelPathFor definition, found " + defOccurrences);
      process.exit(1);
    }
    const callSiteCount = totalCallOccurrences - defOccurrences;
    if (callSiteCount !== 5) {
      console.error("expected exactly 5 cancelPathFor(...) call sites (excluding its own definition), found " + callSiteCount);
      process.exit(1);
    }

    // 3. Every call site must be immediately wrapped by one of the three sanctioned
    //    reader wrappers, OR be the one known writer assignment (`const cancelPath =
    //    cancelPathFor(txnDir);`) -- never a bare, unwrapped read of the result.
    const lines = src.split("\n");
    const readerWrappers = ["readCanonicalCancelRecordOptional(cancelPathFor(", "readCanonicalCancelRecordRequired(cancelPathFor(", "classifyCanonicalCancelRecord(cancelPathFor("];
    const writerPattern = "const cancelPath = cancelPathFor(txnDir);";
    let sanctionedSeen = 0;
    for (const line of lines) {
      if (!line.includes(callPattern) || line.includes(defPattern)) continue;
      const isSanctionedReader = readerWrappers.some((w) => line.includes(w));
      const isSanctionedWriter = line.trim() === writerPattern;
      if (!isSanctionedReader && !isSanctionedWriter) {
        console.error("unsanctioned cancelPathFor(...) call site: " + line.trim());
        process.exit(1);
      }
      sanctionedSeen += 1;
    }
    if (sanctionedSeen !== 5) {
      console.error("expected to positively identify all 5 sanctioned call sites by line-scan, found " + sanctionedSeen);
      process.exit(1);
    }
  ' "$IMPL"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# cancel/v1 canonical-reader suite, part 4 (Codex NO-GO round 9): rounds 6-8
# fixed cancel.json's OWN accreditation (accreditCancelRecord) and gave
# cancel/accept-result/await-result a --request confinement+filename check,
# but the WRITE-side --request handling still only applied MINIMUM depth
# (planRootFromArtifact) + shape+ID (readRequestForTxnOrCorrelationInvalid)
# -- never the EXACT geometry or FULL validateConsultV2 graph/role-policy/
# content_ref pipeline accreditCancelRecord already demanded of an EXISTING
# cancel.json's containing request. This let a WRITE (cancel/accept-result/
# await-result) SUCCEED against a request that was confined but not at the
# exact canonical namespace path, or whose graph was broken -- producing an
# artifact (or observing a request) that the system's OWN readers would
# immediately reject. All three commands now share accreditCanonicalRequest,
# the same accreditor accreditCancelRecord itself uses.
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-cancel-write-rejects-namespace-not-canonical: cancel rejects a --request confined under --coordination-root but not at the exact canonical namespace path, even though it is otherwise a fully valid, well-formed request -- the write itself must fail, not merely a later read of what it would have produced." {
  local id; id="$(_gen_hex_id)"
  local junk_dir="$COORD_ROOT/junk/$id"
  local req_f="$junk_dir/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
  [ ! -f "$junk_dir/cancel.json" ]
}

@test "RCC-cancel-write-rejects-broken-graph: cancel rejects a --request whose own graph is broken (parent_request_id null but root_request_id != request_id) even though it passes a shape+ID-only check -- the write must run the FULL consult-v2 graph validation, not the lighter check other operational commands still use." {
  local id; id="$(_gen_hex_id)"
  local foreign_root_id; foreign_root_id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$foreign_root_id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
  [ ! -f "$(_plan_root)/transactions/$id/cancel.json" ]
}

@test "RCC-cancel-write-rejects-geometry-value-mismatch: cancel rejects a --request stored at a path with the CORRECT shape (5 segments, transactions literal) but whose repo_id/wave_slug/plan_digest segment VALUES do not match the request's own embedded fields -- isolates the cross-correlation check from the bare depth/shape check above (RCC-cancel-write-rejects-namespace-not-canonical), which a shallow junk/<id>/ path never reaches." {
  local id; id="$(_gen_hex_id)"
  local fake_plan_root="$COORD_ROOT/fake-repo/fake-wave/fake-plan"
  local req_f="$fake_plan_root/transactions/$id/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
  [ ! -f "$fake_plan_root/transactions/$id/cancel.json" ]
}

@test "RCC-accept-result-rejects-namespace-not-canonical: accept-result rejects a --request confined under --coordination-root but not at the exact canonical namespace path -- proves accreditCanonicalRequest is genuinely shared with cmdAcceptResult, not only cmdCancel." {
  local id; id="$(_gen_hex_id)"
  local junk_dir="$COORD_ROOT/junk2/$id"
  local req_f="$junk_dir/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$req_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-await-result-rejects-namespace-not-canonical: await-result rejects a --request confined under --coordination-root but not at the exact canonical namespace path -- proves accreditCanonicalRequest is genuinely shared with cmdAwaitResult too, not only cmdCancel." {
  local id; id="$(_gen_hex_id)"
  local junk_dir="$COORD_ROOT/junk3/$id"
  local req_f="$junk_dir/request.json"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli await-result --coordination-root "$COORD_ROOT" --request "$req_f" --timeout 1
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCC-cancel-expired-far-future-cancelled-at-rejected: validate --kind cancel-v1 rejects an otherwise fully-confined, correctly-named, correctly-identified cancel.json claiming reason=expired/cancelled_by=timeout-authority whose cancelled_at is implausibly far in the future (satisfies cancelled_at >= expiry trivially, but does not reflect any genuine real-world moment)." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local cancel_f; cancel_f="$(_plan_root)/transactions/$id/cancel.json"
  _write_cancel_record "$cancel_f" "$(printf '{"request_id":"%s","reason":"expired","cancelled_by":"timeout-authority","cancelled_at":"2099-01-01T00:00:00Z"}' "$id")"

  _run_cli validate --coordination-root "$COORD_ROOT" --kind cancel-v1 --artifact "$cancel_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Deterministic interleavings (Codex NO-GO round 10, empirically reproduced):
# cancel/accept-result accredited --request BEFORE acquiring the transition
# lock -- a request.json swap completing while the accreditation-then-lock-
# wait was in flight left the write using STALE, no-longer-current data.
#
# Codex NO-GO round 11: the rendezvous point moved from BEFORE withLock to the
# first line INSIDE its callback -- a rendezvous firing before withLock only
# proves a swap happened before the lock was even entered, not that the read
# genuinely happens while holding it; these tests (and their rendezvous names,
# `*-in-lock-pre-read`) now prove the stronger claim. A SEPARATE, preliminary
# accreditation also runs before withLock (round 11 P0(1), so an invalid/
# out-of-root --request never reaches acquireLock's own mkdir at all) -- see
# RCC-cancel-out-of-root-no-mutation / RCC-accept-result-out-of-root-no-
# mutation below for that half.
#
# Codex NO-GO round 12: round 11 discarded that preliminary read and let the
# fresh in-lock read simply be TRUSTED -- these two tests originally asserted
# exactly that adoption (the swapped-in value winning). That is wrong:
# request.json is IMMUTABLE (PLAN.md ~L813); the preliminary read is now KEPT
# as the frozen baseline the in-lock read must match, or the command STOPs.
# Both tests below are inverted from their round-10/11 form to prove the
# CORRECT behavior: a mid-lock swap is detected and rejected, never adopted.
#
# These tests use the same capability-gated `testRendezvous` mechanism
# runtime-consultation-state.bats's own Section-4 interleavings already
# establish (never a fixed sleep-and-hope timing guess).
# ══════════════════════════════════════════════════════════════════════════

@test "RCC-cancel-toctou-rejects-post-swap: cancel pauses (rendezvous) genuinely INSIDE its held lock, immediately before its in-lock re-read; a SECOND process swaps request.json's own requester_instance_id while it waits; on resume, cancel must STOP (SECURITY_INVALID), never adopt the swapped-in value, and must write no cancel.json (Codex NO-GO round 12 -- inverted from round 11's 'adopts' assertion)." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  local requester_a; requester_a="$(printf '9%.0s' {1..64})"
  local requester_b; requester_b="$(printf '8%.0s' {1..64})"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester_a")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-in-lock-pre-read \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-in-lock-pre-read

  # Swap requester_instance_id ONLY -- same request_id/attempt/everything else,
  # so this is otherwise a fully self-consistent, canonical request. The
  # command must still reject it: request.json's own IDENTITY changed, which
  # is illegal regardless of whether the new content also happens to validate.
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester_b")"

  touch "$txn_dir/.rendezvous-cancel-in-lock-pre-read-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (request.json changed since preflight), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ ! -e "$txn_dir/cancel.json" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-toctou-rejects-post-swap: accept-result pauses (rendezvous) genuinely INSIDE its held lock, immediately before its in-lock re-read; a SECOND process swaps request.json's own bytes (same request_id/attempt, different question text) while it waits; on resume, accept-result must STOP (SECURITY_INVALID), never adopt the swapped-in bytes, and must write no accepted-result.json (Codex NO-GO round 12 -- inverted from round 11's 'adopts' assertion)." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  local fixed_created; fixed_created="2025-06-01T00:00:00Z"
  local fixed_expiry; fixed_expiry="2025-06-01T00:30:00Z"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s"}' "$id" "$id" "$aid" "$fixed_created" "$fixed_expiry")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local pre_swap_digest; pre_swap_digest="$(_sha256_file "$req_f")"

  # The published result correlates against the PRE-swap digest -- accept-
  # result must never get far enough to compare it against anything else,
  # since the identity check now fires before any correlation logic at all.
  local result_f; result_f="$(_result_path "$id" "$aid")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$pre_swap_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-in-lock-pre-read \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-in-lock-pre-read

  # Swap ONLY the free-text question -- otherwise fully self-consistent and
  # canonical. The command must still reject it: identity changed since
  # preflight, which is illegal regardless of whether the new content is
  # ALSO independently valid.
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","created_at":"%s","expiry":"%s","question":"swapped-in question, different bytes"}' "$id" "$id" "$aid" "$fixed_created" "$fixed_expiry")"
  local post_swap_digest; post_swap_digest="$(_sha256_file "$req_f")"
  [ "$post_swap_digest" != "$pre_swap_digest" ]

  touch "$txn_dir/.rendezvous-accept-result-in-lock-pre-read-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (request.json changed since preflight), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ ! -e "$txn_dir/accepted-result.json" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-await-result-rebind-mid-wait: await-result, mid-poll, observes a request.json rewritten (same request_id) to a NEW initial_attempt_id -- request.json is IMMUTABLE (PLAN.md ~L813; a legitimate authority change requires takeover.json), so this must STOP fail-closed (SECURITY_INVALID), never silently adopt the new attempt as round 10's fix mistakenly did (Codex NO-GO round 11 P0(3))." {
  local id; id="$(_gen_hex_id)"
  local aid_a; aid_a="$(_gen_hex_id)"
  local aid_b; aid_b="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid_a")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=await-result-post-iteration \
      node "$IMPL" await-result --coordination-root "$COORD_ROOT" --request "$req_f" --timeout 3 >"$out" 2>&1; echo $? >"$rc_file" ) &
  local await_pid=$!

  # Deterministic, not timing-based (Codex NO-GO round 11: a plain sleep here
  # cannot prove the loop genuinely read the ORIGINAL aid_a at least once
  # before the rewrite below) -- this blocks until a FULL iteration (including
  # its own top-of-loop accreditation of aid_a) has already completed.
  _wait_for_rendezvous_ready "$txn_dir" await-result-post-iteration

  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid_b")"
  local result_b; result_b="$(_result_path "$id" "$aid_b")"
  local req_digest_b; req_digest_b="$(_sha256_file "$req_f")"
  _write_result "$result_b" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest_b" "$aid_b")"

  touch "$txn_dir/.rendezvous-await-result-post-iteration-go"
  wait "$await_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (immutable request.json mutated mid-poll), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 12: comparing DIGEST alone (round 11's own fix) misses a
# byte-IDENTICAL replacement -- the file is unlinked and rewritten with the
# EXACT same bytes, so content and digest never change, but the underlying
# file (a fresh inode) genuinely does. `cp` (not a shell string round-trip
# via `$(...)`, which can silently drop trailing bytes) guarantees raw-byte
# fidelity while still forcing a new inode.
@test "RCC-await-result-byte-identical-replacement-mid-wait: await-result detects request.json being unlinked and rewritten with byte-IDENTICAL content (same digest, a genuinely different inode) and fails closed instead of continuing to trust it." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=await-result-post-iteration \
      node "$IMPL" await-result --coordination-root "$COORD_ROOT" --request "$req_f" --timeout 3 >"$out" 2>&1; echo $? >"$rc_file" ) &
  local await_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" await-result-post-iteration

  local tmp_copy; tmp_copy="$(mktemp)"
  cp "$req_f" "$tmp_copy"
  local orig_ino; orig_ino="$(_inode_of "$req_f")"
  rm -f "$req_f"
  cp "$tmp_copy" "$req_f"
  chmod 600 "$req_f"
  rm -f "$tmp_copy"
  local new_ino; new_ino="$(_inode_of "$req_f")"
  [ "$new_ino" != "$orig_ino" ] # sanity: genuinely a different inode now

  touch "$txn_dir/.rendezvous-await-result-post-iteration-go"
  wait "$await_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (byte-identical replacement is still an illegal mutation), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 12: a single pre-publish check does not cover the write
# itself -- publishNoClobber's own multi-step sequence takes real time, during
# which the same class of swap could still happen. These tests let the
# publish complete NORMALLY (cancel.json/accepted-result.json genuinely
# exists on disk), then pause at a rendezvous positioned immediately after
# the publish and before the post-publish re-check, swap request.json, and
# confirm: the command reports a FAILURE (never the SUCCESS the completed
# publish alone would suggest), and -- proving the lock was genuinely
# POISONED, not just cleanly released after a late failure -- .lock is left
# behind as a durable orphan rather than removed.
@test "RCC-cancel-post-publish-identity-loss-poisons-lock: cancel's post-publish re-check detects request.json changing AFTER cancel.json was already durably written, and POISONS the lock (retains .lock as an orphan) rather than releasing it." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-post-publish-pre-recheck \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-post-publish-pre-recheck

  # cancel.json is ALREADY durably written at this point (the rendezvous
  # fires AFTER publishNoClobber returns) -- confirm that before mutating.
  [ -e "$txn_dir/cancel.json" ]
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$(printf 'a%.0s' {1..64})")"

  touch "$txn_dir/.rendezvous-cancel-post-publish-pre-recheck-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  # Poisoned, not cleanly released: .lock must still be there.
  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-post-publish-identity-loss-poisons-lock: accept-result's post-publish re-check detects request.json changing AFTER accepted-result.json was already durably written, and POISONS the lock (retains .lock as an orphan) rather than releasing it." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-post-publish-pre-recheck \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-post-publish-pre-recheck

  [ -e "$txn_dir/accepted-result.json" ]
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$(_gen_hex_id)")"

  touch "$txn_dir/.rendezvous-accept-result-post-publish-pre-recheck-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 13: the post-publish checks re-verify txnDir/.lock/
# request.json, but NEVER re-open the just-published artifact itself -- an
# ABA (or, more simply, anything that removes/corrupts the just-written
# artifact between publish and the post-check, while leaving the SURROUNDING
# scope/request identity untouched) would pass every existing check. These
# tests demonstrate the gap with the simplest possible reproduction: delete
# the just-published artifact, changing NOTHING else.
@test "RCC-cancel-post-publish-artifact-removed-poisons-lock: cancel's post-publish re-check detects cancel.json itself being removed AFTER publish (txnDir/.lock/request.json all untouched) and POISONS the lock rather than reporting SUCCESS for a file that no longer exists." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-post-publish-pre-recheck \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-post-publish-pre-recheck

  [ -e "$txn_dir/cancel.json" ]
  rm -f "$txn_dir/cancel.json"

  touch "$txn_dir/.rendezvous-cancel-post-publish-pre-recheck-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 14: the artifact-removed tests above prove DELETION is
# caught, but not SUBSTITUTION -- a DIFFERENT, still schema-valid and
# correlated record (same request_id/cancelled_by/reason, only cancelled_at
# differs) would previously pass readCanonicalCancelRecordRequired/
# assertAcceptedResultCorrelates outright, since neither compares the re-read
# object against the EXACT bytes this invocation constructed.
@test "RCC-cancel-post-publish-artifact-substituted-poisons-lock: cancel's post-publish re-check detects cancel.json being SUBSTITUTED (a different, still schema-valid and correlated cancel/v1 record) AFTER publish, and POISONS the lock rather than reporting SUCCESS for a record it never actually wrote." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-post-publish-pre-recheck \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-post-publish-pre-recheck

  [ -e "$txn_dir/cancel.json" ]
  # Same request_id/cancelled_by/reason (so accreditCancelRecord's own checks
  # ALL pass) -- only cancelled_at differs. This must still be rejected.
  _write_cancel_record "$txn_dir/cancel.json" "$(printf '{"request_id":"%s","reason":"explicit","cancelled_by":"%s","cancelled_at":"2099-01-01T00:00:00Z"}' "$id" "$requester")"

  touch "$txn_dir/.rendezvous-cancel-post-publish-pre-recheck-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (substituted cancel.json is not byte-identical to what was published), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-cancel-post-publish-rewrite-then-exact-restore-same-inode-poisons-lock: cancel's post-publish re-check detects cancel.json being rewritten IN PLACE (same inode, genuinely DIFFERENT bytes momentarily) and then restored to the EXACT original bytes, all on the SAME inode, BEFORE the re-check runs -- a bytes-only or dev/ino-only comparison would see identical final content and identical identity and wrongly accept this; only comparing mode/uid/gid/nlink/ctimeNs/mtimeNs against the ORIGINAL publish-time snapshot (not just this call's own internal before/after consistency) can tell a genuine rewrite happened (Codex NO-GO round 16, P1)." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-post-publish-pre-recheck \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-post-publish-pre-recheck

  [ -e "$txn_dir/cancel.json" ]
  local before_ino; before_ino="$(_inode_of "$txn_dir/cancel.json")"
  # Rewrite IN PLACE (truncate + write via the SAME path, same inode) with
  # genuinely different bytes, then rewrite IN PLACE again restoring the
  # EXACT original bytes -- both writes target the SAME inode throughout
  # (Node's fs.writeFileSync default flag is 'w': O_TRUNC|O_CREAT|O_WRONLY,
  # which truncates an EXISTING file in place rather than creating a new
  # inode).
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const original = fs.readFileSync(p);
    fs.writeFileSync(p, Buffer.from("{\"tampered\":true}"), { mode: 0o600 });
    fs.writeFileSync(p, original, { mode: 0o600 });
  ' "$txn_dir/cancel.json"
  local after_ino; after_ino="$(_inode_of "$txn_dir/cancel.json")"
  [ "$before_ino" = "$after_ino" ] || { echo "test setup failed: inode changed ($before_ino -> $after_ino), this must stay the SAME inode throughout"; false; }

  touch "$txn_dir/.rendezvous-cancel-post-publish-pre-recheck-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc -- a rewrite-then-restore on the same inode was silently accepted, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID") {
      console.error("expected a rejection (rewrite-then-restore on the same inode), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-cancel-post-publish-same-values-different-bytes-poisons-lock: cancel's post-publish re-check detects cancel.json being rewritten to the EXACT SAME field values but a DIFFERENT byte-level representation (pretty-printed, reordered keys) -- a re-serialize-then-hash check (round 14's own, since-corrected 'byte-exact' claim) would have wrongly accepted this, since both canonicalize identically; the fd-bound raw-byte comparator must not." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-post-publish-pre-recheck \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-post-publish-pre-recheck

  [ -e "$txn_dir/cancel.json" ]
  # Re-serialize the SAME parsed values with different whitespace/key order --
  # canonicalJSONStringify(parse(this)) reproduces the EXACT same canonical
  # string as the original, so a digest-of-reserialization check cannot tell
  # these apart; only a raw fd-bound byte comparison can.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    const reordered = { cancelled_at: obj.cancelled_at, cancelled_by: obj.cancelled_by, reason: obj.reason, request_id: obj.request_id, schema: obj.schema };
    fs.writeFileSync(p, JSON.stringify(reordered, null, 2) + "\n", { mode: 0o600 });
  ' "$txn_dir/cancel.json"

  touch "$txn_dir/.rendezvous-cancel-post-publish-pre-recheck-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (same-value-different-bytes cancel.json rejected), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-cancel-post-publish-same-bytes-different-inode-poisons-lock: cancel's post-publish re-check detects cancel.json being replaced by a BRAND NEW file (different inode) carrying byte-identical content -- a digest-only check (round 14's own, since-corrected 'byte-exact' claim) would have wrongly accepted this, since the bytes match exactly; only comparing the fd-bound identity against the receipt publishNoClobber itself returned can tell these apart." {
  local id; id="$(_gen_hex_id)"
  local requester; requester="$(printf '9%.0s' {1..64})"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","requester_instance_id":"%s"}' "$id" "$id" "$requester")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-post-publish-pre-recheck \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-post-publish-pre-recheck

  [ -e "$txn_dir/cancel.json" ]
  local before_ino; before_ino="$(_inode_of "$txn_dir/cancel.json")"
  # unlink + fresh write (never an in-place edit): a NEW inode, byte-identical content.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const bytes = fs.readFileSync(p);
    fs.unlinkSync(p);
    fs.writeFileSync(p, bytes, { mode: 0o600 });
  ' "$txn_dir/cancel.json"
  local after_ino; after_ino="$(_inode_of "$txn_dir/cancel.json")"
  [ "$before_ino" != "$after_ino" ] || { echo "test setup failed: inode did not actually change ($before_ino)"; false; }

  touch "$txn_dir/.rendezvous-cancel-post-publish-pre-recheck-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID") {
      console.error("expected a rejection (different-inode cancel.json), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-post-publish-artifact-removed-poisons-lock: accept-result's post-publish re-check detects accepted-result.json itself being removed AFTER publish (txnDir/.lock/request.json all untouched) and POISONS the lock rather than reporting SUCCESS for a file that no longer exists." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-post-publish-pre-recheck \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-post-publish-pre-recheck

  [ -e "$txn_dir/accepted-result.json" ]
  rm -f "$txn_dir/accepted-result.json"

  touch "$txn_dir/.rendezvous-accept-result-post-publish-pre-recheck-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 14: same gap as the cancel.json substitution test above --
# assertAcceptedResultCorrelates proves the re-read record CORRELATES (it
# checks request_digest/routing_policy_digest/accepted_attempt_id/
# accepted_lease_epoch/candidate_result_path/result_digest) but never compares
# it against the EXACT bytes this invocation wrote. requester_instance_id and
# accepted_at are NOT among the fields it checks -- a substitute differing
# only in accepted_at passes correlation outright.
@test "RCC-accept-result-post-publish-artifact-substituted-poisons-lock: accept-result's post-publish re-check detects accepted-result.json being SUBSTITUTED (a different, still-correlated accepted-result/v1 record differing only in accepted_at) AFTER publish, and POISONS the lock rather than reporting SUCCESS for a record it never actually wrote." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-post-publish-pre-recheck \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-post-publish-pre-recheck

  [ -e "$txn_dir/accepted-result.json" ]
  # Read back the REAL, just-published fields (so every correlation-checked
  # field is genuinely valid) and rewrite with ONLY accepted_at changed --
  # a field assertAcceptedResultCorrelates never checks.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.accepted_at = "2099-01-01T00:00:00Z";
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$txn_dir/accepted-result.json"

  touch "$txn_dir/.rendezvous-accept-result-post-publish-pre-recheck-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (substituted accepted-result.json is not byte-identical to what was published), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-post-publish-same-values-different-bytes-poisons-lock: accept-result's post-publish re-check detects accepted-result.json being rewritten to the EXACT SAME field values but a DIFFERENT byte-level representation (pretty-printed, reordered keys) -- a re-serialize-then-hash check would have wrongly accepted this." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-post-publish-pre-recheck \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-post-publish-pre-recheck

  [ -e "$txn_dir/accepted-result.json" ]
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
  ' "$txn_dir/accepted-result.json"

  touch "$txn_dir/.rendezvous-accept-result-post-publish-pre-recheck-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (same-value-different-bytes accepted-result.json rejected), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-post-publish-same-bytes-different-inode-poisons-lock: accept-result's post-publish re-check detects accepted-result.json being replaced by a BRAND NEW file (different inode) carrying byte-identical content -- a digest-only check would have wrongly accepted this." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-post-publish-pre-recheck \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-post-publish-pre-recheck

  [ -e "$txn_dir/accepted-result.json" ]
  local before_ino; before_ino="$(_inode_of "$txn_dir/accepted-result.json")"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const bytes = fs.readFileSync(p);
    fs.unlinkSync(p);
    fs.writeFileSync(p, bytes, { mode: 0o600 });
  ' "$txn_dir/accepted-result.json"
  local after_ino; after_ino="$(_inode_of "$txn_dir/accepted-result.json")"
  [ "$before_ino" != "$after_ino" ] || { echo "test setup failed: inode did not actually change ($before_ino)"; false; }

  touch "$txn_dir/.rendezvous-accept-result-post-publish-pre-recheck-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID") {
      console.error("expected a rejection (different-inode accepted-result.json), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 11 P0(1) (empirically reproduced): acquireLock's own
# fs.mkdirSync(txnDir, {recursive:true}) unconditionally creates the ENTIRE
# directory tree for whatever --request names, BEFORE any confinement/geometry
# check ever runs -- an out-of-root --request was correctly rejected
# SECURITY_INVALID while still leaving a created, unconfined directory tree on
# disk. cmdCancel/cmdAcceptResult now run a PRELIMINARY, discarded
# accreditation before withLock precisely to reject (with NO mutation at all)
# before acquireLock's mkdir ever runs for an invalid path.
@test "RCC-cancel-out-of-root-no-mutation: cancel rejects an out-of-root --request (SECURITY_INVALID) and leaves NO directory created on disk -- not merely fail-closed in status, but fail-closed in effect." {
  local ghost_dir; ghost_dir="$PROJ/totally-unrelated-never-created-$(_gen_hex_id)"
  local ghost_req; ghost_req="$ghost_dir/request.json"
  [ ! -e "$ghost_dir" ]

  _run_cli cancel --coordination-root "$COORD_ROOT" --request "$ghost_req" --reason explicit
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  [ ! -e "$ghost_dir" ]
}

@test "RCC-accept-result-out-of-root-no-mutation: accept-result rejects an out-of-root --request (SECURITY_INVALID) and leaves NO directory created on disk -- same mkdir-before-validate gap as cancel, fixed identically." {
  local ghost_dir; ghost_dir="$PROJ/totally-unrelated-never-created-$(_gen_hex_id)"
  local ghost_req; ghost_req="$ghost_dir/request.json"
  [ ! -e "$ghost_dir" ]

  _run_cli accept-result --coordination-root "$COORD_ROOT" --request "$ghost_req"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  [ ! -e "$ghost_dir" ]
}

# Codex NO-GO round 11 P0(2): a lock token that authenticates ONLY .lock's own
# dev/ino proves ".lock is still the same directory" but never proves txnDir
# ITSELF -- the base every actual read/write path string is built from -- is
# still the same directory. A naive "rename the whole txnDir away" attack
# would ALSO move .lock away with it, making releaseLock's OWN pre-existing
# .lock-identity check fail independently of assertLockedTxnDirIdentity --
# masking whether the NEW check contributed anything (verified empirically:
# mutation-testing this exact scenario with assertLockedTxnDirIdentity
# neutered produced the IDENTICAL observable DURABILITY_UNPROVEN result). To
# genuinely isolate the new check's own contribution, these tests instead
# relocate .lock itself (preserving ITS OWN dev/ino exactly, via `mv`, never
# recreating it) into a substitute directory that also carries a
# byte-identical copy of request.json, then swap the substitute into place
# under txnDir's own name -- so releaseLock's .lock-focused check sees NO
# discrepancy at all, and only txnDir's OWN identity (a different inode,
# despite .lock inside it being the exact same one) has changed.
@test "RCC-cancel-txndir-identity-rename-mid-lock: cancel detects txnDir itself being swapped for a substitute directory (byte-identical content, .lock's own inode deliberately preserved) while the lock is held, and fails closed instead of reading/writing the substitute." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-in-lock-pre-read \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-in-lock-pre-read

  # The lock is genuinely held (acquireLock already returned) at this point.
  # Relocate .lock (preserving its own inode) + a byte-identical request.json
  # copy into a fresh substitute directory, then swap the substitute into
  # txnDir's own name.
  mkdir "$txn_dir.substitute"
  mv "$txn_dir/.lock" "$txn_dir.substitute/.lock"
  cp "$txn_dir/request.json" "$txn_dir.substitute/request.json"
  rm -rf "$txn_dir"
  mv "$txn_dir.substitute" "$txn_dir"

  touch "$txn_dir/.rendezvous-cancel-in-lock-pre-read-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (txnDir identity changed while locked, .lock itself untouched), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ ! -e "$txn_dir/cancel.json" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-txndir-identity-rename-mid-lock: accept-result detects txnDir itself being swapped for a substitute directory (byte-identical content, .lock's own inode deliberately preserved) while the lock is held, and fails closed instead of reading/writing the substitute." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-in-lock-pre-read \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-in-lock-pre-read

  # Preserve the results/ subdirectory too so a bypass would find a genuine,
  # byte-identical candidate result waiting -- proving the swap is otherwise
  # completely unremarkable content-wise, only the directory's own identity differs.
  mkdir "$txn_dir.substitute"
  mv "$txn_dir/.lock" "$txn_dir.substitute/.lock"
  cp -R "$txn_dir/request.json" "$txn_dir/results" "$txn_dir.substitute/"
  rm -rf "$txn_dir"
  mv "$txn_dir.substitute" "$txn_dir"

  touch "$txn_dir/.rendezvous-accept-result-in-lock-pre-read-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (txnDir identity changed while locked, .lock itself untouched), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ ! -e "$txn_dir/accepted-result.json" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 12: the mirror-image attack -- .lock ITSELF is deleted and
# recreated (a fresh, different inode) while txnDir is left completely
# UNCHANGED. assertLockedTxnDirIdentity (round 11) checked only txnDir and
# would not catch this; assertLockedScopeIdentity (round 12) checks BOTH
# together. The exact detail_code surfacing to the caller is not asserted
# (releaseLock's own pre-existing .lock-identity check independently detects
# this too, at cleanup time, and withLock's "release-failure is primary"
# priority can surface DURABILITY_UNPROVEN instead of assertLockedScopeIdentity's
# own SECURITY_INVALID depending on exact timing) -- what matters, and what
# actually distinguishes this fix, is that NO cancel.json/accepted-result.json
# is ever written, proven by mutation-testing this exact scenario with
# assertLockedScopeIdentity's own .lock check removed (see round-12 mutation
# notes): without it, the write proceeds to completion before releaseLock ever
# gets a chance to notice anything is wrong.
@test "RCC-cancel-lock-identity-delete-recreate-mid-lock: cancel detects .lock itself being deleted and recreated (a different inode) while txnDir stays unchanged, and writes no cancel.json." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-in-lock-pre-read \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-in-lock-pre-read

  # txnDir itself is completely untouched -- only .lock is deleted and
  # recreated, a fresh, different inode at the same path.
  rmdir "$txn_dir/.lock"
  mkdir "$txn_dir/.lock"

  touch "$txn_dir/.rendezvous-cancel-in-lock-pre-read-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ ! -e "$txn_dir/cancel.json" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-accept-result-lock-identity-delete-recreate-mid-lock: accept-result detects .lock itself being deleted and recreated (a different inode) while txnDir stays unchanged, and writes no accepted-result.json." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local result_f; result_f="$(_result_path "$id" "$aid")"
  local req_digest; req_digest="$(_sha256_file "$req_f")"
  _write_result "$result_f" "$(printf '{"in_reply_to":"%s","root_request_id":"%s","request_digest":"%s","attempt_id":"%s","status":"ANSWERED"}' "$id" "$id" "$req_digest" "$aid")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=accept-result-in-lock-pre-read \
      node "$IMPL" accept-result --coordination-root "$COORD_ROOT" --request "$req_f" >"$out" 2>&1; echo $? >"$rc_file" ) &
  local accept_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" accept-result-in-lock-pre-read

  rmdir "$txn_dir/.lock"
  mkdir "$txn_dir/.lock"

  touch "$txn_dir/.rendezvous-accept-result-in-lock-pre-read-go"
  wait "$accept_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ ! -e "$txn_dir/accepted-result.json" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 12: acquireLock itself takes a COHERENT before/after
# snapshot of txnDir bracketing the .lock mkdir loop -- a stat taken only
# AFTER acquiring (round 11) could already be observing a directory that was
# swapped WHILE this loop was polling (which can run for up to
# LOCK_MAX_WAIT_MS), silently minting a token for the wrong directory. This is
# a property of acquireLock/withLock itself, shared by EVERY command that
# calls it, not just cancel/accept-result -- exercised here via cancel as the
# vehicle, using a fixed, generic rendezvous name (acquireLock has no
# per-command identity to key one on).
@test "RCC-acquire-lock-before-mkdir-loop-detects-txndir-swap: acquireLock detects txnDir being swapped for a fresh, empty directory WHILE its own .lock-mkdir loop is polling, before any token is ever minted." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=acquire-lock-before-mkdir-loop \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" acquire-lock-before-mkdir-loop

  # No .lock exists yet at this point (acquireLock's own mkdir loop has not
  # started). The fresh directory's request.json is HARD-LINKED to the
  # ORIGINAL inode, then the original link is removed -- leaving a SINGLE
  # (nlink==1, never nlink==2's own separately-recognized in-flight state)
  # directory entry that is still the EXACT SAME underlying file (never a
  # copy). This way the separate request-identity check
  # (assertRequestIdentityMatches, a different round-12 fix) sees the exact
  # same file and would not itself flag anything; only THIS check -- txnDir's
  # OWN identity, independent of what request.json inside it resolves to --
  # can catch the swap.
  mv "$txn_dir" "$txn_dir.evil-moved-away"
  mkdir "$txn_dir"
  ln "$txn_dir.evil-moved-away/request.json" "$txn_dir/request.json"
  rm "$txn_dir.evil-moved-away/request.json"

  touch "$txn_dir/.rendezvous-acquire-lock-before-mkdir-loop-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ ! -e "$txn_dir/cancel.json" ]
  [ ! -e "$txn_dir.evil-moved-away/cancel.json" ]

  rm -rf "$txn_dir.evil-moved-away"
  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 14: the before/after coherence check inside acquireLock
# itself used to compare dev/ino only, while the token went on to store the
# AFTER snapshot's mode/uid/gid as the baseline -- a chmod happening DURING
# this exact acquisition window (between the two snapshots) would never be
# caught here, and would be silently adopted as the new "normal" baseline for
# every later assertLockedScopeIdentity call.
@test "RCC-acquire-lock-chmod-during-acquisition-detected: acquireLock detects txnDir being chmod'd WHILE its own before/after acquisition window is open (same inode, only permissions differ), never silently adopting the changed mode as the new baseline." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=acquire-lock-before-mkdir-loop \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" acquire-lock-before-mkdir-loop

  # txnDir itself is NEVER swapped/renamed here -- same inode throughout,
  # only its own permissions change, entirely inside the acquisition window
  # this rendezvous pauses (before txnStBefore's own capture completes vs.
  # after .lock is created and txnStAfter is captured).
  chmod 777 "$txn_dir"

  touch "$txn_dir/.rendezvous-acquire-lock-before-mkdir-loop-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  [ ! -e "$txn_dir/cancel.json" ]

  chmod 700 "$txn_dir" 2>/dev/null || true
  rm -f "$out" "$rc_file"
}

@test "RCC-acquire-lock-symlinked-ancestor-rejected: acquireLock itself rejects a transaction whose txnDir is reached through a SYMLINKED ANCESTOR directory (the plan_digest segment, several levels above txnDir itself), even though the content at the far end of that symlink is otherwise perfectly valid. Uses lease-heartbeat (readRequestForTxnOrCorrelationInvalid, NO assertGenuinelyConfinedUnderRoot preflight of its own, unlike cmdCancel/cmdAcceptResult/cmdTakeover) specifically to ISOLATE acquireLock's own new ancestor walk from that separate, pre-existing realpath-based confinement check -- otherwise a vehicle with its own confinement check would mask whether acquireLock's fix contributes anything (Codex NO-GO round 15: acquireLock previously lstat'd only the final txnDir component; 'acquireLock hace lstat unicamente del txnDir final y despues crea .lock siguiendo ancestros')." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  local real_plan_root; real_plan_root="$(_plan_root)"
  local hidden_plan_root; hidden_plan_root="${real_plan_root}.real-target-outside-lexical-view"
  mv "$real_plan_root" "$hidden_plan_root"
  ln -s "$hidden_plan_root" "$real_plan_root"

  # The content at the FAR END of the symlink is completely valid and
  # unmodified (the exact same request.json this test just wrote) -- only the
  # ancestor path used to REACH it is now symlinked. A lexical-only
  # path.resolve would see nothing wrong; only a real per-component lstat walk
  # detects this.
  [ -L "$real_plan_root" ]
  [ -f "$req_f" ]

  local bogus_claim; bogus_claim="$(_plan_root)/transactions/$id/claims/nonexistent.json"
  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req_f" --claim "$bogus_claim"
  [ "$status" -ne 0 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  rm -f "$real_plan_root"
  mv "$hidden_plan_root" "$real_plan_root"
}

@test "RCC-acquire-lock-nonsymlink-substitute-mid-mkdir-rejected: a REAL (non-symlink) directory substituted for .lock in the narrow window between this invocation's own mkdirSync succeeding and its immediately-following verification is detected and rejected, never silently adopted (Codex NO-GO round 17, P1: O_NOFOLLOW at acquireLock's own post-mkdir open only rejects a SYMLINK substitute -- it does nothing to stop a real directory planted at the exact same path in that gap, which the open would simply succeed against)." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=acquire-lock-post-mkdir-pre-verify \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing >"$out" 2>&1; echo $? >"$rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" acquire-lock-post-mkdir-pre-verify

  # mkdirSync has ALREADY succeeded by this point (the rendezvous fires
  # immediately after it, before this invocation's own verification). Replace
  # the genuine .lock directory it just created with a DIFFERENT real
  # directory at the exact same path -- never a symlink, so O_NOFOLLOW alone
  # cannot reject it; only a dev/ino identity comparison against what mkdir
  # actually created can.
  [ -d "$txn_dir/.lock" ]
  rmdir "$txn_dir/.lock"
  mkdir "$txn_dir/.lock"
  [ -d "$txn_dir/.lock" ]
  [ ! -L "$txn_dir/.lock" ]

  touch "$txn_dir/.rendezvous-acquire-lock-post-mkdir-pre-verify-go"
  wait "$claim_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc -- the substituted .lock directory was accepted, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (non-symlink .lock substitute rejected), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  rm -f "$out" "$rc_file"
}

@test "RCC-lock-ancestor-escape-mid-hold-rejected: a transaction genuinely moved OUTSIDE coordRoot WHILE its lock is held (whole-subtree mv, which preserves txnDir's own dev/ino -- rename never changes inode), with a symlink planted at the ORIGINAL ancestor location pointing back to the new location, is detected and rejected on resume -- not silently accepted, even though txnDir's own identity (dev/ino/mode/uid/gid) is completely unchanged throughout. Uses a FULLY VALID claim fixture (would otherwise reach cmdClaim's own SUCCESS path and its own success-path release) specifically so the rejection cannot be attributed to an unrelated, already-broken fixture (Codex NO-GO round 16, P0, empirically reproduced live: acquireLock's own ancestor walk from round 15 only ran at acquisition; assertLockedScopeIdentity/isValidLockTokenFor/releaseLock never re-verified ancestors afterward, so a token minted before this exact swap remained valid and release succeeded)." {
  local id aid; id="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=with-lock-post-acquire-pre-fn \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing >"$out" 2>&1; echo $? >"$rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" with-lock-post-acquire-pre-fn

  # By this point cmdClaim's own pre-lock claim.json election has ALREADY
  # happened and the lock is genuinely held (acquireLock's own ancestor walk
  # and txnDir before/after coherence check have ALREADY passed cleanly).
  # Absent any tampering, this fixture is complete enough to reach cmdClaim's
  # own SUCCESS path (the active-lease publish + its own success-path
  # release) -- so a rejection below cannot be attributed to an unrelated,
  # already-broken fixture the way an intentionally-bogus path would.
  [ -e "$txn_dir/claims/$aid.json" ]

  # NOW, while still holding the lock, escape coordRoot entirely: move the
  # whole plan-root subtree (which contains txnDir) to a sibling location
  # OUTSIDE coordRoot, then plant a symlink at the ORIGINAL location pointing
  # back.
  local real_plan_root; real_plan_root="$(_plan_root)"
  local outside_root; outside_root="$(dirname "$COORD_ROOT")/escaped-outside-coordroot"
  mv "$real_plan_root" "$outside_root"
  ln -s "$outside_root" "$real_plan_root"

  # txnDir's OWN identity is untouched by this -- confirm the swap is genuine
  # (an ancestor is now a symlink) rather than accidentally a no-op.
  [ -L "$real_plan_root" ]
  [ -d "$txn_dir" ]

  touch "$txn_dir/.rendezvous-with-lock-post-acquire-pre-fn-go"
  wait "$claim_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc -- the transaction escaped coordRoot but was still accepted, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (ancestor escape mid-hold rejected), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  rm -f "$real_plan_root"
  mv "$outside_root" "$real_plan_root"
  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 14: assertLockedScopeIdentity is now called by withLock
# ITSELF, systemically, for all 7 of this file's withLock callers -- not just
# cmdCancel/cmdAcceptResult, which are the only 2 that ever called it
# manually. `claim` is one of the 5 callers (validateActiveLeaseV1,
# cmdLeaseHeartbeat, cmdClaim, cmdTakeover, cmdPublishResult) that had NO
# scope-identity protection of its own -- this test proves it is now
# protected anyway, via withLock's own new, generic 'with-lock-post-acquire-
# pre-fn' rendezvous seam (shared by every caller, not a per-command one).
# The swap is surgical (relocates .lock preserving its own inode, hard-links
# request.json preserving ITS inode) so only txnDir's own identity differs --
# isolating withLock's own new check from anything cmdClaim itself might
# otherwise happen to catch.
@test "RCC-claim-withlock-systemic-txndir-swap-detected: cmdClaim (no scope-identity check of its own) is caught anyway by withLock's own new systemic post-fn check -- the command correctly reports failure and POISONS the lock (retains .lock) even though it has no inline check of its own. NOTE (found empirically this round): withLock's own check runs only at entry/exit, not around individual operations INSIDE fn -- it does NOT prevent the active-lease write itself from landing in the swapped substitute first; it only prevents the transaction from being silently reported SUCCESS and being cleanly released afterward. Only a caller's OWN inline checks (like cmdCancel/cmdAcceptResult's) close that tighter window." {
  local id; id="$(_gen_hex_id)"
  local aid; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=with-lock-post-acquire-pre-fn \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing >"$out" 2>&1; echo $? >"$rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" with-lock-post-acquire-pre-fn

  # By this point cmdClaim's own pre-lock claim.json election has ALREADY
  # happened (the rendezvous fires INSIDE withLock, after acquireLock) --
  # claims/<aid>.json genuinely exists now. It must be preserved (hard-linked,
  # like request.json) into the substitute: cmdClaim's OWN in-lock logic
  # re-reads this claim before attempting the active-lease publish, so if it
  # is missing, the command fails for THAT unrelated reason (CORRELATION_INVALID)
  # regardless of whether withLock's own identity check is active at all --
  # which would not isolate this test's actual claim.
  [ -e "$txn_dir/claims/$aid.json" ]
  mkdir -p "$txn_dir.substitute/claims"
  mv "$txn_dir/.lock" "$txn_dir.substitute/.lock"
  ln "$txn_dir/request.json" "$txn_dir.substitute/request.json"
  ln "$txn_dir/claims/$aid.json" "$txn_dir.substitute/claims/$aid.json"
  rm -rf "$txn_dir"
  mv "$txn_dir.substitute" "$txn_dir"

  touch "$txn_dir/.rendezvous-with-lock-post-acquire-pre-fn-go"
  wait "$claim_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }

  # The active-lease write itself DOES land in the swapped substitute (fn's
  # own publishNoClobber call already ran before withLock's post-fn check
  # ever gets a chance to catch anything) -- what withLock's own systemic
  # check DOES guarantee is that the failure is genuinely REPORTED (never a
  # false SUCCESS) and the lock is POISONED (retained), so no later actor
  # mistakes this transaction for cleanly resolved.
  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-claim-request-substituted-before-election-blocks-durable-slot: request.json is substituted (SAME request_id/initial_attempt_id -- preserving attempt/epoch -- but a DIFFERENT target_role_profile_digest) BETWEEN cmdClaim's own preflight accreditation and its election publish. The invocation itself must fail (SECURITY_INVALID) AND, critically, must NEVER durably publish claim.json at all -- a stale election that fails only AFTER already winning the no-clobber first-writer-wins slot would permanently block the correct claimant (a legitimate second attempt would see EEXIST/AUTHORITY_INVALID regardless of whose data was right) (HARD NO-GO after round 17: the round-17 fix only re-verified identity INSIDE the lock, strictly after this election publish already ran -- it protected the lease, never the election itself)." {
  local id aid; id="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local claim_f; claim_f="$txn_dir/claims/$aid.json"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=claim-preflight-pre-election \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing >"$out" 2>&1; echo $? >"$rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" claim-preflight-pre-election

  # The election has NOT happened yet at this pause point (distinguishing it
  # from the LATER claim-pre-lock rendezvous, which fires after the election).
  [ ! -e "$claim_f" ]

  # SAME request_id/initial_attempt_id (attempt/epoch resolution is
  # unaffected) but a DIFFERENT target_role_profile_digest -- a field baked
  # directly into claim.json, never itself part of attempt/epoch resolution.
  local wrong_digest; wrong_digest="$(printf '9%.0s' {1..64})"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","target_role_profile_digest":"%s"}' "$id" "$id" "$aid" "$wrong_digest")"

  touch "$txn_dir/.rendezvous-claim-preflight-pre-election-go"
  wait "$claim_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (request.json changed since preflight, rejected before the election could durably land), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  # THE critical assertion: no stale claim was left behind to permanently
  # block a legitimate future claimant at this same no-clobber path.
  [ ! -e "$claim_f" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-claim-request-substituted-during-noclobber-write-blocks-durable-slot: request.json is substituted (SAME request_id/initial_attempt_id, DIFFERENT target_role_profile_digest) AFTER publishNoClobber's own mkdir/temp-create/harden/write/fsync/fstat/close sequence has ALREADY completed for this election -- strictly past the point the PRECEDING test's rendezvous pauses at -- but still BEFORE the actual linkSync. The invocation must still fail (SECURITY_INVALID) and never durably publish claim.json (Codex HARD NO-GO round 19: the preceding test's own fix re-accredited request.json only immediately before CALLING publishNoClobber, leaving publishNoClobber's OWN internal sequence -- not instantaneous, especially fsync -- entirely unrevalidated; publishNoClobber's revalidateBeforeLink hook, invoked as the LAST statement before linkSync, closes this further window)." {
  local id aid; id="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local claim_f; claim_f="$txn_dir/claims/$aid.json"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=claim-pre-link-revalidate \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing >"$out" 2>&1; echo $? >"$rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" claim-pre-link-revalidate

  # publishNoClobber's own mkdir/temp-create/harden/write/fsync/fstat/close
  # sequence has ALREADY run by this pause point (this rendezvous fires
  # immediately before its own linkSync call, inside publishNoClobber itself)
  # -- a genuinely owned temp file for this election already exists on disk,
  # proving this pause is genuinely PAST the point the preceding test's
  # rendezvous occupies, not merely re-testing the same window.
  local tmp_count; tmp_count="$(find "$txn_dir/claims" -maxdepth 1 -name '.*.tmp-owner' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$tmp_count" -ge 1 ] || { echo "expected an owned .tmp-owner temp file to already exist in claims/ at this pause point"; ls -la "$txn_dir/claims" 2>&1; false; }
  [ ! -e "$claim_f" ]

  local wrong_digest; wrong_digest="$(printf '9%.0s' {1..64})"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s","target_role_profile_digest":"%s"}' "$id" "$id" "$aid" "$wrong_digest")"

  touch "$txn_dir/.rendezvous-claim-pre-link-revalidate-go"
  wait "$claim_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (request.json changed during publishNoClobber own internal sequence, rejected immediately before the election could durably land), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  # THE critical assertion: no stale claim was left behind to permanently
  # block a legitimate future claimant at this same no-clobber path.
  [ ! -e "$claim_f" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-claim-election-substituted-before-lock-rejected: cmdClaim's own election-then-reread is substituted BETWEEN the pre-lock claim.json publish and the in-lock re-read with a DIFFERENT, still attempt/epoch-matching claim (same attempt_id/lease_epoch/target_role_profile_digest -- only claimant_role differs) -- rejected, never silently adopted as though it were this invocation's own election (Codex NO-GO round 16, P0: the in-lock re-read previously only checked attempt_id/lease_epoch, never that the re-read bytes were the EXACT ones this invocation's own publishNoClobber call actually wrote)." {
  local id aid; id="$(_gen_hex_id)"; aid="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","initial_attempt_id":"%s"}' "$id" "$id" "$aid")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=claim-pre-lock \
      node "$IMPL" claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing >"$out" 2>&1; echo $? >"$rc_file" ) &
  local claim_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" claim-pre-lock

  local claim_f; claim_f="$txn_dir/claims/$aid.json"
  [ -e "$claim_f" ]
  # Read back the REAL, just-elected claim (so every OTHER field -- attempt_id,
  # lease_epoch, target_role_profile_digest, created_at -- is genuinely valid)
  # and rewrite with ONLY claimant_role changed -- a field neither the
  # attempt/epoch check nor (before this fix) anything else ever verified.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.claimant_role = "context-provider";
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$claim_f"

  touch "$txn_dir/.rendezvous-claim-pre-lock-go"
  wait "$claim_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (substituted claim.json rejected), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 13: acquireLock's own fs.mkdirSync(txnDir,{recursive:true})
# was removed entirely -- this is the DIRECT test of that fix, isolated from
# cmdCancel/cmdAcceptResult's OWN separate preflight (which would ALSO catch
# a nonexistent txnDir via its own request.json read, masking whether
# acquireLock's own check contributes anything). lease-heartbeat has NO
# preflight of its own (confirmed by reading cmdLeaseHeartbeat directly --
# every read happens inside withLock), so a rejection here can ONLY come from
# acquireLock itself.
@test "RCC-lease-heartbeat-nonexistent-txndir-no-mutation: lease-heartbeat against a --request whose transaction directory does not exist at all is rejected without acquireLock creating anything (lease-heartbeat has no preflight of its own -- this isolates acquireLock's own fix)." {
  local ghost_dir; ghost_dir="$(_plan_root)/transactions/$(_gen_hex_id)"
  local ghost_req; ghost_req="$ghost_dir/request.json"
  local ghost_claim; ghost_claim="$ghost_dir/claims/deadbeef.json"
  [ ! -e "$ghost_dir" ]

  _run_cli lease-heartbeat --coordination-root "$COORD_ROOT" --request "$ghost_req" --claim "$ghost_claim"
  [ "$status" -ne 0 ]

  [ ! -e "$ghost_dir" ]
}

@test "RCC-heartbeat-post-publish-artifact-substituted-poisons-lock: lease-heartbeat's own post-publish re-check (Codex NO-GO round 16's assertArtifactMatchesReceipt call) detects active-lease.json being SUBSTITUTED (a different, still-schema-valid active-lease/v1 record differing only in heartbeat_interval_seconds) AFTER the refresh publish, and POISONS the lock rather than reporting SUCCESS for a record it never actually wrote (Codex NO-GO round 17: cmdCancel/cmdAcceptResult/cmdTakeover each have a dedicated test proving this exact class of check; cmdLeaseHeartbeat's own equivalent check, though present in the code since round 16, had none)." {
  local id aid; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing --fixed-ids
  [ "$status" -eq 0 ]
  local claim_path; claim_path="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  local lease_path; lease_path="${claim_path/\/claims\///active-leases/}"
  [ -e "$lease_path" ]

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=heartbeat-post-publish-pre-recheck \
      node "$IMPL" lease-heartbeat --coordination-root "$COORD_ROOT" --request "$req_f" --claim "$claim_path" --fixed-ids >"$out" 2>&1; echo $? >"$rc_file" ) &
  local hb_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" heartbeat-post-publish-pre-recheck

  # Read back the REAL, just-refreshed fields (so every correlation-checked
  # field is genuinely valid) and rewrite with ONLY heartbeat_interval_seconds
  # changed -- a field no correlation check inspects.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.heartbeat_interval_seconds = obj.heartbeat_interval_seconds + 1;
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$lease_path"

  touch "$txn_dir/.rendezvous-heartbeat-post-publish-pre-recheck-go"
  wait "$hb_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (substituted active-lease.json is not byte-identical to what was published), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 13: comparing digest+dev+ino alone misses an IN-PLACE
# rewrite that restores the exact original bytes before the later check runs
# -- same inode throughout (dev/ino never differ), same final content
# (digest never differs), yet the file was genuinely mutated in between
# (ctimeNs/mtimeNs DO differ). This test performs exactly that: opens the
# SAME inode, overwrites one byte, then writes the ORIGINAL byte back --
# never unlinking, never changing length -- while cancel is paused genuinely
# inside its held lock.
@test "RCC-cancel-inplace-rewrite-restore-mid-lock: cancel detects request.json being rewritten in place (same inode, byte-for-byte restored before release) and fails closed instead of trusting the byte-identical-but-genuinely-mutated file." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-in-lock-pre-read \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-in-lock-pre-read

  local original_digest; original_digest="$(_sha256_file "$req_f")"
  local original_ino; original_ino="$(_inode_of "$req_f")"
  node -e '
    const fs = require("fs");
    const path = process.argv[1];
    const original = fs.readFileSync(path);
    const fd1 = fs.openSync(path, "r+");
    fs.writeSync(fd1, Buffer.from("X"), 0, 1, 0);
    fs.closeSync(fd1);
    const fd2 = fs.openSync(path, "r+");
    fs.writeSync(fd2, original.slice(0, 1), 0, 1, 0);
    fs.closeSync(fd2);
  ' "$req_f"
  # Sanity: same inode, byte-for-byte identical to the original, throughout --
  # this is genuinely the "restores the exact same bytes" attack, not an
  # accidental content change a plain digest comparison would ALSO catch.
  local restored_digest; restored_digest="$(_sha256_file "$req_f")"
  local restored_ino; restored_ino="$(_inode_of "$req_f")"
  [ "$restored_digest" = "$original_digest" ]
  [ "$restored_ino" = "$original_ino" ]

  touch "$txn_dir/.rendezvous-cancel-in-lock-pre-read-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (in-place rewrite-and-restore is still an illegal mutation), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ ! -e "$txn_dir/cancel.json" ]

  rm -f "$out" "$rc_file"
}

# Codex NO-GO round 13: assertLockedScopeIdentity's own dev/ino check alone
# misses a chmod -- the SAME directory (same inode) can have its own
# ownership/permissions altered while the lock is held, which is genuine
# tampering (e.g. made world-writable) even though dev/ino never move.
@test "RCC-cancel-txndir-chmod-mid-lock: cancel detects txnDir's own permissions being changed (chmod, same inode) while the lock is held, and fails closed instead of proceeding as if nothing changed." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"
  local original_mode; original_mode="$(_mode_of "$txn_dir")"

  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=cancel-in-lock-pre-read \
      node "$IMPL" cancel --coordination-root "$COORD_ROOT" --request "$req_f" --reason explicit >"$out" 2>&1; echo $? >"$rc_file" ) &
  local cancel_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" cancel-in-lock-pre-read

  chmod 777 "$txn_dir"

  touch "$txn_dir/.rendezvous-cancel-in-lock-pre-read-go"
  wait "$cancel_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -eq 3 ] || { echo "expected rc=3 (INVALID), got $rc:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "SECURITY_INVALID") {
      console.error("expected INVALID/SECURITY_INVALID (txnDir chmod mid-lock is still tampering), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ ! -e "$txn_dir/cancel.json" ]

  chmod "$original_mode" "$txn_dir" || { echo "txnDir mode restoration failed: chmod $original_mode $txn_dir"; false; }
  rm -f "$out" "$rc_file"
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

@test "RCC-argv-7 FAIL: an unrecognized flag is rejected (the grammar is closed -- only the frozen flags per subcommand exist, PLAN.md ~L752), USAGE_ERROR/rc2/INVALID_ARGUMENT by analogy with RCC-argv-1..4/6's confirmed pattern for argv-grammar problems. Was RED against an earlier version of root-init (which silently IGNORED an unrecognized --totally-unknown-flag and returned SUCCESS/rc0); the closed-grammar contract is now enforced and this assertion is genuine GREEN, re-verified empirically." {
  local fresh_root="$PROJ/.planning/coordination-unknown-flag"
  _run_cli root-init --coordination-root "$fresh_root" --totally-unknown-flag foo
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
  _assert_stdout_single_json_line
  [ ! -e "$fresh_root" ]
}

# ══════════════════════════════════════════════════════════════════════════
# WP2-new verb argv-grammar recognition. `dispatch` itself is already exercised
# above by CLI-RESULT-04; this section covers the remaining 5: record-delivery,
# publish-blob, publish-result, worker-stop, worker-stop-ack -- all five are
# now registered COMMANDS in runtime-consultation.cjs (WP2 has landed). This
# section deliberately still only asserts each verb is RECOGNIZED, not full
# success (that needs deeper preconditions -- e.g. a real activation/v1 or a
# genuinely staged publish-blob entry -- out of this file's own CLI-CONTRACT
# scope, see header); deep per-verb behavior is covered by
# runtime-consultation-state.bats/-protocol.bats/-bridge.bats instead.
# ══════════════════════════════════════════════════════════════════════════

# Asserts the most recent invocation's envelope is NOT the "subcommand
# unrecognized" shape -- true for every verb below now that WP2 has landed.
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

@test "RCC-newverb-record-delivery: record-delivery is a recognized subcommand" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local attempt; attempt="$(_gen_hex_id)"

  _run_cli record-delivery --coordination-root "$COORD_ROOT" --request "$f" --attempt "$attempt" \
    --epoch 0 --driver claude-sendmessage --outcome possibly-delivered --commit-point sendmessage-returned
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-record-delivery-rejects-noop: record-delivery for the noop driver is rejected (PLAN.md ~L779: 'Requester record-delivery is rejected for either Codex branch or noop')" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local attempt; attempt="$(_gen_hex_id)"

  _run_cli record-delivery --coordination-root "$COORD_ROOT" --request "$f" --attempt "$attempt" \
    --epoch 0 --driver noop --outcome noop --commit-point none
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "INVALID_ARGUMENT"
}

@test "RCC-newverb-publish-blob: publish-blob is a recognized subcommand" {
  _run_cli publish-blob --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
    --subject-bundle "$SUBJECT_BUNDLE_FILE" --entry fixture-entry.txt
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-publish-result: publish-result is a recognized subcommand (only the two flags common to every other transaction-scoped command are asserted here -- see header note on the un-located two-native-target-form sub-table)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"

  _run_cli publish-result --coordination-root "$COORD_ROOT" --request "$f" --claim "$COORD_ROOT/nonexistent-claim.json" --content "$(printf 'fixture content' | _base64url_encode)"
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-publish-result-post-publish-artifact-substituted-poisons-lock: publish-result's own post-publish re-check (Codex NO-GO round 16's assertArtifactMatchesReceipt call) detects the just-published result.json being SUBSTITUTED (a different, still-schema-valid result/v2 record differing only in driver) AFTER publish, and POISONS the lock rather than reporting SUCCESS for a record it never actually wrote (Codex NO-GO round 17: cmdCancel/cmdAcceptResult/cmdTakeover each have a dedicated test proving this exact class of check; cmdPublishResult's own equivalent check, though present in the code since round 16, had none)." {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local txn_dir; txn_dir="$(dirname "$req_f")"

  _run_cli claim --coordination-root "$COORD_ROOT" --request "$req_f" --role arch-testing --fixed-ids
  [ "$status" -eq 0 ]
  local claim_path; claim_path="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"

  local content_b64; content_b64="$(printf 'original content' | _base64url_encode)"
  local out rc_file; out="$(mktemp)"; rc_file="$(mktemp)"
  ( set +e; env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
      RUNTIME_CONSULTATION_TEST_RENDEZVOUS=publish-result-post-publish-pre-recheck \
      node "$IMPL" publish-result --coordination-root "$COORD_ROOT" --request "$req_f" --claim "$claim_path" --content "$content_b64" --fixed-ids >"$out" 2>&1; echo $? >"$rc_file" ) &
  local pr_pid=$!

  _wait_for_rendezvous_ready "$txn_dir" publish-result-post-publish-pre-recheck

  local result_path; result_path="$(find "$txn_dir/results" -name '*.json' | head -1)"
  [ -n "$result_path" ]
  [ -e "$result_path" ]

  # Read back the REAL, just-published fields (so every correlation-checked
  # field is genuinely valid) and rewrite with ONLY driver changed -- a field
  # no correlation check inspects.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.driver = obj.driver + "-substituted";
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$result_path"

  touch "$txn_dir/.rendezvous-publish-result-post-publish-pre-recheck-go"
  wait "$pr_pid"
  local rc; rc="$(cat "$rc_file")"
  [ "$rc" -ne 0 ] || { echo "expected a non-zero (failure) rc, got 0:"; cat "$out"; false; }
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status !== "INVALID" || data.detail_code !== "AUTHORITY_INVALID") {
      console.error("expected INVALID/AUTHORITY_INVALID (substituted result.json is not byte-identical to what was published), got: " + process.argv[1]);
      process.exit(1);
    }
  ' "$(cat "$out")"

  [ -d "$txn_dir/.lock" ]

  rm -f "$out" "$rc_file"
}

@test "RCC-newverb-worker-stop-session: worker-stop --kind session-shutdown (no --request) is a recognized subcommand" {
  local wsid; wsid="$(_gen_hex_id_32)"
  _run_cli worker-stop --coordination-root "$COORD_ROOT" --role test-specialist --worker-session "$wsid" --kind session-shutdown
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-worker-stop-transaction: worker-stop --kind transaction (with --request, per the conditional grammar) is a recognized subcommand" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local wsid; wsid="$(_gen_hex_id_32)"

  _run_cli worker-stop --coordination-root "$COORD_ROOT" --role arch-testing --worker-session "$wsid" --kind transaction --request "$f"
  _assert_stdout_single_json_line
  _assert_not_unknown_command
}

@test "RCC-newverb-worker-stop-ack: worker-stop-ack is a recognized subcommand" {
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

@test "RCC-caps-1 FAIL: a --coordination-root path token exceeding 2048 UTF-8 bytes is rejected as INVALID/rc3/INVALID_ARGUMENT with no write, per PLAN.md ~L754's 'Core checks caps before decode/allocation'. Was RED against an earlier version of the implementation (the oversized path propagated to a lower-level failure caught generically as INTERNAL/rc7 instead of this clean pre-decode rejection); the cap is now checked proactively and this assertion is genuine GREEN, re-verified empirically." {
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

@test "RCC-caps-2 FAIL: total post-hook argv exceeding 131072 UTF-8 bytes (POSIX) is rejected as INVALID/rc3/INVALID_ARGUMENT with no write, before decode as PLAN.md ~L754 mandates. Was RED against an earlier version of the implementation (this exact oversized intent was instead rejected as SCHEMA_INVALID, the downstream per-field question<=8192-byte cap firing after decode); the total-argv cap is now checked proactively and this assertion is genuine GREEN, re-verified empirically." {
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
