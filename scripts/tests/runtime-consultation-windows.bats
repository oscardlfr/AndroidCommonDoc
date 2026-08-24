#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# WP2 macOS STRUCTURAL parity leg for the SH/PS1 runtime-consultation wrappers,
# Wave 1 (portable-runtime-messaging-adapters). Grounded in PLAN.md's "PS1 / SC-17
# (Option 2)" section (~L1555-1567), the Windows W01-W12 crosswalk (~L1490-1508),
# and the Frozen Production CLI ABI wrapper note ("Both wrappers are byte-for-byte
# argv forwarders to `node scripts/lib/runtime-consultation.cjs`", ~L750-755).
#
# SCOPE (single-owner, this task's dispatch): on THIS macOS host, WITHOUT a live
# pwsh, this file proves:
#   (a) scripts/sh/runtime-consultation.sh exists and is a thin argv->node
#       forwarder with zero embedded protocol/schema/security logic;
#   (b) scripts/ps1/runtime-consultation.ps1 is at minimum STRUCTURALLY the same
#       shape (file exists, references the node core, no embedded schema logic)
#       -- a static text check that needs no pwsh interpreter;
#   (c) W01 (paths-with-spaces), W03 (exactly one JSON object + trailing LF on
#       stdout), and W04 (stderr never a bare JSON object) hold when driven
#       THROUGH the .sh wrapper instead of `node` directly;
#   (d) W08 (Node/SH/PS1 equivalence): the same fixture invocation run via
#       `node` directly and via the `.sh` wrapper, both under the CLI's
#       `--fixed-ids --fixed-clock` test-capability mode, produce BYTE-IDENTICAL
#       `coordination/cli-result/v1` stdout -- proving the wrapper is a pure
#       forwarder, never a raw byte-diff of live-generated random output.
#
# This file deliberately never invokes `pwsh` (absent on this host), so it is
# NOT and can never BE Windows conformance evidence. The real W01-W12 EXECUTABLE
# leg is `scripts/tests/runtime-consultation-windows.ps1` (a separate file, not
# owned by this dispatch), run by the `windows-latest` CI job wired through
# `.github/workflows/runtime-consultation-windows.yml` (PLAN.md ~L1555-1567).
# SC-17 = PENDING_CI and closes ONLY when that job passes at final PR HEAD --
# this file's own green/red status never substitutes for it.
#
# STATUS (current, exact -- verify with `bats --count` rather than trusting
# this comment): both scripts/sh/runtime-consultation.sh and scripts/ps1/
# runtime-consultation.ps1 are now implemented; this file's original RED-by-
# design status (neither wrapper existed yet) is history, not current state --
# see git log, not this comment, for when they landed. 9 of this file's cases
# remain `skip`'d (not RED) -- 3 deferred beyond this dispatch's own scope, 6
# requiring windows-latest CI (SC-17, PENDING_CI, unaffected by this file's own
# green status per the SCOPE note above).
#
# W0x -> @test crosswalk (PLAN.md ~L1490-1508). The PLAN's own Test column says
# "same" for W02/W05/W06, meaning this bats file is a nominal co-owner alongside
# the .ps1 Windows leg -- but THIS dispatch's own "what to cover" narrows actual
# scope to W01/W03/W04/W08 now. W02/W05/W06 are therefore explicit, NOT-pwsh-
# blocked deferrals (a future task can add them directly against the .sh wrapper
# with no Windows host needed) -- distinct from W07/W09-W12, which genuinely
# require a live pwsh and are Windows-CI-only:
#   W01  implemented (via .sh)             W02  skip (deferred, not pwsh-blocked)
#   W03  implemented (via .sh)             W04  implemented (via .sh)
#   W05  skip (deferred, not pwsh-blocked) W06  skip (deferred, not pwsh-blocked)
#   W07  skip (pwsh-only)                  W08  implemented (node vs .sh equivalence)
#   W09  skip (pwsh-only)                  W10a skip (pwsh-only)
#   W10b skip (pwsh-only)                  W11  skip (pwsh-only)
#   W12  skip (pwsh-only)
#
# UPDATE (this cycle): the "known upstream gap" this section originally
# documented is RESOLVED. `--fixed-ids`/`--fixed-clock` are now genuinely wired
# in scripts/lib/runtime-consultation.cjs: under `--fixed-ids`, `genId()`
# returns a deterministic per-process zero-padded 32-char hex counter
# (confirmed empirically -- the first schema-visible mint, `request_id`, is
# exactly `'0'.repeat(32)`; `publishNoClobber`'s own internal temp-file-name
# nonces pass `{raw: true}`, which always draws real crypto randomness and
# never consumes a counter slot); under `--fixed-clock`, `nowIso()`/
# `currentClockMs()` return the frozen base `2025-01-01T00:00:00.000Z`
# (overridable via RUNTIME_CONSULTATION_FAKE_CLOCK), never real wall-clock
# time. W08 below has therefore been broadened from `root-init` (which never
# calls genId()/nowIso() at all -- zero real determinism coverage, as this
# note previously flagged) to `publish-request`, a genuinely request-scoped
# verb that exercises both. This is safe against the no-clobber primitive:
# `cmdPublishRequest`'s own `materializePlanRef`/`materializeRoutingPolicy`/
# `materializeSubjectBundle`/final-request-write calls all pass
# `{allowIdenticalIdempotent: true}` to `publishNoClobber`, so two invocations
# sharing the identical plan-root, intent, and frozen ids/clock produce
# byte-identical request content -- the SECOND invocation (via the .sh
# wrapper) republishes idempotently rather than losing a no-clobber race. That
# is exactly the property W08 needs: two independent entrypoints, identical
# fixed inputs, byte-identical output.
#
# Invocation: bats scripts/tests/runtime-consultation-windows.bats (from repo
# root), or scripts/sh/run-bats.sh --project-root "$(pwd)"
# scripts/tests/runtime-consultation-windows.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
RLL_IMPL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
SH_WRAPPER="$BATS_TEST_DIRNAME/../sh/runtime-consultation.sh"
PS1_WRAPPER="$BATS_TEST_DIRNAME/../ps1/runtime-consultation.ps1"
# "Harness-created" test capability (PLAN.md ~L752-753, ~L796) -- same idiom as
# runtime-consultation-cli.bats's own TEST_CAPABILITY constant, distinct value
# so suite-of-origin is obvious in any shared log output.
TEST_CAPABILITY="bats-runtime-consultation-windows-fixture-capability"

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
  # WP3 root-confinement (RCR-confine-*, runtime-consultation-roots.bats) requires
  # `--coordination-root` to resolve inside a real git worktree -- mirrors
  # runtime-consultation-roots.bats's own setup() so this file's root-init/
  # root-validate fixtures reflect realistic usage, not an artifact of never
  # having exercised the confinement check before it existed.
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  # Captured immediately after git init, while .git is known-good -- never
  # recomputed later from a $PROJ some later test step may have corrupted.
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL_IMPL" "$PROJ")"
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
  chmod -R u+rwx "$PROJ" 2>/dev/null || true
  rm -rf "$PROJ"
}

