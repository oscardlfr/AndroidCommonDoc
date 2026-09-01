#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Policy/lifecycle-CLI tests for the portable runtime-collaboration core, Wave 1
# (portable-runtime-messaging-adapters), WP1/WP3 -- PLAN.md "Tracked policy versus
# host-local presence" (~L86-119), "Host-native lifecycle action boundary (frozen
# execution contract)" (~L134-170), and this file's own Path-Manifest row (~L1302).
#
# CLI under test: node scripts/lib/runtime-role-lifecycle.cjs <subcommand> ... (Frozen
# pre-hook caller grammar, PLAN.md ~L138-150). This file owns the closed
# `runtime-collaboration-policy/v1` project/toolkit pair-atomic lookup, the closed
# `coordination/lifecycle-cli-result/v1` stdout envelope, scalar/array/null role
# encoding at the CLI-argv surface, `ensure` idempotency/ephemeral-availability/
# fail-closed persistent-mode behavior, `action-failed`/`ready`/`wait-ready` argv +
# zero-match rejection, `notify`/`rotate`/`stop-owned`/`status` argv validation, and
# the "no caller-supplied identity/grant/prompt field" boundary. Per this file's own
# Path-Manifest row (PLAN.md ~L1302): "policy modes, exact support plane, scalar/
# array/null lifecycle grants, init-twice idempotency, sanctioned one-supervisor
# launch, draft->final rebind without respawn, WAITING reuse, death/respawn/
# rehydration, restart invalidation, Agent-Teams-disabled one-shot availability,
# ambiguous-owner rejection" and the ~L169 coverage summary.
#
# STATUS (current, exact -- verify with `bats --count` / `bats --formatter tap`
# rather than trusting this comment): 56 pass, 0 skip, 0 `not ok`.
# `scripts/lib/runtime-role-lifecycle.cjs` is fully implemented; this file's
# original RED-before-WP1-landing status (the module did not exist) is
# history, not current state -- see git log, not this comment, for when WP1
# landed. These tests were written against the frozen contract and remain so
# now that it is the current, passing state.
#
# Scope boundary (mirrors protocol.bats's own scoping discipline): this file is scoped
# to the protocol/schema/policy/argv-validation layer of `runtime-role-lifecycle.cjs`
# reachable WITHOUT a live Claude Agent Teams / Codex capability. Live capability
# conformance (real team-ensure->role-spawn ordering, a real sanctioned supervisor
# process, real draft->final `role-rebind`, real idle-reuse/death/respawn, real
# restart rediscovery) requires a fake-driver harness or a genuine runtime and is
# proven by `runtime-consultation-bridge.bats` (WP3) and the WP6 E2E suite instead --
# not fabricated here via guessed host-private registry file paths (the host-local
# presence registry is explicitly "gitignored" with NO frozen path/schema in PLAN.md,
# unlike `coordination_root`'s fully-frozen Namespace & Root Security tree that
# protocol.bats safely fabricates fixtures against). Where this file's Path-Manifest
# citation names a capability-bearing behavior (sanctioned one-supervisor launch,
# draft->final rebind, WAITING reuse, death/respawn/rehydration, restart invalidation,
# Agent-Teams-disabled one-shot availability), this file's contribution is the
# deterministic FAIL-CLOSED contract in a bare no-capability sandbox (a role may never
# be silently reported healthy/spawned without a proven connector, per PLAN.md ~L113)
# plus the argv/schema surface those transitions are driven through (`rotate`,
# `stop-owned`, `wait-ready`, `status`, ephemeral-mode `ensure`) -- not a live-success
# assertion this sandbox cannot honestly produce.
#
# Key interpretive decisions (documented so a future correction is a small, obvious
# fix rather than a silent divergence -- mirrors protocol.bats's own practice):
#   - Every invocation sets `NODE_ENV=test` + a self-minted
#     `RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY` fixture token, exactly mirroring
#     protocol.bats's own documented precedent ("this bats suite IS the harness for
#     direct-CLI protocol testing, so it mints its own fixed token here"). PLAN.md
#     freezes an analogous `RUNTIME_CONSULTATION_TEST_CAPABILITY` for the SIBLING
#     `runtime-consultation.cjs` ABI only (~L752); this file's own test-capability
#     name/value is this suite's own reasonable, precedented invention for the
#     lifecycle CLI, not a literal PLAN quote.
#   - The one-use `--lifecycle-binding <grant>` flag is hook-injected
#     (`context-provider-gate.js` / `runtime-consultation-target-gate.js`, PLAN.md
#     ~L150, ~L580) and is NEVER caller-supplied; this file exercises the pre-injection
#     caller grammar directly (no hook runs in a bats subprocess), and separately
#     proves that a CALLER-supplied `--lifecycle-binding`/identity/prompt flag is
#     itself rejected (see the "no caller-supplied identity" section) rather than
#     assuming injection happened.
#   - `coordination/lifecycle-cli-result/v1`'s closed `status` enum (exactly
#     `READY|EPHEMERAL_AVAILABLE|ACTION_REQUIRED|WAITING|UNAVAILABLE|STOPPED|INVALID`,
#     PLAN.md ~L152) has no literal "USAGE_ERROR" member even though the rc mapping
#     calls rc2 "usage" (distinct from rc3's own "INVALID"). For rc2 (missing/
#     duplicate/unrecognized argv) cases, this file therefore asserts only the CERTAIN
#     parts -- `code==2` and `ok==false` -- via `_assert_lifecycle_result`'s
#     empty-string sentinel for `expected_status`/`expected_detail`, rather than
#     guessing which of the 7 closed literals rc2 prints.
#   - "Scalar/array/null grant-role encoding" (Path-Manifest, ~L1302) names the
#     host-private `runtime/lifecycle-command-grant/v1.role` field (~L576), which is
#     hook-minted and never printed to stdout, so it cannot be inspected directly in a
#     direct-CLI test. This file instead exercises its CLI-argv-level proxy, which the
#     Frozen CLI ABI table (~L138-150) ties 1:1 to that same union: a single `--role`
#     for scalar-role commands (`rotate`, `stop-owned`), repeated `--role` for
#     multi-role `ensure`, and no `--role` at all for whole-support-plane `probe`/
#     `status`.
#   - "Zero/multiple roster matches" (~L169): zero matches is directly testable by
#     addressing a well-formed but never-minted `--action <64-hex>` id. Multiple/
#     ambiguous-owner matches require a live multi-peer race this sandbox cannot
#     honestly fabricate without guessing the host-private registry's undocumented
#     file layout; this file instead pins `AMBIGUOUS_OWNER`'s presence in the closed,
#     asserted `detail_code` enum (via `_assert_lifecycle_result`'s generic membership
#     check on every invocation) and defers a live ambiguous-owner reproduction to the
#     WP3 fake-driver/E2E suites, per this file's own scope-boundary note above.
#   - This suite hedges against an internal PLAN/wave discovery step the Frozen CLI ABI
#     table does not spell out for `runtime-role-lifecycle.cjs` (unlike
#     `runtime-consultation.cjs`, whose commands take an explicit `--plan`) by
#     providing the same kind of throwaway `.planning/wave-<slug>/PLAN.md` fixture
#     `runtime-consultation-protocol.bats` already establishes as reasonable, without
#     asserting a specific discovery algorithm.
#   - `ready_timeout_seconds`'s policy bound is inferred as inclusive `1..120`: PLAN.md
#     ~L154 states a lifecycle action's expiry is "bounded by the selected policy's
#     `ready_timeout_seconds` (maximum 120 seconds)" and the sibling CLI-level
#     `wait-ready --timeout` flag (~L145) is explicitly `1..120`; this file infers the
#     policy field shares that same closed bound rather than quoting a literal PLAN
#     sentence naming it directly.
#
# Invocation: bats scripts/tests/runtime-role-lifecycle.bats (from repo root), or
# scripts/sh/run-bats.sh --project-root "$(pwd)" scripts/tests/runtime-role-lifecycle.bats

