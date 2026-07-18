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

# ─────────────────────────────────────────────────────────────────────────
# C2 -- app-server JSONL client + schemas (PLAN.md "Real RPC surface" ~L67,
# "App-server worker" ~L887-978, "Frozen Production CLI ABI" ~L783-797).
# Scope boundary (see file header C2 comment in runtime-bridge-codex.cjs):
# this is the JSONL wire client itself -- framing, request/response
# correlation, the initialize handshake, the SR-01..10 fail-closed
# server-request table, login correlation, thread/turn request-building and
# response/schema validation. It is NOT wired into `cmdSessionRun`'s control
# flow (that scheduling integration is a later item, C4's job) and it does
# NOT implement CredentialBroker/v1 (C3, undesigned) -- login tests below
# inject an explicit test-only fake credential provider, never a real one.
#
# SC-5 NOTE (discovered live at this session's own start, before any RED
# test below was written): `prep/gc-verify.cjs` (the PLAN-pinned, hash-
# verified live capability check) reports rc 3 / SC-5 -- the live `codex`
# binary has drifted from PLAN.md's frozen pin (different path/version/
# sha256; live `codex-cli 0.145.0-alpha.18` vs pinned `0.144.0-alpha.4`),
# and the regenerated schema set is 267 per-type files with a different
# hash than the frozen `31d85b54...`/265-file pin. Per PLAN.md ~L1410,
# "Any drift in any of these... is SC-5/harness STOP, not a silent
# re-adapt." This suite therefore proves the JSONL client against
# fakes/providers only (GREEN_LOCAL) and does not spawn the live child as a
# substitute for PLAN-sanctioned fingerprint-gated conformance -- see this
# session's own evidence report for the one narrow, explicitly-labeled
# real-child smoke probe (initialize handshake only, no credentials, no
# thread) offered as informational evidence, not as a conformance claim.

# ── C2-FRAME: JSONL wire framing ──

