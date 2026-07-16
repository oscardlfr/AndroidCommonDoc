#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Root-security / fd-safety verification tests for the portable runtime-consultation
# core, Wave 1 (portable-runtime-messaging-adapters), WP1/WP3 -- PLAN.md "Namespace &
# Root Security" (~L600-641) and "Identity & Digests" (~L642-653), plus the frozen
# `root-init`/`root-validate`/`validate` rows of the "Frozen Production CLI ABI"
# (~L750-781).
#
# CLI under test: node scripts/lib/runtime-consultation.cjs <subcommand> ...
#
# STATUS: VERIFICATION, not RED-first. Unlike runtime-consultation-protocol.bats and
# runtime-consultation-state.bats (written before WP1 landed), `runtime-consultation.cjs`
# already exists and is green against those two suites (34/34, 49/49). This file
# VERIFIES the same already-landed implementation's root-confinement and fd-safety/
# TOCTOU contract from PLAN.md's "Namespace & Root Security" section. A test here
# going GREEN is direct evidence the implementation already enforces that specific
# clause of the frozen contract; a test going RED is a genuine implementation gap
# against the frozen PLAN, reported as such -- this suite owns tests only, never
# `runtime-consultation.cjs` itself.
#
# Path-Manifest: "scripts/tests/runtime-consultation-roots.bats -- test-specialist .
# WP1/WP3 . self" (PLAN.md ~L1304).
#
# Key interpretive decisions (mirrors runtime-consultation-protocol.bats's own practice
# of narrating non-obvious calls, so a future correction is a small, obvious fix rather
# than a silent divergence):
#   - `detail_code` for every root-confinement/security rejection in this file is
#     asserted as `SECURITY_INVALID` -- not a guess: `planRootFromArtifact()` in
#     `runtime-consultation.cjs` (~L246-253) already throws exactly
#     `CliError('INVALID','SECURITY_INVALID', ...)` for an out-of-confinement artifact
#     path, so `SECURITY_INVALID` is this codebase's OWN established convention for
#     this class of violation, reused here for root-level confinement by the same
#     reasoning -- not this file's invention.
#   - Group B ("confinement/traversal") tests assert the FROZEN contract PLAN.md ~L636
#     describes ("sibling-worktree requires explicit RUNTIME_CONSULTATION_ROOT, never
#     generic /tmp ... If confinement cannot be proven, sibling mode fails closed") plus
#     rejection of a symlinked or mode-loosened root. A full read of `cmdRootInit`/
#     `cmdRootValidate` (~L1213-1238) confirms NEITHER function references
#     `RUNTIME_CONSULTATION_ROOT` nor performs any base-confinement/symlink/mode check
#     today -- `root-init` accepts and creates a directory at ANY absolute path, and
#     `root-validate` uses `fs.statSync` (follows symlinks), checking only
#     existence+isDirectory. Group B is therefore EXPECTED to be RED against the
#     current implementation; each RED result is exactly the "real impl gap" this
#     suite exists to surface, not a fixture bug.
#   - Group C's owner/SID case (RCR-blob-8) and the genuine lstat-to-open race case
#     (RCR-blob-9) are `skip`ped rather than faked: the former needs multi-user/root
#     privilege this sandbox does not have, the latter needs a second process winning
#     a race at an instant with no code-level pause hook available to a black-box CLI
#     test. Both skip reasons name the exact related static-code finding instead of
#     silently omitting the case.
#
# Invocation: bats scripts/tests/runtime-consultation-roots.bats (from repo root), or
# scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-consultation-roots.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
WAVE_SLUG="rcr-test-wave"
# "Harness-created" test capability (PLAN.md ~L752-753, ~L796) -- this bats suite IS
# the harness for direct-CLI protocol testing, matching
# runtime-consultation-protocol.bats's own convention of minting its own fixed token.
TEST_CAPABILITY="bats-runtime-consultation-roots-fixture-capability"

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
  SUBJECT_HEAD="$(git -C "$PROJ" rev-parse HEAD)"

  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  PLAN_FILE="$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"
  printf '# Fixture PLAN for runtime-consultation-roots.bats\n\nThrowaway per-test fixture -- not the real Wave 1 PLAN.md.\n' > "$PLAN_FILE"
  PLAN_DIGEST="$(_sha256_file "$PLAN_FILE")"

  SUBJECT_BUNDLE_FILE="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  _write_subject_bundle "$SUBJECT_BUNDLE_FILE" '{}'

  _ID_COUNTER=0
  EXTRA_TMP_DIR=""
  TRAVERSAL_ESCAPE_PATH=""

  # Best-effort root init -- this suite's own Group A/B tests independently root-init
  # their OWN dedicated sub-paths, so setup() succeeding or failing here never gates
  # any @test's own assertions (mirrors runtime-consultation-protocol.bats's setup()).
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" root-init --coordination-root "$COORD_ROOT" >/dev/null 2>&1 || true
}