IMPL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
WAVE_SLUG="rll-test-wave"
# Self-minted fixture token -- see "Key interpretive decisions" above.
TEST_CAPABILITY="bats-runtime-role-lifecycle-fixture-capability"

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
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  PROJ_REGISTRY_DIR="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$IMPL" "$PROJ")"

  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '# Fixture PLAN for runtime-role-lifecycle.bats\n\nThrowaway per-test fixture -- not the real Wave 1 PLAN.md.\n' > "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"

  mkdir -p "$PROJ/scripts/lib"

  _ID_COUNTER=0
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

# Plausible core-generated-shaped fixture action id: 64 lowercase-hex chars
# (satisfies the `--action <32+-hex>` format) that was never minted by any `ensure`
# call in this test -- used for "zero roster match" cases.
_gen_hex_id() {
  _ID_COUNTER=$((_ID_COUNTER + 1))
  _sha256_string "rll-fixture-action-$$-${_ID_COUNTER}-${RANDOM}-${RANDOM}"
}

_run_lifecycle() {
  run --separate-stderr env NODE_ENV=test \
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TEST_CAPABILITY" \
    node "$IMPL" "$@"
}

# Point 1.1 (R4): every lifecycle command now requires a grant (PLAN.md
# ~L150). This file's own header deliberately exercises the PRE-injection
# caller grammar (no hook runs in a bats subprocess) -- most tests below
# correctly assert the fail-closed-without-a-grant outcome directly. A
# SMALL number of tests have a DIFFERENT own intent (envelope shape, policy
# resolution, read-only status behavior) that needs a genuinely SUCCESSFUL,
# grant-authorized call to observe; this helper mints a real
# MainOrchestratorBinding + one-use lifecycle-command-grant, hook-injection
# style, for exactly those cases -- it is never used to test grant
# validation itself (that is runtime-role-lifecycle-handlers.test.js's job).
# `role_json` is a JSON-encoded role value (`null`, `"arch-testing"`, or an
# array); `action_id` defaults to null (only action-failed/ready/wait-ready
# need a real one).
_mint_lifecycle_grant() {
  local role_json="$1" subcommand="$2" argv_digest="$3" action_id="${4:-null}" runtime_session_key="${5:-}"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TEST_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const projectRoot = process.argv[2];
    const role = JSON.parse(process.argv[3]);
    const subcommand = process.argv[4];
    const argvDigest = process.argv[5];
    const actionId = process.argv[6] === "null" ? null : process.argv[6];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: process.argv[7] || "rll-bats-session-" + crypto.randomBytes(4).toString("hex") };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    const grantResult = rll.mintLifecycleCommandGrant(projectRoot, bindingResult.binding, argvDigest, role, subcommand, "main-orchestrator", "orchestrator", "normal", actionId);
    if (!grantResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(grantResult)); process.exit(1); }
    process.stdout.write(grantResult.grantId);
  ' "$IMPL" "$PROJ" "$role_json" "$subcommand" "$argv_digest" "$action_id" "$runtime_session_key"
}