# ── CLI invocation helpers (same idiom as runtime-consultation-cli.bats) ────

_run_node() {
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" "$@"
}

_run_sh() {
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TEST_CAPABILITY" \
    bash "$SH_WRAPPER" "$@"
}

# M6+M7 requester-authority closure (Group G fix, team-lead-authorized
# 2026-08-11): root-init/root-validate are REQUESTER_GATED under
# role-command-grant/v1, but _run_sh calls the real .sh wrapper directly with
# zero grant-injection mechanism -- W01/W03 need their own one-shot grant
# minted and appended as --requester-binding, the SAME mint-then-append
# precedent W08's own _w08_mint_publish_request_grant already establishes in
# this file, simplified here since neither W01 nor W03 uses --fixed-clock (no
# frozen-timestamp rewrite needed -- real wall-clock binding/grant timestamps
# are fine under real wall-clock test execution). requestId/attemptId/
# leaseEpoch are null,null,null -- root-init/root-validate are pre-request
# administrative subcommands (REQUESTER_GRANT_NULL_SCOPE_SUBCOMMANDS), never
# transactional.
_mint_root_admin_grant() {
  local subcommand="$1"
  shift
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const subcommand = process.argv[4];
    const rest = process.argv.slice(5);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered: " + JSON.stringify(planResult)); process.exit(1); }
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor, mirroring
    // runtime-consultation-grant-wrapper.cjs own RCC_GRANT_PROVIDER default --
    // this helper own subject (W01/W03 argv/paths-with-spaces + stdout shape)
    // is provider-agnostic, never CLAUDE-ID-01-adjacent. No apostrophes in
    // this comment block -- it lives inside a bash single-quoted node -e
    // block (no escape mechanism), mirroring this file own established
    // convention elsewhere.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "w01w03-root-admin-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "w01w03-root-admin-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", subcommand, argvDigest, null, null, null);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$IMPL" "$PROJ" "$subcommand" "$@"
}