teardown() {
  rm -rf "$PROJ"
  if [ -n "$EXTRA_TMP_DIR" ]; then
    rm -rf "$EXTRA_TMP_DIR"
  fi
  if [ -n "$TRAVERSAL_ESCAPE_PATH" ]; then
    rm -rf "$TRAVERSAL_ESCAPE_PATH"
  fi
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
  _sha256_string "rcr-fixture-id-$$-${_ID_COUNTER}-${RANDOM}-${RANDOM}"
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

# Frozen-base-relative ISO timestamp: the CLI's own `--fixed-clock` default base
# (`2025-01-01T00:00:00.000Z`, RUNTIME_CONSULTATION_FAKE_CLOCK not overridden by
# this file) plus N milliseconds, computed entirely via node -- never shell
# `date`/`_iso_plus_seconds`. `--fixed-clock` is now genuinely wired (WP2
# fake-clock/fixed-ids seam): `nowIso()` freezes every emitted `created_at` to
# that exact base under `--fixed-clock`, so a `consult/v2` fixture's `expiry`
# must be computed relative to THAT frozen base (not real wall-clock time) to
# satisfy `CONSULT_V2_FIELDS.expiry.check`'s `120 <= (expiry-created_at) <=
# 3600` window -- otherwise a real-now-relative expiry sits over a year outside
# that window and trips SCHEMA_INVALID. Used only by fixtures that keep
# --fixed-clock active for their publish-request call -- fixtures that drop
# --fixed-clock (Finding D3: a second same-plan-root --fixed-ids
# publish-request would otherwise mint the identical deterministic request_id
# and lose the no-clobber race -- exactly the Group E RCR-noclobber-* cases
# below) keep their original real-time-relative _iso_plus_seconds computation
# instead. Mirrors runtime-consultation-protocol.bats's own helper of the same
# name verbatim.
_frozen_iso_plus_ms() {
  node -e 'process.stdout.write(new Date(Date.parse("2025-01-01T00:00:00.000Z") + Number(process.argv[1])).toISOString())' "$1"
}

_base64url_encode() {
  node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))'
}

# Portable file-mode-as-octal-string reader: GNU `stat -c '%a'` first, BSD/macOS
# `stat -f '%Lp'` fallback (mirrors the sha256sum||shasum dual-fallback idiom above).
_file_mode_octal() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null
}

# ── Path helpers (Namespace & Root Security tree, PLAN.md ~L602-628) ────────

_plan_root() {
  printf '%s' "$COORD_ROOT/$REPO_ID/$WAVE_SLUG/$PLAN_DIGEST"
}

_request_path() {
  local id="$1"
  printf '%s' "$(_plan_root)/transactions/$id/request.json"
}

# Publishes a real, content-addressed blob under the current plan-root's blobs/ dir
# and echoes "<sha256> <byte-size>" for building a well-formed content_ref handle
# (identical convention to runtime-consultation-protocol.bats's own helper).
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

# Builds a `consult/v2` request fixture: a small JSON "overrides" object merged over a
# fully-populated default object covering every CONSULT_V2_FIELDS entry. "__OMIT__"
# deletes a key (verbatim convention from runtime-consultation-protocol.bats).
_write_request() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  RCR_REPO_ID="$REPO_ID" RCR_WAVE_SLUG="$WAVE_SLUG" RCR_PLAN_DIGEST="$PLAN_DIGEST" \
  RCR_WORKTREE_ID="$WORKTREE_ID" RCR_SUBJECT_HEAD="$SUBJECT_HEAD" \
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
      requester_worktree_id: e.RCR_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.RCR_REPO_ID,
      wave_slug: e.RCR_WAVE_SLUG,
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: "0".repeat(64),
      plan_digest: e.RCR_PLAN_DIGEST,
      subject_repo_id: e.RCR_REPO_ID,
      subject_worktree_id: e.RCR_WORKTREE_ID,
      subject_head: e.RCR_SUBJECT_HEAD,
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

# `subject-bundle-manifest/v1` fixture builder -- same override/`__OMIT__` idiom and
# minimal (schema + entries array only) shape as runtime-consultation-protocol.bats's
# own builder; deep per-entry validation is WP2/WP3, not exercised by this WP1 file.
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

# ── CLI invocation + assertion helpers ───────────────────────────────────────

_run_validate() {
  local kind="$1" artifact="$2"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" validate --coordination-root "$COORD_ROOT" --kind "$kind" --artifact "$artifact"
}

_run_root_init() {
  local root="$1"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" root-init --coordination-root "$root"
}