# ── Policy/routing fixture builders (runtime-collaboration-policy/v1, PLAN.md
# ~L90-106; runtime-routing/v1, PLAN.md ~L1094-1110) ─────────────────────────
# Each builder merges a small JSON "overrides" object over a fully-populated default
# object, mirroring runtime-consultation-protocol.bats's own `_write_request`
# convention. A value of the literal string "__OMIT__" in overrides deletes that key
# from the merged result (used for "missing required key" cases).

_write_policy() {
  local overrides="$1"
  mkdir -p "$PROJ/scripts/lib"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "runtime-collaboration-policy/v1",
      version: 1,
      mode: "auto",
      support_plane: ["arch-platform","arch-testing","arch-integration","context-provider","doc-updater"],
      wave_scoped_roles: "derive-from-wave-class-and-scope",
      phase_scoped_roles: ["planner","verifier","quality-gater"],
      idle_behavior: "waiting",
      session_restart: "rediscover-or-canonical-respawn-rehydrate",
      ready_timeout_seconds: 120,
      max_persistent_roles: 5,
      max_respawns_per_role: 1,
      routing_ref: "scripts/lib/runtime-routing.json",
      documentation_workflow: {pattern_gap_ingestion:true, user_approval_required:true}
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$PROJ/scripts/lib/runtime-collaboration-policy.json"
}

_upgrade_policy_v2() {
  node -e '
    const fs=require("fs"); const p=process.argv[1]; const value=JSON.parse(fs.readFileSync(p,"utf8"));
    value.schema="runtime-collaboration-policy/v2"; value.version=2;
    value.selection={requested_host:"claude",requested_role_engine:"claude",required_continuity:"session-persistent",model_profile_ref:".claude/model-profiles.json#current",fallback:{mode:"deny",allowed:[]}};
    fs.writeFileSync(p,JSON.stringify(value));
  ' "$PROJ/scripts/lib/runtime-collaboration-policy.json"
}

_write_routing() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = {
      schema: "runtime-routing/v1",
      version: 1,
      routes: {
        "verifier": ["codex-app-server","codex-mcp","claude-agent","runtime-spawn","noop"],
        "quality-gater": ["codex-app-server","codex-mcp","claude-agent","runtime-spawn","noop"],
        "arch-platform": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"],
        "arch-testing": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"],
        "arch-integration": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"],
        "context-provider": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"],
        "doc-updater": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"],
        "toolkit-specialist": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"],
        "test-specialist": ["claude-sendmessage","claude-agent","codex-app-server","codex-mcp","runtime-spawn","noop"]
      }
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) {
      if (merged[k] === "__OMIT__") delete merged[k];
    }
    fs.writeFileSync(outPath, JSON.stringify(merged));
  ' "$overrides" "$out"
}

# ── Envelope assertion (coordination/lifecycle-cli-result/v1, PLAN.md ~L152) ─
# Parses the most recent `_run_lifecycle` invocation's captured stdout ($output) and
# asserts: exactly the closed key set (additionalProperties:false), literal schema,
# the given expected command, ok/code consistency (`ok === (code === 0)`), that
# `bindings`/`actions` are arrays, and generic closed-enum membership for `status`/
# `detail_code`. An empty string for `expected_command`/`expected_status`/
# `expected_detail` skips that ONE specific-value check (membership/shape checks
# still run) -- see "Key interpretive decisions" above for when/why this is used.
_assert_lifecycle_result() {
  local expected_command="$1" expected_status="$2" expected_detail="$3"
  node -e '
    let data;
    try {
      data = JSON.parse(process.argv[1]);
    } catch (err) {
      console.error("stdout is not valid JSON: " + err.message);
      process.exit(1);
    }
    const expectedCommand = process.argv[2];
    const expectedStatus = process.argv[3];
    const expectedDetail = process.argv[4];
    const allowedKeys = ["schema","command","ok","status","code","detail_code","bindings","actions","operation"];
    const statusEnum = ["READY","BLOCKED","EPHEMERAL_AVAILABLE","ACTION_REQUIRED","WAITING","UNAVAILABLE","STOPPED","INVALID"];
    const detailEnum = ["NONE","CAPABILITY_UNAVAILABLE","NATIVE_TOOL_ERROR","ACTION_EXPIRED","ACTION_REPLAY","IDENTITY_MISMATCH","AMBIGUOUS_OWNER","READY_TIMEOUT","POLICY_INVALID","DURABILITY_UNPROVEN","INTERNAL_ERROR"];
    const keys = Object.keys(data);
    const extra = keys.filter((k) => !allowedKeys.includes(k));
    const missing = allowedKeys.filter((k) => !keys.includes(k));
    if (extra.length) { console.error("unexpected extra keys: " + extra.join(",")); process.exit(1); }
    if (missing.length) { console.error("missing required keys: " + missing.join(",")); process.exit(1); }
    if (data.schema !== "coordination/lifecycle-cli-result/v1") { console.error("wrong schema: " + data.schema); process.exit(1); }
    if (expectedCommand && data.command !== expectedCommand) { console.error("expected command " + expectedCommand + " got " + data.command); process.exit(1); }
    if (typeof data.ok !== "boolean") { console.error("ok is not boolean"); process.exit(1); }
    if (typeof data.code !== "number") { console.error("code is not a number"); process.exit(1); }
    if (data.ok !== (data.code === 0)) { console.error("ok/code inconsistent"); process.exit(1); }
    if (!Array.isArray(data.bindings)) { console.error("bindings is not an array"); process.exit(1); }
    if (!Array.isArray(data.actions)) { console.error("actions is not an array"); process.exit(1); }
    if (!statusEnum.includes(data.status)) { console.error("status not in closed enum: " + data.status); process.exit(1); }
    if (!detailEnum.includes(data.detail_code)) { console.error("detail_code not in closed enum: " + data.detail_code); process.exit(1); }
    // PLAN.md ~L226: "operation is literal null for every pre-Sixteenth command" --
    // every command this file exercises (probe/ensure/ready/notify/status/rotate/
    // stop-owned/action-failed/wait-ready) predates Sixteenth, so this is a strict
    // equality, not merely an allowed-key relaxation.
    if (data.operation !== null) { console.error("operation must be null for this pre-Sixteenth command: " + JSON.stringify(data.operation)); process.exit(1); }
    if (expectedStatus && data.status !== expectedStatus) { console.error("expected status " + expectedStatus + " got " + data.status); process.exit(1); }
    if (expectedDetail && data.detail_code !== expectedDetail) { console.error("expected detail_code " + expectedDetail + " got " + data.detail_code); process.exit(1); }
  ' "$output" "$expected_command" "$expected_status" "$expected_detail"
}