# Materializes a minimal discoverable PLAN.md under $PROJ -- required by
# _mint_root_admin_grant own rll.discoverPlan call, mirroring W08's own
# wave_dir/plan_file fixture pattern. Idempotent-safe to call more than once
# per test (mkdir -p + overwrite).
_write_root_admin_plan_fixture() {
  local wave_dir="$PROJ/.planning/wave-w01w03-root-admin-wave"
  mkdir -p "$wave_dir"
  printf '# Fixture PLAN for runtime-consultation-windows.bats W01/W03\n' > "$wave_dir/PLAN.md"
}

# Parses $output (most recent `run`) as the frozen coordination/cli-result/v1
# envelope (PLAN.md ~L779-781) -- verbatim copy of runtime-consultation-cli.bats's
# own _assert_cli_result, reused here for consistency across the two suites.
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

# Asserts $output is exactly one JSON object plus a trailing newline -- no
# prose/second line/BOM (Frozen CLI ABI, PLAN.md ~L779; W03). Verbatim copy of
# runtime-consultation-cli.bats's own helper.
_assert_stdout_single_json_line() {
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
  local first_bytes; first_bytes="$(printf '%s' "$output" | head -c3 | od -An -tx1 | tr -d ' \n')"
  [ "$first_bytes" != "efbbbf" ]
}

# Asserts $stderr (most recent `run --separate-stderr`) never carries a bare
# JSON object (PLAN.md ~L779; W04). Verbatim copy of runtime-consultation-cli.bats's
# own helper.
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
# Wrapper presence + shape -- prerequisite for every W0x case below
# ══════════════════════════════════════════════════════════════════════════

@test "STRUCTURE-01 scripts/sh/runtime-consultation.sh exists as a regular file" {
  [ -f "$SH_WRAPPER" ]
}

@test "STRUCTURE-02 scripts/sh/runtime-consultation.sh is a thin argv->node forwarder with zero embedded protocol/schema logic" {
  [ -f "$SH_WRAPPER" ]

  run grep -Fq 'runtime-consultation.cjs' "$SH_WRAPPER"
  [ "$status" -eq 0 ]
  # "$@" is the standard/expected forwarding idiom, not the ONLY valid one --
  # a false RED here (once the wrapper lands) would be a reasonable heuristic
  # miss, not a contract violation; the behavioral W01/W08 cases below are the
  # authoritative forwarding proof.
  run grep -Fq '"$@"' "$SH_WRAPPER"
  [ "$status" -eq 0 ]

  # A thin forwarder never needs to know these frozen record/envelope schema
  # literals itself (Frozen CLI ABI wrapper note, PLAN.md ~L750: "zero
  # protocol/state logic in either wrapper").
  run grep -Fq 'coordination/consult/v2' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/result/v2' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/cli-result/v1' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/activation/v1' "$SH_WRAPPER"
  [ "$status" -ne 0 ]
}