_run_root_validate() {
  local root="$1"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" root-validate --coordination-root "$root"
}

# Parses the most recent `run --separate-stderr` invocation's captured stdout ($output)
# as the frozen coordination/cli-result/v1 envelope (PLAN.md ~L779-781) -- kept
# byte-for-byte consistent with runtime-consultation-protocol.bats's own helper since
# both files assert the identical frozen stdout contract.
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
# Group A -- root-init / root-validate basic lifecycle (PLAN.md ~L758-759)
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-root-1 PASS: root-init creates the coordination root directory and returns its resolved absolute path" {
  local root="$COORD_ROOT/lifecycle-fresh-root"
  _run_root_init "$root"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  [ -d "$root" ]
  local artifact_ref; artifact_ref="$(node -e 'console.log(JSON.parse(process.argv[1]).artifact_ref)' "$output")"
  [ "$artifact_ref" = "$root" ]
}

@test "RCR-root-2 PASS: root-init sets the coordination root directory mode to owner-confined 0700" {
  local root="$COORD_ROOT/lifecycle-mode-root"
  _run_root_init "$root"
  [ "$status" -eq 0 ]
  [ "$(_file_mode_octal "$root")" = "700" ]
}

@test "RCR-root-3 PASS: root-init is idempotent -- a second call on the same root succeeds and preserves owner-confined mode" {
  local root="$COORD_ROOT/lifecycle-idempotent-root"
  _run_root_init "$root"
  [ "$status" -eq 0 ]
  _run_root_init "$root"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  [ "$(_file_mode_octal "$root")" = "700" ]
}