# ══════════════════════════════════════════════════════════════════════════
# probe -- read-only, whole-support-plane (Frozen CLI ABI, PLAN.md ~L140)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-probe-1 PASS: probe with only --project-root succeeds and prints exactly one closed-shape envelope on one stdout line" {
  local grant_id; grant_id="$(_mint_lifecycle_grant null probe "$(_sha256_string probe)")"
  _run_lifecycle probe --project-root "$PROJ" --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  _assert_lifecycle_result "probe" "" ""
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
}

@test "LRL-probe-2 FAIL: probe missing --project-root is a usage error" {
  _run_lifecycle probe
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-probe-3 FAIL: probe rejects an unrecognized flag (--role is not part of probe's own argv)" {
  _run_lifecycle probe --project-root "$PROJ" --role arch-testing
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-probe-4: a failing probe still prints exactly one closed-shape object on one stdout line" {
  _run_lifecycle probe
  [ "$status" -eq 2 ]
  local line_count; line_count="$(printf '%s\n' "$output" | wc -l | tr -d ' ')"
  [ "$line_count" -eq 1 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Policy pair-atomicity (PLAN.md ~L108-110, ~L88-119)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-policy-1 PASS: absent project policy falls back to the toolkit-owned policy/routing pair" {
  local grant_id; grant_id="$(_mint_lifecycle_grant null probe "$(_sha256_string probe)")"
  _run_lifecycle probe --project-root "$PROJ" --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  _assert_lifecycle_result "probe" "" ""
}

@test "LRL-policy-2 PASS: project policy plus a valid sibling routing file both present and valid" {
  _write_policy '{}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  local grant_id; grant_id="$(_mint_lifecycle_grant null probe "$(_sha256_string probe)")"
  _run_lifecycle probe --project-root "$PROJ" --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  _assert_lifecycle_result "probe" "" ""
}

@test "LRL-policy-3 FAIL: project policy present but its fixed sibling routing file is absent -- fails closed, never mixes project policy with toolkit routing" {
  _write_policy '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-4 FAIL: project policy present with a sibling routing file missing its required 'routes' key -- fails closed" {
  _write_policy '{}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{"routes":"__OMIT__"}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-5 FAIL: project policy missing a required key (max_respawns_per_role) is rejected" {
  _write_policy '{"max_respawns_per_role":"__OMIT__"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-6 FAIL: project policy with an unknown additional top-level key is rejected (additionalProperties:false)" {
  _write_policy '{"totally_unknown_field_xyz":"nope"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-7 FAIL: project policy 'mode' outside the closed auto|persistent|ephemeral|disk-only enum is rejected" {
  _write_policy '{"mode":"totally-invalid-mode"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-8 FAIL: project policy 'support_plane' containing a duplicate role is rejected (unique canonical enums)" {
  _write_policy '{"support_plane":["arch-testing","arch-testing","context-provider","doc-updater","arch-platform"]}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-9 FAIL: project policy 'ready_timeout_seconds' above the pinned 120s maximum is rejected" {
  _write_policy '{"ready_timeout_seconds":121}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-10 FAIL: project policy 'ready_timeout_seconds' of 0 (below the inferred 1s floor) is rejected" {
  _write_policy '{"ready_timeout_seconds":0}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

@test "LRL-policy-11 FAIL: project policy 'routing_ref' overridden to a non-canonical path is rejected (never request-controlled)" {
  _write_policy '{"routing_ref":"/tmp/some-other-routing.json"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  _run_lifecycle probe --project-root "$PROJ"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "POLICY_INVALID"
}

# ══════════════════════════════════════════════════════════════════════════
# ensure -- scalar role encoding (Frozen CLI ABI, PLAN.md ~L141)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-ensure-scalar-1: ensure with a single canonical --role is accepted at the argv/schema layer (not a usage error)" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing
  [ "$status" -ne 2 ]
  _assert_lifecycle_result "ensure" "" ""
}

@test "LRL-ensure-scalar-2 FAIL: ensure with an unknown/non-canonical role is rejected" {
  _run_lifecycle ensure --project-root "$PROJ" --role nonexistent-role-xyz
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "ensure" "INVALID" ""
}

@test "LRL-ensure-scalar-3 FAIL: ensure with no --role at all is a usage error (at least one role is required)" {
  _run_lifecycle ensure --project-root "$PROJ"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

# ══════════════════════════════════════════════════════════════════════════
# ensure -- array/multi-role encoding (Frozen CLI ABI, PLAN.md ~L141)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-ensure-array-1: ensure with multiple distinct canonical --role flags is accepted at the argv/schema layer" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --role context-provider --role doc-updater
  [ "$status" -ne 2 ]
  _assert_lifecycle_result "ensure" "" ""
}

@test "LRL-ensure-array-2 FAIL: ensure with the identical role repeated is rejected (repeated roles rejected)" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --role arch-testing
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "ensure" "INVALID" ""
}

@test "LRL-ensure-array-3 FAIL: ensure where one of several roles is unknown/non-canonical is rejected as a whole (no partial ensure)" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --role nonexistent-role-xyz
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "ensure" "INVALID" ""
}

