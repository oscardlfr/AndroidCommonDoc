#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Item C / C1 — scripts/lib/runtime-bridge-codex.cjs `session-run` subcommand:
# supervisor/process ownership + action handoff + registry/rendezvous
# (PLAN.md "Host-native lifecycle action boundary" ~L162, "13b. Host-private
# supervisor rendezvous/control" ~L536-542, "Frozen Production CLI ABI"
# ~L783-797, "App-server worker" ~L889). Corrected after user NO-GO on the
# first C1 pass: three DISTINCT authorities are now proven separately --
# (1) the lifecycle-command-grant/main-binding authorizing the `ensure` call
# that mints the action, (2) the SupervisorExecutionClaim/v1 proving the
# action was admitted for EXECUTION (PLAN.md ~L580), and (3) the role-owner
# rendezvous record proving PROCESS OWNERSHIP after the fact -- session-run
# validates all of them, in that order, before any registry write of its own.
#
# Scope boundary (unchanged): `session-run` production argv is exactly
# `--action --coordination-root --role [--role...] --session-expiry` -- it
# NEVER receives `--lifecycle-binding`. `bash-cli-spawn-gate.js` (WP3 item B,
# already shipped) is the sole consumer of the one-use LAUNCH-authorization
# marker; this suite never re-tests that hook (see `bash-cli-spawn-gate.bats`).
#
# C1 does NOT yet spawn any app-server child (C2's job); no process
# enumeration exists anywhere in this file.
#
# Real fixture actions are minted through the ACTUAL `runtime-role-lifecycle.cjs`
# `ensure` CLI (fake single-driver capability), mirroring `bash-cli-spawn-gate.bats`'s
# own precedent. Execution claims are minted through the ACTUAL
# `fakeHostExecutorExecute`, gated behind its own DOUBLE test-capability
# check -- never a hand-typed guess at either artifact's shape.

BRIDGE="$BATS_TEST_DIRNAME/../lib/runtime-bridge-codex.cjs"
RLL="$BATS_TEST_DIRNAME/../lib/runtime-role-lifecycle.cjs"
WAVE_SLUG="bridge-test-wave"
LC_CAPABILITY="bats-runtime-consultation-bridge-lc-fixture"
EXEC_CAPABILITY="bats-runtime-consultation-bridge-exec-fixture"

setup() {
  PROJ="$(mktemp -d)"
  git -C "$PROJ" init -q 2>/dev/null
  git -C "$PROJ" config user.email "bats@test.local"
  git -C "$PROJ" config user.name "Bats Test"
  git -C "$PROJ" commit -q --allow-empty -m init 2>/dev/null
  mkdir -p "$PROJ/.planning/wave-$WAVE_SLUG"
  printf '# Fixture PLAN for runtime-consultation-bridge.bats\n' > "$PROJ/.planning/wave-$WAVE_SLUG/PLAN.md"
  # session-run's own root-confinement check (point D) requires this to
  # already exist, 0700, owner-confined, inside the git worktree -- the
  # default "good" root every happy-path test needs; BRIDGE-ROOT-* negative
  # tests explicitly remove/corrupt it themselves.
  mkdir -p "$PROJ/.planning/coordination"
  chmod 0700 "$PROJ/.planning/coordination"
  # session-run validates bridge_argv[1] against ITS OWN running __filename --
  # a REAL copy (not a symlink, to avoid any Node module-resolution symlink
  # dereferencing ambiguity) must live at the exact path minting produces
  # (<projectRoot>/scripts/lib/runtime-bridge-codex.cjs). Copy the FULL
  # directory (not hand-picked files) so sibling config JSON
  # (runtime-routing.json etc., read at module-load time) comes along too.
  mkdir -p "$PROJ/scripts"
  cp -R "$BATS_TEST_DIRNAME/../lib" "$PROJ/scripts/lib"
  PROJ_BRIDGE="$PROJ/scripts/lib/runtime-bridge-codex.cjs"
  BG_PID=""
  BG_PID2=""
  BG_OUT="$(mktemp)"
  BG_OUT2="$(mktemp)"
}

teardown() {
  for pid in "$BG_PID" "$BG_PID2"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$BG_OUT" "$BG_OUT2"
  node -e '
    const rll = require(process.argv[1]);
    try { require("fs").rmSync(rll.registryRepoDir(process.argv[2]), { recursive: true, force: true }); } catch (e) { /* best effort */ }
  ' "$RLL" "$PROJ" 2>/dev/null || true
  rm -rf "$PROJ"
}

# Mints a real MainOrchestratorBinding + one-use grant + `ensure` call for the
# given role(s) under a fake `codex-app-server` capability, producing one
# genuine batched `supervisor-start` lifecycle action. Prints
# `<action_json>\t<binding_id>` on stdout.
_mint_raw_action() {
  local roles_csv="$1" # comma-separated, e.g. "verifier" or "quality-gater,verifier"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$LC_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const { execFileSync } = require("child_process");
    const projectRoot = process.argv[2];
    const roles = process.argv[3].split(",");
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "bridge-bats-session-" + crypto.randomBytes(4).toString("hex") };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planDigest = rll.discoverPlan(projectRoot).planDigest;
    const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 120).binding;
    const sha256String = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
    const sortedRoles = roles.slice().sort();
    const roleKey = sortedRoles.length === 1 ? sortedRoles[0] : sortedRoles; // PLAN.md ~L576: string for single-role, sorted array for multi-role
    const argvDigest = sha256String("ensure:" + sortedRoles.join(","));
    const grant = rll.mintLifecycleCommandGrant(projectRoot, binding, argvDigest, roleKey, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    const args = [process.argv[1], "ensure", "--project-root", projectRoot];
    for (const r of roles) args.push("--role", r);
    args.push("--lifecycle-binding", grant.grantId);
    const out = execFileSync("node", args, {
      encoding: "utf8",
      env: Object.assign({}, process.env, { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(["codex-app-server"]) }),
    });
    const result = JSON.parse(out.trim().split("\n").pop());
    const action = result.actions.find((a) => a.kind === "supervisor-start");
    if (!action) { process.stderr.write("no supervisor-start action minted: " + out); process.exit(1); }
    process.stdout.write(JSON.stringify(action) + "\t" + binding.binding_id);
  ' "$RLL" "$PROJ" "$roles_csv"
}

# Point B.1 hardening deliberately closes the exact loophole _mint_raw_action
# (above) used to rely on for SUP-RDV-04/05/08's own fixture construction:
# two INDEPENDENT _mint_raw_action calls used to both mint (each under its
# own fresh random session_generation_id, which the OLD generation-scoped
# singleton never saw as colliding) even for the SAME coordination root. Now
# that the singleton is correctly coordination_root_id-anchored ACROSS
# generations (point B.1), that combination can no longer arise through the
# real `ensure` CLI -- which is exactly the point of the fix. These specific
# tests are not claiming the combination arises in production; they
# unit-test the BRIDGE's OWN independent rendezvous-level defense-in-depth
# (PLAN.md ~13b's role-owner exclusion) in isolation, deliberately
# constructing a state the lifecycle layer would now refuse to produce
# itself -- exactly like this file's `_corrupt_*` fixtures construct
# otherwise-unreachable states to test one specific layer's fail-closed
# behavior. Mints the action and transitions its role-binding(s)
# ABSENT->STARTING using the SAME primitives
# mintSupervisorBatchUnderTransaction calls internally, MINUS its
# coordination-root singleton lock/owner-record bookkeeping -- never a
# SECOND lifecycle owner record (there must only ever be one real,
# authoritative owner per coordination root; this fixture's second action is
# deliberately un-owned at that layer, so only the BRIDGE's own independent
# check is what the test exercises).
_mint_raw_action_independent() {
  local roles_csv="$1"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$LC_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const projectRoot = process.argv[2];
    const roles = process.argv[3].split(",");
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "bridge-bats-independent-" + crypto.randomBytes(4).toString("hex") };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planDigest = rll.discoverPlan(projectRoot).planDigest;
    const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 120).binding;
    const gen = rll.resolveSessionGeneration(projectRoot, identity);
    if (!gen.ok) { process.stderr.write("session generation resolve failed"); process.exit(1); }
    const pair = rll.resolvePolicyPair(projectRoot);
    if (!pair.ok) { process.stderr.write("policy pair resolve failed"); process.exit(1); }
    const repoId = rll.computeRepoId(projectRoot);
    const sortedRoles = roles.slice().sort();
    const minted = rll.mintBatchedSupervisorStartAction(projectRoot, pair, repoId, worktreeId, planDigest, gen.generationId, sortedRoles, binding.expiry);
    if (!minted.ok) { process.stderr.write("independent mint failed"); process.exit(1); }
    for (const role of sortedRoles) {
      const profileDigest = rll.roleProfileDigestFor(role);
      const t = rll.transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, gen.generationId, role, "ABSENT", "STARTING", null, { driver: "codex-app-server", respawn_count: 0, pending_action_id: minted.actionId });
      if (!t.ok) { process.stderr.write("independent role-binding transition failed: " + JSON.stringify(t)); process.exit(1); }
    }
    process.stdout.write(JSON.stringify(minted.action) + "\t" + binding.binding_id);
  ' "$RLL" "$PROJ" "$roles_csv"
}

_mint_ready_action_independent() {
  local roles_csv="${1:-verifier}"
  local minted action_json binding_id
  minted="$(_mint_raw_action_independent "$roles_csv")"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  echo "$action_json"
}

# Mints the SupervisorExecutionClaim/v1 for an already-minted action via the
# REAL fakeHostExecutorExecute, under its own DOUBLE capability gate.
_mint_execution_claim() {
  local action_json="$1" binding_id="$2"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$LC_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="$EXEC_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const bindingId = process.argv[3];
    const projectRoot = process.argv[4];
    const result = rll.fakeHostExecutorExecute(projectRoot, action.action_id, "executed", bindingId);
    if (!result.ok) { process.stderr.write("execution claim mint failed: " + JSON.stringify(result)); process.exit(1); }
    process.stdout.write("ok");
  ' "$RLL" "$action_json" "$binding_id" "$PROJ"
}

# The standard "fully valid, ready to run" fixture: mints the action AND its
# execution claim. Prints the action JSON.
_mint_ready_action() {
  local roles_csv="${1:-verifier}"
  local minted action_json binding_id
  minted="$(_mint_raw_action "$roles_csv")"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  echo "$action_json"
}