@test "RCR-root-4 PASS: root-validate succeeds for a freshly root-init'd, unmodified root" {
  local root="$COORD_ROOT/lifecycle-validate-root"
  _run_root_init "$root"
  [ "$status" -eq 0 ]
  _run_root_validate "$root"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCR-root-5 FAIL: root-validate on a non-existent root reports INVALID/SCHEMA_INVALID" {
  local root="$COORD_ROOT/lifecycle-does-not-exist-root"
  _run_root_validate "$root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCR-root-6 FAIL: root-validate on a path that exists but is a regular file (not a directory) reports INVALID/SCHEMA_INVALID" {
  mkdir -p "$COORD_ROOT"
  local root="$COORD_ROOT/lifecycle-plain-file-not-a-dir"
  printf 'this is a file, not a coordination root directory' > "$root"
  _run_root_validate "$root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Group B -- confinement / traversal / symlink (SECURITY -- PLAN.md ~L636, ~L640)
# Adversarial: expected RED against the current root-init/root-validate
# implementation (see header "Key interpretive decisions" for the code-level
# evidence). Each RED result documents a real, precise gap -- not a fixture bug.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-confine-1 FAIL: a coordination-root outside any worktree (generic system temp, no explicit override) is rejected fail-closed" {
  EXTRA_TMP_DIR="$(mktemp -d)"
  local outside_root="$EXTRA_TMP_DIR/coordination"
  _run_root_init "$outside_root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCR-confine-2 FAIL: a coordination-root path containing traversal segments that resolve outside the worktree is rejected fail-closed" {
  local depth upfrag i
  depth="$(printf '%s' "$COORD_ROOT" | tr -cd '/' | wc -c | tr -d ' ')"
  upfrag=""
  for ((i = 0; i < depth + 2; i++)); do
    upfrag="${upfrag}../"
  done
  TRAVERSAL_ESCAPE_PATH="/tmp/rcr-traversal-escape-$$-${RANDOM}"
  local traversal_arg="$COORD_ROOT/${upfrag}${TRAVERSAL_ESCAPE_PATH#/}"
  _run_root_init "$traversal_arg"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCR-confine-3 FAIL: root-validate on a path that is itself a symlink to a real, valid, owner-confined root is rejected fail-closed" {
  local real_root="$COORD_ROOT/real-symlink-target-root"
  _run_root_init "$real_root"
  [ "$status" -eq 0 ]
  local link_root="$COORD_ROOT/symlinked-root-alias"
  ln -s "$real_root" "$link_root"
  _run_root_validate "$link_root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCR-confine-4 FAIL: root-validate on a root whose mode has been loosened to 0777 after root-init is rejected fail-closed" {
  local root="$COORD_ROOT/mode-regression-root"
  _run_root_init "$root"
  [ "$status" -eq 0 ]
  chmod 0777 "$root"
  _run_root_validate "$root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCR-confine-5 FAIL: root-init on a path that is ITSELF a pre-existing symlink is rejected fail-closed BEFORE any mkdir/chmod, with zero mutation of the symlink's target" {
  # A legitimate, pre-existing, owner-confined directory ELSEWHERE in the same
  # worktree -- root-init must never chmod/mutate it just because a symlink
  # happens to alias it at the requested --coordination-root path. mkdirSync on
  # an existing path is a no-op EVEN THROUGH a symlink, so without a leaf-symlink
  # guard, chmodSync(0700) would silently mutate this real target's mode.
  local real_target="$COORD_ROOT/pre-existing-real-target"
  mkdir -p "$real_target"
  chmod 0755 "$real_target"
  local mode_before; mode_before="$(_file_mode_octal "$real_target")"
  [ "$mode_before" = "755" ]

  local link_root="$COORD_ROOT/symlinked-init-target"
  ln -s "$real_target" "$link_root"

  _run_root_init "$link_root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  # Zero mutation: the real target's mode is byte-for-byte unchanged, and it is
  # still a plain directory (never replaced/relinked).
  local mode_after; mode_after="$(_file_mode_octal "$real_target")"
  [ "$mode_after" = "755" ]
  [ -d "$real_target" ]
  [ ! -L "$real_target" ]
  # The symlink itself is untouched too (still a symlink, still pointing the same place).
  [ -L "$link_root" ]
  local link_target; link_target="$(readlink "$link_root")"
  [ "$link_target" = "$real_target" ]
}

# ══════════════════════════════════════════════════════════════════════════
# Group C -- content_ref resolution fd-safety / TOCTOU (PLAN.md ~L640), reached via
# `validate --kind consult-v2` against a request carrying a content_ref (WP1-reachable;
# `publish-blob`'s OWN equivalent adversarial matrix -- BLOB-AUTH-01..08 -- is WP2/WP3
# and out of scope here per the dispatch).
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-blob-1 PASS: a well-formed content_ref referencing a real, regular, single-link blob validates" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local blob_sha blob_size
  read -r blob_sha blob_size <<< "$(_publish_test_blob "RCR-blob-1 fixture blob content")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":%s,"digest":"%s"}}' "$id" "$id" "$blob_sha" "$blob_size" "$blob_sha")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
}

@test "RCR-blob-2 FAIL: a content_ref whose blob path is a symlink (not a regular file) is rejected fail-closed" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local fake_digest; fake_digest="$(printf 'c%.0s' {1..64})"
  local elsewhere="$PROJ/symlink-blob-target.txt"
  printf 'symlink target content, not a real blob' > "$elsewhere"
  local blobdir; blobdir="$(_plan_root)/blobs"
  mkdir -p "$blobdir"
  ln -s "$elsewhere" "$blobdir/$fake_digest"
  local size; size="$(wc -c < "$elsewhere" | tr -d ' ')"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":%s,"digest":"%s"}}' "$id" "$id" "$fake_digest" "$size" "$fake_digest")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCR-blob-3 FAIL: a content_ref whose blob path has nlink==2 (hard-linked) is rejected fail-closed (durability unproven)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local blob_sha blob_size
  read -r blob_sha blob_size <<< "$(_publish_test_blob "RCR-blob-3 fixture blob content")"
  local blobdir; blobdir="$(_plan_root)/blobs"
  ln "$blobdir/$blob_sha" "$PROJ/extra-hardlink-to-blob-$blob_sha.bin"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":%s,"digest":"%s"}}' "$id" "$id" "$blob_sha" "$blob_size" "$blob_sha")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

@test "RCR-blob-4 FAIL: a content_ref whose blob path is a directory (type mismatch) is rejected fail-closed" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local fake_digest; fake_digest="$(printf 'd%.0s' {1..64})"
  local blobdir; blobdir="$(_plan_root)/blobs"
  mkdir -p "$blobdir/$fake_digest"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":0,"digest":"%s"}}' "$id" "$id" "$fake_digest" "$fake_digest")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCR-blob-5 FAIL: a content_ref whose blob path is a FIFO/named pipe (non-regular) is rejected fail-closed" {
  if ! command -v mkfifo >/dev/null 2>&1; then
    skip "mkfifo not available in this environment"
  fi
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local fake_digest; fake_digest="$(printf 'e%.0s' {1..64})"
  local blobdir; blobdir="$(_plan_root)/blobs"
  mkdir -p "$blobdir"
  mkfifo "$blobdir/$fake_digest"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":0,"digest":"%s"}}' "$id" "$id" "$fake_digest" "$fake_digest")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCR-blob-6 FAIL: blob bytes on disk not matching the declared digest (tampered content) are rejected fail-closed" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local blob_sha blob_size
  read -r blob_sha blob_size <<< "$(_publish_test_blob "AAAAAAAAAA")"
  local blobdir; blobdir="$(_plan_root)/blobs"
  printf 'BBBBBBBBBB' > "$blobdir/$blob_sha"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":%s,"digest":"%s"}}' "$id" "$id" "$blob_sha" "$blob_size" "$blob_sha")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCR-blob-7 FAIL: a content_ref referencing a non-existent blob digest is rejected fail-closed" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  local ghost_digest; ghost_digest="$(printf 'f%.0s' {1..64})"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s","content_ref":{"blob":"%s","size":4,"digest":"%s"}}' "$id" "$id" "$ghost_digest" "$ghost_digest")"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SCHEMA_INVALID"
}

@test "RCR-blob-8 SKIP: owner/SID mismatch on the resolved blob is rejected (fd-bound owner check)" {
  skip "requires creating a blob owned by a different UID than the test process -- not achievable without multi-user/root privileges in this sandbox. Code-level note: resolveContentRefOrThrow() (runtime-consultation.cjs ~L625-657) performs no owner/uid/SID comparison at all -- PLAN.md ~L640's 'require regular file, expected owner/SID, nlink==1, and size<=10MB' owner clause is not yet implemented for ANY caller, not just unreachable by this fixture."
}

@test "RCR-blob-9 SKIP: a symlink swapped into the blob path strictly between lstat and open (true TOCTOU) is rejected" {
  skip "a genuine lstat-to-open race requires a second process swapping the blob path to a symlink at the exact instant between two syscalls inside the CLI's single invocation -- not deterministically reproducible from a black-box bats @test with no code-level pause hook to freeze execution between them. Code-level note (post-fix): resolveContentRefOrThrow() now opens via fs.openSync(blobPath, O_RDONLY | O_NOFOLLOW) (runtime-consultation.cjs ~L638), which independently re-rejects (ELOOP) a path that is a symlink AT OPEN TIME regardless of what the earlier lstat saw -- so this is no longer a missing-O_NOFOLLOW code gap (that was this test's original premise). What remains untestable here is the inherent TOCTOU timing property itself -- deterministically winning that exact lstat-to-open window from a black-box test -- not a guard the implementation is missing."
}

# ══════════════════════════════════════════════════════════════════════════
# Group D -- general per-artifact durability/hard-link/symlink rejection via
# assertDurable(), broader than just blobs (WP1-reachable via plain `validate`).
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-durable-1 FAIL: a request.json artifact that is itself a symlink (not a regular file) is rejected fail-closed with SECURITY_INVALID (DUR-J fd-bound O_NOFOLLOW open rejects the symlink at open, stronger than the old lstat->SCHEMA_INVALID)" {
  local id; id="$(_gen_hex_id)"
  local real_target="$PROJ/real-request-target-for-symlink-test.json"
  _write_request "$real_target" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  local f; f="$(_request_path "$id")"
  mkdir -p "$(dirname "$f")"
  ln -s "$real_target" "$f"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"
}

