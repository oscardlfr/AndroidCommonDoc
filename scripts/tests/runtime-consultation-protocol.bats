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
# STATUS (current, exact -- verify with `bats --count` / `bats --formatter tap`
# rather than trusting this comment): 53 pass, 0 skip, 0 `not ok`.
# `scripts/lib/runtime-consultation.cjs` is fully implemented; this file's
# original RED-before-WP1-landing status (the module did not exist) is
# history, not current state -- see git log, not this comment, for when WP1
# landed. These tests were written against the EXACT frozen contract and
# remain so now that it is the current, passing state.
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
#     `--fixed-clock`). CORRECTED (M7 completeness, 2026-08-09): WP1/WP4's
#     `role-command-grant/v1` authority layer (tested by `runtime-consultation-role-gate.bats`,
#     not this file) is NOT bypassable under the test capability -- empirically confirmed:
#     `validateAndConsumeRoleCommandGrantForCommand` (runtime-consultation.cjs) runs
#     unconditionally in main(), with no isTestCapability() exemption of its own. This
#     file's own ORIGINAL assumption otherwise was never actually implemented as such,
#     and broke wholesale once `validate`/`publish-request`/`publish-blob` (this file's
#     own three CLI-under-test surfaces) joined the FULL 18-command grant matrix. Every
#     invocation now routes through `runtime-consultation-grant-wrapper.cjs`
#     (`$GRANT_WRAPPER`, not `$IMPL` directly) -- the SAME transparent grant-injecting
#     fixture `runtime-consultation-cli.bats`/`-roots.bats`/`-state.bats` already use for
#     the identical reason -- so this file's own protocol/schema assertions are still
#     genuinely reached, unaffected by the authority layer, exactly as originally
#     intended (just via the wrapper, not literal bypass).
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
# M67-SUPERVISOR-TURN-CONTRACT-01 (M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821):
# the model-facing turn-contract text lives in runtime-bridge-codex.cjs, not
# this file's own $IMPL -- required directly, same rationale as $IMPL above.
BRIDGE="$BATS_TEST_DIRNAME/../lib/runtime-bridge-codex.cjs"
# M7 completeness (2026-08-09): every invocation below routes through this
# transparent grant-injecting wrapper, not $IMPL directly -- see the header
# note above for why. Mirrors runtime-consultation-cli.bats/-roots.bats/
# -state.bats's own identical fixture exactly.
GRANT_WRAPPER="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"
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

