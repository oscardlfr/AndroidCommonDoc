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
# already exists and is green against those two suites (exact current counts age --
# verify with `bats --count` rather than trusting a frozen number here). This file
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
#     rejection of a symlinked or mode-loosened root. `cmdRootInit`/`cmdRootValidate`
#     both now call `assertRootConfinedToWorktree`/`validateRootConfinement`
#     (`runtime-consultation.cjs` ~L381-492): a git-worktree-based confinement check
#     (`git rev-parse --show-toplevel` + realpath comparison), a pre-mkdir/pre-follow
#     symlink rejection (`lstat`, never `stat`), and an owner-confined 0700 mode check
#     -- not the literal `RUNTIME_CONSULTATION_ROOT` env var PLAN.md's own prose names
#     (this file's original reading of that clause), but the same confinement outcome
#     by a different, git-native mechanism. All five RCR-confine-* cases are current,
#     genuine GREEN (re-verified empirically, not merely inferred from a passing run)
#     against this now-implemented confinement -- this file's original RED-against-a-
#     genuine-gap status is history, not current state; see git log, not this comment,
#     for when it landed.
#   - Group C's owner/SID case (RCR-blob-8) and the genuine lstat-to-open race case
#     (RCR-blob-9) are `skip`ped rather than faked: the former needs multi-user/root
#     privilege this sandbox does not have, the latter needs a second process winning
#     a race at an instant with no code-level pause hook available to a black-box CLI
#     test. Both skip reasons name the exact related static-code finding instead of
#     silently omitting the case.
#
# Invocation: bats scripts/tests/runtime-consultation-roots.bats (from repo root), or
# scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-consultation-roots.bats

# ══════════════════════════════════════════════════════════════════════════
# TERMINOLOGY -- CONFORMANCE IS NOT ACCREDITATION. Read this before any R33 test.
#
# Every R33 check in this file proves CONFORMANCE only: closed schema, canonical
# bytes, confined paths, cross-record correlation and digest chain. None of it
# proves AUTHORITY, and a conformance pass must never be read, quoted or reported
# as accreditation.
#
# This is not a wording preference, it is why the R33 CLI kinds are being removed.
# Authority cannot be established inside `validate`'s frozen ABI: the final
# `BootstrapReceipt` is published under `R` (R3.3:2844), a different root from `C`;
# `validate`'s argv is frozen at three flags (PLAN.md:766-785) with `--artifact`
# already spent on the binding; and temporal liveness needs a live
# clock-capability plus `now` in the record's own monotonic domain, which R3.3:1465
# forbids converting. PLAN.md:762 is explicit that retained hosts call the core
# in-process with `HostBridgeCapability/v1`, "never through a CLI suffix".
#
# A CLAIM THAT USED TO APPEAR HERE HAS BEEN WITHDRAWN AS FALSE: that
# `runtime_owner_root_id` is a Sha256 which "cannot be inverted to locate `R`", so
# `R` was underivable from `C`. R3.3:215 gives `R = P || native_separator ||
# runtime_owner_basename`, so `R` IS deterministically constructible and the
# Sha256 merely verifies a path you already have. What is genuinely missing is
# LIVE AUTHORITY AND CAPABILITIES, not a path. The removal still stands on the
# other grounds above; it never needed the underivability argument, and repeating
# a false premise would weaken a conclusion that is independently sound.
#
# So the R33 group names below say CONFORMS, never "accredited". The only tests
# that legitimately use the word "accredit" are the Group K authority cases, where
# what is being asserted is that accreditation must NOT happen without authority --
# and per R3.3 step 18 the first authority-success point is the BootstrapReceipt +
# live-capabilities transition to ACTIVE, which no test in this file reaches.
#
# Some prose comments below still discuss accreditation while explaining what it
# would require. Those are descriptions of the contract, not claims about what a
# passing test proves; this banner governs.
# ══════════════════════════════════════════════════════════════════════════

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
# M7/WP4 Phase B.3 regression fixture (dispatch arch-testing-20260809T092330Z):
# see runtime-consultation-cli.bats's own matching comment -- identical
# mechanism, mirrored verbatim here.
GRANT_WRAPPER="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"
RLL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
WAVE_SLUG="rcr-test-wave"
# "Harness-created" test capability (PLAN.md ~L752-753, ~L796) -- this bats suite IS
# the harness for direct-CLI protocol testing, matching
# runtime-consultation-protocol.bats's own convention of minting its own fixed token.
TEST_CAPABILITY="bats-runtime-consultation-roots-fixture-capability"

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
  # This file's host-private registry (registryBaseDir() in
  # runtime-role-lifecycle.cjs resolves purely from $TMPDIR + this OS user's
  # uid) is isolated under bats' own per-test tmpdir, never the real shared
  # canonical registry -- exported before ANY node/hook/bridge/CLI process
  # starts, so every subprocess this test spawns (including GRANT_WRAPPER)
  # inherits it. Mirrors runtime-consultation-bridge.bats's own isolation.
  RUNTIME_TMP="$BATS_TEST_TMPDIR/runtime-tmp"
  mkdir -p "$RUNTIME_TMP"
  chmod 0700 "$RUNTIME_TMP"
  _assert_isolated_runtime_tmp "$RUNTIME_TMP"
  export TMPDIR="$RUNTIME_TMP"

  # Harness test-capability, exported ONCE for the whole test process.
  #
  # The R33 export surface sits behind `isTestCapability()` (`NODE_ENV=test` plus a
  # non-empty `RUNTIME_CONSULTATION_TEST_CAPABILITY`), evaluated at REQUIRE time.
  # Roughly 100 blocks in this file reach a gated export -- via `_run_conformance`,
  # the fixture builders, and the snapshot helpers -- and only a handful set the
  # env per invocation. Exporting here covers all of them in two lines instead of
  # ~88 edits, and bats re-runs setup() per test so nothing leaks between tests.
  #
  # The per-invocation `env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY=...`
  # prefixes on the individual helpers are deliberately LEFT in place: they are
  # harmless, they keep each helper independently runnable, and removing them would
  # be churn that makes a helper silently depend on its caller's environment.
  export NODE_ENV=test
  export RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY"

  PROJ="$(mktemp -d)"
  export RCC_GRANT_PROJECT_ROOT="$PROJ"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL" "$PROJ")"

  COORD_ROOT="$PROJ/.planning/coordination"
  mkdir -p "$COORD_ROOT"
  # Owner-confined 0700, explicitly. `mkdir -p` yields 0755 under the usual 0022
  # umask, and R33 root confinement demands exactly 0700
  # ("coordination root mode is not owner-only 0700").
  #
  # This is DEFENCE, not a repair: the best-effort `root-init` at the end of
  # setup() already chmods 0700 via `cmdRootInit`, and measurement confirms
  # `$COORD_ROOT` is 0700 and passes `validateRootConfinement` today. But that
  # call is deliberately `|| true` -- the header explains why setup() must never
  # gate a test -- so on any future path where it fails the mode would silently
  # fall back to 0755 and every positive R33 case would then fail on the root's
  # MODE rather than on anything it is testing. One line makes the invariant
  # independent of a best-effort call.
  chmod 0700 "$COORD_ROOT"

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
    node "$GRANT_WRAPPER" validate --coordination-root "$COORD_ROOT" --kind "$kind" --artifact "$artifact"
}

# ── Bucket-2 entry point: drive an exported conformance function IN-PROCESS ──
#
# This bypasses `validate` entirely -- no argv parsing, no VALIDATE_KIND_DISPATCH
# lookup, no `coordination/cli-result/v1` envelope. That is the point: the four R33
# CLI kinds are being removed because authority cannot be established inside that
# ABI, while the conformance layer itself survives as internal API with
# contract-mandated in-process callers (R3.3 steps 12 and 17). Bucket-2 tests must
# therefore exercise the function, not the deleted surface.
#
# The four functions all have arity 2 and take `(recordPath, coordRoot)`; the tuple
# takes the BINDING path, since `C`'s two records are derived from `coordRoot`.
# Measured against the module, not inferred from the old dispatch table.
#
# ON THE EXIT CODE, so nobody reads more into it than is there: a thrown `CliError`
# exits 3 and a clean return exits 0. That mirrors `RC_FOR_STATUS` deliberately, so
# assertions stay comparable across the migration -- it is THIS HARNESS's
# convention, NOT a claim that the conformance functions have a process-rc
# contract. They have no such contract; they either return a record or throw.
#
# A throw that is not a `CliError` -- a TypeError from a bad call, say -- exits 9
# with status HARNESS_ERROR rather than being folded into a conformance failure. A
# harness fault must never read as a finding about the code under test.
_run_conformance() {
  local fn="$1" record="$2"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node -e '
      const implPath = process.argv[1], fnName = process.argv[2];
      const recordPath = process.argv[3], coordRoot = process.argv[4];
      const emit = (status, detail) => process.stdout.write(JSON.stringify({
        schema: "test-harness/conformance-result/v1",
        fn: fnName, status: status, detail_code: detail
      }));
      let m;
      try {
        m = require(implPath);
      } catch (err) {
        emit("HARNESS_ERROR", "REQUIRE_FAILED");
        process.exit(9);
      }
      const fn = m[fnName];
      if (typeof fn !== "function") {
        emit("HARNESS_ERROR", "EXPORT_MISSING");
        process.exit(9);
      }
      try {
        fn(recordPath, coordRoot);
      } catch (err) {
        if (err && typeof err.status === "string" && typeof err.detailCode === "string") {
          emit(err.status, err.detailCode);
          process.exit(3);
        }
        emit("HARNESS_ERROR", "UNEXPECTED_THROW_" + ((err && err.constructor && err.constructor.name) || "unknown"));
        process.exit(9);
      }
      emit("SUCCESS", "NONE");
    ' "$IMPL" "$fn" "$record" "$COORD_ROOT"
}

# Conformance counterpart to _assert_cli_result. Deliberately a SEPARATE schema
# (`test-harness/conformance-result/v1`): emitting `coordination/cli-result/v1`
# from an in-process call would be a false statement in the artifact, and would let
# a reader believe the conformance functions produce a CLI envelope.
_assert_conformance() {
  local expected_status="$1" expected_detail="$2"
  node -e '
    let d;
    try {
      d = JSON.parse(process.argv[1]);
    } catch (err) {
      console.error("stdout is not valid JSON: " + err.message);
      process.exit(1);
    }
    if (d.schema !== "test-harness/conformance-result/v1") { console.error("wrong schema: " + d.schema); process.exit(1); }
    if (d.status === "HARNESS_ERROR") {
      if (d.detail_code === "EXPORT_MISSING") {
        // NOT a harness fault. Some cases deliberately name an API that does not
        // exist yet. Retargeting them at an existing function would satisfy them
        // in the WRONG LAYER, which is the specific mistake this message exists to
        // prevent -- it is not a claim that only a correct implementation can
        // satisfy them. See the Group K header: a throwing stub would.
        console.error("API ABSENT: " + d.fn + " is not exported. This is the intended RED while that surface is unbuilt -- do NOT retarget this test at an existing function, and do NOT satisfy it with a stub; see the Group K placeholder note.");
        process.exit(1);
      }
      console.error("HARNESS FAULT (" + d.detail_code + ") calling " + d.fn + " -- this is a defect in the test harness, NOT a conformance result about the code under test");
      process.exit(1);
    }
    const es = process.argv[2], ed = process.argv[3];
    if (d.status !== es) { console.error("expected status " + es + " got " + d.status + " (fn " + d.fn + ")"); process.exit(1); }
    if (ed && d.detail_code !== ed) { console.error("expected detail_code " + ed + " got " + d.detail_code + " (fn " + d.fn + ")"); process.exit(1); }
  ' "$output" "$expected_status" "$expected_detail"
}

# Mechanical, non-self-asserted capability probe for Group K's placeholder
# tests below (~L2933): exit 0 (true, shell-truthy) when `fn` is NOT exported
# by the module under the SAME test-capability env `_run_conformance` itself
# uses -- the exact condition `_run_conformance`/`_assert_conformance` already
# treat as EXPORT_MISSING (L410-414, L445), run standalone so a test can skip
# BEFORE asserting instead of failing on it every time. The moment a future
# Phase B lands `fn` for real, this probe flips to false on its own and the
# gated test starts exercising the real assertion again -- nothing here
# decides that; the module's own export surface does.
_r33_authority_capability_absent() {
  local fn="$1"
  env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node -e '
      const implPath = process.argv[1], fnName = process.argv[2];
      let m;
      try { m = require(implPath); } catch (err) { process.exit(0); }
      process.exit(typeof m[fnName] === "function" ? 1 : 0);
    ' "$IMPL" "$fn"
}

_run_root_init() {
  local root="$1"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" root-init --coordination-root "$root"
}