_action_field() {
  node -e 'process.stdout.write(String(JSON.parse(process.argv[1])[process.argv[2]]))' "$1" "$2"
}

_action_path() {
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.actionPathFor(process.argv[2], process.argv[3]));
  ' "$RLL" "$PROJ" "$1"
}

_corrupt_action_field() {
  local action_id="$1" field="$2" value_json="$3"
  local p; p="$(_action_path "$action_id")"
  node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    obj[process.argv[2]] = JSON.parse(process.argv[3]);
    fs.writeFileSync(process.argv[1], JSON.stringify(obj));
  ' "$p" "$field" "$value_json"
}

_execution_claim_path() {
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.executionClaimPathFor({ repoId: process.argv[3] }, process.argv[2]));
  ' "$RLL" "$1" "$2"
}

_corrupt_claim_field() {
  local action_id="$1" repo_id="$2" field="$3" value_json="$4"
  local p; p="$(_execution_claim_path "$action_id" "$repo_id")"
  node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    obj[process.argv[2]] = JSON.parse(process.argv[3]);
    fs.writeFileSync(process.argv[1], JSON.stringify(obj));
  ' "$p" "$field" "$value_json"
}

_main_binding_path() {
  local binding_id="$1"
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(rll.mainOrchestratorBindingPathFor(process.argv[2], process.argv[3]));
  ' "$RLL" "$PROJ" "$binding_id"
}

# Builds session-run argv (array, minus leading node+script) from a minted
# action's own payload.bridge_argv, dropping the leading `node <bridge-path>
# session-run` prefix.
_argv_from_action() {
  node -e '
    const action = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(action.payload.bridge_argv.slice(3)));
  ' "$1"
}

_args_from_json() {
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(node -e 'JSON.parse(process.argv[1]).forEach((v) => process.stdout.write(v + "\n"))' "$1")
  printf '%s\n' "${args[@]}"
}

_run_bridge_argv_json() {
  local argv_json="$1"
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(_args_from_json "$argv_json")
  run --separate-stderr node "$PROJ_BRIDGE" session-run "${args[@]}"
}

_owner_file() {
  local role="$1"
  find "$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.registryRepoDir(process.argv[2]));' "$RLL" "$PROJ")/rendezvous/role-owners" -name "${role}.json" 2>/dev/null | head -1
}

_wait_for_owner_file() {
  local role="$1"
  for _ in $(seq 1 100); do
    local f; f="$(_owner_file "$role")"
    if [ -n "$f" ] && [ -f "$f" ]; then echo "$f"; return 0; fi
    sleep 0.1
  done
  return 1
}

_wait_for_pid_exit() {
  local pid="$1"
  for _ in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  return 1
}

_start_bridge_bg() {
  local argv_json="$1" out_var="$2"
  local args=()
  while IFS= read -r line; do args+=("$line"); done < <(_args_from_json "$argv_json")
  if [ "$out_var" = "BG_OUT2" ]; then
    node "$PROJ_BRIDGE" session-run "${args[@]}" >"$BG_OUT2" 2>&1 &
    BG_PID2=$!
  else
    node "$PROJ_BRIDGE" session-run "${args[@]}" >"$BG_OUT" 2>&1 &
    BG_PID=$!
  fi
}

_future_iso() {
  node -e 'process.stdout.write(new Date(Date.now() + Number(process.argv[1])).toISOString().replace(/\.\d{3}Z$/, "Z"))' "$1"
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-RUN — argv shape (Frozen Production CLI ABI, PLAN.md ~L787)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-RUN-01 FAIL: session-run with no arguments is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-02 FAIL: session-run missing --action is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-03 FAIL: session-run missing --coordination-root is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --role verifier --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-04 FAIL: session-run missing --role is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-05 FAIL: session-run missing --session-expiry is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role verifier
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-06 FAIL: an unknown flag is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "$(_future_iso 60000)" --bogus-flag x
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-07 FAIL: a duplicate non-repeatable --action is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action aaaa --action bbbb --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-08 FAIL: an unknown/non-canonical role is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role not-a-real-role --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-09 FAIL: a duplicate role in argv is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role verifier --role verifier --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-10 FAIL: roles supplied out of sorted order is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role verifier --role quality-gater --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-11 FAIL: a --session-expiry already in the past is rejected" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "2000-01-01T00:00:00Z"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-RUN-12 FAIL: a malformed --session-expiry is rejected" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "aa11bb22cc33dd44aa11bb22cc33dd44" --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "not-a-date"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-RUN-13 FAIL: an unknown subcommand is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE" not-a-real-subcommand
  [ "$status" -eq 2 ]
}