@test "STRUCTURE-03 scripts/ps1/runtime-consultation.ps1 exists as a regular file (structural only, no pwsh)" {
  [ -f "$PS1_WRAPPER" ]
}

@test "STRUCTURE-04 scripts/ps1/runtime-consultation.ps1 references the node core with zero embedded protocol/schema logic (static text check, no pwsh)" {
  [ -f "$PS1_WRAPPER" ]

  run grep -Fq 'runtime-consultation.cjs' "$PS1_WRAPPER"
  [ "$status" -eq 0 ]

  run grep -Fq 'coordination/consult/v2' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/result/v2' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/cli-result/v1' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
  run grep -Fq 'coordination/activation/v1' "$PS1_WRAPPER"
  [ "$status" -ne 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# W01 argv & paths-with-spaces (PLAN.md ~L1496) -- via the .sh wrapper
# ══════════════════════════════════════════════════════════════════════════

@test "W01 sh wrapper: root-init then root-validate succeed against a --coordination-root path containing spaces" {
  _write_root_admin_plan_fixture
  local root_with_spaces="$PROJ/coordination root with spaces"

  local root_init_grant; root_init_grant="$(_mint_root_admin_grant root-init --coordination-root "$root_with_spaces")"
  _run_sh root-init --coordination-root "$root_with_spaces" --requester-binding "$root_init_grant"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json

  [ -d "$root_with_spaces" ]

  local root_validate_grant; root_validate_grant="$(_mint_root_admin_grant root-validate --coordination-root "$root_with_spaces")"
  _run_sh root-validate --coordination-root "$root_with_spaces" --requester-binding "$root_validate_grant"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "W02 sh wrapper: UTF-8 + JSON-quote/backslash question round-trips byte-exact through base64url --intent" {
  skip "deferred beyond this dispatch's explicit W01/W03/W04/W08 scope (PLAN.md ~L1490-1508 crosswalk) -- NOT pwsh-blocked, exercisable directly against scripts/sh/runtime-consultation.sh once authorized"
}

# ══════════════════════════════════════════════════════════════════════════
# W03 exactly one JSON object + trailing LF on stdout (PLAN.md ~L1498) -- .sh
# ══════════════════════════════════════════════════════════════════════════

@test "W03 sh wrapper: root-init prints exactly one JSON object plus one trailing LF on stdout, no prose/second-line/BOM" {
  _write_root_admin_plan_fixture
  local fresh_root="$PROJ/coordination-w03"

  local root_init_grant; root_init_grant="$(_mint_root_admin_grant root-init --coordination-root "$fresh_root")"
  _run_sh root-init --coordination-root "$fresh_root" --requester-binding "$root_init_grant"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

# ══════════════════════════════════════════════════════════════════════════
# W04 diagnostics only on stderr -- never a bare JSON object (PLAN.md ~L1499)
# ══════════════════════════════════════════════════════════════════════════

@test "W04 sh wrapper: an error path (unknown subcommand) never emits a bare JSON object on stderr" {
  _run_sh totally-not-a-real-subcommand-xyz
  [ "$status" -eq 2 ]
  _assert_cli_result "USAGE_ERROR" "UNKNOWN_COMMAND"
  _assert_stdout_single_json_line
  _assert_stderr_no_json
}

@test "W05 sh wrapper: an unknown subcommand yields a nonzero exit code" {
  skip "deferred beyond this dispatch's explicit W01/W03/W04/W08 scope (PLAN.md ~L1490-1508 crosswalk) -- NOT pwsh-blocked, exercisable directly against scripts/sh/runtime-consultation.sh once authorized"
}

@test "W06 sh wrapper: success/validation-error/timeout/unknown-subcommand exit codes are pairwise distinct" {
  skip "deferred beyond this dispatch's explicit W01/W03/W04/W08 scope (PLAN.md ~L1490-1508 crosswalk) -- NOT pwsh-blocked, exercisable directly against scripts/sh/runtime-consultation.sh once authorized"
}

@test "W07 ps1 wrapper: same-worktree E2E round trip (+ W07b deterministic app-server/mcp rendezvous)" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- live pwsh E2E publish->claim->result->accept round trip plus deterministic backend rendezvous, not reproducible on this macOS host"
}

# ══════════════════════════════════════════════════════════════════════════
# W08 Node/SH equivalence (PLAN.md ~L1503) -- broadened this cycle from
# `root-init` to `publish-request`, a genuinely request-scoped verb that
# exercises both genId() and nowIso() (root-init calls neither -- zero real
# determinism coverage, see this file's header "UPDATE" note). --fixed-ids
# --fixed-clock make the invocation deterministic BY CONSTRUCTION, so a raw
# byte-diff of stdout across entrypoints is meaningful (no normalization
# fallback needed).
# ══════════════════════════════════════════════════════════════════════════

# M7 completeness (2026-08-09): publish-request is now REQUESTER_GATED under
# role-command-grant/v1 (PLAN.md §15b) -- each entrypoint call below needs its
# OWN freshly-minted, one-shot grant (the grant pipeline consumes
# it) whose canonical_argv_digest matches the exact `rest` argv passed to that
# specific call. Mints via the SAME production primitives
# runtime-consultation-grant-wrapper.cjs's own tryMintGrant uses
# (rll.createRequesterBinding + rll.mintRoleCommandGrant), including its
# --fixed-clock backdating step (both this file's own frozen base and the
# wrapper's rewriteRecordTimestampsToFrozenClock agree on
# 2025-01-01T00:00:00.000Z) -- minting always stamps real wall-clock
# created_at, which the real CLI, evaluating it against a base frozen to the
# past, would otherwise reject as AUTHORITY_INVALID (grant created in the
# future). This test cannot reuse that wrapper's own `node` entrypoint
# directly -- the wrapper IS a full CLI-shape replacement (mints THEN spawns
# the real CLI itself), while W08's whole point is calling `node "$IMPL"` and
# `bash "$SH_WRAPPER"` directly, unmodified -- so only the resulting
# --requester-binding flag is appended to this test's own argv, never routing
# through a third entrypoint. The grant_id itself never appears in
# cli-result/v1's own output (_assert_cli_result's allowedKeys has no such
# key), so using two DIFFERENT grant_ids across the two calls does not break
# the byte-identical-output property this test exists to prove.
_w08_mint_publish_request_grant() {
  node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const rest = process.argv.slice(4);
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered: " + JSON.stringify(planResult)); process.exit(1); }
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor, mirroring
    // runtime-consultation-grant-wrapper.cjs own RCC_GRANT_PROVIDER default --
    // W08 own subject (node/sh entrypoint byte-equivalence) is
    // provider-agnostic, never CLAUDE-ID-01-adjacent. No apostrophes in this
    // comment block -- bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "w08-node-sh-equivalence-session" };
    // M6+M7 requester-authority closure (Group A): createRequesterBinding now
    // rejects an empty agentKey outright -- a stable, non-empty, explicitly
    // test-only agent id is required (mirrors runtime-consultation-grant-
    // wrapper.cjs own RCC_GRANT_AGENT_ID default fix).
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "w08-node-sh-equivalence-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("createRequesterBinding failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const rewriteFrozen = (recordPath, ttlMsOverride) => {
      const raw = JSON.parse(require("fs").readFileSync(recordPath, "utf8"));
      const ttlMs = ttlMsOverride !== undefined ? ttlMsOverride : (Date.parse(raw.expiry) - Date.parse(raw.created_at));
      // isCanonicalIsoUtcLocal (runtime-consultation.cjs) rejects the
      // milliseconds-bearing form -- strip it exactly as the grant wrapper
      // fixture own canonicalIsoUtc does, for BOTH timestamps, or
      // created_at/expiry end up in two different (only one of them
      // canonical) shapes. No apostrophes in this comment block -- this
      // entire function body is inside a single-quoted bash `node -e` string,
      // where bash has no escape mechanism at all (see the sibling helper
      // functions in this file for the same constraint).
      const frozenNowIso = new Date(Date.parse("2025-01-01T00:00:00.000Z")).toISOString().replace(/\.\d{3}Z$/, "Z");
      raw.created_at = frozenNowIso;
      raw.expiry = new Date(Date.parse(frozenNowIso) + ttlMs).toISOString().replace(/\.\d{3}Z$/, "Z");
      require("fs").writeFileSync(recordPath, JSON.stringify(raw));
    };
    // M6+M7 requester-authority closure (Group B/D) fix: this helper is
    // called TWICE, once per entrypoint (node then sh), each a genuinely
    // SEPARATE process -- createRequesterBinding own idempotent lookup-or-
    // reuse validates candidates against REAL wall-clock time (this node -e
    // process has no fixed-clock concept of its own), so a binding whose
    // created_at/expiry were rewritten to the frozen past (2025-01-01,
    // always earlier than real now) looks EXPIRED to the SECOND call own
    // real-clock reuse lookup, minting a fresh binding with a DIFFERENT
    // actor_instance_id -- which, since Group C writes requester_instance_id
    // from the authenticated binding, breaks the byte-identical-output
    // property this test exists to prove. A far-future (effectively
    // permanent within any single test run) expiry keeps the binding valid
    // under BOTH clocks at once; the GRANT (minted fresh every call, never
    // reused, and hard-capped at a 30s TTL by the real CLI own consumption
    // check) keeps the preserved-original-TTL default unchanged below.
    const oneHundredYearsMs = 100 * 365 * 24 * 3600 * 1000;
    rewriteFrozen(rll.requesterBindingPathFor(projectRoot, bindingResult.binding.binding_id), oneHundredYearsMs);
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "publish-request", argvDigest, null, null, null);
    if (!mintResult.ok) { process.stderr.write("mintRoleCommandGrant failed: " + JSON.stringify(mintResult)); process.exit(1); }
    rewriteFrozen(rll.roleCommandGrantPathFor(projectRoot, mintResult.grantId));
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$IMPL" "$PROJ" "$@"
}

@test "W08 node vs sh wrapper equivalence: publish-request --fixed-ids --fixed-clock produces byte-identical cli-result/v1 stdout via both entrypoints" {
  # Self-contained git-backed fixture -- this file's own setup() intentionally
  # stays minimal for the other cases above (root-init/root-validate need no
  # git identity at all). publish-request's own computeRepoId/
  # computeWorktreeId/computeSubjectHead all shell out to
  # `git -C <coordination-root> rev-parse ...`, so $PROJ must itself be a git
  # working tree with at least one commit.
  git -C "$PROJ" init -q
  git -C "$PROJ" config user.email "bats-w08@test.local"
  git -C "$PROJ" config user.name "Bats W08"
  git -C "$PROJ" commit -q --allow-empty -m init

  # publish-request's computeRepoId/computeWorktreeId shell out to
  # `git -C <coordination-root> ...` BEFORE cmdPublishRequest's own
  # mkdirSync(planRoot) call -- `git -C` requires the directory to already
  # exist (it just chdirs there; it need not itself be a git repo root), so
  # the coordination-root must be pre-created here, unlike the plain
  # root-init/root-validate cases above which create it themselves.
  local shared_root="$PROJ/coordination-w08-request"
  mkdir -p "$shared_root"
  local wave_dir="$PROJ/.planning/wave-w08-request-wave"
  mkdir -p "$wave_dir"
  local plan_file="$wave_dir/PLAN.md"
  printf '# Fixture PLAN for runtime-consultation-windows.bats W08\n' > "$plan_file"

  local subject_bundle_file="$PROJ/.planning/coordination-subject-bundle-manifest.json"
  mkdir -p "$(dirname "$subject_bundle_file")"
  printf '{"schema":"coordination/subject-bundle-manifest/v1","entries":[]}' > "$subject_bundle_file"

  # Frozen-base-relative expiry (this file's header "UPDATE" note): created_at
  # is genuinely frozen to 2025-01-01T00:00:00.000Z under --fixed-clock, so
  # expiry must be computed relative to THAT base, via node -- never real
  # wall-clock `date` (sidesteps the documented BSD-date fallback bug, see
  # runtime-consultation-cli.test.js's own header note).
  local expiry; expiry="$(node -e 'process.stdout.write(new Date(Date.parse("2025-01-01T00:00:00.000Z") + 1800000).toISOString())')"
  local intent; intent="$(printf '{"target_role":"arch-testing","question":"W08 node-vs-sh publish-request fixture question","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$expiry")"
  local intent_b64; intent_b64="$(printf '%s' "$intent" | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))')"

  local rest_args=(--coordination-root "$shared_root" --plan "$plan_file" \
    --subject-bundle "$subject_bundle_file" --intent "$intent_b64" --fixed-ids --fixed-clock)

  local node_grant; node_grant="$(_w08_mint_publish_request_grant "${rest_args[@]}")"
  _run_node publish-request "${rest_args[@]}" --requester-binding "$node_grant"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local node_output="$output"

  # Same exact argv against the SAME plan-root: --fixed-ids resets its counter
  # to 0 in this fresh process too, so this second (sh-wrapper) invocation
  # mints the IDENTICAL request_id/created_at/expiry as the node call above --
  # producing byte-identical request content that republishes idempotently
  # (allowIdenticalIdempotent:true) rather than losing the no-clobber race. A
  # fresh, independent grant is minted here too (one-shot -- the node call
  # above already consumed its own); its canonical_argv_digest matches because
  # `rest_args` is byte-for-byte the same array, and the grant_id itself is
  # invisible in cli-result/v1's own output, so a different grant_id per call
  # cannot break byte-identity.
  local sh_grant; sh_grant="$(_w08_mint_publish_request_grant "${rest_args[@]}")"
  _run_sh publish-request "${rest_args[@]}" --requester-binding "$sh_grant"
  [ "$status" -eq 0 ]
  _assert_cli_result "SUCCESS" "NONE"
  local sh_output="$output"

  [ "$node_output" = "$sh_output" ]
}

@test "W09 ps1 wrapper: root/registry owner-confined ACL contains only the frozen allowlisted SIDs" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- Get-Acl/SID probe is Windows-only; runtime-consultation-roots.bats covers POSIX filesystem confinement instead"
}

@test "W10a ps1 wrapper: a readable-but-insecure world-SID ACL is rejected fail-closed" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- deterministic construction via icacls */S-1-1-0:(OI)(CI)F is Windows-only"
}

@test "W10b ps1 wrapper: an unverifiable/indeterminate ACL disables sibling shared-root mode fail-closed" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- RUNTIME_CONSULTATION_ACL_PROBE=unverifiable seam is exercised on the Windows leg"
}

@test "W11 ps1 wrapper: two independent processes race .lock/ and exactly one acquires, no age-reclaim" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- SC-9 multiprocess transition-lock evidence is captured on the Windows leg"
}

@test "W12 ps1 wrapper: two processes race the no-clobber primitive and exactly one wins, whole winner durable" {
  skip "requires windows-latest CI (runtime-consultation-windows.ps1) -- CreateHardLinkW + both durability boundaries are Windows-specific, SC-9/17"
}