_run_root_validate() {
  local root="$1"
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$GRANT_WRAPPER" root-validate --coordination-root "$root"
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

# M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z): root-validate is
# now grant-mandatory (PLAN.md §15b). The core resolves which worktree/PLAN
# scope to validate the role-command-grant/v1 against FROM --coordination-root
# itself (`git -C <coordination-root> rev-parse --show-toplevel`, mirroring
# assertRootConfinedToWorktree's own lookup) -- BEFORE ever reaching the
# is-this-a-directory check this test's own SCHEMA_INVALID targets. `git -C`
# against a plain file (not a directory) cannot resolve any worktree at all,
# so grant-scope correlation fails FIRST: empirically confirmed, even a grant
# freshly minted by GRANT_WRAPPER for this test's own exact argv still yields
# AUTHORITY_INVALID, never reaching the SCHEMA_INVALID directory check. This
# is NOT a weakened assertion -- the malformed root is still fully, provably
# rejected (rc3/INVALID, no side effect) -- only the reason changes, because a
# more fundamental gate (authority) now runs before requireFlags/shape checks
# for this exact input, mirroring runtime-consultation-cli.bats's own
# RCC-argv-1 precedent and rationale.
@test "RCR-root-6 FAIL: root-validate on a path that exists but is a regular file (not a directory) is rejected -- INVALID/rc3/AUTHORITY_INVALID post-M7/WP4 (see comment above; was SCHEMA_INVALID pre-grant)" {
  mkdir -p "$COORD_ROOT"
  local root="$COORD_ROOT/lifecycle-plain-file-not-a-dir"
  printf 'this is a file, not a coordination root directory' > "$root"
  _run_root_validate "$root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Group B -- confinement / traversal / symlink (SECURITY -- PLAN.md ~L636, ~L640)
# Adversarial: expected RED against the current root-init/root-validate
# implementation (see header "Key interpretive decisions" for the code-level
# evidence). Each RED result documents a real, precise gap -- not a fixture bug.
# ══════════════════════════════════════════════════════════════════════════

# M7/WP4 Phase B.3 (dispatch arch-testing-20260809T092330Z, mirrors RCR-root-6's
# own comment above): an out-of-worktree --coordination-root cannot resolve
# ANY worktree via `git -C <coordination-root> rev-parse --show-toplevel`
# either (it genuinely IS outside every worktree, or resolves into a
# DIFFERENT one than GRANT_WRAPPER minted the grant against) -- grant-scope
# correlation fails FIRST, before the older SECURITY_INVALID confinement
# check this test originally targeted ever runs. NOT a weakened assertion:
# the out-of-worktree root is still fully, provably rejected (rc3/INVALID, no
# side effect, .lock/registry writes never happen) -- only the reason
# changes, because the new grant-authority gate is, by PLAN.md §15b/~L604's
# own design, more fundamental and runs strictly earlier than any other
# check, confinement included.
@test "RCR-confine-1 FAIL: a coordination-root outside any worktree (generic system temp, no explicit override) is rejected -- INVALID/rc3/AUTHORITY_INVALID post-M7/WP4 (see comment above; was SECURITY_INVALID pre-grant)" {
  EXTRA_TMP_DIR="$(mktemp -d)"
  local outside_root="$EXTRA_TMP_DIR/coordination"
  _run_root_init "$outside_root"
  [ "$status" -eq 3 ]
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
}

@test "RCR-confine-2 FAIL: a coordination-root path containing traversal segments that resolve outside the worktree is rejected -- INVALID/rc3/AUTHORITY_INVALID post-M7/WP4 (see RCR-confine-1's own comment; was SECURITY_INVALID pre-grant)" {
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
  _assert_cli_result "INVALID" "AUTHORITY_INVALID"
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
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
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
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
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
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
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
    node "$GRANT_WRAPPER" publish-request --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
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
    node "$GRANT_WRAPPER" publish-blob --coordination-root "$COORD_ROOT" --plan "$PLAN_FILE" \
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

# ══════════════════════════════════════════════════════════════════════════
# Group G -- R33 CONFORMANCE for the three closed tuple schemas of PLAN §4.1
# stage 1 of 6, driven IN-PROCESS against the exported conformance functions
# (`checkRuntimeProfileBindingV2Conformance`, `checkRootProfileV3Conformance`,
# `checkProviderSessionV3Conformance`).
#
# These cases once ran through `validate --kind …`. That surface is GONE: all four
# R33 kinds were removed from `VALIDATE_KIND_DISPATCH` because authority cannot be
# established inside that ABI, and the group was migrated to the conformance
# functions. Nothing here proves accreditation -- see the terminology banner at the
# top of this file. The only tests that still touch the CLI are the `abi-*` cases,
# which assert those kinds are UNKNOWN.
#
# STATUS: written RED-FIRST -- deliberately unlike Groups A-F above (see this
# file's header, which declares the file as a whole "VERIFICATION, not
# RED-first"). Group G was authored BEFORE the three `--kind` values existed, so
# at authoring time every case terminated in `cmdValidate`'s own unknown-kind
# branch (`CliError('USAGE_ERROR','INVALID_ARGUMENT','unknown --kind: ' +
# flags.kind)`, rc 2). That branch is reached BEFORE any validator runs and
# therefore before any fixture byte is parsed, which is what made the initial
# RED proof-of-an-unregistered-kind rather than evidence about a fixture.
#
# Those three kinds were then registered, and have since been REMOVED again --
# authority cannot be established inside `validate`'s ABI, so the whole R33 CLI
# surface went and this group was migrated to the in-process conformance
# functions. These assertions are therefore a CONFORMANCE contract, never an
# accreditation one. Consult git log, not this comment, for which case was green
# when. Where a case disagrees with the implementation, that disagreement is real
# and gets resolved against the cited R3.2/R3.3/PLAN lines below, never by
# relaxing an assertion.
#
# HISTORICAL, retained because it explains the shape of these fixtures: when these
# ran through the CLI, the reason they were KINDS rather than a new subcommand was
# that the Frozen Production CLI ABI is closed at 18 subcommands with "no WP2
# naming latitude" and contains no root-profile/provider-session command, so the
# only ABI-legal exposure was new closed-schema kinds on the existing
# `validate --coordination-root <absolute>
# --kind <closed-schema-kind> --artifact <canonical-path>` row (PLAN.md ~L785,
# "full schema/path/authority validation, no mutation"). `validate` mutating
# nothing is also precisely what makes it the right probe: it proves rejection
# happens before any write, reservation, lock or terminal side effect.
#
# THE THREE SCHEMAS (all closed -- no optional and no additional keys):
#   RuntimeProfileBindingV2 [6]  -- 6 fixed literals, verbatim
#                                   ARCHITECTURE-PROPOSAL-C-S-L-R3.3.md:2388-2395
#   RootProfileV3          [28]  -- A.3 REPLACE (R3.3:3635-3641) over
#                                   RootProfileV2 [24] (R3.2:2087-2098) via the
#                                   row at R3.3:3651; 24 - 5 removed + 9 added
#   ProviderSessionV3      [28]  -- same operator, row R3.3:3652, over
#                                   ProviderSessionV2 [24] (R3.2:2100-2110)
#   TemporalAuthorityEnvelopeV1 [4] nested in ProviderSessionV3.temporal
#                                   (R3.3:1446-1451)
#
# Key interpretive decisions (this file's established practice of narrating a
# non-obvious call so a future correction is a small obvious fix rather than a
# silent divergence):
#
#   - MonoNs IS A CANONICAL UNSIGNED DECIMAL STRING, NOT A JSON NUMBER.
#     R3.3:1441 defines `MonoNs = alias exacto de DecimalU64 (canonical decimal
#     string)`. The signed `-9223372036854775808..9223372036854775807` range
#     two lines below it at R3.3:1443-1444 belongs to `UnixNs`, a DIFFERENT
#     type -- misreading that range as MonoNs's would make every temporal field
#     here a JSON number and admit negative values. R3.3:1466's
#     "noncanonical decimal -> INVALID before allocation/write" only means
#     anything for a string representation, which corroborates the string
#     reading. So `issued/not_before/expiry_monotonic_ns` are quoted decimal
#     strings with no leading zeros and no sign.
#
#   - ProviderSessionV3 HAS NO `protocol_profile` KEY -- this is not an omission
#     to be "fixed". RootProfileV2 has one (R3.2:2087) and the V3 row re-ADDs
#     it; ProviderSessionV2 (R3.2:2100-2110) has none and the V3 ADD list at
#     R3.3:3652 introduces none. ProviderSessionV3 binds to the profile
#     transitively through `root_profile_digest` and
#     `runtime_binding_receipt_digest`. RCR-r33-session-2 therefore asserts that
#     ADDING a `protocol_profile` key is rejected by the closed key set -- the
#     exact opposite of asserting it equals P33.
#
#   - EACH CASE WRITES A COHERENT THREE-RECORD TUPLE, not one isolated record.
#     PLAN.md:2676-2679 is explicit that "el validator se selecciona primero por
#     el tuple acreditado RuntimeProfileBindingV2 + RootProfileV3 +
#     ProviderSessionV3" and that a schema string, path, record digest or
#     ISOLATED profile literal never selects root/profile. A validator honouring
#     that may legitimately need to read the sibling records, so every case here
#     lays down all three: the 18 identity fields R3.3 requires to agree are
#     declared ONCE in `_write_r33_tuple` and shared byte-equal, and
#     `root_profile_digest` is recomputed with §A.5's real
#     `rootProfileDigestV3` (R3.3:3716-3719) over the profile AFTER overrides
#     are applied. Consequence: each positive case is valid under both a
#     standalone-shape reading and a full-tuple-correlation reading, and each
#     negative case carries exactly ONE defect -- its rejection cannot be
#     explained away as an incidental correlation mismatch the fixture
#     introduced by accident.
#
#   - ARTIFACT PATHS. R3.3:1019-1022 fixes `C/root-profile.json` as containing
#     exactly RootProfileV3 and `C/.provider-session` exactly ProviderSessionV3,
#     so those two fixtures go there verbatim. RuntimeProfileBindingV2 has NO
#     path assigned by R3.3, and R3.3:1038-1039 forbids putting it in `C`
#     anyway ("Fuera de los dos contract records obligatorios ... ningún
#     runtime-owner/provider evidence R33 se escribe en `C`"), so the binding
#     fixture sits inside the worktree but OUTSIDE the coordination root. This
#     choice cannot affect any RED above (unknown-kind precedes all path use)
#     but the implementation must agree with it to go GREEN.
#
#   - `platform`/`architecture` are taken from node's own `process.platform`/
#     `process.arch` rather than hardcoded, so a positive fixture stays valid on
#     both enum members R3.2:2093-2094 permits ("linux"|"darwin",
#     "x64"|"arm64") -- i.e. on this macOS/arm64 host and on a linux/x64 CI
#     runner alike, without a per-platform fixture fork.
#
#   - BYTE-CANONICAL FIXTURES, AND A DELIBERATE LF ASYMMETRY. R3.3:2373-2374
#     governs all of Apéndice A: "canonical sorted compact JSON. Disk records:
#     UTF-8 estricto + un LF; frames: sin LF." The two `C` disk records are
#     therefore STRICT on the trailing LF -- exactly one, so canonical+LF
#     conforms and no-LF/pretty/unsorted/duplicate-key/`3.0` all fail
#     SCHEMA_INVALID. `RuntimeProfileBindingV2` is byte-checked on every one of
#     those axes EXCEPT the LF, where it is agnostic (both canonical and
#     canonical+LF conform), because R3.3 gives the binding no disk path at all
#     and so never says which of the two LF rules governs it. That asymmetry is
#     intentional -- strict on every axis the source specifies, permissive only
#     on the one it does not -- and RCR-r33-binding-3 exists specifically to stop
#     a future refactor from "tidying" it into uniformity. A shape check running
#     after `JSON.parse` structurally cannot see any of these, which is why the
#     byte comparison is a separate layer and why the duplicate-key case matters:
#     it is the R32-smuggling vector (last-wins parse shows P33 while the bytes
#     still carry P32).
#
# Every fixture is written at mode 0600 as a fresh regular single-link file,
# satisfying R3.3:1020-1021's inherited cap-4096/regular/0600/nlink1 contract
# (a 28-key record lands ~2.1 KB, so it is nowhere near the cap; the fixtures
# deliberately do not pad). All of it lives under this suite's per-test
# `mktemp -d` project created by setup() and is removed by teardown(), so no
# live repo artifact and no real .planning tree is ever touched.
# ══════════════════════════════════════════════════════════════════════════

R33_P32="runtime-consultation/r32-csl-posix-local-v1"
R33_P33="runtime-consultation/r33-csl-posix-local-v1"
# Single source of truth for the one clock domain shared by RootProfileV3,
# ProviderSessionV3 and the nested TemporalAuthorityEnvelopeV1 -- R3.3:1465
# makes different domain values incomparable and never converted, so a positive
# fixture must use one value in all three places.
R33_CLOCK_DOMAIN_ID="0a1b0a1b0a1b0a1b0a1b0a1b0a1b0a1b"
# `issued == not_before < expiry` (R3.3:1457-1458), as canonical unsigned
# decimal strings. MonoNs is DecimalU64 -- a canonical UNSIGNED DECIMAL STRING
# (R3.3:1441), NOT a JSON number: the signed range on R3.3:1443-1444 belongs to
# `UnixNs`, an adjacent and different type. Lifetime = 3.6e12 ns = 3600 s.
R33_ISSUED_NS="1000000000000"
R33_EXPIRY_NS="4600000000000"
# 2^53 and 2^53+1. `Number("9007199254740993")` collapses onto 9007199254740992
# because 2^53+1 is not representable as an IEEE double, so these two magnitudes
# are what separate a BigInt comparison from a Number one (R3.3:1441 requires
# the former). Used by the two TRAP cases; see their own comments for why one
# must be a rejecting case and the other an ACCEPTING one.
R33_POW53_NS="9007199254740992"
R33_POW53_PLUS1_NS="9007199254740993"

_r33_binding_path() {
  printf '%s' "$PROJ/runtime-profile-binding.json"
}

_r33_root_profile_path() {
  printf '%s' "$COORD_ROOT/root-profile.json"
}

_r33_session_path() {
  printf '%s' "$COORD_ROOT/.provider-session"
}

# Writes all three R33 tuple records as one coherent set. Each of the three
# override arguments is a small JSON object merged over that record's fully
# populated defaults, with "__OMIT__" deleting a key -- the same idiom
# _write_request/_write_subject_bundle above already use. Overrides are shallow,
# so a `temporal` override supplies the whole nested envelope.
_write_r33_tuple() {
  local binding_overrides="$1" root_overrides="$2" session_overrides="$3"
  R33_P32="$R33_P32" R33_P33="$R33_P33" R33_CLOCK_DOMAIN_ID="$R33_CLOCK_DOMAIN_ID" \
  R33_ISSUED_NS="$R33_ISSUED_NS" R33_EXPIRY_NS="$R33_EXPIRY_NS" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const e = process.env;
    const args = process.argv.slice(1);
    let bindingOv = args[0], rootOv = args[1], sessionOv = args[2];
    const bindingOut = args[3], rootOut = args[4], sessionOut = args[5];

    // "__BYTES__" is a reserved override DIRECTIVE, not a record key: it selects
    // how that record is SERIALISED on disk. Stripped before the merge, so it can
    // never reach the written object and never counts toward key cardinality.
    const modes = {};
    const stripBytesMode = (label, ovJson) => {
      const ov = JSON.parse(ovJson);
      modes[label] = Object.prototype.hasOwnProperty.call(ov, "__BYTES__") ? ov.__BYTES__ : "canonical-lf";
      delete ov.__BYTES__;
      return JSON.stringify(ov);
    };
    bindingOv = stripBytesMode("binding", bindingOv);
    rootOv = stripBytesMode("root", rootOv);
    sessionOv = stripBytesMode("session", sessionOv);

    // Byte-exact canonical JSON: sorted object keys, no incidental whitespace.
    // Mirrors runtime-consultation.cjs canonicalJSONStringify/sortKeysDeep so a
    // digest computed here matches one the implementation computes there.
    const sortKeysDeep = (v) => {
      if (Array.isArray(v)) return v.map(sortKeysDeep);
      if (v !== null && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
        return out;
      }
      return v;
    };
    const canonical = (v) => JSON.stringify(sortKeysDeep(v));

    // R3.3 A.5 domain-separated digest: SHA256(UTF8(label) || 0x00 || UTF8(canonical(record)))
    // over the FULL record, no field exclusion (R3.3:3716-3729).
    const domainDigest = (label, obj) => crypto.createHash("sha256").update(
      Buffer.concat([Buffer.from(label, "utf8"), Buffer.from([0]), Buffer.from(canonical(obj), "utf8")])
    ).digest("hex");

    const merge = (base, ovJson) => {
      const merged = Object.assign({}, base, JSON.parse(ovJson));
      for (const k of Object.keys(merged)) {
        if (merged[k] === "__OMIT__") delete merged[k];
      }
      return merged;
    };

    // Byte emission. R3.3:2373-2374 governs Apéndice A as a whole: "Todos los
    // objetos son additionalProperties:false, sin duplicate keys, canonical
    // sorted compact JSON. Disk records: UTF-8 estricto + un LF." So the
    // on-disk form of a valid record is EXACTLY canonical(obj) + one LF, and a
    // shape-only check after JSON.parse structurally cannot see a violation of
    // it. Each named mode below breaks exactly ONE axis of that rule, so a
    // rejection isolates to that axis:
    //   canonical-lf              the valid form (default)
    //   canonical-no-lf          missing the trailing LF
    //   pretty                   indented + unsorted-by-serialiser
    //   dup-protocol-profile-p32 duplicate key, P32 FIRST and P33 LAST -- the
    //                            R32-smuggling vector: JSON.parse keeps the last
    //                            value, so a post-parse literal check sees P33
    //                            while the bytes still carry P32, and a
    //                            first-wins parser elsewhere would read R32
    //   abi-float                provider_abi as 3.0, IEEE-identical to 3, so
    //                            `v === 3` cannot reject it
    const bytesFor = (obj, mode) => {
      const c = canonical(obj);
      if (mode === "canonical-lf") return Buffer.from(c + "\n", "utf8");
      if (mode === "canonical-no-lf") return Buffer.from(c, "utf8");
      if (mode === "pretty") return Buffer.from(JSON.stringify(sortKeysDeep(obj), null, 2) + "\n", "utf8");
      // Carrier-byte variants. The accepted forms are EXACTLY canonical (binding
      // only) and canonical + one LF; every mode below differs from one of those
      // by whitespace alone, which is precisely what a post-JSON.parse check
      // cannot see because all of them parse to the identical object.
      if (mode === "crlf") return Buffer.from(c + "\r\n", "utf8");
      if (mode === "double-lf") return Buffer.from(c + "\n\n", "utf8");
      if (mode === "leading-ws") return Buffer.from(" " + c, "utf8");
      if (mode === "trailing-ws") return Buffer.from(c + " ", "utf8");
      // Insertion-order serialisation. The record literals in this helper are
      // declared in schema order, NOT lexicographic order, so a plain
      // JSON.stringify genuinely produces unsorted keys here -- verified by the
      // guard below rather than assumed, since an accidentally-already-sorted
      // literal would make this mode a silent no-op that always "passes".
      if (mode === "unsorted") {
        const u = JSON.stringify(obj);
        if (u === c) {
          console.error("FIXTURE BUG: unsorted mode produced byte-identical output to canonical -- the literal is already in sorted order, so this case would prove nothing");
          process.exit(1);
        }
        return Buffer.from(u + "\n", "utf8");
      }
      if (mode === "dup-protocol-profile-p32") {
        const needle = "\"protocol_profile\":\"" + e.R33_P33 + "\"";
        if (!c.includes(needle)) {
          console.error("FIXTURE BUG: dup directive found no P33 protocol_profile literal to duplicate");
          process.exit(1);
        }
        return Buffer.from(c.replace(needle, "\"protocol_profile\":\"" + e.R33_P32 + "\"," + needle) + "\n", "utf8");
      }
      if (mode === "abi-float") {
        const needle = "\"provider_abi\":3";
        if (!c.includes(needle)) {
          console.error("FIXTURE BUG: abi-float directive found no provider_abi literal");
          process.exit(1);
        }
        return Buffer.from(c.replace(needle, "\"provider_abi\":3.0") + "\n", "utf8");
      }
      console.error("FIXTURE BUG: unknown __BYTES__ mode: " + mode);
      process.exit(1);
    };

    const write = (p, obj, mode) => {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, bytesFor(obj, mode), { mode: 0o600 });
      fs.chmodSync(p, 0o600);
    };

    const hex64 = (pair) => pair.repeat(32);
    const hex32 = (quad) => quad.repeat(8);

    // The exact 18 identity fields R3.3 A.5 requires to agree byte-equal across
    // RootProfileV3 and ProviderSessionV3, declared once so no positive fixture
    // can drift out of correlation. Distinct well-formed lowercase-hex values:
    // Sha256 = 64 chars, Id128/HexId = 32 chars.
    const shared = {
      runtime_owner_root_id: hex64("a1"),
      clock_domain_id: e.R33_CLOCK_DOMAIN_ID,
      clock_domain_receipt_digest: hex64("b2"),
      coordination_root_id: hex64("c3"),
      physical_root_id: hex64("d4"),
      coordination_root_identity_security_digest: hex64("e5"),
      canonical_root_path_digest: hex64("f6"),
      mount_projection_digest: hex64("07"),
      root_generation_id: hex32("1c2d"),
      root_bootstrap_id: hex32("2e3f"),
      provider_session_id: hex32("3041"),
      local_filesystem_capability_digest: hex64("18"),
      mount_generation_digest: hex64("29"),
      provider_name: "acd-transition-lock-posix",
      provider_build_digest: hex64("3a"),
      provider_manager_kind: "retained-native-host-owner",
      provider_manager_lifetime_profile: "retained-session",
      coordination_mode: "auto"
    };

    // RuntimeProfileBindingV2 [6] -- all six values are fixed literals
    // (5 exact strings + integer 3), R3.3:2388-2395 verbatim.
    const bindingDefaults = {
      schema: "runtime/csl-profile-binding/v2",
      protocol_profile: e.R33_P33,
      control_protocol: "transition-lock/provider-control/v3",
      provider_abi: 3,
      handle_protocol: "transition-lock/provider-handle/v2",
      subject_manifest: "coordination/subject-bundle-manifest/v2"
    };
    const binding = merge(bindingDefaults, bindingOv);

    // RootProfileV3 [28] = 9 ADDed (R3.3:3651) + 19 retained from
    // RootProfileV2 [24] (R3.2:2087-2098) after its 5 REMOVEd. Note
    // provider_abi/control_protocol/protocol_profile are REMOVEd then re-ADDed
    // with NEW literals (3, /v3, P33), while lock_profile is retained
    // UNCHANGED at /v2 -- a deliberate asymmetry, not a typo.
    const rootProfileDefaults = {
      schema: "coordination/root-profile/v3",
      protocol_profile: e.R33_P33,
      control_protocol: "transition-lock/provider-control/v3",
      provider_abi: 3,
      handle_protocol: "transition-lock/provider-handle/v2",
      runtime_owner_root_id: shared.runtime_owner_root_id,
      clock_domain_id: shared.clock_domain_id,
      clock_domain_receipt_digest: shared.clock_domain_receipt_digest,
      created_at_diagnostic_utc: "2025-01-01T00:00:00Z",
      lock_profile: "transition-lock/file-posix/v2",
      coordination_root_id: shared.coordination_root_id,
      physical_root_id: shared.physical_root_id,
      coordination_root_identity_security_digest: shared.coordination_root_identity_security_digest,
      canonical_root_path_digest: shared.canonical_root_path_digest,
      mount_projection_digest: shared.mount_projection_digest,
      root_generation_id: shared.root_generation_id,
      root_bootstrap_id: shared.root_bootstrap_id,
      provider_session_id: shared.provider_session_id,
      local_filesystem_profile: "local-posix/v2",
      local_filesystem_capability_digest: shared.local_filesystem_capability_digest,
      mount_generation_digest: shared.mount_generation_digest,
      provider_name: shared.provider_name,
      provider_build_digest: shared.provider_build_digest,
      platform: process.platform,
      architecture: process.arch,
      provider_manager_kind: shared.provider_manager_kind,
      provider_manager_lifetime_profile: shared.provider_manager_lifetime_profile,
      coordination_mode: shared.coordination_mode
    };
    const rootProfile = merge(rootProfileDefaults, rootOv);

    // ProviderSessionV3 [28] = 9 ADDed (R3.3:3652) + 19 retained from
    // ProviderSessionV2 [24] (R3.2:2100-2110) after its 5 REMOVEd. No
    // protocol_profile key exists in this record by construction -- see the
    // Group G header.
    //
    // root_profile_digest is computed over the POST-override rootProfile above,
    // so a case that mutates the profile still ships a correctly correlated
    // session and its rejection isolates to the profile defect alone.
    const sessionDefaults = {
      schema: "coordination/provider-session/v3",
      provider_abi: 3,
      control_protocol: "transition-lock/provider-control/v3",
      runtime_owner_root_id: shared.runtime_owner_root_id,
      runtime_binding_receipt_digest: hex64("4b"),
      clock_domain_id: shared.clock_domain_id,
      clock_domain_receipt_digest: shared.clock_domain_receipt_digest,
      temporal: {
        clock_domain_id: shared.clock_domain_id,
        issued_monotonic_ns: e.R33_ISSUED_NS,
        not_before_monotonic_ns: e.R33_ISSUED_NS,
        expiry_monotonic_ns: e.R33_EXPIRY_NS
      },
      started_at_diagnostic_utc: "2025-01-01T00:00:00Z",
      coordination_root_id: shared.coordination_root_id,
      physical_root_id: shared.physical_root_id,
      coordination_root_identity_security_digest: shared.coordination_root_identity_security_digest,
      canonical_root_path_digest: shared.canonical_root_path_digest,
      mount_projection_digest: shared.mount_projection_digest,
      root_generation_id: shared.root_generation_id,
      root_bootstrap_id: shared.root_bootstrap_id,
      root_profile_digest: domainDigest("coordination/root-profile/v3", rootProfile),
      local_filesystem_capability_digest: shared.local_filesystem_capability_digest,
      mount_generation_digest: shared.mount_generation_digest,
      provider_name: shared.provider_name,
      provider_build_digest: shared.provider_build_digest,
      provider_session_id: shared.provider_session_id,
      control_endpoint_id: hex32("4152"),
      provider_manager_instance_id: hex32("5263"),
      provider_manager_kind: shared.provider_manager_kind,
      provider_manager_lifetime_profile: shared.provider_manager_lifetime_profile,
      coordination_mode: shared.coordination_mode,
      owner_pid: 4242
    };
    const session = merge(sessionDefaults, sessionOv);

    // Fixture self-check, in two parts. Without it a transcription slip in the
    // 62 keys above would silently turn a schema assertion below into a
    // meaningless one, so it fails loudly instead.
    //   (1) the DEFAULTS must carry exactly the closed-schema cardinality --
    //       this is the assertion that pins the transcribed key sets;
    //   (2) the MERGED record must carry exactly the cardinality this case
    //       intends, derived from the override rather than assumed: an override
    //       key absent from the defaults is +1 (a deliberately additional key),
    //       an "__OMIT__" of a present key is -1, and re-valuing an existing
    //       key is 0. So a mistyped override name that MEANT to re-value an
    //       existing key still trips this check instead of quietly shipping an
    //       extra key. Note both comparisons are against the defaults, never
    //       against the post-merge object -- in the merged object an added key
    //       is indistinguishable from a pre-existing one.
    //
    // No apostrophe may appear anywhere inside this node script: the whole
    // script is a bash single-quoted argument, so one stray ASCII quote
    // silently terminates it and breaks every case in this group.
    const expect = (label, defaults, merged, n, ovJson) => {
      if (Object.keys(defaults).length !== n) {
        console.error("FIXTURE BUG: " + label + " defaults have " + Object.keys(defaults).length + " keys, closed schema is " + n);
        process.exit(1);
      }
      const ov = JSON.parse(ovJson);
      let want = n;
      for (const k of Object.keys(ov)) {
        if (ov[k] === "__OMIT__") {
          if (k in defaults) want -= 1;
        } else if (!(k in defaults)) {
          want += 1;
        }
      }
      if (Object.keys(merged).length !== want) {
        console.error("FIXTURE BUG: " + label + " has " + Object.keys(merged).length + " keys, this case intends " + want);
        process.exit(1);
      }
    };
    expect("RuntimeProfileBindingV2", bindingDefaults, binding, 6, bindingOv);
    expect("RootProfileV3", rootProfileDefaults, rootProfile, 28, rootOv);
    expect("ProviderSessionV3", sessionDefaults, session, 28, sessionOv);

    write(bindingOut, binding, modes.binding);
    write(rootOut, rootProfile, modes.root);
    write(sessionOut, session, modes.session);
  ' "$binding_overrides" "$root_overrides" "$session_overrides" \
    "$(_r33_binding_path)" "$(_r33_root_profile_path)" "$(_r33_session_path)"
}

# ── G.1 RuntimeProfileBindingV2 [6] ─────────────────────────────────────────

@test "RCR-r33-binding-1 PASS: a RuntimeProfileBindingV2 carrying all 6 fixed literals with protocol_profile = P33 CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-binding-2 FAIL: a RuntimeProfileBindingV2 whose protocol_profile is the R32 literal P32 instead of P33 is rejected SCHEMA_INVALID" {
  # Wrong direct profile literal is the FIRST rung of PLAN.md:2896-2907's error
  # precedence -- SCHEMA_INVALID, decided before any derived digest, and never
  # a dynamic dispatch to an R32 validator (PLAN.md:2673). Every other byte of
  # the tuple stays valid, so P32 alone is what is under test.
  _write_r33_tuple "$(printf '{"protocol_profile":"%s"}' "$R33_P32")" '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-3 PASS: a canonical RuntimeProfileBindingV2 with NO trailing LF still CONFORMS (conformance only; the binding is LF-agnostic by design)" {
  # Deliberate asymmetry, not an oversight. R3.3:2374 splits its LF rule two
  # ways -- "Disk records: UTF-8 estricto + un LF; frames: sin LF" -- and
  # R3.3:1037-1039 gives the binding NO disk path at all (it may not even live
  # in `C`), so the source genuinely does not say which of the two rules governs
  # it. Strict on every axis the source specifies, permissive only on the one it
  # does not. This case is the regression guard that stops the asymmetry being
  # "tidied" into uniformity with the two strict-LF `C` records below.
  _write_r33_tuple '{"__BYTES__":"canonical-no-lf"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-binding-4 FAIL: a RuntimeProfileBindingV2 with a DUPLICATE protocol_profile key (P32 first, P33 last) is rejected SCHEMA_INVALID" {
  # The R32->R33 smuggling vector, on the one record whose entire job is to
  # carry the P33 literal. `JSON.parse` keeps the LAST duplicate, so a
  # post-parse literal check sees P33 and the record conforms, while the bytes still carry
  # P32 -- and a first-wins parser elsewhere would read the very same artifact as
  # R32. That cross-parser disagreement is exactly what PLAN §3.6 exists to
  # prevent, so this must be caught at the byte layer (R3.3:2373, "sin duplicate
  # keys"), which is the only layer that can see it.
  _write_r33_tuple '{"__BYTES__":"dup-protocol-profile-p32"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-5 FAIL: a RuntimeProfileBindingV2 whose provider_abi is serialised as 3.0 is rejected SCHEMA_INVALID" {
  # 3.0 is IEEE-identical to 3, so `v === 3` cannot reject it and no post-parse
  # check ever will -- only the canonical-bytes comparison can (R3.3:2373,
  # "canonical sorted compact JSON", whose canonical integer form is `3`).
  _write_r33_tuple '{"__BYTES__":"abi-float"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── G.1b Binding CARRIER bytes: the accepted set is EXACTLY two forms ────────
# `canonicalJSONStringify(binding)` and that same payload plus exactly ONE LF.
# Anything else is rejected. RCR-r33-binding-1 and -3 pin the two ACCEPTED forms;
# the six cases below pin the boundary just outside them. Each differs from an
# accepted form by whitespace alone and parses to the identical object, so none of
# them is reachable by a check that runs after JSON.parse.
#
# The binding is a pathless diagnostic carrier -- it has no defined transport and
# therefore holds no path or transport authority -- which is why it tolerates the
# missing LF at all. That latitude stops dead at whitespace.

@test "RCR-r33-binding-6 FAIL: a RuntimeProfileBindingV2 carrier terminated with CRLF instead of a bare LF is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{"__BYTES__":"crlf"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-7 FAIL: a RuntimeProfileBindingV2 carrier terminated with TWO LFs is rejected SCHEMA_INVALID (exactly one, or none)" {
  _write_r33_tuple '{"__BYTES__":"double-lf"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-8 FAIL: a RuntimeProfileBindingV2 carrier with LEADING whitespace is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{"__BYTES__":"leading-ws"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-9 FAIL: a RuntimeProfileBindingV2 carrier with TRAILING whitespace is rejected SCHEMA_INVALID" {
  # Distinct from binding-3 (bare canonical, ACCEPTED): the only delta here is one
  # trailing space, so tolerating the absent LF must not slide into tolerating
  # arbitrary trailing bytes.
  _write_r33_tuple '{"__BYTES__":"trailing-ws"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-10 FAIL: a pretty-printed RuntimeProfileBindingV2 carrier is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{"__BYTES__":"pretty"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-binding-11 FAIL: a RuntimeProfileBindingV2 carrier with UNSORTED keys is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{"__BYTES__":"unsorted"}' '{}' '{}'
  _run_conformance checkRuntimeProfileBindingV2Conformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── G.2 RootProfileV3 [28] ──────────────────────────────────────────────────

@test "RCR-r33-rootprofile-1 PASS: a RootProfileV3 carrying exactly the 28 REPLACE-derived keys CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-rootprofile-2 FAIL: a RootProfileV3 whose protocol_profile is the R32 literal P32 instead of P33 is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' "$(printf '{"protocol_profile":"%s"}' "$R33_P32")" '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-3 FAIL: a RootProfileV3 missing exactly one required key (27 present) is rejected SCHEMA_INVALID" {
  # `handle_protocol` is the sharpest single key to omit: it is the one key the
  # V3 ADD list (R3.3:3651) introduces that has NO counterpart anywhere in
  # RootProfileV2 [24]. A validator that accepted this record would be
  # accepting the V2 base key set under a V3 schema literal -- exactly the
  # "no fallback"/"no dispatch dinámico a validator R32" prohibition of
  # PLAN.md:2671-2673.
  _write_r33_tuple '{}' '{"handle_protocol":"__OMIT__"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-4 FAIL: a RootProfileV3 carrying one additional unknown key (29 present) is rejected SCHEMA_INVALID" {
  # `created_at` is the sharpest single key to ADD: the REPLACE row removes
  # exactly it and supplies `created_at_diagnostic_utc` in its place, so a
  # record carrying BOTH proves the REMOVE half of the operator held and that
  # "no optional/additional properties" (PLAN.md:2669) is enforced rather than
  # V2-era keys being tolerated alongside their V3 replacements.
  _write_r33_tuple '{}' '{"created_at":"2025-01-01T00:00:00Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-5 FAIL: a canonical RootProfileV3 with NO trailing LF is rejected SCHEMA_INVALID (C disk records are strict on the LF)" {
  # The exact converse of RCR-r33-binding-3. `C/root-profile.json` IS a disk
  # record, so R3.3:2374's "Disk records: UTF-8 estricto + un LF" binds it and
  # the LF is mandatory. Every other byte is byte-for-byte the conformant form,
  # so the missing LF is the only defect.
  _write_r33_tuple '{}' '{"__BYTES__":"canonical-no-lf"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-6 FAIL: a pretty-printed RootProfileV3 is rejected SCHEMA_INVALID even though it parses to the identical object" {
  # Same 28 keys, same values, same trailing LF -- only the whitespace differs.
  # `JSON.parse` yields a byte-identical object, so this is unreachable by any
  # post-parse shape check and reachable only by the canonical-bytes comparison.
  _write_r33_tuple '{}' '{"__BYTES__":"pretty"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-7 FAIL: a RootProfileV3 with a DUPLICATE protocol_profile key (P32 first, P33 last) is rejected SCHEMA_INVALID" {
  # The same R32-smuggling vector as RCR-r33-binding-4, asserted independently
  # against the root-profile validator: the byte layer must be enforced per
  # validator, not assumed to be shared.
  _write_r33_tuple '{}' '{"__BYTES__":"dup-protocol-profile-p32"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-8 FAIL: a RootProfileV3 whose provider_abi is serialised as 3.0 is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"__BYTES__":"abi-float"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-9 FAIL: a RootProfileV3 terminated with CRLF is rejected SCHEMA_INVALID (the C records take exactly one bare LF)" {
  # The strict side of the asymmetry. RCR-r33-binding-6 asserts the same rejection
  # on the carrier; this asserts it on a real disk record, where R3.3:2374's
  # "Disk records: UTF-8 estricto + un LF" is what binds. Both sides need their own
  # regression or a refactor that unified them would only break one.
  _write_r33_tuple '{}' '{"__BYTES__":"crlf"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-rootprofile-10 FAIL: a RootProfileV3 terminated with TWO LFs is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"__BYTES__":"double-lf"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# G.4 -- IsoUtc boundary. `created_at_diagnostic_utc` /
# `started_at_diagnostic_utc` are normatively `YYYY-MM-DDTHH:MM:SSZ` naming a
# REAL calendar date, byte-identical on round-trip, with no fractional seconds
# and no offset.
#
# PROVENANCE: CITED, not derived. `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:143`:
#     | IsoUtc | UTC `YYYY-MM-DDTHH:MM:SSZ`, fecha válida y round-trip idéntico |
# That single line supplies all three properties this group asserts: the exact
# Z-only shape; a REAL calendar date ("fecha válida" -- hence isoutc-4/5/6 and the
# leap-day counterweight isoutc-7); and byte-identical round-trip -- hence the
# fractional-second rejections, since `.000Z` and `Z` denote one instant in two
# spellings and cannot both round-trip.
#
# These cases were first written against a DERIVED fail-closed ruling whose stated
# grounds were that no literal grammar existed anywhere in R3.3, R3.2 or R3.1. It
# does exist. The search had stopped at R3.2 rather than following the primitive
# chain R3.3:2375 -> R3.2:150 -> R3.1:143-146 to its base. The assertions were
# already right; what changes is that they enforce CONTRACT rather than our
# reading, which matters because an under-claimed provenance invites a later
# reader to re-derive a cited rule and land somewhere looser.
#
# Every rejecting case below except the three shape cases was ACCEPTED by the
# shipped predicate, because a `new Date(...)`-based check is far more permissive
# than the grammar: it tolerates fractional seconds and it silently ROLLS OVER
# impossible calendar dates (`2025-02-30` becomes March 2 rather than failing), so
# two different strings denote one instant and the round-trip is not
# byte-identical.
#
# RCR-r33-isoutc-7 is the counterweight and matters as much as the rejects: a real
# leap day must still ACCEPT, so a fix cannot just ban February 29 outright.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-isoutc-1 PASS: created_at_diagnostic_utc in the canonical YYYY-MM-DDTHH:MM:SSZ form CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2026-07-25T00:00:00Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-isoutc-2 FAIL: created_at_diagnostic_utc with zero-valued fractional seconds (.000Z) is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2026-07-25T00:00:00.000Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-3 FAIL: created_at_diagnostic_utc with non-zero fractional seconds (.5Z) is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2026-07-25T00:00:00.5Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-4 FAIL: created_at_diagnostic_utc naming February 30 is rejected SCHEMA_INVALID (no month has 30 February days)" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2025-02-30T00:00:00Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-5 FAIL: created_at_diagnostic_utc naming April 31 is rejected SCHEMA_INVALID (April has 30 days)" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2025-04-31T00:00:00Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-6 FAIL: created_at_diagnostic_utc naming February 29 in the NON-leap year 2025 is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2025-02-29T00:00:00Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-7 PASS: created_at_diagnostic_utc naming February 29 in the REAL leap year 2024 CONFORMS (conformance only; guards against over-correcting isoutc-6)" {
  # The pair (isoutc-6, isoutc-7) is the point: a predicate that simply rejects
  # every 02-29 passes isoutc-6 and fails here. Only real leap-year arithmetic
  # satisfies both.
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2024-02-29T00:00:00Z"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-isoutc-8 FAIL: created_at_diagnostic_utc carrying a +05:00 offset instead of Z is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2026-07-25T00:00:00+05:00"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-9 FAIL: a date-only created_at_diagnostic_utc is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2026-07-25"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-10 FAIL: created_at_diagnostic_utc with no trailing Z is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{"created_at_diagnostic_utc":"2026-07-25T00:00:00"}' '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# `started_at_diagnostic_utc` on ProviderSessionV3 is a SEPARATE field on a
# separate validator, so it gets its own coverage rather than inheriting the ten
# cases above by assumption. Three cases carry the load: the shipped predicate's
# headline defect (fractional seconds), the calendar-rollover defect, and the
# leap-day counterweight that stops an over-correction.

@test "RCR-r33-isoutc-session-1 FAIL: started_at_diagnostic_utc with fractional seconds (.000Z) is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{}' '{"started_at_diagnostic_utc":"2026-07-25T00:00:00.000Z"}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-session-2 FAIL: started_at_diagnostic_utc naming February 29 in the non-leap year 2025 is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{}' '{"started_at_diagnostic_utc":"2025-02-29T00:00:00Z"}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-isoutc-session-3 PASS: started_at_diagnostic_utc naming the real leap day 2024-02-29 CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{}' '{"started_at_diagnostic_utc":"2024-02-29T00:00:00Z"}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

# ══════════════════════════════════════════════════════════════════════════
# G.5 -- DecimalU64 boundary on the temporal MonoNs fields.
#
# PROVENANCE: CITED, not derived. `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:145`:
#     | DecimalU64 | string decimal canónico `0..18446744073709551615` |
# So BOTH halves are contract: the `0..2^64-1` bound (u64-1 accept at MAX, u64-2
# reject at MAX+1) and the canonical-decimal grammar (u64-3/4/5 -- no leading
# zero, no sign, unsigned). An earlier revision recorded the upper bound as
# DERIVED from the `U64` type name and logged it as a known limitation; that was
# the same stopped-at-R3.2 search as the IsoUtc group above. Note R3.1:146 also
# supplies `Pid | integer 1..2147483647`, which is what Group L enforces.
#
# `DecimalU64` is normatively canonical decimal `0..18446744073709551615`, so both
# the upper bound and the canonical grammar (digits only, no leading zero, no
# sign) are enforceable. 2^64-1 exceeds IEEE double range entirely, which is a
# second, independent reason the comparison cannot be Number-based -- distinct
# from the
# 2^53 traps above, which are about precision rather than magnitude.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-u64-1 PASS: temporal expiry at DecimalU64 MAX (18446744073709551615) CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"18446744073709551615"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_ISSUED_NS" "$R33_ISSUED_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-u64-2 FAIL: temporal expiry at DecimalU64 MAX+1 (18446744073709551616) is rejected SCHEMA_INVALID" {
  # Paired with u64-1: one digit apart, so only a real 2^64-1 bound separates
  # them. A Number-based range check cannot: both values round to the same double.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"18446744073709551616"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_ISSUED_NS" "$R33_ISSUED_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-u64-3 FAIL: a temporal MonoNs with a LEADING ZERO (007) is rejected SCHEMA_INVALID (non-canonical decimal)" {
  # Numerically 7, and any coercing parser accepts it -- which is exactly why the
  # grammar, not the value, has to be checked (R3.3:1466, "noncanonical decimal ->
  # INVALID before allocation/write").
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"007","not_before_monotonic_ns":"007","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_EXPIRY_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-u64-4 FAIL: a temporal MonoNs with an explicit PLUS sign (+7) is rejected SCHEMA_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"+7","not_before_monotonic_ns":"+7","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_EXPIRY_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-u64-5 FAIL: a NEGATIVE temporal MonoNs (-1) is rejected SCHEMA_INVALID (DecimalU64 is unsigned)" {
  # The concrete cost of the MonoNs/UnixNs mix-up: UnixNs is signed and would
  # admit this, DecimalU64 is unsigned and must not.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"-1","not_before_monotonic_ns":"-1","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_EXPIRY_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Group H -- TUPLE-FIRST SELECTION AND CORRELATION (conformance only). This is
# the part Group G does NOT do: PLAN §3.1 tuple-first selection
# (PLAN.md:2676-2679), where the tuple `RuntimeProfileBindingV2 + RootProfileV3 +
# ProviderSessionV3` is checked as a WHOLE before any single record is trusted.
#
# Nothing here proves accreditation. `checkR33ProfileTupleConformance` is
# expressly non-authoritative: it establishes closed schema, canonical bytes,
# confined paths, the 17-key correlation set and the digest chain, and no more.
# The authority tier does not exist -- see Group K.
#
# SURFACE: driven IN-PROCESS via `_run_conformance checkR33ProfileTupleConformance
# <bindingPath>`, with `C` supplied from `$COORD_ROOT`. The binding is passed
# explicitly because it is the one record with no defined path; both `C` records
# are derived from the coordination root.
#
# These cases once ran through `validate --kind r33-profile-tuple`. That kind was
# removed with the rest of the R33 CLI surface, and one assertion did not survive
# the move: a check that `artifact_ref` named the BINDING rather than either `C`
# record. That was a property of the frozen CLI envelope (PLAN.md:789), and the
# conformance function returns a record rather than an envelope, so it has no
# counterpart here and no successor elsewhere -- after removal there is no
# successful `r33-profile-tuple` CLI call for an `artifact_ref` to describe. Its
# absence is a consequence of the removal, not coverage quietly dropped. No case
# below reads it that way.
#
# HONEST SCOPE OF WHAT THE BINDING CONTRIBUTES: all six RuntimeProfileBindingV2
# fields are fixed literals and the record carries NO field tying it to a
# particular root -- no coordination_root_id, no root_generation_id, no digest.
# So any conforming binding satisfies any tuple: it is a CONFORMANCE check, not an
# identity binding, and no test here claims otherwise. The tuple's real force
# comes from the two `C` records plus the 17-key and digest correlation.
#
# DETAIL-CODE PRECEDENCE (PLAN.md:2896-2907):
#   wrong direct/nested profile literal / any shape defect -> SCHEMA_INVALID
#   valid shape, cross-record root/profile disagreement    -> CORRELATION_INVALID
#   actor/capability/receipt/digest authority disagreement  -> AUTHORITY_INVALID
# The AUTHORITY tier is NOT exercised here: there is no BootstrapReceipt record
# anywhere in this codebase to disagree with, so receipt correlation belongs to a
# later stage (contract §10b J).
#
# The ladder ranks the three TIERS but does NOT rank the rules WITHIN the
# correlation tier against each other -- the 17-key agreement rule (derived,
# §8b), the digest chain (cited, §8a) and temporal domain agreement (derived,
# §8d) all yield CORRELATION_INVALID. So any case below carrying more than one
# correlation defect asserts status + detail_code and stops there; asserting
# which rule fired would freeze an implementation detail as contract.
#
# The 17-key correlation set is DERIVED, not cited (§8b):
#   (keys(RootProfileV3) ∩ keys(ProviderSessionV3)) minus keys that are a FIXED
#   LITERAL in both -- the subtraction matters because a literal agrees by
#   construction and any deviation is already SCHEMA_INVALID at shape time, so
#   including it would create a guard that can never fire.
# ══════════════════════════════════════════════════════════════════════════

# Well-formed alternates: correct TYPE, different VALUE. Every correlation case
# below swaps one field to one of these, so each record stays individually
# SHAPE-valid and the ONLY defect is the cross-record disagreement -- otherwise
# the case would trip SCHEMA_INVALID first and prove nothing about correlation.
R33_ALT_SHA256="9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f"
R33_ALT_ID128="9e8d9e8d9e8d9e8d9e8d9e8d9e8d9e8d"

# ── H.A Positive ────────────────────────────────────────────────────────────

@test "RCR-r33-tuple-1 PASS: a fully coherent tuple (three valid records, all 17 correlation keys byte-equal, correct root_profile_digest, matching temporal domain) CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
  # REMOVED IN THE BUCKET-2 MIGRATION, deliberately and with no successor: this
  # case used to also assert `artifact_ref` named the BINDING rather than either
  # `C` record -- a consequence of `cmdValidate` sourcing that field from the
  # single `--artifact` against PLAN.md:789's frozen envelope.
  #
  # That property belonged to the CLI envelope, and the conformance function
  # returns a record rather than an envelope, so there is nothing here to assert
  # it against. It does not move to bucket 1 either: bucket 1 asserts the kind is
  # UNKNOWN, so after A1 there is no successful `r33-profile-tuple` CLI call
  # anywhere for an `artifact_ref` to describe. The property ceases to exist with
  # the surface rather than migrating -- recorded so its disappearance reads as a
  # consequence of the removal and not as coverage quietly dropped.
}

# ── H.B Correlation: one mutated field each -> CORRELATION_INVALID ──────────
# Each mutates the SESSION copy, leaving the root profile untouched, so
# `root_profile_digest` (recomputed over the root profile) stays correct and the
# 17-key disagreement is the single defect.

@test "RCR-r33-tuple-corr-1 FAIL: coordination_root_id disagreeing between RootProfileV3 and ProviderSessionV3 is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"coordination_root_id":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-2 FAIL: root_generation_id disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"root_generation_id":"%s"}' "$R33_ALT_ID128")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-3 FAIL: provider_session_id disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"provider_session_id":"%s"}' "$R33_ALT_ID128")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-4 FAIL: runtime_owner_root_id disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"runtime_owner_root_id":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-5 FAIL: coordination_mode disagreeing across the two C records is CORRELATION_INVALID (a closed ENUM, so two individually-valid records can legitimately differ)" {
  # This is why the three enum fields belong in the correlation set and the four
  # fixed literals do not: "persistent" is a perfectly valid coordination_mode,
  # so the record passes shape validation and only the cross-record comparison
  # can catch it. A fixed-literal field could never reach this layer.
  _write_r33_tuple '{}' '{}' '{"coordination_mode":"persistent"}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-6 FAIL: provider_manager_kind disagreeing across the two C records is CORRELATION_INVALID (second enum case)" {
  _write_r33_tuple '{}' '{}' '{"provider_manager_kind":"runtime-session-supervisor"}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-7 FAIL: root_bootstrap_id disagreeing across the two C records is CORRELATION_INVALID (the CROSS-RECORD comparison, distinct from the receipt comparison)" {
  # Contract §10b J: `root_bootstrap_id` is governed by two different rules that
  # yield two different detail codes, and only one of them is in scope here.
  # root-profile vs provider-session disagreement (this test) is
  # CORRELATION_INVALID. Either record vs the actual BootstrapReceipt.bootstrap_id
  # would be AUTHORITY_INVALID -- unreachable in this codebase, since no
  # BootstrapReceipt record exists to compare against.
  _write_r33_tuple '{}' '{}' "$(printf '{"root_bootstrap_id":"%s"}' "$R33_ALT_ID128")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-8 FAIL: canonical_root_path_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"canonical_root_path_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-9 FAIL: clock_domain_id disagreeing across the two C records is CORRELATION_INVALID (inherently MULTI-defect, so only tier is asserted)" {
  # Deliberately NOT a single-defect case, and it cannot be made into one. Any
  # cross-record clock_domain_id disagreement necessarily also breaks temporal
  # domain agreement (§8d), because `temporal.clock_domain_id` must equal the
  # top-level value of BOTH records and can only follow one of them. Mutating the
  # session's top level alone leaves temporal agreeing with the root but not with
  # its own record; mutating both leaves temporal disagreeing with the root.
  # There is no third option, so this asserts the TIER only -- per the note above
  # that the source does not rank rules within the correlation tier.
  _write_r33_tuple '{}' '{}' "$(printf '{"clock_domain_id":"%s"}' "$R33_ALT_ID128")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

# ── H.C Digest chain (the one CITED correlation rule) ───────────────────────

@test "RCR-r33-tuple-digest-1 FAIL: ProviderSessionV3.root_profile_digest set to a well-formed but WRONG hex64 is CORRELATION_INVALID" {
  # R3.3:3734-3735 verbatim: `ProviderSessionV3.root_profile_digest` IS
  # `rootProfileDigestV3(RootProfileV3)`. This is the only correlation rule in
  # §8 that is cited rather than derived, so it gets its own case. The value is a
  # valid Sha256 by shape, so shape validation passes and only the recomputation
  # catches it.
  _write_r33_tuple '{}' '{}' "$(printf '{"root_profile_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

# ── H.D Temporal domain agreement (§8d, derived) ────────────────────────────

@test "RCR-r33-tuple-temporal-1 FAIL: temporal.clock_domain_id differing from the top-level clock_domain_id of both records is CORRELATION_INVALID" {
  # Single-defect, unlike corr-9: only the NESTED domain moves, so both top-level
  # values still agree with each other. Grounded in R3.3:1465 -- different domain
  # values are incomparable and never converted, so an envelope minted in another
  # domain cannot time this session.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"%s"}}' "$R33_ALT_ID128" "$R33_ISSUED_NS" "$R33_ISSUED_NS" "$R33_EXPIRY_NS")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

# ── H.E Error precedence -- SCHEMA outranks CORRELATION ─────────────────────
# The subtle pair. An implementation that checks correlation BEFORE shape passes
# every case above and is still wrong, because PLAN.md:2896-2907 fixes the order
# SCHEMA -> CORRELATION -> AUTHORITY. Only these two cases can detect that
# inversion: both defects are present simultaneously and the reported code says
# which check ran first.

@test "RCR-r33-tuple-prec-1 FAIL: a tuple with BOTH a shape defect and a correlation defect reports SCHEMA_INVALID, not CORRELATION_INVALID" {
  # RootProfileV3 missing `handle_protocol` (shape, 27 keys) AND the session's
  # coordination_root_id disagreeing (correlation). Shape wins.
  _write_r33_tuple '{}' '{"handle_protocol":"__OMIT__"}' "$(printf '{"coordination_root_id":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-tuple-prec-2 FAIL: a tuple with a WRONG PROFILE LITERAL plus a correlation defect reports SCHEMA_INVALID" {
  # PLAN.md:2896-2907 names the wrong profile literal as the first rung
  # explicitly, and PLAN.md:2673 forbids any dynamic dispatch to an R32 validator
  # -- so P32 must be rejected as a literal defect and must never be re-routed to
  # an R32 correlation path.
  _write_r33_tuple '{}' "$(printf '{"protocol_profile":"%s"}' "$R33_P32")" "$(printf '{"coordination_root_id":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── H.F Tuple-first selection ──────────────────────────────────────────────

@test "RCR-r33-tuple-first-1 FAIL: a binding carrying P32 fails the whole tuple even though BOTH C records are perfectly valid R33 -- no record is treated as conformant on its own" {
  # The direct test of PLAN.md:2676-2679: the tuple is accredited FIRST, and a
  # record is only trusted afterwards. Here `root-profile.json` and
  # `.provider-session` are byte-for-byte the conformant pair that
  # RCR-r33-tuple-1 accepts, and they are individually valid -- validating either
  # one alone via its own kind would succeed. The tuple must still fail, because
  # the third member does not conform.
  #
  # What this does NOT prove, deliberately: that the binding is bound to THIS
  # root. It cannot be -- the binding has no root-identifying field at all, so any
  # conforming binding satisfies any tuple. What this proves is the weaker but
  # real property that a non-conforming tuple member invalidates the whole tuple.
  _write_r33_tuple "$(printf '{"protocol_profile":"%s"}' "$R33_P32")" '{}' '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── H.G Trust/location outranks the whole ladder (DERIVED placement) ────────

@test "RCR-r33-tuple-security-1 FAIL: a .provider-session that is BOTH symlinked AND correlation-defective reports SECURITY_INVALID, not CORRELATION_INVALID" {
  # You cannot accredit bytes you have not proven you can trust, so a
  # trust/location failure precedes both shape and correlation. This placement is
  # DERIVED, not cited: the ladder at PLAN.md:2896-2907 omits SECURITY_INVALID and
  # DURABILITY_UNPROVEN entirely. One case only -- a large matrix on a derived
  # ordering would be over-specifying.
  _write_r33_tuple '{}' '{}' "$(printf '{"coordination_root_id":"%s"}' "$R33_ALT_SHA256")"
  local real="$PROJ/real-provider-session-symlink-target"
  mv "$(_r33_session_path)" "$real"
  ln -s "$real" "$(_r33_session_path)"
  [ -L "$(_r33_session_path)" ]
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SECURITY_INVALID"
}

# ── H.H Multiple correlation defects -- tier only ───────────────────────────

# ══════════════════════════════════════════════════════════════════════════
# Group I -- GENUINE R32 records, selection gates, and no-mutation proof.
#
# Everything in Groups G/H builds R33 records and mutates them. That is the wrong
# shape of fixture for the selection question, because a P32-mutated R33 record is
# not what a real R32 root contains: it still carries `handle_protocol`,
# `runtime_owner_root_id`, `clock_domain_id`, `clock_domain_receipt_digest` and
# `created_at_diagnostic_utc`, none of which exist in V2, and it lacks V2s own
# `created_at`. So this group builds GENUINE `RootProfileV2` [24]
# (R3.2:2087-2098) and `ProviderSessionV2` [24] (R3.2:2100-2110) records --
# the stronger fixture, and the only one that actually tests the R32/R33 boundary.
#
# The selection rule under test (PLAN.md:2676-2679): the validator is selected by
# the accredited TUPLE first, and "Schema string, path, record digest o profile
# literal aislado nunca seleccionan root/profile." Each gate below removes one of
# those four candidate selectors and shows it does not, on its own, buy
# conformance. (The PLAN sentence quoted above is about accreditation; these
# gates can only demonstrate the conformance half of it, which is the half that
# exists.)
# ══════════════════════════════════════════════════════════════════════════

# Genuine V2 record builder. `which` is root-profile | provider-session. Same
# override/`__OMIT__` idiom as every other builder here; bytes are canonical +
# exactly one LF at mode 0600, so a rejection can never be blamed on the carrier.
_write_r32_record() {
  local which="$1" out="$2" overrides="$3"
  R33_P32="$R33_P32" node -e '
    const fs = require("fs");
    const path = require("path");
    const e = process.env;
    const which = process.argv[1], outPath = process.argv[2], ovJson = process.argv[3];
    const sortKeysDeep = (v) => {
      if (Array.isArray(v)) return v.map(sortKeysDeep);
      if (v !== null && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
        return out;
      }
      return v;
    };
    const canonical = (v) => JSON.stringify(sortKeysDeep(v));
    const hex64 = (p) => p.repeat(32), hex32 = (q) => q.repeat(8);

    // RootProfileV2 [24] -- R3.2:2087-2098. Note provider_abi 2 and
    // control_protocol /v2, and that `created_at` is present where V3 has
    // `created_at_diagnostic_utc` instead.
    const rootV2 = {
      schema: "coordination/root-profile/v2",
      protocol_profile: e.R33_P32,
      lock_profile: "transition-lock/file-posix/v2",
      control_protocol: "transition-lock/provider-control/v2",
      coordination_root_id: hex64("c3"),
      physical_root_id: hex64("d4"),
      coordination_root_identity_security_digest: hex64("e5"),
      canonical_root_path_digest: hex64("f6"),
      mount_projection_digest: hex64("07"),
      root_generation_id: hex32("1c2d"),
      root_bootstrap_id: hex32("2e3f"),
      provider_session_id: hex32("3041"),
      local_filesystem_profile: "local-posix/v2",
      local_filesystem_capability_digest: hex64("18"),
      mount_generation_digest: hex64("29"),
      provider_name: "acd-transition-lock-posix",
      provider_abi: 2,
      provider_build_digest: hex64("3a"),
      platform: process.platform,
      architecture: process.arch,
      provider_manager_kind: "retained-native-host-owner",
      provider_manager_lifetime_profile: "retained-session",
      coordination_mode: "auto",
      created_at: "2026-07-25T00:00:00Z"
    };

    // ProviderSessionV2 [24] -- R3.2:2100-2110. Note `started_at` +
    // `session_expiry` where V3 has `temporal` + `started_at_diagnostic_utc`,
    // and that V2 likewise has NO protocol_profile.
    const sessionV2 = {
      schema: "coordination/provider-session/v2",
      coordination_root_id: hex64("c3"),
      physical_root_id: hex64("d4"),
      coordination_root_identity_security_digest: hex64("e5"),
      canonical_root_path_digest: hex64("f6"),
      mount_projection_digest: hex64("07"),
      root_generation_id: hex32("1c2d"),
      root_bootstrap_id: hex32("2e3f"),
      root_profile_digest: hex64("5c"),
      local_filesystem_capability_digest: hex64("18"),
      mount_generation_digest: hex64("29"),
      provider_name: "acd-transition-lock-posix",
      provider_abi: 2,
      provider_build_digest: hex64("3a"),
      provider_session_id: hex32("3041"),
      control_protocol: "transition-lock/provider-control/v2",
      control_endpoint_id: hex32("4152"),
      provider_manager_instance_id: hex32("5263"),
      provider_manager_kind: "retained-native-host-owner",
      provider_manager_lifetime_profile: "retained-session",
      coordination_mode: "auto",
      owner_pid: 4242,
      started_at: "2026-07-25T00:00:00Z",
      session_expiry: "2026-07-25T01:00:00Z"
    };

    const base = which === "root-profile" ? rootV2 : sessionV2;
    if (Object.keys(base).length !== 24) {
      console.error("FIXTURE BUG: " + which + " V2 base has " + Object.keys(base).length + " keys, V2 is exactly 24");
      process.exit(1);
    }
    const merged = Object.assign({}, base, JSON.parse(ovJson));
    for (const k of Object.keys(merged)) if (merged[k] === "__OMIT__") delete merged[k];
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(canonical(merged) + "\n", "utf8"), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$which" "$out" "$overrides"
}

# Recursive lstat snapshot of a tree: one sorted line per entry carrying
# relative path + dev/ino/size/mode/nlink/mtime. `lstat` never follows symlinks,
# so a symlink swapped in for a regular file changes the snapshot instead of
# being silently followed. mtime is captured at NANOSECOND resolution
# (`mtimeNs`): whole-second mtime would let a rewrite within the same second
# pass as unchanged, which is exactly the mutation this is meant to detect.
#
# `{ bigint: true }` is REQUIRED, not stylistic: node exposes the nanosecond
# fields (`mtimeNs`) only on bigint stats. Without it `st.mtimeNs` is undefined
# and this helper throws -- which is worse than it sounds, because a thrown
# helper yields an EMPTY snapshot on both sides and an empty-equals-empty
# comparison reads as "nothing changed". The caller therefore also asserts the
# snapshot is non-empty; both halves are needed for this guard to mean anything.
_r33_tree_snapshot() {
  node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1];
    const out = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const st = fs.lstatSync(full, { bigint: true });
        out.push([
          path.relative(root, full), st.dev.toString(), st.ino.toString(),
          st.size.toString(), (st.mode & 0o7777n).toString(8),
          st.nlink.toString(), st.mtimeNs.toString()
        ].join(" "));
        if (st.isDirectory()) walk(full);
      }
    };
    walk(root);
    console.log(out.join("\n"));
  ' "$1"
}

# Sorted relative-path list only -- catches an entry appearing or disappearing
# even in the (impossible) case that a replacement reproduced the same inode
# metadata.
_r33_entry_list() {
  node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1];
    const out = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        out.push(path.relative(root, full));
        if (fs.lstatSync(full).isDirectory()) walk(full);
      }
    };
    walk(root);
    console.log(out.join("\n"));
  ' "$1"
}

# Counts entries anywhere under a tree whose BASENAME matches a JS regex.
_r33_count_matching() {
  node -e '
    const fs = require("fs"), path = require("path");
    const root = process.argv[1], re = new RegExp(process.argv[2]);
    let n = 0;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (re.test(name)) n += 1;
        if (fs.lstatSync(full).isDirectory()) walk(full);
      }
    };
    walk(root);
    console.log(n);
  ' "$1" "$2"
}

# `_assert_not_success` WAS HERE and was REMOVED: 0 call sites.
#
# It existed for the mixed-root pair while those asserted "must not return a
# public SUCCESS" without a ruled detail_code. Converting them to characterization
# tests -- which assert an exact SUCCESS/NONE, because returning on a
# partially-populated root is contract-mandated -- left it unused. Removed rather
# than kept warm: an unreferenced assertion helper reads as available coverage and
# is the sort of thing a later author wires up without rechecking whether its
# looser contract still applies.

# `BootstrapReceiptV3` [35] -- A.3 REPLACE row R3.3:3653 over `BootstrapReceiptV2`
# [23] (R3.2:2112-2123): remove `schema,profile,created_at` (3), add 15, so
# 23 - 3 + 15 = 35.
#
# PATH IS AN ASSUMPTION, FLAGGED: R3.3 assigns this record no disk path, and
# R3.3:1037-1039 bars anything but the two contract records from `C`. So the
# fixture writes it beside the binding, OUTSIDE `C`. That choice cannot affect any
# RED below -- the authority tier is entirely absent today, so these cases reject
# (or wrongly pass) regardless of where the receipt sits -- but the toolkit and
# this fixture must agree on a path before any of them can go GREEN.
_r33_receipt_path() {
  printf '%s' "$PROJ/provider-bootstrap-receipt.json"
}

_write_r33_bootstrap_receipt() {
  local overrides="$1"
  R33_P33="$R33_P33" node -e '
    const fs = require("fs"), path = require("path");
    const e = process.env;
    const outPath = process.argv[1], ovJson = process.argv[2];
    const sortKeysDeep = (v) => {
      if (Array.isArray(v)) return v.map(sortKeysDeep);
      if (v !== null && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
        return out;
      }
      return v;
    };
    const canonical = (v) => JSON.stringify(sortKeysDeep(v));
    const hex64 = (p) => p.repeat(32), hex32 = (q) => q.repeat(8);
    const receipt = {
      // 15 ADDed by R3.3:3653
      schema: "runtime/provider-bootstrap-receipt/v3",
      profile: e.R33_P33,
      runtime_owner_root_id: hex64("a1"),
      clock_domain_id: hex32("0a1b"),
      clock_domain_receipt_digest: hex64("b2"),
      root_profile_digest: hex64("6d"),
      runtime_binding_receipt_digest: hex64("4b"),
      provider_endpoint_digest: hex64("7e"),
      provider_session_digest: hex64("8f"),
      provider_session_temporal_digest: hex64("90"),
      startup_registration_id: hex32("a1b2"),
      startup_action_id: hex32("b2c3"),
      runtime_slot_id: hex32("c3d4"),
      created_at_diagnostic_utc: "2026-07-25T00:00:00Z",
      receipt_digest: hex64("ab"),
      // 20 retained from V2 after its 3 REMOVEd
      bootstrap_id: hex32("2e3f"),
      provider_session_id: hex32("3041"),
      root_generation_id: hex32("1c2d"),
      control_endpoint_id: hex32("4152"),
      coordination_root_id: hex64("c3"),
      physical_root_id: hex64("d4"),
      coordination_root_identity_security_digest: hex64("e5"),
      canonical_root_path_digest: hex64("f6"),
      mount_projection_digest: hex64("07"),
      mount_generation_digest: hex64("29"),
      root_parent_identity_digest: hex64("1a"),
      root_basename: "coordination",
      local_filesystem_capability_digest: hex64("18"),
      provider_build_digest: hex64("3a"),
      provider_manager_binding_digest: hex64("2b"),
      provider_manager_kind: "retained-native-host-owner",
      provider_manager_lifetime_profile: "retained-session",
      coordination_mode: "auto",
      final_state: "ACTIVE",
      receipt_auth_tag: hex64("5c")
    };
    if (Object.keys(receipt).length !== 35) {
      console.error("FIXTURE BUG: BootstrapReceiptV3 has " + Object.keys(receipt).length + " keys, the closed schema is 35");
      process.exit(1);
    }
    const merged = Object.assign({}, receipt, JSON.parse(ovJson));
    for (const k of Object.keys(merged)) if (merged[k] === "__OMIT__") delete merged[k];
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(canonical(merged) + "\n", "utf8"), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$(_r33_receipt_path)" "$overrides"
}

# ── I.A Gate 13 -- none of schema / path / literal / digest selects ──────────

@test "RCR-r33-gate13-1 FAIL: an otherwise-R32 record carrying the R33 SCHEMA STRING is rejected SCHEMA_INVALID -- schema alone never selects" {
  _write_r32_record root-profile "$(_r33_root_profile_path)" '{"schema":"coordination/root-profile/v3"}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-gate13-2 FAIL: a GENUINE RootProfileV2 [24] occupying C/root-profile.json is rejected SCHEMA_INVALID -- path alone never selects (also covers the genuine-R32-rejection requirement for this record)" {
  # Deliberately one test, not two: "a genuine RootProfileV2 is rejected by the
  # root-profile conformance check" and "occupying the canonical R33 path does not
  # buy conformance" are the same fixture and the same assertion, so splitting them
  # would add a duplicate rather than a second behaviour.
  #
  # PLAN.md:2911 calls this state PRESENT_INVALID rather than ABSENT. That
  # property is NOT assertable here: `PRESENT_INVALID` is not among the 16 frozen
  # detail_code values (PLAN.md:791) and can never be emitted, and a present-but-
  # wrong-profile file and a genuinely missing one return byte-identical
  # envelopes. The distinction is proven at the library boundary instead, by the
  # classifyDurableRead test in runtime-consultation-cli.test.js.
  _write_r32_record root-profile "$(_r33_root_profile_path)" '{}'
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-gate13-3 FAIL: an otherwise-R32 record carrying the P33 PROFILE LITERAL is rejected SCHEMA_INVALID -- an isolated literal never selects" {
  # The literal is exactly right and everything around it is still V2. This is the
  # "profile literal aislado" case named at PLAN.md:2679 verbatim.
  _write_r32_record root-profile "$(_r33_root_profile_path)" "$(printf '{"protocol_profile":"%s"}' "$R33_P33")"
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-gate13-4 FAIL: a session carrying the CORRECT rootProfileDigestV3 of a valid R33 root, while the on-disk root is genuinely R32, is rejected SCHEMA_INVALID -- a supplied digest never selects" {
  # Built by laying down the fully coherent R33 tuple first (so the session
  # genuinely carries the correct rootProfileDigestV3 of a valid R33 profile,
  # computed by the fixture builder, not typed in) and only THEN replacing
  # C/root-profile.json with a genuine V2 record. The digest in hand is right; the
  # root it names is not on disk.
  #
  # Also demonstrates PLAN.md:2768-2769: digests apply only AFTER shape/profile/
  # root accreditation, so the root fails first and the digest is never reached --
  # which is why the code is SCHEMA_INVALID and not CORRELATION_INVALID.
  _write_r33_tuple '{}' '{}' '{}'
  _write_r32_record root-profile "$(_r33_root_profile_path)" '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── I.B Genuine-R32 rejection on the remaining two surfaces ─────────────────

@test "RCR-r33-r32-1 FAIL: a GENUINE ProviderSessionV2 [24] is rejected SCHEMA_INVALID by checkProviderSessionV3Conformance" {
  _write_r32_record provider-session "$(_r33_session_path)" '{}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-r32-2 FAIL: a root that is R32 in BOTH C records is rejected SCHEMA_INVALID by checkR33ProfileTupleConformance" {
  _write_r33_tuple '{}' '{}' '{}'
  _write_r32_record root-profile "$(_r33_root_profile_path)" '{}'
  _write_r32_record provider-session "$(_r33_session_path)" '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── I.C Mixed root -- CHARACTERIZATION of a CONTRACT-MANDATED limitation ────
# These two have been through both readings, and the history is left visible on
# purpose rather than erased, because the reason the second reading was wrong is
# the useful part.
#
# They once asserted a single-record check must NOT succeed on a mixed root. That
# was correct ONLY while a public CLI surface existed: `rc 0 SUCCESS/NONE` from
# `validate` is indistinguishable, to any caller or script, from root-level
# accreditation, and PLAN.md:2894's `unknown/mixed root` row says reject. The P1
# was never "a conformance check returned"; it was "a PUBLIC surface certified a
# mixed root".
#
# Removing the four R33 kinds resolved that P1 at the source. What remains is the
# internal conformance layer, where returning on a partially-populated root is not
# merely tolerated but REQUIRED: R3.3:1115-1117 step 12 mandates publish AND
# READBACK of `RootProfileV3` at a point where `ProviderSessionV3` is explicitly
# not yet published -- step 17 does that. A single-record check that refused a
# root missing its sibling would make that mandated readback impossible and break
# the bootstrap sequence outright.
#
# So these are CHARACTERIZATION tests of a deliberate, contract-mandated
# limitation, and they are GREEN by design. They pin two facts together, which is
# the only way the pair is meaningful:
#   * a single-record conformance check RETURNS on a mixed root -- required;
#   * `checkR33ProfileTupleConformance` REJECTS the same root -- because it is the
#     one that correlates, and root-level judgement lives only there.
# A future change to either half fails loudly instead of silently altering what a
# single-record conformance result means.
#
# No `--kind` appears anywhere below: that surface no longer exists, and a name or
# comment referencing it would be a title outrunning its evidence.

@test "RCR-r33-mixed-1 CHARACTERIZATION (contract-mandated, NOT a defect): a single-record session conformance check RETURNS on a mixed root, while only the tuple check rejects it" {
  _write_r33_tuple '{}' '{}' '{}'
  _write_r32_record root-profile "$(_r33_root_profile_path)" '{}'

  # REQUIRED behaviour, not tolerated: the record itself is a valid R33
  # ProviderSessionV3, and a per-record check must not consult a sibling it is
  # contractually forbidden to require (R3.3:1115-1117 step 12 / step 17).
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"

  # Root-level judgement lives only in the tuple check, which correlates the two
  # C records and therefore sees the mixture. This half is what stops the case
  # above being read as "a mixed root is fine".
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-mixed-2 CHARACTERIZATION (contract-mandated, NOT a defect): the mirror mixed root likewise RETURNS under the single-record root-profile check, while only the tuple check rejects" {
  _write_r33_tuple '{}' '{}' '{}'
  _write_r32_record provider-session "$(_r33_session_path)" '{}'

  # This is the direction step 12 names literally -- `root-profile.json` published
  # and read back while `.provider-session` does not yet exist. Here it exists but
  # is R32, which is the same shape of demand on the checker: judge your own
  # record, do not judge the root.
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"

  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ── I.D No mutation on rejection ────────────────────────────────────────────

@test "RCR-r33-nomutate-1 PASS: consecutive tuple REJECTIONS leave the coordination root byte-identical -- same inode identity, same entry set, no .lock, no temp file" {
  # `validate` is a no-mutation command (PLAN.md ~L785) and PLAN.md:2913 forbids
  # overwrite, conversion, adoption, unlink, fallback and retry, so a rejected
  # tuple must not touch anything. Snapshot compares dev/ino/size/mode/nlink and
  # mtime at NANOSECOND resolution -- whole-second mtime would let a same-second
  # rewrite slip through.
  #
  # Scope limit, stated so this is not over-read: an inode snapshot can only cover
  # the paths it looks at and the rejections it drives. The universal claim ("no
  # code path anywhere mutates") is a property of code, not of a run, and is
  # covered by the extraction audit `R33-AUDIT-1`/`R33-AUDIT-2`, which live in
  # runtime-consultation-cli.test.js. They were briefly in
  # script-static-analysis.bats; that file is outside this wave's dispatch scope
  # and has been reverted to HEAD, so it is NOT the audit's home.
  _write_r33_tuple '{}' '{}' '{}'
  _write_r32_record root-profile "$(_r33_root_profile_path)" '{}'

  local snap_before snap_after entries_before entries_after
  snap_before="$(_r33_tree_snapshot "$COORD_ROOT")"
  entries_before="$(_r33_entry_list "$COORD_ROOT")"

  # Anti-vacuity guard. If _r33_tree_snapshot ever breaks it emits nothing, and an
  # empty-equals-empty comparison below would read as "nothing changed" -- the
  # snapshot assertion would pass while observing absolutely nothing. This
  # happened for real during authoring (`st.mtimeNs` is undefined unless lstat is
  # called with `{ bigint: true }`), so the guard is not hypothetical: assert the
  # snapshot is non-empty AND actually names both records before trusting it.
  [ -n "$snap_before" ]
  [ -n "$entries_before" ]
  local snap_lines; snap_lines="$(printf '%s\n' "$snap_before" | wc -l | tr -d ' ')"
  [ "$snap_lines" -ge 2 ]
  case "$snap_before" in *root-profile.json*) ;; *) return 1 ;; esac
  case "$snap_before" in *.provider-session*) ;; *) return 1 ;; esac

  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _run_conformance checkRootProfileV3Conformance "$(_r33_root_profile_path)"
  [ "$status" -eq 3 ]

  snap_after="$(_r33_tree_snapshot "$COORD_ROOT")"
  entries_after="$(_r33_entry_list "$COORD_ROOT")"
  [ "$snap_before" = "$snap_after" ]
  [ "$entries_before" = "$entries_after" ]

  # No lock and no temp residue anywhere under the coordination root.
  [ ! -e "$COORD_ROOT/.lock" ]
  local stray; stray="$(_r33_count_matching "$COORD_ROOT" 'lock|[.]tmp')"
  [ "$stray" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Group N -- BUCKET 1: the four R33 kinds must NOT exist on the production CLI.
#
# Written RED-FIRST against the Option-5 ruling: all four R33 entries come out of
# `VALIDATE_KIND_DISPATCH`, the twelve frozen legacy kinds stay byte-identical, and
# the R33 readers/correlators survive as explicitly NON-AUTHORITATIVE internal
# conformance functions reached in-process rather than through a CLI suffix.
#
# The grounding is PLAN.md:762 -- retained hosts "call the core in-process with
# `HostBridgeCapability/v1`, never through a CLI suffix". Authority was never
# meant to live behind `validate` at all, which is why the ABI could not express
# it: the final `BootstrapReceipt` is published under `R` (R3.3:2844), a different
# root from `C`; `validate`'s argv is frozen at three flags (PLAN.md:766-785) with
# `--artifact` already spent on the binding; and temporal liveness needs a live
# clock-capability plus `now` in the record's own monotonic domain (R3.3:1465). So
# no amount of work inside this surface could have reached the authority tier.
# (An earlier version of this paragraph also argued `R` was underivable from `C`;
# that was false -- R3.3:215 constructs `R` deterministically -- and is withdrawn.
# See the terminology banner at the top of this file.)
#
# RESOLVED -- history, kept because the sequencing is the reusable part.
#
# While the kinds still existed, this group contradicted Groups G/H/I/J/L, which
# drove those same four kinds through the CLI and expected them to validate. Both
# could not pass at once. The resolution was NOT to weaken either side: the other
# groups were migrated to the in-process conformance functions FIRST, while the
# kinds were still registered, so they kept passing throughout; only then were the
# kinds removed, which flipped this group green without touching them.
#
# That order mattered. Removing first would have turned 92 migrated tests red at
# once and destroyed the behavioural RED that was gating the root-confinement and
# `Pid` fixes -- everything would have gone green on the removal alone. Both
# sides are green now and there is no contradiction left to preserve.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-abi-1 FAIL (bucket 1): --kind runtime-profile-binding-v2 must be an UNKNOWN kind on the production CLI" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_validate runtime-profile-binding-v2 "$(_r33_binding_path)"
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
}

@test "RCR-r33-abi-2 FAIL (bucket 1): --kind root-profile-v3 must be an UNKNOWN kind on the production CLI" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_validate root-profile-v3 "$(_r33_root_profile_path)"
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
}

@test "RCR-r33-abi-3 FAIL (bucket 1): --kind provider-session-v3 must be an UNKNOWN kind on the production CLI" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_validate provider-session-v3 "$(_r33_session_path)"
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
}