# ══════════════════════════════════════════════════════════════════════════
# ensure-twice idempotency (PLAN.md ~L167, ~L169 "ensure-twice one action/binding")
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-ensure-idem-1: two consecutive ensure calls for the identical role set produce byte-identical envelopes (idempotent, no flaky duplicate side effect)" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --role context-provider
  local first_output="$output" first_status="$status"
  # Absolute envelope-validity check on the FIRST call, so this test genuinely fails
  # now (module absent -> $output is not valid JSON) instead of only ever comparing
  # two identical failures to each other (which would trivially "pass" at RED).
  _assert_lifecycle_result "ensure" "" ""
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --role context-provider
  [ "$status" -eq "$first_status" ]
  [ "$output" = "$first_output" ]
}

# ══════════════════════════════════════════════════════════════════════════
# ensure -- policy-mode behavior (PLAN.md ~L112-115, ~L167)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-ensure-nogrant-1 FAIL: ensure without --lifecycle-binding is rejected as an authority failure regardless of policy mode (R4 round 2, point 1: no grantless success)" {
  for mode in auto ephemeral persistent disk-only; do
    _write_policy "{\"mode\":\"$mode\"}"
    _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
    _run_lifecycle ensure --project-root "$PROJ" --role arch-testing
    [ "$status" -eq 3 ]
    _assert_lifecycle_result "ensure" "INVALID" "IDENTITY_MISMATCH"
  done
}

@test "LRL-ensure-ephemeral-1: under ephemeral mode WITH a valid grant, ensure reports EPHEMERAL_AVAILABLE with empty bindings/actions (Agent-Teams-disabled one-shot availability, no pre-spawn claim)" {
  _write_policy '{"mode":"ephemeral"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  local grant_id; grant_id="$(_mint_lifecycle_grant '"arch-testing"' ensure "$(_sha256_string 'ensure:arch-testing')")"
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  _assert_lifecycle_result "ensure" "EPHEMERAL_AVAILABLE" "NONE"
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.bindings.length !== 0) { console.error("expected empty bindings, got " + data.bindings.length); process.exit(1); }
    if (data.actions.length !== 0) { console.error("expected empty actions, got " + data.actions.length); process.exit(1); }
  ' "$output"
}

@test "LRL-ensure-diskonly-1 FAIL: under disk-only mode WITH a valid grant but no registered supervised consumer, ensure fails closed rather than fabricating readiness" {
  _write_policy '{"mode":"disk-only"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  local grant_id; grant_id="$(_mint_lifecycle_grant '"arch-testing"' ensure "$(_sha256_string 'ensure:arch-testing')")"
  # HOME=$PROJ (a fresh mktemp dir with no .codex/ subdirectory, torn down by
  # this file's own teardown()) hermetically neutralizes
  # resolveSupervisorStartability's REAL, unconditional (never test-capability
  # gated -- see runtime-bridge-codex.cjs's createCredentialSourceProvider
  # docblock: "the ONLY unconditionally-exported constructor") ~/.codex/
  # config.toml + ~/.codex/auth.json host probes. Without this override, a
  # developer machine with genuinely valid pinned Codex CLI + credentials
  # (ambient os.homedir()) makes ensure() correctly, by design, reach
  # ACTION_REQUIRED via the real first-start path instead of this test's
  # intended UNAVAILABLE -- mirroring the hermetic temp-HOME + stub
  # CODEX_CLI_PATH fixture runtime-role-lifecycle-handlers.test.js's own P0-1
  # positive-path sibling test already established for the SAME reason.
  run --separate-stderr env NODE_ENV=test \
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TEST_CAPABILITY" \
    HOME="$PROJ" CODEX_CLI_PATH= \
    node "$IMPL" ensure --project-root "$PROJ" --role arch-testing --lifecycle-binding "$grant_id"
  [ "$status" -eq 4 ]
  _assert_lifecycle_result "ensure" "UNAVAILABLE" ""
}