@test "RCR-durable-2 FAIL: a request.json artifact with nlink==2 (hard-linked) is rejected fail-closed (durability unproven)" {
  local id; id="$(_gen_hex_id)"
  local f; f="$(_request_path "$id")"
  _write_request "$f" "$(printf '{"request_id":"%s","root_request_id":"%s"}' "$id" "$id")"
  ln "$f" "$PROJ/extra-hardlink-to-request-$id.json"
  _run_validate consult-v2 "$f"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "DURABILITY_UNPROVEN"
}

# ══════════════════════════════════════════════════════════════════════════
# Group E -- no-clobber / durability on root-adjacent records exercised by
# `publish-request` (PLAN.md ~L649 plan_ref immutability, ~L679-683 no-clobber primitive)
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-noclobber-1 PASS: two publish-request calls sharing the same PLAN bytes are idempotent for the shared plan_ref" {
  local expiry intent intent_b64
  # Frozen-base-relative (not real-now-relative): this FIRST call keeps
  # --fixed-clock, which genuinely freezes created_at to the CLI's default
  # frozen base -- see _frozen_iso_plus_ms's own header note.
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCR-noclobber-1 fixture question A","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local plan_ref_before; plan_ref_before="$(_sha256_file "$(_plan_root)/plan_ref")"

  # Deliberately WITHOUT --fixed-ids/--fixed-clock on this SECOND call (Finding
  # D3): it shares the first call's exact plan-root, and the deterministic id
  # counter resets to 0 every fresh process -- a second --fixed-ids
  # publish-request here would mint the IDENTICAL request_id the first call
  # already consumed and lose the no-clobber race on its own
  # transactions/<id>/request.json before this test's actual subject (the
  # shared plan_ref) is even reached. A REAL random request_id plus a REAL
  # wall-clock created_at (paired with a real-time-relative expiry2 below)
  # sidesteps that unrelated collision while still proving two publish-request
  # calls sharing the same PLAN bytes leave the shared plan_ref untouched.
  local now expiry2 intent2 intent2_b64
  now="$(_iso_now)"
  expiry2="$(_iso_plus_seconds "$now" 1800)"
  intent2="$(printf '{"target_role":"arch-testing","question":"RCR-noclobber-1 fixture question B","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry2")"
  intent2_b64="$(printf '%s' "$intent2" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent2_b64"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local plan_ref_after; plan_ref_after="$(_sha256_file "$(_plan_root)/plan_ref")"
  [ "$plan_ref_before" = "$plan_ref_after" ]
}