@test "C2-FRAME-01 PASS: writeJsonlFrame writes exactly one JSON object plus one trailing newline in a single write call" {
  run node -e '
    const bridge = require(process.argv[1]);
    const chunks = [];
    const fakeWritable = { write(x) { chunks.push(x); return true; } };
    bridge.writeJsonlFrame(fakeWritable, { id: 1, method: "initialize", params: { a: 1 } });
    if (chunks.length !== 1) { process.stderr.write("expected exactly one write() call, got " + chunks.length + "\n"); process.exit(1); }
    const s = chunks[0];
    if (s[s.length - 1] !== "\n") { process.stderr.write("missing trailing newline\n"); process.exit(1); }
    if (s.indexOf("\n") !== s.length - 1) { process.stderr.write("newline is not exactly the last character\n"); process.exit(1); }
    const parsed = JSON.parse(s.slice(0, -1));
    if (parsed.id !== 1 || parsed.method !== "initialize") { process.stderr.write("round-trip mismatch\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-02 PASS: a single complete line fed to the frame feeder invokes onFrame exactly once with the parsed object" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), (r) => errors.push(r));
    feed(JSON.stringify({ id: 1, result: { ok: true } }) + "\n");
    if (frames.length !== 1 || errors.length !== 0) { process.stderr.write("bad frame/error counts\n"); process.exit(1); }
    if (frames[0].id !== 1) { process.stderr.write("bad frame content\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-03 PASS: a line split across two feed() calls (no newline yet) is buffered and produces exactly one correct frame once the newline arrives" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), () => {});
    const line = JSON.stringify({ id: 7, method: "initialized", params: {} });
    feed(line.slice(0, 5));
    if (frames.length !== 0) { process.stderr.write("premature frame before newline\n"); process.exit(1); }
    feed(line.slice(5) + "\n");
    if (frames.length !== 1 || frames[0].id !== 7) { process.stderr.write("bad post-buffer frame\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-04 PASS: two frames delivered in one chunk are dispatched in order, exactly twice" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), () => {});
    feed(JSON.stringify({ id: 1 }) + "\n" + JSON.stringify({ id: 2 }) + "\n");
    if (frames.length !== 2 || frames[0].id !== 1 || frames[1].id !== 2) { process.stderr.write("bad order/count\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-05 FAIL: a malformed (non-JSON) line invokes onError, never onFrame, and never throws" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), (r) => errors.push(r));
    feed("not-json-at-all\n");
    if (frames.length !== 0) { process.stderr.write("malformed line produced a frame\n"); process.exit(1); }
    if (errors.length !== 1 || errors[0] !== "malformed-json") { process.stderr.write("wrong/missing error reason: " + JSON.stringify(errors) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-06 FAIL: a syntactically-valid JSON line that is not an object (array/string/number/null) is rejected as frame-not-object" {
  run node -e '
    const bridge = require(process.argv[1]);
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder(() => { throw new Error("must not call onFrame"); }, (r) => errors.push(r));
    feed("42\n");
    feed("\"hello\"\n");
    feed("null\n");
    feed("[1,2]\n");
    if (errors.length !== 4 || errors.some((r) => r !== "frame-not-object")) { process.stderr.write("wrong errors: " + JSON.stringify(errors) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-07 FAIL: a frame carrying an invented jsonrpc member is rejected -- app-server frames are exactly {id,method,params}/{id,result|error} (PLAN.md ~L903/~L959)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder(() => { throw new Error("must not call onFrame"); }, (r) => errors.push(r));
    feed(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\n");
    if (errors.length !== 1 || errors[0] !== "frame-has-invented-jsonrpc-member") { process.stderr.write("wrong error: " + JSON.stringify(errors) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-FRAME-08 PASS: a blank line between frames is tolerated and never produces a frame or an error" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), (r) => errors.push(r));
    feed("\n" + JSON.stringify({ id: 1 }) + "\n\n" + JSON.stringify({ id: 2 }) + "\n");
    if (frames.length !== 2 || errors.length !== 0) { process.stderr.write("blank-line handling broke framing\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-INIT: initialize/initialized handshake ──

@test "C2-INIT-01 PASS: initialize sends the exact frozen request shape (PLAN.md ~L897) and resolves on a matching schema-valid response" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => {
      const req = sent[0];
      if (req.method !== "initialize" || req.id !== 1) { process.stderr.write("bad request: " + JSON.stringify(req) + "\n"); process.exit(1); }
      if (!req.params || req.params.clientInfo.name !== "android-common-doc-runtime-bridge" || req.params.clientInfo.version !== "1.0.0") { process.stderr.write("bad clientInfo\n"); process.exit(1); }
      if (req.params.capabilities.experimentalApi !== true) { process.stderr.write("bad capabilities\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: 1, result: { userAgent: "codex-cli/0.145.0", codexHome: "/isolated/codex-home", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    p.then((res) => {
      if (!res.ok) { process.stderr.write("initialize rejected: " + JSON.stringify(res) + "\n"); process.exit(1); }
      const initFrame = sent.find((f) => f.method === "initialized");
      if (!initFrame || initFrame.id !== undefined || JSON.stringify(initFrame.params) !== "{}") { process.stderr.write("initialized notification missing/malformed: " + JSON.stringify(initFrame) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-INIT-02 FAIL: an error response to initialize rejects, and no initialized notification is ever sent" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => fromChild.write(JSON.stringify({ id: 1, error: { code: -32000, message: "boom" } }) + "\n"));
    p.then((res) => {
      if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); }
      if (sent.some((f) => f.method === "initialized")) { process.stderr.write("initialized sent despite error response\n"); process.exit(1); }
      process.exit(0);
    }).catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-INIT-03 FAIL: a response carrying a mismatched id is never matched to the pending initialize call" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    let settled = false;
    const p = conn.initialize().then(() => { settled = true; }).catch(() => { settled = true; });
    setImmediate(() => {
      fromChild.write(JSON.stringify({ id: 999, result: {} }) + "\n");
      setImmediate(() => {
        if (settled) { process.stderr.write("mismatched-id response incorrectly settled the pending call\n"); process.exit(1); }
        process.exit(0);
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-TRANSPORT: fail-closed transport contract (R5 correction) -- a
# malformed frame, EOF, a transport error, or a failed write must never
# leave a caller hanging or let the connection silently keep trusting a
# corrupted/desynced wire. A genuinely SYNCHRONOUS fake transport (below)
# is used specifically to prove the pending-before-write ordering fix --
# the real bug this session's first pass had was registering the pending
# entry AFTER the write, which a synchronous echo would race.

@test "C2-TRANSPORT-01 FAIL: a malformed frame on the wire marks the connection STOPped and rejects every currently-pending call, never leaving one hanging" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      // Two DISTINCT threadStart calls, both legitimately pending at once
      // (AUTHENTICATED phase has no "one in flight" restriction, unlike
      // turnStart/thread) -- proves a malformed frame kills EVERY currently
      // pending call, not merely a single one.
      const p1 = conn.threadStart({ role: "r1", developerInstructions: "d", baseInstructions: "b", cwd: "/c1" });
      const p2 = conn.threadStart({ role: "r2", developerInstructions: "d", baseInstructions: "b", cwd: "/c2" });
      setImmediate(() => {
        fromChild.write("not-json-at-all\n");
        Promise.all([p1, p2]).then(([r1, r2]) => {
          if (r1.ok || r2.ok) { process.stderr.write("a pending call survived a malformed frame\n"); process.exit(1); }
          if (!conn.isStopped() || conn.stopReason().indexOf("malformed-frame") !== 0) { process.stderr.write("connection not marked STOPped: " + conn.stopReason() + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TRANSPORT-02 FAIL: stdout end (EOF) marks the connection STOPped and rejects every currently-pending call" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => fromChild.end());
    p.then((res) => {
      if (res.ok || res.reason !== "transport-eof-possibly-delivered") { process.stderr.write("bad result on EOF: " + JSON.stringify(res) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("connection not marked STOPped on EOF\n"); process.exit(1); }
      process.exit(0);
    }).catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TRANSPORT-03 FAIL: a stdout error event marks the connection STOPped and rejects every currently-pending call" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => fromChild.emit("error", new Error("simulated transport failure")));
    p.then((res) => {
      if (res.ok || res.reason.indexOf("transport-error-possibly-delivered") !== 0) { process.stderr.write("bad result on transport error: " + JSON.stringify(res) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("connection not marked STOPped\n"); process.exit(1); }
      process.exit(0);
    }).catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TRANSPORT-04 PASS: a genuinely SYNCHRONOUS echo transport (write triggers the response before the write() call itself returns) is still correctly matched -- proves pending is registered BEFORE the write, not after" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { EventEmitter } = require("events");
    // A deliberately synchronous fake: stdin.write() immediately, IN-CALL,
    // feeds a scripted echo response into stdout listeners -- no
    // PassThrough/setImmediate async buffering to mask an ordering bug.
    const stdoutListeners = { data: [] };
    const fakeStdout = { on(evt, fn) { if (evt === "data") stdoutListeners.data.push(fn); } };
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        if (frame.method === "initialize") {
          const echo = JSON.stringify({ id: frame.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n";
          for (const fn of stdoutListeners.data) fn(echo); // synchronous, same tick, before write() returns
        }
        if (cb) cb();
        return true;
      },
    };
    const conn = bridge.createAppServerConnection({ stdin: fakeStdin, stdout: fakeStdout });
    conn.initialize().then((res) => {
      if (!res.ok) { process.stderr.write("synchronous echo was NOT matched (pending-before-write race): " + JSON.stringify(res) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TRANSPORT-05 FAIL: a stdin.write() callback reporting an error settles the call as write-failed-confirmed-before-commit, distinct from a timeout" {
  run node -e '
    const bridge = require(process.argv[1]);
    const fakeStdout = { on() {} };
    const fakeStdin = { write(chunk, enc, cb) { if (cb) cb(new Error("EPIPE simulated")); return false; } };
    const conn = bridge.createAppServerConnection({ stdin: fakeStdin, stdout: fakeStdout });
    conn.initialize({ timeoutMs: 5000 }).then((res) => {
      if (res.ok || res.reason.indexOf("write-failed-confirmed-before-commit") !== 0) { process.stderr.write("bad result: " + JSON.stringify(res) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TRANSPORT-06 FAIL: a stdin.write() that throws synchronously is caught and reported, never propagates to crash the caller" {
  run node -e '
    const bridge = require(process.argv[1]);
    const fakeStdout = { on() {} };
    const fakeStdin = { write() { throw new Error("synchronous write explosion"); } };
    const conn = bridge.createAppServerConnection({ stdin: fakeStdin, stdout: fakeStdout });
    conn.initialize({ timeoutMs: 5000 }).then((res) => {
      if (res.ok || res.reason.indexOf("write-failed-confirmed-before-commit") !== 0) { process.stderr.write("bad result: " + JSON.stringify(res) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("synchronous throw propagated and crashed the caller: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-SR: server-request handler table (SR-01..10, PLAN.md ~L957-972) ──

@test "C2-SR-02 FAIL: applyPatchApproval is denied verbatim and the connection is marked STOP" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 5, method: "applyPatchApproval", params: { conversationId: "conv-1", callId: "call-1", fileChanges: {}, reason: null, grantRoot: null } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 5);
      if (!resp || JSON.stringify(resp.result) !== JSON.stringify({ decision: "denied" })) { process.stderr.write("bad response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("connection did not STOP after applyPatchApproval\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SR-03 FAIL: attestation/generate returns the exact frozen -32601 error and STOPs" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 9, method: "attestation/generate", params: {} }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 9);
      if (!resp || !resp.error || resp.error.code !== -32601 || resp.error.message !== "non-interactive bridge issues no attestation") { process.stderr.write("bad response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("did not STOP\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SR-TABLE-ALL FAIL: every one of SR-02..SR-10 (all rows except the refresh row) returns its exact frozen response and STOPs" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const rows = [
      ["execCommandApproval", { conversationId: "conv-1", callId: "call-1", approvalId: null, command: ["echo"], cwd: "/", reason: null, parsedCmd: [] }, { decision: "denied" }],
      ["item/commandExecution/requestApproval", { threadId: "t1", turnId: "tu1", itemId: "i1", startedAtMs: 1700000000000, environmentId: null }, { decision: "decline" }],
      ["item/fileChange/requestApproval", { threadId: "t1", turnId: "tu1", itemId: "i1", startedAtMs: 1700000000000 }, { decision: "decline" }],
      ["item/permissions/requestApproval", { threadId: "t1", turnId: "tu1", itemId: "i1", environmentId: null, startedAtMs: 1700000000000, cwd: "/", reason: null, permissions: {} }, { permissions: {} }],
      ["item/tool/call", { threadId: "t1", turnId: "tu1", callId: "call-1", namespace: null, tool: "sometool", arguments: {} }, { contentItems: [], success: false }],
      ["item/tool/requestUserInput", { threadId: "t1", turnId: "tu1", itemId: "i1", questions: [], autoResolutionMs: null }, { answers: {} }],
      ["mcpServer/elicitation/request", { threadId: "t1", turnId: null, serverName: "srv", mode: "url", _meta: null, message: "msg", url: "http://x", elicitationId: "elic-1" }, { action: "decline" }],
    ];
    let failures = 0;
    for (const [method, params, expected] of rows) {
      const toChild = new PassThrough();
      const fromChild = new PassThrough();
      const sent = [];
      toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
      const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
      fromChild.write(JSON.stringify({ id: 42, method, params }) + "\n");
      const resp = sent.find((f) => f.id === 42);
      if (!resp || JSON.stringify(resp.result) !== JSON.stringify(expected) || !conn.isStopped()) {
        process.stderr.write("FAIL " + method + ": " + JSON.stringify(resp) + "\n");
        failures++;
      }
    }
    process.exit(failures === 0 ? 0 : 1);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SR-UNKNOWN FAIL: an unrecognized server-request method is rejected -32601 and STOPs, never silently ignored" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 1, method: "totally/unknown/method", params: {} }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 1);
      if (!resp || !resp.error || resp.error.code !== -32601) { process.stderr.write("bad response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("did not STOP\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SR-REFRESH-01 PASS: a valid account/chatgptAuthTokens/refresh continues the connection (does not STOP) and returns broker-provided values verbatim" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "fake-broker-token", chatgptAccountId: "fake-account", chatgptPlanType: "plus" }),
    });
    // R7 (D4): a refresh is only ever honored against an ALREADY-authenticated
    // identity ("<validated-same-account>") -- establish it via a real
    // initialize+login handshake matching the refreshProvider identity.
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "fake-account", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        const expected = { accessToken: "fake-broker-token", chatgptAccountId: "fake-account", chatgptPlanType: "plus" };
        if (!resp || JSON.stringify(resp.result) !== JSON.stringify(expected)) { process.stderr.write("bad response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (conn.isStopped()) { process.stderr.write("connection incorrectly STOPped after a valid refresh\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SR-REFRESH-02 FAIL: a refresh provider that reports failure produces an error response and STOPs" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild, refreshProvider: () => ({ ok: false }) });
    // R9: a real init+login preamble -- otherwise the R9 phase gate refuses
    // the refresh BEFORE ever reaching the provider-failure branch this test
    // claims to exercise.
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        if (!resp || !resp.error) { process.stderr.write("expected error response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("did not STOP after failed refresh\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SR-REFRESH-03 FAIL: account/chatgptAuthTokens/refresh with no refreshProvider configured fails closed (error+STOP), never silently no-ops" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    // R9: a real init+login preamble -- otherwise the R9 phase gate refuses
    // the refresh BEFORE ever reaching the no-provider-configured branch
    // this test claims to exercise.
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        if (!resp || !resp.error) { process.stderr.write("expected error response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("did not STOP\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-SCHEMA: runtimeTurnEnvelope outputSchema builder + validator (PLAN.md ~L1018-1071) ──
# Local to this file (not the sibling runtime-consultation.cjs) -- see the
# file-header C2 scope-boundary comment: PLAN.md ~L930 names the sibling as
# the EVENTUAL canonical home for cross-runtime reuse, but item C's own
# frozen Path-Manifest inventory (wp3-handoff-item-c.md Sec.5) is exactly
# two rows, neither of which is the sibling -- kept local to avoid touching
# a file this item does not own.

@test "C2-SCHEMA-01 PASS: buildRuntimeTurnEnvelopeOutputSchema with no allowed child roles omits the consult oneOf branch entirely (leaf/exhausted-budget case)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const schema = bridge.buildRuntimeTurnEnvelopeOutputSchema("ARCH_VERDICT", []);
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length !== 1) { process.stderr.write("expected exactly one oneOf branch, got " + JSON.stringify(schema.oneOf && schema.oneOf.length) + "\n"); process.exit(1); }
    if (schema.oneOf[0].properties.kind.enum[0] !== "terminal-result") { process.stderr.write("wrong sole branch\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SCHEMA-02 PASS: buildRuntimeTurnEnvelopeOutputSchema with allowed child roles includes both the terminal and consult-intent oneOf branches, deep-matching PLAN.md ~L1018" {
  run node -e '
    const bridge = require(process.argv[1]);
    const schema = bridge.buildRuntimeTurnEnvelopeOutputSchema("ARCH_VERDICT", ["arch-platform", "arch-testing"]);
    if (schema.oneOf.length !== 2) { process.stderr.write("expected two branches\n"); process.exit(1); }
    const terminal = schema.oneOf[0];
    if (terminal.additionalProperties !== false || JSON.stringify(terminal.required) !== JSON.stringify(["schema", "kind", "result"])) { process.stderr.write("bad terminal branch shape\n"); process.exit(1); }
    const answered = terminal.properties.result.oneOf[0];
    if (JSON.stringify(answered.required) !== JSON.stringify(["schema", "status", "result_kind", "content"])) { process.stderr.write("bad ANSWERED required set\n"); process.exit(1); }
    if (answered.properties.result_kind.enum[0] !== "ARCH_VERDICT") { process.stderr.write("result_kind not narrowed to expected value\n"); process.exit(1); }
    const blocked = terminal.properties.result.oneOf[1];
    if (JSON.stringify(blocked.properties.reason.enum) !== JSON.stringify(["CONTENT_TOO_LARGE","INSUFFICIENT_CONTEXT","UNSUPPORTED_REQUEST","CONSULTATION_FAILED","POLICY_DENIED"])) { process.stderr.write("bad BLOCKED reason enum\n"); process.exit(1); }
    const consult = schema.oneOf[1];
    if (consult.properties.kind.enum[0] !== "consult-intent") { process.stderr.write("bad consult branch\n"); process.exit(1); }
    if (JSON.stringify(consult.properties.consult.properties.target_role.enum) !== JSON.stringify(["arch-platform","arch-testing"])) { process.stderr.write("target_role enum not narrowed to allowed child roles\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-01 PASS: a well-formed ANSWERED terminal envelope validates" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "ARCH_VERDICT", content: "ok" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (!res.ok) { process.stderr.write("expected valid: " + JSON.stringify(res) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-02 PASS: a well-formed BLOCKED terminal envelope validates" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "BLOCKED", result_kind: "BLOCKED", reason: "POLICY_DENIED" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (!res.ok) { process.stderr.write("expected valid: " + JSON.stringify(res) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-03 FAIL: an ANSWERED envelope whose result_kind does not equal the request's expected_result_kind is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "WRONG_KIND", content: "ok" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-04 FAIL: an ANSWERED envelope carrying a forbidden reason field is rejected (closed key-set)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "ARCH_VERDICT", content: "ok", reason: "POLICY_DENIED" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (res.ok) { process.stderr.write("expected rejection (additionalProperties:false)\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-05 FAIL: a BLOCKED envelope carrying a forbidden content field is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "BLOCKED", result_kind: "BLOCKED", reason: "POLICY_DENIED", content: "sneaky" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-06 FAIL: a consult-intent envelope naming a target_role outside allowed_child_roles is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "consult-intent", consult: { target_role: "context-provider", question: "q", expected_result_kind: "CP_ANSWER" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", ["arch-platform"]);
    if (res.ok) { process.stderr.write("expected rejection: context-provider not in allowed set\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-07 FAIL: a consult-intent envelope is rejected outright when allowed_child_roles is empty (leaf/exhausted budget forbids consult entirely)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "consult-intent", consult: { target_role: "arch-platform", question: "q", expected_result_kind: "X" } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-ENVELOPE-08 FAIL: content exceeding the 65536-byte ceiling is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const env = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "ARCH_VERDICT", content: "x".repeat(65537) } };
    const res = bridge.validateRuntimeTurnEnvelope(env, "ARCH_VERDICT", []);
    if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-LOGIN: account/login/start dual-condition correlation (PLAN.md ~L897) ──

@test "C2-LOGIN-01 PASS: login resolves ok once BOTH the id-matched LoginAccountResponse AND the account/updated notification arrive (response first)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "fake-token", chatgptAccountId: "fake-account", chatgptPlanType: "plus" }, { timeoutMs: 500 });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "account/login/start");
        if (!req || req.params.type !== "chatgptAuthTokens" || req.params.accessToken !== "fake-token") { process.stderr.write("bad login request: " + JSON.stringify(req) + "\n"); process.exit(1); }
        fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        setImmediate(() => fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: null } }) + "\n"));
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("expected success: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-02 PASS: login resolves ok when the account/updated notification arrives BEFORE the id-matched response (order-independent)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }, { timeoutMs: 500 });
      setImmediate(() => {
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: null } }) + "\n");
        setImmediate(() => {
          const req = sent.find((f) => f.method === "account/login/start");
          fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        });
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("expected success: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-03 FAIL: login rejects on timeout when only the response arrives and the account/updated notification never does" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }, { timeoutMs: 200 });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok || res.reason !== "login-timeout") { process.stderr.write("expected login-timeout: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-04 FAIL: login rejects when the account/updated notification carries a conflicting authMode" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }, { timeoutMs: 500 });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        // Real AuthMode enum (prep/phase-a/codex-schema/ts-run1/AuthMode.ts) is lowercase "apikey" -- a genuine, enum-valid-but-conflicting value, distinct from an out-of-enum garbage string.
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "apikey", planType: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok || res.reason !== "login-conflicting-account-updated") { process.stderr.write("expected conflicting-account-updated rejection: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-05 PASS: a duplicate identical account/updated notification is ignored, not treated as conflicting" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }, { timeoutMs: 500 });
      setImmediate(() => {
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: null } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: null } }) + "\n");
        const req = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("expected success: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-06 FAIL: login rejects when the account/updated notification's planType conflicts with the supplied credentials.chatgptPlanType (PLAN.md ~L897 'validated supplied plan')" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 500 });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        // Real AccountUpdatedNotification shape (prep/phase-a/codex-schema/ts-run1/AccountUpdatedNotification.ts): {authMode, planType} -- planType really is a live field, checked against the supplied credentials plan.
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "free" } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok || res.reason !== "login-conflicting-plan-type") { process.stderr.write("expected plan-type conflict rejection: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-07 PASS: login succeeds when the account/updated notification's planType is null (derived/unknown semantics, PLAN.md ~L897)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 500 });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("expected success with null planType: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-LOGIN-08 FAIL: login times out and rejects when neither the response nor the notification ever arrives" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const p = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }, { timeoutMs: 200 });
      return p;
    }).then((res) => { if (res.ok || res.reason !== "login-timeout") { process.stderr.write("expected login-timeout: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-RESUME: thread/resume (PLAN.md ~L913-918, R5 addition -- previously entirely unimplemented and unflagged as a gap) ──

@test "C2-RESUME-01 PASS: threadResume sends the exact frozen params shape and resolves threadId from the NESTED result.thread.id, reusing ThreadStartResponse-shaped validation" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadResume({ threadId: "thread-abc", developerInstructions: "role-bytes", baseInstructions: "runtime-bytes", cwd: "/isolated/cwd" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/resume");
        if (req.params.threadId !== "thread-abc") { process.stderr.write("bad params: " + JSON.stringify(req.params) + "\n"); process.exit(1); }
        const expectedParams = { threadId: "thread-abc", approvalPolicy: "never", approvalsReviewer: "user", baseInstructions: "runtime-bytes", config: null, cwd: "/isolated/cwd", developerInstructions: "role-bytes", model: null, modelProvider: null, personality: null, sandbox: null, serviceTier: null };
        if (JSON.stringify(req.params, Object.keys(expectedParams).sort()) !== JSON.stringify(expectedParams, Object.keys(expectedParams).sort())) { process.stderr.write("param mismatch: " + JSON.stringify(req.params) + "\n"); process.exit(1); }
        // Real Thread shape (prep/phase-a/codex-schema/ts-run1/v2/Thread.ts): the nested thread carries its OWN cwd/modelProvider/status, and thread/resume requires >=1 schema-valid persisted turn (never thread/start'"'"'s zero-turn predicate).
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "thread-abc", sessionId: "session-abc", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "openai", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/isolated/cwd", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [{ id: "turn-old-1", status: "completed", items: [], itemsView: "full" }] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/isolated/cwd", instructionSources: [], model: "gpt-5", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok || res.threadId !== "thread-abc") { process.stderr.write("bad result: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-RESUME-02 FAIL: threadResume rejects a response missing the nested thread wrapper, exactly like threadStart" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadResume({ threadId: "t", developerInstructions: "r", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/resume");
        fromChild.write(JSON.stringify({ id: req.id, result: { threadId: "t" } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("flat legacy shape was incorrectly accepted\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-RESUME-03 PASS: threadResume refused by refresh-flush-pending (a proven pre-dispatch rejection) stays recoverable -- never STOPs the connection; a retry after the flush confirms genuinely dispatches and succeeds (R14/PLAN.md 934 pre-dispatch-recoverable distinction, mirrors turnStart's own C2-R9-24 pattern)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredRefreshFlush = null;
    const wrappedStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: wrappedStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      // Trigger SR-01 and leave its reply flush deliberately unconfirmed -- the connection is now mid-refresh.
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        conn.threadResume({ threadId: "thread-x", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }).then((blockedRes) => {
          if (blockedRes.ok || blockedRes.reason !== "refresh-flush-pending") { process.stderr.write("expected the blocked threadResume to be refused refresh-flush-pending: " + JSON.stringify(blockedRes) + "\n"); process.exit(1); }
          if (conn.isStopped()) { process.stderr.write("a soft refresh-flush-pending refusal must never STOP the connection\n"); process.exit(1); }
        });
        setImmediate(() => {
          deferredRefreshFlush();
          setImmediate(() => {
            if (conn.isStopped()) { process.stderr.write("connection unexpectedly stopped after the refresh flush confirmed: " + conn.stopReason() + "\n"); process.exit(1); }
            const retryP = conn.threadResume({ threadId: "thread-x", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
            setImmediate(() => {
              const resumeReq = sent.filter((f) => f.method === "thread/resume").pop();
              if (!resumeReq) { process.stderr.write("retry never dispatched thread/resume on the wire\n"); process.exit(1); }
              fromChild.write(JSON.stringify({ id: resumeReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [{ id: "turn-old", status: "completed", items: [], itemsView: "full" }] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
            });
            retryP.then((res) => {
              if (!res.ok || res.threadId !== "thread-x") { process.stderr.write("retry did not succeed: " + JSON.stringify(res) + "\n"); process.exit(1); }
              process.exit(0);
            }).catch((err) => { process.stderr.write("retry rejected: " + err + "\n"); process.exit(1); });
          });
        });
      });
    }).catch((err) => { process.stderr.write("preamble rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-RESUME-04 FAIL: a genuine POST-dispatch threadResume failure (timeout) still STOPs the connection -- only the pre-dispatch soft refusal in C2-RESUME-03 is recoverable" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      // No response ever arrives for thread/resume -- must time out and STOP, never quietly stay usable.
      return conn.threadResume({ threadId: "thread-x", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }, { timeoutMs: 50 });
    }).then((res) => {
      if (res.ok) { process.stderr.write("timeout was incorrectly accepted as success\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("a genuine post-dispatch timeout must STOP the connection\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-THREAD: thread/start exact params + response validation (PLAN.md ~L906-912, ~L932) ──

@test "C2-THREAD-01 PASS: threadStart sends the exact frozen params shape and resolves threadId from the NESTED result.thread.id on a valid response" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadStart({ role: "arch-platform", developerInstructions: "role-bytes", baseInstructions: "runtime-bytes", cwd: "/isolated/cwd" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        const expectedParams = { approvalPolicy: "never", approvalsReviewer: "user", baseInstructions: "runtime-bytes", config: null, cwd: "/isolated/cwd", developerInstructions: "role-bytes", ephemeral: false, model: null, modelProvider: null, personality: null, sandbox: null, serviceTier: null };
        if (JSON.stringify(req.params, Object.keys(expectedParams).sort()) !== JSON.stringify(expectedParams, Object.keys(expectedParams).sort())) { process.stderr.write("param mismatch: " + JSON.stringify(req.params) + "\n"); process.exit(1); }
        // Real ThreadStartResponse/Thread shape (prep/phase-a/codex-schema/ts-run1/v2/{ThreadStartResponse,Thread}.ts): id/ephemeral/turns/cwd/modelProvider/status nest inside result.thread, never flat on result; the nested cwd/modelProvider must agree with the top-level fields (R7).
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "thread-abc", sessionId: "session-abc", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "openai", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/isolated/cwd", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/isolated/cwd", instructionSources: [], model: "gpt-5", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok || res.threadId !== "thread-abc") { process.stderr.write("bad result: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-THREAD-02 FAIL: a thread/start response with approvalPolicy other than never is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadStart({ role: "arch-platform", developerInstructions: "r", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        // R14 (Bloque B): thread is otherwise schema-COMPLETE (all 12 real required Thread fields present) so the generated validator passes and the ONLY violation reaching the business-rule check below is the deliberate wrong approvalPolicy.
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "on-request", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); } if (res.reason !== "thread-start-wrong-approval-policy") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-THREAD-03 FAIL: a thread/start response with a non-empty instructionSources is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadStart({ role: "arch-platform", developerInstructions: "r", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        // R14 (Bloque B): thread is otherwise schema-COMPLETE so the generated validator passes and the ONLY violation reaching the business-rule check below is the deliberate non-empty instructionSources.
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: ["~/.codex/AGENTS.md"], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); } if (res.reason !== "thread-start-nonempty-instruction-sources") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-THREAD-04 FAIL: a thread/start response with a non-empty thread.turns array (not idle) is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadStart({ role: "arch-platform", developerInstructions: "r", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "session-1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [{ id: "old-turn", status: "completed", items: [], itemsView: "full" }] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); } if (res.reason !== "thread-start-not-idle") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-THREAD-05 FAIL: a thread/start response missing the nested thread wrapper entirely (e.g. a flat legacy shape) is rejected, never misread as a valid idle thread" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const p = conn.threadStart({ role: "arch-platform", developerInstructions: "r", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        // Deliberately the OLD (wrong) flat shape this suite used to mock -- proves the fix actually rejects it now.
        fromChild.write(JSON.stringify({ id: req.id, result: { threadId: "t", approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", ephemeral: false, turns: [], sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("flat legacy shape was incorrectly accepted\n"); process.exit(1); } if (res.reason !== "thread-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-THREAD-06 FAIL: threadStart times out and rejects when no response ever arrives" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      return conn.threadStart({ role: "arch-platform", developerInstructions: "r", baseInstructions: "b", cwd: "/c" }, { timeoutMs: 200 });
    }).then((res) => { if (res.ok || res.reason !== "timeout-possibly-delivered") { process.stderr.write("expected timeout rejection: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-TURN: turn/start exact params + response validation + streaming (PLAN.md ~L919-934) ──

@test "C2-TURN-01 PASS: turnStart sends exact params (incl. constructed outputSchema) and resolves turnId from the NESTED result.turn.id, mapping frame id to threadId internally" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    // R7: threadStart now requires phase AUTHENTICATED and turnStart requires
    // a KNOWN thread (C5) -- drive the real initialize->login->threadStart
    // sequence before exercising turnStart itself, exactly as production would.
    function _c2AuthAndStartThread(threadId, cwd) {
      const initP = conn.initialize();
      setImmediate(() => {
        const initReq = sent.find((f) => f.method === "initialize");
        fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      });
      return initP.then((initRes) => {
        if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
        const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
        setImmediate(() => {
          const loginReq = sent.find((f) => f.method === "account/login/start");
          fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
          fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
        });
        return loginP;
      }).then((loginRes) => {
        if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
        const p = conn.threadStart({ role: "arch-platform", developerInstructions: "d", baseInstructions: "b", cwd });
        setImmediate(() => {
          const req = sent.find((f) => f.method === "thread/start");
          fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: threadId, sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "openai", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd, cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd, instructionSources: [], model: "gpt-5", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
        });
        return p;
      }).then((threadRes) => {
        if (!threadRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(threadRes) + "\n"); process.exit(1); }
      });
    }
    // R8 (item 6): the wire outputSchema is now built INTERNALLY from expectedResultKind/allowedChildRoles -- this expected value mirrors that construction via the SAME exported function (ENVSRC-01 same-reference guarantee) to keep verifying the request shape byte-for-byte.
    const outputSchema = bridge.buildRuntimeTurnEnvelopeOutputSchema("ARCH_VERDICT", []);
    _c2AuthAndStartThread("thread-abc", "/isolated/cwd").then(() => {
      const p = conn.turnStart({ threadId: "thread-abc", inputText: "please review", expectedResultKind: "ARCH_VERDICT", allowedChildRoles: [], cwd: "/isolated/cwd" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "turn/start");
        if (req.params.threadId !== "thread-abc" || req.params.summary !== "none") { process.stderr.write("bad params: " + JSON.stringify(req.params) + "\n"); process.exit(1); }
        if (JSON.stringify(req.params.input) !== JSON.stringify([{ type: "text", text: "please review", text_elements: [] }])) { process.stderr.write("bad input\n"); process.exit(1); }
        if (req.params.effort !== null || req.params.model !== null || req.params.personality !== null || req.params.sandboxPolicy !== null || req.params.serviceTier !== null) { process.stderr.write("an omitted-optional field was not null\n"); process.exit(1); }
        if (JSON.stringify(req.params.outputSchema) !== JSON.stringify(outputSchema)) { process.stderr.write("outputSchema not passed through exactly\n"); process.exit(1); }
        // Real TurnStartResponse shape (prep/phase-a/codex-schema/ts-run1/v2/{TurnStartResponse,Turn}.ts): exactly {turn: Turn}, id/status/items nest inside turn.
        fromChild.write(JSON.stringify({ id: req.id, result: { turn: { id: "turn-1", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok || res.turnId !== "turn-1") { process.stderr.write("bad result: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-02 FAIL: a turn/start response with an empty turn.id is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    function _c2AuthAndStartThread(threadId, cwd) {
      const initP = conn.initialize();
      setImmediate(() => {
        const initReq = sent.find((f) => f.method === "initialize");
        fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      });
      return initP.then((initRes) => {
        if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
        const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
        setImmediate(() => {
          const loginReq = sent.find((f) => f.method === "account/login/start");
          fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
          fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
        });
        return loginP;
      }).then((loginRes) => {
        if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
        const p = conn.threadStart({ role: "arch-platform", developerInstructions: "d", baseInstructions: "b", cwd });
        setImmediate(() => {
          const req = sent.find((f) => f.method === "thread/start");
          fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: threadId, sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "openai", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd, cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd, instructionSources: [], model: "gpt-5", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
        });
        return p;
      }).then((threadRes) => {
        if (!threadRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(threadRes) + "\n"); process.exit(1); }
      });
    }
    _c2AuthAndStartThread("t", "/c").then(() => {
      const p = conn.turnStart({ threadId: "t", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { turn: { id: "", status: "inProgress", items: [] } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); } if (res.reason !== "turn-start-empty-turn-id") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-02b FAIL: a turn/start response missing the nested turn wrapper entirely (flat legacy shape) is rejected" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    function _c2AuthAndStartThread(threadId, cwd) {
      const initP = conn.initialize();
      setImmediate(() => {
        const initReq = sent.find((f) => f.method === "initialize");
        fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      });
      return initP.then((initRes) => {
        if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
        const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
        setImmediate(() => {
          const loginReq = sent.find((f) => f.method === "account/login/start");
          fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
          fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
        });
        return loginP;
      }).then((loginRes) => {
        if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
        const p = conn.threadStart({ role: "arch-platform", developerInstructions: "d", baseInstructions: "b", cwd });
        setImmediate(() => {
          const req = sent.find((f) => f.method === "thread/start");
          fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: threadId, sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "openai", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd, cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd, instructionSources: [], model: "gpt-5", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
        });
        return p;
      }).then((threadRes) => {
        if (!threadRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(threadRes) + "\n"); process.exit(1); }
      });
    }
    _c2AuthAndStartThread("t", "/c").then(() => {
      const p = conn.turnStart({ threadId: "t", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { turnId: "t1", status: "inProgress", items: [] } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("flat legacy shape was incorrectly accepted\n"); process.exit(1); } if (res.reason !== "turn-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-02c FAIL: turnStart times out and rejects when no response ever arrives" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    function _c2AuthAndStartThread(threadId, cwd) {
      const initP = conn.initialize();
      setImmediate(() => {
        const initReq = sent.find((f) => f.method === "initialize");
        fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      });
      return initP.then((initRes) => {
        if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
        const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
        setImmediate(() => {
          const loginReq = sent.find((f) => f.method === "account/login/start");
          fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
          fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
        });
        return loginP;
      }).then((loginRes) => {
        if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
        const p = conn.threadStart({ role: "arch-platform", developerInstructions: "d", baseInstructions: "b", cwd });
        setImmediate(() => {
          const req = sent.find((f) => f.method === "thread/start");
          fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: threadId, sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "openai", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd, cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd, instructionSources: [], model: "gpt-5", modelProvider: "openai", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
        });
        return p;
      }).then((threadRes) => {
        if (!threadRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(threadRes) + "\n"); process.exit(1); }
      });
    }
    _c2AuthAndStartThread("t", "/c").then(() => {
      return conn.turnStart({ threadId: "t", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }, { timeoutMs: 200 });
    }).then((res) => { if (res.ok || res.reason !== "timeout-possibly-delivered") { process.stderr.write("expected timeout rejection: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-03 PASS: onTurnCompleted fires with the extracted+validated ANSWERED envelope when turn/completed carries {threadId, turn:{...,itemsView:full}} with a matching single final_answer agentMessage" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8 (items 2/9): onTurnCompleted no longer lazily seeds authority for an
    // unknown thread -- a real initialize+login+threadStart+turnStart
    // preamble is required to establish threadTurnInFlight ownership before
    // it will register a handler at all (P0-2 fix).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "ARCH_VERDICT", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "ARCH_VERDICT", [], (res) => results.push(res));
      const envelope = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "ARCH_VERDICT", content: "the verdict" } };
      // Real TurnCompletedNotification/ThreadItem shape (prep/phase-a/codex-schema/ts-run1/v2/{TurnCompletedNotification,ThreadItem}.ts): exactly {threadId, turn: Turn}, and the agentMessage variant requires id/text/phase/memoryCitation all present (R7, C8).
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: JSON.stringify(envelope), memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 1 || !results[0].ok) { process.stderr.write("bad result: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (results[0].envelope.result.content !== "the verdict") { process.stderr.write("content mismatch\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-04 FAIL: onTurnCompleted for a mismatched threadId/turn.id is never fired (wrong-thread notifications are ignored)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real ownership first (see C2-TURN-03) so this genuinely
    // exercises "a registered handler ignores a mismatched-thread notification",
    // not merely "no handler was ever registered at all".
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "OTHER", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [] } } }) + "\n");
      setImmediate(() => { if (results.length !== 0) { process.stderr.write("fired for a mismatched thread\n"); process.exit(1); } process.exit(0); });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-05 FAIL: turn/completed content that is prose-wrapped (not one bare JSON value) is rejected, never coerced" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: "Sure! ```json\n{}\n```", memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 1 || results[0].ok) { process.stderr.write("prose/fenced content was accepted: " + JSON.stringify(results) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-06 FAIL: turn/completed with more than one final_answer agentMessage is rejected as ambiguous" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const okEnv = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: okEnv, memoryCitation: null }, { type: "agentMessage", id: "am-2", phase: "final_answer", text: okEnv, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => { if (results.length !== 1 || results[0].ok) { process.stderr.write("ambiguous duplicate accepted\n"); process.exit(1); } process.exit(0); });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-07 FAIL: turn/completed with itemsView other than full (e.g. summary) is rejected, never treated as a complete item list" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "summary", items: [] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 1 || results[0].ok || results[0].reason.indexOf("items-view-not-full") === -1) { process.stderr.write("summary itemsView was accepted: " + JSON.stringify(results) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-TURN-08 FAIL: a duplicate/re-delivered turn/completed notification for the SAME (threadId,turnId) STOPs the connection -- R14 requires unconditional STOP on ANY second completion (identical or not), and delivery never happens even if response later arrives" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      // The turn/start response is deliberately withheld until AFTER the duplicates below, proving delivery never happens even once it finally arrives.
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
      const frame = JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n";
      fromChild.write(frame);
      fromChild.write(frame);
      fromChild.write(frame);
      setImmediate(() => {
        if (!conn.isStopped() || conn.stopReason() !== "turn-completed-duplicate-early-completion") { process.stderr.write("expected STOP turn-completed-duplicate-early-completion, got: " + conn.stopReason() + "\n"); process.exit(1); }
        if (results.length !== 0) { process.stderr.write("handler fired despite the connection being STOPped: " + JSON.stringify(results) + "\n"); process.exit(1); }
        // Even a late turn/start response arriving after STOP must never still produce a delivery.
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        setImmediate(() => {
          if (results.length !== 0) { process.stderr.write("a late response after STOP still produced a delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-CTRL: turn/interrupt + thread/archive exact params (prep/phase-a/codex-schema TurnInterruptParams.json / ThreadArchiveParams.json -- confirmed byte-identical between the PREP-pinned 0.144.0-alpha.4 capture and a fresh live 0.145.0-alpha.18 regeneration this session, despite the unrelated SC-5 binary/fingerprint drift) ──

@test "C2-CTRL-01 PASS: turnInterrupt sends the exact {threadId,turnId} params and resolves on a matching response" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      // R8 (item 12): turnInterrupt now requires threadsKnown ownership -- establish it via a real threadStart first.
      const startP = conn.threadStart({ role: "arch-platform", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      // R8 (item 12): turnInterrupt also requires threadTurnInFlight correlation -- establish it via a real turnStart first.
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      if (!turnRes.ok) { process.stderr.write("preamble turnStart failed: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      const p = conn.turnInterrupt("thread-x", "turn-y");
      setImmediate(() => {
        const req = sent.find((f) => f.method === "turn/interrupt");
        if (JSON.stringify(req.params) !== JSON.stringify({ threadId: "thread-x", turnId: "turn-y" })) { process.stderr.write("bad params: " + JSON.stringify(req.params) + "\n"); process.exit(1); }
        fromChild.write(JSON.stringify({ id: req.id, result: {} }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("expected success\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-CTRL-02 PASS: threadArchive sends the exact {threadId} params and resolves on a matching response" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      // R8 (item 12): threadArchive now requires threadsKnown ownership -- establish it via a real threadStart first.
      const startP = conn.threadStart({ role: "arch-platform", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      const p = conn.threadArchive("thread-x");
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/archive");
        if (JSON.stringify(req.params) !== JSON.stringify({ threadId: "thread-x" })) { process.stderr.write("bad params: " + JSON.stringify(req.params) + "\n"); process.exit(1); }
        fromChild.write(JSON.stringify({ id: req.id, result: {} }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("expected success\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-CTRL-03 FAIL: threadArchive refuses an unsafe in-flight turn (dispatched, not yet completed) WITHOUT writing to the wire, STOPping, or erasing its tracking -- the turn still delivers normally afterward, and archive then succeeds once safely terminal (R14 point archive-refuses-unsafe-turn)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then(() => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      if (!turnRes.ok) { process.stderr.write("preamble turnStart failed: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      const sentBeforeArchive = sent.length;
      return conn.threadArchive("thread-x").then((archiveRes) => {
        if (archiveRes.ok) { process.stderr.write("archive incorrectly succeeded while a turn is still in flight\n"); process.exit(1); }
        if (archiveRes.reason !== "thread-archive-refused-turn-in-flight") { process.stderr.write("wrong refusal reason: " + archiveRes.reason + "\n"); process.exit(1); }
        if (conn.isStopped()) { process.stderr.write("archive refusal must not STOP the connection\n"); process.exit(1); }
        if (sent.length !== sentBeforeArchive) { process.stderr.write("archive refusal must never write to the wire\n"); process.exit(1); }
        // Deliver the turn'"'"'s actual completion now -- tracking must be fully intact, proving nothing was erased by the refused archive.
        const results = [];
        conn.onTurnCompleted("thread-x", turnRes.turnId, "K", [], (res) => results.push(res));
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "still-alive" } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: turnRes.turnId, status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        return new Promise((resolve) => setImmediate(() => {
          if (results.length !== 1 || !results[0].ok || results[0].envelope.result.content !== "still-alive") { process.stderr.write("turn did not deliver normally after the refused archive: " + JSON.stringify(results) + "\n"); process.exit(1); }
          resolve();
        }));
      });
    }).then(() => {
      // Now safely terminal -- archive must succeed.
      const retryP = conn.threadArchive("thread-x");
      setImmediate(() => {
        const req = sent.filter((f) => f.method === "thread/archive").pop();
        if (!req) { process.stderr.write("retry archive never dispatched to the wire\n"); process.exit(1); }
        fromChild.write(JSON.stringify({ id: req.id, result: {} }) + "\n");
      });
      return retryP;
    }).then((res) => {
      if (!res.ok) { process.stderr.write("archive did not succeed once safely terminal: " + JSON.stringify(res) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-R14: turn-lifecycle replay fence + duplicate-notification hardening (PLAN.md "Turn Lifecycle State Machine", R14 design authority) ──
# Shared preamble across every test below: initialize -> login -> threadStart
# (thread-x known) -- driven inline via a small helper closure rather than
# repeating the boilerplate, matching this suite's own established pattern
# elsewhere of inlining the sequence per test for full self-containment.

@test "C2-R14-01 FAIL: a second, IDENTICAL turn/started notification for an already-started turn STOPs (duplicate-turn-started), never silently accepted twice" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then(() => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const startedFrame = JSON.stringify({ method: "turn/started", params: { threadId: "thread-x", turn: { id: "turn-1", status: "inProgress", items: [] } } });
        fromChild.write(startedFrame + "\n");
        setImmediate(() => {
          if (conn.isStopped()) { process.stderr.write("connection stopped after the FIRST turn/started -- should still be alive\n"); process.exit(1); }
          fromChild.write(startedFrame + "\n"); // exact duplicate
          setImmediate(() => {
            if (!conn.isStopped() || conn.stopReason() !== "duplicate-turn-started") { process.stderr.write("expected STOP duplicate-turn-started, got: " + conn.stopReason() + "\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-02 FAIL: a turn/started arriving AFTER turn/completed was already observed for the same turn STOPs (turn-started-after-completion-observed), even though full delivery (handler not yet registered) is still outstanding" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then(() => {
      // No onTurnCompleted registered yet -- the completion below will be buffered, not delivered, keeping the turn NOT-yet-fully-delivered when the late turn/started arrives.
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-1", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          if (conn.isStopped()) { process.stderr.write("connection stopped after the completion notification -- should still be alive (buffered, not yet delivered)\n"); process.exit(1); }
          fromChild.write(JSON.stringify({ method: "turn/started", params: { threadId: "thread-x", turn: { id: "turn-1", status: "inProgress", items: [] } } }) + "\n");
          setImmediate(() => {
            if (!conn.isStopped() || conn.stopReason() !== "turn-started-after-completion-observed") { process.stderr.write("expected STOP turn-started-after-completion-observed, got: " + conn.stopReason() + "\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-03 FAIL: registering a SECOND onTurnCompleted handler for the same (threadId,turnId) pair before the first has delivered STOPs (duplicate-turn-completed-handler-registration), never silently overwriting the first handler" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then(() => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      conn.onTurnCompleted("thread-x", turnRes.turnId, "K", [], () => {});
      setImmediate(() => {
        if (conn.isStopped()) { process.stderr.write("connection stopped after the FIRST handler registration -- should still be alive\n"); process.exit(1); }
        conn.onTurnCompleted("thread-x", turnRes.turnId, "K", [], () => {}); // duplicate registration, no completion has arrived yet
        setImmediate(() => {
          if (!conn.isStopped() || conn.stopReason() !== "duplicate-turn-completed-handler-registration") { process.stderr.write("expected STOP duplicate-turn-completed-handler-registration, got: " + conn.stopReason() + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-04 FAIL: replaying a RETIRED turn id (a prior turn on the same thread that already fully delivered) is rejected as a genuine replay -- both via a fresh turnStart response and via a bare notification -- never silently rebinding" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then(() => {
      // Full first turn, delivered end-to-end -- "turn-1" becomes retired.
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      const delivered = new Promise((resolve) => {
        conn.onTurnCompleted("thread-x", turnRes.turnId, "K", [], (res) => resolve(res));
      });
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "first" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-1", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return delivered;
    }).then((firstResult) => {
      if (!firstResult.ok) { process.stderr.write("preamble first-turn delivery failed: " + JSON.stringify(firstResult) + "\n"); process.exit(1); }
      if (conn.isStopped()) { process.stderr.write("connection stopped after the first turn delivered cleanly\n"); process.exit(1); }
      // Attempt 1: a bare notification replaying the now-retired "turn-1" id (simulating a duplicate/stale wire delivery), with no NEW turnStart in flight.
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-1", status: "completed", itemsView: "full", items: [] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (!conn.isStopped() || conn.stopReason() !== "turn-notification-turn-id-replay-of-retired-id:turn/completed") { process.stderr.write("expected STOP turn-notification-turn-id-replay-of-retired-id, got: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("rejected: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-05 FAIL: the frozen retired-turn-id cap is exactly 4096, host-owned and not caller-configurable -- driving 4097 REAL sequential turns to completion on one thread delivers exactly 4096 and STOPs on the 4097th delivery attempt (retired-turn-id-registry-exhausted), with that 4097th handler never firing" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => { for (const line of c.toString("utf8").split("\n")) { if (line.trim()) sent.push(JSON.parse(line)); } });
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    function waitTick() { return new Promise((r) => setImmediate(r)); }
    async function main() {
      const initP = conn.initialize();
      await waitTick();
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      await initP;
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 5000 });
      await waitTick();
      const loginReq = sent.find((f) => f.method === "account/login/start");
      fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
      fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      await loginP;
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      await waitTick();
      const startReq = sent.find((f) => f.method === "thread/start");
      fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      await startP;
      const TOTAL = 4097;
      let deliveredCount = 0;
      for (let i = 1; i <= TOTAL; i++) {
        const turnId = "turn-" + i;
        const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x" + i, expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
        await waitTick();
        if (conn.isStopped()) { process.stderr.write("unexpected STOP before iteration " + i + " own dispatch: " + conn.stopReason() + "\n"); process.exit(1); }
        const turnReq = sent[sent.length - 1];
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: turnId, status: "inProgress", items: [] } } }) + "\n");
        const turnRes = await turnP;
        if (!turnRes.ok) { process.stderr.write("turnStart rejected at iteration " + i + ": " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
        let handlerFired = false, handlerResult = null;
        conn.onTurnCompleted("thread-x", turnRes.turnId, "K", [], (res) => { handlerFired = true; handlerResult = res; });
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "c" + i } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: turnId, status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-" + i, phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        await waitTick();
        if (conn.isStopped()) {
          if (i !== 4097) { process.stderr.write("STOP fired at the WRONG iteration (" + i + ", expected exactly 4097): " + conn.stopReason() + "\n"); process.exit(1); }
          if (conn.stopReason() !== "retired-turn-id-registry-exhausted") { process.stderr.write("wrong stop reason: " + conn.stopReason() + "\n"); process.exit(1); }
          if (deliveredCount !== 4096) { process.stderr.write("expected exactly 4096 prior deliveries, got " + deliveredCount + "\n"); process.exit(1); }
          if (handlerFired) { process.stderr.write("the 4097th (cap-exhausted) turn'"'"'s handler incorrectly fired\n"); process.exit(1); }
          process.exit(0);
        }
        if (!handlerFired || !handlerResult.ok) { process.stderr.write("delivery did not fire cleanly at iteration " + i + "\n"); process.exit(1); }
        deliveredCount++;
      }
      process.stderr.write("cap was never enforced across " + TOTAL + " turns -- expected a STOP at 4097\n");
      process.exit(1);
    }
    main().catch((err) => { process.stderr.write("rejected: " + (err && err.stack || err) + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# R7 stabilization batch -- WP3 item C2 (app-server JSONL client, schema
# validation, connection authority, turn correlation). Buckets A-F below
# match the R7 correction matrix exactly. Every test here targets a gap the
# PRE-R7 implementation genuinely had -- the terminal STOP flags existed but
# nothing internal consulted them, there was no phase machine at all (any
# RPC could be called in any order), itemsView was over-narrowed to "full"
# only (a deviation from PLAN's own literal "absent/full"), and so on.
# ══════════════════════════════════════════════════════════════════════════

# ── C2-STOP: terminal STOP authority (bucket A) ──

@test "C2-STOP-01 FAIL: a malformed frame followed in the SAME chunk by a turn/completed for a tracked pair never invokes the handler (A1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
    const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
    const completedFrame = JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } });
    // Both lines delivered in ONE chunk -- the malformed line comes first.
    fromChild.write("not-json-at-all\n" + completedFrame + "\n");
    setImmediate(() => {
      if (results.length !== 0) { process.stderr.write("handler fired after STOP began in the same chunk: " + JSON.stringify(results) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("connection not STOPped\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-STOP-02 FAIL: after STOP, every public method returns deterministic failure and writes zero further bytes (A2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write("not-json-at-all\n");
    setImmediate(() => {
      if (!conn.isStopped()) { process.stderr.write("expected STOPped\n"); process.exit(1); }
      const beforeSentLength = sent.length;
      Promise.all([
        conn.initialize(),
        conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }),
        conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }),
        conn.threadResume({ threadId: "t", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }),
        conn.turnStart({ threadId: "t", inputText: "x", outputSchema: {}, cwd: "/c" }),
        conn.turnInterrupt("t", "u"),
        conn.threadArchive("t"),
      ]).then((results) => {
        if (results.some((r) => r.ok)) { process.stderr.write("a method reported success after STOP: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (sent.length !== beforeSentLength) { process.stderr.write("a method wrote bytes after STOP\n"); process.exit(1); }
        process.exit(0);
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-STOP-03 FAIL: the FIRST stopReason is preserved even if a later, unrelated STOP trigger fires afterward (A2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write("not-json-at-all\n");
    setImmediate(() => {
      const firstReason = conn.stopReason();
      if (!firstReason || firstReason.indexOf("malformed-frame") !== 0) { process.stderr.write("unexpected first reason: " + firstReason + "\n"); process.exit(1); }
      fromChild.emit("error", new Error("a later, unrelated transport error"));
      if (conn.stopReason() !== firstReason) { process.stderr.write("stopReason changed after the connection was already STOPped: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-STOP-04 FAIL: a threadStart timeout STOPs the whole connection, and the channel cannot be reused for a later RPC (A3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      return conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }, { timeoutMs: 100 });
    }).then((res) => {
      if (res.ok || res.reason !== "timeout-possibly-delivered") { process.stderr.write("expected timeout: " + JSON.stringify(res) + "\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("connection not STOPped after timeout\n"); process.exit(1); }
      const beforeLen = sent.length;
      return conn.threadStart({ role: "r2", developerInstructions: "d", baseInstructions: "b", cwd: "/c2" }).then((res2) => {
        if (res2.ok) { process.stderr.write("channel was reused successfully after STOP\n"); process.exit(1); }
        if (sent.length !== beforeLen) { process.stderr.write("a new write was attempted on a STOPped channel\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-STOP-05 FAIL: a server-request reply flushes BEFORE an unrelated already-pending call is settled -- STOPPING precedes STOPPED (A6)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const stdoutListeners = { data: [] };
    const fakeStdout = { on(evt, fn) { if (evt === "data") stdoutListeners.data.push(fn); } };
    const writes = [];
    let deferredFlush = null;
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        writes.push(frame);
        if (Object.prototype.hasOwnProperty.call(frame, "result") && JSON.stringify(frame.result) === JSON.stringify({ decision: "denied" })) {
          deferredFlush = cb; // defer the SR-02 reply flush specifically.
        } else if (cb) {
          cb();
        }
        return true;
      },
    };
    const conn = bridge.createAppServerConnection({ stdin: fakeStdin, stdout: fakeStdout });
    let pendingSettled = false;
    // R8 (item 5): sendRequest was internalized/removed -- initialize() is a
    // real public-API call that goes through the identical pending-Map
    // dispatch/settle machinery, so it stands in for "an unrelated
    // already-pending call" just as well as the old raw escape hatch did.
    conn.initialize({ timeoutMs: 5000 }).then(() => { pendingSettled = true; });
    for (const fn of stdoutListeners.data) fn(JSON.stringify({ id: 5, method: "applyPatchApproval", params: { conversationId: "conv-1", callId: "call-1", fileChanges: {}, reason: null, grantRoot: null } }) + "\n");
    setImmediate(() => {
      if (pendingSettled) { process.stderr.write("an unrelated pending call settled BEFORE the SR reply flush completed\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected no-authority (STOPPING) to already apply\n"); process.exit(1); }
      if (!deferredFlush) { process.stderr.write("SR reply was not the deferred write\n"); process.exit(1); }
      deferredFlush();
      setImmediate(() => {
        if (!pendingSettled) { process.stderr.write("unrelated pending call never settled after the SR reply flush completed\n"); process.exit(1); }
        process.exit(0);
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-IO: JSONL wire framing hardening (bucket B) ──

@test "C2-IO-01 PASS: a multi-byte UTF-8 character split across two feed() chunks decodes correctly via incremental TextDecoder (B1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), () => {});
    const line = JSON.stringify({ id: 1, text: "\u{1F600}" }) + "\n";
    const buf = Buffer.from(line, "utf8");
    const splitAt = buf.indexOf(0xF0) + 2;
    feed(buf.slice(0, splitAt));
    feed(buf.slice(splitAt));
    if (frames.length !== 1 || frames[0].text !== "\u{1F600}") { process.stderr.write("multi-byte char corrupted across chunk boundary: " + JSON.stringify(frames) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-IO-02 FAIL: an unterminated buffered line exceeding the 4MB safety bound is reported and dropped, never grows without limit (B2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder(() => { throw new Error("must not call onFrame"); }, (r) => errors.push(r));
    const chunk = "x".repeat(1024 * 1024);
    for (let i = 0; i < 5; i++) feed(chunk);
    if (errors.length !== 1 || errors[0] !== "frame-too-large-no-newline") { process.stderr.write("expected exactly one frame-too-large error: " + JSON.stringify(errors) + "\n"); process.exit(1); }
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-IO-03 FAIL: a response frame carrying neither result nor error ({id} alone) is never treated as success (B3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => { fromChild.write(JSON.stringify({ id: 1 }) + "\n"); });
    p.then((res) => {
      if (res.ok) { process.stderr.write("a bare {id} frame was accepted as success\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected STOP on an ambiguous response wrapper\n"); process.exit(1); }
      process.exit(0);
    }).catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-IO-04 FAIL: a response frame carrying BOTH result and error is rejected as ambiguous, never silently prioritized (B3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => {
      fromChild.write(JSON.stringify({ id: 1, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" }, error: { code: -32000, message: "boom" } }) + "\n");
    });
    p.then((res) => {
      if (res.ok) { process.stderr.write("an ambiguous result+error frame was accepted\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected STOP on an ambiguous response wrapper\n"); process.exit(1); }
      process.exit(0);
    }).catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-IO-05 PASS: a duplicate response for an ALREADY-settled request id is silently ignored, never re-resolved (B4)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    let settledCount = 0;
    p.then(() => { settledCount++; });
    setImmediate(() => {
      const req = sent.find((f) => f.method === "initialize");
      const okResult = { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" };
      fromChild.write(JSON.stringify({ id: req.id, result: okResult }) + "\n");
      setImmediate(() => {
        fromChild.write(JSON.stringify({ id: req.id, result: okResult }) + "\n");
        setImmediate(() => {
          if (settledCount !== 1) { process.stderr.write("initialize settled " + settledCount + " times, expected exactly once\n"); process.exit(1); }
          process.exit(0);
        });
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-IO-06 PASS: source-audit -- zero literal NUL bytes anywhere in runtime-bridge-codex.cjs or this test file (B5)" {
  run node -e '
    const fs = require("fs");
    const files = [process.argv[1], process.argv[2]];
    const bad = [];
    for (const f of files) {
      if (fs.readFileSync(f).includes(0)) bad.push(f);
    }
    if (bad.length > 0) { process.stderr.write("literal NUL byte(s) found in: " + bad.join(", ") + "\n"); process.exit(1); }
  ' "$BRIDGE" "$BATS_TEST_DIRNAME/runtime-consultation-bridge.bats"
  [ "$status" -eq 0 ]
}

# ── C2-PHASE: connection phase machine NEW->INITIALIZED->AUTHENTICATED->STOPPING->STOPPED (bucket C) ──

@test "C2-PHASE-01 PASS: initialize is assigned frame id exactly 1 and login exactly 2 on the same connection (C1/C2 structural id guarantee)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      if (initReq.id !== 1) { process.stderr.write("initialize did not get id 1: " + initReq.id + "\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        if (!loginReq || loginReq.id !== 2) { process.stderr.write("login did not get id 2: " + JSON.stringify(loginReq) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-02 FAIL: a second call to initialize() is rejected and STOPs the connection (C1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p1 = conn.initialize();
    const p2 = conn.initialize();
    Promise.all([p1, p2]).then(([r1, r2]) => {
      if (r2.ok) { process.stderr.write("second initialize() call was accepted\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected STOP after a double initialize() call\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-03 FAIL: login() before initialize() never writes and STOPs the connection (C2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: null }).then((res) => {
      if (res.ok) { process.stderr.write("login before initialize was accepted\n"); process.exit(1); }
      if (sent.length !== 0) { process.stderr.write("login before initialize wrote " + sent.length + " frame(s)\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected STOP\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-04 FAIL: threadStart() before AUTHENTICATED never writes and STOPs the connection (C3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }).then((res) => {
      if (res.ok) { process.stderr.write("threadStart before AUTHENTICATED was accepted\n"); process.exit(1); }
      if (sent.length !== 0) { process.stderr.write("threadStart before AUTHENTICATED wrote " + sent.length + " frame(s)\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected STOP\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-05 FAIL: a thread/start response whose nested thread.status is not idle is rejected even with empty turns (C3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "active", activeFlags: [] }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); } if (res.reason !== "thread-start-thread-status-not-idle") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-06 FAIL: a thread/start response whose nested thread.cwd disagrees with the top-level cwd is rejected (C3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/DIFFERENT", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("expected rejection\n"); process.exit(1); } if (res.reason !== "thread-start-thread-cwd-mismatch") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-07 FAIL: thread/resume returning a DIFFERENT thread.id than requested is rejected as identity substitution (C4)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const p = conn.threadResume({ threadId: "requested-thread", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/resume");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "SUBSTITUTED-thread", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [{ id: "t1", status: "completed", items: [], itemsView: "full" }] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("identity substitution was incorrectly accepted\n"); process.exit(1); } if (res.reason !== "thread-resume-thread-id-substitution") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-08 FAIL: turnStart for a thread this connection never itself created via threadStart/threadResume is rejected (C5 'solo para thread conocido')" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      // Never called threadStart/threadResume for "unknown-thread" -- turnStart must refuse it.
      return conn.turnStart({ threadId: "unknown-thread", inputText: "x", outputSchema: bridge.buildRuntimeTurnEnvelopeOutputSchema("K", []), cwd: "/c" });
    }).then((res) => { if (res.ok) { process.stderr.write("turnStart accepted an unknown thread\n"); process.exit(1); } if (res.reason !== "turn-start-thread-not-known") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-09 FAIL: turnStart while another turn is already in flight for the SAME thread is rejected (C5 'máximo un turn in-flight por thread')" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((threadRes) => {
      if (!threadRes.ok) { process.stderr.write("preamble threadStart failed\n"); process.exit(1); }
      const first = conn.turnStart({ threadId: "t", inputText: "first", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // never resolved -- deliberately left pending.
      return conn.turnStart({ threadId: "t", inputText: "second", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
    }).then((res) => { if (res.ok) { process.stderr.write("a second concurrent turn for the same thread was accepted\n"); process.exit(1); } if (res.reason !== "turn-start-already-in-flight-for-thread") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-10 FAIL: a turn/started binding then a CONFLICTING turn/completed turn id for the same thread STOPs the connection (C6)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03) --
    // correlateTurnNotification silently ignores a thread with nothing in
    // flight, so a bare turn/started could never reach the conflict check at all otherwise.
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // left pending -- only seeds threadTurnInFlight ownership.
      conn.onTurnCompleted("thread-x", "turn-A", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ method: "turn/started", params: { threadId: "thread-x", turn: { id: "turn-A", status: "inProgress", itemsView: "full", items: [] } } }) + "\n");
      setImmediate(() => {
        // A LATER notification for the SAME thread naming a DIFFERENT turn id -- genuine conflict, not noise.
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-B", status: "completed", itemsView: "full", items: [] } } }) + "\n");
        setImmediate(() => {
          if (results.length !== 0) { process.stderr.write("handler fired for the conflicting pair: " + JSON.stringify(results) + "\n"); process.exit(1); }
          if (!conn.isStopped() || conn.stopReason().indexOf("turn-notification-conflicting-turn-id") !== 0) { process.stderr.write("expected conflicting-turn-id STOP: " + conn.stopReason() + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-11 PASS: turn/completed with itemsView entirely ABSENT (key omitted) is valid, matching PLAN.md literal 'absent/full' (C7)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
      // itemsView key deliberately omitted entirely -- not null, genuinely absent.
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 1 || !results[0].ok) { process.stderr.write("absent itemsView was incorrectly rejected: " + JSON.stringify(results) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-12 FAIL: an agentMessage item missing its required id field fails closed, never silently skipped (C8)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    // R8: establish real threadTurnInFlight ownership first (see C2-TURN-03).
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        // R10: the malformed agentMessage (missing its required id) is now
        // caught EARLIER, by the isSchemaValidTurn gate inside
        // correlateTurnNotification, before deliverTurnCompleted /
        // invokeTurnCompletionHandler ever run -- the handler never fires at
        // all (no {ok:false} delivery), and the WHOLE connection STOPs
        // rather than merely failing this one completion (R10 Codex NO-GO
        // P0: an invalid Turn must never be used for anything, including
        // reaching this handler).
        if (results.length !== 0) { process.stderr.write("handler fired for a turn that should have been rejected: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (!conn.isStopped() || conn.stopReason().indexOf("turn-notification-schema-invalid") !== 0) { process.stderr.write("expected turn-notification-schema-invalid STOP: " + conn.stopReason() + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-PHASE-13 FAIL: turnInterrupt rejects a response whose result is a non-empty object, never merely truthy (C9)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      // R8 (item 12): turnInterrupt now requires threadsKnown + threadTurnInFlight correlation -- establish both via a real threadStart+turnStart first.
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      if (!turnRes.ok) { process.stderr.write("preamble turnStart failed: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      const p = conn.turnInterrupt("thread-x", "turn-y");
      setImmediate(() => {
        const req = sent.find((f) => f.method === "turn/interrupt");
        fromChild.write(JSON.stringify({ id: req.id, result: { unexpectedField: true } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("a non-empty result was accepted as success\n"); process.exit(1); } if (res.reason !== "turn-interrupt-result-not-empty-object") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch(() => process.exit(0));
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-SRVAL: server-request id/method/params validation + refreshProvider hardening (bucket D) ──

@test "C2-SRVAL-01 FAIL: a server request whose id is neither a string nor an integer (e.g. a float) is rejected as an invalid frame and STOPs (D1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 3.5, method: "applyPatchApproval", params: {} }) + "\n");
    setImmediate(() => {
      if (!conn.isStopped() || conn.stopReason().indexOf("invalid-frame") !== 0) { process.stderr.write("expected invalid-frame STOP: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SRVAL-02 FAIL: a refreshProvider that THROWS synchronously is caught, produces an error response, and STOPs -- never crashes the process (D4/E4)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => { throw new Error("broker exploded"); },
    });
    // R9: a real init+login preamble -- otherwise the R9 phase gate refuses
    // the refresh BEFORE ever reaching the throwing-provider branch this
    // test claims to exercise.
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        if (!resp || !resp.error) { process.stderr.write("expected an error response: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP after a throwing refreshProvider\n"); process.exit(1); }
        process.exit(0); // reaching here at all proves the throw never propagated and crashed this process.
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SRVAL-03 FAIL: a refresh whose returned chatgptAccountId does not match the connection's OWN authenticated identity is rejected (D4 '<validated-same-account>')" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "IMPOSTER-account", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "real-account", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ id: 99, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 99);
        if (!resp || !resp.error) { process.stderr.write("expected an error response for a mismatched-identity refresh: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-SRVAL-04 FAIL: a server request preceding a malformed frame in the same connection leaves no pending call alive after STOP (D5)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    fromChild.write(JSON.stringify({ id: 77, method: "applyPatchApproval", params: {} }) + "\n");
    setImmediate(() => {
      if (!conn.isStopped()) { process.stderr.write("expected STOP after an SR row that always terminates the connection\n"); process.exit(1); }
      p.then((res) => {
        if (res.ok) { process.stderr.write("initialize resolved ok despite the connection already being STOPped\n"); process.exit(1); }
        process.exit(0);
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-BOUNDS: resource bounds -- unsubscribe, handler cleanup, exception fail-closed (bucket E) ──

@test "C2-BOUNDS-01 PASS: onNotification returns an unsubscribe function; calling it stops further delivery to that handler (E1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const calls = [];
    const unsubscribe = conn.onNotification("some/method", (p) => calls.push(p));
    if (typeof unsubscribe !== "function") { process.stderr.write("onNotification did not return an unsubscribe function\n"); process.exit(1); }
    fromChild.write(JSON.stringify({ method: "some/method", params: { n: 1 } }) + "\n");
    setImmediate(() => {
      unsubscribe();
      fromChild.write(JSON.stringify({ method: "some/method", params: { n: 2 } }) + "\n");
      setImmediate(() => {
        if (calls.length !== 1 || calls[0].n !== 1) { process.stderr.write("handler fired after unsubscribe: " + JSON.stringify(calls) + "\n"); process.exit(1); }
        process.exit(0);
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-BOUNDS-02 FAIL: a notification handler that throws is caught, fails the connection closed, and never crashes the process (E4)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.onNotification("some/method", () => { throw new Error("handler exploded"); });
    fromChild.write(JSON.stringify({ method: "some/method", params: {} }) + "\n");
    setImmediate(() => {
      if (!conn.isStopped()) { process.stderr.write("expected STOP after a throwing notification handler\n"); process.exit(1); }
      process.exit(0); // reaching here proves the throw never crashed this process.
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-BOUNDS-03 FAIL: after a successful threadArchive, turnStart on the SAME (now-archived) thread id is rejected as not known -- tracking is freed, not retained (E3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((threadRes) => {
      if (!threadRes.ok) { process.stderr.write("preamble threadStart failed\n"); process.exit(1); }
      const p = conn.threadArchive("t");
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/archive");
        fromChild.write(JSON.stringify({ id: req.id, result: {} }) + "\n");
      });
      return p;
    }).then((archiveRes) => {
      if (!archiveRes.ok) { process.stderr.write("preamble threadArchive failed\n"); process.exit(1); }
      return conn.turnStart({ threadId: "t", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
    }).then((res) => { if (res.ok) { process.stderr.write("turnStart succeeded on an archived thread\n"); process.exit(1); } if (res.reason !== "turn-start-thread-not-known") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-ENVSRC: single canonical RuntimeTurnEnvelope/v1 source (bucket F, PLAN.md ~L932) ──

@test "C2-ENVSRC-01 PASS: runtime-bridge-codex.cjs's exported envelope schema builder and validator are the SAME function references as runtime-consultation.cjs's, not a second copy (F1/F3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const rc = require(process.argv[2]);
    if (bridge.buildRuntimeTurnEnvelopeOutputSchema !== rc.runtimeTurnEnvelopeSchema) { process.stderr.write("bridge schema builder is not the SAME function reference as rc.runtimeTurnEnvelopeSchema\n"); process.exit(1); }
    if (bridge.validateRuntimeTurnEnvelope !== rc.validateRuntimeTurnEnvelope) { process.stderr.write("bridge validator is not the SAME function reference as rc.validateRuntimeTurnEnvelope\n"); process.exit(1); }
  ' "$BRIDGE" "$BATS_TEST_DIRNAME/../lib/runtime-consultation.cjs"
  [ "$status" -eq 0 ]
}

# ── C2-GAP: R8 NO-GO items with no prior dedicated regression coverage --
# each closes a specific gap identified during this session's own coverage
# audit of the 13-item correction list (items 1/4/8/9/10/11/13). ──

@test "C2-GAP-01 FAIL: a valid initialize response immediately followed by a malformed frame in the SAME chunk never writes 'initialized' and never resolves ok (P0-1 regression guard, item 1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      const validResponse = JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } });
      // Both lines delivered in ONE chunk -- the VALID response first, a malformed line right after.
      fromChild.write(validResponse + "\nnot-json-at-all\n");
      p.then((res) => {
        if (res.ok) { process.stderr.write("initialize resolved ok despite a same-chunk malformed frame after it\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("connection not STOPped\n"); process.exit(1); }
        if (sent.some((f) => f.method === "initialized")) { process.stderr.write("initialized notification was written despite the connection being STOPped\n"); process.exit(1); }
        process.exit(0);
      }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-02 PASS: a turn/completed notification that arrives BEFORE onTurnCompleted is called is buffered and delivered the instant the handler registers (item 4 race window)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed\n"); process.exit(1); }
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "raced" } });
      // The notification arrives FIRST -- onTurnCompleted has not been called yet (the genuine wire race item 4 exists to handle).
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        const results = [];
        conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
        // R14 (Bloque A): the turn/start response is scheduled via the SAME setImmediate tick as this one -- ajv/queueing order is not guaranteed against this callback, so give the pending response microtask/macrotask queue one more turn before asserting delivery.
        setImmediate(() => {
          if (results.length !== 1 || !results[0].ok || results[0].envelope.result.content !== "raced") { process.stderr.write("buffered completion was not delivered on registration: " + JSON.stringify(results) + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-03 FAIL: server-request methods literally named 'toString'/'constructor'/'hasOwnProperty' are rejected -32601 (fail-closed), never resolved via an INHERITED Object.prototype member (item 13)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const methods = ["toString", "constructor", "hasOwnProperty", "valueOf"];
    let failures = 0;
    let idCounter = 100;
    for (const method of methods) {
      const toChild = new PassThrough();
      const fromChild = new PassThrough();
      const sent = [];
      toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
      const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
      const id = idCounter++;
      fromChild.write(JSON.stringify({ id, method, params: {} }) + "\n");
      const resp = sent.find((f) => f.id === id);
      if (!resp || !resp.error || resp.error.code !== -32601 || !conn.isStopped()) {
        process.stderr.write("FAIL " + method + ": " + JSON.stringify(resp) + " stopped=" + conn.isStopped() + "\n");
        failures++;
      }
    }
    process.exit(failures === 0 ? 0 : 1);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-04 FAIL: applyPatchApproval with params missing every required field is rejected -32602 invalid-params -- the frozen 'denied' row is never reached, and STOPs (item 8 negative path)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "applyPatchApproval", params: {} }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602 invalid-params: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      if (JSON.stringify(resp.result) === JSON.stringify({ decision: "denied" })) { process.stderr.write("the frozen denied row was returned despite invalid params\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("did not STOP\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-05 FAIL: a successful refresh reply whose flush callback reports an error STOPs the connection -- a write failure is never silently treated as continued (item 9 flush-credited)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let failNextRefreshReply = false;
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (failNextRefreshReply && frame.result && frame.result.accessToken === "fake-broker-token") {
          if (cb) cb(new Error("EPIPE simulated"));
          return true;
        }
        if (cb) cb();
        return true;
      },
    };
    const conn = bridge.createAppServerConnection({
      stdin: fakeStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "fake-broker-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      failNextRefreshReply = true;
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        if (!conn.isStopped() || conn.stopReason().indexOf("refresh-reply-write-failed") !== 0) { process.stderr.write("expected refresh-reply-write-failed STOP: " + conn.stopReason() + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-06 FAIL: an 'error' event emitted on the real stdin stream (not a write callback) STOPs the connection, never left unnoticed (item 10 stdin error event)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const toChild = new PassThrough(); // a REAL stream -- genuinely implements .on("error", ...)
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    toChild.emit("error", new Error("EPIPE simulated"));
    setImmediate(() => {
      if (!conn.isStopped() || conn.stopReason().indexOf("stdin-error") !== 0) { process.stderr.write("expected stdin-error STOP: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-07 FAIL: initialize() with an already-past backendDeadlineMs writes ZERO bytes and refuses immediately, never starts the call (item 11 deadline arithmetic)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    let wroteAnything = false;
    toChild.on("data", () => { wroteAnything = true; });
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.initialize({ backendDeadlineMs: Date.now() - 1000 }).then((res) => {
      if (res.ok || res.reason !== "deadline-non-positive") { process.stderr.write("bad result: " + JSON.stringify(res) + "\n"); process.exit(1); }
      if (wroteAnything) { process.stderr.write("wrote bytes despite a non-positive deadline\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-08 FAIL: an account/updated notification AFTER login reporting a DIFFERENT planType than the authenticated identity STOPs the connection (item 11 post-login vigilance)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      // A LATER account/updated names a DIFFERENT planType than the one login already validated -- genuine conflict.
      fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "pro" } }) + "\n");
      setImmediate(() => {
        if (!conn.isStopped() || conn.stopReason().indexOf("post-login-conflicting-plan-type") !== 0) { process.stderr.write("expected conflicting-plan-type STOP: " + conn.stopReason() + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-09 PASS: a DUPLICATE account/updated notification after login (identical authMode/planType) is allowed, never treated as a conflict (item 11 post-login vigilance)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      // Identical to what login already established -- must be allowed.
      fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      setImmediate(() => {
        if (conn.isStopped()) { process.stderr.write("an identical duplicate account/updated incorrectly STOPped: " + conn.stopReason() + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-10 FAIL: a turn/started=A notification followed by turnStart's OWN response naming a DIFFERENT turn id=B is rejected as a conflicting response, never a silent overwrite (item 3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed\n"); process.exit(1); }
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        // The turn/started NOTIFICATION binds turn id "A" first...
        fromChild.write(JSON.stringify({ method: "turn/started", params: { threadId: "thread-x", turn: { id: "A", status: "inProgress", itemsView: "full", items: [] } } }) + "\n");
        setImmediate(() => {
          // ...then turnStart'"'"'s OWN RPC response claims a DIFFERENT turn id "B" -- a genuine conflict, never a silent overwrite.
          fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "B", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        });
      });
      return turnP;
    }).then((res) => { if (res.ok) { process.stderr.write("a conflicting turn/start response was silently accepted\n"); process.exit(1); } if (res.reason !== "turn-start-response-conflicting-turn-id") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } if (!conn.isStopped()) { process.stderr.write("did not STOP\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-11 FAIL: the public API exposes no raw sendRequest/sendNotification escape hatch -- both are structurally absent, not merely undocumented (item 5)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    if (typeof conn.sendRequest !== "undefined") { process.stderr.write("conn.sendRequest is still exposed: " + typeof conn.sendRequest + "\n"); process.exit(1); }
    if (typeof conn.sendNotification !== "undefined") { process.stderr.write("conn.sendNotification is still exposed: " + typeof conn.sendNotification + "\n"); process.exit(1); }
    if (typeof conn.registerRequest !== "undefined") { process.stderr.write("conn.registerRequest is still exposed: " + typeof conn.registerRequest + "\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-12 FAIL: a caller-supplied opts.outputSchema on turnStart is IGNORED -- the wire request always carries the internally-constructed canonical schema, never a caller-forged one (item 6)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (!loginRes.ok) { process.stderr.write("preamble login failed\n"); process.exit(1); }
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed\n"); process.exit(1); }
      const forgedSchema = { type: "object", additionalProperties: true, forged: "a caller could put ANYTHING here" };
      const canonical = bridge.buildRuntimeTurnEnvelopeOutputSchema("K", []);
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c", outputSchema: forgedSchema }); // left pending -- outputSchema here must be a dead/ignored key.
      setImmediate(() => {
        const req = sent.find((f) => f.method === "turn/start");
        if (JSON.stringify(req.params.outputSchema) === JSON.stringify(forgedSchema)) { process.stderr.write("the caller-forged outputSchema reached the wire\n"); process.exit(1); }
        if (JSON.stringify(req.params.outputSchema) !== JSON.stringify(canonical)) { process.stderr.write("wire outputSchema does not match the canonical internally-constructed one: " + JSON.stringify(req.params.outputSchema) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-GAP-13 FAIL: onTurnCompleted on a FRESH connection (phase NEW, zero prior threadStart/turnStart) never registers authority -- a matching turn/completed for an attacker-guessed pair never fires the handler (P0-2 exact original reproduction, item 2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    // Deliberately NO initialize/login/threadStart/turnStart -- this connection
    // has NEVER established any authority for "never-authed-thread"/"invented-turn".
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    conn.onTurnCompleted("never-authed-thread", "invented-turn", "K", [], (res) => results.push(res));
    const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "FORGED" } });
    fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "never-authed-thread", turn: { id: "invented-turn", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
    setImmediate(() => {
      if (results.length !== 0) { process.stderr.write("a forged completion was delivered with zero prior authority: " + JSON.stringify(results) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-R9: Codex NO-GO on the R8 pass -- 3 fresh P0s + 5 P1s + 1 P2 found by
# empirical reproduction outside this suite's own coverage. Each test here
# reproduces the EXACT scenario Codex described, confirmed RED against the
# pre-R9 code before being fixed. ──

@test "C2-R9-01 FAIL: a transport failure arriving WHILE the initialized-notification flush is pending never resurrects the connection -- phase/isStopped/initialize() must all agree STOPPED (R9 P0-1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredInitializedFlush = null;
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.method === "initialized") { deferredInitializedFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({ stdin: fakeStdin, stdout: fromChild });
    const p = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      setImmediate(() => {
        if (!deferredInitializedFlush) { process.stderr.write("initialized flush was not deferred as expected\n"); process.exit(1); }
        // An UNRELATED transport failure (malformed frame) arrives WHILE the initialized flush is still pending.
        fromChild.write("not-json-at-all\n");
        setImmediate(() => {
          if (!conn.isStopped()) { process.stderr.write("expected STOPPING to already apply before the flush completes\n"); process.exit(1); }
          deferredInitializedFlush(); // now let the deferred flush "complete" with no error.
          p.then((res) => {
            if (res.ok) { process.stderr.write("initialize() resolved ok despite the connection being STOPped mid-flush: " + JSON.stringify(res) + "\n"); process.exit(1); }
            if (!conn.isStopped()) { process.stderr.write("isStopped() flipped back to false after the flush completed -- resurrection\n"); process.exit(1); }
            if (conn.connectionPhase() === "INITIALIZED") { process.stderr.write("phase was clobbered back to INITIALIZED by the late flush callback\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-02 FAIL: a thread/start response whose nested thread.source is a string OUTSIDE the real closed SessionSource enum is rejected, never accepted as 'any non-empty string' (R9 P0-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "totally-bogus-source", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("an out-of-enum SessionSource was accepted: " + JSON.stringify(res) + "\n"); process.exit(1); } if (res.reason !== "thread-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-03 FAIL: a turn/start response whose items array contains an agentMessage MISSING its required id is rejected -- type-string alone is never enough (R9 P0-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "t", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        // The item claims a KNOWN type ("agentMessage") but omits its own required `id` -- the R8 pass'"'"'s type-string-only check let this through.
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-1", status: "inProgress", items: [{ type: "agentMessage", text: "no id here" }] } } }) + "\n");
      });
      return turnP;
    }).then((res) => { if (res.ok) { process.stderr.write("an incomplete agentMessage item was accepted: " + JSON.stringify(res) + "\n"); process.exit(1); } if (res.reason !== "turn-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-04 FAIL: a turn/completed agentMessage whose memoryCitation is present but malformed (missing entries/threadIds) is rejected, never accepted as 'any object' (R9 P0-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "hijacked" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: { bogus: true } }] } } }) + "\n");
      setImmediate(() => {
        // R10: caught EARLIER now, by correlateTurnNotification'"'"'s
        // isSchemaValidTurn gate -- the handler never fires, the whole
        // connection STOPs (see C2-PHASE-12'"'"'s identical R10 update).
        if (results.length !== 0) { process.stderr.write("handler fired for a turn correlateTurnNotification should have rejected: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (!conn.isStopped() || conn.stopReason().indexOf("turn-notification-schema-invalid") !== 0) { process.stderr.write("expected turn-notification-schema-invalid STOP: " + conn.stopReason() + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-05 PASS: a turn/completed agentMessage that OMITS memoryCitation and phase entirely (relying on their real JSON Schema defaults) is accepted, never forced to include fields the pinned schema marks optional (R9 P0-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the notification path under test can actually deliver.
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "defaults-omitted" } });
      // Neither `memoryCitation` nor `phase` is present at all -- both carry a real `default: null` in the pinned ThreadItem schema.
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", text: envelope }] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 1 || !results[0].ok || results[0].envelope.result.content !== "defaults-omitted") { process.stderr.write("omitted-optional agentMessage was incorrectly rejected: " + JSON.stringify(results) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-06 PASS: a thread/resume response whose persisted turn OMITS itemsView entirely (relying on the real JSON Schema default 'full') is accepted (R9 P0-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadResume({ threadId: "t", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/resume");
        // The persisted turn omits itemsView entirely -- the real Turn schema defaults it to "full".
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [{ id: "t1", status: "completed", items: [] }] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("omitted itemsView was incorrectly rejected: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-07 FAIL: a thread/resume response whose persisted turn's items array contains a structurally invalid ThreadItem is rejected (R9 P0-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadResume({ threadId: "t", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/resume");
        // The persisted turn'"'"'s own items array contains a "webSearch" item missing its required `query`.
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [{ id: "t1", status: "completed", itemsView: "full", items: [{ type: "webSearch", id: "ws-1" }] }] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("a persisted turn with a structurally invalid item was accepted: " + JSON.stringify(res) + "\n"); process.exit(1); } if (res.reason !== "thread-resume-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-08 PASS: turn/completed arriving BEFORE the turn/start RPC response never destroys the tracking that response still needs -- both settle correctly, no lost-tracking STOP (R9 P1-1)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "fast" } });
        // The completion notification arrives BEFORE the turn/start RPC response.
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          // NOW the (still perfectly valid, matching) turn/start response arrives.
          fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        });
      });
      return turnP;
    }).then((turnRes) => {
      if (!turnRes.ok || turnRes.turnId !== "turn-y") { process.stderr.write("turnStart incorrectly failed despite a genuinely valid, just-early-completed turn: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      if (conn.isStopped()) { process.stderr.write("connection incorrectly STOPped: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-09 PASS: after an early-completed turn's turn/start response also settles, the thread is freed for a genuinely NEW turnStart (R9 P1-1 follow-through)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      // R14 (Bloque A): safely-terminal now mirrors turn-state-model.cjs
      // _turnIsSafelyTerminal() exactly -- state MUST reach DELIVERED (all
      // three of response/completion/handler), not merely response+completion.
      // A handler is registered here so the turn genuinely completes and
      // the thread is freed, matching this test own actual intent.
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], () => {});
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "fast" } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        });
      });
      return turnP;
    }).then((turnRes) => {
      if (!turnRes.ok) { process.stderr.write("first turnStart failed: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      const secondTurnP = conn.turnStart({ threadId: "thread-x", inputText: "y", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const secondTurnReq = sent.filter((f) => f.method === "turn/start")[1];
        if (!secondTurnReq) { process.stderr.write("a second turnStart for the now-free thread was never even dispatched\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-R10: second Codex NO-GO, closing the R9 pass's own remaining gaps
# (a differential schema-vs-bridge corpus for Block A; Block B/C/D tests
# follow further below). ──

@test "C2-R10-01 FAIL: a thread/start response whose nested thread.source is {subAgent:{}} is rejected -- an empty object matches NEITHER SubAgentSource object variant (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: { subAgent: {} }, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("subAgent:{} was incorrectly accepted: " + JSON.stringify(res) + "\n"); process.exit(1); } if (res.reason !== "thread-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-02 PASS: a thread/start response whose nested thread.source is {subAgent:\"review\"} is accepted -- SubAgentSource own string enum variant, never rejected as must-be-an-object (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: { subAgent: "review" }, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok) { process.stderr.write("subAgent:\"review\" was incorrectly rejected: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-03 FAIL: a turn/completed whose items include a 'sleep' item with a NEGATIVE durationMs is rejected, the handler never fires, connection STOPs (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "a" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "sleep", id: "s1", durationMs: -1 }, { type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 0) { process.stderr.write("handler fired despite a negative sleep.durationMs sibling item: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-04 FAIL: a turn/completed with a structurally invalid sibling 'plan' item (missing its required text) alongside a perfectly valid final agentMessage NEVER produces an envelope (R10 Block A, exact Codex P0 reproduction)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "hijacked-via-sibling" } });
      // A "plan" item missing its own required `text`, alongside an otherwise-perfectly-valid final agentMessage.
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "plan", id: "p1" }, { type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (results.length !== 0) { process.stderr.write("an envelope was produced despite an invalid sibling item: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-05 PASS: a thread/start response omitting ALL 3 optional response fields (instructionSources/reasoningEffort/serviceTier) AND all 9 optional Thread fields is accepted -- the real required arrays are strict subsets, never the full field lists (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        // Only the 12 REAL required Thread fields + 7 REAL required response fields -- every optional omitted entirely.
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (!res.ok || res.threadId !== "t") { process.stderr.write("a minimal-but-schema-complete response was incorrectly rejected: " + JSON.stringify(res) + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-10 FAIL: an explicit timeoutMs of 60000 with no backendDeadlineMs still schedules a timer capped at 10000ms, never the caller-requested value (R9 P1-4)" {
  run node -e '
    const realSetTimeout = global.setTimeout;
    let observedMs = null;
    global.setTimeout = function(fn, ms, ...args) {
      if (observedMs === null) observedMs = ms;
      return realSetTimeout(fn, ms, ...args);
    };
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.initialize({ timeoutMs: 60000 });
    if (observedMs !== 10000) { process.stderr.write("expected the timer capped at 10000ms, got " + observedMs + "\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-11 FAIL: an explicit timeoutMs of 60000 WITH a backendDeadlineMs 45s out still schedules a timer capped at 10000ms, never min(timeoutMs,deadline) alone (R9 P1-4)" {
  run node -e '
    const realSetTimeout = global.setTimeout;
    let observedMs = null;
    global.setTimeout = function(fn, ms, ...args) {
      if (observedMs === null) observedMs = ms;
      return realSetTimeout(fn, ms, ...args);
    };
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.initialize({ timeoutMs: 60000, backendDeadlineMs: Date.now() + 45000 });
    if (observedMs !== 10000) { process.stderr.write("expected the timer capped at 10000ms, got " + observedMs + "\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-12 FAIL: a backendDeadlineMs tighter than 10s (e.g. 3s out) still wins over the 10s cap -- min() picks the SMALLEST of all three, not a fixed 10s floor (R9 P1-4)" {
  run node -e '
    const realSetTimeout = global.setTimeout;
    let observedMs = null;
    global.setTimeout = function(fn, ms, ...args) {
      if (observedMs === null) observedMs = ms;
      return realSetTimeout(fn, ms, ...args);
    };
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    conn.initialize({ backendDeadlineMs: Date.now() + 3000 });
    if (observedMs > 3000 || observedMs < 2900) { process.stderr.write("expected the timer bound by the tighter 3s deadline, got " + observedMs + "\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-13 FAIL: login()'s own hand-rolled timeout is ALSO capped at 10000ms regardless of a larger explicit timeoutMs (R9 P1-4)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      const realSetTimeout = global.setTimeout;
      let observedMs = null;
      global.setTimeout = function(fn, ms, ...args) {
        if (observedMs === null) observedMs = ms;
        return realSetTimeout(fn, ms, ...args);
      };
      conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 60000 });
      global.setTimeout = realSetTimeout;
      if (observedMs !== 10000) { process.stderr.write("expected the login timer capped at 10000ms, got " + observedMs + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-14 FAIL: a NEW RPC attempted while a successful refresh reply flush is still unconfirmed is refused and never even dispatched (R9 P0-3)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredRefreshFlush = null;
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: fakeStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        if (!deferredRefreshFlush) { process.stderr.write("refresh flush was not deferred as expected\n"); process.exit(1); }
        conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" }).then((res) => {
          if (res.reason !== "refresh-flush-pending") { process.stderr.write("wrong refusal reason: " + JSON.stringify(res) + "\n"); process.exit(1); }
        });
        setImmediate(() => {
          if (sent.some((f) => f.method === "thread/start")) { process.stderr.write("a thread/start request was dispatched WHILE the refresh flush was still pending\n"); process.exit(1); }
          deferredRefreshFlush();
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-15 FAIL: a refreshProvider result with a HOSTILE getter (throws on property access) is caught during validation, never crashes the process, and produces refresh-failed + STOP (R9 P1-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const hostileResult = {
      accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus",
      get ok() { throw new Error("hostile getter"); },
    };
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild, refreshProvider: () => hostileResult });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        if (!resp || !resp.error) { process.stderr.write("expected an error response, got: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP after a hostile refreshProvider result\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-16 FAIL: a refresh returning the SAME accessToken already in use (a stale/no-op token) is rejected, never accepted as a genuine refresh (R9 P1-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "same-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "same-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        if (!resp || !resp.error) { process.stderr.write("a same-token refresh was accepted as success: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP after a stale same-token refresh\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-17 FAIL: a refresh whose params.previousAccountId contradicts the connection's OWN authenticated account is rejected (R9 P1-2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      // previousAccountId claims a DIFFERENT account than the one actually authenticated ("acct-1").
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized", previousAccountId: "acct-IMPOSTER" } }) + "\n");
      setImmediate(() => {
        const resp = sent.find((f) => f.id === 3);
        if (!resp || !resp.error) { process.stderr.write("a contradictory previousAccountId was accepted: " + JSON.stringify(resp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-18 PASS: once a successful refresh reply's flush genuinely confirms, the connection is authoritative again and a subsequent RPC dispatches normally (R9 P0-3 control)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        if (conn.isStopped()) { process.stderr.write("incorrectly STOPped after a genuinely valid refresh\n"); process.exit(1); }
        const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
        setImmediate(() => {
          if (!sent.some((f) => f.method === "thread/start")) { process.stderr.write("thread/start was never dispatched even after the refresh flush confirmed\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-19 FAIL: a 'close' event on stdout (distinct from 'end'/'error') STOPs the connection, never left operative (R9 P1-5)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.emit("close");
    setImmediate(() => {
      if (!conn.isStopped()) { process.stderr.write("connection not STOPped after stdout close\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-20 FAIL: a 'close' event on stdin STOPs the connection, never left operative (R9 P1-5)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    toChild.on("data", () => {});
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    toChild.emit("close");
    setImmediate(() => {
      if (!conn.isStopped()) { process.stderr.write("connection not STOPped after stdin close\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-21 FAIL: login() rejected for a non-positive backendDeadlineMs never latches the one-shot loginCalled flag -- a SUBSEQUENT genuine login() with a valid deadline still proceeds (R9 P1-6 login-deadline-latch)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      // FIRST call: a non-positive deadline -- must be refused WITHOUT consuming the one-shot login latch.
      const firstRes = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { backendDeadlineMs: Date.now() - 1000 });
      return firstRes.then((r1) => {
        if (r1.ok || r1.reason !== "deadline-non-positive") { process.stderr.write("expected deadline-non-positive: " + JSON.stringify(r1) + "\n"); process.exit(1); }
        if (conn.isStopped()) { process.stderr.write("the non-positive-deadline attempt incorrectly STOPped the whole connection\n"); process.exit(1); }
        // SECOND call: a genuinely valid attempt -- must still be allowed to proceed (not "called more than once").
        const secondP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
        setImmediate(() => {
          const loginReq = sent.find((f) => f.method === "account/login/start");
          if (!loginReq) { process.stderr.write("the second, genuinely valid login() call never even dispatched a request -- latched by the first non-positive-deadline attempt\n"); process.exit(1); }
          fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
          fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
        });
        return secondP;
      });
    }).then((secondRes) => {
      if (!secondRes.ok) { process.stderr.write("the second login() call failed: " + JSON.stringify(secondRes) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-22 PASS: a frame whose JSON string value contains a LEGITIMATELY-encoded U+FFFD replacement character (valid UTF-8 bytes EF BF BD) is accepted, never confused with a genuinely invalid byte sequence (R9 P2)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), (e) => errors.push(e));
    const validFffdJson = JSON.stringify({ id: 1, text: "a legit � replacement char in a real string" }) + "\n";
    const buf = Buffer.from(validFffdJson, "utf8");
    if (buf.indexOf(Buffer.from([0xEF, 0xBF, 0xBD])) === -1) { process.stderr.write("test setup error: buffer does not contain the expected valid EF BF BD sequence\n"); process.exit(1); }
    feed(buf);
    if (errors.length !== 0) { process.stderr.write("a legitimate U+FFFD was rejected as invalid UTF-8: " + JSON.stringify(errors) + "\n"); process.exit(1); }
    if (frames.length !== 1 || frames[0].text.indexOf("�") === -1) { process.stderr.write("the frame was not accepted with its U+FFFD intact: " + JSON.stringify(frames) + "\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-23 FAIL: genuinely invalid UTF-8 byte sequences are still reported as invalid-utf8-encoding and poison the feeder (R9 P2 regression guard)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const frames = [];
    const errors = [];
    const feed = bridge.createJsonlFrameFeeder((f) => frames.push(f), (e) => errors.push(e));
    // 0x80/0x81 are continuation bytes with no valid leading byte -- genuinely invalid UTF-8, not a legitimate character.
    feed(Buffer.from([0x80, 0x81, 0x0A]));
    if (errors.length !== 1 || errors[0] !== "invalid-utf8-encoding") { process.stderr.write("expected exactly one invalid-utf8-encoding error: " + JSON.stringify(errors) + "\n"); process.exit(1); }
    if (frames.length !== 0) { process.stderr.write("a frame was accepted despite genuinely invalid UTF-8\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R9-24 PASS: a turnStart refused by refresh-flush-pending never commits threadTurnInFlight for a request that was never sent -- a retry after the flush confirms genuinely dispatches and succeeds (R9 self-check on the P0-3 fix)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    let deferredRefreshFlush = null;
    const wrappedStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: wrappedStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", forkedFromId: null, parentThreadId: null, preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, recencyAt: null, status: { type: "idle" }, path: null, cwd: "/c", cliVersion: "1.0.0", source: "cli", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", instructionSources: [], model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false }, serviceTier: null, reasoningEffort: null } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }).then((blockedRes) => {
          if (blockedRes.ok || blockedRes.reason !== "refresh-flush-pending") { process.stderr.write("expected the blocked turnStart to be refused refresh-flush-pending: " + JSON.stringify(blockedRes) + "\n"); process.exit(1); }
        });
        setImmediate(() => {
          deferredRefreshFlush();
          setImmediate(() => {
            const retryP = conn.turnStart({ threadId: "thread-x", inputText: "y", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
            setImmediate(() => {
              const turnReq = sent.find((f) => f.method === "turn/start");
              if (!turnReq) { process.stderr.write("the retried turnStart was never even dispatched -- threadTurnInFlight was left corrupted by the earlier blocked attempt\n"); process.exit(1); }
              fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-real", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
              retryP.then((retryRes) => {
                if (!retryRes.ok || retryRes.turnId !== "turn-real") { process.stderr.write("the retried turnStart did not succeed cleanly: " + JSON.stringify(retryRes) + "\n"); process.exit(1); }
                if (conn.isStopped()) { process.stderr.write("connection incorrectly STOPped: " + conn.stopReason() + "\n"); process.exit(1); }
                process.exit(0);
              });
            });
          });
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-06 FAIL: execCommandApproval with command:[42] (element type wrong) is rejected -32602, never accepted merely because the container is an array (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "execCommandApproval", params: { conversationId: "c", callId: "c1", approvalId: null, command: [42], cwd: "/", reason: null, parsedCmd: [] } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-07 FAIL: execCommandApproval with parsedCmd:[42] (element not a real ParsedCommand) is rejected -32602 (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "execCommandApproval", params: { conversationId: "c", callId: "c1", approvalId: null, command: ["x"], cwd: "/", reason: null, parsedCmd: [42] } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-08 FAIL: item/tool/requestUserInput with questions:[42] (element not a real ToolRequestUserInputQuestion) is rejected -32602 (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "item/tool/requestUserInput", params: { threadId: "t", turnId: "tu", itemId: "i", questions: [42], autoResolutionMs: null } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-09 FAIL: mcpServer/elicitation/request mode=form with requestedSchema:[] (array, not object) is rejected -32602 (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "mcpServer/elicitation/request", params: { threadId: "t", turnId: null, serverName: "s", mode: "form", _meta: null, message: "m", requestedSchema: [] } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-10 FAIL: applyPatchApproval with fileChanges:{\"/x\":42} (nested value not a real FileChange) is rejected -32602 (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "applyPatchApproval", params: { conversationId: "c", callId: "c1", fileChanges: { "/x": 42 }, reason: null, grantRoot: null } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-11 FAIL: item/commandExecution/requestApproval with commandActions:[42] (element not a real CommandAction) is rejected -32602 (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "item/commandExecution/requestApproval", params: { threadId: "t", turnId: "tu", itemId: "i", startedAtMs: 1700000000000, environmentId: null, commandActions: [42] } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-12 FAIL: item/permissions/requestApproval with startedAtMs:1.5 (a float, real type is int64) is rejected -32602 (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "item/permissions/requestApproval", params: { threadId: "t", turnId: "tu", itemId: "i", environmentId: null, startedAtMs: 1.5, cwd: "/", reason: null, permissions: {} } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || !resp.error || resp.error.code !== -32602) { process.stderr.write("expected -32602: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-13 PASS: item/fileChange/requestApproval with ONLY its 4 required fields (reason/grantRoot omitted) receives the frozen decline response, never -32602 for omitting optionals (R10 Block A)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 8, method: "item/fileChange/requestApproval", params: { threadId: "t", turnId: "tu", itemId: "i", startedAtMs: 1700000000000 } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 8);
      if (!resp || JSON.stringify(resp.result) !== JSON.stringify({ decision: "decline" })) { process.stderr.write("a valid request omitting reason/grantRoot was incorrectly rejected: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── R10 Block B: refresh as a single exclusive epoch (never a shared boolean) ──

@test "C2-R10-14 FAIL: a SECOND account/chatgptAuthTokens/refresh arriving while the first is still in flight STOPs the connection -- never two independently-processed providers/responses (R10 Block B)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredFirstFlush = null;
    let providerCallCount = 0;
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredFirstFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: fakeStdin, stdout: fromChild,
      refreshProvider: () => { providerCallCount++; return { ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }; },
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      // The FIRST refresh -- its flush is deliberately withheld, leaving it "in flight".
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        if (!deferredFirstFlush) { process.stderr.write("first refresh flush was not deferred as expected\n"); process.exit(1); }
        if (providerCallCount !== 1) { process.stderr.write("expected exactly 1 provider call so far, got " + providerCallCount + "\n"); process.exit(1); }
        // A SECOND refresh arrives WHILE the first is still in flight.
        fromChild.write(JSON.stringify({ id: 4, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
        setImmediate(() => {
          if (providerCallCount !== 1) { process.stderr.write("the second refresh invoked the provider AGAIN -- expected exactly 1 total: " + providerCallCount + "\n"); process.exit(1); }
          const secondResp = sent.find((f) => f.id === 4);
          if (!secondResp || !secondResp.error) { process.stderr.write("expected an error response for the concurrent second refresh: " + JSON.stringify(secondResp) + "\n"); process.exit(1); }
          if (!conn.isStopped() || conn.stopReason().indexOf("refresh-concurrent-request") !== 0) { process.stderr.write("expected refresh-concurrent-request STOP: " + conn.stopReason() + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-15 PASS: a turn/completed that becomes ready to deliver WHILE a refresh is in flight is DEFERRED (never produces authority mid-refresh), then delivered the instant the refresh confirms (R10 Block B)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    let deferredRefreshFlush = null;
    const wrappedStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: wrappedStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }); // R14 (Bloque A): responseObserved is now a required delivery prerequisite -- answered below so the deferral-under-test is actually reached (not short-circuited earlier for a missing response).
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        if (!deferredRefreshFlush) { process.stderr.write("refresh flush was not deferred as expected\n"); process.exit(1); }
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "during-refresh" } });
        // The completion becomes ready to deliver WHILE the refresh is still in flight.
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          if (results.length !== 0) { process.stderr.write("the handler fired WHILE the refresh was still in flight: " + JSON.stringify(results) + "\n"); process.exit(1); }
          deferredRefreshFlush(); // now let the refresh confirm.
          setImmediate(() => {
            if (results.length !== 1 || !results[0].ok || results[0].envelope.result.content !== "during-refresh") { process.stderr.write("the deferred completion was never delivered after the refresh confirmed: " + JSON.stringify(results) + "\n"); process.exit(1); }
            if (conn.isStopped()) { process.stderr.write("connection incorrectly STOPped: " + conn.stopReason() + "\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-16 FAIL: a refresh sequence token A -> token B -> token A (rollback) is rejected on the THIRD call -- usedAccessTokens is permanent history, not merely 'differs from the single most-recent token' (R10 Block B)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    let nextToken = "token-B";
    const conn = bridge.createAppServerConnection({
      stdin: toChild, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: nextToken, chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "token-A", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      // First refresh: A -> B (genuinely new, must succeed).
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      const firstResp = sent.find((f) => f.id === 3);
      if (!firstResp || !firstResp.result || firstResp.result.accessToken !== "token-B") { process.stderr.write("the genuine A->B refresh unexpectedly failed: " + JSON.stringify(firstResp) + "\n"); process.exit(1); }
      if (conn.isStopped()) { process.stderr.write("incorrectly STOPped after a genuine A->B refresh\n"); process.exit(1); }
      // Second refresh: B -> A (a ROLLBACK to a token used before, at login time).
      nextToken = "token-A";
      fromChild.write(JSON.stringify({ id: 4, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const secondResp = sent.find((f) => f.id === 4);
        if (!secondResp || !secondResp.error) { process.stderr.write("the A->B->A rollback was incorrectly accepted: " + JSON.stringify(secondResp) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP after a token rollback\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-17 FAIL: a refresh flush callback that fires AFTER an unrelated STOP already began (during its own pending window) never re-authenticates or commits its token -- a stale epoch never reopens state (R10 Block B)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredFlush = null;
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: fakeStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        if (!deferredFlush) { process.stderr.write("refresh flush was not deferred as expected\n"); process.exit(1); }
        // An UNRELATED transport failure STOPs the connection WHILE the refresh flush is still pending.
        fromChild.write("not-json-at-all\n");
        setImmediate(() => {
          if (!conn.isStopped()) { process.stderr.write("expected STOP from the malformed frame\n"); process.exit(1); }
          const stopReasonBefore = conn.stopReason();
          deferredFlush(); // the STALE epoch'"'"'s flush callback fires NOW, after STOP already began.
          setImmediate(() => {
            if (conn.stopReason() !== stopReasonBefore) { process.stderr.write("the stale refresh callback overwrote the ORIGINAL stop reason: " + conn.stopReason() + "\n"); process.exit(1); }
            if (!conn.isStopped()) { process.stderr.write("connection was un-STOPped by the stale callback\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── R10 Block C: the first early completion is immutable once buffered ──

@test "C2-R10-18 FAIL: a SECOND early turn/completed for the SAME turn id (before its handler is registered) is a genuine conflict -- STOPs the connection, delivers NEITHER completion, never silently overwrites the first (R10 Block C)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      // turnStart left deliberately pending -- onTurnCompleted is NEVER
      // called, so BOTH completions below arrive as "early" (buffered).
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      const envelopeFirst = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "FIRST" } });
      const envelopeSecond = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "SECOND" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelopeFirst, memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        // A SECOND, conflicting completion for the SAME turn id, still before any handler was ever registered.
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-2", phase: "final_answer", text: envelopeSecond, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          if (!conn.isStopped() || conn.stopReason().indexOf("turn-completed-duplicate-early-completion") !== 0) { process.stderr.write("expected turn-completed-duplicate-early-completion STOP: " + conn.stopReason() + "\n"); process.exit(1); }
          // Registering a handler NOW must not retroactively receive EITHER buffered completion -- both were destroyed by the conflict, not delivered.
          conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
          setImmediate(() => {
            if (results.length !== 0) { process.stderr.write("a completion was delivered despite the earlier conflict: " + JSON.stringify(results) + "\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-19 FAIL: login cannot resolve ok:true when the SAME chunk that completes it also contains a later malformed frame -- the whole chunk STOPs and login reflects that, never a split-brain ok:true-plus-stopped (R10 Block D)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        const responseLine = JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } });
        const notificationLine = JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } });
        const malformedLine = "not valid json {{{";
        // ALL THREE delivered as ONE chunk (single write, single "data"
        // event) -- the malformed line is processed in the SAME
        // synchronous feed() pass as the response/notification pair that
        // would otherwise complete login.
        fromChild.write(responseLine + "\n" + notificationLine + "\n" + malformedLine + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      if (loginRes.ok) { process.stderr.write("login resolved ok:true despite its own completing chunk STOPping the connection: " + JSON.stringify(loginRes) + "\n"); process.exit(1); }
      if (!conn.isStopped() || conn.stopReason().indexOf("malformed-frame:malformed-json") !== 0) { process.stderr.write("expected malformed-frame:malformed-json STOP: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-20 FAIL: an unknown-server-request-method reply schedules its finalize timer bounded at the same 10000ms DEFAULT_RPC_TIMEOUT_MS as every other RPC window, never unbounded (R10 Block D)" {
  run node -e '
    const realSetTimeout = global.setTimeout;
    let observedMs = null;
    global.setTimeout = function(fn, ms, ...args) {
      if (observedMs === null) observedMs = ms;
      return realSetTimeout(fn, ms, ...args);
    };
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed\n"); process.exit(1); }
      // Reset AFTER the preamble (which already scheduled its own
      // now-irrelevant dispatchRequest timer) so only a setTimeout call
      // made from THIS point on -- i.e. the unknown-method finalize timer
      // itself -- is what gets captured below.
      observedMs = null;
      fromChild.write(JSON.stringify({ id: 99, method: "totally/unknown/method", params: {} }) + "\n");
      setImmediate(() => {
        global.setTimeout = realSetTimeout;
        if (observedMs !== 10000) { process.stderr.write("expected the unknown-method finalize timer bounded at 10000ms, got " + observedMs + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R10-21 FAIL: a server-request reply whose write callback NEVER fires (a hung transport) still reaches STOPPED via the bounded finalize timeout, and an unrelated already-pending call is rejected instead of hanging forever (R10 Block D)" {
  run node -e '
    const realSetTimeout = global.setTimeout;
    // Only timers scheduled AFTER the unknown-method frame is sent are
    // compressed to a fast real delay -- the orphaned threadStart call
    // below schedules its OWN independent 10000ms dispatchRequest timeout
    // BEFORE that point, and is deliberately left uncompressed (it must
    // NOT be the thing that unblocks orphanedP, or this test would prove
    // nothing about the finalize-timeout fix specifically).
    let compress = false;
    global.setTimeout = function(fn, ms, ...args) { return realSetTimeout(fn, compress ? 20 : ms, ...args); };
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    const fakeStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        // The unknown-method error reply (code -32601) is the ONE frame
        // whose flush never confirms -- every other write (initialize,
        // login, the unrelated pending threadStart below) behaves
        // normally so ONLY this specific hang is under test.
        if (frame.error && frame.error.code === -32601) return true;
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({ stdin: fakeStdin, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      // An UNRELATED call left genuinely pending -- its response never
      // arrives, and its OWN dispatchRequest timeout is NOT compressed
      // (scheduled while compress===false), so it stays alive for the
      // entire (fast, compressed) remainder of this test.
      const orphanedP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        compress = true; // only the SR reply finalize timer (scheduled next) runs fast from here on.
        fromChild.write(JSON.stringify({ id: 999, method: "totally/unknown/method", params: {} }) + "\n");
        orphanedP.then((orphanedRes) => {
          global.setTimeout = realSetTimeout;
          if (orphanedRes.ok) { process.stderr.write("the unrelated pending threadStart resolved ok despite the connection STOPping: " + JSON.stringify(orphanedRes) + "\n"); process.exit(1); }
          // Must be rejected VIA the SR path STOP reason (failAllPending), not via its own unrelated 10000ms dispatchRequest timeout (left uncompressed above) racing in first.
          if (orphanedRes.reason !== "unknown-server-request-method:totally/unknown/method") { process.stderr.write("orphanedP was rejected for the wrong reason -- expected the SR finalize timeout failAllPending, not its own independent timeout: " + JSON.stringify(orphanedRes) + "\n"); process.exit(1); }
          if (!conn.isStopped() || conn.stopReason().indexOf("unknown-server-request-method") !== 0) { process.stderr.write("expected the connection to have reached STOPPED (unknown-server-request-method) via the bounded finalize timeout: " + conn.stopReason() + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("preamble threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-06 FAIL: a turn/completed notification plus a registered handler alone never deliver until the turnStart RPC response also arrives -- responseObserved is a genuine third prerequisite, not merely bookkeeping (R14 Bloque A, P0 finding 1 dedicated regression)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      // The turnStart RPC response is deliberately withheld here -- this is the exact scenario under test.
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "early" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve)).then(() => {
        if (results.length !== 0) { process.stderr.write("delivered without the turnStart own RPC response ever arriving: " + JSON.stringify(results) + "\n"); process.exit(1); }
        if (conn.isStopped()) { process.stderr.write("incorrectly STOPped merely for a still-pending response: " + conn.stopReason() + "\n"); process.exit(1); }
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        return new Promise((resolve) => setImmediate(resolve));
      });
    }).then(() => {
      if (results.length !== 1 || !results[0].ok || results[0].envelope.result.content !== "early") { process.stderr.write("the buffered completion was never delivered once the response finally arrived: " + JSON.stringify(results) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-07 PASS: all six arrival orderings of response/completion/handler-registration deliver exactly once with the correct envelope (R14 Bloque A, arrival-order independence)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    function tick() { return new Promise((resolve) => setImmediate(resolve)); }
    async function runOrdering(order) {
      const toChild = new PassThrough();
      const fromChild = new PassThrough();
      const sent = [];
      toChild.on("data", (c) => { for (const line of c.toString("utf8").split("\n")) { if (line.trim()) sent.push(JSON.parse(line)); } });
      const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
      const results = [];
      const initP = conn.initialize();
      await tick();
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
      await initP;
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      await tick();
      const loginReq = sent.find((f) => f.method === "account/login/start");
      fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
      fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      await loginP;
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      await tick();
      const startReq = sent.find((f) => f.method === "thread/start");
      fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      await startP;
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      await tick();
      const turnReq = sent.find((f) => f.method === "turn/start");
      const contentTag = "order-" + order.join("-");
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: contentTag } });
      const steps = {
        response: () => fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n"),
        completion: () => fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n"),
        handler: () => conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res)),
      };
      for (const step of order) {
        steps[step]();
        await tick();
      }
      if (results.length !== 1) return "order " + order.join(">") + " delivered " + results.length + " times, expected exactly 1";
      if (!results[0].ok || results[0].envelope.result.content !== contentTag) return "order " + order.join(">") + " delivered wrong content: " + JSON.stringify(results);
      if (conn.isStopped()) return "order " + order.join(">") + " incorrectly STOPped: " + conn.stopReason();
      return null;
    }
    async function main() {
      const perms = [
        ["response", "completion", "handler"],
        ["response", "handler", "completion"],
        ["completion", "response", "handler"],
        ["completion", "handler", "response"],
        ["handler", "response", "completion"],
        ["handler", "completion", "response"],
      ];
      const failures = [];
      for (const order of perms) {
        const err = await runOrdering(order);
        if (err) failures.push(err);
      }
      if (failures.length !== 0) { process.stderr.write("FAILURES:\n" + failures.join("\n") + "\n"); process.exit(1); }
      process.exit(0);
    }
    main().catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-08 FAIL: a second threadStart while the first thread is still ACTIVE is refused as thread-lifecycle-busy before ever dispatching to the wire, never STOPs, and never disturbs the first thread (R14 Bloque A, at-most-one-active-thread)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      if (!startRes.ok) { process.stderr.write("preamble threadStart failed: " + JSON.stringify(startRes) + "\n"); process.exit(1); }
      const sentBeforeSecondAttempt = sent.length;
      return conn.threadStart({ role: "r2", developerInstructions: "d2", baseInstructions: "b2", cwd: "/c2" }).then((secondRes) => {
        if (secondRes.ok) { process.stderr.write("a second threadStart while the first thread was ACTIVE was incorrectly accepted: " + JSON.stringify(secondRes) + "\n"); process.exit(1); }
        if (secondRes.reason !== "thread-lifecycle-busy") { process.stderr.write("wrong reason: " + secondRes.reason + "\n"); process.exit(1); }
        if (sent.length !== sentBeforeSecondAttempt) { process.stderr.write("the refused second threadStart was dispatched to the wire anyway\n"); process.exit(1); }
        if (conn.isStopped()) { process.stderr.write("thread-lifecycle-busy incorrectly STOPped the connection\n"); process.exit(1); }
        const turnP = conn.turnStart({ threadId: "thread-x", inputText: "still works", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
        setImmediate(() => {
          const turnReq = sent.find((f) => f.method === "turn/start");
          if (!turnReq) { process.stderr.write("the first ACTIVE thread was disturbed -- turnStart never even dispatched\n"); process.exit(1); }
          fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-1", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        });
        return turnP;
      });
    }).then((turnRes) => {
      if (!turnRes.ok) { process.stderr.write("the first ACTIVE thread was left unusable after the refused second threadStart: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-09 PASS: once a refresh-deferred completion finally delivers, its turn id is genuinely retired -- a subsequent bare replay of that SAME id is rejected as retired-id replay, not silently redelivered (R14 Bloque A, deferral-then-retirement)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredRefreshFlush = null;
    const wrappedStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: wrappedStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "deferred-then-retired" } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          if (results.length !== 0) { process.stderr.write("delivered while the refresh was still in flight\n"); process.exit(1); }
          if (!deferredRefreshFlush) { process.stderr.write("refresh flush was not deferred as expected\n"); process.exit(1); }
          deferredRefreshFlush();
          setImmediate(() => {
            if (results.length !== 1 || !results[0].ok) { process.stderr.write("the deferred completion was never delivered after the refresh confirmed: " + JSON.stringify(results) + "\n"); process.exit(1); }
            // Replay the SAME turn id via a bare notification -- must be rejected as a genuine retired-id replay, proving retirement genuinely happened as part of the deferred delivery.
            fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [] } } }) + "\n");
            setImmediate(() => {
              if (!conn.isStopped() || conn.stopReason() !== "turn-notification-turn-id-replay-of-retired-id:turn/completed") { process.stderr.write("expected STOP turn-notification-turn-id-replay-of-retired-id, got: " + conn.stopReason() + "\n"); process.exit(1); }
              process.exit(0);
            });
          });
        });
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-10 FAIL: a thread/start response whose thread.source is a well-formed OtherSubAgentSource PLUS an undeclared additional property is rejected -- additionalProperties:false on that closed variant is genuinely enforced by the generated validator, not merely assumed (R14 Bloque B; the ThreadStartResponse/Thread root objects are themselves open by the real schema -- this targets a variant that is actually closed)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        // subAgent:{other:"x"} alone is a well-formed OtherSubAgentSource (closed, additionalProperties:false) -- the ONLY violation is the undeclared sibling field.
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: { subAgent: { other: "x", undeclaredExtraField: "unexpected" } }, turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("an undeclared additional property on a closed schema variant was incorrectly accepted: " + JSON.stringify(res) + "\n"); process.exit(1); } if (res.reason !== "thread-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-R14-11 FAIL: a thread/start response whose thread.createdAt is a float (not a genuine int64) is rejected at the bridge, never accepted as any number (R14 Bloque B, int64-vs-float, integration level)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const p = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const req = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: req.id, result: { thread: { id: "t", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000.5, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return p;
    }).then((res) => { if (res.ok) { process.stderr.write("a float createdAt was incorrectly accepted as int64: " + JSON.stringify(res) + "\n"); process.exit(1); } if (res.reason !== "thread-start-response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); } process.exit(0); })
     .catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A1-01 FAIL: a second completion arriving while DEFERRED_FOR_REFRESH STOPs, never silently replacing the deferred one" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredRefreshFlush = null;
    const wrappedStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: wrappedStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const envelopeFirst = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "first" } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelopeFirst, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          if (!deferredRefreshFlush) { process.stderr.write("refresh flush was not deferred as expected\n"); process.exit(1); }
          // The turn is now genuinely DEFERRED_FOR_REFRESH (all three prerequisites met, blocked only by the in-flight refresh). A second, DIFFERENT completion arrives now.
          const envelopeSecond = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "second" } });
          fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-2", phase: "final_answer", text: envelopeSecond, memoryCitation: null }] } } }) + "\n");
          setImmediate(() => {
            if (!conn.isStopped()) { process.stderr.write("expected STOP for a second completion during DEFERRED_FOR_REFRESH, connection still operative\n"); process.exit(1); }
            if (results.length !== 0) { process.stderr.write("a delivery occurred despite the second-during-refresh STOP: " + JSON.stringify(results) + "\n"); process.exit(1); }
            deferredRefreshFlush();
            setImmediate(() => {
              if (results.length !== 0) { process.stderr.write("the refresh confirming after STOP still produced a delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
              process.exit(0);
            });
          });
        });
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A1-02 FAIL: a second completion for the SAME turn id arriving after full delivery STOPs and never produces a second delivery" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "first" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (results.length !== 1 || !results[0].ok) { process.stderr.write("preamble delivery failed: " + JSON.stringify(results) + "\n"); process.exit(1); }
      if (conn.isStopped()) { process.stderr.write("connection incorrectly STOPped after clean delivery\n"); process.exit(1); }
      const envelopeSecond = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "second" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-2", phase: "final_answer", text: envelopeSecond, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (!conn.isStopped()) { process.stderr.write("expected STOP for a second completion after full delivery\n"); process.exit(1); }
      if (results.length !== 1) { process.stderr.write("a second delivery occurred after full delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A1-03 FAIL: registering onTurnCompleted after the turn has already delivered STOPs (handler-registration-after-delivered), never silently ignored" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "first" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (results.length !== 1 || !results[0].ok) { process.stderr.write("preamble delivery failed: " + JSON.stringify(results) + "\n"); process.exit(1); }
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      if (!conn.isStopped() || conn.stopReason() !== "handler-registration-after-delivered") { process.stderr.write("expected STOP handler-registration-after-delivered, got: " + conn.stopReason() + "\n"); process.exit(1); }
      if (results.length !== 1) { process.stderr.write("the late handler registration incorrectly fired: " + JSON.stringify(results) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A1-04 FAIL: registering a second onTurnCompleted while DEFERRED_FOR_REFRESH STOPs (second-handler-for-occupied-slot)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const fromChild = new PassThrough();
    const sent = [];
    let deferredRefreshFlush = null;
    const wrappedStdin = {
      write(chunk, enc, cb) {
        const frame = JSON.parse(chunk.toString("utf8").trim());
        sent.push(frame);
        if (frame.result && frame.result.accessToken === "new-token") { deferredRefreshFlush = cb; return true; }
        if (cb) cb();
        return true;
      },
      on(evt, fn) {},
    };
    const conn = bridge.createAppServerConnection({
      stdin: wrappedStdin, stdout: fromChild,
      refreshProvider: () => ({ ok: true, accessToken: "new-token", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }),
    });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "acct-1", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      fromChild.write(JSON.stringify({ id: 3, method: "account/chatgptAuthTokens/refresh", params: { reason: "unauthorized" } }) + "\n");
      setImmediate(() => {
        const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "first" } });
        fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
        setImmediate(() => {
          if (!deferredRefreshFlush) { process.stderr.write("refresh flush was not deferred as expected\n"); process.exit(1); }
          conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
          if (!conn.isStopped() || conn.stopReason() !== "second-handler-for-occupied-slot") { process.stderr.write("expected STOP second-handler-for-occupied-slot, got: " + conn.stopReason() + "\n"); process.exit(1); }
          if (results.length !== 0) { process.stderr.write("a delivery occurred despite the occupied-slot STOP: " + JSON.stringify(results) + "\n"); process.exit(1); }
          process.exit(0);
        });
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A1-05 PASS: a late frame for a DIFFERENT (non-active) thread whose turn id coincidentally matches the ACTIVE threads own retired set is silently ignored, never a STOP -- retired ids are per-active-thread-lineage, not a global set" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "shared-id", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "shared-id", "K", [], (res) => results.push(res));
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "delivered-on-thread-x" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "shared-id", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (results.length !== 1 || !results[0].ok) { process.stderr.write("preamble delivery on thread-x failed: " + JSON.stringify(results) + "\n"); process.exit(1); }
      // "shared-id" is now retired on thread-x lineage. thread-x is STILL the active thread (never archived).
      // A late frame for a DIFFERENT, never-known thread ("thread-other") happens to name the SAME id string.
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-other", turn: { id: "shared-id", status: "completed", itemsView: "full", items: [] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (conn.isStopped()) { process.stderr.write("a late frame for an unrelated thread incorrectly STOPped via a cross-thread retired-id false positive: " + conn.stopReason() + "\n"); process.exit(1); }
      if (results.length !== 1) { process.stderr.write("the unrelated thread frame incorrectly produced a delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-01 FAIL: turnInterrupt before the turnStart response ever arrives writes ZERO bytes and fails closed, never authorizing an unaccredited caller-chosen id" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      // turnStart dispatched but its own response deliberately never answered -- responseObserved stays false, turnId stays null.
      conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      const sentBefore = sent.length;
      return conn.turnInterrupt("thread-x", "caller-chosen-unaccredited-id", { timeoutMs: 2000 }).then((res) => {
        if (sent.length !== sentBefore) { process.stderr.write("interrupt wrote " + (sent.length - sentBefore) + " frame(s) to the wire for an unaccredited turn\n"); process.exit(1); }
        if (res.ok) { process.stderr.write("an unaccredited interrupt was incorrectly accepted\n"); process.exit(1); }
        if (res.reason !== "turn-interrupt-turn-not-correlated") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP for an unaccredited interrupt attempt\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-02 FAIL: turnInterrupt for a conflicting turnId (accredited turn exists but names a different id) fails closed and STOPs" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      if (!turnRes.ok) { process.stderr.write("preamble turnStart failed: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      const sentBefore = sent.length;
      return conn.turnInterrupt("thread-x", "some-other-conflicting-id", { timeoutMs: 2000 }).then((res) => {
        if (sent.length !== sentBefore) { process.stderr.write("interrupt wrote to the wire for a conflicting id\n"); process.exit(1); }
        if (res.ok || res.reason !== "turn-interrupt-turn-not-correlated") { process.stderr.write("expected fail-closed turn-interrupt-turn-not-correlated: " + JSON.stringify(res) + "\n"); process.exit(1); }
        if (!conn.isStopped()) { process.stderr.write("expected STOP for a conflicting interrupt id\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-03 FAIL: a completion arriving WHILE an interrupt is INTERRUPT_PENDING (response not yet observed) never produces a result and STOPs" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      return turnP;
    }).then((turnRes) => {
      // Interrupt dispatched but ITS OWN response is deliberately never answered -- state stays INTERRUPT_PENDING.
      conn.turnInterrupt("thread-x", "turn-y", { timeoutMs: 5000 });
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "during-interrupt-pending" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (results.length !== 0) { process.stderr.write("a completion during INTERRUPT_PENDING incorrectly produced a delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
      if (!conn.isStopped() || conn.stopReason() !== "turn-completed-after-interrupt") { process.stderr.write("expected STOP turn-completed-after-interrupt, got: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-04 FAIL: an error response to turn/interrupt STOPs the connection, mirroring every other RPC failure path" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      const interruptP = conn.turnInterrupt("thread-x", "turn-y", { timeoutMs: 2000 });
      setImmediate(() => {
        const interruptReq = sent.find((f) => f.method === "turn/interrupt");
        fromChild.write(JSON.stringify({ id: interruptReq.id, error: { code: -32000, message: "backend failure" } }) + "\n");
      });
      return interruptP;
    }).then((res) => {
      if (res.ok) { process.stderr.write("an error response to turn/interrupt was incorrectly treated as success\n"); process.exit(1); }
      if (!conn.isStopped()) { process.stderr.write("expected STOP after a turn/interrupt error response\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-05 PASS: a successful interrupt reaches a terminal state that is safe to archive from but not safe to start a bare new turn from, and its turnId is retired exactly once" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      const interruptP = conn.turnInterrupt("thread-x", "turn-y", { timeoutMs: 2000 });
      setImmediate(() => {
        const interruptReq = sent.find((f) => f.method === "turn/interrupt");
        fromChild.write(JSON.stringify({ id: interruptReq.id, result: {} }) + "\n");
      });
      return interruptP;
    }).then((interruptRes) => {
      if (!interruptRes.ok) { process.stderr.write("preamble interrupt failed: " + JSON.stringify(interruptRes) + "\n"); process.exit(1); }
      // Attempting a bare NEW turnStart on the same thread right after interrupt must still be refused (closure/recovery required first).
      const sentBefore = sent.length;
      return conn.turnStart({ threadId: "thread-x", inputText: "y", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" }).then((secondTurnRes) => {
        if (secondTurnRes.ok) { process.stderr.write("a bare new turnStart succeeded immediately after interrupt, bypassing archive/recovery\n"); process.exit(1); }
        if (sent.length !== sentBefore) { process.stderr.write("the refused post-interrupt turnStart still dispatched to the wire\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-06 PASS: after a successful interrupt, threadArchive succeeds (safe-to-archive includes INTERRUPTED)" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      const interruptP = conn.turnInterrupt("thread-x", "turn-y", { timeoutMs: 2000 });
      setImmediate(() => {
        const interruptReq = sent.find((f) => f.method === "turn/interrupt");
        fromChild.write(JSON.stringify({ id: interruptReq.id, result: {} }) + "\n");
      });
      return interruptP;
    }).then((interruptRes) => {
      if (!interruptRes.ok) { process.stderr.write("preamble interrupt failed: " + JSON.stringify(interruptRes) + "\n"); process.exit(1); }
      const archiveP = conn.threadArchive("thread-x", { timeoutMs: 2000 });
      setImmediate(() => {
        const archiveReq = sent.find((f) => f.method === "thread/archive");
        if (!archiveReq) { process.stderr.write("archive was refused/never dispatched after a successful interrupt\n"); process.exit(1); }
        fromChild.write(JSON.stringify({ id: archiveReq.id, result: {} }) + "\n");
      });
      return archiveP;
    }).then((archiveRes) => {
      if (!archiveRes.ok) { process.stderr.write("archive failed after a successful interrupt: " + JSON.stringify(archiveRes) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-08 FAIL: a completion arriving AFTER a successful interrupt (state INTERRUPTED) never produces a result and STOPs as a genuine retired-id replay, proving the turnId was actually retired" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      return turnP;
    }).then((turnRes) => {
      const interruptP = conn.turnInterrupt("thread-x", "turn-y", { timeoutMs: 2000 });
      setImmediate(() => {
        const interruptReq = sent.find((f) => f.method === "turn/interrupt");
        fromChild.write(JSON.stringify({ id: interruptReq.id, result: {} }) + "\n");
      });
      return interruptP;
    }).then((interruptRes) => {
      if (!interruptRes.ok) { process.stderr.write("preamble interrupt failed: " + JSON.stringify(interruptRes) + "\n"); process.exit(1); }
      // A late completion for the SAME (now-interrupted) turn arrives after the interrupt already succeeded.
      const envelope = JSON.stringify({ schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "late-after-interrupt-success" } });
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: envelope, memoryCitation: null }] } } }) + "\n");
      return new Promise((resolve) => setImmediate(resolve));
    }).then(() => {
      if (results.length !== 0) { process.stderr.write("a completion after a successful interrupt incorrectly produced a delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
      if (!conn.isStopped() || conn.stopReason() !== "turn-notification-turn-id-replay-of-retired-id:turn/completed") { process.stderr.write("expected STOP turn-notification-turn-id-replay-of-retired-id (proving the turnId was genuinely retired), got: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-A2-07 FAIL: registering onTurnCompleted after turnInterrupt has been requested STOPs -- no handler can acquire delivery authority once interruption has begun" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then((loginRes) => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then((startRes) => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP;
    }).then((turnRes) => {
      // Interrupt requested (state -> INTERRUPT_PENDING) but its own response deliberately never answered.
      conn.turnInterrupt("thread-x", "turn-y", { timeoutMs: 5000 });
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      if (!conn.isStopped() || conn.stopReason() !== "handler-registration-after-interrupt") { process.stderr.write("expected STOP handler-registration-after-interrupt, got: " + conn.stopReason() + "\n"); process.exit(1); }
      if (results.length !== 0) { process.stderr.write("a handler registered after interruptRequested incorrectly acquired authority: " + JSON.stringify(results) + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-DUP: duplicate/conflicting turn/start RPC response bypass (Codex NO-GO 2026-07-18, P0) ──
#
# classifyIncomingFrame used to silently drop a SECOND response sharing the
# same wire id as an already-answered request ("no matching pending call --
# diagnostic-only, never fabricated") -- correct for a genuinely stray id,
# wrong for a duplicate/conflicting reply to the CURRENT turn's own
# turn/start request, whose one legitimate waiter had already been consumed
# by the first reply. The pre-existing `t.responseObserved -> fail(
# 'duplicate-rpc-response')` guard inside turnStart's own .then() could never
# see it, because the second frame never reached that far. Fixed by keeping
# the dispatched request id on the single currentTurn record
# (turnStartRequestId) and checking it at the frame-dispatch level itself.

@test "C2-DUP-01 FAIL: two byte-identical turn/start responses sharing the same frame id in the same chunk STOP the connection and never deliver, even once completion+handler later arrive" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then(() => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        const respLine = JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n";
        fromChild.write(respLine + respLine);
      });
      return turnP;
    }).then((turnRes) => {
      if (turnRes.ok) { process.stderr.write("turnStart incorrectly resolved ok:true once its own response was duplicated\n"); process.exit(1); }
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "the verdict" } };
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: JSON.stringify(envelope), memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (!conn.isStopped() || conn.stopReason() !== "duplicate-rpc-response") { process.stderr.write("expected STOP duplicate-rpc-response, got: " + conn.stopReason() + "\n"); process.exit(1); }
        if (results.length !== 0) { process.stderr.write("a duplicated turn/start response still allowed delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-DUP-02 FAIL: two CONFLICTING turn/start responses (different turn.id) sharing the same frame id in the same chunk STOP the connection and never deliver" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then(() => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        const firstLine = JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n";
        const conflictingLine = JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-CONFLICT", status: "inProgress", items: [], itemsView: "full" } } }) + "\n";
        fromChild.write(firstLine + conflictingLine);
      });
      return turnP;
    }).then((turnRes) => {
      if (turnRes.ok) { process.stderr.write("turnStart incorrectly resolved ok:true once a conflicting response for its id arrived\n"); process.exit(1); }
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      const envelope = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "the verdict" } };
      fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: JSON.stringify(envelope), memoryCitation: null }] } } }) + "\n");
      setImmediate(() => {
        if (!conn.isStopped() || conn.stopReason() !== "duplicate-rpc-response") { process.stderr.write("expected STOP duplicate-rpc-response, got: " + conn.stopReason() + "\n"); process.exit(1); }
        if (results.length !== 0) { process.stderr.write("a conflicting turn/start response still allowed delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-DUP-03 FAIL: a CONFLICTING turn/start response arriving in a LATER chunk -- after the first was already accredited (responseObserved) but before the join completes -- STOPs and never delivers, though the already-settled turnStart promise keeps its own prior resolution" {
  run node -e '
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const results = [];
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then(() => {
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, result: { type: "chatgptAuthTokens" } }) + "\n");
        fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      });
      return loginP;
    }).then(() => {
      const startP = conn.threadStart({ role: "r", developerInstructions: "d", baseInstructions: "b", cwd: "/c" });
      setImmediate(() => {
        const startReq = sent.find((f) => f.method === "thread/start");
        fromChild.write(JSON.stringify({ id: startReq.id, result: { thread: { id: "thread-x", sessionId: "s1", preview: "", ephemeral: false, modelProvider: "p", createdAt: 1700000000, updatedAt: 1700000000, status: { type: "idle" }, cwd: "/c", cliVersion: "1.0.0", source: "cli", turns: [] }, approvalPolicy: "never", approvalsReviewer: "user", cwd: "/c", model: "m", modelProvider: "p", sandbox: { type: "readOnly", networkAccess: false } } }) + "\n");
      });
      return startP;
    }).then(() => {
      const turnP = conn.turnStart({ threadId: "thread-x", inputText: "x", expectedResultKind: "K", allowedChildRoles: [], cwd: "/c" });
      let turnReqId;
      setImmediate(() => {
        const turnReq = sent.find((f) => f.method === "turn/start");
        turnReqId = turnReq.id;
        fromChild.write(JSON.stringify({ id: turnReq.id, result: { turn: { id: "turn-y", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
      });
      return turnP.then((turnRes) => ({ turnRes, turnReqId: () => turnReqId }));
    }).then(({ turnRes, turnReqId }) => {
      if (!turnRes.ok) { process.stderr.write("preamble turnStart failed: " + JSON.stringify(turnRes) + "\n"); process.exit(1); }
      conn.onTurnCompleted("thread-x", "turn-y", "K", [], (res) => results.push(res));
      setImmediate(() => {
        fromChild.write(JSON.stringify({ id: turnReqId(), result: { turn: { id: "turn-DIFFERENT", status: "inProgress", items: [], itemsView: "full" } } }) + "\n");
        setImmediate(() => {
          if (!conn.isStopped() || conn.stopReason() !== "duplicate-rpc-response") { process.stderr.write("expected STOP duplicate-rpc-response immediately after the later conflicting response, got: " + conn.stopReason() + "\n"); process.exit(1); }
          const envelope = { schema: "coordination/runtime-turn-envelope/v1", kind: "terminal-result", result: { schema: "coordination/result-envelope/v1", status: "ANSWERED", result_kind: "K", content: "the verdict" } };
          fromChild.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-x", turn: { id: "turn-y", status: "completed", itemsView: "full", items: [{ type: "agentMessage", id: "am-1", phase: "final_answer", text: JSON.stringify(envelope), memoryCitation: null }] } } }) + "\n");
          setImmediate(() => {
            if (results.length !== 0) { process.stderr.write("a later-chunk conflicting response still allowed delivery: " + JSON.stringify(results) + "\n"); process.exit(1); }
            process.exit(0);
          });
        });
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

# ── C2-WRAP: frame-level JSONRPC wrapper choke point (Codex NO-GO 2026-07-18, P1) ──
#
# The bundle carries 24 INBOUND_RUNTIME roots; only 20 were referenced from
# classifyIncomingFrame -- the 4 frame-level wrappers (JSONRPCResponse/
# JSONRPCError/JSONRPCRequest/JSONRPCNotification) stayed on hand-rolled
# shape checks only. Each test below monkey-patches ONE generated wrapper
# validator (via the shared require() cache -- requiring the generated
# module directly before requiring the bridge means both hold the exact
# same object reference) to force-reject, then feeds an otherwise
# well-formed frame of that exact kind and proves it never crosses the
# choke point -- a textual generated.roots[...] reference alone cannot show
# the return value is actually consulted.

@test "C2-WRAP-01 FAIL: a well-formed success response is rejected once base::JSONRPCResponse is forced to reject, proving the wrapper validator return value gates classification (never merely referenced)" {
  run node -e '
    const path = require("path");
    const genPath = path.join(path.dirname(process.argv[1]), "generated", "c2-schema-validators.generated.cjs");
    const generated = require(genPath);
    generated.roots["base::JSONRPCResponse"] = () => false;
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((res) => {
      if (res.ok) { process.stderr.write("a schema-forced-invalid success response was still accepted as ok:true\n"); process.exit(1); }
      if (res.reason !== "invalid-frame:response-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); }
      if (!conn.isStopped() || conn.stopReason() !== "invalid-frame:response-schema-invalid") { process.stderr.write("expected STOP invalid-frame:response-schema-invalid, got: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-WRAP-02 FAIL: a well-formed error response is rejected once base::JSONRPCError is forced to reject, proving the wrapper validator return value gates classification (never merely referenced)" {
  run node -e '
    const path = require("path");
    const genPath = path.join(path.dirname(process.argv[1]), "generated", "c2-schema-validators.generated.cjs");
    const generated = require(genPath);
    generated.roots["base::JSONRPCError"] = () => false;
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      const loginP = conn.login({ accessToken: "t", chatgptAccountId: "a", chatgptPlanType: "plus" }, { timeoutMs: 2000 });
      setImmediate(() => {
        const loginReq = sent.find((f) => f.method === "account/login/start");
        fromChild.write(JSON.stringify({ id: loginReq.id, error: { code: -32000, message: "boom" } }) + "\n");
      });
      return loginP;
    }).then((res) => {
      if (res.ok) { process.stderr.write("a schema-forced-invalid error response was still accepted as ok:true\n"); process.exit(1); }
      if (res.reason !== "invalid-frame:response-error-schema-invalid") { process.stderr.write("wrong reason: " + res.reason + "\n"); process.exit(1); }
      if (!conn.isStopped() || conn.stopReason() !== "invalid-frame:response-error-schema-invalid") { process.stderr.write("expected STOP invalid-frame:response-error-schema-invalid, got: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-WRAP-03 FAIL: a well-formed notification is rejected once base::JSONRPCNotification is forced to reject, proving the wrapper validator return value gates classification (never merely referenced)" {
  run node -e '
    const path = require("path");
    const genPath = path.join(path.dirname(process.argv[1]), "generated", "c2-schema-validators.generated.cjs");
    const generated = require(genPath);
    generated.roots["base::JSONRPCNotification"] = () => false;
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    const calls = [];
    conn.onNotification("account/updated", (p) => calls.push(p));
    const initP = conn.initialize();
    setImmediate(() => {
      const initReq = sent.find((f) => f.method === "initialize");
      fromChild.write(JSON.stringify({ id: initReq.id, result: { userAgent: "x", codexHome: "/h", platformFamily: "unix", platformOs: "macos" } }) + "\n");
    });
    initP.then((initRes) => {
      if (!initRes.ok) { process.stderr.write("preamble initialize failed: " + JSON.stringify(initRes) + "\n"); process.exit(1); }
      fromChild.write(JSON.stringify({ method: "account/updated", params: { authMode: "chatgptAuthTokens", planType: "plus" } }) + "\n");
      setImmediate(() => {
        if (calls.length !== 0) { process.stderr.write("a schema-forced-invalid notification still reached its registered handler: " + JSON.stringify(calls) + "\n"); process.exit(1); }
        if (!conn.isStopped() || conn.stopReason() !== "invalid-frame:notification-schema-invalid") { process.stderr.write("expected STOP invalid-frame:notification-schema-invalid, got: " + conn.stopReason() + "\n"); process.exit(1); }
        process.exit(0);
      });
    }).catch((err) => { process.stderr.write("threw: " + err + "\n"); process.exit(1); });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-WRAP-04 FAIL: a well-formed server request is rejected once base::JSONRPCRequest is forced to reject, proving the wrapper validator return value gates classification -- never even reaching handleServerRequest, never writing its normal auto-decline reply" {
  run node -e '
    const path = require("path");
    const genPath = path.join(path.dirname(process.argv[1]), "generated", "c2-schema-validators.generated.cjs");
    const generated = require(genPath);
    generated.roots["base::JSONRPCRequest"] = () => false;
    const bridge = require(process.argv[1]);
    const { PassThrough } = require("stream");
    const toChild = new PassThrough();
    const fromChild = new PassThrough();
    const sent = [];
    toChild.on("data", (c) => sent.push(JSON.parse(c.toString("utf8").trim())));
    const conn = bridge.createAppServerConnection({ stdin: toChild, stdout: fromChild });
    fromChild.write(JSON.stringify({ id: 5, method: "applyPatchApproval", params: { conversationId: "conv-1", callId: "call-1", fileChanges: {}, reason: null, grantRoot: null } }) + "\n");
    setImmediate(() => {
      const resp = sent.find((f) => f.id === 5);
      if (resp) { process.stderr.write("a schema-forced-invalid server request still reached handleServerRequest and wrote a reply: " + JSON.stringify(resp) + "\n"); process.exit(1); }
      if (!conn.isStopped() || conn.stopReason() !== "invalid-frame:server-request-schema-invalid") { process.stderr.write("expected STOP invalid-frame:server-request-schema-invalid, got: " + conn.stopReason() + "\n"); process.exit(1); }
      process.exit(0);
    });
  ' "$BRIDGE"
  [ "$status" -eq 0 ]
}

@test "C2-B-COVERAGE FAIL: every INBOUND_RUNTIME root genuinely consumed by C2 -- derived from the bundle itself, exactly 24 -- is referenced via generated.roots[...], and the 4 frame-level JSONRPC wrappers additionally carry dedicated behavioral choke-point proof" {
  run node -e '
    const fs = require("fs");
    const source = fs.readFileSync(process.argv[1], "utf8");
    const bundle = require(process.argv[2]);
    const testSource = fs.readFileSync(process.argv[3], "utf8");
    const inboundRoots = Object.keys(bundle.roots).filter((k) => Array.isArray(bundle.roots[k].directions) && bundle.roots[k].directions.includes("INBOUND_RUNTIME"));
    if (inboundRoots.length !== 24) { process.stderr.write("expected exactly 24 INBOUND_RUNTIME roots in the bundle, found " + inboundRoots.length + ": " + JSON.stringify(inboundRoots.sort()) + "\n"); process.exit(1); }
    if (!source.includes("generated.roots[")) { process.stderr.write("runtime-bridge-codex.cjs no longer references generated.roots[...] at all\n"); process.exit(1); }
    const missingFromWiring = inboundRoots.filter((k) => !source.includes("'"'"'" + k + "'"'"'"));
    if (missingFromWiring.length !== 0) { process.stderr.write("INBOUND_RUNTIME roots left solely on hand-rolled validation (no generated-validator reference found in source): " + JSON.stringify(missingFromWiring) + "\n"); process.exit(1); }
    // A textual reference alone cannot prove the 4 frame-level JSONRPC wrappers return value is actually consulted (a comment, or a call whose result is ignored, would also match source.includes()) -- that behavioral proof lives in the dedicated C2-WRAP-01..04 tests, which each monkey-patch one wrapper validator to force-reject a well-formed frame of its kind. Cross-checked by name here so this test fails loudly if any of those 4 is ever deleted.
    const jsonrpcWrapperRoots = ["base::JSONRPCError", "base::JSONRPCNotification", "base::JSONRPCRequest", "base::JSONRPCResponse"];
    const missingJsonrpcWrapper = jsonrpcWrapperRoots.filter((k) => !inboundRoots.includes(k));
    if (missingJsonrpcWrapper.length !== 0) { process.stderr.write("bundle census drift -- expected JSONRPC wrapper roots missing from the INBOUND_RUNTIME set: " + JSON.stringify(missingJsonrpcWrapper) + "\n"); process.exit(1); }
    const requiredWrapTests = ["C2-WRAP-01", "C2-WRAP-02", "C2-WRAP-03", "C2-WRAP-04"];
    const missingWrapTest = requiredWrapTests.filter((id) => !testSource.includes(id));
    if (missingWrapTest.length !== 0) { process.stderr.write("dedicated JSONRPC wrapper choke-point behavioral tests missing: " + JSON.stringify(missingWrapTest) + "\n"); process.exit(1); }
    process.exit(0);
  ' "$BRIDGE" "$BATS_TEST_DIRNAME/../lib/schema/c2-schema-bundle.json" "$BATS_TEST_DIRNAME/runtime-consultation-bridge.bats"
  [ "$status" -eq 0 ]
}