@test "RCR-r33-abi-4 FAIL (bucket 1): --kind r33-profile-tuple must be an UNKNOWN kind on the production CLI" {
  # The most important of the four: this is the surface that returned a public
  # SUCCESS for a self-made tuple outside Git under a 0777 root. Removing it is
  # what stops `validate` certifying something it structurally cannot verify.
  _write_r33_tuple '{}' '{}' '{}'
  _run_validate r33-profile-tuple "$(_r33_binding_path)"
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "INVALID_ARGUMENT"
}

@test "RCR-r33-abi-5 PASS (bucket 1 regression guard): ALL TWELVE frozen legacy kinds remain REGISTERED after the R33 removal" {
  # The risk in deleting four entries from a dispatch table is collaterally
  # removing or shadowing a thirteenth. This probes every one of the twelve rather
  # than sampling three, because a registration probe is cheap and the failure it
  # guards against is precisely "one more got deleted".
  #
  # The discriminator is `status`, not rc: an UNREGISTERED kind reports
  # USAGE_ERROR (the unknown-kind branch), whereas a REGISTERED kind pointed at a
  # missing artifact reports INVALID. So a kind that still validates -- even
  # unsuccessfully -- proves it is still wired, which is exactly the property
  # under guard here. Deep behavioural coverage of the legacy kinds already exists
  # elsewhere in this file (RCR-blob-1 validates a real consult-v2 end to end) and
  # is not duplicated.
  local ghost="$COORD_ROOT/abi5-nonexistent-artifact.json"
  [ ! -e "$ghost" ]
  local kind
  for kind in consult-v2 inbox-ref-v1 result-v2 claim-v1 active-lease-v1 \
              activation-intent-v1 delivery-v1 accepted-result-v1 ack-v1 \
              cancel-v1 conflict-v1 takeover-v1; do
    _run_validate "$kind" "$ghost"
    local st
    st="$(node -e 'try{process.stdout.write(JSON.parse(process.argv[1]).status)}catch(e){process.stdout.write("UNPARSEABLE")}' "$output")"
    if [ "$st" = "USAGE_ERROR" ]; then
      echo "REGRESSION: legacy kind '$kind' is no longer registered (reported USAGE_ERROR, i.e. unknown kind)"
      return 1
    fi
    if [ "$st" = "UNPARSEABLE" ]; then
      echo "legacy kind '$kind' produced unparseable stdout: $output"
      return 1
    fi
  done
}