@test "RCR-noclobber-2 FAIL: a tampered existing plan_ref causes a subsequent publish-request to fail closed" {
  local expiry intent intent_b64
  # Frozen-base-relative (not real-now-relative): this FIRST call keeps
  # --fixed-clock, which genuinely freezes created_at to the CLI's default
  # frozen base -- see _frozen_iso_plus_ms's own header note.
  expiry="$(_frozen_iso_plus_ms 1800000)"
  intent="$(printf '{"target_role":"arch-testing","question":"RCR-noclobber-2 fixture question A","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  intent_b64="$(printf '%s' "$intent" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent_b64" --fixed-ids --fixed-clock
  [ "$status" -eq 0 ]

  printf 'tampered plan_ref bytes, not the real PLAN.md content' > "$(_plan_root)/plan_ref"

  # Deliberately WITHOUT --fixed-ids/--fixed-clock on this SECOND call (Finding
  # D3): it shares the first call's exact plan-root, and the deterministic id
  # counter resets to 0 every fresh process -- a second --fixed-ids
  # publish-request here would mint the IDENTICAL request_id the first call
  # already consumed and lose the no-clobber race on its own
  # transactions/<id>/request.json BEFORE this test's actual subject (the
  # tampered plan_ref) is even reached. A REAL random request_id plus a REAL
  # wall-clock created_at (paired with a real-time-relative expiry2 below)
  # sidesteps that unrelated collision while still proving a tampered
  # existing plan_ref fails a subsequent publish-request closed.
  local now expiry2 intent2 intent2_b64
  now="$(_iso_now)"
  expiry2="$(_iso_plus_seconds "$now" 1800)"
  intent2="$(printf '{"target_role":"arch-testing","question":"RCR-noclobber-2 fixture question B","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry2")"
  intent2_b64="$(printf '%s' "$intent2" | _base64url_encode)"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$SUBJECT_BUNDLE_FILE" --intent "$intent2_b64"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Group F -- `publish-blob` entry-path confinement adversarial matrix (WP2
# BLOB-AUTH, CORRECTION PASS). Added after a NO-GO audit against the frozen
# adversarial matrix `cmdPublishBlob`'s own header comment names
# (runtime-consultation.cjs ~L2359-2364: "BLOB-AUTH-01..08 -- outside-root,
# host-auth/config/home, coordination/evidence, traversal, symlink/hard-link/
# reparse, post-open mutation, >10MiB") found three concrete, currently-
# reproducible escapes in the SHIPPED `cmdPublishBlob` (~L2375-2464), verified
# by direct code reading, not asserted from the audit alone:
#   - Staging-root confinement (~L2403-2408) is LEXICAL ONLY: `path.resolve`/
#     `path.join` never touch the filesystem, so a `..`-free `entry.path`
#     (already enforced by `isSafeRelativeEntryPath`, ~L1691-1700) ALWAYS
#     lexically resolves under the staging root as a plain string -- this
#     confinement check can therefore never itself reject anything UNLESS a
#     path COMPONENT along the way is a symlink whose real target sits
#     elsewhere, which is exactly what it fails to catch (RCR-blob-parent-
#     symlink, RCR-blob-outside-abs below).
#   - The subsequent `fs.lstatSync`/`fs.openSync(..., O_NOFOLLOW)` pair
#     (~L2417-2438) only ever inspects/opens the FINAL path component for
#     symlink-ness (standard POSIX lstat/O_NOFOLLOW semantics) -- a symlinked
#     PARENT directory anywhere earlier in the path is transparently followed
#     by the OS during resolution and produces no error at all, so a real,
#     non-symlink regular file sitting behind a symlinked ancestor directory
#     is read and published exactly as if it genuinely sat inside the
#     worktree.
#   - The categorical denylist (`BLOB_DENYLISTED_SEGMENTS`, ~L2373) and
#     `isSafeRelativeEntryPath` itself (~L1695: `v.split('/')`) both split
#     candidate segments on `/` ONLY -- neither treats `\` as a separator, so
#     a segment that embeds a denylisted name behind an internal `\` is
#     compared as one longer, non-matching string and is never caught
#     (RCR-blob-backslash below).
#
# Distinct from Group C above (RCR-blob-1..9): those are WP1's own
# `resolveContentRefOrThrow` cases, reached via `validate --kind consult-v2`
# against an ALREADY-published blob. These Group F cases exercise
# `publish-blob` ITSELF -- the WP2 entry point that decides whether a
# caller-nominated on-disk file becomes a published blob in the first place --
# per this dispatch's own explicit WP2/WP3 split. Also distinct from Group B's
# `root-init`/`root-validate` root-confinement (WP3, RCR-confine-*): these are
# `publish-blob`'s own, separate `--entry` confinement, not the coordination
# root's.
#
# Every case below is a genuine RED reproduction: the current implementation
# returns SUCCESS (rc0) and (for the symlink cases) genuinely reads/publishes
# content sourced from outside the worktree, or (for the backslash case)
# genuinely reads/publishes a real on-disk file whose name embeds a
# denylisted-name lookalike -- not a fixture artifact. `publish-blob` needs no
# `--fixed-ids`/`--fixed-clock`/test-capability seam (it mints no core-
# generated id and stamps no timestamp of its own), so `_run_publish_blob`
# sets `NODE_ENV=test`/`RUNTIME_CONSULTATION_TEST_CAPABILITY` only for
# byte-for-byte consistency with every other invocation helper in this file.
# ══════════════════════════════════════════════════════════════════════════

# Invokes `publish-blob` directly (Frozen CLI ABI, PLAN.md ~L760, ~L777).
_run_publish_blob() {
  local bundle="$1" entry="$2"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" publish-blob --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
      --subject-bundle "$bundle" --entry "$entry"
}

@test "RCR-blob-parent-symlink FAIL (WP2 BLOB-AUTH PATH-01): a top-level in-worktree symlinked directory component lets publish-blob read and publish a file from OUTSIDE the worktree, past the lexical-only staging-root confinement check" {
  EXTRA_TMP_DIR="$(mktemp -d)"
  local outside_dir="$EXTRA_TMP_DIR/outside-secret-dir"
  mkdir -p "$outside_dir"
  local secret_content="RCR-blob-parent-symlink OUTSIDE-the-worktree secret content, must never be readable via publish-blob"
  printf '%s' "$secret_content" > "$outside_dir/secret.txt"
  local secret_digest secret_size
  secret_digest="$(_sha256_file "$outside_dir/secret.txt")"
  secret_size="$(wc -c < "$outside_dir/secret.txt" | tr -d ' ')"

  # The ONLY thing crossing the worktree boundary is this one symlink -- every
  # other path component ("parent-link", "secret.txt") is an ordinary name.
  ln -s "$outside_dir" "$PROJ/parent-link"

  local entry_rel="parent-link/secret.txt"
  local bundle_file; bundle_file="$PROJ/.planning/coordination-subject-bundle-rcr-blob-parent-symlink.json"
  _write_subject_bundle "$bundle_file" "$(printf '{"entries":[{"path":"%s","size":%s,"digest":"%s"}]}' "$entry_rel" "$secret_size" "$secret_digest")"

  _run_publish_blob "$bundle_file" "$entry_rel"

  # CURRENT (vulnerable) behavior: status 0, SUCCESS -- the symlink is silently
  # followed and "$outside_dir/secret.txt" is read/published as if it were a
  # genuine in-worktree file. Both assertions below are expected to fail RED
  # against today's implementation for exactly that reason.
  [ "$status" -ne 0 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  # Defense-in-depth: even independent of the exit code/detail_code above, no
  # blob keyed by the OUTSIDE file's digest may ever land under this plan-root.
  local blobdir; blobdir="$(_plan_root)/blobs"
  [ ! -e "$blobdir/$secret_digest" ]
}

@test "RCR-blob-outside-abs FAIL (WP2 BLOB-AUTH PATH-06): a NESTED (non-top-level) symlinked directory component whose true realpath resolves outside the worktree is likewise accepted by the lexical-only confinement check" {
  EXTRA_TMP_DIR="$(mktemp -d)"
  local outside_dir="$EXTRA_TMP_DIR/deeper-outside-dir"
  mkdir -p "$outside_dir"
  local secret_content="RCR-blob-outside-abs OUTSIDE-the-worktree nested secret content, must never be readable via publish-blob"
  printf '%s' "$secret_content" > "$outside_dir/nested-secret.bin"
  local secret_digest secret_size
  secret_digest="$(_sha256_file "$outside_dir/nested-secret.bin")"
  secret_size="$(wc -c < "$outside_dir/nested-secret.bin" | tr -d ' ')"

  mkdir -p "$PROJ/real-subdir"
  ln -s "$outside_dir" "$PROJ/real-subdir/nested-link"

  # Independent proof -- a REAL, symlink-following realpath resolution (`cd` +
  # `pwd -P`, the same idiom this file's own _compute_repo_id/_compute_worktree_id
  # helpers use), NOT the CLI's own lexical assumption under test -- that this
  # entry's true target genuinely sits outside the worktree before publish-blob
  # is ever invoked. A failure here would be a FIXTURE bug, not the vulnerability.
  local true_resolved worktree_real
  true_resolved="$(cd "$PROJ/real-subdir/nested-link" 2>/dev/null && pwd -P)"
  worktree_real="$(cd "$PROJ" && pwd -P)"
  [ -n "$true_resolved" ]
  local truly_outside=true
  case "$true_resolved" in
    "$worktree_real"|"$worktree_real"/*) truly_outside=false ;;
  esac
  [ "$truly_outside" = "true" ]

  local entry_rel="real-subdir/nested-link/nested-secret.bin"
  local bundle_file; bundle_file="$PROJ/.planning/coordination-subject-bundle-rcr-blob-outside-abs.json"
  _write_subject_bundle "$bundle_file" "$(printf '{"entries":[{"path":"%s","size":%s,"digest":"%s"}]}' "$entry_rel" "$secret_size" "$secret_digest")"

  _run_publish_blob "$bundle_file" "$entry_rel"

  [ "$status" -ne 0 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  local blobdir; blobdir="$(_plan_root)/blobs"
  [ ! -e "$blobdir/$secret_digest" ]
}

@test "RCR-blob-backslash FAIL (WP2 BLOB-AUTH PATH-04): a backslash-joined path segment that embeds a denylisted name is missed by both the '/'-only categorical denylist and the '/'-only entry-path safety grammar" {
  # Real, on-disk backing file (POSIX permits '\' as an ordinary filename byte)
  # so this is a genuine end-to-end reproduction on THIS platform, not merely an
  # assertion about Windows-only path semantics: a single literal path
  # component whose NAME embeds a `\.ssh\`-shaped lookalike.
  local actual_filename='innocuous\.ssh\config'
  local blob_content="RCR-blob-backslash fixture content behind a backslash-embedded .ssh lookalike segment"
  printf '%s' "$blob_content" > "$PROJ/$actual_filename"
  local secret_digest secret_size
  # Deliberately NOT `_sha256_file` here: GNU coreutils' sha256sum (this
  # repo's canonical macOS bats PATH resolves `sha256sum` to GNU coreutils via
  # ~/.local/gnubin-l0) prefixes its OUTPUT LINE with a literal '\' whenever
  # the filename argument contains a backslash or newline -- its own
  # documented digest-file round-trip escaping convention, verified directly:
  # under that exact PATH, `sha256sum` on this file's name emits
  # `\<hex>  name` (leading backslash before the hex), so `awk '{print $1}'`
  # would capture the stray leading '\' as part of "field 1", corrupting the
  # value into invalid JSON on the printf/_write_subject_bundle call below.
  # Computed via node's own crypto/fs instead, which reads the raw path bytes
  # directly with no such escaping convention -- a correct digest of this
  # exact file regardless of what characters its name contains.
  secret_digest="$(node -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$PROJ/$actual_filename")"
  secret_size="$(wc -c < "$PROJ/$actual_filename" | tr -d ' ')"

  # JSON-escaped form of the SAME literal value (each real '\' becomes '\\' in
  # the JSON text) -- decodes back to the exact `$actual_filename` bytes via
  # _write_subject_bundle's own `node -e ... JSON.parse(...)`, so
  # `manifest.entries[0].path === flags.entry` (both the raw `$actual_filename`)
  # once parsed.
  local entry_path_json_escaped='innocuous\\.ssh\\config'
  local bundle_file; bundle_file="$PROJ/.planning/coordination-subject-bundle-rcr-blob-backslash.json"
  _write_subject_bundle "$bundle_file" "$(printf '{"entries":[{"path":"%s","size":%s,"digest":"%s"}]}' "$entry_path_json_escaped" "$secret_size" "$secret_digest")"

  _run_publish_blob "$bundle_file" "$actual_filename"

  # CURRENT (vulnerable) behavior: both `isSafeRelativeEntryPath` and
  # `BLOB_DENYLISTED_SEGMENTS` call `.split('/')` on this value, which contains
  # no `/` at all -- the whole string is treated as ONE ordinary segment, never
  # compared piecewise against '.ssh', so status 0/SUCCESS results and the file
  # is published as a real blob.
  [ "$status" -ne 0 ]
  _assert_cli_result "INVALID" "SECURITY_INVALID"

  local blobdir; blobdir="$(_plan_root)/blobs"
  [ ! -e "$blobdir/$secret_digest" ]
}