@test "BRIDGE-RUN-14 FAIL: no subcommand at all is a usage error" {
  run --separate-stderr node "$PROJ_BRIDGE"
  [ "$status" -eq 2 ]
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-ACT — action handoff revalidation (defense in depth vs the gate)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-ACT-01 FAIL: an --action id matching no minted action is rejected" {
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "0000000000000000000000000000ff" --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "BRIDGE-ACT-02 FAIL: an action whose kind is not supervisor-start is rejected" {
  local action_id
  action_id="$(NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$LC_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="$EXEC_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const { execFileSync } = require("child_process");
    const projectRoot = process.argv[2];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "x" + crypto.randomBytes(4).toString("hex") };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planDigest = rll.discoverPlan(projectRoot).planDigest;
    const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 120).binding;
    const sha256String = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
    const argvDigest = sha256String("ensure:arch-testing");
    const grant = rll.mintLifecycleCommandGrant(projectRoot, binding, argvDigest, "arch-testing", "ensure", "main-orchestrator", "orchestrator", "normal", null);
    const caps = { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(["claude-sendmessage"]) };
    const out1 = execFileSync("node", [process.argv[1], "ensure", "--project-root", projectRoot, "--role", "arch-testing", "--lifecycle-binding", grant.grantId], {
      encoding: "utf8",
      env: Object.assign({}, process.env, caps),
    });
    const result1 = JSON.parse(out1.trim().split("\n").pop());
    const teamAction = result1.actions.find((a) => a.kind === "team-ensure");
    // Team-ensure must SUCCEED before ensure will mint the role-spawn action
    // (WP3 item C correction, point C) -- register it via the same
    // double-capability-gated FakeHostExecutor path, then re-ensure.
    const registerResult = rll.fakeHostExecutorExecute(projectRoot, teamAction.action_id, "executed", "unused-for-team-ensure");
    if (!registerResult.ok) { process.stderr.write("team-ensure success registration failed: " + JSON.stringify(registerResult)); process.exit(1); }
    const grant2 = rll.mintLifecycleCommandGrant(projectRoot, binding, argvDigest, "arch-testing", "ensure", "main-orchestrator", "orchestrator", "normal", null);
    const out2 = execFileSync("node", [process.argv[1], "ensure", "--project-root", projectRoot, "--role", "arch-testing", "--lifecycle-binding", grant2.grantId], {
      encoding: "utf8",
      env: Object.assign({}, process.env, caps),
    });
    const result2 = JSON.parse(out2.trim().split("\n").pop());
    process.stdout.write(result2.actions.find((a) => a.kind === "role-spawn").action_id);
  ' "$RLL" "$PROJ")"
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "$action_id" --coordination-root "$PROJ/.planning/coordination" --role arch-testing --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-03 FAIL: an expired action is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" expires_at '"2000-01-01T00:00:00Z"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-04 FAIL: a --coordination-root that does not match the action's own bridge_argv is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "$action_id" --coordination-root "$PROJ/some/other/dir" --role verifier --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "BRIDGE-ACT-05 FAIL: a --role not matching the action's own payload role is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "$action_id" --coordination-root "$PROJ/.planning/coordination" --role quality-gater --session-expiry "$(_future_iso 60000)"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-06 FAIL: an altered --session-expiry (argv no longer deep-equals bridge_argv) is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  run --separate-stderr node "$PROJ_BRIDGE" session-run --action "$action_id" --coordination-root "$PROJ/.planning/coordination" --role verifier --session-expiry "$(_future_iso 90000)"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-07 FAIL: an action whose repo_id no longer matches the coordination-root-derived project is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" repo_id '"0000000000000000000000000000000000000000000000000000000000000000"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-08 FAIL: an action whose plan_digest no longer matches the on-disk PLAN is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" plan_digest '"0000000000000000000000000000000000000000000000000000000000000000"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-09 FAIL: an action whose session_generation_id has no live registry record is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" session_generation_id '"ffffffffffffffffffffffffffffff"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-10 FAIL: an action whose runtime is not host-process is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" runtime '"claude-native"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-11 FAIL: an action whose role is not null is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" role '"verifier"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-12 FAIL: a tampered payload.bridge literal is rejected" {
  local action_json action_id p
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  p="$(_action_path "$action_id")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.payload.bridge="something-else"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$p"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-13 FAIL: a tampered payload.bridge_command (no longer round-tripping bridge_argv) is rejected" {
  local action_json action_id p
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  p="$(_action_path "$action_id")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.payload.bridge_command="not the real render"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$p"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-14 FAIL: a bridge_argv[1] pointing at a different file than the running script is rejected" {
  local action_json action_id p
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  p="$(_action_path "$action_id")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.payload.bridge_argv[1]="/tmp/not-the-real-bridge.cjs"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$p"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-15 FAIL: a binding NOT in STARTING/REHYDRATING (e.g. already READY) is rejected" {
  local action_json
  action_json="$(_mint_ready_action verifier)"
  # Fabricate the binding straight to READY, bypassing session-run entirely.
  node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const profileDigest = rll.roleProfileDigestFor("verifier");
    const repoDescriptor = { repoId: action.repo_id };
    const state = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier");
    rll.transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier", "STARTING", "READY", state.record, {});
  ' "$RLL" "$action_json"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-17 FAIL: a QUARANTINED binding is rejected (not just an arbitrary non-STARTING state)" {
  local action_json
  action_json="$(_mint_ready_action verifier)"
  node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const profileDigest = rll.roleProfileDigestFor("verifier");
    const repoDescriptor = { repoId: action.repo_id };
    const state = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier");
    // failure_reason is REQUIRED (bidirectional) for QUARANTINED -- R4
    // round 2 point 4 writer-side pre-persist validation now genuinely
    // enforces this (previously the writer had zero self-validation, so an
    // incomplete extraFields object silently wrote a since-shape-invalid
    // record instead of failing the fixture setup outright).
    const t = rll.transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier", "STARTING", "QUARANTINED", state.record, { failure_reason: "ambiguous-owner" });
    if (!t.ok) { process.stderr.write("fixture setup failed: " + JSON.stringify(t)); process.exit(1); }
  ' "$RLL" "$action_json"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ACT-16 FAIL: a binding whose pending_action_id points at a DIFFERENT action is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const profileDigest = rll.roleProfileDigestFor("verifier");
    const repoDescriptor = { repoId: action.repo_id };
    const state = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier");
    rll.transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier", "STARTING", "STARTING", state.record, {});
  ' "$RLL" "$action_json" 2>/dev/null || true
  # transitionRoleBinding forbids STARTING->STARTING (not in the closed graph) --
  # instead directly corrupt the pending_action_id on the binding record file.
  local binding_path
  binding_path="$(node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const profileDigest = rll.roleProfileDigestFor("verifier");
    process.stdout.write(rll.roleBindingPathFor({ repoId: action.repo_id }, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier"));
  ' "$RLL" "$action_json")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.pending_action_id="0000000000000000000000000000ff"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$binding_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-CLAIM — SupervisorExecutionClaim/v1 (point B: distinct authority)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-CLAIM-01 FAIL: production session-run fails closed when no execution claim exists at all (WP4 issuer not yet wired)" {
  local minted action_json
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  # Deliberately skip _mint_execution_claim.
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "BRIDGE-CLAIM-02 FAIL: a replayed session-run for an already-consumed execution claim is rejected" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "BRIDGE-CLAIM-03 FAIL: an expired execution claim is rejected" {
  local minted action_json action_id binding_id claim_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.expiry="2000-01-01T00:00:00Z"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-CLAIM-04 FAIL: an execution claim minted under a DIFFERENT session_generation_id is rejected" {
  local minted action_json action_id binding_id claim_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.session_generation_id="ffffffffffffffffffffffffffffff"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-CLAIM-05 FAIL: an execution claim minted for a DIFFERENT canonical_argv_digest (wrong argv) is rejected" {
  local minted action_json action_id binding_id claim_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.canonical_argv_digest="0".repeat(64); fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-CLAIM-07 FAIL: an execution claim minted for a DIFFERENT plan_digest than the action's own is rejected" {
  local minted action_json action_id binding_id claim_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.plan_digest="0".repeat(64); fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-CLAIM-08 FAIL: an execution claim minted for a DIFFERENT worktree_id than the action's own is rejected" {
  local minted action_json action_id binding_id claim_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.worktree_id="0".repeat(64); fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-CLAIM-06 FAIL: the fake executor capability alone (without the double gate) never mints a claim" {
  local minted action_json action_id binding_id
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  # Only the GENERAL test capability, not the narrower executor one.
  run env NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$LC_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const result = rll.fakeHostExecutorExecute(process.argv[2], process.argv[3], "executed", process.argv[4]);
    process.stdout.write(JSON.stringify(result));
  ' "$RLL" "$PROJ" "$action_id" "$binding_id"
  [[ "$output" == *'"ok":false'* ]]
  [[ "$output" == *'fake-executor-capability-absent'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-ROOT — coordination-root confinement (point D, reused primitive)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-ROOT-01 FAIL: a symlinked coordination-root leaf is rejected" {
  local action_json argv_json real_dir
  real_dir="$(mktemp -d)"
  rm -rf "$PROJ/.planning/coordination"
  ln -s "$real_dir" "$PROJ/.planning/coordination"
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]
  rm -rf "$real_dir"
}

@test "BRIDGE-ROOT-02 FAIL: a coordination-root with wrong (world/group-readable) POSIX mode is rejected" {
  local action_json argv_json
  mkdir -p "$PROJ/.planning/coordination"
  chmod 0755 "$PROJ/.planning/coordination"
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ROOT-03 PASS: a coordination-root that does not exist yet is fine (root-init is not this file's job -- created on demand elsewhere; session-run itself never mkdirs it, so a still-absent root at THIS validation point is a real rejection)" {
  # session-run does not create the coordination root itself (that is
  # runtime-consultation.cjs's root-init, a WP1 concern) -- confirm the
  # honest rejection rather than a silent mkdir.
  local action_json argv_json
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  rm -rf "$PROJ/.planning/coordination"
  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-ROOT-04 FAIL: a coordination-root outside the git worktree (root swap) is rejected" {
  local outside action_json argv_json
  outside="$(mktemp -d)"
  rm -rf "$PROJ/.planning/coordination"
  mkdir -p "$outside/coordination"
  chmod 0700 "$outside/coordination"
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(node -e '
    const action = JSON.parse(process.argv[1]);
    const tail = action.payload.bridge_argv.slice(3);
    const idx = tail.indexOf("--coordination-root");
    tail[idx + 1] = process.argv[2];
    process.stdout.write(JSON.stringify(tail));
  ' "$action_json" "$outside/coordination")"
  # This argv no longer deep-equals the action payload (BRIDGE-ACT-04 territory)
  # -- but confirms root-swap is ALSO independently caught if argv equality
  # were somehow bypassed; run it through the real CLI which enforces both.
  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]
  rm -rf "$outside"
}

# ══════════════════════════════════════════════════════════════════════════
# SUP-RDV — supervisor rendezvous / "start marker" (PLAN.md ~L536-542)
# ══════════════════════════════════════════════════════════════════════════

@test "SUP-RDV-01 PASS: a fully valid session-run wins the role-owner record and cleans up on SIGTERM" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  [ -f "$owner_file" ]

  run node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const ok = obj.schema === "coordination/supervisor-rendezvous-role-owner/v1"
      && obj.role === "verifier"
      && typeof obj.coordination_root_id === "string" && obj.coordination_root_id.length > 0
      && typeof obj.rendezvous_instance_id === "string" && obj.rendezvous_instance_id.length >= 32
      && typeof obj.supervisor_instance_id === "string" && obj.supervisor_instance_id.length >= 32
      && obj.pid_identity && typeof obj.pid_identity.pid === "number";
    process.exit(ok ? 0 : 1);
  ' "$owner_file"
  [ "$status" -eq 0 ]

  local mode
  mode="$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$owner_file")"
  [ "$mode" = "600" ]

  kill -TERM "$BG_PID"
  wait "$BG_PID" 2>/dev/null
  local exit_code=$?
  BG_PID=""
  [ "$exit_code" -eq 0 ]
  grep -q '"schema":"coordination/bridge-result' "$BG_OUT"
  grep -q '"ok":true' "$BG_OUT"
  [ -z "$(_owner_file verifier)" ]
}

@test "CLEANUP-05 PASS: a genuine, correctly-correlated cleanup TOMBSTONES the owner record (durable non-destructive rename), never destructively deletes it (point 4)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  local original
  original="$(cat "$owner_file")"
  local supervisor_instance_id
  supervisor_instance_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).supervisor_instance_id)' "$owner_file")"
  [ -n "$supervisor_instance_id" ]

  kill -TERM "$BG_PID"
  wait "$BG_PID" 2>/dev/null
  local exit_code=$?
  BG_PID=""
  [ "$exit_code" -eq 0 ]
  grep -q '"ok":true' "$BG_OUT"

  # Gone from its original, live-owner-searchable path...
  [ ! -f "$owner_file" ]
  [ -z "$(_owner_file verifier)" ]

  # ...but fully recoverable: a byte-identical tombstone exists, namespaced
  # by the exact supervisor_instance_id this claim minted, inside a
  # sibling .tombstone/ directory -- never permanently destroyed.
  local tombstone_dir tombstone_file
  tombstone_dir="$(dirname "$owner_file")/.tombstone"
  [ -d "$tombstone_dir" ]
  tombstone_file="${tombstone_dir}/verifier.json.${supervisor_instance_id}"
  [ -f "$tombstone_file" ]
  local tombstoned
  tombstoned="$(cat "$tombstone_file")"
  [ "$tombstoned" = "$original" ]

  local tombstone_mode
  tombstone_mode="$(node -e 'process.stdout.write((require("fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$tombstone_file")"
  [ "$tombstone_mode" = "600" ]
}