_assert_isolated_runtime_tmp() {
  local dir="$1"
  local real_dir real_bats
  real_dir="$(cd "$dir" 2>/dev/null && pwd -P)" || return 1
  real_bats="$(cd "$BATS_TEST_TMPDIR" && pwd -P)" || return 1
  case "$real_dir" in
    "$real_bats"|"$real_bats"/*) ;;
    *) echo "# runtime-tmp escaped BATS_TEST_TMPDIR: $real_dir not under $real_bats" >&2; return 1 ;;
  esac
  node -e '
    const fs = require("fs");
    let st;
    try { st = fs.lstatSync(process.argv[1]); } catch (err) { console.error("runtime-tmp stat failed: " + err.message); process.exit(1); }
    if (st.isSymbolicLink()) { console.error("runtime-tmp is a symlink"); process.exit(1); }
    if (!st.isDirectory()) { console.error("runtime-tmp is not a directory"); process.exit(1); }
    if ((st.mode & 0o777) !== 0o700) { console.error("runtime-tmp wrong mode: " + (st.mode & 0o777).toString(8)); process.exit(1); }
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) { console.error("runtime-tmp wrong owner"); process.exit(1); }
  ' "$dir"
}

setup() {
  RUNTIME_TMP="$BATS_TEST_TMPDIR/runtime-tmp"
  mkdir -p "$RUNTIME_TMP"
  chmod 0700 "$RUNTIME_TMP"
  _assert_isolated_runtime_tmp "$RUNTIME_TMP"
  export TMPDIR="$RUNTIME_TMP"

  PROJ="$(mktemp -d)"
  # GRANT_WRAPPER's own scope-resolution env var (read only by that script,
  # never by production) -- exported once here so every subsequent
  # `node "$GRANT_WRAPPER" ..." call in this test automatically resolves the
  # correct worktree/PLAN scope. Mirrors runtime-consultation-cli.bats's own
  # identical export-once convention.
  export RCC_GRANT_PROJECT_ROOT="$PROJ"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs" "$PROJ")"

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

  # Best-effort root init; failure here is swallowed since several tests below
  # re-init their own fresh root anyway -- every @test independently asserts
  # its own exit-code/JSON-shape expectations, not via setup() succeeding.
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" root-init --coordination-root "$COORD_ROOT" >/dev/null 2>&1 || true
}

teardown() {
  if [ -n "$RUNTIME_TMP" ] && _assert_isolated_runtime_tmp "$RUNTIME_TMP" >/dev/null 2>&1; then
    # M6+M7 SIXTEENTH Phase 2B follow-up: some fixtures materialize a
    # deliberately read-only projection under here (e.g. a role-read-view,
    # part of the production isolation model's own security posture) --
    # restore owner write+traverse on every path THIS test created before
    # sweeping, or a bare rm -rf leaves permission-denied debris behind
    # (which then also makes bats' own outer per-test tmpdir cleanup fail
    # non-silently).
    chmod -R u+rwX "$RUNTIME_TMP" 2>/dev/null || true
    rm -rf "$RUNTIME_TMP"
  fi
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

# Frozen-base-relative ISO timestamp: the CLI's own `--fixed-clock` default base
# (`2025-01-01T00:00:00.000Z`, RUNTIME_CONSULTATION_FAKE_CLOCK not overridden by
# this file) plus N milliseconds, computed entirely via node -- never shell
# `date`/`_iso_plus_seconds`. `--fixed-clock` is now genuinely wired (WP2
# fake-clock/fixed-ids seam): `nowIso()` freezes every emitted `created_at` to
# that exact base under `--fixed-clock`, so a `consult/v2` fixture's `expiry`
# must be computed relative to THAT frozen base (not real wall-clock time) to
# satisfy `CONSULT_V2_FIELDS.expiry.check`'s `120 <= (expiry-created_at) <=
# 3600` window -- otherwise a real-now-relative expiry sits over a year outside
# that window and trips SCHEMA_INVALID. Node (not shell `date`) also sidesteps
# the documented BSD/macOS `date -j` fallback bug in `_iso_plus_seconds`
# (`runtime-consultation-cli.test.js`'s own header note: `-v"+${n}S"` placed
# after the positional date string is silently mis-parsed on this machine's
# `/bin/date`). Used only by fixtures that keep `--fixed-clock` active for
# their publish-request call -- fixtures that drop `--fixed-clock` (Finding D3:
# a second same-plan-root `--fixed-ids` publish-request would otherwise mint
# the identical deterministic request_id and lose the no-clobber race) keep
# their original real-time-relative `_iso_plus_seconds` computation instead.
_frozen_iso_plus_ms() {
  node -e 'process.stdout.write(new Date(Date.parse("2025-01-01T00:00:00.000Z") + Number(process.argv[1])).toISOString())' "$1"
}

# base64url-encodes stdin. Node's own Buffer "base64url" encoding is used deliberately --
# the CLI ABI's `--intent`/`--content` flags are documented as base64url, and the real
# implementation will use the same Node primitive, so this stays byte-consistent with it.
_base64url_encode() {
  node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))'
}

# Codex NO-GO round 3 (blocker 2, cleanup item 6): a full recursive disk snapshot
# {path, type, mode, digest} of everything under $1, sorted, one line per entry --
# for proving a FAILED call caused literally ZERO bytes of mutation, not merely that
# a transaction-directory COUNT stayed the same (a directory count misses a
# same-count same-directory content SWAP, and misses growth in EXISTING directories
# like routing-policies/ or subject-bundles/ entirely).
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
      created_at: "2025-01-01T00:05:00Z",
      pattern_evidence_dependency: null
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
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
    node "$GRANT_WRAPPER" validate --coordination-root "$COORD_ROOT" --kind "$kind" --artifact "$artifact"
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
# both harness-only fixes (no impl file touched), covered by RCP-artifactv2-1's initial regression:
#   - Default value: NOT the spec's literal `"${2:-\{\}}"` -- verified empirically that
#     bash's brace-escaping inside a default-value expansion drops only the SECOND
#     backslash, producing the 3-char string `\{}` (invalid JSON) whenever the caller omits
#     $2, which 4 of the 5 cases below do. Replaced with a plain -z guard.
#   - runtimeConsultationPath: always explicitly defaulted to $GRANT_WRAPPER (M7
#     completeness, 2026-08-09 -- was $IMPL, the real CLI under test), NOT left to
#     isV2InboxRefCandidateValid's own
#     `path.join(ctx.projectRoot, 'scripts', 'lib', 'runtime-consultation.cjs')` fallback.
#     This file's $PROJ fixture (mktemp -d + bare `git init`, per setup()) intentionally has
#     no scripts/lib/ of its own -- passing $PROJ as ctx.projectRoot without this override
#     made the fallback resolve to a path that never exists, so the delegate spawnSync
#     always failed regardless of candidate content (proven by RCP-artifactv2-1 going regression:
#     a well-formed, fresh candidate returned false instead of true). RCP-artifactv2-4 still
#     independently overrides this same field to a genuinely-broken path via extra_ctx_json
#     (Object.assign below applies overrides AFTER this default, so it wins as intended).
#     $GRANT_WRAPPER (not $IMPL) as of M7 completeness: `validate` is now grant-mandatory
#     (PLAN.md §15b) and isV2InboxRefCandidateValid's own delegate spawnSync call carries no
#     grant of its own -- routing through the SAME transparent grant-injecting wrapper this
#     file's own direct CLI calls already use (see file header) lets a well-formed candidate
#     genuinely reach hasValidV2InboxRef's real correlation/freshness logic again.
#     runtimeConsultationPath is a pure ctx parameter isV2InboxRefCandidateValid already
#     accepts for exactly this kind of override -- no production file is touched by this fix.
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
  ' "$HOOK_ARTIFACT" "$dir" "$COORD_ROOT" "$PROJ" "$extra_ctx_json" "$GRANT_WRAPPER"
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

@test "RCP-role-policy-3 (Codex NO-GO round 2 blocker 3, missing-evidence item 5) FAIL: an otherwise-valid child whose ANCESTOR request.json is itself schema-invalid is rejected -- validateRequestGraph's ancestor walk now enforces CONSULT_V2_FIELDS on every parent it reads, not merely parse-and-trust" {
  local root_id; root_id="$(_gen_hex_id)"
  local root_f; root_f="$(_request_path "$root_id")"
  # The ROOT is missing a required CONSULT_V2_FIELDS field (question) -- otherwise a
  # completely ordinary root request the child's own depth/root linkage matches.
  _write_request "$root_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0,"source_role":"test-specialist","target_role":"arch-testing","question":"__OMIT__"}' "$root_id" "$root_id")"

  local child_id; child_id="$(_gen_hex_id)"
  local child_f; child_f="$(_request_path "$child_id")"
  _write_request "$child_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1,"source_role":"test-specialist","target_role":"arch-testing"}' "$child_id" "$root_id" "$root_id")"

  _run_validate consult-v2 "$child_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
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

@test "RCP-inbox-ref-5 (Codex NO-GO round 2 blocker 3, missing-evidence item 5) FAIL: a valid-shaped inbox-ref referencing a request.json that is itself schema-invalid is rejected -- validateInboxRefV1 now enforces CONSULT_V2_FIELDS on the referenced request, not merely a digest match" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  # Deliberately OMIT a required CONSULT_V2_FIELDS field (target_role) -- a request
  # digest can still be computed over these malformed bytes, so a digest match alone
  # would previously have let a shape-invalid request drive correlation.
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"__OMIT__"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing"}' "$id" "$digest")"

  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCP-inbox-ref-6 (Codex NO-GO round 3, blocker 1) FAIL: transactions/A/request.json planted with FULLY VALID bytes copied wholesale from a DIFFERENT request B (durable, shape-valid, even digest-matching once recomputed -- but internally still claims request_id B, not A) is rejected -- content identity must match the storage-path identity, not merely durability+shape+digest" {
  # Request B: fully valid, durable, standing on its OWN canonical path.
  local id_b; id_b="$(_gen_hex_id)"
  local req_b_f; req_b_f="$(_request_path "$id_b")"
  _write_request "$req_b_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id_b" "$id_b")"

  # transactions/A/request.json: request B's EXACT bytes, copied wholesale (not
  # re-derived) -- durable (nlink==1, exact 0600), shape-valid (genuine CONSULT_V2_FIELDS
  # JSON), and the inbox-ref's digest below is recomputed OVER THESE EXACT bytes (so a
  # digest check alone cannot catch this) -- yet the embedded request_id is still "B".
  local id_a; id_a="$(_gen_hex_id)"
  local req_a_f; req_a_f="$(_request_path "$id_a")"
  mkdir -p "$(dirname "$req_a_f")"
  cp "$req_b_f" "$req_a_f"
  chmod 0600 "$req_a_f"
  local digest; digest="$(_sha256_file "$req_a_f")"

  local ref_f; ref_f="$(_inbox_path "arch-testing" "$id_a")"
  _write_inbox_ref "$ref_f" "$(printf '{"request_id":"%s","request_digest":"%s","target_role":"arch-testing"}' "$id_a" "$digest")"

  _run_validate inbox-ref-v1 "$ref_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# coordination-artifact.js hasValidV2InboxRef (v2 branch, Path-Manifest L1289)
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-artifactv2-1 PASS: a well-formed, correlated, fresh inbox-ref/v1 candidate makes hasValidV2InboxRef return true" {
  local id; id="$(_gen_hex_id)"
  local req_f; req_f="$(_request_path "$id")"
  _write_request "$req_f" "$(printf '{"request_id":"%s","root_request_id":"%s","target_role":"arch-testing"}' "$id" "$id")"
  local digest; digest="$(_sha256_file "$req_f")"

  local now; now="$(_iso_now)"
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

  local now; now="$(_iso_now)"
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

  local now; now="$(_iso_now)"
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
  local expiry intent intent_b64
  # Frozen-base-relative (not real-now-relative): this call keeps --fixed-clock,
  # which genuinely freezes created_at to the CLI's default frozen base -- see
  # _frozen_iso_plus_ms's own header note.
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-1 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
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
  local expiry intent intent_b64
  # Frozen-base-relative (not real-now-relative): this ROOT call keeps
  # --fixed-clock, which genuinely freezes created_at to the CLI's default
  # frozen base -- see _frozen_iso_plus_ms's own header note.
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-2 root fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  local root_request_id; root_request_id="$(node -e 'console.log(JSON.parse(process.argv[1]).request_id)' "$output")"

  local now child_expiry child_intent child_intent_b64
  now="$(_iso_now)"
  child_expiry="$(_iso_plus_seconds "$now" 1800)"
  # Same target_role as the root (arch-testing) deliberately -- this test isolates
  # depth/root linkage, not role-policy (see RCP-role-policy-* for that guard).
  child_intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-2 nested fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","parent_request_id":"%s"}' "$child_expiry" "$root_request_id")"
  child_intent_b64="$(printf '%s' "$child_intent" | _base64url_encode)"

  # Deliberately WITHOUT --fixed-ids/--fixed-clock (Finding D3): this child call
  # shares the root call's exact plan-root (same COORD_ROOT/PLAN_FILE/repo/wave),
  # and the deterministic id counter resets to 0 every fresh process -- a second
  # --fixed-ids publish-request here would mint the IDENTICAL request_id the
  # root call already consumed and lose the no-clobber race against its own
  # transactions/<id>/request.json (AUTHORITY_INVALID, not SUCCESS). This call
  # therefore gets a REAL random request_id and a REAL wall-clock created_at (so
  # its own real-time-relative child_expiry above, unchanged, stays valid) --
  # this test's actual subject (root/parent/depth linkage) needs no determinism
  # on the child at all.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$child_intent_b64"
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
  now="$(_iso_now)"
  expiry="$(_iso_plus_seconds "$now" 1800)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-3 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","request_id":"caller-chosen-id-not-allowed"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -ne 0 ]
  # Either INVALID_ARGUMENT (argv/intent decode-time) or SCHEMA_INVALID (intent-object
  # additionalProperties:false) are plausible for this exact rejection -- assert the
  # certain part (status/ok/shape), not a specific detail_code.
  _assert_cli_result "INVALID" ""
}

@test "RCP-publish-4 PASS: two textually-different valid subject-bundle manifests at the same git HEAD produce different subject_scope_digest values (real-content digest, not a HEAD-only placeholder)" {
  local frozen_expiry now real_expiry
  # Frozen-base-relative for the FIRST (--fixed-clock) call; real-time-relative
  # for the SECOND (Finding D3 -- see below).
  frozen_expiry="$(_frozen_iso_plus_ms 1800000)"
  now="$(_iso_now)"
  real_expiry="$(_iso_plus_seconds "$now" 1800)"

  local bundle_a bundle_b
  bundle_a="$PROJ/.planning/coordination-subject-bundle-a.json"
  bundle_b="$PROJ/.planning/coordination-subject-bundle-b.json"
  _write_subject_bundle "$bundle_a" '{"entries":[{"path":"fixture-a.txt"}]}'
  _write_subject_bundle "$bundle_b" '{"entries":[{"path":"fixture-b.txt"}]}'

  local intent_a intent_a_b64
  intent_a="$(printf '{"target_role":"arch-testing","question":"RCP-publish-4 fixture question A","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$frozen_expiry")"
  intent_a_b64="$(printf '%s' "$intent_a" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$bundle_a" --intent "$intent_a_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local output_a="$output"

  local intent_b intent_b_b64
  intent_b="$(printf '{"target_role":"arch-testing","question":"RCP-publish-4 fixture question B","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$real_expiry")"
  intent_b_b64="$(printf '%s' "$intent_b" | _base64url_encode)"
  # Deliberately WITHOUT --fixed-ids/--fixed-clock (Finding D3): this call
  # shares bundle_a's exact plan-root (same COORD_ROOT/PLAN_FILE/repo/wave --
  # subject-bundle content never affects plan-root, only subject_scope_digest),
  # and the deterministic id counter resets to 0 every fresh process -- a
  # second --fixed-ids publish-request here would mint the IDENTICAL
  # request_id the FIRST call already consumed and lose the no-clobber race
  # against its own transactions/<id>/request.json (AUTHORITY_INVALID, not
  # SUCCESS). A REAL random request_id plus a REAL wall-clock created_at
  # (pairing with the real-time-relative real_expiry above) sidesteps the
  # collision entirely while still proving this test's actual subject: two
  # different subject-bundle manifests produce two different
  # subject_scope_digest values.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$bundle_b" --intent "$intent_b_b64"
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

@test "RCP-publish-5 FAIL (Gap#2): publish-request rejects a fabricated content_ref (blob!=digest, no real backing blob file) at publish time, not only via a later validate call" {
  local expiry intent intent_b64
  # Frozen-base-relative (not real-now-relative): keeps --fixed-clock, which
  # genuinely freezes created_at to the CLI's default frozen base -- see
  # _frozen_iso_plus_ms's own header note.
  expiry="$(_frozen_iso_plus_ms 1800000)"
  local fake_blob fake_digest
  fake_blob="$(printf 'a%.0s' {1..64})"
  fake_digest="$(printf 'b%.0s' {1..64})"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-5 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","content_ref":{"blob":"%s","digest":"%s","size":11}}' "$expiry" "$fake_blob" "$fake_digest")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
  # Fail-closed: no transaction was ever materialized for this rejected publish
  # (mirrors this file's own established "no partial write on rejection" convention).
  local txns_dir; txns_dir="$(_plan_root)/transactions"
  [ ! -d "$txns_dir" ]
}

@test "RCP-publish-6 PASS (Gap#2 contrast): publish-request accepts a REAL content_ref produced by an actual publish-blob call first" {
  local blob_entry_rel="rcp-publish-6-fixture-entry.txt"
  local blob_content="RCP-publish-6 real blob content, produced via the actual publish-blob CLI verb"
  printf '%s' "$blob_content" > "$PROJ/$blob_entry_rel"
  local blob_size; blob_size="$(wc -c < "$PROJ/$blob_entry_rel" | tr -d ' ')"
  local blob_digest; blob_digest="$(_sha256_file "$PROJ/$blob_entry_rel")"

  local blob_bundle_file; blob_bundle_file="$PROJ/.planning/coordination-subject-bundle-rcp-publish-6.json"
  _write_subject_bundle "$blob_bundle_file" "$(printf '{"entries":[{"path":"%s","size":%s,"digest":"%s"}]}' "$blob_entry_rel" "$blob_size" "$blob_digest")"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-blob --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$blob_bundle_file" --entry "$blob_entry_rel"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"

  local expiry intent intent_b64
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-6 fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","content_ref":{"blob":"%s","digest":"%s","size":%s}}' "$expiry" "$blob_digest" "$blob_digest" "$blob_size")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock

  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  node -e '
    const fs = require("fs");
    const data = JSON.parse(process.argv[1]);
    const expectedDigest = process.argv[2];
    const req = JSON.parse(fs.readFileSync(data.artifact_ref, "utf8"));
    if (!req.content_ref) { console.error("published request is missing content_ref"); process.exit(1); }
    if (req.content_ref.blob !== expectedDigest) { console.error("content_ref.blob mismatch"); process.exit(1); }
  ' "$output" "$blob_digest"
}

@test "RCP-publish-7 (Codex NO-GO round 3, blocker 2) FAIL: publish-request with parent_request_id rejects a schema-invalid PARENT -- SCHEMA_INVALID, and a FULL disk snapshot proves literally ZERO bytes were written anywhere (not even planRoot/plan_ref/routing-policy/subject-bundle materialization)" {
  # The parent is written via DIRECT fixture (_write_request), NEVER through a real
  # `publish-request` call -- this plan_root has had NOTHING published against it
  # yet, so plan_ref/routing-policies/subject-bundles genuinely do not exist before
  # this test's own single CLI call. (The prior version of this test called
  # `publish-request` for the root FIRST, which itself materialized those three
  # shared artifacts as a side effect -- the child's own, later, redundant
  # materialization calls are idempotent no-ops against already-existing files, so
  # counting transaction directories alone could never observe their growth. Codex's
  # own repro: parent schema-invalid -> rc3/SCHEMA_INVALID, but the persistent
  # inventory still grew from 3 to 9 entries under the write-before-validate order
  # this test's OWN prior version could not detect.)
  local id_a; id_a="$(_gen_hex_id)"
  local req_a_f; req_a_f="$(_request_path "$id_a")"
  # Deliberately OMIT a required CONSULT_V2_FIELDS field (question).
  _write_request "$req_a_f" "$(printf '{"request_id":"%s","root_request_id":"%s","question":"__OMIT__"}' "$id_a" "$id_a")"

  local before; before="$(_snapshot_tree "$COORD_ROOT")"

  local now child_expiry child_intent child_intent_b64
  now="$(_iso_now)"
  child_expiry="$(_iso_plus_seconds "$now" 1800)"
  child_intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-7 nested fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","parent_request_id":"%s"}' "$child_expiry" "$id_a")"
  child_intent_b64="$(printf '%s' "$child_intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$child_intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"

  local after; after="$(_snapshot_tree "$COORD_ROOT")"
  [ "$before" = "$after" ]
}

@test "RCP-publish-8 (Codex NO-GO round 4) FAIL: publish-request with parent_request_id rejects a PARENT that is itself closed-shape/durable/canonically-identified but has an INVALID terminal-root shape (parent_request_id:null, depth:0, yet root_request_id != request_id) -- rc3/CORRELATION_INVALID, full disk snapshot proves zero mutation" {
  # A structurally root-shaped (parent_request_id:null, depth:0) but internally
  # self-contradictory record: root_request_id deliberately DIFFERENT from its own
  # request_id. Otherwise fully CONSULT_V2_FIELDS-valid, durable, and canonically
  # identified at its own path (request_id matches the transaction directory name) --
  # `readCanonicalRequestRecord`'s own identity check (round 3) does NOT catch this,
  # since it only binds request_id to the STORAGE PATH, never to root_request_id.
  local id_root; id_root="$(_gen_hex_id)"
  local req_root_f; req_root_f="$(_request_path "$id_root")"
  local wrong_root_id; wrong_root_id="$(_gen_hex_id)"
  _write_request "$req_root_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0}' "$id_root" "$wrong_root_id")"

  local before; before="$(_snapshot_tree "$COORD_ROOT")"

  local now child_expiry child_intent child_intent_b64
  now="$(_iso_now)"
  child_expiry="$(_iso_plus_seconds "$now" 1800)"
  child_intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-8 nested fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","parent_request_id":"%s"}' "$child_expiry" "$id_root")"
  child_intent_b64="$(printf '%s' "$child_intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$child_intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"

  local after; after="$(_snapshot_tree "$COORD_ROOT")"
  [ "$before" = "$after" ]
}

@test "RCP-publish-9 (Codex NO-GO round 4, corrected round 5) FAIL: validate --kind consult-v2 on a well-formed LEAF whose ancestor chain terminates at an invalid root TWO HOPS removed (LEAF's own immediate edge is entirely valid) is rejected -- validateRequestGraph's walk re-checks the terminal node's own invariants at whichever hop it is actually encountered, not merely on the walk's first iteration" {
  # Codex NO-GO round 5: the PRIOR version of this test named itself "two hops
  # removed" but its fixture only ever built ROOT -> CHILD (one hop) -- the child's
  # own immediate parent WAS the corrupt root, so validating it exercised the exact
  # same iteration of the walk a direct 1-hop nested request would (the terminal
  # check firing on the walk's very first iteration). It could not distinguish a
  # correct every-iteration check from a bug that only fired correctly on iteration 1.
  # Fixed: a genuine 3-node chain (ROOT -> MID -> LEAF) where LEAF's own immediate
  # edge (to MID) is entirely valid, and only the second hop (MID -> ROOT) discovers
  # ROOT's own invalid terminal shape.
  local id_root; id_root="$(_gen_hex_id)"
  local req_root_f; req_root_f="$(_request_path "$id_root")"
  local wrong_root_id; wrong_root_id="$(_gen_hex_id)"
  _write_request "$req_root_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0}' "$id_root" "$wrong_root_id")"

  local id_mid; id_mid="$(_gen_hex_id)"
  local req_mid_f; req_mid_f="$(_request_path "$id_mid")"
  # MID's own edge to ROOT is entirely valid: depth == root.depth+1, same
  # root_request_id propagated from that (corrupt) root.
  _write_request "$req_mid_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":1}' "$id_mid" "$wrong_root_id" "$id_root")"

  local id_leaf; id_leaf="$(_gen_hex_id)"
  local req_leaf_f; req_leaf_f="$(_request_path "$id_leaf")"
  # LEAF's own immediate edge to MID is ALSO entirely valid: depth == mid.depth+1,
  # same root_request_id. The ONLY corruption anywhere in this fixture is ROOT's own
  # local shape -- reachable exclusively by crossing the non-immediate MID->ROOT edge.
  _write_request "$req_leaf_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":"%s","depth":2}' "$id_leaf" "$wrong_root_id" "$id_mid")"

  _run_validate consult-v2 "$req_leaf_f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "CORRELATION_INVALID"
}

@test "RCP-publish-10 (Codex NO-GO round 5) FAIL: publish-request with parent_request_id rejects a PARENT declaring max_depth:0 (below the frozen ceiling) -- rc3/SCHEMA_INVALID, full disk snapshot proves zero mutation" {
  # Codex NO-GO round 5: max_depth was `isNonNegativeInteger` in CONSULT_V2_FIELDS, so
  # a durable, otherwise-canonical parent with max_depth:0 passed shape validation.
  # Combined with cmdPublishRequest's own `parentObj.max_depth || 2` truthy-fallback
  # bug (0 is falsy in JS), the parent's real, more restrictive ceiling was silently
  # replaced by the default 2, and a nested publish that max_depth:0 should have
  # forbidden outright was accepted (rc0/SUCCESS) and mutated disk. Fixed at the
  # schema layer: max_depth must now be exactly the frozen literal 2
  # (MAX_DEPTH_LIMIT), so this fixture is rejected SCHEMA_INVALID before
  # cmdPublishRequest's own depth comparison is ever reached.
  local id_root; id_root="$(_gen_hex_id)"
  local req_root_f; req_root_f="$(_request_path "$id_root")"
  _write_request "$req_root_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0,"max_depth":0}' "$id_root" "$id_root")"

  local before; before="$(_snapshot_tree "$COORD_ROOT")"

  local now child_expiry child_intent child_intent_b64
  now="$(_iso_now)"
  child_expiry="$(_iso_plus_seconds "$now" 1800)"
  child_intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-10 nested fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","parent_request_id":"%s"}' "$child_expiry" "$id_root")"
  child_intent_b64="$(printf '%s' "$child_intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$child_intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"

  local after; after="$(_snapshot_tree "$COORD_ROOT")"
  [ "$before" = "$after" ]
}

@test "RCP-publish-11 (Codex NO-GO round 5) FAIL: publish-request with parent_request_id rejects a PARENT declaring max_depth:5 (above the frozen ceiling) -- rc3/SCHEMA_INVALID, full disk snapshot proves zero mutation" {
  # A second, distinct max_depth value (neither 0 nor the frozen 2) proves the fix is
  # an exact-match constraint, not a falsy-value special case: a permissive schema
  # plus ONLY the fallback-removed comparison (`depth > parentObj.max_depth`, no
  # `|| 2`) would have let max_depth:5 sail through uncaught (1 > 5 is false) -- only
  # the schema's exact-2 requirement closes this shape.
  local id_root; id_root="$(_gen_hex_id)"
  local req_root_f; req_root_f="$(_request_path "$id_root")"
  _write_request "$req_root_f" "$(printf '{"request_id":"%s","root_request_id":"%s","parent_request_id":null,"depth":0,"max_depth":5}' "$id_root" "$id_root")"

  local before; before="$(_snapshot_tree "$COORD_ROOT")"

  local now child_expiry child_intent child_intent_b64
  now="$(_iso_now)"
  child_expiry="$(_iso_plus_seconds "$now" 1800)"
  child_intent="$(printf '{"target_role":"arch-testing","question":"RCP-publish-11 nested fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s","parent_request_id":"%s"}' "$child_expiry" "$id_root")"
  child_intent_b64="$(printf '%s' "$child_intent" | _base64url_encode)"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$child_intent_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"

  local after; after="$(_snapshot_tree "$COORD_ROOT")"
  [ "$before" = "$after" ]
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
  chmod 0600 "$f"
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
  chmod 0600 "$f"
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

# ── R7 (WP3 item C2 stabilization): single canonical RuntimeTurnEnvelope/v1
# source (PLAN.md ~L932 -- "runtimeTurnEnvelopeSchema(...) in
# runtime-consultation.cjs is the single object used by the local validator
# and deep-equal turn/start.outputSchema"). scripts/lib/runtime-bridge-codex.cjs
# imports this surface (re-exported under its own existing public names) --
# this file proves the canonical implementation itself, independent of the
# bridge, genuinely lives here and behaves correctly (F1/F2). ──

@test "RCP-envelope-1 PASS: runtimeTurnEnvelopeSchema/validateRuntimeTurnEnvelope are genuinely exported from runtime-consultation.cjs (F1)" {
  run node -e '
    const rc = require(process.argv[1]);
    if (typeof rc.runtimeTurnEnvelopeSchema !== "function") { process.stderr.write("runtimeTurnEnvelopeSchema is not exported\n"); process.exit(1); }
    if (typeof rc.validateRuntimeTurnEnvelope !== "function") { process.stderr.write("validateRuntimeTurnEnvelope is not exported\n"); process.exit(1); }
  ' "$IMPL"
  [ "$status" -eq 0 ]
}

@test "RCP-envelope-2 PASS: runtimeTurnEnvelopeSchema's leaf-role branch omits the consult oneOf entirely, called directly against runtime-consultation.cjs (F1/F5)" {
  run node -e '
    const rc = require(process.argv[1]);
    const schema = rc.runtimeTurnEnvelopeSchema("ARCH_VERDICT", []);
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length !== 1) { process.stderr.write("expected exactly one oneOf branch for a leaf role: " + JSON.stringify(schema) + "\n"); process.exit(1); }
    if (schema.oneOf[0].properties.kind.enum[0] !== "terminal-result") { process.stderr.write("wrong sole branch\n"); process.exit(1); }
  ' "$IMPL"
  [ "$status" -eq 0 ]
}

@test "RCP-envelope-3 FAIL: validateRuntimeTurnEnvelope enforces the host UTF-8 byte cap independently of the JSON-Schema character length, called directly against runtime-consultation.cjs (F2)" {
  run node -e '
    const rc = require(process.argv[1]);
    // A single multi-byte character repeated so the STRING LENGTH (65536) is
    // under any naive char-count ceiling, but the UTF-8 BYTE length is 3x
    // over -- proves the host byte check is genuinely independent of a
    // character-count-only guard.
    const content = "é".repeat(65536); // U+00E9 is 2 UTF-8 bytes each.
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content } };
    const res = rc.validateRuntimeTurnEnvelope(env, "K", []);
    if (res.ok) { process.stderr.write("a byte-oversized (char-count-ok) content string was accepted\n"); process.exit(1); }
    if (res.reason !== "answered-content-too-large") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); }
  ' "$IMPL"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M7/WP4 ingestion consumer contract, RED (dispatch arch-testing-20260810T142647Z
# follow-on): validateIngestionResultFor(requestPath, approvalPath, resultPath,
# ctx) -> {valid, reason} -- the NAMED, independently-callable consumer
# function PLAN.md ~L216 itself names (validate_ingestion_result_for(
# request_v1, approval_v1, result_v1) -> valid|reason) and whose full
# correlation contract PLAN.md ~L219 spells out: request.kind and
# approval.request_kind must equal "ingestion"; approval.request_id ==
# request.request_id, decision == "authorized", approver (from) == "user";
# result must be current, from == "doc-updater", to == request.from, and
# carry body fields request_id, request_kind:"ingestion", approval_sha256,
# disposition:written|deduplicated|blocked, audit_status, files_touched, and
# bounded follow_ups. The validator recomputes the exact approval digest,
# rejects a denied/missing/stale/mismatched approval, and treats "written"
# as valid only with non-empty confined files_touched; "deduplicated" is a
# successful no-new-file completion with the existing document reference
# (written_file). A generic schema-valid result/v1 remains compatible but
# cannot by itself complete ingestion (case RCP-D3 below).
#
# Confirmed live: this exact function does not exist anywhere in production.
# coordination-artifact.js's isIngestionResultValid is close in SPIRIT but
# (a) takes an already-parsed obj/reqObj, never raw paths -- a different
# signature than the one this dispatch names; (b) is not exported at all
# (module.exports carries only validate/hasValidConsult/hasValidV2InboxRef);
# and (c) correlates request<->result purely by FILENAME
# (path.basename(resultPath,'.json') as the request id) -- which the NEW
# canonical result path this dispatch requires,
# results/doc-updater/<doc-updater-timestamp-unique>.json, makes
# structurally impossible (the basename is a producer-chosen unique id,
# never the request_id). PLAN.md ~L219's own explicit result body-field list
# (request_id, request_kind) is the field-based correlation mechanism the
# new canonical path requires instead of filename correlation -- this is
# what makes validateIngestionResultFor a genuinely NEW, wider contract, not
# merely isIngestionResultValid renamed.
#
# Every case below is RED for the IDENTICAL top-level reason today (the
# named function does not exist) -- proven via _assert_ingestion_result_for's
# own explicit typeof-function check, never a raw uncaught TypeError/crash.
# Each case still builds a fully realistic, scenario-distinct fixture at the
# canonical requests/ingestion/<id>.json + approvals/<id>.json +
# results/doc-updater/<unique-id>.json paths (never the old, retired
# results/<request-id>.json shape the PRIOR RCP-ingestion-1..4 tests used --
# git history, not this comment, has that prior state -- which is not how
# the real doc-updater producer names files) so the fixture set is
# immediately reusable, case-by-case, the moment the function lands -- this
# mirrors the codebase's own established "propose the minimal interface,
# today it does not exist, which IS the RED" precedent (see
# context-provider-gate.test.js's own Section 4/5 header notes).
#
# MAX_INGESTION_FOLLOW_UPS is this test file's OWN named bound constant
# (dispatch requirement: "the bound lives in the test file as a named
# constant only" -- no second design/spec doc) mirroring PLAN.md ~L219's
# "bounded follow_ups" without PLAN.md itself pinning the exact number.
# ══════════════════════════════════════════════════════════════════════════

MAX_INGESTION_FOLLOW_UPS=16

_ingestion_wave_dir() { printf '%s' "$PROJ/.planning/wave-$WAVE_SLUG"; }
_ingestion_request_path() { printf '%s/requests/ingestion/%s.json' "$(_ingestion_wave_dir)" "$1"; }
_ingestion_approval_path() { printf '%s/approvals/%s.json' "$(_ingestion_wave_dir)" "$1"; }
_ingestion_result_path() { printf '%s/results/doc-updater/%s.json' "$(_ingestion_wave_dir)" "$1"; }

# M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
# arch-testing-20260811T162225Z), Section E / item 8: "Result: ... basename
# conforme exactamente a: ^doc-updater-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{5,}\.json$.
# Actualizar los fixtures positivos para usar esa gramática." Used ONLY by the
# TRUE-expecting ("PASS") ingestion-result fixtures below (RCP-D1/D2/D25) so
# they stay conformant once toolkit-specialist lands the filename-grammar
# check this pass's own RCP-D33 (below) proves is currently absent -- harmless
# pre-fix (no such check exists yet, confirmed by RCP-D33's own RED), and
# required for those three to keep validating true afterward. D3..D32 (all
# FALSE-expecting) are deliberately left on the pre-existing
# "rcp-dN-<hex>.json" naming -- untouched, since a filename-grammar rejection
# would only ever ADD a second, equally-valid reason for their own already-false
# outcome, never flip any of them from false to true.
_ingestion_result_path_canonical() {
  local ts; ts="$(node -e 'process.stdout.write(new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z"))')"
  local hexid; hexid="$(_gen_hex_id)"
  printf '%s/results/doc-updater/doc-updater-%s-%s.json' "$(_ingestion_wave_dir)" "$ts" "$hexid"
}

# Canonical, otherwise-fully-valid ingestion request/v1 (PLAN.md ~L219:
# "request.kind ... must equal ingestion") at the canonical
# requests/ingestion/<id>.json path. overrides (a JSON object string) is
# merged over the defaults; the literal string "__OMIT__" deletes a key --
# same idiom as this file's own pre-existing _write_request/_write_result.
_write_ingestion_request() {
  local out="$1" overrides="$2" req_id="$3"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/request/v1",
      wave_slug: process.argv[3],
      from: "context-provider",
      to: "orchestrator",
      created_at: new Date().toISOString(),
      head: process.argv[4],
      plan_sha256: process.argv[5],
      request_id: process.argv[6],
      kind: "ingestion",
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
  ' "$overrides" "$out" "$WAVE_SLUG" "$SUBJECT_HEAD" "$PLAN_DIGEST" "$req_id"
}

# Canonical approval/v1 (PLAN.md ~L219: "approval.request_kind ... must
# equal ingestion") at the canonical approvals/<id>.json path.
_write_ingestion_approval() {
  local out="$1" overrides="$2" req_id="$3"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/approval/v1",
      wave_slug: process.argv[3],
      from: "user",
      to: "orchestrator",
      created_at: new Date().toISOString(),
      head: process.argv[4],
      plan_sha256: process.argv[5],
      decision: "authorized",
      approver: "user",
      request_id: process.argv[6],
      request_kind: "ingestion",
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
  ' "$overrides" "$out" "$WAVE_SLUG" "$SUBJECT_HEAD" "$PLAN_DIGEST" "$req_id"
}

# Canonical result/v1 at the NEW canonical results/doc-updater/<unique-id>.json
# path (never the retired results/<request-id>.json shape) -- PLAN.md ~L219's
# own required ingestion body-field profile as the default shape, so every
# case below overrides ONLY the single field(s) actually under test.
_write_ingestion_result() {
  local out="$1" overrides="$2" req_id="$3" approval_digest="$4" result_to="$5"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "coordination/result/v1",
      wave_slug: process.argv[3],
      from: "doc-updater",
      to: process.argv[7],
      created_at: new Date().toISOString(),
      head: process.argv[4],
      plan_sha256: process.argv[5],
      status: "done",
      request_id: process.argv[6],
      request_kind: "ingestion",
      approval_sha256: process.argv[8],
      disposition: "written",
      audit_status: "audited",
      files_touched: ["docs/example-ingested.md"],
      follow_ups: [],
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
  ' "$overrides" "$out" "$WAVE_SLUG" "$SUBJECT_HEAD" "$PLAN_DIGEST" "$req_id" "$result_to" "$approval_digest"
}

# Asserts validateIngestionResultFor(requestPath, approvalPath, resultPath,
# ctx) exists AND returns the DESIRED {valid, reason} outcome for this
# scenario. Every named failure path below (function missing, threw, wrong
# shape, wrong valid) is its own explicit, scenario-labeled message -- never
# a raw uncaught crash (bats captures $output on a failing `[ "$status" -eq
# 0 ]` automatically, so $label always surfaces in the failure report).
# pre-fix this exits 1 for every single case (the function does not exist at
# all yet) -- that IS the intended RED.
_assert_ingestion_result_for() {
  local label="$1" request_path="$2" approval_path="$3" result_path="$4" expected_valid="$5"
  run node -e '
    const label = process.argv[1];
    const ca = require(process.argv[2]);
    const requestPath = process.argv[3];
    const approvalPath = process.argv[4];
    const resultPath = process.argv[5];
    const ctx = { slug: process.argv[6], projectRoot: process.argv[7] };
    const expectedValid = process.argv[8] === "true";
    if (typeof ca.validateIngestionResultFor !== "function") {
      console.error("[" + label + "] validateIngestionResultFor is not exported from coordination-artifact.js -- the M7/WP4 ingestion consumer contract (PLAN.md ~L216: validate_ingestion_result_for(request_v1, approval_v1, result_v1) -> valid|reason) does not exist yet as a named, independently-callable function.");
      process.exit(1);
    }
    let result;
    try {
      result = ca.validateIngestionResultFor(requestPath, approvalPath, resultPath, ctx);
    } catch (e) {
      console.error("[" + label + "] validateIngestionResultFor threw instead of returning {valid, reason}: " + (e && e.stack || e));
      process.exit(1);
    }
    if (!result || typeof result.valid !== "boolean") {
      console.error("[" + label + "] validateIngestionResultFor did not return a {valid, reason} shape: " + JSON.stringify(result));
      process.exit(1);
    }
    if (result.valid !== expectedValid) {
      console.error("[" + label + "] expected valid=" + expectedValid + " got valid=" + result.valid + " reason=" + result.reason);
      process.exit(1);
    }
  ' "$label" "$HOOK_ARTIFACT" "$request_path" "$approval_path" "$result_path" "$WAVE_SLUG" "$PROJ" "$expected_valid"
  [ "$status" -eq 0 ]
}

@test "RCP-D1 PASS: a genuinely written result (correct producer/to/correlation/approval digest/non-empty confined files_touched/audit_status) validates true" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  # M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, team-lead-relayed fixture
  # gap, post-Group-3-implementation): _write_ingestion_result's own default
  # files_touched (["docs/example-ingested.md"]) was never actually created
  # on disk -- this positive only ever passed because of the exact
  # 'missing'-tolerant bug Group 3 correctly closed (checkIngestionResultFields
  # now requires disposition:"written" files_touched entries to be genuinely
  # 'ok', never 'missing'). Mirrors RCP-D2's own real-file-creation pattern
  # immediately below.
  local touched_doc="$PROJ/docs/example-ingested.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# Example ingested doc\n' > "$touched_doc"
  # Section E / item 8: canonical basename grammar, since this is a
  # TRUE-expecting fixture (see _ingestion_result_path_canonical's own header note).
  local result_f; result_f="$(_ingestion_result_path_canonical)"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D1" "$req_f" "$appr_f" "$result_f" "true"
}

@test "RCP-D2 PASS: a genuinely deduplicated result referencing an EXISTING document (written_file) validates true" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local existing_doc="$PROJ/docs/already-existing-pattern.md"
  mkdir -p "$(dirname "$existing_doc")"
  printf '# Already-existing pattern doc\n' > "$existing_doc"
  # Section E / item 8: canonical basename grammar, since this is a
  # TRUE-expecting fixture (see _ingestion_result_path_canonical's own header note).
  local result_f; result_f="$(_ingestion_result_path_canonical)"
  _write_ingestion_result "$result_f" "$(printf '{"disposition":"deduplicated","files_touched":[],"written_file":"%s"}' "$existing_doc")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D2" "$req_f" "$appr_f" "$result_f" "true"
}

@test "RCP-D3: generic validate('result',...) alone is NECESSARY but NOT SUFFICIENT to imply ingestion completion -- passes for a base-field-valid-but-forged result at the new canonical path, while validateIngestionResultFor correctly rejects it" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d3-$(_gen_hex_id)")"
  # Forged: wrong producer (from) -- otherwise every generic base/v1 field
  # (schema/wave_slug/to/created_at/head/plan_sha256) is genuinely valid, and
  # this result lives at the NEW unique-id-named canonical path, so the OLD
  # filename-correlation the generic validator's ingestion detection relies
  # on (path.basename(resultPath,'.json') as a request-id lookup) can never
  # even find this fixture's sibling request -- the generic check falls
  # through to its unchanged, pre-existing "non-ingestion result: status
  # only" contract and passes it regardless of the forged producer.
  _write_ingestion_result "$result_f" '{"from":"totally-unrelated-imposter-actor"}' "$req_id" "$appr_digest" "context-provider"

  run node -e '
    const ca = require(process.argv[1]);
    const ok = ca.validate("result", process.argv[2], { slug: process.argv[3], projectRoot: process.argv[4] });
    if (!ok) { console.error("necessary-but-not-sufficient precondition failed: the generic validate(\"result\",...) check was expected to ACCEPT this base-field-valid, new-canonical-path, forged-producer result (proving it cannot by itself imply ingestion completion) but rejected it instead"); process.exit(1); }
  ' "$HOOK_ARTIFACT" "$result_f" "$WAVE_SLUG" "$PROJ"
  [ "$status" -eq 0 ]

  _assert_ingestion_result_for "RCP-D3" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D4 FAIL: result.request_id does not match the request's own request_id" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local wrong_id; wrong_id="$(_gen_hex_id)"
  local result_f; result_f="$(_ingestion_result_path "rcp-d4-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" "$(printf '{"request_id":"%s"}' "$wrong_id")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D4" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D5 FAIL: approval.request_kind is not 'ingestion' (wrong request_kind never authorizes ingestion completion)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{"request_kind":"scope-extension"}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d5-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D5" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D6 FAIL: forged approver -- approval.approver is not 'user'" {
  # M6+M7 requester-authority closure (Group G fix): checkIngestionResultFields
  # requires approver as an EXPLICIT own property, NEVER inferred from `from`
  # (coordination-artifact.js own comment) -- forging `from` alone (the
  # ORIGINAL fixture here) no longer exercises this check at all now that the
  # default template also carries a correct approver:"user"; the genuine
  # forge is on approver itself.
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{"approver":"test-specialist"}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d6-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D6" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D7 FAIL: denied approval (decision=denied) grants zero write/result authority" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{"decision":"denied"}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d7-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D7" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D8 FAIL: missing approval (no approval file at all for this request_id)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  # Deliberately never written.
  local result_f; result_f="$(_ingestion_result_path "rcp-d8-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$(printf '0%.0s' {1..64})" "context-provider"
  _assert_ingestion_result_for "RCP-D8" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D9 FAIL: stale approval (created_at far in the past)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{"created_at":"2020-01-01T00:00:00.000Z"}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d9-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D9" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D10 FAIL: approval-byte digest swap -- result.approval_sha256 is a well-formed-looking but WRONG digest that does not match the real, on-disk approval bytes" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local real_digest; real_digest="$(_sha256_file "$appr_f")"
  # Flip the last hex character -- same length/character-class, genuinely a
  # different value (mirrors this file's own established RCP-ingestion-3 technique).
  local wrong_digest; wrong_digest="$(node -e '
    const real = process.argv[1];
    const last = real.slice(-1);
    const flipped = last === "0" ? "1" : "0";
    process.stdout.write(real.slice(0, -1) + flipped);
  ' "$real_digest")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d10-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$wrong_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D10" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D11 FAIL: wrong result 'from' -- not 'doc-updater'" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d11-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"from":"context-provider"}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D11" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D12 FAIL: wrong result 'to' -- PLAN.md ~L219 requires to == request.from, not merely == request.to" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d12-$(_gen_hex_id)")"
  # The default request's own "from" is context-provider (see
  # _write_ingestion_request's defaults) -- "orchestrator" is the request's
  # own "to", a plausible-but-wrong value distinguishing this exact-source
  # correlation from a looser "any known role" check.
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "orchestrator"
  _assert_ingestion_result_for "RCP-D12" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D13 FAIL: missing audit_status" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d13-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"audit_status":"__OMIT__"}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D13" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D14 FAIL: malformed/empty audit_status (present but empty string)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d14-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"audit_status":""}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D14" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D15 FAIL: non-array follow_ups" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d15-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"follow_ups":"not-an-array"}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D15" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D16 FAIL: follow_ups over MAX_INGESTION_FOLLOW_UPS" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d16-$(_gen_hex_id)")"
  local over_limit_follow_ups; over_limit_follow_ups="$(node -e 'process.stdout.write(JSON.stringify(Array.from({length: Number(process.argv[1]) + 4}, (_, i) => "follow-up-" + i)))' "$MAX_INGESTION_FOLLOW_UPS")"
  _write_ingestion_result "$result_f" "$(printf '{"follow_ups":%s}' "$over_limit_follow_ups")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D16" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D17 FAIL: unsafe/path-traversal file reference in files_touched" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d17-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"files_touched":["../../../../etc/passwd"]}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D17" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D18 FAIL: symlinked file reference in files_touched" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local real_target="$PROJ/docs/real-target-outside-approval.md"
  mkdir -p "$(dirname "$real_target")"
  printf '# real target\n' > "$real_target"
  local symlinked_ref="$PROJ/docs/symlinked-ingested.md"
  ln -s "$real_target" "$symlinked_ref"
  local result_f; result_f="$(_ingestion_result_path "rcp-d18-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" "$(printf '{"files_touched":["%s"]}' "$symlinked_ref")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D18" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D19 FAIL: non-regular file reference in files_touched (a directory, not a file)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local a_dir="$PROJ/docs/a-directory-not-a-file"
  mkdir -p "$a_dir"
  local result_f; result_f="$(_ingestion_result_path "rcp-d19-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" "$(printf '{"files_touched":["%s"]}' "$a_dir")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D19" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D20 FAIL: invalid disposition/status combination (disposition=written with status=blocked)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d20-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"status":"blocked"}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D20" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D21 FAIL: written disposition with MISSING files_touched" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d21-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"files_touched":"__OMIT__"}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D21" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D22 FAIL: written disposition with EMPTY files_touched ([])" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d22-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"files_touched":[]}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D22" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D23 FAIL: deduplicated disposition WITHOUT an existing written_file" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d23-$(_gen_hex_id)")"
  # written_file omitted entirely; a non-existent path would be an equally
  # valid variant of this same case (no genuine backing document either way).
  _write_ingestion_result "$result_f" '{"disposition":"deduplicated","files_touched":[]}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D23" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D24 FAIL: deduplicated disposition with NON-EMPTY files_touched (must be exactly [] for dedup)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local existing_doc="$PROJ/docs/already-existing-pattern-d24.md"
  mkdir -p "$(dirname "$existing_doc")"
  printf '# Already-existing pattern doc\n' > "$existing_doc"
  local result_f; result_f="$(_ingestion_result_path "rcp-d24-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" "$(printf '{"disposition":"deduplicated","files_touched":["docs/example-ingested.md"],"written_file":"%s"}' "$existing_doc")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D24" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D25 PASS (boundary): exactly MAX_INGESTION_FOLLOW_UPS (16) follow_ups validates true" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  # M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, team-lead-relayed fixture
  # gap, post-Group-3-implementation): same gap/fix as RCP-D1 above -- the
  # default files_touched (["docs/example-ingested.md"]) was never actually
  # created on disk.
  local touched_doc="$PROJ/docs/example-ingested.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# Example ingested doc\n' > "$touched_doc"
  # Section E / item 8: canonical basename grammar, since this is a
  # TRUE-expecting fixture (see _ingestion_result_path_canonical's own header note).
  local result_f; result_f="$(_ingestion_result_path_canonical)"
  local exactly_16; exactly_16="$(node -e 'process.stdout.write(JSON.stringify(Array.from({length: Number(process.argv[1])}, (_, i) => "follow-up-" + i)))' "$MAX_INGESTION_FOLLOW_UPS")"
  _write_ingestion_result "$result_f" "$(printf '{"follow_ups":%s}' "$exactly_16")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D25" "$req_f" "$appr_f" "$result_f" "true"
}

@test "RCP-D26 FAIL (boundary): exactly MAX_INGESTION_FOLLOW_UPS+1 (17) follow_ups is rejected" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d26-$(_gen_hex_id)")"
  local exactly_17; exactly_17="$(node -e 'process.stdout.write(JSON.stringify(Array.from({length: Number(process.argv[1]) + 1}, (_, i) => "follow-up-" + i)))' "$MAX_INGESTION_FOLLOW_UPS")"
  _write_ingestion_result "$result_f" "$(printf '{"follow_ups":%s}' "$exactly_17")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D26" "$req_f" "$appr_f" "$result_f" "false"
}

# ══════════════════════════════════════════════════════════════════════════
# M6+M7 FINAL AUTHORITY/ORACLE CORRECTION (2026-08-11, RED phase, dispatch
# team-lead "M6+M7 FINAL AUTHORITY/ORACLE CORRECTION"): Group 3 -- close
# ingestion request/write evidence. Confirmed by direct read (2026-08-11) of
# validateIngestionResultFor/checkIngestionResultFields
# (.claude/hooks/coordination-artifact.js):
#   - no verification anywhere that the CALLER-SUPPLIED requestPath's realpath
#     equals the canonical waveDir/requests/<kind>/<request_id>.json path
#     isApprovalValid (~L435-451) itself internally resolves and validates --
#     validateIngestionResultFor only compares apprObj.request_id !==
#     reqObj.request_id BY VALUE (~L399), never that requestPath IS the file
#     the approval is actually anchored to;
#   - the files_touched loop (~L329-337) explicitly TOLERATES a 'missing'
#     classification (the referenced file does not currently exist on disk)
#     even when disposition==='written', which PLAN.md ~L219 requires to have
#     genuine non-empty CONFINED evidence.
#
# RCP-D4/D8's existing coverage ("wrong request_id VALUE" / "approval file
# absent entirely") does NOT cover this gap -- both keep requestPath pinned
# to the canonical path throughout; team-lead's cases 1/2 are specifically
# about a caller passing a DIFFERENT FILE that merely CLAIMS the same
# request_id value, while the approval's own internal resolution silently
# keeps validating the real, canonical, untouched sibling. RCP-D21/D22 cover
# "files_touched missing/empty" but not "present, confined, and genuinely
# absent from disk" (D28 below) -- a materially different scenario the
# 'missing'-tolerant bug in checkIngestionResultFields specifically produces.
#
# team-lead's cases 4 (symlink), 5 (directory), 6 (traversal), 7 (foreign
# producer from!=='doc-updater'), and 9 (approval digest swap) are ALREADY
# fully covered, unmodified, by this file's own pre-existing RCP-D18, RCP-D19,
# RCP-D17, RCP-D11, and RCP-D10 respectively -- confirmed still green in this
# session's verification run; no new test added for any of them to avoid
# duplicating existing coverage. Case 8 (missing/wrong approver) is PARTLY
# covered by RCP-D6 (wrong VALUE); RCP-D29 below adds the missing half
# (approver key entirely ABSENT, not merely wrong) as a locking-in
# confirmation, since checkIngestionResultFields's own
# `!hasOwnProperty(...) || apprObj.approver !== 'user'` already covers both
# halves in one condition and no existing test isolates the hasOwnProperty
# half specifically.
#
# HARD NO-GO correction (2026-08-11, spec item 7 bullet 3): shadow-approval
# and shadow-result negatives were NOT yet covered by any of the above (D27 is
# a shadow REQUEST -- caller-supplied requestPath pointing at a different
# file, not a shadow approvalPath/resultPath; D28 is a confined-but-nonexistent
# files_touched entry, a materially different scenario). RCP-D30 (shadow
# approval path), RCP-D31 (shadow result path -- extra nesting under
# results/doc-updater/), and RCP-D32 (symlinked result file) below close this
# gap, matching Codex's own empirical repro (approval/result files placed
# under an arbitrary confined shadow/ subdirectory instead of their canonical
# locations both wrongly validate true today).
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-D27 REJECT (regression): a caller-supplied requestPath that is NOT the canonical file the approval is actually anchored to (a 'shadow' request sharing only the SAME request_id VALUE, at a different path, with genuinely different content) must be rejected -- pre-fix it wrongly validates true, because validateIngestionResultFor reads reqObj from whatever path the caller supplies and only ever compares request_id by VALUE against the approval's own (separately, correctly re-resolved) canonical sibling, never confirming requestPath IS that same file" {
  local req_id; req_id="$(_gen_hex_id)"
  # The GENUINE, canonical request -- this is what isApprovalValid itself
  # will independently resolve and validate when it checks the approval below.
  local canonical_req_f; canonical_req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$canonical_req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  # A SEPARATE, non-canonical "shadow" request file, living OUTSIDE
  # requests/ingestion/ entirely, sharing the identical request_id VALUE but
  # genuinely different content (from) -- exactly the "different inode/bytes
  # with the same ID" scenario (cases 1+2 together: same request_id value,
  # different file/path/content, and the caller is the one passing the
  # non-canonical one).
  local shadow_req_f; shadow_req_f="$(_ingestion_wave_dir)/shadow-requests/$req_id.json"
  _write_ingestion_request "$shadow_req_f" '{"from":"totally-different-shadow-opener"}' "$req_id"
  # result.to matches the SHADOW's own "from" (not the canonical request's) --
  # proving the bug reads reqObj from the caller-supplied shadow path, not
  # from whatever the approval is genuinely anchored to.
  local result_f; result_f="$(_ingestion_result_path "rcp-d27-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "totally-different-shadow-opener"
  _assert_ingestion_result_for "RCP-D27" "$shadow_req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D28 REJECT (regression): written disposition whose files_touched entry is a genuinely CONFINED but NONEXISTENT file (present in the array, resolves safely under the project root, but nothing is actually there on disk) must be rejected -- pre-fix it wrongly validates true, because checkIngestionResultFields's files_touched loop explicitly tolerates a 'missing' classification even for disposition==='written', which PLAN.md ~L219 requires to have genuine non-empty confined evidence" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  # Deliberately never created on disk -- but a well-formed, confined,
  # non-traversal, non-symlink relative path (isolates this from RCP-D17/
  # RCP-D18/RCP-D19's own outside/symlink/not-regular scenarios).
  local result_f; result_f="$(_ingestion_result_path "rcp-d28-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{"files_touched":["docs/rcp-d28-genuinely-never-created.md"]}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D28" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D29 FAIL (locking-in): approval.approver key entirely ABSENT (never merely a wrong value, isolates the hasOwnProperty half of checkIngestionResultFields's own '!hasOwnProperty(...) || approver !== user' check from RCP-D6's existing wrong-value half)" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{"approver":"__OMIT__"}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local result_f; result_f="$(_ingestion_result_path "rcp-d29-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D29" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D30 REJECT (regression): an approval file that is well-formed, confined, and correctly correlates by VALUE, but lives at a NON-canonical path (not waveDir/approvals/<request_id>.json -- a 'shadow' location instead) must be rejected -- pre-fix validateIngestionResultFor never verifies approvalPath's realpath equals the canonical approvals/<request_id>.json location, only the generic confined-JSON content checks" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  # Well-formed, otherwise-fully-valid approval content, but planted at a
  # NON-canonical, merely-confined "shadow" location instead of the canonical
  # approvals/<request_id>.json path (mirrors RCP-D27's own "shadow-*" naming
  # convention for its shadow REQUEST fixture).
  local shadow_appr_f; shadow_appr_f="$(_ingestion_wave_dir)/shadow/approvals/$req_id.json"
  _write_ingestion_approval "$shadow_appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$shadow_appr_f")"
  # M6+M7 FINAL AUTHORITY CORRECTION-style fixture fix (same gap/fix as
  # RCP-D1/RCP-D25 above): _write_ingestion_result's own default files_touched
  # (["docs/example-ingested.md"]) is never actually created on disk by
  # default -- without this, the result fails closed for the WRONG reason
  # (files_touched 'missing' classification, already correctly rejected by
  # the pre-existing Group 3 fix) before ever reaching the approvalPath
  # canonicalization check this test means to isolate.
  local touched_doc="$PROJ/docs/example-ingested.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# Example ingested doc\n' > "$touched_doc"
  local result_f; result_f="$(_ingestion_result_path "rcp-d30-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" '{}' "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D30" "$req_f" "$shadow_appr_f" "$result_f" "false"
}

@test "RCP-D31 REJECT (regression): a result file that is well-formed, confined, and correctly correlates by VALUE, but is NOT a direct child of results/doc-updater/ (nested one level deeper, under a shadow/ subdirectory) must be rejected -- pre-fix validateIngestionResultFor never verifies resultPath resolves to a direct child of the canonical results/doc-updater/ directory" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local touched_doc="$PROJ/docs/rcp-d31-example.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# RCP-D31 example\n' > "$touched_doc"
  local shadow_result_f; shadow_result_f="$(_ingestion_wave_dir)/results/doc-updater/shadow/rcp-d31-$(_gen_hex_id).json"
  _write_ingestion_result "$shadow_result_f" "$(printf '{"files_touched":["%s"]}' "$touched_doc")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D31" "$req_f" "$appr_f" "$shadow_result_f" "false"
}

@test "RCP-D32 REJECT (regression): a result file that IS ITSELF a symlink (whose target resolves to an otherwise well-formed, correctly-correlated, canonically-located result) must be rejected -- pre-fix validateIngestionResultFor performs no fs.lstatSync symlink check on resultPath itself, only a realpath-following confined-JSON read that transparently follows the link" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local touched_doc="$PROJ/docs/rcp-d32-example.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# RCP-D32 example\n' > "$touched_doc"
  local real_result_f; real_result_f="$(_ingestion_result_path "rcp-d32-real-$(_gen_hex_id)")"
  _write_ingestion_result "$real_result_f" "$(printf '{"files_touched":["%s"]}' "$touched_doc")" "$req_id" "$appr_digest" "context-provider"
  # The symlink itself lives DIRECTLY in results/doc-updater/ (satisfying the
  # "direct child" shape RCP-D31 targets) -- isolates the "must not be a
  # symlink" check specifically.
  local symlinked_result_f; symlinked_result_f="$(_ingestion_wave_dir)/results/doc-updater/rcp-d32-symlink-$(_gen_hex_id).json"
  ln -s "$real_result_f" "$symlinked_result_f"
  _assert_ingestion_result_for "RCP-D32" "$req_f" "$appr_f" "$symlinked_result_f" "false"
}

# ══════════════════════════════════════════════════════════════════════════
# M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
# arch-testing-20260811T162225Z), Section E / item 8: "Result: regular file,
# no FIFO/directorio/socket/symlink; hijo directo de results/doc-updater/;
# basename conforme exactamente a:
# ^doc-updater-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{5,}\.json$." RCP-D19/D31/D32 above
# already cover "regular file"/"direct child"/"never a symlink" respectively.
# The exact basename GRAMMAR itself is confirmed by direct read of
# coordination-artifact.js's own validateIngestionResultFor to be genuinely
# unenforced today -- that function's own comment states this as a deliberate
# design choice: "No separately 'frozen' filename regex exists anywhere in
# production beyond safe-segment + .json -- the system deliberately avoids
# filename-based correlation, relying on body fields instead; do not invent a
# new filename format here." Section E of THIS pass's frozen spec now requires
# exactly that grammar, which is why RCP-D1/D2/D25 above were updated to the
# new _ingestion_result_path_canonical fixture (their own TRUE-expecting
# outcome would otherwise flip to false the moment the fix lands) -- this test
# is the corresponding RED proving the gap still exists today.
# ══════════════════════════════════════════════════════════════════════════

@test "RCP-D33 REJECT (regression, item 8): a result file whose basename does NOT conform to the canonical doc-updater-<8-digit-date>T<6-digit-time>Z-<hex>.json grammar (otherwise a well-formed, direct child of results/doc-updater/, correctly correlated, non-symlinked, genuinely-written result with non-empty confined files_touched) is wrongly accepted as valid pre-fix" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local touched_doc="$PROJ/docs/rcp-d33-example.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# RCP-D33 example\n' > "$touched_doc"
  # Deliberately NON-canonical basename (this file's own pre-existing
  # "rcp-dN-<hex>.json" naming convention, otherwise a direct child of
  # results/doc-updater/, never symlinked, fully correlated) -- the ONLY
  # thing under test here.
  local result_f; result_f="$(_ingestion_result_path "rcp-d33-$(_gen_hex_id)")"
  _write_ingestion_result "$result_f" "$(printf '{"files_touched":["%s"]}' "$touched_doc")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D33" "$req_f" "$appr_f" "$result_f" "false"
}

@test "RCP-D34: a symlink alias to the canonical ingestion request is not itself the canonical request path" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local req_alias="$(_ingestion_wave_dir)/requests/ingestion/alias-$req_id.json"
  ln -s "$req_f" "$req_alias"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local touched_doc="$PROJ/docs/rcp-d34-example.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# RCP-D34 example\n' > "$touched_doc"
  local result_f; result_f="$(_ingestion_result_path_canonical)"
  _write_ingestion_result "$result_f" "$(printf '{\"files_touched\":[\"%s\"]}' "$touched_doc")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D34" "$req_alias" "$appr_f" "$result_f" "false"
}

@test "RCP-D35: a symlink alias to the canonical approval is not itself the canonical approval path" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_alias="$(_ingestion_wave_dir)/approvals/alias-$req_id.json"
  ln -s "$appr_f" "$appr_alias"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local touched_doc="$PROJ/docs/rcp-d35-example.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# RCP-D35 example\n' > "$touched_doc"
  local result_f; result_f="$(_ingestion_result_path_canonical)"
  _write_ingestion_result "$result_f" "$(printf '{\"files_touched\":[\"%s\"]}' "$touched_doc")" "$req_id" "$appr_digest" "context-provider"
  _assert_ingestion_result_for "RCP-D35" "$req_f" "$appr_alias" "$result_f" "false"
}

@test "RCP-D36: a FIFO with a canonical result basename is rejected before any JSON read" {
  local req_id; req_id="$(_gen_hex_id)"
  local req_f; req_f="$(_ingestion_request_path "$req_id")"
  _write_ingestion_request "$req_f" '{}' "$req_id"
  local appr_f; appr_f="$(_ingestion_approval_path "$req_id")"
  _write_ingestion_approval "$appr_f" '{}' "$req_id"
  local appr_digest; appr_digest="$(_sha256_file "$appr_f")"
  local touched_doc="$PROJ/docs/rcp-d36-example.md"
  mkdir -p "$(dirname "$touched_doc")"
  printf '# RCP-D36 example\n' > "$touched_doc"
  local result_f; result_f="$(_ingestion_result_path_canonical)"
  _write_ingestion_result "$result_f" "$(printf '{\"files_touched\":[\"%s\"]}' "$touched_doc")" "$req_id" "$appr_digest" "context-provider"
  local payload; payload="$(cat "$result_f")"
  rm "$result_f"
  mkfifo "$result_f"
  (printf '%s' "$payload" > "$result_f"; printf '%s' "$payload" > "$result_f") &
  local writer_pid=$!
  local assertion_rc=0
  _assert_ingestion_result_for "RCP-D36" "$req_f" "$appr_f" "$result_f" "false" || assertion_rc=$?
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true
  [ "$assertion_rc" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# M67-SUPERVISOR-TURN-CONTRACT-01 (M67-MATRIX3-LIVENESS-REPAIR-FINAL-20260821):
# every host-generated turn must declare, unambiguously, that the host (never
# the model) owns CLI/filesystem/network/MCP/dispatch, that the model must
# not invoke Bash/Read/Grep/Glob/Agent/SendMessage/MCP/web/any native tool,
# and that it returns exactly one RuntimeTurnEnvelope JSON object -- plus the
# per-phase restrictions (architect-initial under context7-required:
# consult-intent only; context-provider-initial under context7-required:
# pattern-gap only; context-provider-resumed: terminal only; architect-
# resumed after an accepted child under context7-required: terminal only).
# Preserved pre-fix RED expectation (current bytes are GREEN): before this
# fix, SUPERVISOR_BASE_INSTRUCTIONS instead told
# the model to "Communicate exclusively through the runtime-consultation.cjs
# CLI" (the model never executes that CLI -- the host does), and none of the
# per-phase turn-input builders said anything about tool use or which envelope
# kind was expected. The __testOnly* seams below are pure, closure-free text
# builders -- exported only under RUNTIME_CONSULTATION_TEST_CAPABILITY (never
# reachable in production), same rationale as this file/runtime-bridge-
# codex.cjs already export several other pure helpers for direct testing.
# ══════════════════════════════════════════════════════════════════════════

@test "M67-SUPERVISOR-TURN-CONTRACT-01a: SUPERVISOR_BASE_INSTRUCTIONS unambiguously states host ownership, the native-tool prohibition, and the exact-one-JSON-object contract, and no longer tells the model to operate the CLI itself" {
  run --separate-stderr env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x \
    node -e '
      const bridge = require(process.argv[1]);
      const text = bridge.__testOnlySupervisorBaseInstructions;
      if (typeof text !== "string" || text.length === 0) { process.stderr.write("SUPERVISOR_BASE_INSTRUCTIONS is not a non-empty string\n"); process.exit(1); }
      const mustContain = [
        "host", "CLI", "filesystem", "network", "MCP", "dispatch",
        "MUST NOT", "Bash", "Read", "Grep", "Glob", "Agent", "SendMessage", "web",
        "RuntimeTurnEnvelope", "exactly one", "Markdown",
      ];
      for (const phrase of mustContain) {
        if (!text.includes(phrase)) { process.stderr.write("missing required phrase " + JSON.stringify(phrase) + " in: " + text + "\n"); process.exit(1); }
      }
      if (text.includes("Communicate") && text.includes("runtime-consultation.cjs CLI")) {
        process.stderr.write("still instructs the model to operate the CLI itself: " + text + "\n");
        process.exit(1);
      }
    ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "M67-SUPERVISOR-TURN-CONTRACT-01b: the architect initial turn under context7-required forbids answering directly and requires a consult-intent-only envelope targeting context-provider with the byte-identical question and ARCHITECTURE_RECOMMENDATION -- absent when evidence_policy is none" {
  run --separate-stderr env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x \
    node -e '
      const bridge = require(process.argv[1]);
      const worker = { role: "arch-platform", readViewRoot: "/tmp/m67-rv", waveSlug: "m67-wave" };
      const item = {
        requestId: "a".repeat(64), expectedResultKind: "ARCHITECTURE_RECOMMENDATION",
        question: "APPROVED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDoes X govern Y",
        evidencePolicy: "context7-required", approvedContext7LibraryId: "/ktorio/ktor-documentation",
      };
      const gated = bridge.__testOnlyBuildRootTurnInput(worker, item);
      const mustContain = ["do not answer", "consult-intent", "context-provider", "ARCHITECTURE_RECOMMENDATION", "identical"];
      for (const phrase of mustContain) {
        if (!gated.toLowerCase().includes(phrase.toLowerCase())) { process.stderr.write("missing required phrase " + JSON.stringify(phrase) + " under context7-required in: " + gated + "\n"); process.exit(1); }
      }
      if (!gated.includes(item.question)) { process.stderr.write("byte-identical question is not embedded verbatim: " + gated + "\n"); process.exit(1); }
      const ungated = bridge.__testOnlyBuildRootTurnInput(worker, Object.assign({}, item, { evidencePolicy: "none" }));
      if (ungated.toLowerCase().includes("consult-intent")) { process.stderr.write("evidence_policy none must not carry the consult-intent-only restriction: " + ungated + "\n"); process.exit(1); }
    ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "M67-SUPERVISOR-TURN-CONTRACT-01c: the context-provider initial turn under context7-required forbids tool use and requires a pattern-gap-only envelope naming provider context7 and the inherited library_id -- absent when evidence_policy is none" {
  run --separate-stderr env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x \
    node -e '
      const bridge = require(process.argv[1]);
      const worker = { role: "context-provider", readViewRoot: "/tmp/m67-rv", waveSlug: "m67-wave" };
      const item = {
        requestId: "a".repeat(64), expectedResultKind: "ARCHITECTURE_RECOMMENDATION",
        question: "child question about X",
        evidencePolicy: "context7-required", approvedContext7LibraryId: "/ktorio/ktor-documentation",
      };
      const gated = bridge.__testOnlyBuildRootTurnInput(worker, item);
      const mustContain = ["pattern-gap", "context7", "/ktorio/ktor-documentation"];
      for (const phrase of mustContain) {
        if (!gated.includes(phrase)) { process.stderr.write("missing required phrase " + JSON.stringify(phrase) + " under context7-required in: " + gated + "\n"); process.exit(1); }
      }
      const ungated = bridge.__testOnlyBuildRootTurnInput(worker, Object.assign({}, item, { evidencePolicy: "none", approvedContext7LibraryId: null }));
      if (ungated.includes("pattern-gap")) { process.stderr.write("evidence_policy none must not carry the pattern-gap-only restriction: " + ungated + "\n"); process.exit(1); }
    ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "M67-SUPERVISOR-TURN-CONTRACT-01d: the architect turn resumed after an accepted child under context7-required forbids opening another child or consulting Context7 itself and requires a terminal-only envelope -- absent when evidence_policy is none" {
  run --separate-stderr env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x \
    node -e '
      const bridge = require(process.argv[1]);
      const worker = { role: "arch-platform", readViewRoot: "/tmp/m67-rv", waveSlug: "m67-wave" };
      const child = { dependency: { request_id: "b".repeat(64), from_role: "context-provider" }, content: "the answer" };
      const gatedItem = { requestId: "a".repeat(64), evidencePolicy: "context7-required" };
      const gated = bridge.__testOnlyBuildResumedTurnInput(worker, gatedItem, child);
      const mustContain = ["terminal", "not open another", "not consult Context7"];
      for (const phrase of mustContain) {
        if (!gated.includes(phrase)) { process.stderr.write("missing required phrase " + JSON.stringify(phrase) + " under context7-required in: " + gated + "\n"); process.exit(1); }
      }
      const ungatedItem = { requestId: "a".repeat(64), evidencePolicy: "none" };
      const ungated = bridge.__testOnlyBuildResumedTurnInput(worker, ungatedItem, child);
      if (ungated.includes("not open another")) { process.stderr.write("evidence_policy none must not carry the terminal-only restriction: " + ungated + "\n"); process.exit(1); }
    ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "M67-SUPERVISOR-TURN-CONTRACT-01e: the context-provider turn resumed after HOST_PATTERN_EVIDENCE forbids consulting again and requires a terminal-only envelope, never another pattern-gap or a consult-intent" {
  run --separate-stderr env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x \
    node -e '
      const bridge = require(process.argv[1]);
      const evidence = {
        contentBytes: Buffer.from("ktor evidence text", "utf8"),
        contentRef: { blob: "d".repeat(64), digest: "d".repeat(64), size: 3 },
        contentDigest: "d".repeat(64),
      };
      const text = bridge.__testOnlyBuildPatternEvidenceTurnInput(evidence);
      const mustContain = ["terminal", "not consult again", "pattern-gap is forbidden", "consult-intent"];
      for (const phrase of mustContain) {
        if (!text.includes(phrase)) { process.stderr.write("missing required phrase " + JSON.stringify(phrase) + " in: " + text + "\n"); process.exit(1); }
      }
    ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# M67-MATRIX3-EVIDENCE-CONTRACT-REPAIR-20260821: the mission mandate names the
# exact signature "M67-SUPERVISOR-TURN-CONTRACT-01" (no a/b/c/d/e suffix). The
# five tests above cover each phase in isolation with a focused failure
# message per phase; this umbrella test exercises all five phases in one
# shot, under the exact mandated name, so that name alone is independently
# provable as RED before the fix and GREEN after it -- never merely implied
# by the sum of its five more granular siblings.
@test "M67-SUPERVISOR-TURN-CONTRACT-01: every host-generated turn declares host ownership plus the native-tool prohibition, and each of the four phase-scoped restrictions (architect-initial, context-provider-initial, architect-resumed, context-provider-resumed) is present exactly where context7-required requires it" {
  run --separate-stderr env NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x \
    node -e '
      const bridge = require(process.argv[1]);

      const base = bridge.__testOnlySupervisorBaseInstructions;
      const baseMustContain = [
        "host", "CLI", "filesystem", "network", "MCP", "dispatch",
        "MUST NOT", "Bash", "Read", "Grep", "Glob", "Agent", "SendMessage", "web",
        "RuntimeTurnEnvelope", "exactly one", "Markdown",
      ];
      for (const phrase of baseMustContain) {
        if (!base.includes(phrase)) { process.stderr.write("[base] missing required phrase " + JSON.stringify(phrase) + " in: " + base + "\n"); process.exit(1); }
      }
      if (base.includes("Communicate") && base.includes("runtime-consultation.cjs CLI")) {
        process.stderr.write("[base] still instructs the model to operate the CLI itself: " + base + "\n");
        process.exit(1);
      }

      const architectWorker = { role: "arch-platform", readViewRoot: "/tmp/m67-umbrella-rv", waveSlug: "m67-umbrella-wave" };
      const cpWorker = { role: "context-provider", readViewRoot: "/tmp/m67-umbrella-rv", waveSlug: "m67-umbrella-wave" };
      const gatedItem = {
        requestId: "a".repeat(64), expectedResultKind: "ARCHITECTURE_RECOMMENDATION",
        question: "APPROVED_CONTEXT7_LIBRARY_ID: /ktorio/ktor-documentation\nDoes X govern Y",
        evidencePolicy: "context7-required", approvedContext7LibraryId: "/ktorio/ktor-documentation",
      };

      const architectInitial = bridge.__testOnlyBuildRootTurnInput(architectWorker, gatedItem);
      for (const phrase of ["do not answer", "consult-intent", "context-provider", "ARCHITECTURE_RECOMMENDATION"]) {
        if (!architectInitial.toLowerCase().includes(phrase.toLowerCase())) { process.stderr.write("[architect-initial] missing " + JSON.stringify(phrase) + " in: " + architectInitial + "\n"); process.exit(1); }
      }

      const cpInitial = bridge.__testOnlyBuildRootTurnInput(cpWorker, gatedItem);
      for (const phrase of ["pattern-gap", "context7", "/ktorio/ktor-documentation"]) {
        if (!cpInitial.includes(phrase)) { process.stderr.write("[context-provider-initial] missing " + JSON.stringify(phrase) + " in: " + cpInitial + "\n"); process.exit(1); }
      }

      const child = { dependency: { request_id: "b".repeat(64), from_role: "context-provider" }, content: "the answer" };
      const architectResumed = bridge.__testOnlyBuildResumedTurnInput(architectWorker, gatedItem, child);
      for (const phrase of ["terminal", "not open another", "not consult Context7"]) {
        if (!architectResumed.includes(phrase)) { process.stderr.write("[architect-resumed] missing " + JSON.stringify(phrase) + " in: " + architectResumed + "\n"); process.exit(1); }
      }

      const evidence = {
        contentBytes: Buffer.from("ktor evidence text", "utf8"),
        contentRef: { blob: "d".repeat(64), digest: "d".repeat(64), size: 3 },
        contentDigest: "d".repeat(64),
      };
      const cpResumed = bridge.__testOnlyBuildPatternEvidenceTurnInput(evidence);
      for (const phrase of ["terminal", "not consult again", "pattern-gap is forbidden", "consult-intent"]) {
        if (!cpResumed.includes(phrase)) { process.stderr.write("[context-provider-resumed] missing " + JSON.stringify(phrase) + " in: " + cpResumed + "\n"); process.exit(1); }
      }
    ' "$BRIDGE"
  [ "$status" -eq 0 ]
}