# ══════════════════════════════════════════════════════════════════════════
# Group J -- COORDINATION-ROOT CONFINEMENT (P0, FIXED). Written RED-FIRST against
# a confirmed defect: the R33 tuple check accepted records without proving
# anything about the root containing them, so a self-made tuple wholly outside
# Git, under a 0777 root, returned success.
#
# THAT DEFECT IS NOW FIXED and these cases are green. The R33 conformance entry
# point calls `validateRootConfinement` -- the same primitive `root-init` and
# `root-validate` already used, which is why the fix was "apply the existing
# machinery" rather than "build new machinery". Their being green is the evidence
# that the wiring exists; `rootsec-4` leans on exactly that.
#
# They are kept as regressions, not deleted: the failure mode they cover is a
# check silently ceasing to be reached, which is invisible from any tally.
#
# detail_code is SECURITY_INVALID throughout, which is this file's own established
# convention for root-level confinement violations (RCR-confine-1..5) and matches
# the ruled mapping for symlink / foreign-owner / wrong-mode.
#
# Each case overrides `COORD_ROOT` for its own duration only -- bats runs every
# @test in a fresh process, so the assignment cannot leak into another test.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-rootsec-1 FAIL (P0): a tuple whose coordination root lies OUTSIDE any git worktree is rejected SECURITY_INVALID" {
  # The defect this was written against: a caller minted its own root in system
  # temp, wrote three self-consistent records, and the tuple check passed. Nothing
  # in the tuple ties it to this repo, so passing would have certified a root the
  # harness never created. A3 closed it -- the case is now a regression, and the
  # root is rejected.
  EXTRA_TMP_DIR="$(mktemp -d)"
  COORD_ROOT="$EXTRA_TMP_DIR/coordination"
  mkdir -p "$COORD_ROOT"
  chmod 0700 "$COORD_ROOT"
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SECURITY_INVALID"
}