@test "SUP-RDV-02 PASS: multi-role session-run shares ONE rendezvous_instance_id/supervisor_instance_id/pid_identity across every role-owner record" {
  local action_json argv_json owner_v owner_qg
  action_json="$(_mint_ready_action "quality-gater,verifier")"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_v="$(_wait_for_owner_file verifier)"
  owner_qg="$(_wait_for_owner_file quality-gater)"
  [ -n "$owner_v" ]
  [ -n "$owner_qg" ]

  run node -e '
    const fs = require("fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const ok = a.rendezvous_instance_id === b.rendezvous_instance_id
      && a.supervisor_instance_id === b.supervisor_instance_id
      && JSON.stringify(a.pid_identity) === JSON.stringify(b.pid_identity)
      && a.rendezvous_instance_id !== a.supervisor_instance_id;
    process.exit(ok ? 0 : 1);
  ' "$owner_v" "$owner_qg"
  [ "$status" -eq 0 ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-03 FAIL: a second session-run replaying the same action while the first still owns is rejected, first owner untouched" {
  local action_json argv_json owner_file before after
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  before="$(cat "$owner_file")"

  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]

  after="$(cat "$owner_file")"
  [ "$before" = "$after" ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-04 FAIL: a second, independently-minted action for the same role+root is rejected while the first still owns (two-launcher race), foreign owner byte-identical" {
  local action_json1 action_json2 argv_json1 argv_json2 owner_file before after
  action_json1="$(_mint_ready_action verifier)"
  argv_json1="$(_argv_from_action "$action_json1")"
  _start_bridge_bg "$argv_json1" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  before="$(cat "$owner_file")"

  action_json2="$(_mint_ready_action_independent verifier)"
  argv_json2="$(_argv_from_action "$action_json2")"
  _run_bridge_argv_json "$argv_json2"
  [ "$status" -eq 4 ]

  after="$(cat "$owner_file")"
  [ "$before" = "$after" ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-05 FAIL: two DISJOINT-role session-run processes on the SAME coordination-root cannot coexist -- at most one retained supervisor per root (point A singleton, corrected from the first C1 pass)" {
  local action_json1 action_json2 argv_json1 argv_json2 owner1
  action_json1="$(_mint_ready_action verifier)"
  argv_json1="$(_argv_from_action "$action_json1")"
  _start_bridge_bg "$argv_json1" BG_OUT
  owner1="$(_wait_for_owner_file verifier)"
  [ -n "$owner1" ]

  action_json2="$(_mint_ready_action_independent quality-gater)"
  argv_json2="$(_argv_from_action "$action_json2")"
  _run_bridge_argv_json "$argv_json2"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file quality-gater)" ]

  # The first supervisor's own owner record is completely untouched.
  [ -f "$owner1" ]
  [ -n "$(_owner_file verifier)" ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-06 PASS: after clean SIGTERM shutdown, a fresh valid action for the same role can win a new owner record" {
  local action_json1 action_json2 argv_json1 argv_json2 owner1 owner2
  action_json1="$(_mint_ready_action verifier)"
  argv_json1="$(_argv_from_action "$action_json1")"
  _start_bridge_bg "$argv_json1" BG_OUT
  owner1="$(_wait_for_owner_file verifier)"
  [ -n "$owner1" ]
  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
  [ -z "$(_owner_file verifier)" ]

  action_json2="$(_mint_ready_action verifier)"
  argv_json2="$(_argv_from_action "$action_json2")"
  _start_bridge_bg "$argv_json2" BG_OUT
  owner2="$(_wait_for_owner_file verifier)"
  [ -n "$owner2" ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-07 FAIL: the SAME action replayed AFTER a clean shutdown is still rejected (execution claim was one-use, already consumed)" {
  local action_json argv_json owner1
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner1="$(_wait_for_owner_file verifier)"
  [ -n "$owner1" ]
  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""

  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "SUP-RDV-08 PASS: SIGTERM delivered MID-acquisition (before the second role is claimed) still rolls back whatever was already claimed" {
  # Roles are claimed in ARGV order, which parseSessionRunArgv requires to be
  # plain alphabetical (roles-not-sorted usage error otherwise) -- for
  # "quality-gater,verifier" that means quality-gater is attempted FIRST,
  # verifier SECOND. Pre-occupy verifier's slot so the loop genuinely claims
  # quality-gater first, THEN hits the occupied second role and must roll the
  # first one back -- proves real rollback, not just "refuses to claim
  # anything when the very first role is already occupied" (point C.5:
  # shutdown handling installed before acquisition begins covers this exact
  # partial-claim window, exercised here via the ordinary rejection path
  # since deterministically racing a real SIGTERM mid-loop is not reproducible
  # from a black-box bats test).
  local action_json argv_json
  action_json="$(_mint_ready_action "quality-gater,verifier")"
  argv_json="$(_argv_from_action "$action_json")"

  # Occupy verifier's slot first via an unrelated single-role run.
  local occupy_json occupy_argv
  occupy_json="$(_mint_ready_action_independent verifier)"
  occupy_argv="$(_argv_from_action "$occupy_json")"
  _start_bridge_bg "$occupy_argv" BG_OUT
  local occ_owner
  occ_owner="$(_wait_for_owner_file verifier)"
  [ -n "$occ_owner" ]

  _run_bridge_argv_json "$argv_json"
  [ "$status" -eq 4 ]
  # quality-gater (claimed first, before the loop hit the occupied verifier
  # slot) must have been rolled back, never left dangling.
  [ -z "$(_owner_file quality-gater)" ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-09 PASS: expiry-driven owned shutdown fires without any external signal" {
  # Normal minting always uses the fixed ACTION_TTL_SECONDS=120s -- too long
  # for a bats test to wait out. Mutate the minted action's own
  # --session-expiry to ~1.5s from now (regenerating bridge_command so the
  # round-trip check still passes) BEFORE minting the execution claim, so the
  # claim's own canonical_argv_digest is computed over the SAME mutated argv
  # this test actually runs -- a legitimate fixture technique, not a
  # production code path.
  local minted action_json action_id binding_id p new_expiry
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  p="$(_action_path "$action_id")"
  new_expiry="$(_future_iso 1500)"
  node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const argv = o.payload.bridge_argv;
    argv[argv.indexOf("--session-expiry") + 1] = process.argv[3];
    o.payload.bridge_command = rll.renderPosixDirect(argv);
    // The action'"'"'s own top-level expires_at must correlate with the
    // argv-embedded --session-expiry (point E cross-check) -- mutate both.
    o.expires_at = process.argv[3];
    fs.writeFileSync(process.argv[2], JSON.stringify(o));
  ' "$RLL" "$p" "$new_expiry"
  action_json="$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))' "$p")"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null

  local argv_json owner_file
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  # No SIGTERM sent -- the process's OWN scheduled expiry timer must fire.
  _wait_for_pid_exit "$BG_PID"
  wait "$BG_PID" 2>/dev/null
  local exit_code=$?
  BG_PID=""
  [ "$exit_code" -eq 0 ]
  grep -q '"reason":"owned-shutdown"' "$BG_OUT"
  grep -q '"signal":"EXPIRY"' "$BG_OUT"
  [ -z "$(_owner_file verifier)" ]

  # Point D.1: EXPIRY terminalizes the role-binding with failure_reason
  # "deadline" -- never the generic "native-tool-error" every signal used to
  # be hardcoded to, regardless of what actually triggered the shutdown.
  run node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const profileDigest = rll.roleProfileDigestFor("verifier");
    const state = rll.readRoleBindingState(process.argv[3], action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier");
    process.exit(state.ok && state.state === "UNAVAILABLE" && state.record.failure_reason === "deadline" ? 0 : 1);
  ' "$RLL" "$action_json" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "SUP-RDV-16 FAIL: expiry crossed DURING the inter-role await is caught immediately after it, never a stale pre-await snapshot -- the second role is never claimed past the deadline (point D.1)" {
  # Roles claim in ARGV order (alphabetical): quality-gater FIRST, verifier
  # SECOND -- see SUP-RDV-08. session-expiry is mutated to ~1s from now;
  # the inter-role delay (~1.5s) crosses it WHILE role 1 is already
  # claimed and role 2's claim is pending -- a pre-await expiry snapshot
  # would already have passed by the time role 2's write is attempted.
  local minted action_json action_id binding_id p new_expiry
  minted="$(_mint_raw_action "quality-gater,verifier")"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  p="$(_action_path "$action_id")"
  # 2.5s (not SUP-RDV-09's 1.5s): this fixture does STRICTLY more sequential
  # node-subprocess setup work (two roles, plus the extra mutate/reread
  # round-trip) before the claim is even minted, and the claim's own TTL is
  # computed from THIS expiry at mint time -- too tight a margin here fails
  # the fixture itself (no-positive-ttl-remaining) under load, before
  # session-run ever runs, rather than exercising the behavior under test.
  new_expiry="$(_future_iso 2500)"
  node -e '
    const rll = require(process.argv[1]);
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const argv = o.payload.bridge_argv;
    argv[argv.indexOf("--session-expiry") + 1] = process.argv[3];
    o.payload.bridge_command = rll.renderPosixDirect(argv);
    o.expires_at = process.argv[3];
    fs.writeFileSync(process.argv[2], JSON.stringify(o));
  ' "$RLL" "$p" "$new_expiry"
  action_json="$(node -e 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))' "$p")"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null

  local argv_json
  argv_json="$(_argv_from_action "$action_json")"
  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS=3000
  _run_bridge_argv_json "$argv_json"
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS
  [ "$status" -eq 4 ]

  # Neither role's owner survives -- quality-gater (claimed before the
  # await) is rolled back, verifier (never reached) was never claimed.
  [ -z "$(_owner_file quality-gater)" ]
  [ -z "$(_owner_file verifier)" ]

  # Both role-bindings are terminalized with failure_reason "deadline".
  run node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    for (const role of ["quality-gater", "verifier"]) {
      const profileDigest = rll.roleProfileDigestFor(role);
      const state = rll.readRoleBindingState(process.argv[3], action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
      if (!state.ok || state.state !== "UNAVAILABLE" || state.record.failure_reason !== "deadline") process.exit(1);
    }
    process.exit(0);
  ' "$RLL" "$action_json" "$PROJ"
  [ "$status" -eq 0 ]
}

@test "SUP-RDV-10 PASS: a REPLACEMENT owner (different supervisor/rendezvous instance ids) found at cleanup time is never deleted, and this is NOT treated as a cleanup failure" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  local original
  original="$(cat "$owner_file")"

  # Simulate a hypothetical later reaper/second-supervisor scenario: some
  # OTHER identity now owns this exact path (fixture technique only -- no
  # production code path performs this overwrite; the no-clobber write
  # itself makes it impossible in-band, this proves the DEFENSIVE re-check).
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.supervisor_instance_id = "f".repeat(32);
    o.rendezvous_instance_id = "e".repeat(32);
    fs.writeFileSync(process.argv[1], JSON.stringify(o), { mode: 0o600 });
  ' "$owner_file"
  local replacement
  replacement="$(cat "$owner_file")"
  [ "$original" != "$replacement" ]

  kill -TERM "$BG_PID"
  wait "$BG_PID" 2>/dev/null
  local exit_code=$?
  BG_PID=""
  [ "$exit_code" -eq 0 ]
  grep -q '"ok":true' "$BG_OUT"

  # The replacement record is untouched byte-for-byte.
  [ -f "$owner_file" ]
  local after
  after="$(cat "$owner_file")"
  [ "$after" = "$replacement" ]
}

@test "SUP-RDV-11 FAIL: a tombstone-write failure during cleanup (non-writable parent directory) reports ok:false and exits 7, never ok:true" {
  local action_json argv_json owner_file owner_dir
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  owner_dir="$(dirname "$owner_file")"

  chmod 0500 "$owner_dir"
  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  chmod 0700 "$owner_dir"

  [ "$exit_code" -eq 7 ]
  grep -q '"ok":false' "$BG_OUT"
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"
  [ -f "$owner_file" ]
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-PID — ProcessIdentityProvider (point C.7: real OS process-birth,
# injectable double-gated seam, never a self-reported timestamp)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-PID-01 PASS: the default (production) ProcessIdentityProvider reports the REAL spawned process's own pid and a non-null OS-observed birth" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  run node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.exit((obj.pid_identity.pid === Number(process.argv[2]) && typeof obj.pid_identity.birth_observed_at === "string" && obj.pid_identity.birth_observed_at.length > 0) ? 0 : 1);
  ' "$owner_file" "$BG_PID"
  [ "$status" -eq 0 ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "BRIDGE-PID-02 PASS: an injected fake ProcessIdentityProvider (double capability gate) is reflected byte-exact in the role-owner record, never the real process's own identity" {
  local action_json argv_json owner_file fake_pid
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  fake_pid='{"pid":999999,"executable":"/fake/node","birth_observed_at":"Mon Jan  1 00:00:00 2001"}'
  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY="$fake_pid"
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  run node -e '
    const fs = require("fs");
    const obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = JSON.parse(process.argv[2]);
    // canonicalJSONStringify sorts keys on write -- compare field-by-field,
    // not a raw JSON.stringify string (key-order-dependent).
    const actual = obj.pid_identity;
    const ok = actual.pid === expected.pid && actual.executable === expected.executable && actual.birth_observed_at === expected.birth_observed_at;
    process.exit(ok ? 0 : 1);
  ' "$owner_file" "$fake_pid"
  [ "$status" -eq 0 ]

  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

# ══════════════════════════════════════════════════════════════════════════
# SUP-RDV-12+ -- minimum tests 5, 10, 11 (owner conflict after claim
# consumed, process-birth unprovable, REAL SIGTERM mid-acquisition)
# ══════════════════════════════════════════════════════════════════════════

@test "SUP-RDV-12 FAIL: an owner conflict AFTER the execution claim is already consumed terminalizes every affected binding -- never a hanging ACTION_REQUIRED (point B)" {
  # Roles claim in ARGV order (alphabetical): quality-gater FIRST, verifier
  # SECOND -- see SUP-RDV-08.
  local action_json argv_json owner_qg v_owner_path
  action_json="$(_mint_ready_action "quality-gater,verifier")"
  argv_json="$(_argv_from_action "$action_json")"

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS=1500
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY

  owner_qg="$(_wait_for_owner_file quality-gater)"
  [ -n "$owner_qg" ]
  [ -z "$(_owner_file verifier)" ]

  # Simulate a race winner claiming verifier's slot WHILE this same process
  # is still inside its deliberate inter-role delay -- proves the SECOND
  # claim in this process's own acquisition loop fails AFTER its execution
  # claim was already consumed (a legitimate fixture technique, not a
  # production code path).
  v_owner_path="$(dirname "$owner_qg")/verifier.json"
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[1], JSON.stringify({
      schema: "coordination/supervisor-rendezvous-role-owner/v1", coordination_root_id: "x",
      role: "verifier", rendezvous_instance_id: "f".repeat(32), supervisor_instance_id: "f".repeat(32),
      pid_identity: { pid: 1, executable: "/x", birth_observed_at: "x" },
    }), { mode: 0o600 });
  ' "$v_owner_path"

  _wait_for_pid_exit "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  [ "$exit_code" -eq 4 ]
  # quality-gater's own claim was rolled back -- never left owning a role
  # while its sibling in the SAME batch failed.
  [ -z "$(_owner_file quality-gater)" ]
  # The race winner's OWN (foreign) verifier record is untouched.
  [ -f "$v_owner_path" ]

  # Neither binding is left hanging in STARTING/REHYDRATING referencing a
  # now-dead (claim-consumed) action.
  run node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    for (const role of ["verifier", "quality-gater"]) {
      const profileDigest = rll.roleProfileDigestFor(role);
      const repoDescriptor = { repoId: action.repo_id };
      const state = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
      if (state.state === "STARTING" || state.state === "REHYDRATING") { process.stderr.write(role + " stuck in " + state.state); process.exit(1); }
    }
    process.exit(0);
  ' "$RLL" "$action_json"
  [ "$status" -eq 0 ]
}

@test "SUP-RDV-13 FAIL: process-birth unprovable rejects rc4 BEFORE claim consumption and BEFORE any owner write (point E)" {
  local action_json argv_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  argv_json="$(_argv_from_action "$action_json")"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  [ -f "$claim_path" ]

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x
  export RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY='{"pid":123,"executable":"/fake/node","birth_observed_at":""}'
  _run_bridge_argv_json "$argv_json"
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_FAKE_PROCESS_IDENTITY
  [ "$status" -eq 4 ]

  # The claim is UNTOUCHED (still ISSUED, never consumed) and no owner was ever written.
  run node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(o.execution_state === "ISSUED" ? 0 : 1);' "$claim_path"
  [ "$status" -eq 0 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "BRIDGE-WIN32-01 FAIL: on win32, session-run rejects rc4 BEFORE claim consumption and BEFORE any owner write -- no verified ACL/SID or Windows ProcessIdentityProvider exists yet (point D.3)" {
  local action_json argv_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  argv_json="$(_argv_from_action "$action_json")"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  [ -f "$claim_path" ]

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_PLATFORM=win32
  _run_bridge_argv_json "$argv_json"
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_TEST_PLATFORM
  [ "$status" -eq 4 ]

  # The claim is UNTOUCHED (still ISSUED, never consumed) and no owner was ever written.
  run node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(o.execution_state === "ISSUED" ? 0 : 1);' "$claim_path"
  [ "$status" -eq 0 ]
  [ -z "$(_owner_file verifier)" ]

  # An ordinary (non-win32) retry with the SAME action still succeeds --
  # this was rejected purely on the platform gate, before any other check.
  _start_bridge_bg "$argv_json" BG_OUT
  local owner_file
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

@test "SUP-RDV-14 FAIL: a REAL SIGTERM delivered mid-acquisition (not a substitute via owner conflict) rolls back the already-claimed role AND terminalizes the STATE of both bindings, never just the owner file (point 2, rewritten)" {
  # Roles claim in ARGV order (alphabetical): quality-gater FIRST, verifier
  # SECOND -- see SUP-RDV-08. The inter-role delay is now a REAL
  # event-loop-yielding setTimeout (point 2: async, never Atomics.wait --
  # the latter blocks the event loop, so Node could never actually run the
  # SIGTERM handler mid-wait, making the "mid-acquisition" claim vacuous).
  local action_json action_id argv_json owner_qg
  action_json="$(_mint_ready_action "quality-gater,verifier")"
  action_id="$(_action_field "$action_json" action_id)"
  argv_json="$(_argv_from_action "$action_json")"

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS=2000
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_ACQUISITION_DELAY_MS RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY

  owner_qg="$(_wait_for_owner_file quality-gater)"
  [ -n "$owner_qg" ]
  [ -z "$(_owner_file verifier)" ]

  # A genuine SIGTERM, not an owner-conflict substitute, while still inside
  # the deliberate inter-role delay (verifier not yet attempted) -- and
  # while the process is genuinely asleep on a real timer, not spinning.
  kill -TERM "$BG_PID"
  wait "$BG_PID" 2>/dev/null
  local exit_code=$?
  BG_PID=""

  # Shutdown handlers are live since BEFORE claim consumption (point 2) -- a
  # signal mid-loop is the ORDINARY owned-shutdown path (rc0), rolling back
  # whatever was claimed so far. This is DISTINCT from SUP-RDV-12/point B
  # (an owner CONFLICT after claim consumption, which is rc4) -- here
  # nothing conflicted, the operator simply asked the process to stop.
  [ "$exit_code" -eq 0 ]
  [ -z "$(_owner_file verifier)" ]
  [ -z "$(_owner_file quality-gater)" ]
  grep -q '"reason":"owned-shutdown"' "$BG_OUT"
  # The explicit phase state (point 2) is observably POST_CLAIM at the
  # moment of shutdown -- the claim WAS already consumed by this point in
  # the acquisition loop, never PRE_CLAIM.
  grep -q '"phase":"POST_CLAIM"' "$BG_OUT"

  # The STATE of BOTH role-bindings, not merely owner-file absence: neither
  # is left hanging in STARTING/REHYDRATING referencing the now-dead
  # (claim-consumed) action -- this is the exact gap the pre-rewrite version
  # of this test missed (installShutdownHandlers released owner files but
  # never called terminalizeSupervisorStartAction).
  run node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const repoDescriptor = { repoId: action.repo_id };
    for (const role of ["verifier", "quality-gater"]) {
      const profileDigest = rll.roleProfileDigestFor(role);
      const state = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
      if (state.state === "STARTING" || state.state === "REHYDRATING") { process.stderr.write(role + " stuck in " + state.state); process.exit(1); }
      if (state.state !== "UNAVAILABLE") { process.stderr.write(role + " expected UNAVAILABLE, got " + state.state); process.exit(1); }
    }
    process.exit(0);
  ' "$RLL" "$action_json"
  [ "$status" -eq 0 ]
}

@test "SUP-RDV-15 PASS: a SIGTERM delivered PRE_CLAIM (before the execution claim is consumed) exits cleanly WITHOUT terminalizing -- the claim and binding remain valid for a fresh retry (point 2, explicit pre-claim state)" {
  local action_json action_id claim_path argv_json
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  argv_json="$(_argv_from_action "$action_json")"

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_PRE_CLAIM_DELAY_MS=2000
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_PRE_CLAIM_DELAY_MS RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY

  # No owner file can exist yet (nothing was ever claimed) -- so unlike the
  # other SIGTERM tests, there is nothing to poll for; the fixed pause below
  # gives the background process ample time to complete every fast
  # synchronous pre-claim step (argv parse, identity, revalidation,
  # bindings-pend check, root confinement, singleton check) and land inside
  # the deliberate real (event-loop-yielding) pre-claim delay.
  sleep 0.3

  kill -TERM "$BG_PID"
  wait "$BG_PID" 2>/dev/null
  local exit_code=$?
  BG_PID=""

  [ "$exit_code" -eq 0 ]
  grep -q '"reason":"pre-claim-shutdown"' "$BG_OUT"
  grep -q '"phase":"PRE_CLAIM"' "$BG_OUT"
  [ -z "$(_owner_file verifier)" ]

  # The claim was NEVER consumed -- still ISSUED, exactly as a fresh retry
  # would need it.
  run node -e 'const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit(o.execution_state === "ISSUED" ? 0 : 1);' "$claim_path"
  [ "$status" -eq 0 ]

  # The role-binding is UNTOUCHED -- still STARTING, never prematurely
  # terminalized (terminalizing here would incorrectly foreclose the valid
  # retry the still-unconsumed claim allows).
  run node -e '
    const rll = require(process.argv[1]);
    const action = JSON.parse(process.argv[2]);
    const repoDescriptor = { repoId: action.repo_id };
    const profileDigest = rll.roleProfileDigestFor("verifier");
    const state = rll.readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, "verifier");
    process.exit(state.state === "STARTING" ? 0 : 1);
  ' "$RLL" "$action_json"
  [ "$status" -eq 0 ]

  # A FRESH session-run using the SAME still-valid claim now succeeds and
  # genuinely wins the owner record.
  _start_bridge_bg "$argv_json" BG_OUT
  local fresh_owner
  fresh_owner="$(_wait_for_owner_file verifier)"
  [ -n "$fresh_owner" ]
  kill -TERM "$BG_PID"; wait "$BG_PID" 2>/dev/null; BG_PID=""
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-MB -- minimum test 7: MainOrchestratorBinding resolution/validation
# on the execution claim (point D)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-MB-01 FAIL: a claim whose main_binding_id has been altered to an ABSENT binding is rejected -- independent re-resolution at CONSUMPTION time, not just at mint time (point D)" {
  local action_json action_id repo_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  repo_id="$(_action_field "$action_json" repo_id)"
  _corrupt_claim_field "$action_id" "$repo_id" main_binding_id '"ffffffffffffffffffffffffffffffff"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "BRIDGE-MB-02 FAIL: a claim whose main binding has since EXPIRED is rejected" {
  local minted action_json action_id binding_id binding_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  binding_path="$(_main_binding_path "$binding_id")"
  [ -f "$binding_path" ]
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.expiry="2000-01-01T00:00:00Z"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$binding_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

@test "BRIDGE-MB-03 FAIL: a claim whose main binding belongs to a DIFFERENT worktree (cross-scope) is rejected" {
  local minted action_json action_id binding_id binding_path
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  binding_path="$(_main_binding_path "$binding_id")"
  [ -f "$binding_path" ]
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.worktree_id="0".repeat(64); fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$binding_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-SHAPE -- minimum test 8: closed claim validation (NaN expiry, wrong
# state, extra key)
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-SHAPE-01 FAIL: a claim with a malformed (unparseable) expiry timestamp is rejected" {
  local action_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.expiry="not-a-date"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-SHAPE-02 FAIL: a claim with execution_state other than ISSUED is rejected" {
  local action_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.execution_state="CONSUMED"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-SHAPE-03 FAIL: a claim with an EXTRA unexpected key is rejected (closed key-set)" {
  local action_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e 'const fs=require("fs"); const o=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); o.unexpected_extra_field="x"; fs.writeFileSync(process.argv[1], JSON.stringify(o));' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-SHAPE-04 FAIL: a claim with created_at AFTER its own expiry is rejected" {
  local action_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.created_at = o.expiry;
    o.expiry = new Date(Date.parse(o.expiry) - 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    fs.writeFileSync(process.argv[1], JSON.stringify(o));
  ' "$claim_path"
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

# ══════════════════════════════════════════════════════════════════════════
# BRIDGE-DRIFT -- minimum test 9: action_id path/content mismatch, policy
# drift, expiry outside policy bound
# ══════════════════════════════════════════════════════════════════════════

@test "BRIDGE-DRIFT-01 FAIL: an action record whose OWN embedded action_id no longer matches its file path is rejected" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" action_id '"0000000000000000000000000000ff"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-DRIFT-02 FAIL: an action whose policy_digest no longer matches the CURRENT routing.json is rejected (policy drift)" {
  local action_json action_id
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  _corrupt_action_field "$action_id" policy_digest '"0000000000000000000000000000000000000000000000000000000000000000"'
  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
}

@test "BRIDGE-DRIFT-03 FAIL: an execution claim whose expiry exceeds the policy's own ready_timeout_seconds bound is never mintable (point D bounded expiry)" {
  # mintSupervisorExecutionClaim computes expiry = min(action.expires_at,
  # binding.expiry, now+ready_timeout_seconds) -- prove the MINTED claim's
  # expiry never exceeds now+ready_timeout_seconds, not a fixed constant.
  local minted action_json action_id binding_id claim_path ready_timeout expiry_ms now_ms
  minted="$(_mint_raw_action verifier)"
  action_json="${minted%$'\t'*}"
  binding_id="${minted##*$'\t'}"
  action_id="$(_action_field "$action_json" action_id)"
  _mint_execution_claim "$action_json" "$binding_id" >/dev/null
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"
  ready_timeout="$(node -e 'process.stdout.write(String(require(process.argv[1]).resolvePolicyPair(process.argv[2]).policy.ready_timeout_seconds))' "$RLL" "$PROJ")"
  run node -e '
    const fs = require("fs");
    const claim = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const readyTimeoutMs = Number(process.argv[2]) * 1000;
    const expiryMs = Date.parse(claim.expiry);
    const createdMs = Date.parse(claim.created_at);
    process.exit((expiryMs - createdMs) <= readyTimeoutMs + 1000 ? 0 : 1);
  ' "$claim_path" "$ready_timeout"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# LOCK -- minimum test 12: claim/cleanup interleaving under the shared
# per-role lock (point C.6)
# ══════════════════════════════════════════════════════════════════════════

@test "LOCK-01 FAIL: the SAME per-role lock directory genuinely excludes a concurrent claim/cleanup attempt -- a held lock is never silently bypassed (point C.6 interleaving)" {
  # withRegistryLock (runtime-role-lifecycle.cjs) is the SAME primitive
  # roleOwnerLockDirFor shares between claimRoleOwner and
  # releaseOwnedRoleOwner for a given role -- this proves the primitive
  # itself enforces real mutual exclusion (a directory already held is never
  # silently treated as free), which is what prevents claim-acquisition and
  # cleanup from ever interleaving a torn read/write for the SAME role.
  #
  # A live two-OS-process wall-clock race against this lock is deliberately
  # NOT attempted: production critical sections under it are sub-millisecond
  # by design (busy-spin retry, 2000 attempts, NO backoff sleep -- see
  # withRegistryLock's own comment), so artificially slowing a holder down
  # enough for a second real process to reliably land mid-hold would just
  # exhaust the waiter's spin budget and prove a timeout, not interleaving.
  # This is an honest black-box-testing limit, not an omission -- a
  # deterministic pre-held lock is the strongest same-process proof of the
  # exclusion guarantee available without changing production retry/backoff
  # behavior.
  local lock_dir
  lock_dir="$PROJ/.planning/coordination/lock-interleave-test.lock"
  rm -rf "$lock_dir" "${lock_dir}.entered"

  # A held lock (simulating another call currently inside its critical
  # section) must cause a concurrent attempt to fail closed, never silently
  # proceed as though unlocked.
  mkdir -p "$lock_dir"
  run node -e '
    const rll = require(process.argv[1]);
    const result = rll.withRegistryLock(process.argv[2], () => {
      require("fs").writeFileSync(process.argv[2] + ".entered", "x");
      return { ok: true };
    });
    process.exit(result && result.ok === false && result.reason === "lock-timeout" ? 0 : 1);
  ' "$RLL" "$lock_dir"
  [ "$status" -eq 0 ]
  # The callback body genuinely never ran while the lock was held.
  [ ! -f "${lock_dir}.entered" ]

  # Once released, a fresh attempt succeeds immediately and the callback DOES run.
  rmdir "$lock_dir"
  run node -e '
    const rll = require(process.argv[1]);
    const result = rll.withRegistryLock(process.argv[2], () => {
      require("fs").writeFileSync(process.argv[2] + ".entered", "x");
      return { ok: true };
    });
    process.exit(result && result.ok === true ? 0 : 1);
  ' "$RLL" "$lock_dir"
  [ "$status" -eq 0 ]
  [ -f "${lock_dir}.entered" ]
}

# ══════════════════════════════════════════════════════════════════════════
# TTL -- point 4: a tightened policy's ready_timeout_seconds genuinely bounds
# action/argv/claim expiry, never the old flat 120s constant
# ══════════════════════════════════════════════════════════════════════════

_set_ready_timeout_seconds() {
  local seconds="$1"
  node -e '
    const fs = require("fs");
    const p = require("path").join(process.argv[1], "scripts", "lib", "runtime-collaboration-policy.json");
    const o = JSON.parse(fs.readFileSync(p, "utf8"));
    o.ready_timeout_seconds = Number(process.argv[2]);
    fs.writeFileSync(p, JSON.stringify(o));
  ' "$PROJ" "$seconds"
}

@test "TTL-01 PASS: policy ready_timeout_seconds=10 bounds the action's own expiry, its embedded --session-expiry, AND the execution claim's expiry to <=10s from mint -- never the old flat 120s" {
  # 10s, not 1s: _mint_ready_action's OWN fixture overhead is two SEPARATE
  # real subprocess spawns (ensure, then fakeHostExecutorExecute) -- under a
  # loaded machine (e.g. running as part of the full suite) that combined
  # overhead can itself approach low-single-digit seconds, and a 1s bound
  # would flakily fail the claim mint on "no-positive-ttl-remaining" for a
  # reason having nothing to do with the bounding logic under test. 10s
  # keeps comfortable headroom while still being dramatically tighter than
  # the old flat 120s (12x, not "coincidentally under the ceiling").
  _set_ready_timeout_seconds 10
  local action_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"

  run node -e '
    const action = JSON.parse(process.argv[1]);
    const claim = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
    const argv = action.payload.bridge_argv;
    const sessionExpiry = argv[argv.indexOf("--session-expiry") + 1];
    // The action, its embedded --session-expiry, and the claim must all be
    // the EXACT SAME instant (point 4: never two independent now()s) --
    // and that instant must be tightly bounded by the 10s policy, with a
    // generous but finite tolerance for real mint-time elapsed wall clock
    // (never anywhere close to the old flat 120s).
    if (action.expires_at !== sessionExpiry) { process.stderr.write("action.expires_at != --session-expiry: " + action.expires_at + " vs " + sessionExpiry); process.exit(1); }
    const boundMs = Date.parse(action.expires_at) - Date.parse(claim.created_at);
    if (!(boundMs <= 15000)) { process.stderr.write("claim expiry " + boundMs + "ms after its own created_at -- not bounded by the 10s policy"); process.exit(1); }
    process.exit(0);
  ' "$action_json" "$claim_path"
  [ "$status" -eq 0 ]
}

@test "TTL-02 FAIL: under a tight 10s policy, a claim tampered to a much LATER expiry is rejected at consumption, never silently honored" {
  _set_ready_timeout_seconds 10
  local action_json action_id claim_path
  action_json="$(_mint_ready_action verifier)"
  action_id="$(_action_field "$action_json" action_id)"
  claim_path="$(_execution_claim_path "$action_id" "$(_action_field "$action_json" repo_id)")"

  # Tamper the claim to a expiry far beyond what the 1s policy could ever
  # bound (still <= the 120s ceiling and <= the action's own expires_at is
  # NOT true here -- this specifically exceeds the POLICY bound, the
  # narrowest of the three).
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.expiry = new Date(Date.parse(o.created_at) + 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    fs.writeFileSync(process.argv[1], JSON.stringify(o));
  ' "$claim_path"

  _run_bridge_argv_json "$(_argv_from_action "$action_json")"
  [ "$status" -eq 4 ]
  [ -z "$(_owner_file verifier)" ]
}

# ══════════════════════════════════════════════════════════════════════════
# CLEANUP -- point 6: cleanup re-validates the FULL owner record shape under
# the lock, never just the two instance ids
# ══════════════════════════════════════════════════════════════════════════

@test "CLEANUP-01 STOP: a MALFORMED owner record (extra key, matching instance ids) found at cleanup time is never touched/tombstoned -- rc7/STOP, never a silent ok:true skip (point 4)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  # Tamper the record to carry an EXTRA, unexpected key while leaving the
  # two instance ids (the ONLY thing the pre-correction cleanup checked)
  # untouched -- proves the fix validates the full closed shape, not merely
  # those two fields.
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.unexpected_extra_field = "x";
    fs.writeFileSync(process.argv[1], JSON.stringify(o), { mode: 0o600 });
  ' "$owner_file"
  local tampered
  tampered="$(cat "$owner_file")"

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # Point 4: a malformed record is never reasoned about as "probably a
  # replacement" -- it is not evidence of anything and must STOP, never a
  # silent ok:true skip.
  [ "$exit_code" -eq 7 ]
  grep -q '"ok":false' "$BG_OUT"
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # Untouched byte-for-byte at its ORIGINAL path, never moved to a
  # tombstone either -- a malformed record is exactly as untrustworthy as
  # a foreign one and must never be acted on at all.
  [ -f "$owner_file" ]
  local after
  after="$(cat "$owner_file")"
  [ "$after" = "$tampered" ]
}

@test "CLEANUP-02 STOP: an owner record with mismatched coordination_root_id (matching instance ids, otherwise well-formed) found at cleanup time is never touched/tombstoned -- rc7/STOP, not a legitimate replacement (point 4 full correlation)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.coordination_root_id = "0".repeat(64);
    fs.writeFileSync(process.argv[1], JSON.stringify(o), { mode: 0o600 });
  ' "$owner_file"
  local tampered
  tampered="$(cat "$owner_file")"

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # Point 4: matching instance ids but a mismatched coordination_root_id is
  # never a legitimate replacement (one would carry FRESH instance ids
  # too) -- ambiguous, STOP.
  [ "$exit_code" -eq 7 ]
  grep -q '"ok":false' "$BG_OUT"
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  [ -f "$owner_file" ]
  local after
  after="$(cat "$owner_file")"
  [ "$after" = "$tampered" ]
}

@test "CLEANUP-03 STOP: an owner record with a DIFFERENT pid_identity (matching instance ids, otherwise well-formed) found at cleanup time is never touched/tombstoned -- rc7/STOP, not a legitimate replacement (point 4 / point D.2 pid_identity correlation)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  # Tamper ONLY pid_identity -- every other field (including both instance
  # ids, which the ORIGINAL point-6 fix already checked) is left untouched.
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.pid_identity = { pid: 999999, executable: "/definitely/not/the/real/one", birth_observed_at: "Mon Jan  1 00:00:00 2001" };
    fs.writeFileSync(process.argv[1], JSON.stringify(o), { mode: 0o600 });
  ' "$owner_file"
  local tampered
  tampered="$(cat "$owner_file")"

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # Point 4: "pid_identity ambiguo => rc7/STOP, nunca rc0" -- matching
  # instance ids but a different pid_identity is never a legitimate
  # replacement, STOP.
  [ "$exit_code" -eq 7 ]
  grep -q '"ok":false' "$BG_OUT"
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # Untouched byte-for-byte -- a record whose pid_identity does not match
  # what THIS process itself minted is exactly as untrustworthy as one with
  # a wrong instance id and must never be acted on.
  [ -f "$owner_file" ]
  local after
  after="$(cat "$owner_file")"
  [ "$after" = "$tampered" ]
}

@test "CLEANUP-04 PASS: the owner path rebound to a DIFFERENT inode (same well-formed, correlated content) between read and the pre-unlink recheck is never touched -- quarantine/STOP instead (point D.2 TOCTOU-safe removal)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_PRE_UNLINK_DELAY_MS=1500
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_TEST_PRE_UNLINK_DELAY_MS
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  local original_ino
  original_ino="$(node -e 'process.stdout.write(String(require("fs").statSync(process.argv[1]).ino))' "$owner_file")"

  kill -TERM "$BG_PID"
  # While the signal handler's cleanup is deliberately paused (the test-only
  # delay above), rebind the path: unlink the original and recreate a
  # BYTE-IDENTICAL file at the SAME path -- a real fs.rename/replace would
  # produce a NEW inode even with unchanged content, exactly like a
  # concurrent non-lock-respecting writer would.
  local rebind_ino
  rebind_ino="$(node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const bytes = fs.readFileSync(p);
    fs.unlinkSync(p);
    fs.writeFileSync(p, bytes, { mode: 0o600 });
    process.stdout.write(String(fs.statSync(p).ino));
  ' "$owner_file")"
  [ "$rebind_ino" != "$original_ino" ]

  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # A rebind detected mid-cleanup is a genuine cleanup failure -- rc7, never
  # a silent ok:true past an unproven identity.
  [ "$exit_code" -eq 7 ]
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # The rebound (attacker/rebind-planted) file survives, untouched --
  # never destructively deleted without proving it is the SAME file that
  # was credited.
  [ -f "$owner_file" ]
  local after_ino
  after_ino="$(node -e 'process.stdout.write(String(require("fs").statSync(process.argv[1]).ino))' "$owner_file")"
  [ "$after_ino" = "$rebind_ino" ]
}

@test "CLEANUP-06 PASS: a rebind BEFORE the final pre-unlink identity check (strictly AFTER the tombstone copy is ALREADY durable) is caught by that check; the rebound file is left COMPLETELY untouched (never moved/restored, since it was never touched to begin with), and OUR OWN data already survives safely in the tombstone regardless. HONESTY NOTE (R4 round 3, round 4 correction, finding 3): this proves a rebind BEFORE the check, not the genuinely irreducible lstat->unlink gap itself (a few CPU instructions, with no POSIX atomic-unlink-iff-identity-matches primitive) -- that narrower gap is covered by the cooperative lock contract (withRegistryLock), not by any check-based mechanism, and is not what this test exercises (R4 round 2, point 6)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_POST_STAT_PRE_RENAME_DELAY_MS=1500
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_TEST_POST_STAT_PRE_RENAME_DELAY_MS
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  local original_ino original_bytes original_supervisor_id
  original_ino="$(node -e 'process.stdout.write(String(require("fs").statSync(process.argv[1]).ino))' "$owner_file")"
  original_bytes="$(cat "$owner_file")"
  original_supervisor_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).supervisor_instance_id)' "$owner_file")"

  kill -TERM "$BG_PID"
  # By the time THIS delay is reached, the tombstone copy of OUR OWN
  # original bytes is ALREADY durable (publishNoClobber already returned
  # success). The delay fires BEFORE fs.lstatSync is even called, so this
  # rebind is observed by the VERY NEXT lstat call -- a real window, but
  # NOT the genuinely irreducible lstat-return-to-unlink-execute gap (that
  # narrower window has no check-based coverage at all; see the source
  # comment at the pre-unlink check for what actually protects it).
  local rebind_ino
  rebind_ino="$(node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const bytes = fs.readFileSync(p);
    fs.unlinkSync(p);
    fs.writeFileSync(p, bytes, { mode: 0o600 });
    process.stdout.write(String(fs.statSync(p).ino));
  ' "$owner_file")"
  [ "$rebind_ino" != "$original_ino" ]

  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # Caught by the pre-unlink recheck, reported as a genuine cleanup
  # failure -- rc7, never a silent ok:true past an unproven removal.
  [ "$exit_code" -eq 7 ]
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # The rebound (foreign/attacker-planted) file is left COMPLETELY
  # untouched -- never unlinked, never overwritten, never "restored"
  # (nothing was ever moved away from it in the first place). The inode
  # is the only signal that can distinguish this from a restore, since
  # the rebind step deliberately writes byte-identical content to a new
  # inode -- so the identity check must be inode-based, not content-based.
  [ -f "$owner_file" ]
  local after_ino
  after_ino="$(node -e 'process.stdout.write(String(require("fs").statSync(process.argv[1]).ino))' "$owner_file")"
  [ "$after_ino" = "$rebind_ino" ]

  # OUR OWN original data survives, safely, in the tombstone -- written
  # BEFORE the rebind was even possible, genuinely independent of it.
  local tombstone_dir tombstone_file
  tombstone_dir="$(dirname "$owner_file")/.tombstone"
  tombstone_file="${tombstone_dir}/verifier.json.${original_supervisor_id}"
  [ -f "$tombstone_file" ]
  local tombstoned_bytes
  tombstoned_bytes="$(cat "$tombstone_file")"
  [ "$tombstoned_bytes" = "$original_bytes" ]
}

@test "CLEANUP-07 PASS: a pre-planted symlink at the .tombstone directory path is rejected (never followed/adopted) -- cleanup fails closed through the SAME hardened directory primitive every other host-private registry directory uses (R4 round 2, point 5)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  local tombstone_dir outside_target
  tombstone_dir="$(dirname "$owner_file")/.tombstone"
  outside_target="$(mktemp -d)"
  ln -s "$outside_target" "$tombstone_dir"
  [ -L "$tombstone_dir" ]

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # A symlinked tombstone directory is rejected outright -- rc7, never
  # silently followed into an attacker-controlled/unrelated location.
  [ "$exit_code" -eq 7 ]
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # The symlink itself is untouched (never replaced/followed), and nothing
  # was ever written through it into outside_target.
  [ -L "$tombstone_dir" ]
  local outside_contents
  outside_contents="$(find "$outside_target" -mindepth 1 2>/dev/null)"
  [ -z "$outside_contents" ]

  # The live owner record survives untouched -- a rejected tombstone-dir
  # setup must never fall back to destructively deleting the original.
  [ -f "$owner_file" ]

  rm -rf "$outside_target"
  rm -f "$tombstone_dir"
}

@test "CLEANUP-08 FAIL: a pre-existing file already sitting at the exact tombstone destination path is NEVER clobbered -- it survives byte-identical, the write fails closed (rc7), and the LIVE owner record is left untouched too since a failed tombstone step must never fall through to removal (R4 round 3, block 3: no-clobber)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]
  local supervisor_id tombstone_dir tombstone_file sentinel_bytes owner_bytes
  supervisor_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).supervisor_instance_id)' "$owner_file")"
  tombstone_dir="$(dirname "$owner_file")/.tombstone"
  tombstone_file="${tombstone_dir}/verifier.json.${supervisor_id}"
  owner_bytes="$(cat "$owner_file")"

  # Pre-plant a SENTINEL at the EXACT (supervisor_instance_id-namespaced)
  # destination the no-clobber tombstone write will target -- this is the
  # concrete "un destino preexistente" scenario: something already lives at
  # this path before cleanup ever runs, e.g. a stale artifact from a prior
  # crash-mid-cleanup or an adversarial plant.
  mkdir -p "$tombstone_dir"
  chmod 0700 "$tombstone_dir"
  sentinel_bytes='{"sentinel":"pre-existing-do-not-clobber"}'
  printf '%s' "$sentinel_bytes" > "$tombstone_file"
  chmod 0600 "$tombstone_file"

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # publishNoClobber's own atomic no-clobber write fails closed against the
  # pre-existing SENTINEL (AUTHORITY_INVALID -> tombstone-already-exists) --
  # rc7, never a silent overwrite-then-succeed.
  [ "$exit_code" -eq 7 ]
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # The SENTINEL survives byte-identical -- never clobbered.
  local after_sentinel
  after_sentinel="$(cat "$tombstone_file")"
  [ "$after_sentinel" = "$sentinel_bytes" ]

  # Since the tombstone step itself failed (strictly before the unlink is
  # ever reached), the LIVE owner record must ALSO survive, untouched --
  # a failed tombstone write must never fall through to removing the
  # original anyway.
  [ -f "$owner_file" ]
  local after_owner
  after_owner="$(cat "$owner_file")"
  [ "$after_owner" = "$owner_bytes" ]
}

@test "CLEANUP-09 FAIL: ownerPath rebound to a genuinely DIFFERENT, well-formed owner record (not merely a same-content new inode) strictly AFTER the tombstone copy is already durable is NEVER removed -- a new owner's live claim is never silently destroyed to complete someone else's cleanup (R4 round 3, block 3: nunca reemplazar un owner nuevo)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"

  export NODE_ENV=test RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY=x RUNTIME_BRIDGE_CODEX_TEST_POST_STAT_PRE_RENAME_DELAY_MS=1500
  _start_bridge_bg "$argv_json" BG_OUT
  unset RUNTIME_BRIDGE_CODEX_TEST_CAPABILITY RUNTIME_BRIDGE_CODEX_TEST_POST_STAT_PRE_RENAME_DELAY_MS
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  kill -TERM "$BG_PID"
  # By the time this delay is reached, the tombstone copy of the ORIGINAL
  # claim's bytes is already durable. Now simulate a genuinely NEW,
  # unrelated supervisor legitimately claiming this exact role path in the
  # interim (fresh instance ids, fresh pid_identity, otherwise well-formed)
  # -- distinct from CLEANUP-04/06's same-content rebind, this proves the
  # safety property holds even when the content is a real, different,
  # well-formed claim, not just a new inode.
  local new_supervisor_id new_bytes
  new_supervisor_id="$(node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const o = JSON.parse(fs.readFileSync(p, "utf8"));
    o.supervisor_instance_id = "a".repeat(32);
    o.rendezvous_instance_id = "b".repeat(32);
    o.pid_identity = { pid: 424242, executable: "/some/other/genuinely-new/supervisor", birth_observed_at: "Tue Jan  2 00:00:00 2001" };
    fs.unlinkSync(p);
    fs.writeFileSync(p, JSON.stringify(o), { mode: 0o600 });
    process.stdout.write(o.supervisor_instance_id);
  ' "$owner_file")"
  new_bytes="$(cat "$owner_file")"
  [ "$new_supervisor_id" = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ]

  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # The pre-unlink identity recheck is inode-based (not content-based), so
  # it catches this exactly like a same-content rebind -- reported as a
  # genuine cleanup failure, never a silent ok:true past an unproven
  # removal of a claim that was never ours to release.
  [ "$exit_code" -eq 7 ]
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # The new owner's live record survives, completely untouched -- never
  # unlinked, never overwritten, never "reclaimed" on the old claim's
  # behalf.
  [ -f "$owner_file" ]
  local after_bytes
  after_bytes="$(cat "$owner_file")"
  [ "$after_bytes" = "$new_bytes" ]
}

@test "CLEANUP-10 STOP: an owner record whose supervisor_instance_id is corrupted to a non-hex-shaped value is rejected as owner-record-shape-invalid (STOP, rc7) -- NOT silently reasoned about as merely-a-different-legitimate-owner (which would exit 0 and leave it untouched as 'replaced'); a malformed value is not evidence of anything and must never fall into the benign-mismatch path (R4 round 3, block 3: shape closure)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  # Tamper ONLY supervisor_instance_id to a CORRUPTED, non-hex-shaped value
  # (uppercase + punctuation) -- necessarily also DIFFERENT from what this
  # process itself expects, which is the ONLY axis where shape-checking
  # genuinely changes the externally observable outcome: without it, a
  # mismatched instance id is treated as an ordinary, benign replacement
  # (exit 0, left untouched, "replaced"); a well-shaped-but-different value
  # is correctly indistinguishable from a genuine other supervisor. But a
  # value that is not even HEX-shaped is not a plausible instance id at
  # all -- it is corruption -- and must be reported as a genuine failure
  # (exit 7), never silently folded into the "someone else's, skip"
  # outcome. role/coordination_root_id are NOT usable to observe this
  # distinction end-to-end: the real caller always supplies
  # expectedRole/expectedCoordinationRootId, so any mismatch on those two
  # is caught by the pre-existing correlation check regardless of the
  # shape check, collapsing to the SAME rc7/cleanup-failed either way --
  # this is genuine, correctly-redundant defense-in-depth for those two
  # fields (relevant to callers that omit the optional expected* params),
  # just not independently observable through THIS end-to-end caller.
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.supervisor_instance_id = "NOT-HEX-!!!-CORRUPTED-VALUE-ZZ";
    fs.writeFileSync(process.argv[1], JSON.stringify(o), { mode: 0o600 });
  ' "$owner_file"
  local tampered
  tampered="$(cat "$owner_file")"

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  # A structurally malformed instance id is not evidence of anything --
  # never reasoned about as "probably a legitimate replacement", STOP.
  [ "$exit_code" -eq 7 ]
  grep -q '"ok":false' "$BG_OUT"
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # Untouched byte-for-byte, never moved to a tombstone either.
  [ -f "$owner_file" ]
  local after
  after="$(cat "$owner_file")"
  [ "$after" = "$tampered" ]

  # No tombstone was ever created for this malformed record -- the write
  # never even reaches the tombstone step.
  local tombstone_dir leftover
  tombstone_dir="$(dirname "$owner_file")/.tombstone"
  if [ -d "$tombstone_dir" ]; then
    leftover="$(find "$tombstone_dir" -name 'verifier.json.*' 2>/dev/null)"
    [ -z "$leftover" ]
  fi
}

@test "CLEANUP-11 STOP: an owner record whose coordination_root_id is well-formed hex but the WRONG LENGTH for a genuine sha256 digest (40-hex, not 64) is never silently accepted -- rc7, never a legitimate-replacement skip. NOTE: this overall safety property is proven defense-in-depth here (the pre-existing correlation-mismatch check independently also rejects it), not an isolated proof of the shape check alone -- that isolated proof lives at the unit level (isHexDigest64's own test) and at the grant-validation level (validateAndConsumeLifecycleCommandGrant's worktree_id/plan_digest test), where a genuinely UNIQUE failure mode (both sides wrong-length AND matching) is reachable and empirically RED-proven (R4 round 3, block 2d)" {
  local action_json argv_json owner_file
  action_json="$(_mint_ready_action verifier)"
  argv_json="$(_argv_from_action "$action_json")"
  _start_bridge_bg "$argv_json" BG_OUT
  owner_file="$(_wait_for_owner_file verifier)"
  [ -n "$owner_file" ]

  # Tamper coordination_root_id to well-formed hex, but 40 characters --
  # neither the correct 64-hex digest this call expects NOR a plausible
  # generated-id-shaped value; both instance ids left matching so THAT
  # correlation check doesn't fire first. The coordination_root_id
  # correlation check (current.coordination_root_id !== expected) DOES
  # still independently catch this specific tampering as a fallback if the
  # shape check were ever removed -- see the NOTE above.
  node -e '
    const fs = require("fs");
    const o = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    o.coordination_root_id = "f".repeat(40);
    fs.writeFileSync(process.argv[1], JSON.stringify(o), { mode: 0o600 });
  ' "$owner_file"
  local tampered
  tampered="$(cat "$owner_file")"

  kill -TERM "$BG_PID"
  local exit_code=0
  wait "$BG_PID" 2>/dev/null || exit_code=$?
  BG_PID=""
  [ "$exit_code" -eq 7 ]
  grep -q '"ok":false' "$BG_OUT"
  grep -q '"reason":"cleanup-failed"' "$BG_OUT"

  # Untouched byte-for-byte, never moved to a tombstone either -- whether
  # caught by the shape check or (as defense in depth) the correlation
  # check that would ALSO reject a mismatched coordination_root_id, a
  # wrong-length value is never silently accepted as evidence of anything.
  [ -f "$owner_file" ]
  local after
  after="$(cat "$owner_file")"
  [ "$after" = "$tampered" ]
}