@test "LRL-ensure-persistent-1 FAIL: under persistent mode WITH a valid grant but no proven connector capability, ensure reports the role UNAVAILABLE rather than silently omitting it" {
  _write_policy '{"mode":"persistent"}'
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  local grant_id; grant_id="$(_mint_lifecycle_grant '"arch-testing"' ensure "$(_sha256_string 'ensure:arch-testing')")"
  # See LRL-ensure-diskonly-1's comment immediately above: same hermetic HOME
  # override, same reason (resolveSupervisorStartability's unconditional real
  # ~/.codex probes).
  run --separate-stderr env NODE_ENV=test \
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TEST_CAPABILITY" \
    HOME="$PROJ" CODEX_CLI_PATH= \
    node "$IMPL" ensure --project-root "$PROJ" --role arch-testing --lifecycle-binding "$grant_id"
  [ "$status" -eq 4 ]
  _assert_lifecycle_result "ensure" "UNAVAILABLE" ""
}

# ══════════════════════════════════════════════════════════════════════════
# action-failed / ready / wait-ready -- argv validation (Frozen CLI ABI, PLAN.md
# ~L143-145)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-action-argv-1 FAIL: action-failed with a malformed (too-short) --action is rejected" {
  _run_lifecycle action-failed --action deadbeef --reason deadline
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-action-argv-2 FAIL: action-failed with an invalid --reason value is rejected" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle action-failed --action "$action_id" --reason totally-invalid-reason
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-action-argv-3 FAIL: ready with a malformed (too-short) --action is rejected" {
  _run_lifecycle ready --action deadbeef
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-action-argv-4 FAIL: wait-ready with --timeout 0 (below the 1..120 bound) is rejected" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle wait-ready --action "$action_id" --timeout 0
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-action-argv-5 FAIL: wait-ready with --timeout 121 (above the 1..120 bound) is rejected" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle wait-ready --action "$action_id" --timeout 121
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-action-argv-6: wait-ready with --timeout at the inclusive lower boundary (1) passes argv validation (not a usage error)" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle wait-ready --action "$action_id" --timeout 1
  [ "$status" -ne 2 ]
  # `-ne 2` alone would trivially pass against ANY non-usage failure (including a
  # crashed/absent module); the envelope check makes this test genuinely RED now.
  _assert_lifecycle_result "wait-ready" "" ""
}

@test "LRL-action-argv-7: wait-ready with --timeout at the inclusive upper boundary (120) passes argv validation (not a usage error)" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle wait-ready --action "$action_id" --timeout 120
  [ "$status" -ne 2 ]
  # `-ne 2` alone would trivially pass against ANY non-usage failure (including a
  # crashed/absent module); the envelope check makes this test genuinely RED now.
  _assert_lifecycle_result "wait-ready" "" ""
}

# ══════════════════════════════════════════════════════════════════════════
# Zero roster match (PLAN.md ~L169 "zero/multiple roster matches")
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-action-zero-1 FAIL: action-failed against a well-formed but never-minted action id has no match" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle action-failed --action "$action_id" --reason capability-unavailable
  [ "$status" -ne 0 ]
  _assert_lifecycle_result "action-failed" "" ""
}

@test "LRL-action-zero-2 FAIL: ready against a well-formed but never-minted action id has no match" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle ready --action "$action_id"
  [ "$status" -ne 0 ]
  _assert_lifecycle_result "ready" "" ""
}

@test "LRL-action-zero-3 FAIL: wait-ready against a well-formed but never-minted action id never reports READY (bounded, deterministic non-match)" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle wait-ready --action "$action_id" --timeout 1
  [ "$status" -ne 0 ]
  _assert_lifecycle_result "wait-ready" "" ""
  node -e '
    const data = JSON.parse(process.argv[1]);
    if (data.status === "READY") { console.error("a never-minted action must never report READY"); process.exit(1); }
  ' "$output"
}

# ══════════════════════════════════════════════════════════════════════════
# notify (Frozen CLI ABI, PLAN.md ~L142)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-notify-1 FAIL: notify with an invalid --kind value is rejected" {
  local artifact="$PROJ/fixture-artifact.json"
  printf '{}' > "$artifact"
  _run_lifecycle notify --project-root "$PROJ" --role arch-testing --artifact "$artifact" --kind totally-invalid-kind
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-notify-2 FAIL: notify with a missing --artifact flag is a usage error" {
  _run_lifecycle notify --project-root "$PROJ" --role arch-testing --kind session-control
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-notify-3 FAIL: notify pointing --artifact at a nonexistent path is rejected" {
  _run_lifecycle notify --project-root "$PROJ" --role arch-testing --artifact "$PROJ/does-not-exist.json" --kind session-control
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "notify" "INVALID" ""
}

@test "LRL-notify-4 FAIL: notify with an unknown role is rejected" {
  local artifact="$PROJ/fixture-artifact.json"
  printf '{}' > "$artifact"
  _run_lifecycle notify --project-root "$PROJ" --role nonexistent-role-xyz --artifact "$artifact" --kind session-control
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "notify" "INVALID" ""
}