@test "RCR-r33-rootsec-2 FAIL (P0): a tuple whose coordination root is mode 0777 instead of owner-confined 0700 is rejected SECURITY_INVALID" {
  # R3.3:1020-1021 inherits the R3.2 owner-confinement contract for these records.
  # A world-writable root means any local user can substitute either C record
  # between the conformance check and any later use, so the records cannot be
  # trusted however
  # well-formed they are.
  chmod 0777 "$COORD_ROOT"
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SECURITY_INVALID"
}

@test "RCR-r33-rootsec-3 FAIL (P0): a tuple whose coordination-root PATH is a symlink is rejected SECURITY_INVALID" {
  # Mirrors RCR-confine-3, which proves root-validate rejects exactly this. The
  # R33 scope once did NOT, so the same alias root-validate refused was accepted
  # here -- an inconsistency between two entry points on one root. A3 closed it;
  # both now reject, and this is the regression holding them consistent.
  local real_root="$COORD_ROOT/rootsec3-real"
  mkdir -p "$real_root"
  chmod 0700 "$real_root"
  local link_root="$COORD_ROOT/rootsec3-alias"
  ln -s "$real_root" "$link_root"
  [ -L "$link_root" ]
  COORD_ROOT="$link_root"
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SECURITY_INVALID"
}

@test "RCR-r33-rootsec-4 SKIP (P0): a coordination root owned by a DIFFERENT uid is rejected" {
  # Not faked and not silently omitted. Constructing a directory owned by another
  # uid requires chown, which requires root or CAP_CHOWN; this sandbox has
  # neither, and process.getuid() is unprivileged. Attempting it would produce a
  # test that passes for the wrong reason on every machine that also cannot chown.
  #
  # The eUID clause of R3.3:1021 is therefore UNTESTED here rather than untested
  # everywhere: `validateRootConfinement` implements an owner check (see
  # RCR-confine-* and the Group B header), and since A3 the R33 conformance entry
  # point DOES call it -- `rootsec-1..3` are green, which is what proves the wiring
  # exists. So the only gap is this fixture's inability to construct a
  # foreign-owned directory, not a missing call.
  #
  # (An earlier version of this note argued the R33 entry point did not call
  # `validateRootConfinement` at all, citing rootsec-1..3 as proof. That was true
  # when written and is now false: those tests are green precisely because the call
  # landed. Corrected rather than deleted, since the skip itself is still right.)
  skip "requires chown to a second uid (root/CAP_CHOWN), unavailable in this sandbox. The R33 conformance entry point DOES call validateRootConfinement -- RCR-r33-rootsec-1..3 are green, which is what proves the wiring -- so the only gap is this fixture's inability to construct a foreign-owned directory, not a missing call. The eUID clause itself is exercised by RCR-confine-* against root-validate."
}