# ══════════════════════════════════════════════════════════════════════════
# status (Frozen CLI ABI, PLAN.md ~L146)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-status-1 PASS: status with only --project-root (whole-plane) succeeds and is read-only" {
  local grant_id; grant_id="$(_mint_lifecycle_grant null status "$(_sha256_string 'status:')")"
  _run_lifecycle status --project-root "$PROJ" --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  _assert_lifecycle_result "status" "" ""
}

@test "LRL-status-2 PASS: status with --project-root plus a single canonical --role succeeds" {
  local grant_id; grant_id="$(_mint_lifecycle_grant '"arch-testing"' status "$(_sha256_string 'status:arch-testing')")"
  _run_lifecycle status --project-root "$PROJ" --role arch-testing --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  _assert_lifecycle_result "status" "" ""
}

@test "LRL-status-3 FAIL: status with --role supplied twice is rejected (not repeatable for status)" {
  _run_lifecycle status --project-root "$PROJ" --role arch-testing --role context-provider
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-status-4 FAIL: status with an unknown role is rejected" {
  _run_lifecycle status --project-root "$PROJ" --role nonexistent-role-xyz
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "status" "INVALID" ""
}

# ══════════════════════════════════════════════════════════════════════════
# rotate (Frozen CLI ABI, PLAN.md ~L147) -- respawn/rehydration/restart-invalidation
# proxy per this file's scope-boundary note above
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-rotate-1 FAIL: rotate with no --role is a usage error" {
  _run_lifecycle rotate --project-root "$PROJ"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-rotate-2 FAIL: rotate with --role supplied twice is rejected (not repeatable for rotate)" {
  _run_lifecycle rotate --project-root "$PROJ" --role arch-testing --role context-provider
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-rotate-3 FAIL: rotate against a role with no owned binding fails closed rather than fabricating a respawn" {
  _run_lifecycle rotate --project-root "$PROJ" --role arch-testing
  [ "$status" -ne 0 ]
  _assert_lifecycle_result "rotate" "" ""
}

# ══════════════════════════════════════════════════════════════════════════
# stop-owned (Frozen CLI ABI, PLAN.md ~L148)
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-stopowned-1 FAIL: stop-owned with an invalid --reason value is rejected" {
  _run_lifecycle stop-owned --project-root "$PROJ" --role arch-testing --reason totally-invalid-reason
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-stopowned-2 FAIL: stop-owned with no --role is a usage error" {
  _run_lifecycle stop-owned --project-root "$PROJ" --reason operator
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-stopowned-3 FAIL: stop-owned against a role with no owned binding fails closed (never addresses an unowned/ambiguous peer)" {
  _run_lifecycle stop-owned --project-root "$PROJ" --role arch-testing --reason operator
  [ "$status" -ne 0 ]
  _assert_lifecycle_result "stop-owned" "" ""
}

# ══════════════════════════════════════════════════════════════════════════
# No caller-supplied identity/grant/prompt fields (PLAN.md ~L150, ~L169 "no caller
# IDs/prompts")
# ══════════════════════════════════════════════════════════════════════════

@test "LRL-nocaller-1 FAIL: probe with a caller-supplied --lifecycle-binding is rejected (the grant is hook-injected, never caller-supplied)" {
  # Point 1.1 (R4): --lifecycle-binding is now a RECOGNIZED flag on probe's
  # own argv (hook-injected in production), so a forged value is no longer
  # rejected at the syntax/usage level (rc2) -- it is rejected at the
  # authority level instead (rc3/IDENTITY_MISMATCH), since it never
  # resolves to a real, validly-minted grant. The core intent (a forged
  # reference can never succeed, regardless of who supplied it) is unchanged.
  _run_lifecycle probe --project-root "$PROJ" --lifecycle-binding "forged-grant-value"
  [ "$status" -eq 3 ]
  _assert_lifecycle_result "probe" "INVALID" "IDENTITY_MISMATCH"
}