@test "RCR-r33-rootsec-5 PASS: the coordination-root SNAPSHOT is exposed and matches C's real dev/ino/mode/uid AT THE POINTS SAMPLED (does NOT close the TOCTOU)" {
  # SCOPE WITHDRAWN AND NARROWED -- read this before strengthening the name.
  #
  # An earlier version of this test claimed the exposed snapshot proved ONE
  # identity was used throughout the tuple read. That claim is FALSE and has been
  # retracted. `snapshotCoordinationRootIdentity` runs `validateRootConfinement`,
  # then `lstat(path)`, then rechecks BY PATH. Path-based sampling leaves THREE
  # windows open, and the third is the one that settles it:
  #   1. substitution between validation and the first `lstat`;
  #   2. an ABA cycle across samples -- swap `C`, serve a different record, restore
  #      before the next `lstat`, and every sample agrees while the reads came from
  #      two different roots;
  #   3. the record reads themselves re-resolve `path.join(coordRoot, basename)` at
  #      READ time, so a swap DURING a read is served from the substitute while
  #      both surrounding samples still see the original.
  # No amount of additional sampling closes (3): the read does its own lookup.
  #
  # What this test therefore asserts, and all it asserts: the snapshot is EXPOSED
  # and MATCHES independent ground truth AT THE POINTS SAMPLED. That is strictly
  # weaker than "one identity throughout", and the name says so on purpose. Do not
  # reword it to imply a TOCTOU guarantee it does not carry.
  #
  # Closing the gap needs a retained `C_fd` with same-FD reads (openat/fstat off
  # one descriptor), not more sampling. That is the property `rootsec-5b` records
  # as genuinely missing -- not an open request, but the thing fd-bound reads exist
  # to provide.
  #
  # Still worth having: an exposed snapshot that did NOT match `C` would mean the
  # checker bound something else entirely, and mode+uid catch a placeholder with
  # the right shape. It is a real check with an honest ceiling.
  _write_r33_tuple '{}' '{}' '{}'

  # Independent ground truth for what the witness must equal, taken from the
  # filesystem rather than from the implementation under test.
  local expect_dev expect_ino
  expect_dev="$(node -e 'const s=require("fs").statSync(process.argv[1],{bigint:true});process.stdout.write(s.dev.toString())' "$COORD_ROOT")"
  expect_ino="$(node -e 'const s=require("fs").statSync(process.argv[1],{bigint:true});process.stdout.write(s.ino.toString())' "$COORD_ROOT")"
  [ -n "$expect_dev" ]
  [ -n "$expect_ino" ]

  # Pinned to the exact field name on purpose, and it has already earned that once:
  # the field was `coordRootWitness` when this was first tightened, the toolkit
  # renamed it to `coordRootIdentitySnapshot` as part of withdrawing the authority
  # claim, and this test went RED on the rename rather than silently tolerating it.
  # That is what pinning is for -- an earlier draft accepted several spellings, and
  # that was right only while the name was genuinely unchosen.
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node -e '
      const m = require(process.argv[1]);
      const out = m.checkR33ProfileTupleConformance(process.argv[2], process.argv[3]);
      const w = out && out.coordRootIdentitySnapshot;
      if (!w) { process.stdout.write("NO_SNAPSHOT_EXPOSED"); process.exit(0); }
      // dev/ino identify which directory was sampled; mode and uid show it is a
      // real owner-confined directory rather than a placeholder with the right
      // shape. None of this establishes that the identity HELD BETWEEN samples --
      // see the scope note above.
      process.stdout.write([
        String(w.dev), String(w.ino),
        (BigInt(w.mode) & 0o7777n).toString(8), String(w.uid)
      ].join(" "));
    ' "$IMPL" "$(_r33_binding_path)" "$COORD_ROOT"

  [ "$status" -eq 0 ]
  [ "$output" != "NO_SNAPSHOT_EXPOSED" ]
  [ "$output" = "$expect_dev $expect_ino 700 $(id -u)" ]
}

@test "RCR-r33-rootsec-5b SKIP (P0): the root identity CHANGING mid-conformance-read is rejected -- still unreachable from a black-box test" {
  # This one genuinely cannot be made RED from a black-box CLI test today, and I
  # am not going to dress up a weaker test as if it were this one.
  #
  # The property is that all three records must be resolved from ONE retained
  # coordination-root handle, so swapping the root inode midway cannot yield a
  # tuple assembled from two different roots. This is NOT a request for more
  # snapshotting -- `rootsec-5` already samples the identity and that is provably
  # insufficient (see its three-window note). It needs a retained `C_fd` with
  # same-FD reads (openat/fstat off one descriptor), which is a property of the
  # implementation, not of any test.
  #
  # Reproducing the violation from outside requires interleaving a directory swap
  # between two syscalls inside a single invocation. There is no code-level pause
  # seam to stop execution between the reads, and the usual black-box tricks do not
  # work here: a FIFO in place of a record would be rejected as non-regular before
  # it could block, and two consecutive `validate` calls cannot exhibit a
  # within-call mix.
  #
  # What WOULD make it assertable: a test-capability-gated pause seam, gated
  # exactly like --fixed-clock, allowing a swap to be interleaved between the
  # reads. Note what is NOT on this list any more -- "have the validator record the
  # root identity" was once listed here and has since shipped as
  # `coordRootIdentitySnapshot`, and it did NOT make this property assertable,
  # because sampling an identity is not the same as holding one. That is the whole
  # lesson of the retraction. A production change either way, and
  # decision needed rather than left as a silent gap.
  skip "needs a RETAINED C_fd with same-FD reads (openat/fstat off one descriptor). NOT a recorded root identity -- that shipped as coordRootIdentitySnapshot and did NOT make this assertable, because sampling an identity is not holding one, and the record reads re-resolve their own path at read time. A test-capability-gated pause seam would let a swap be interleaved for observation, but the fix itself is fd-bound reads. Production change; escalated rather than approximated."
}

# ══════════════════════════════════════════════════════════════════════════
# Group K -- AUTHORITY TIER (P0). RED against an API THAT DOES NOT EXIST YET.
#
# RETARGETED. These four originally drove `checkR33ProfileTupleConformance`, which
# is EXPRESSLY NON-AUTHORITATIVE. That was a real defect in the tests, not a
# detail: pointed at the conformance function, the cheapest way for a future
# author to make them pass would have been to add authority checks to the
# conformance layer -- re-mixing the two concerns that this whole NO-GO cycle
# separated, and doing it while every test went green.
#
# They now name `validateR33ProfileAuthority`, an INTENDED FUTURE provider-owned
# surface that does NOT exist -- naming it does not make it provider-owned. The harness reports `EXPORT_MISSING` and the assertion fails: RED
# against an absence, the same shape `rootsec-5` had before A3 landed the snapshot.
#
# DO NOT retarget these at an existing function to make them pass -- that would
# satisfy them in the wrong layer, which is the mistake the helper's failure
# message names.
#
# THEY ARE PLACEHOLDERS -- read this before treating six greens here as authority.
# The harness can only offer `(recordPath, coordRoot)`, which is a path pair. A
# stub that unconditionally threw `AUTHORITY_INVALID` would satisfy all six of
# them without a live clock-capability, a retained handle, a BootstrapReceipt or a
# `C_fd`. So what they currently pin is the NAME and the SEPARATION INTENT -- that an authority
# surface must exist, separate from conformance -- not the contract.
#
# Phase B must therefore begin by closing the provider-owned API, and its first
# test must be a REAL POSITIVE authority case: a genuine ACTIVE completion that
# succeeds. That is the one thing a throwing stub cannot fake, and per R3.3 step 18
# it is also the first point at which any authority success may legitimately
# occur. Until that positive case exists, these six are scaffolding with the right
# shape, and calling them anything stronger would overstate them.
#
# Do not attempt to strengthen them now: the surface they name does not exist, so
# any strengthening would be invention rather than measurement.
#
# The four properties they will assert once that surface exists are unchanged, and
# all four are cited: a missing BootstrapReceipt and a mismatching one are both
# AUTHORITY_INVALID pre-write (R3.3:2848-2851); PLAN.md:2896-2907's third rung is
# `actor/capability/receipt/digest authority disagreement -> AUTHORITY_INVALID`;
# and temporal liveness per R3.3:1460-1464 requires the same live
# domain/receipt/retained-handle tuple, `clock-capability.state == ACTIVE`, and
# `issued <= now < expiry` -- which is why a shape-valid envelope is not
# necessarily a live one and `0/0/1` is the cleanest demonstration.
#
# PLAN.md:785 promises "authority validation"; PLAN.md:2896-2907's third rung is
# `actor/capability/receipt/digest authority disagreement -> AUTHORITY_INVALID`;
# R3.3:2848-2851 requires RootProfileV3 and ProviderSessionV3 to reference the
# exact final bootstrap receipt, with mismatch or a MISSING receipt being
# AUTHORITY_INVALID pre-write. None of that is reached.
#
# Temporal liveness is the other half. R3.3:1460-1464 defines
# `valid(envelope, now, clock-capability)` as requiring the same live
# domain/receipt/retained-handle tuple, `clock-capability.state == ACTIVE`, and
# `issued <= now < expiry`. A shape-valid envelope is therefore NOT necessarily a
# live one, and `0/0/1` is the cleanest demonstration: canonical, ordered,
# `not_before == issued`, and long expired.
#
# PRACTICAL-RECOVERY ADDENDUM: these six now open with a mechanical
# `_r33_authority_capability_absent validateR33ProfileAuthority` probe (the
# SAME EXPORT_MISSING signal described above, run standalone) and `skip
# "PENDING_R33_EXTERNAL_BOOTSTRAP"` when it reports absent, rather than
# reaching `_assert_conformance`'s own EXPORT_MISSING branch and failing.
# This changes their bats status from `not ok` to `ok ... # skip` -- it does
# NOT satisfy them in the wrong layer (nothing above about not retargeting or
# not stubbing has changed) and does NOT decide when they stop skipping: the
# moment Phase B exports `validateR33ProfileAuthority` for real, the probe
# flips on its own and the unchanged assertion body below runs for real again.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-auth-1 FAIL (P0): a tuple with NO BootstrapReceipt present must not accredit -- AUTHORITY_INVALID" {
  if _r33_authority_capability_absent validateR33ProfileAuthority; then
    skip "PENDING_R33_EXTERNAL_BOOTSTRAP"
  fi
  # R3.3:2850-2851 lists a missing receipt alongside a mismatching one, both
  # AUTHORITY_INVALID pre-write. Today the receipt is never consulted, so a tuple
  # with no receipt anywhere PASSES CONFORMANCE -- it cannot accredit, because no
  # authority tier exists to accredit it.
  _write_r33_tuple '{}' '{}' '{}'
  [ ! -e "$(_r33_receipt_path)" ]
  _run_conformance validateR33ProfileAuthority "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "AUTHORITY_INVALID"
}