@test "LRL-nocaller-2 FAIL: ensure with a caller-supplied --session-generation is rejected" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --session-generation "forged-session-gen"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-nocaller-3 FAIL: ensure with a caller-supplied --binding-id is rejected" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --binding-id "forged-binding-id"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-nocaller-4 FAIL: ensure with a caller-supplied --team-name is rejected" {
  _run_lifecycle ensure --project-root "$PROJ" --role arch-testing --team-name "forged-team-name"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-nocaller-5 FAIL: ready with a caller-supplied --prompt is rejected" {
  local action_id; action_id="$(_gen_hex_id)"
  _run_lifecycle ready --action "$action_id" --prompt "hello from a caller"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "LRL-nocaller-6 FAIL: probe with a caller-supplied --policy-path overriding the fixed policy/routing location is rejected" {
  _run_lifecycle probe --project-root "$PROJ" --policy-path "/tmp/attacker-controlled-policy.json"
  [ "$status" -eq 2 ]
  _assert_lifecycle_result "" "" ""
}

@test "R131-LRL-57 v2 policy pair resolves and projects an exact v1 object" {
  _write_policy '{}'
  _upgrade_policy_v2
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  run node -e '
    const r=require(process.argv[1]); const pair=r.resolvePolicyPair(process.argv[2]);
    if(!pair.ok||pair.policy.schema!=="runtime-collaboration-policy/v2"||pair.policyV1.schema!=="runtime-collaboration-policy/v1"||pair.policyV1.version!==1||!r.isValidPolicy(pair.policyV1)) process.exit(1);
  ' "$IMPL" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "R131-LRL-58 signed composition qualifies claude-sendmessage capability" {
  _write_policy '{}'
  _upgrade_policy_v2
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  run node -e '
    const crypto=require("crypto"); const r=require(process.argv[1]); const h=require(process.argv[2]); const root=process.argv[3];
    const digest=crypto.createHash("sha256").update("entrypoint:monitor-docs:readonly").digest("hex");
    const minted=h.mintProductionHostComposition({projectRoot:root,event:{hook_event_name:"PreToolUse",tool_name:"Bash",model:"claude-sonnet-5"},entrypoint:"monitor-docs",argvDigest:digest,roleScope:null});
    const manifest=r.getCapabilityManifest(root); if(!minted.ok||!manifest.availableDrivers.includes("claude-sendmessage")) process.exit(1);
  ' "$IMPL" "$BATS_TEST_DIRNAME/../lib/runtime-host-claude.cjs" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "R131-LRL-59 ensure emits direct role-spawn Agent action and no team-ensure" {
  _write_policy '{}'
  _upgrade_policy_v2
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  node -e '
    const crypto=require("crypto"); const h=require(process.argv[1]); const root=process.argv[2];
    const digest=crypto.createHash("sha256").update("entrypoint:monitor-docs:readonly").digest("hex");
    const minted=h.mintProductionHostComposition({projectRoot:root,event:{hook_event_name:"PreToolUse",tool_name:"Bash",model:"claude-sonnet-5"},entrypoint:"monitor-docs",argvDigest:digest,roleScope:null});
    if(!minted.ok) process.exit(1);
  ' "$BATS_TEST_DIRNAME/../lib/runtime-host-claude.cjs" "$PROJ"
  local digest grant_id runtime_session_key fake_identity
  digest="$(_sha256_string 'ensure:arch-platform')"
  runtime_session_key="rll-bats-r131-lrl-59"
  fake_identity="{\"ok\":true,\"provider\":\"claude-hook\",\"runtime_session_key\":\"$runtime_session_key\"}"
  grant_id="$(_mint_lifecycle_grant '"arch-platform"' ensure "$digest" null "$runtime_session_key")"
  run env NODE_ENV=test \
    RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TEST_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_IDENTITY="$fake_identity" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' \
    node "$IMPL" ensure --project-root "$PROJ" --role arch-platform --lifecycle-binding "$grant_id"
  [ "$status" -eq 0 ]
  run node -e '
    const value=JSON.parse(process.argv[1]); if(value.status!=="ACTION_REQUIRED") process.exit(1);
    if(value.actions.length!==1||value.actions[0].kind!=="role-spawn"||value.actions[0].operation!=="Agent") process.exit(1);
    if(value.actions.some((a)=>a.kind==="team-ensure")) process.exit(1);
  ' "$output"
  [ "$status" -eq 0 ]
}

@test "R131-LRL-60 historical team-ensure reader remains compatible and absent is not authority" {
  run node -e '
    const r=require(process.argv[1]); const root=process.argv[2];
    if(typeof r.readTeamEnsureState!=="function") process.exit(1);
    const value=r.readTeamEnsureState(root,"0".repeat(64),"1".repeat(64),"2".repeat(64));
    if(!value||value.ok!==true||value.state!=="ABSENT") process.exit(1);
  ' "$IMPL" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "R131-LRL-61 expired or foreign composition does not qualify Claude" {
  _write_policy '{}'
  _upgrade_policy_v2
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  run node -e '
    const fs=require("fs"),path=require("path"),crypto=require("crypto"); const r=require(process.argv[1]); const h=require(process.argv[2]); const root=process.argv[3];
    const digest=crypto.createHash("sha256").update("entrypoint:monitor-docs:readonly").digest("hex");
    const minted=h.mintProductionHostComposition({projectRoot:root,event:{hook_event_name:"PreToolUse",tool_name:"Bash",model:"claude-sonnet-5"},entrypoint:"monitor-docs",argvDigest:digest,roleScope:null});
    const file=path.join(r.registryRepoDir(root),"host-compositions",minted.compositionId+".json"); const record=JSON.parse(fs.readFileSync(file,"utf8")); record.expires_at=new Date(Date.now()-1000).toISOString(); fs.writeFileSync(file,JSON.stringify(record));
    if(r.getCapabilityManifest(root).availableDrivers.includes("claude-sendmessage")) process.exit(1);
  ' "$IMPL" "$BATS_TEST_DIRNAME/../lib/runtime-host-claude.cjs" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "R131-LRL-62 environment claims never qualify Claude capability" {
  _write_policy '{}'
  _upgrade_policy_v2
  _write_routing "$PROJ/scripts/lib/runtime-routing.json" '{}'
  run env CLAUDE_MODEL=claude-sonnet-5 CLAUDE_ROLE_ENGINE=claude RUNTIME_HOST_COMPOSITION_ID="faked" node -e '
    const r=require(process.argv[1]); const manifest=r.getCapabilityManifest(process.argv[2]);
    if(manifest.availableDrivers.includes("claude-sendmessage")) process.exit(1);
  ' "$IMPL" "$PROJ"
  [ "$status" -eq 0 ]
}