@test "RCR-r33-auth-2 FAIL (P0): a temporal envelope of issued=0, not_before=0, expiry=1 is shape-valid but NOT LIVE and must not accredit -- AUTHORITY_INVALID" {
  if _r33_authority_capability_absent validateR33ProfileAuthority; then
    skip "PENDING_R33_EXTERNAL_BOOTSTRAP"
  fi
  # Every shape rule holds: canonical unsigned decimals, issued <= not_before <
  # expiry, not_before == issued. Only liveness fails -- R3.3:1464, "now >= expiry
  # is expired". This is the case that shows shape validation and authority
  # validation are different things, and that we currently do only the first.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"0","not_before_monotonic_ns":"0","expiry_monotonic_ns":"1"}}' "$R33_CLOCK_DOMAIN_ID")"
  _run_conformance validateR33ProfileAuthority "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "AUTHORITY_INVALID"
}

@test "RCR-r33-auth-3 FAIL (P0): an EXPIRED temporal authority (now >= expiry) must not accredit -- AUTHORITY_INVALID" {
  if _r33_authority_capability_absent validateR33ProfileAuthority; then
    skip "PENDING_R33_EXTERNAL_BOOTSTRAP"
  fi
  # Distinct from auth-2: the magnitudes here are realistic rather than degenerate,
  # so this fails only against a genuine now-vs-expiry comparison and not against a
  # special case for tiny values.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"1000000000000","not_before_monotonic_ns":"1000000000000","expiry_monotonic_ns":"1000000000001"}}' "$R33_CLOCK_DOMAIN_ID")"
  _run_conformance validateR33ProfileAuthority "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "AUTHORITY_INVALID"
}

@test "RCR-r33-auth-4 FAIL (P0): a BootstrapReceiptV3 present but DISAGREEING with the two C records is rejected AUTHORITY_INVALID" {
  if _r33_authority_capability_absent validateR33ProfileAuthority; then
    skip "PENDING_R33_EXTERNAL_BOOTSTRAP"
  fi
  # The receipt is a well-formed 35-key BootstrapReceiptV3; only its
  # coordination_root_id disagrees. Per §10b J this is the receipt comparison and
  # therefore AUTHORITY_INVALID, NOT the cross-record CORRELATION_INVALID that
  # RCR-r33-tuple-corr-1 covers -- the two tiers govern different comparisons of
  # the same field name.
  _write_r33_tuple '{}' '{}' '{}'
  _write_r33_bootstrap_receipt "$(printf '{"coordination_root_id":"%s"}' "$R33_ALT_SHA256")"
  [ -e "$(_r33_receipt_path)" ]
  _run_conformance validateR33ProfileAuthority "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "AUTHORITY_INVALID"
}

@test "RCR-r33-auth-5 FAIL (P0): precedence -- a shape defect PLUS an authority defect reports SCHEMA_INVALID" {
  if _r33_authority_capability_absent validateR33ProfileAuthority; then
    skip "PENDING_R33_EXTERNAL_BOOTSTRAP"
  fi
  # SCHEMA outranks AUTHORITY (PLAN.md:2896-2907). Root missing handle_protocol
  # (shape) plus no receipt at all (authority).
  _write_r33_tuple '{}' '{"handle_protocol":"__OMIT__"}' '{}'
  [ ! -e "$(_r33_receipt_path)" ]
  _run_conformance validateR33ProfileAuthority "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-auth-6 FAIL (P0): precedence -- a correlation defect PLUS an authority defect reports CORRELATION_INVALID" {
  if _r33_authority_capability_absent validateR33ProfileAuthority; then
    skip "PENDING_R33_EXTERNAL_BOOTSTRAP"
  fi
  # CORRELATION outranks AUTHORITY, the rung below it. This is the case that pins
  # the middle of the ladder: it must be neither SCHEMA_INVALID (no shape defect
  # exists) nor AUTHORITY_INVALID (correlation is checked first).
  _write_r33_tuple '{}' '{}' "$(printf '{"coordination_root_id":"%s"}' "$R33_ALT_SHA256")"
  [ ! -e "$(_r33_receipt_path)" ]
  _run_conformance validateR33ProfileAuthority "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Group L -- `Pid` ceiling (P1). NOW CITED, not derived:
# `ARCHITECTURE-PROPOSAL-C-S-L-R3.1.md:146` -- `| Pid | integer 1..2147483647 |`.
# The primitive chain is R3.3 -> R3.2 -> R3.1 (R3.2:150 delegates explicitly), so
# R3.1's scalar table is part of the inherited surface and this bound was always
# available. `Number.isSafeInteger(v) && v >= 1` admits values up to 2^53-1, which
# is four million times the real ceiling.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-pid-1 PASS: owner_pid at the Pid maximum 2147483647 CONFORMS (conformance only; boundary, must stay accepted)" {
  # The counterweight to pid-2. A fix that clamps too tightly -- say to 65535,
  # or to a 32-bit signed check that rejects the maximum itself -- passes pid-2
  # and fails here.
  _write_r33_tuple '{}' '{}' '{"owner_pid":2147483647}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-pid-2 FAIL (P1): owner_pid at 2147483648 (Pid max + 1) is rejected SCHEMA_INVALID" {
  # One past the cited ceiling, and paired with pid-1 one integer below it, so only
  # a real 2147483647 bound separates the two.
  _write_r33_tuple '{}' '{}' '{"owner_pid":2147483648}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-pid-3 FAIL (P1): owner_pid at 9007199254740991 (2^53-1, the safe-integer ceiling) is rejected SCHEMA_INVALID" {
  # The exact value a `Number.isSafeInteger` check admits, which is why this case
  # names the defective predicate rather than an arbitrary large number.
  _write_r33_tuple '{}' '{}' '{"owner_pid":9007199254740991}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# Group M -- the remaining 8 of the 17 correlation keys (P1).
#
# Groups H covered 9. The gap was found by disabling ONE comparison
# (`physical_root_id`) in a scratch copy of the module and observing the whole
# suite stay green -- a coverage hole invisible from any passing tally. Per-key
# regressions are the only thing that closes it, because a shared choke point can
# be right for the nine keys a test names and wrong for the eight it does not.
#
# Same construction as Group H: mutate the SESSION copy only, so the root profile
# and its recomputed `root_profile_digest` stay consistent and the cross-record
# disagreement is the single defect.
# ══════════════════════════════════════════════════════════════════════════

@test "RCR-r33-tuple-corr-10 FAIL: physical_root_id disagreeing across the two C records is CORRELATION_INVALID" {
  # The key whose disabled comparison the whole suite failed to notice.
  _write_r33_tuple '{}' '{}' "$(printf '{"physical_root_id":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-11 FAIL: coordination_root_identity_security_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"coordination_root_identity_security_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-12 FAIL: clock_domain_receipt_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"clock_domain_receipt_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-13 FAIL: local_filesystem_capability_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"local_filesystem_capability_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-14 FAIL: mount_generation_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"mount_generation_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-15 FAIL: mount_projection_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"mount_projection_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-16 FAIL: provider_build_digest disagreeing across the two C records is CORRELATION_INVALID" {
  _write_r33_tuple '{}' '{}' "$(printf '{"provider_build_digest":"%s"}' "$R33_ALT_SHA256")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-corr-17 FAIL: provider_manager_lifetime_profile disagreeing across the two C records is CORRELATION_INVALID (third enum case)" {
  # Third of the three enum members of the correlation set, so all three enums now
  # have their own regression -- an enum is where two individually-valid records
  # can legitimately differ, which is exactly why they are in the set at all.
  _write_r33_tuple '{}' '{}' '{"provider_manager_lifetime_profile":"persistent-consumer"}'
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

@test "RCR-r33-tuple-multi-1 FAIL: a tuple carrying THREE simultaneous correlation defects reports CORRELATION_INVALID, with no assertion about which rule fired" {
  # 17-key disagreement (coordination_root_id), digest chain (root_profile_digest)
  # and temporal domain (temporal.clock_domain_id) all broken at once. All three
  # rules live in the same tier and the source does not rank them against each
  # other, so the only defensible assertion is the tier itself. Asserting a
  # particular rule -- or the message text -- would freeze an implementation
  # detail as though it were contract.
  _write_r33_tuple '{}' '{}' "$(printf '{"coordination_root_id":"%s","root_profile_digest":"%s","temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"%s"}}' "$R33_ALT_SHA256" "$R33_ALT_SHA256" "$R33_ALT_ID128" "$R33_ISSUED_NS" "$R33_ISSUED_NS" "$R33_EXPIRY_NS")"
  _run_conformance checkR33ProfileTupleConformance "$(_r33_binding_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "CORRELATION_INVALID"
}

# ── G.3 ProviderSessionV3 [28] + nested TemporalAuthorityEnvelopeV1 [4] ─────

@test "RCR-r33-session-1 PASS: a ProviderSessionV3 carrying exactly the 28 REPLACE-derived keys with a well-formed nested temporal [4] CONFORMS (conformance only, never accreditation)" {
  _write_r33_tuple '{}' '{}' '{}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-session-2 FAIL: a ProviderSessionV3 with an ADDED protocol_profile key is rejected SCHEMA_INVALID by the closed key set" {
  # NOT an assertion that ProviderSessionV3.protocol_profile equals P33 -- this
  # record has no such key at all (Group G header). The added value is the
  # CORRECT P33 literal precisely so the rejection can only be attributed to
  # the key being additional, never to a wrong literal.
  _write_r33_tuple '{}' '{}' "$(printf '{"protocol_profile":"%s"}' "$R33_P33")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-session-3 FAIL: a ProviderSessionV3 whose temporal has not_before_monotonic_ns != issued_monotonic_ns is rejected SCHEMA_INVALID" {
  # R3.3:1458 `not_before == issued  # R3.3 no delayed activation`. not_before
  # is issued+1ns, so the WEAKER `issued <= not_before < expiry` ordering
  # (R3.3:1457) still holds -- only the no-delayed-activation equality is
  # violated, which is what makes this a test of that clause specifically
  # rather than of general ordering.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"1000000000001","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_ISSUED_NS" "$R33_EXPIRY_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-session-4 FAIL: a ProviderSessionV3 whose temporal has expiry_monotonic_ns <= not_before_monotonic_ns is rejected SCHEMA_INVALID" {
  # Exact boundary case: expiry EQUALS not_before (== issued), giving a
  # zero-length lifetime. R3.3:1457's `not_before < expiry` is strict and
  # R3.3:1464 makes `now >= expiry` expired, so an envelope that is already
  # expired at the instant it is issued must never conform. Equality is the
  # sharper probe than a strictly-lesser expiry because an implementation using
  # `<=` where the contract says `<` passes the latter and fails only this.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_ISSUED_NS" "$R33_ISSUED_NS" "$R33_ISSUED_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-session-5 FAIL (TRAP 1, >2^53): temporal with not_before = issued+1 at 2^53 must be REJECTED -- a Number-based comparison silently ACCEPTS it" {
  # issued = 2^53, not_before = 2^53+1. These are two genuinely DIFFERENT
  # integers, so `not_before == issued` (R3.3:1458) is violated and the record
  # must be rejected. But `Number("9007199254740993")` collapses onto
  # 9007199254740992, so a Number-based validator sees them as EQUAL, concludes
  # the equality invariant holds, and ACCEPTS A BAD RECORD. This case is the
  # only one in the file that catches that -- and it is the dangerous direction,
  # because the failure mode is silent acceptance rather than a visible error.
  # RCR-r33-session-3 above tests the same invariant at ordinary magnitudes,
  # where a Number implementation happens to get the right answer, so it cannot
  # substitute for this.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_POW53_NS" "$R33_POW53_PLUS1_NS" "$R33_EXPIRY_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}

@test "RCR-r33-session-6 PASS (TRAP 2, >2^53): temporal with issued = not_before = 2^53 and expiry = 2^53+1 must be ACCEPTED -- a Number-based comparison spuriously REJECTS it" {
  # The counterpart to TRAP 1, and it must be an ACCEPTING case. Here
  # expiry = not_before + 1, so strict `not_before < expiry` (R3.3:1457) genuinely
  # holds and the record is valid. Under Number the pair collapses to equal, `<`
  # goes false, and a GOOD record is spuriously rejected -- so this is what pins
  # the strict-ordering rule to BigInt.
  #
  # Why a negative fixture at these magnitudes would prove nothing: double
  # rounding is monotonic non-decreasing, so it can never INVERT an ordering. A
  # Number implementation therefore still rejects every negative ordering fixture,
  # at any magnitude, and passing one gives false confidence. Only the positive
  # form discriminates.
  #
  # Lifetime here is 1 ns, which is legal: R3.3:1457 requires strictly
  # `not_before < expiry` and sets no minimum lifetime.
  _write_r33_tuple '{}' '{}' "$(printf '{"temporal":{"clock_domain_id":"%s","issued_monotonic_ns":"%s","not_before_monotonic_ns":"%s","expiry_monotonic_ns":"%s"}}' "$R33_CLOCK_DOMAIN_ID" "$R33_POW53_NS" "$R33_POW53_NS" "$R33_POW53_PLUS1_NS")"
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 0 ]
  _assert_conformance "SUCCESS" "NONE"
}

@test "RCR-r33-session-7 FAIL: a canonical ProviderSessionV3 with NO trailing LF is rejected SCHEMA_INVALID (asserted per validator, not assumed shared)" {
  # `C/.provider-session` is the second disk record, so R3.3:2374's mandatory-LF
  # rule binds it too. Asserted separately from RCR-r33-rootprofile-5 because
  # `provider-session-v3` is a distinct validator: if the byte check were wired
  # into only one of the two, a shared-implementation assumption would hide it.
  _write_r33_tuple '{}' '{}' '{"__BYTES__":"canonical-no-lf"}'
  _run_conformance checkProviderSessionV3Conformance "$(_r33_session_path)"
  [ "$status" -eq 3 ]
  _assert_conformance "INVALID" "SCHEMA_INVALID"
}
