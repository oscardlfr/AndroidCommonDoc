#!/usr/bin/env bats
bats_require_minimum_version 1.5.0
#
# Part 1/3 of the former runtime-consultation-role-gate.bats (Sequence C20
# split -- see lib/role-gate-shared.bash's own header for why). Covers the
# grant-mechanics surface with NO live five-role plane: consultation/
# lifecycle/requester target-gate injection, the PLAN.md section15b
# role-command-grant/v1 schema and its full core-level adversarial matrix
# (replay/expired/altered/argv-tamper/cross-role/authority-swap), the REQ12
# completeness pass (12 additional requester subcommands), and one
# root-source-binding retirement/no-later-grant regression guard. Zero
# retained-plane starts -- see the -plane.bats and -evidence.bats siblings
# for the five-role E2E families.
#
# Siblings: runtime-consultation-role-gate-plane.bats,
# runtime-consultation-role-gate-evidence.bats. Shared fixtures:
# lib/role-gate-shared.bash.
#
# Invocation: bats scripts/tests/runtime-consultation-role-gate-core.bats (from repo root)

load 'lib/role-gate-shared'


_run_hook() {
  run bash -c "cat '$INPUT_FILE' | CLAUDE_PROJECT_DIR='$PROJ' node '$HOOK'"
}

# Corrected CLAUDE-ID-01 v2 actor primer. It publishes a signed reusable host
# contract, records pin-bound session evidence, then proves this exact actor
# through consumed startup claim + real ready pre/outcome + READY binding.
# _prime_claude_id01_trace <agent_type> <session_id> [agent_id]
_prime_claude_id01_trace() {
  local agent_type="$1" session_id="$2" agent_id="${3:-tg-agent-id}"
  node -e '
    const crypto = require("crypto");
    const rll = require(process.argv[1]);
    const fixture = require(process.argv[6]);
    const projectRoot = process.argv[2];
    const agentType = process.argv[3];
    const sessionId = process.argv[4];
    const agentId = process.argv[5];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const plan = rll.discoverPlan(projectRoot);
    if (!generation.ok || !plan.ok) {
      process.stderr.write("_prime_claude_id01_trace: scope resolution failed");
      process.exit(1);
    }
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const actionId = rll.generateActionId();
    const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const minted = rll.mintRoleLifecycleAction(
      projectRoot, actionId, "role-spawn", "claude-native",
      rll.computeRepoId(projectRoot), worktreeId, plan.planDigest,
      crypto.createHash("sha256").update("role-gate-claude-id01-v2:" + agentId).digest("hex"),
      generation.generationId, agentType,
      rll.buildRoleSpawnPayload("claude-id01-probe", agentType, agentType, "fixture", "fixture"),
      expiry,
    );
    if (!minted.ok) {
      process.stderr.write("_prime_claude_id01_trace: action mint failed: " + JSON.stringify(minted));
      process.exit(1);
    }
    fixture.primeClaudeId01V2ActorProof({
      projectRoot, agentType, sessionId, agentId, actionId,
      prefix: "role-gate-id01-v2",
    });
    const proof = rll.checkClaudeId01RuntimeCapability(
      projectRoot, sessionId, worktreeId, plan.planDigest, agentType, agentId,
    );
    if (!proof.ok) {
      process.stderr.write("_prime_claude_id01_trace: global capability absent: " + JSON.stringify(proof));
      process.exit(1);
    }
  ' "$RLL_IMPL" "$PROJ" "$agent_type" "$session_id" "$agent_id" "$ID01_V2_FIXTURE"
}

# Mints a REAL pending role-spawn action for `role` via the actual production
# ensure()/grant machinery. Prints "<action_id> <worktree_id> <plan_digest> <session_generation_id>".
_mint_pending_role_spawn_full() {
  local role="$1" session_key="$2" prime_actor="${3:-true}"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const role = process.argv[3];
    const sessionKey = process.argv[4];
    const fixture = require(process.argv[5]);
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed"); process.exit(1); }
    const crypto = require("crypto");
    const argvDigest = crypto.createHash("sha256").update("ensure:" + role).digest("hex");
    const grantResult = rll.mintLifecycleCommandGrant(projectRoot, bindingResult.binding, argvDigest, role, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    if (!grantResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(grantResult)); process.exit(1); }
    const { spawnSync } = require("child_process");
    const ensureResult = spawnSync("node", [process.argv[1], "ensure", "--project-root", projectRoot, "--role", role, "--lifecycle-binding", grantResult.grantId], { env: process.env, encoding: "utf8" });
    if (ensureResult.status !== 0) { process.stderr.write("ensure CLI failed: " + ensureResult.stdout + ensureResult.stderr); process.exit(1); }
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    if (!genResult.ok) { process.stderr.write("session generation lookup failed"); process.exit(1); }
    const profileDigest = rll.roleProfileDigestFor(role);
    const stateResult = rll.readRoleBindingState(projectRoot, worktreeId, planResult.planDigest, profileDigest, genResult.generationId, role);
    if (!stateResult.ok || !stateResult.record || !stateResult.record.pending_action_id) { process.stderr.write("no pending_action_id: " + JSON.stringify(stateResult)); process.exit(1); }
    if (process.argv[6] === "true") {
      fixture.primeClaudeStartupActor({
        projectRoot, agentType: role, sessionId: sessionKey, agentId: "tg-agent-id",
        actionId: stateResult.record.pending_action_id, prefix: "role-gate-startup-v2",
      });
    }
    process.stdout.write(stateResult.record.pending_action_id + " " + worktreeId + " " + planResult.planDigest + " " + genResult.generationId);
  ' "$RLL_IMPL" "$PROJ" "$role" "$session_key" "$ID01_V2_FIXTURE" "$prime_actor"
}

# _mint_role_actor_binding <role> <worktree_id> <plan_digest> <session_generation_id> [ttl_seconds]
_mint_role_actor_binding() {
  local role="$1" worktree_id="$2" plan_digest="$3" session_generation_id="$4" ttl="${5:-60}"
  node -e '
    const rll = require(process.argv[1]);
    const result = rll.createRoleActorBinding(process.argv[2], process.argv[3], process.argv[4], process.argv[5], process.argv[6], Number(process.argv[7]));
    if (!result.ok) { process.stderr.write("createRoleActorBinding failed: " + JSON.stringify(result)); process.exit(1); }
    process.stdout.write(result.binding.binding_id);
  ' "$RLL_IMPL" "$PROJ" "$role" "$worktree_id" "$plan_digest" "$session_generation_id" "$ttl"
}

_random_hex32() {
  node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))'
}

_role_command_grants_dir() {
  node -e '
    const rll = require(process.argv[1]);
    process.stdout.write(require("path").join(rll.registryRepoDir(process.argv[2]), "role-command-grants"));
  ' "$RLL_IMPL" "$PROJ"
}

# Reads hookSpecificOutput.updatedInput.command from the last hook stdout
# ($output) verbatim.
_returned_command() {
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch { process.stdout.write(""); process.exit(0); }
    const cmd = body && body.hookSpecificOutput && body.hookSpecificOutput.updatedInput && body.hookSpecificOutput.updatedInput.command;
    process.stdout.write(typeof cmd === "string" ? cmd : "");
  ' "$output"
}

# Actually EXECUTES a rewritten command string as the real production CLI
# subprocess would run it (mirrors _run_hook's own "cat | node" subprocess
# style, but runs the CLI itself, never a hook) -- the only way to prove the
# core genuinely, atomically consumes+validates an injected grant "before any
# read or mutation" (PLAN.md ~L604), not merely that a hook's own JSON claims
# to have minted one.
_run_cli_command() {
  local cmd="$1"
  run bash -c "$cmd"
}

# Reads a role-command-grant/v1 record straight off disk by its grant_id
# (universal <type-dir>/<id>.json registry convention this codebase uses
# throughout -- grantPathFor, roleActorBindingPathFor, roleCommandGrantPathFor
# all follow it) -- used by the adversarial on-disk-tamper tests below.
_role_command_grant_path() {
  printf '%s/%s.json' "$(_role_command_grants_dir)" "$1"
}

_requester_grant_authority_snapshot() {
  local grant_id="$1" rewritten="${2:-}"
  node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const grant = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    const rewritten = process.argv[4];
    const bindingRead = rll.readRegistryRecord(rll.requesterBindingPathFor(projectRoot, grant.binding_id));
    if (!bindingRead.ok || bindingRead.absent) {
      process.stdout.write(JSON.stringify({ binding: bindingRead })); process.exit(0);
    }
    const binding = bindingRead.obj;
    const identity = {
      schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot), runtime_session_key: binding.runtime_session_key,
      agent_id: binding.agent_key,
    };
    const classification = rll.classifyClaudeAuthorityForIdentity(projectRoot, identity);
    const proof = rll.checkClaudeId01ProofComplete(
      projectRoot, binding.runtime_session_key, binding.worktree_id, binding.plan_digest,
      binding.role, binding.agent_key,
    );
    let argvDigest = null;
    if (rewritten) {
      const tokens = rll.parsePosixDirect(rewritten);
      const flagTokens = tokens.slice(3);
      const idx = flagTokens.indexOf("--requester-binding");
      const pre = idx < 0 ? flagTokens : flagTokens.slice(0, idx).concat(flagTokens.slice(idx + 2));
      argvDigest = require("crypto").createHash("sha256")
        .update(Buffer.from(JSON.stringify(pre), "utf8")).digest("hex");
    }
    const consumed = fs.existsSync(process.argv[3].replace(/\.json$/, ".consumed"));
    process.stdout.write(JSON.stringify({ grant, argvDigest, consumed, binding, classification, proof }));
  ' "$RLL_IMPL" "$PROJ" "$(_role_command_grant_path "$grant_id")" "$rewritten"
}

# _set_grant_field <grant_id> <field> <json_value_literal>
# Hand-edits one field of an on-disk role-command-grant/v1 record (e.g. to
# simulate expiry or tampering) -- json_value_literal is a JSON literal
# (e.g. '"2000-01-01T00:00:00Z"' for a string) parsed via JSON.parse, never
# eval, since every call site here only ever needs a JSON string literal.
_set_grant_field() {
  local grant_id="$1" field="$2" value_literal="$3"
  local grant_path; grant_path="$(_role_command_grant_path "$grant_id")"
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const field = process.argv[2];
    const rec = JSON.parse(fs.readFileSync(p, "utf8"));
    rec[field] = JSON.parse(process.argv[3]);
    fs.writeFileSync(p, JSON.stringify(rec));
  ' "$grant_path" "$field" "$value_literal"
}

_worktree_id() { node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeWorktreeId(process.argv[2]));' "$RLL_IMPL" "$PROJ"; }
_plan_digest() { node -e 'const rll=require(process.argv[1]);const r=rll.discoverPlan(process.argv[2]);process.stdout.write(r.ok?r.planDigest:"");' "$RLL_IMPL" "$PROJ"; }

# M7 correction round 1 test-side reconciliation (2026-08-18, task #49):
# writes a minimal, genuinely correlating coordination/consult/v2 request.json
# at $1 for a claim/lease-heartbeat/publish-result target-surface fixture.
# resolveActivationForRequestPath (runtime-consultation.cjs) only needs
# request.json to genuinely be there and readable (readRequestForTxnOrCorrelationInvalid)
# plus resolveAuthoritativeAttempt to succeed off its own initial_attempt_id/
# initial_lease_epoch -- no activation.json/dispatch is required at all: an
# absent activation record resolves ok:true/activation:null, which
# runtime-consultation-target-gate.js's own documented contract (see its
# "Genuine ABSENCE... is NEVER a block by itself" comment, which names
# TG-CLAIM-1/TG-LEASE-1/TG-PUBLISH-1 directly) falls through cleanly to the
# pre-existing RoleActorBinding path -- exactly what _mint_role_actor_binding
# already sets up in these fixtures. Field shape mirrors this file's own
# PROVEN _req12_write_request defaults (same coordination_root_id placeholder
# precedent), sourced from $PROJ instead of the REQ12-specific globals.
_tg_write_minimal_request() {
  local out="$1" target_role="$2"
  mkdir -p "$(dirname "$out")"
  local worktree_id plan_digest repo_id subject_head created_at expiry
  worktree_id="$(_worktree_id)"
  plan_digest="$(_plan_digest)"
  repo_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeRepoId(process.argv[2]));' "$RLL_IMPL" "$PROJ")"
  subject_head="$(git -C "$PROJ" rev-parse HEAD)"
  created_at="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  expiry="$(node -e 'process.stdout.write(new Date(Date.parse(process.argv[1])+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))' "$created_at")"
  TG_TARGET_ROLE="$target_role" TG_WORKTREE_ID="$worktree_id" TG_PLAN_DIGEST="$plan_digest" \
  TG_REPO_ID="$repo_id" TG_SUBJECT_HEAD="$subject_head" TG_CREATED_AT="$created_at" TG_EXPIRY="$expiry" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const e = process.env;
    const outPath = process.argv[1];
    // readCanonicalRequestRecord (runtime-consultation.cjs) requires the
    // request own embedded request_id to equal its OWN containing
    // transaction directory basename -- derived here so this helper is
    // self-correlating regardless of which directory name the caller
    // chooses, as long as that name is itself a valid 32-128 char hex id.
    const requestId = path.basename(path.dirname(outPath));
    const obj = {
      schema: "coordination/consult/v2",
      request_id: requestId,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "test-specialist",
      target_role: e.TG_TARGET_ROLE,
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      requester_worktree_id: e.TG_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.TG_REPO_ID,
      wave_slug: "tg-wave",
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: "0".repeat(64),
      plan_digest: e.TG_PLAN_DIGEST,
      subject_repo_id: e.TG_REPO_ID,
      subject_worktree_id: e.TG_WORKTREE_ID,
      subject_head: e.TG_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "role-gate target-surface fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.TG_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.TG_CREATED_AT,
    };
    fs.writeFileSync(outPath, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$out"
}

# Stage C (M7-FINAL-REMEDIATION-20260818, required_red_before_green item 3):
# identical to _tg_write_minimal_request above, except Object.assign(obj,
# overridesObj) is applied BEFORE writing -- lets exactly one of
# target_role/subject_worktree_id/plan_digest be corrupted relative to what
# the CALLING identity/current project scope actually is, while every other
# field stays genuinely correlating (mirrors
# _tg_write_activation_for_request_tampered's own rationale).
_tg_write_minimal_request_tampered() {
  local out="$1" target_role="$2" overrides_json="$3"
  mkdir -p "$(dirname "$out")"
  local worktree_id plan_digest repo_id subject_head created_at expiry
  worktree_id="$(_worktree_id)"
  plan_digest="$(_plan_digest)"
  repo_id="$(node -e 'const rll=require(process.argv[1]);process.stdout.write(rll.computeRepoId(process.argv[2]));' "$RLL_IMPL" "$PROJ")"
  subject_head="$(git -C "$PROJ" rev-parse HEAD)"
  created_at="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  expiry="$(node -e 'process.stdout.write(new Date(Date.parse(process.argv[1])+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))' "$created_at")"
  TG_TARGET_ROLE="$target_role" TG_WORKTREE_ID="$worktree_id" TG_PLAN_DIGEST="$plan_digest" \
  TG_REPO_ID="$repo_id" TG_SUBJECT_HEAD="$subject_head" TG_CREATED_AT="$created_at" TG_EXPIRY="$expiry" \
  TG_OVERRIDES="$overrides_json" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const e = process.env;
    const outPath = process.argv[1];
    const requestId = path.basename(path.dirname(outPath));
    const obj = {
      schema: "coordination/consult/v2",
      request_id: requestId,
      root_request_id: requestId,
      parent_request_id: null,
      depth: 0,
      max_depth: 2,
      source_role: "test-specialist",
      target_role: e.TG_TARGET_ROLE,
      target_role_profile_version: "1.0.0",
      target_role_profile_digest: "b".repeat(64),
      requester_worktree_id: e.TG_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.TG_REPO_ID,
      wave_slug: "tg-wave",
      protocol_profile: "runtime-consultation/v1",
      coordination_root_id: "0".repeat(64),
      plan_digest: e.TG_PLAN_DIGEST,
      subject_repo_id: e.TG_REPO_ID,
      subject_worktree_id: e.TG_WORKTREE_ID,
      subject_head: e.TG_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "role-gate target-surface scope-mismatch fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.TG_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.TG_CREATED_AT,
    };
    Object.assign(obj, JSON.parse(e.TG_OVERRIDES));
    fs.writeFileSync(outPath, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$out"
}

# M7 GREEN correction round 2, R5: writes a genuine, well-formed
# coordination/activation/v1 record correlated against a request written by
# _tg_write_minimal_request above (same request_id via the txn directory
# basename). `driver` is caller-chosen so the SAME helper covers both the
# RoleActor-path positive control (driver something other than claude-agent,
# e.g. "noop") and the claude-agent-path fixture.
#
# Stage C correction (2026-08-19, M7-FINAL-REMEDIATION-20260818, required_red_
# before_green item 1): this helper used to hardcode request_digest="a"x64 (a
# placeholder never derived from the request it claims to correlate against)
# plus duplicate-literal copies of target_role_profile_digest/routing_policy_
# digest/attempt_id/lease_epoch that only "matched" the request because both
# sides repeated the same hand-picked constant -- not because either was
# genuinely derived from the other. Once resolveActivationForRequestPath
# actually checks request_digest (Stage C production fix), the old helper
# would have started failing its own callers' PASS fixtures. Fixed: reads the
# EXACT request.json bytes _tg_write_minimal_request already wrote at
# request_path, computes request_digest as the real SHA-256 of those bytes,
# and derives target_role_profile_digest/routing_policy_version/routing_
# policy_digest/attempt_id(initial_attempt_id)/lease_epoch(initial_lease_
# epoch) directly from the parsed request object -- never a second, separately
# hand-maintained copy. native_spawn_action_id/native_target_binding_id are
# now driver-coherent: claude-agent gets a real 32-hex action id (never
# infer/repair a placeholder), every other driver keeps both null.
_tg_write_activation_for_request() {
  local request_path="$1" driver="$2"
  local txn_dir; txn_dir="$(dirname "$request_path")"
  local activation_dir="$txn_dir/activations"
  mkdir -p "$activation_dir"
  TG_REQUEST_PATH="$request_path" TG_ACTIVATION_DIR="$activation_dir" TG_DRIVER="$driver" \
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rc = require(process.argv[1]);
    const e = process.env;
    const requestBytes = fs.readFileSync(e.TG_REQUEST_PATH);
    const reqObj = JSON.parse(requestBytes.toString("utf8"));
    const requestDigest = crypto.createHash("sha256").update(requestBytes).digest("hex");
    const isClaudeAgent = e.TG_DRIVER === "claude-agent";
    const obj = {
      schema: "coordination/activation/v1",
      version: 1,
      request_id: reqObj.request_id,
      request_digest: requestDigest,
      attempt_id: reqObj.initial_attempt_id,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      selected_driver: e.TG_DRIVER,
      native_target_binding_id: null,
      native_spawn_action_id: isClaudeAgent ? crypto.randomBytes(16).toString("hex") : null,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      activation_liveness_expiry: rc.activationLivenessDeadline(reqObj),
    };
    const out = path.join(e.TG_ACTIVATION_DIR, obj.attempt_id + ".json");
    fs.writeFileSync(out, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(out, 0o600);
  ' "$CONSULTATION_CLI"
}

# Stage C (M7-FINAL-REMEDIATION-20260818, required_red_before_green item 2):
# identical to _tg_write_activation_for_request above, except after computing
# the genuinely-correlated obj it applies Object.assign(obj, overridesObj) --
# `overrides_json` is a JSON object literal of fields to corrupt -- BEFORE
# writing. Lets a single genuinely-correlating base fixture be tampered along
# exactly one axis at a time, so a failure to deny is attributable to that
# ONE axis, never a compound fixture defect.
_tg_write_activation_for_request_tampered() {
  local request_path="$1" driver="$2" overrides_json="$3"
  local txn_dir; txn_dir="$(dirname "$request_path")"
  local activation_dir="$txn_dir/activations"
  mkdir -p "$activation_dir"
  TG_REQUEST_PATH="$request_path" TG_ACTIVATION_DIR="$activation_dir" TG_DRIVER="$driver" TG_OVERRIDES="$overrides_json" \
  NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");
    const rc = require(process.argv[1]);
    const e = process.env;
    const requestBytes = fs.readFileSync(e.TG_REQUEST_PATH);
    const reqObj = JSON.parse(requestBytes.toString("utf8"));
    const requestDigest = crypto.createHash("sha256").update(requestBytes).digest("hex");
    const isClaudeAgent = e.TG_DRIVER === "claude-agent";
    const obj = {
      schema: "coordination/activation/v1",
      version: 1,
      request_id: reqObj.request_id,
      request_digest: requestDigest,
      attempt_id: reqObj.initial_attempt_id,
      lease_epoch: reqObj.initial_lease_epoch,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      selected_driver: e.TG_DRIVER,
      native_target_binding_id: null,
      native_spawn_action_id: isClaudeAgent ? crypto.randomBytes(16).toString("hex") : null,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      activation_liveness_expiry: rc.activationLivenessDeadline(reqObj),
    };
    const overrides = JSON.parse(e.TG_OVERRIDES);
    // Sequence 25: a literal future timestamp baked into the overrides JSON
    // at TABLE-SETUP time (before the other real hook subprocess
    // invocations in the same table run) goes stale on a slow host -- by
    // the time THIS row is reached, minutes of real wall-clock time may
    // have already elapsed, so a value that was "+30s in the future" at
    // setup time can easily already be in the PAST at write time, silently
    // defeating the not-in-the-future dimension it exists to prove
    // (root-caused via a standalone resolveActivationForRequestPath repro:
    // the validator already correctly denies a genuinely-future created_at
    // at check time). This sentinel is computed fresh, immediately before
    // writing, so the margin is always relative to the actual check-time
    // clock, regardless of how long earlier rows in the same table took.
    if (overrides.created_at === "__FRESH_NEAR_FUTURE_30S__") {
      overrides.created_at = new Date(Date.now() + 30000).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    Object.assign(obj, overrides);
    const out = path.join(e.TG_ACTIVATION_DIR, obj.attempt_id + ".json");
    fs.writeFileSync(out, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(out, 0o600);
  ' "$CONSULTATION_CLI"
}

# Stage C table-driven negative fixture: mints a live RoleActorBinding (so a
# denial can never be attributed to "no RoleActorBinding either"), writes a
# correlating request, then writes ONE tampered/PENDING activation for it and
# runs `subcommand` through the real hook. Prints a one-line reason and
# returns 1 on ANY deviation from "genuine deny, zero new role-command-grant
# file" -- never aborts the caller, so a table loop can collect every failing
# dimension from ONE pass instead of stopping at the first (required_red_
# before_green item 5 needs one coherent RED signature per subcommand, not N
# separate incremental discoveries).
# $1=subcommand $2=label $3=driver $4=overrides_json ("__PENDING__" for the
# nlink==2 case, which ignores $4's content and hard-links a VALID activation
# instead of tampering a field). Caller (_tg_run_tamper_table) mints the
# single shared RoleActorBinding ONCE for the whole table -- minting a fresh
# one per row would leave MULTIPLE live bindings for the same {role,
# worktree, plan} from row 2 onward, so findLiveRoleActorBindings's own
# ambiguity check ("no single live RoleActorBinding") would deny every
# subsequent row for THAT unrelated reason, silently masking whatever the
# row's own activation tamper was supposed to prove (empirically caught:
# first draft of this table passed 10/10 rows pre-fix).
_tg_run_tamper_case() {
  local subcommand="$1" label="$2" driver="$3" overrides="$4"
  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing

  if [ "$overrides" = "__PENDING__" ]; then
    _tg_write_activation_for_request "$request_path" "$driver"
    local attempt_id activation_path
    attempt_id="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).initial_attempt_id)' "$request_path")"
    activation_path="$(dirname "$request_path")/activations/$attempt_id.json"
    ln "$activation_path" "$activation_path.extra-hardlink-$(_random_hex32)"
  else
    _tg_write_activation_for_request_tampered "$request_path" "$driver" "$overrides"
  fi

  local cmd
  case "$subcommand" in
    claim)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session "tg-tamper-worker")" ;;
    lease-heartbeat)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")" ;;
    publish-result)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)" ;;
  esac

  local grants_before grants_after
  grants_before="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"
  _make_input "$cmd" arch-testing "tg-tamper-${subcommand}-caller"
  _run_hook
  grants_after="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"

  local reason=""
  if [ "$status" -ne 0 ]; then
    reason="hook-exit-nonzero:$status"
  elif ! node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.exit(1); }
    if (!body || typeof body !== "object") process.exit(1);
    if (Object.prototype.hasOwnProperty.call(body, "decision")) process.exit(1);
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") process.exit(1);
    if (hso.permissionDecision !== "deny") process.exit(1);
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) process.exit(1);
  ' "$output"; then
    reason="not-a-genuine-deny:$output"
  elif [ "$grants_after" != "$grants_before" ]; then
    reason="grant-count-changed:${grants_before}->${grants_after}"
  fi

  if [ -n "$reason" ]; then
    printf '%s: %s\n' "$label" "$reason"
    return 1
  fi
  return 0
}

# Stage C table-driven negative coverage (required_red_before_green item 2):
# for `subcommand`, every one of these 9 rows across 6 dimensions (PENDING,
# request_digest, lease_epoch, profile digest, routing version, routing
# digest, driver/native coherence, created_at/expiry x2) must deny with zero
# grant. Mints ONE shared RoleActorBinding for the whole table (see
# _tg_run_tamper_case's own header for why per-row minting is wrong) --
# 300s TTL comfortably covers 9 sequential real hook subprocess spawns.
# Excludes the claude-agent-driver native-coherence sub-case deliberately: no
# ClaudeOneShotBinding is ever minted in this fixture universe, so that
# sub-case denies identically before AND after the fix ("no single live
# ClaudeOneShotBinding") regardless of native_spawn_action_id -- it cannot
# discriminate RED from GREEN through the hook. Covered instead by
# TG-ACTIVATION-COHERENCE-DIRECT-* below, which calls
# resolveActivationForRequestPath directly (no binding-selection layer to
# mask the result).
#
# TTL is 60s (the same value every other test in this file uses), NOT a
# longer value picked "to be safe": empirically, createRoleActorBinding
# rejects a 300s TTL outright (reason:"invalid-ttl") -- and since the fixture
# helper's stderr was piped to /dev/null with no exit-code check, that mint
# failure was SILENT, leaving zero live bindings for the whole table and
# denying every row for "no single live RoleActorBinding" -- a second,
# different way for this harness to mask the real defect (first draft's own
# bug was the opposite: too MANY live bindings from per-row minting). Caught
# by manually replicating one row outside bats and printing every
# intermediate value. Guarded now: a mint failure aborts the table loudly.
_tg_run_tamper_table() {
  local subcommand="$1"
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  local mint_out
  mint_out="$(_mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60)"
  if [ -z "$mint_out" ]; then
    printf 'SETUP FAILURE: _mint_role_actor_binding produced no binding_id for %s table\n' "$subcommand"
    return 1
  fi

  local all_zero_hex64 alt_hex64_1 alt_hex64_2 fake_native_hex32 far_expiry
  # Stage D (M7-FINAL-REMEDIATION-20260818, D8a mutation-survival finding):
  # +1h was ALSO caught by the separate created_at<=activation_liveness_expiry
  # check (activationLivenessDeadline's own ~300s window from the request's
  # real created_at), so removing ONLY the not-in-the-future condition in
  # production left this row still denying -- a genuine mutant-survival gap,
  # not a false pass. +30s stays inside that same ~300s window while still
  # being strictly in the future relative to "now", isolating the
  # not-in-the-future check on its own.
  #
  # Sequence 25: the actual +30s value is no longer computed here -- a value
  # baked in at table-setup time goes stale (no longer actually in the
  # future) by the time this row's own real hook subprocess runs, after
  # however long the PENDING + 7 preceding tamper rows took on this host
  # (empirically observed to exceed 30s, causing a deterministic false pass
  # that looked like a production gap but was not one -- see
  # _tg_write_activation_for_request_tampered's own sentinel handling).
  # "__FRESH_NEAR_FUTURE_30S__" defers the +30s computation to that helper,
  # immediately before the write, so the margin is always relative to the
  # real check-time clock.
  far_expiry="2099-01-01T00:00:00Z"
  all_zero_hex64="$(node -e 'process.stdout.write("0".repeat(64))')"
  alt_hex64_1="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  alt_hex64_2="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  fake_native_hex32="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  # Stage D (M7-FINAL-REMEDIATION-20260818, D9d mutation-survival finding):
  # the pre-existing driver_native-nonclaude_has_native row only ever
  # tampers native_spawn_action_id -- a mutation removing ONLY the
  # non-Claude native_target_binding_id===null check had zero discriminating
  # coverage in this table before this row existed. Found by actually
  # applying that mutation and observing it survive, not assumed.
  local fake_binding_hex32; fake_binding_hex32="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"

  local failures=()

  local pending_out
  if ! pending_out="$(_tg_run_tamper_case "$subcommand" pending noop "__PENDING__")"; then
    failures+=("$pending_out")
  fi

  local row
  for row in \
    "request_digest-mismatch|noop|{\"request_digest\":\"$all_zero_hex64\"}" \
    "lease_epoch-mismatch|noop|{\"lease_epoch\":999}" \
    "profile_digest-mismatch|noop|{\"target_role_profile_digest\":\"$alt_hex64_1\"}" \
    "routing_version-mismatch|noop|{\"routing_policy_version\":\"runtime-routing/v2-tampered\"}" \
    "routing_digest-mismatch|noop|{\"routing_policy_digest\":\"$alt_hex64_2\"}" \
    "driver_native-nonclaude_has_native|noop|{\"native_spawn_action_id\":\"$fake_native_hex32\"}" \
    "driver_native-nonclaude_has_target_binding|noop|{\"native_target_binding_id\":\"$fake_binding_hex32\"}" \
    "created_at-future|noop|{\"created_at\":\"__FRESH_NEAR_FUTURE_30S__\"}" \
    "expiry-mismatch|noop|{\"activation_liveness_expiry\":\"$far_expiry\"}" \
  ; do
    local label driver overrides out
    label="${row%%|*}"; row="${row#*|}"
    driver="${row%%|*}"; overrides="${row#*|}"
    if ! out="$(_tg_run_tamper_case "$subcommand" "$label" "$driver" "$overrides")"; then
      failures+=("$out")
    fi
  done

  if [ "${#failures[@]}" -ne 0 ]; then
    printf 'FAILING DIMENSIONS for %s (%d/10):\n' "$subcommand" "${#failures[@]}"
    printf '  %s\n' "${failures[@]}"
    return 1
  fi
  return 0
}

# ══════════════════════════════════════════════════════════════════════════
# Stage C (M7-FINAL-REMEDIATION-20260818) RED: table-driven negative coverage
# for the activation_resolution defect -- resolveActivationForRequestPath
# currently only checks request_id/attempt_id/expiry (Codex's sequence-4
# architecture_ruling), so PENDING and 9 field-tamper rows across request_
# digest/lease_epoch/profile digest/routing version+digest/driver-native
# coherence/created_at/expiry currently do NOT deny -- these three tests are
# RED against pre-fix production and must go GREEN, unmodified, once
# resolveActivationForRequestPath enforces the full DURABLE_PRESENT
# predicate. Each preserves the pre-existing ABSENT/DECORRELATED/EXPIRED
# coverage above untouched (TG-*-1-ABSENT-BLOCKS,
# TG-CLAIM-1-DECORRELATED-BLOCKS, TG-CLAIM-1-EXPIRED-BLOCKS).
# ══════════════════════════════════════════════════════════════════════════

@test "TG-CLAIM-TAMPER-TABLE BLOCK: 'claim' denies with zero grant under PENDING and every field-tamper dimension on the request-resolved activation" {
  run _tg_run_tamper_table claim
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-LEASE-TAMPER-TABLE BLOCK: 'lease-heartbeat' denies with zero grant under PENDING and every field-tamper dimension on the request-resolved activation" {
  run _tg_run_tamper_table lease-heartbeat
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-PUBLISH-TAMPER-TABLE BLOCK: 'publish-result' denies with zero grant under PENDING and every field-tamper dimension on the request-resolved activation" {
  run _tg_run_tamper_table publish-result
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# Direct-call driver/native-coherence coverage (required_red_before_green
# item 2's remaining named dimension, not coverable through the hook -- see
# _tg_run_tamper_table's own header for why the claude-agent sub-case is
# excluded from the table above). Calls resolveActivationForRequestPath
# directly against a real, durable, on-disk request+activation pair -- no
# binding-selection layer downstream to mask the result either way.
@test "TG-ACTIVATION-COHERENCE-DIRECT-1 BLOCK: resolveActivationForRequestPath rejects a claude-agent-driver activation whose native_spawn_action_id is null" {
  local txn_id request_path
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request_tampered "$request_path" claude-agent '{"native_spawn_action_id":null}'
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === false ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-ACTIVATION-COHERENCE-DIRECT-2 BLOCK: resolveActivationForRequestPath rejects a non-claude-agent-driver activation whose native_spawn_action_id is non-null" {
  local txn_id request_path fake_native
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  fake_native="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request_tampered "$request_path" noop "{\"native_spawn_action_id\":\"$fake_native\"}"
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === false ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-ACTIVATION-COHERENCE-DIRECT-3 PASS: resolveActivationForRequestPath still resolves a genuinely COHERENT claude-agent-driver activation (real 32-hex native_spawn_action_id, native_target_binding_id null) -- regression guard against the coherence gate over-rejecting" {
  local txn_id request_path
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request "$request_path" claude-agent
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === true && result.activation !== null ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# Stage D (M7-FINAL-REMEDIATION-20260818, mutation D9-DRIVER-NATIVE
# coverage-gap finding): DIRECT-1/-2 exercise native_spawn_action_id only --
# neither ever sets a non-null native_target_binding_id on a claude-agent-
# driver record, so a mutation removing ONLY the claude-agent
# native_target_binding_id===null check had zero discriminating coverage
# before this test existed. Found by actually applying that mutation during
# Stage D mutation testing and observing it survive, not assumed.
@test "TG-ACTIVATION-COHERENCE-DIRECT-4 BLOCK: resolveActivationForRequestPath rejects a claude-agent-driver activation whose native_target_binding_id is non-null (even with an otherwise-valid native_spawn_action_id)" {
  local txn_id request_path fake_binding_id
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  fake_binding_id="$(node -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request_tampered "$request_path" claude-agent "{\"native_target_binding_id\":\"$fake_binding_id\"}"
  run node -e '
    const rc = require(process.argv[1]);
    const result = rc.resolveActivationForRequestPath(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
    process.exit(result.ok === false ? 0 : 1);
  ' "$CONSULTATION_CLI" "$request_path"
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# ══════════════════════════════════════════════════════════════════════════
# Stage C (M7-FINAL-REMEDIATION-20260818) RED: exact-scope coverage
# (required_red_before_green item 3). Today findLiveRoleActorBindings is
# queried with the CALLING agentType/current worktree/current plan -- it
# never cross-checks the REQUEST's own claimed target_role/subject_worktree_
# id/plan_digest at all. A live RoleActorBinding for the CALLER's real
# identity therefore still gets found and granted even when the request it
# is being used against claims a DIFFERENT role/worktree/plan scope
# entirely. The activation itself is left genuinely coherent in every row
# (written by _tg_write_activation_for_request AFTER the tampered request,
# so its digest/profile/routing fields correlate with the ACTUAL, tampered
# request bytes) -- only the request's own scope-identifying fields disagree
# with the calling context, isolating this from the field-tamper dimensions
# TG-*-TAMPER-TABLE already covers.
# ══════════════════════════════════════════════════════════════════════════

# $1=subcommand $2=label $3=request_overrides_json
_tg_run_scope_mismatch_case() {
  local subcommand="$1" label="$2" overrides="$3"
  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request_tampered "$request_path" arch-testing "$overrides"
  _tg_write_activation_for_request "$request_path" noop

  local cmd
  case "$subcommand" in
    claim)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session "tg-scope-worker")" ;;
    lease-heartbeat)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")" ;;
    publish-result)
      cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)" ;;
  esac

  local grants_before grants_after
  grants_before="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"
  _make_input "$cmd" arch-testing "tg-scope-${subcommand}-caller"
  _run_hook
  grants_after="$(ls -1 "$(_role_command_grants_dir)" 2>/dev/null | wc -l | tr -d ' ')"

  local reason=""
  if [ "$status" -ne 0 ]; then
    reason="hook-exit-nonzero:$status"
  elif ! node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.exit(1); }
    if (!body || typeof body !== "object") process.exit(1);
    if (Object.prototype.hasOwnProperty.call(body, "decision")) process.exit(1);
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") process.exit(1);
    if (hso.permissionDecision !== "deny") process.exit(1);
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) process.exit(1);
  ' "$output"; then
    reason="not-a-genuine-deny:$output"
  elif [ "$grants_after" != "$grants_before" ]; then
    reason="grant-count-changed:${grants_before}->${grants_after}"
  fi

  if [ -n "$reason" ]; then
    printf '%s: %s\n' "$label" "$reason"
    return 1
  fi
  return 0
}

_tg_run_scope_mismatch_table() {
  local subcommand="$1"
  local worktree_id plan_digest gen_id mint_out
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  mint_out="$(_mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60)"
  if [ -z "$mint_out" ]; then
    printf 'SETUP FAILURE: _mint_role_actor_binding produced no binding_id for %s scope table\n' "$subcommand"
    return 1
  fi

  local alt_worktree alt_plan
  alt_worktree="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  alt_plan="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"

  local failures=()
  local row
  for row in \
    "target_role-mismatch|{\"target_role\":\"toolkit-specialist\"}" \
    "worktree_id-mismatch|{\"subject_worktree_id\":\"$alt_worktree\"}" \
    "plan_digest-mismatch|{\"plan_digest\":\"$alt_plan\"}" \
  ; do
    local label overrides out
    label="${row%%|*}"; overrides="${row#*|}"
    if ! out="$(_tg_run_scope_mismatch_case "$subcommand" "$label" "$overrides")"; then
      failures+=("$out")
    fi
  done

  if [ "${#failures[@]}" -ne 0 ]; then
    printf 'FAILING SCOPE DIMENSIONS for %s (%d/3):\n' "$subcommand" "${#failures[@]}"
    printf '  %s\n' "${failures[@]}"
    return 1
  fi
  return 0
}

@test "TG-CLAIM-SCOPE-TABLE BLOCK: 'claim' denies with zero grant when the request-resolved target_role/worktree_id/plan_digest disagrees with the calling identity/current project scope, even though a live RoleActorBinding for the CALLER's own real identity exists" {
  run _tg_run_scope_mismatch_table claim
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-LEASE-SCOPE-TABLE BLOCK: 'lease-heartbeat' denies with zero grant when the request-resolved target_role/worktree_id/plan_digest disagrees with the calling identity/current project scope" {
  run _tg_run_scope_mismatch_table lease-heartbeat
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

@test "TG-PUBLISH-SCOPE-TABLE BLOCK: 'publish-result' denies with zero grant when the request-resolved target_role/worktree_id/plan_digest disagrees with the calling identity/current project scope" {
  run _tg_run_scope_mismatch_table publish-result
  [ "$status" -eq 0 ] || { echo "$output" >&2; false; }
}

# The claude-agent branch can never be proven via "denies with zero grant"
# alone (see _tg_run_tamper_table's own header): no ClaudeOneShotBinding is
# ever minted in this fixture universe, so a claude-agent-driver activation
# ALREADY denies today with "no single live ClaudeOneShotBinding..." --
# before AND after the fix, for an unrelated reason. This test instead
# discriminates on the DENY REASON TEXT itself: today the scope mismatch is
# never checked before that classifier lookup runs, so the reason can only
# ever be the classifier's own generic one; once the universal scope gate
# lands immediately after activation resolution (Codex's own ruling: "This
# universal scope gate applies to claude-agent and every non-Claude
# driver"), the SAME tampered request must instead be denied by the scope
# gate's own reason, before the classifier is ever reached.
@test "TG-CLAIM-SCOPE-CLAUDE-AGENT BLOCK: 'claim' against a target_role-mismatched request with a claude-agent-driver activation is denied by the SCOPE gate specifically, not merely by the downstream 'no live ClaudeOneShotBinding' classifier lookup" {
  local txn_id request_path
  txn_id="$(_random_hex32)"
  request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request_tampered "$request_path" arch-testing '{"target_role":"toolkit-specialist"}'
  _tg_write_activation_for_request "$request_path" claude-agent

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-scope-claude-worker)"
  _make_input "$cmd" arch-testing tg-scope-claude-caller
  _run_hook
  _assert_pretooluse_deny
  local reason; reason="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).hookSpecificOutput.permissionDecisionReason)' "$output")"
  [[ "$reason" == *"target_role/worktree_id/plan_digest"* ]] || { echo "reason was: $reason" >&2; false; }
}

# M7/WP4 hook-protocol cleanup: asserts a genuine PreToolUse deny per the
# official contract (code.claude.com/docs/en/hooks) against the last `run`
# ($status/$output) -- exit 0, hookSpecificOutput.hookEventName:"PreToolUse",
# permissionDecision:"deny", a non-empty permissionDecisionReason, and no
# deprecated top-level "decision" field. Never merely `[ "$status" -eq 2 ]`.
_assert_pretooluse_deny() {
  [ "$status" -eq 0 ]
  node -e '
    let body;
    try { body = JSON.parse(process.argv[1]); } catch (e) { process.stderr.write("not JSON: " + e.message + "\n"); process.exit(1); }
    if (!body || typeof body !== "object") { process.stderr.write("body not an object\n"); process.exit(1); }
    if (Object.prototype.hasOwnProperty.call(body, "decision")) { process.stderr.write("deprecated top-level decision field present\n"); process.exit(1); }
    const hso = body.hookSpecificOutput;
    if (!hso || hso.hookEventName !== "PreToolUse") { process.stderr.write("hookEventName mismatch: " + JSON.stringify(hso) + "\n"); process.exit(1); }
    if (hso.permissionDecision !== "deny") { process.stderr.write("permissionDecision mismatch: " + JSON.stringify(hso) + "\n"); process.exit(1); }
    if (typeof hso.permissionDecisionReason !== "string" || hso.permissionDecisionReason.length === 0) { process.stderr.write("permissionDecisionReason missing/empty\n"); process.exit(1); }
  ' "$output"
}

# ══════════════════════════════════════════════════════════════════════════
# Lifecycle target surface: `ready` only. Design UNCHANGED by this pass
# (COMMAND_FLAGS-extension only applies to runtime-consultation.cjs;
# runtime-role-lifecycle.cjs's own --lifecycle-binding slot already existed).
# ══════════════════════════════════════════════════════════════════════════

@test "TG-READY-1 PASS: 'ready' end-to-end through a real RoleActorBinding mints+injects --lifecycle-binding, genuinely round-trip-consumable" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-ready-1-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  [ -n "$action_id" ]

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-ready-1-session
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  local grant_id; grant_id="$(_extract_injected lifecycle-binding)"
  [ -n "$grant_id" ] || { printf '# ready hook output: %s\n' "$output" >&3; false; }

  # Genuine round-trip proof via the SAME exported validator the real CLI
  # itself uses -- never a shape-only check on the hook's own stdout.
  run node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const argvDigest = crypto.createHash("sha256").update("ready:" + process.argv[3]).digest("hex");
    const result = rll.validateAndConsumeLifecycleCommandGrant(process.argv[2], process.argv[4], argvDigest, "arch-testing", "ready", process.argv[3]);
    if (!result.ok) { process.stderr.write(JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$action_id" "$grant_id"
  [ "$status" -eq 0 ]
}

@test "TG-READY-ABSOLUTE-NODE PASS: accepted resolved-Node bootstrap command mints+injects --lifecycle-binding" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-ready-absolute-node-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  [ -n "$action_id" ]

  local resolved_node
  resolved_node="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.resolvedNodePath());' "$RLL_IMPL")"
  [ -n "$resolved_node" ]
  run node -e 'process.exit(require("path").isAbsolute(process.argv[1]) ? 0 : 1)' "$resolved_node"
  [ "$status" -eq 0 ]

  local cmd; cmd="$(_render_posix_direct "$resolved_node" "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-ready-absolute-node-session
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]
  local grant_id; grant_id="$(_extract_injected lifecycle-binding)"
  [ -n "$grant_id" ] || { printf '# absolute-node ready hook output: %s\n' "$output" >&3; false; }

  run node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const argvDigest = crypto.createHash("sha256").update("ready:" + process.argv[3]).digest("hex");
    const result = rll.validateAndConsumeLifecycleCommandGrant(process.argv[2], process.argv[4], argvDigest, "arch-testing", "ready", process.argv[3]);
    if (!result.ok) { process.stderr.write(JSON.stringify(result)); process.exit(1); }
  ' "$RLL_IMPL" "$PROJ" "$action_id" "$grant_id"
  [ "$status" -eq 0 ]
}

@test "TG-READY-2 BLOCK: a caller-supplied --lifecycle-binding on a 'ready' command is rejected outright, never trusted" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-ready-2-session)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  local forged; forged="$(_random_hex32)"

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id" --lifecycle-binding "$forged")"
  _make_input "$cmd" arch-testing tg-ready-2-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-READY-3 BLOCK: 'ready' for a nonexistent action is a lookup failure inside an owning flow -- blocks, never falls through to passthrough" {
  local bogus_action; bogus_action="$(_random_hex32)"
  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$bogus_action")"
  _make_input "$cmd" arch-testing tg-ready-3-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-READY-4 BLOCK: 'ready' for an action whose kind is not role-spawn/role-rebind (e.g. role-notify) is pre-validated and blocked here too, never minted" {
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES='["claude-sendmessage"]' \
  run node -e '
    const rll = require(process.argv[1]);
    const projectRoot = process.argv[2];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: "tg-ready-4-session" };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    const bindingResult = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planResult.planDigest, 120);
    const genResult = rll.resolveSessionGeneration(projectRoot, identity);
    const repoId = rll.computeRepoId(projectRoot);
    const pair = rll.resolvePolicyPair(projectRoot);
    const policyDigest = require("crypto").createHash("sha256").update(JSON.stringify(pair.routing)).digest("hex");
    const actionId = rll.generateActionId();
    const payload = rll.buildRoleNotifyPayload(bindingResult.binding.binding_id, "arch-testing", "fixture-ref", "context", "fixture message");
    const expiresAtIso = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const mintResult = rll.mintRoleLifecycleAction(projectRoot, actionId, "role-notify", "claude-native", repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, "arch-testing", payload, expiresAtIso);
    if (!mintResult.ok) { process.stderr.write("mint failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(actionId);
  ' "$RLL_IMPL" "$PROJ"
  [ "$status" -eq 0 ]
  local action_id="$output"
  [ -n "$action_id" ]

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-ready-4-caller
  _run_hook
  _assert_pretooluse_deny
}

# P0 (HARD NO-GO finding #4, corrected this pass): "ready can resolve a
# same-named binding." findLiveRoleActorBindings (called from
# handleReadyOwning) scopes ONLY by {role, worktree_id, plan_digest} --
# validateRoleActorBindingFor's own signature has NO sessionGenerationId
# parameter at all (confirmed by direct read) -- so a SINGLE live binding
# whose session_generation_id does NOT match the target action's own is
# happily accepted today: candidates.length===1, no ambiguity ever fires,
# and the wrong-generation binding is used to mint a real, valid grant. This
# is the exact "resolve a same-named binding" gap: not two simultaneously-
# live bindings (TG-CONSULT-AMBIGUOUS's own scenario, already blocked), but
# ONE live binding that is honestly the WRONG one for this action.
@test "TG-READY-WRONG-GENERATION BLOCK: exactly one live RoleActorBinding exists for {role,worktree,plan}, but its session_generation_id does NOT match the target action's own -- must block, never silently accepted as if it were the action's real binding" {
  local out action_id worktree_id plan_digest gen_id
  out="$(_mint_pending_role_spawn_full arch-testing tg-readywronggen-session false)"
  read -r action_id worktree_id plan_digest gen_id <<< "$out"
  [ -n "$action_id" ]

  # A single live binding for the identical {role, worktree, plan} scope, but
  # deliberately minted under a DIFFERENT (stale/foreign) session_generation_id
  # than the one the target action actually carries -- e.g. left over from an
  # earlier spawn attempt of the same role that was later rebound/restarted.
  local wrong_gen; wrong_gen="$(_random_hex32)"
  [ "$wrong_gen" != "$gen_id" ]
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$wrong_gen" 60

  local cmd; cmd="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id")"
  _make_input "$cmd" arch-testing tg-readywronggen-session
  _run_hook
  _assert_pretooluse_deny

  # Regression/positive-control half: the SAME action, once the CORRECT
  # (matching-generation) binding also exists (both simultaneously live is
  # itself the pre-existing TG-CONSULT-AMBIGUOUS-style multiplicity case, so
  # this half is proven via a FRESH action/session pair instead) still
  # succeeds when its own binding's generation genuinely matches.
  local out2 action_id2 worktree_id2 plan_digest2 gen_id2
  out2="$(_mint_pending_role_spawn_full arch-testing tg-readywronggen-session-2)"
  read -r action_id2 worktree_id2 plan_digest2 gen_id2 <<< "$out2"
  local cmd2; cmd2="$(_render_posix_direct node "$RLL_IMPL" ready --action "$action_id2")"
  _make_input "$cmd2" arch-testing tg-readywronggen-session-2
  _run_hook
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Consultation target surface: claim / lease-heartbeat / publish-result /
# worker-stop-ack. CORRECTED DESIGN (supersedes the first-pass "no injection"
# conclusion, see file header): the hook now mints+INJECTS a real
# --target-binding <id> flag, mirroring the `ready` surface exactly, and the
# CORE (runtime-consultation.cjs) now genuinely receives+consumes+validates
# it before any read or mutation.
# ══════════════════════════════════════════════════════════════════════════

@test "TG-CLAIM-1 PASS: a real 'claim' invocation with a live RoleActorBinding for the calling role AND a live, correlated, non-claude-agent activation gets --target-binding INJECTED, and the injected flag is genuinely recognized/processed by the REAL production CLI (never rejected as an unrecognized flag)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: claim/lease-heartbeat/publish-result now
  # REQUIRE a resolvable, live activation (genuine absence blocks -- see
  # TG-CLAIM-1-ABSENT-BLOCKS below) -- a real, correlated, non-claude-agent
  # activation is the precondition for reaching the RoleActorBinding branch.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-1-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  # The command IS rewritten now (design correction: claim gains a real
  # --target-binding landing spot on COMMAND_FLAGS) -- pre-fix (pre-fix) the
  # hook still returns the unmodified command (no injection exists yet), so
  # this is the exact regression: no --target-binding is present to extract.
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  # Round trip via the real production CLI subprocess -- proves the flag is
  # genuinely recognized argv (COMMAND_FLAGS extended), never rejected at the
  # parse layer. NOT asserting full business-level SUCCESS here deliberately:
  # this fixture's --request path has no real request.json behind it (this
  # test's own scope is the GRANT layer, not full transaction-state-machine
  # setup), so even a fully-correct implementation would still fail later on
  # CORRELATION_INVALID ("no such request") -- asserting full success would
  # make this test permanently un-greenable for a reason unrelated to grants.
  # "never unrecognized-flag" is the precise, achievable, honest claim: pre-fix
  # this fails with exactly "unrecognized flag for claim: --target-binding"
  # (a USAGE_ERROR at the argv-parsing layer, before ANY grant logic could
  # even run) -- once COMMAND_FLAGS is extended, the SAME command must get
  # past that layer entirely, regardless of what happens next.
  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

@test "TG-LEASE-1 PASS: a real 'lease-heartbeat' invocation with a live RoleActorBinding gets --target-binding INJECTED and round-trips through the REAL production CLI" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")"
  _make_input "$cmd" arch-testing tg-lease-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  # No live request/claim exists for this fixture (this test's own scope is
  # the GRANT layer, not full transaction-state-machine setup) -- the real
  # CLI is expected to fail on CORRELATION_INVALID (no such request/claim),
  # never on the GRANT itself. The discriminator that proves the grant layer
  # passed is that it fails for a DIFFERENT, later reason than "unrecognized
  # flag" -- captured precisely by TG-CLAIM-1's own full-success round trip
  # above (a real request DOES exist there); this test instead pins that the
  # flag itself is now a real, recognized landing spot (never USAGE_ERROR/
  # unrecognized-flag) once the fix lands.
  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

@test "TG-PUBLISH-1 PASS: a real 'publish-result' invocation with a live RoleActorBinding gets --target-binding INJECTED (round-trip proof mirrors TG-LEASE-1: real flag recognition, never unrecognized-flag)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)"
  _make_input "$cmd" arch-testing tg-publish-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 GREEN correction round 2, R5: negative table for claim/lease-heartbeat/
# publish-result. Each of these three commands must now BLOCK with zero
# grant when the request's own activation is genuinely ABSENT, DECORRELATED
# (present but wrong request/attempt), or EXPIRED -- never a silent
# RoleActorBinding fallback. A live RoleActorBinding is minted in every case
# below specifically to prove the block is NOT merely "no RoleActorBinding
# either" -- the activation-resolution gate itself is what denies.
# ══════════════════════════════════════════════════════════════════════════

@test "TG-CLAIM-1-ABSENT-BLOCKS: 'claim' against a request with NO activation record at all is blocked with zero grant -- correction round 2's R5 ruling reverses the prior 'absence allowed' design" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-absent-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-absent-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-LEASE-1-ABSENT-BLOCKS: 'lease-heartbeat' against a request with NO activation record at all is blocked with zero grant -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" lease-heartbeat --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json")"
  _make_input "$cmd" arch-testing tg-lease-absent-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-PUBLISH-1-ABSENT-BLOCKS: 'publish-result' against a request with NO activation record at all is blocked with zero grant -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" publish-result --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --claim "$PROJ/.planning/coordination/$txn_id/attempt/claim.json" --content aGVsbG8)"
  _make_input "$cmd" arch-testing tg-publish-absent-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-CLAIM-1-DECORRELATED-BLOCKS: 'claim' against a request whose activation record lives at the CORRECT resolved-attempt path but carries a mismatched embedded request_id is blocked with zero grant, never silently folded into ABSENT/RoleActor fallback -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request "$request_path" noop
  local real_attempt_id; real_attempt_id="$(printf 'f%.0s' $(seq 1 64))"
  local activation_path; activation_path="$(dirname "$request_path")/activations/$real_attempt_id.json"
  # Tamper the activation's OWN embedded request_id, in place, at the exact
  # CORRECT path (activationPathFor(txnDir, resolvedAttemptId) still finds
  # this file -- DURABLE_PRESENT) -- proves the resolver checks the
  # record's own content correlation, never merely "something exists at the
  # expected path".
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.request_id = "9".repeat(64);
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$activation_path"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-decorrelated-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-decorrelated-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-CLAIM-1-EXPIRED-BLOCKS: 'claim' against a request whose ONLY correlated activation is already past its own activation_liveness_expiry is blocked with zero grant, never treated as still valid -- correction round 2's R5 ruling" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  _tg_write_activation_for_request "$request_path" noop
  local real_attempt_id; real_attempt_id="$(printf 'f%.0s' $(seq 1 64))"
  local activation_path; activation_path="$(dirname "$request_path")/activations/$real_attempt_id.json"
  # Rewrite activation_liveness_expiry to genuinely already past.
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    obj.activation_liveness_expiry = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, "Z");
    fs.writeFileSync(p, JSON.stringify(obj), { mode: 0o600 });
  ' "$activation_path"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-claim-expired-worker-session)"
  _make_input "$cmd" arch-testing tg-claim-expired-caller
  _run_hook
  _assert_pretooluse_deny
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -z "$grant_id" ]
}

@test "TG-STOPACK-1 PASS: a real 'worker-stop-ack' invocation with a live RoleActorBinding gets --target-binding INJECTED (round-trip proof mirrors TG-LEASE-1)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local stop_path="$PROJ/.planning/coordination/stops/stop.json"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" worker-stop-ack --coordination-root "$PROJ/.planning/coordination" --stop "$stop_path" --disposition exact-transaction)"
  _make_input "$cmd" arch-testing tg-stopack-1-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -n "$output" ]

  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"
  [ "$rewritten" != "$cmd" ]

  _run_cli_command "$rewritten"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
}

@test "TG-CONSULT-NOBIND BLOCK: 'claim' with NO live RoleActorBinding for the calling role at all is a lookup failure inside an owning flow -- blocks, never passthrough" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-nobind-worker-session)"
  _make_input "$cmd" arch-testing tg-nobind-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-CONSULT-AMBIGUOUS BLOCK: two simultaneously-live RoleActorBindings for the identical {role,worktree,plan} scope deny as ambiguous, never silently pick one" {
  local worktree_id plan_digest
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  # Two independent, both-live bindings for the SAME exact scope -- neither
  # superseded, neither expired. Order of creation is irrelevant: a correct
  # fix collects ALL live candidates before deciding, so this is genuinely
  # deterministic regardless of directory-iteration order.
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$(_random_hex32)" 60
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$(_random_hex32)" 60

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-ambiguous-worker-session)"
  _make_input "$cmd" arch-testing tg-ambiguous-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-CONSULT-CALLERBINDING BLOCK: a caller-supplied --target-binding on an otherwise-real 'claim' command is rejected outright, never validated-and-allowed" {
  local worktree_id plan_digest gen_id forged
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  forged="$(_random_hex32)"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-callerbind-worker-session --target-binding "$forged")"
  _make_input "$cmd" arch-testing tg-callerbind-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-CONSULT-WRONGFLAG BLOCK: a caller-supplied --lifecycle-binding (the OTHER grant flag) on a 'claim' command is ALSO rejected outright -- proves the check is not naively scoped to only one flag name" {
  local worktree_id plan_digest gen_id forged
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  forged="$(_random_hex32)"

  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-wrongflag-worker-session --lifecycle-binding "$forged")"
  _make_input "$cmd" arch-testing tg-wrongflag-caller
  _run_hook
  _assert_pretooluse_deny
}

@test "TG-ACCEPT-RESULT-NONTARGET: 'accept-result' (requester-owned, PLAN.md §15b) is never treated as target-surface owning -- passthrough, zero side effects" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json")"
  _make_input "$cmd" arch-testing tg-acceptresult-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "TG-TRANSACTION-ACK-NONTARGET: 'transaction-ack' (requester-owned, PLAN.md §15b) is never treated as target-surface owning -- passthrough, zero side effects" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --disposition accepted)"
  _make_input "$cmd" arch-testing tg-transactionack-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "TG-STORAGE-LOCATION: a genuinely minted+injected target grant lives under registryRepoDir, never under .planning/ (host-private, never model-visible)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session tg-storage-worker-session)"
  _make_input "$cmd" arch-testing tg-storage-caller
  _run_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]

  # Never model-visible under .planning/ (the OLD, superseded design's own path).
  [ ! -d "$PROJ/.planning/coordination/target-grants" ]

  # Genuinely present under the host-private registry base for this repo, and
  # that base itself is never anywhere inside the project tree.
  local grants_dir; grants_dir="$(_role_command_grants_dir)"
  [ -n "$grants_dir" ]
  [[ "$grants_dir" != "$PROJ"* ]]
  [ -f "$grants_dir/$grant_id.json" ]
}

@test "TG-NONCANONICAL: a non-canonical (unquoted) 'claim' command is never recognized as owning -- allowed as ordinary passthrough, with EMPTY stdout (no hookSpecificOutput of any kind)" {
  local cmd="node $CONSULTATION_CLI claim --coordination-root $PROJ/.planning/coordination --request $PROJ/.planning/coordination/txn/request.json --role arch-testing --worker-session tg-noncanon-worker-session"
  _make_input "$cmd" arch-testing tg-noncanon-caller
  _run_hook
  [ "$status" -eq 0 ]
  # Under the corrected inject-a-real-flag design, a LEGITIMATELY recognized-
  # and-allowed claim call now ALWAYS emits a real JSON hookSpecificOutput
  # body carrying the injected --target-binding (see TG-CLAIM-1) -- so empty
  # stdout remains the correct, unambiguous discriminator for "never even
  # recognized as owning" specifically.
  [ -z "$output" ]
}

@test "TG-CHAINED: a chained 'claim' command (';' operator) is never recognized as owning -- no injection, never a security bypass via chaining, EMPTY stdout" {
  local base; base="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$PROJ/.planning/coordination/txn/request.json" --role arch-testing --worker-session tg-chained-worker-session)"
  local cmd="$base; echo pwned"
  _make_input "$cmd" arch-testing tg-chained-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "TG-UNRELATED PASS: an unrelated Bash command (not a target-surface subcommand at all) is allowed, zero side effects" {
  _make_input "git status" arch-testing tg-unrelated-caller
  _run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ══════════════════════════════════════════════════════════════════════════
# CPG-SUPERVISOR (M6-CODEX-SUPERVISOR-ACTIVATION-CLOSURE, RED phase): argv-
# canonicalization negatives for context-provider-gate.js's (currently
# nonexistent) supervisor-start bridge_command recognition -- PLAN.md's own
# manifest names THIS file as the home for "the top-level-only background
# supervisor form... chained/redirection/extra-flag/background negatives"
# (~L195). The full semantic validation matrix (positive path, subagent,
# forged/expired/wrong-plan/wrong-worktree/cross-session, genuine
# SupervisorExecutionClaim/v1 round-trip) lives in context-provider-gate.
# test.js (M6 GROUP A section), mirroring its own established LG-*/RQ-*
# table-driven JS pattern; this section owns ONLY the bash-argv-shape
# negatives, mirroring bash-cli-spawn-gate.bats' own injection matrix but
# targeting context-provider-gate.js (_run_cp_hook, already defined above)
# instead of bash-cli-spawn-gate.js -- proving THIS hook's own (future)
# recognition is ALSO a positive allowlist, independently.
# ══════════════════════════════════════════════════════════════════════════

M6A_CAPABILITY="cpg-m6a-supervisor-fixture-capability"

# Mints a REAL batched 5-role supervisor-start action (the exact configured
# support-plane role set) via the actual production ensure()/grant machinery
# under a fake codex-app-server-only capability -- mirrors bash-cli-spawn-
# gate.bats' own _mint_action/_mint_supervisor_start_action precedent
# exactly (no CLAUDE-ID-01 priming needed for codex-app-server, confirmed:
# that file's own extensively-green fixture never primes it either). Prints
# the real bridge_command on stdout.
#
# LEAD FIX (mutation-testing pass, 2026-08-12): takes the session key as an
# explicit argument, used BOTH to mint the MainOrchestratorBinding here AND
# by every caller's own subsequent `_make_input ... <session>` invocation --
# the two must be the SAME session. The original version minted under an
# internally-generated random session while every call site invoked the hook
# under a DIFFERENT, hardcoded one; mutation testing caught that this
# mismatch alone (independent of any argv tampering) already triggers
# `main-binding-shape-mismatch`, verified directly: the SAME untampered
# bridge_command, replayed under a mismatched session with zero argv
# manipulation, is denied for that reason alone. That made the argv-specific
# checks these 4 tests are named for and the dispatch's own RED requirements
# describe unfalsifiable by this fixture -- a session mismatch would mask a
# broken/removed argv check and still show a passing "DENIED" assertion.
_m6a_mint_supervisor_start_action() {
  local session_key="$1"
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$M6A_CAPABILITY" node -e '
    const rll = require(process.argv[1]);
    const crypto = require("crypto");
    const { execFileSync } = require("child_process");
    const projectRoot = process.argv[2];
    const sessionKey = process.argv[3];
    const roles = ["arch-platform","arch-testing","arch-integration","context-provider","doc-updater"];
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionKey };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planDigest = rll.discoverPlan(projectRoot).planDigest;
    const binding = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 120).binding;
    const sha256String = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
    const sortedRoles = roles.slice().sort();
    const argvDigest = sha256String("ensure:" + sortedRoles.join(","));
    const grant = rll.mintLifecycleCommandGrant(projectRoot, binding, argvDigest, sortedRoles, "ensure", "main-orchestrator", "orchestrator", "normal", null);
    const args = [process.argv[1], "ensure", "--project-root", projectRoot];
    for (const r of roles) args.push("--role", r);
    args.push("--lifecycle-binding", grant.grantId);
    const out = execFileSync("node", args, {
      encoding: "utf8",
      env: Object.assign({}, process.env, {
        HOME: process.argv[4],
        CODEX_CLI_PATH: process.argv[5],
        RUNTIME_ROLE_LIFECYCLE_TEST_BACKEND: "deterministic-app-server-v1",
        RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: JSON.stringify(["codex-app-server"]),
      }),
    });
    const result = JSON.parse(out.trim().split("\n").pop());
    // M67-ROLE-GATE-FLAKE-01: explicit shape/status assertions BEFORE ever
    // dereferencing the found action -- a missing/wrong-shaped action must
    // fail loudly with the full raw result, never collapse into a generic
    // "Cannot read properties of undefined" a few lines below that gives no
    // diagnostic signal at all about WHY the expected ACTION_REQUIRED
    // supervisor-start action was not where this fixture expects it.
    if (result.status !== "ACTION_REQUIRED") {
      process.stderr.write("M6A fixture: expected ensure() status ACTION_REQUIRED, got " + JSON.stringify(result));
      process.exit(1);
    }
    if (!Array.isArray(result.actions)) {
      process.stderr.write("M6A fixture: result.actions is not an array: " + JSON.stringify(result));
      process.exit(1);
    }
    const action = result.actions.find((a) => a.kind === "supervisor-start");
    if (!action || !action.payload || typeof action.payload.bridge_command !== "string" || action.payload.bridge_command.length === 0) {
      process.stderr.write("M6A fixture: no well-formed supervisor-start action with a non-empty bridge_command among the actions ensure() returned: " + JSON.stringify(result));
      process.exit(1);
    }
    process.stdout.write(action.payload.bridge_command);
  ' "$RLL_IMPL" "$PROJ" "$session_key" "$TEST_HOME" "$FAKE_CODEX"
}

@test "CPG-SUPERVISOR-EXTRAFLAG: an extra trailing flag appended to the canonical bridge_command is explicitly DENIED by context-provider-gate.js -- mirrors bash-cli-spawn-gate.js's own established recognition discipline (BRIDGE_MARKER_RE substring match -> full scrutiny -> fail-closed on non-round-trip, GATE-inject-extraflag's own precedent), independently enforced here" {
  local bridge_command; bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-extraflag-session)"
  [ -n "$bridge_command" ]
  _make_input "${bridge_command} '--extra'" "" cpg-m6a-extraflag-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "CPG-SUPERVISOR-CHAINED: a semicolon-chained second command appended to the canonical bridge_command is explicitly DENIED by context-provider-gate.js, never a security bypass via chaining (mirrors GATE-inject-semicolon's own precedent)" {
  local bridge_command; bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-chained-session)"
  [ -n "$bridge_command" ]
  _make_input "${bridge_command}; rm -rf /tmp/whatever" "" cpg-m6a-chained-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "CPG-SUPERVISOR-REDIRECT: an appended output redirect on the canonical bridge_command is explicitly DENIED by context-provider-gate.js (mirrors GATE-inject-redirect's own precedent)" {
  local bridge_command; bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-redirect-session)"
  [ -n "$bridge_command" ]
  _make_input "${bridge_command} > /tmp/cpg-m6a-redirect-out" "" cpg-m6a-redirect-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "CPG-SUPERVISOR-NONCANONICAL: a non-canonical (unquoted) rendering of the SAME underlying bridge_argv is explicitly DENIED by context-provider-gate.js -- canonical parser only, never a structurally-equivalent-but-differently-formatted match (mirrors GATE-inject-altquoting's own precedent)" {
  local bridge_command unquoted
  bridge_command="$(_m6a_mint_supervisor_start_action cpg-m6a-noncanonical-session)"
  [ -n "$bridge_command" ]
  unquoted="$(node -e 'const rll=require(process.argv[1]); process.stdout.write(rll.parsePosixDirect(process.argv[2]).join(" "));' "$RLL_IMPL" "$bridge_command")"
  [ "$unquoted" != "$bridge_command" ]
  _make_input "$unquoted" "" cpg-m6a-noncanonical-session
  _run_cp_hook
  _assert_pretooluse_deny
}

# ══════════════════════════════════════════════════════════════════════════
# RCG-SCHEMA: the exact PLAN.md §15b closed grant schema, verbatim.
# ══════════════════════════════════════════════════════════════════════════

@test "RCG-SCHEMA-CLOSED: a genuinely minted role-command-grant/v1 has EXACTLY the PLAN.md §15b closed key-set (schema,grant_id,binding_id,actor_instance_id,authority,subcommand,request_id,attempt_id,lease_epoch,canonical_argv_digest,plan_digest,worktree_id,role,created_at,expiry) -- no extra field (e.g. the prior pass's own ad-hoc stop_id), none missing (e.g. attempt_id/lease_epoch, absent entirely from the prior pass's grant object)" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-schema-worker-session)"
  _make_input "$cmd" arch-testing rcg-schema-caller
  _run_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]

  run node -e '
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = ["actor_instance_id","attempt_id","authority","binding_id","canonical_argv_digest","created_at","expiry","grant_id","lease_epoch","plan_digest","request_id","role","schema","subcommand","worktree_id"];
    const actual = Object.keys(rec).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      process.stderr.write("key-set mismatch. expected=" + JSON.stringify(expected) + " actual=" + JSON.stringify(actual));
      process.exit(1);
    }
    if (rec.schema !== "runtime/role-command-grant/v1") { process.stderr.write("wrong schema: " + rec.schema); process.exit(1); }
    if (rec.authority !== "target") { process.stderr.write("wrong authority: " + rec.authority); process.exit(1); }
  ' "$(_role_command_grant_path "$grant_id")"
  [ "$status" -eq 0 ]
}

# ══════════════════════════════════════════════════════════════════════════
# Requester/admin surface: root-init/root-validate (nullable request/attempt/
# epoch, PLAN.md ~L592) via context-provider-gate.js. Table-driven hook-only
# mechanics (rerender, internal mint failure, missing session_id, caller-
# supplied-flag rejection, per-subcommand coverage of every requester-owned
# subcommand) live in context-provider-gate.test.js -- this section owns the
# full hook-mint -> real-CLI-consume round trip and the PLAN §592 nullability
# contract specifically.
# ══════════════════════════════════════════════════════════════════════════

_admin_root_init_cmd() {
  _render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination"
}

@test "RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01 BLOCK: a main-orchestrator (role-null) 'root-init' invocation must NEVER get a --requester-binding minted -- main-orchestrator structurally cannot satisfy CLAUDE-ID-01 (PLAN.md ~L588: a bounded disposable peer must produce a host-private correlation trace covering SubagentStart, two distinct PreToolUse events, a sleep/wake or resume boundary, and a final PreToolUse), since the main orchestrator never receives a SubagentStart event about itself. Not merely a plausible inference: PLAN.md ~L594 independently defines the SEPARATE MainOrchestratorBinding/v1's own derivation as requiring 'no correlated pending SubagentStart' -- PLAN already treats absence-of-SubagentStart as main-orchestrator's own defining characteristic elsewhere, so this exclusion is CLAUDE-ID-01 applied uniformly, not a carve-out invented for this pass. M7/WP4 FINAL COMPLETENESS correction (2026-08-09): supersedes this test's own prior PASS expectation, which asserted the OPPOSITE (main-orchestrator minting succeeds) against the pre-CLAUDE-ID-01-enforcement implementation -- see runtime-role-lifecycle.cjs ~L1354-1386's own 'never CLAUDE-ID-01-gated' scope note for the (now-superseded) rationale that shipped createRequesterBinding without this check." {
  local cmd; cmd="$(_admin_root_init_cmd)"
  _make_input "$cmd" "" rcg-claudeid01-rootinit-session
  local grants_dir; grants_dir="$(_role_command_grants_dir)"
  local before=0
  [ -d "$grants_dir" ] && before="$(find "$grants_dir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"

  _run_cp_hook
  _assert_pretooluse_deny

  # No side effect: main-orchestrator's disqualification must be decided
  # BEFORE any binding/grant is minted, never mint-then-discard.
  local after=0
  [ -d "$grants_dir" ] && after="$(find "$grants_dir" -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$after" -eq "$before" ]
}

@test "RCG-ADMIN-NULLFIELDS: a requester grant minted for an admin op (root-init) carries request_id/attempt_id/lease_epoch ALL null (PLAN.md ~L592: 'For root-init|root-validate|validate, request/attempt/epoch are null but actor/PLAN/worktree/argv remain exact and the grant is still mandatory'), while every other field remains genuinely populated" {
  # M7/WP4 FINAL COMPLETENESS correction (2026-08-09): identity changed from
  # main-orchestrator (agent_type:"") to a named role (arch-testing) -- main-
  # orchestrator can no longer mint a requester grant at all (see
  # RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01), so this test's OWN concern (the
  # null-fields SHAPE of an admin-op grant) is now proven via an identity that
  # CAN still mint, mirroring RCG-ADMIN-NONMAIN's own already-proven pattern.
  _prime_claude_id01_trace arch-testing rcg-nullfields-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  _make_input "$cmd" arch-testing rcg-nullfields-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]

  run node -e '
    const fs = require("fs");
    const rec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (rec.request_id !== null) { process.stderr.write("request_id must be null for root-init: " + JSON.stringify(rec.request_id)); process.exit(1); }
    if (rec.attempt_id !== null) { process.stderr.write("attempt_id must be null for root-init: " + JSON.stringify(rec.attempt_id)); process.exit(1); }
    if (rec.lease_epoch !== null) { process.stderr.write("lease_epoch must be null for root-init: " + JSON.stringify(rec.lease_epoch)); process.exit(1); }
    if (rec.authority !== "requester") { process.stderr.write("authority must be requester: " + rec.authority); process.exit(1); }
    if (typeof rec.plan_digest !== "string" || rec.plan_digest.length === 0) { process.stderr.write("plan_digest must still be populated"); process.exit(1); }
    if (typeof rec.worktree_id !== "string" || rec.worktree_id.length === 0) { process.stderr.write("worktree_id must still be populated"); process.exit(1); }
  ' "$(_role_command_grant_path "$grant_id")"
  [ "$status" -eq 0 ]
}

@test "RCG-ADMIN-ROOTVALIDATE-ROUNDTRIP-CLAUDEID01 BLOCK: 'root-validate' from a main-orchestrator (role-null) invocation must ALSO never get a --requester-binding minted (proves the CLAUDE-ID-01 exclusion generalizes beyond root-init specifically, mirroring this test's own prior 'proves the mechanism generalizes' framing but for the corrected, restrictive direction)" {
  # root-validate needs a coordination_root that already genuinely exists.
  mkdir -p "$PROJ/.planning/coordination"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-validate --coordination-root "$PROJ/.planning/coordination")"
  _make_input "$cmd" "" rcg-claudeid01-rootvalidate-session
  _run_cp_hook
  _assert_pretooluse_deny
}

@test "RCG-ADMIN-NONMAIN PASS: requester-grant injection is NOT scoped to the main orchestrator only -- a named role (e.g. arch-testing) invoking root-init via Bash ALSO gets --requester-binding injected (PLAN.md ~L590: RequesterIdentityProvider role=agent_type generically, not main-orchestrator-specific)" {
  _prime_claude_id01_trace arch-testing rcg-nonmain-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  _make_input "$cmd" arch-testing rcg-nonmain-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
}

@test "RCG-ADMIN-CALLERSUPPLIED BLOCK: a root-init command already carrying --requester-binding when it reaches context-provider-gate.js is rejected outright, mirroring the --lifecycle-binding precedent exactly" {
  local forged; forged="$(_random_hex32)"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination" --requester-binding "$forged")"
  _make_input "$cmd" "" rcg-callersupplied-session
  _run_cp_hook
  _assert_pretooluse_deny
}

# ══════════════════════════════════════════════════════════════════════════
# RCG-ATTACK: core-level adversarial matrix. Every test here mints a
# genuinely REAL grant (via the owning hook), then attacks the resulting
# on-disk artifact or executed command in exactly one specific way, and
# proves the REAL production CLI subprocess rejects it -- never merely that
# a hook says so.
# ══════════════════════════════════════════════════════════════════════════

# NOTE on vehicle choice below: `claim` needs a REAL request.json to reach
# full business success, which this file deliberately does not build (its
# own scope is the grant layer, not the full publish-request/dispatch
# pipeline) -- so a claim-based "must reject" test whose only observable
# signal is a raw non-zero exit code is VACUOUS: claim already fails with
# CORRELATION_INVALID ("no such request") for a reason totally unrelated to
# grants, so it would show as passing even if grant enforcement were never
# implemented at all. `root-init` (--coordination-root only, empirically
# confirmed idempotent -- see this file's own dev history) has no such
# fixture gap: a legitimate, untampered call genuinely succeeds end-to-end,
# so a subsequent attack's failure is UNAMBIGUOUSLY attributable to the
# grant layer. root-init is therefore the primary vehicle for every
# attack below that does not intrinsically require a --role concept.

@test "RCG-ATTACK-ARGV-TAMPER-ROOTINIT BLOCK: a requester grant minted+injected for root-init against coordination-root A is replayed against a DIFFERENT coordination-root B (same grant_id, argv otherwise altered post-mint) -- the recomputed pre-injection argv digest no longer matches, so the core must reject, never silently authorize a different call than the one actually authorized" {
  # M7 correction round 1 test-side reconciliation (2026-08-18, task #50):
  # coordination-root A and B must be two INDEPENDENT projects' own genuinely
  # canonical roots, never two subdirectories of one project -- C2's new
  # one-canonical-root-per-project invariant (coordinationRootPathFor always
  # resolves to the SAME .planning/coordination for a given project, no
  # suffix support) means a "coordination-a"/"coordination-b" subdirectory
  # pair can never BOTH be canonical, so even the legitimate control call
  # below would be rejected as non-canonical -- a reason unrelated to the
  # argv-tamper property this test isolates. proj_b mirrors this file's own
  # setup() git-init pattern; no PLAN.md needed since proj_b is never minted
  # against, only used as the literal --coordination-root value for the
  # final tampered replay (a direct CLI call, never through a hook).
  local proj_b; proj_b="$(mktemp -d)"
  git -C "$proj_b" init -q 2>/dev/null
  git -C "$proj_b" config user.email "bats@test.local"
  git -C "$proj_b" config user.name "Bats Test"
  git -C "$proj_b" commit -q --allow-empty -m init 2>/dev/null

  local root_a="$PROJ/.planning/coordination"
  local root_b="$proj_b/.planning/coordination"
  _prime_claude_id01_trace arch-testing rcg-argvtamper-session
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$root_a")"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (argv-tamper rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-argvtamper-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]

  # Control: the legitimate, untampered command genuinely succeeds --
  # establishes that a failure below is attributable to the tamper, not to
  # some unrelated fixture gap.
  local legit; legit="$(_returned_command)"
  _run_cli_command "$legit"
  [ "$status" -eq 0 ] || {
    printf '# legitimate root-init failed: %s\n# authority: %s\n' "$output" "$(_requester_grant_authority_snapshot "$grant_id" "$legit")" >&3
    false
  }

  # Same grant_id, but --coordination-root now points at a COMPLETELY
  # DIFFERENT root than the one the grant actually authorizes. Uses a FRESH
  # grant (re-mint) since the control call above already consumed the first.
  # M6+M7 FINAL AUTHORITY CORRECTION (2026-08-11, narrow team-lead follow-up):
  # a distinct agent_id here (never the helper's shared 'tg-agent-id'
  # default) -- the SAME agent_id under a different session is exactly the
  # shape case 4's cross-peer collision check now correctly rejects (the
  # FIRST createRequesterBinding call above already minted a live binding for
  # {role:arch-testing, agent_id:tg-agent-id, session:rcg-argvtamper-session},
  # so a second mint for the same agent_id under a different session collides
  # with it), and this test isn't testing identity collision at all; it just
  # needs a second, independent fresh grant for argv-tamper-across-
  # coordination-roots. The distinct agent_id must be threaded through BOTH
  # the priming call AND the real _make_input call below (confirmed
  # empirically: priming alone is not sufficient -- the real PreToolUse call's
  # own recordClaudeId01PreToolUseObservation runs first and discards the
  # freshly-primed trace on ANY agent_id mismatch against it, reproducing the
  # identical claude-id01-trace-absent symptom for a different reason).
  _prime_claude_id01_trace arch-testing rcg-argvtamper-session-2 rcg-argvtamper-agent-2
  local cmd2; cmd2="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$root_a")"
  _make_input "$cmd2" arch-testing rcg-argvtamper-session-2 rcg-argvtamper-agent-2
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id2; grant_id2="$(_extract_injected requester-binding)"
  [ -n "$grant_id2" ]
  local tampered; tampered="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$root_b" --requester-binding "$grant_id2")"
  _run_cli_command "$tampered"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-REPLAY-ROOTINIT BLOCK: a genuinely-consumed grant cannot be reused a second time -- one-time consumption, atomic 'wins <grant_id>.used' (PLAN.md ~L604)" {
  _prime_claude_id01_trace arch-testing rcg-replay-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (replay rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-replay-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"

  # First use: must succeed. root-init is itself empirically idempotent, so
  # this is a genuine end-to-end SUCCESS, not merely "unrecognized flag".
  _run_cli_command "$rewritten"
  [ "$status" -eq 0 ] || {
    printf '# first root-init use failed: %s\n# authority: %s\n' "$output" "$(_requester_grant_authority_snapshot "$grant_id" "$rewritten")" >&3
    false
  }

  # Second use of the EXACT SAME rewritten command (same grant_id): must be
  # rejected -- the grant was already consumed. Root-init's OWN idempotency
  # (proven above via the CP-consult-flag-free first call) means this second
  # failure can ONLY be attributed to the grant replay, never to root-init
  # objecting to being called twice.
  _run_cli_command "$rewritten"
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-EXPIRED-ROOTINIT BLOCK: a grant whose on-disk expiry has already passed is rejected, never treated as still-live" {
  _prime_claude_id01_trace arch-testing rcg-expired-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (expiry rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-expired-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"

  _set_grant_field "$grant_id" expiry '"2000-01-01T00:00:00Z"'

  _run_cli_command "$rewritten"
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-ALTERED-ROOTINIT BLOCK: a grant whose on-disk 'plan_digest' field is tampered post-mint (still well-formed hex, no longer what was actually minted) is rejected" {
  _prime_claude_id01_trace arch-testing rcg-altered-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (field-tamper rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-altered-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected requester-binding)"
  [ -n "$grant_id" ]
  local rewritten; rewritten="$(_returned_command)"

  _set_grant_field "$grant_id" plan_digest "\"$(printf 'f%.0s' {1..64})\""

  _run_cli_command "$rewritten"
  [ "$status" -ne 0 ]
}

# KNOWN SCOPE LIMITATION (documented rather than silently accepted): unlike
# the root-init-based attacks above, this test's vehicle (claim) cannot
# reach full business success without a real request.json this file does
# not build (see the NOTE above this section). "not unrecognized-flag" is
# the strongest claim achievable without that fixture -- it proves the
# --target-binding flag is genuinely processed argv, but a WEAKER
# implementation that recognizes the flag/consumes the grant WITHOUT
# actually cross-checking --role against the grant's own bound role could
# in principle still make this test read as informative-but-not-fully-
# conclusive proof of cross-role rejection specifically (a claim call also
# fails downstream for the unrelated missing-request reason either way).
# Flagged explicitly for toolkit-specialist/arch-integration rather than
# silently presented as a full proof.
@test "RCG-ATTACK-CROSS-ROLE-CLAIM: a target grant genuinely minted for role A's RoleActorBinding, presented on a 'claim --role B' invocation, is at minimum never accepted as valid recognized-and-authorized argv" {
  local worktree_id plan_digest gen_id_a gen_id_b
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id_a="$(_random_hex32)"
  gen_id_b="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id_a" 60
  _mint_role_actor_binding toolkit-specialist "$worktree_id" "$plan_digest" "$gen_id_b" 60

  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-crossrole-worker-session)"
  _make_input "$cmd" arch-testing rcg-crossrole-caller
  _run_hook
  [ "$status" -eq 0 ]
  local grant_id; grant_id="$(_extract_injected target-binding)"
  [ -n "$grant_id" ]

  # Present the arch-testing-scoped grant on an otherwise-real
  # toolkit-specialist claim -- same request/worker-session shape, different
  # --role.
  local swapped; swapped="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role toolkit-specialist --worker-session rcg-crossrole-worker-session --target-binding "$grant_id")"
  _run_cli_command "$swapped"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
  [ "$status" -ne 0 ]
}

# KNOWN SCOPE LIMITATION: mirrors RCG-ATTACK-CROSS-ROLE-CLAIM's own note --
# claim cannot reach full business success without a real request.json this
# file does not build, so "not unrecognized-flag" + non-zero exit is the
# strongest achievable claim without that fixture.
@test "RCG-ATTACK-AUTHORITY-SWAP-REQUESTER-AS-TARGET: a genuinely-minted REQUESTER grant (root-init) presented as --target-binding on a 'claim' command is at minimum never accepted as valid recognized-and-authorized argv (authority mismatch, direct core call bypassing the target-gate hook entirely)" {
  _prime_claude_id01_trace arch-testing rcg-authswap1-session
  local cmd; cmd="$(_admin_root_init_cmd)"
  # M7/WP4 FINAL COMPLETENESS correction: named-role identity (main-orchestrator
  # can no longer mint at all -- see RCG-ADMIN-ROOTINIT-ROUNDTRIP-CLAUDEID01).
  # This test's own subject (authority-kind swap rejection) is orthogonal to identity.
  _make_input "$cmd" arch-testing rcg-authswap1-session
  _run_cp_hook
  [ "$status" -eq 0 ]
  local requester_grant; requester_grant="$(_extract_injected requester-binding)"
  [ -n "$requester_grant" ]

  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local request_path="$PROJ/.planning/coordination/txn/request.json"
  local claim_cmd; claim_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-authswap1-worker-session --target-binding "$requester_grant")"
  _run_cli_command "$claim_cmd"
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
  [ "$status" -ne 0 ]
}

@test "RCG-ATTACK-AUTHORITY-SWAP-TARGET-AS-REQUESTER BLOCK: a genuinely-minted TARGET grant (claim) is presented as --requester-binding on a 'root-init' command -- must reject on authority mismatch, direct core call bypassing context-provider-gate.js entirely" {
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local txn_id; txn_id="$(_random_hex32)"
  local request_path="$PROJ/.planning/coordination/$txn_id/request.json"
  _tg_write_minimal_request "$request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$request_path" noop
  local claim_cmd; claim_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$PROJ/.planning/coordination" --request "$request_path" --role arch-testing --worker-session rcg-authswap2-worker-session)"
  _make_input "$claim_cmd" arch-testing rcg-authswap2-caller
  _run_hook
  [ "$status" -eq 0 ]
  local target_grant; target_grant="$(_extract_injected target-binding)"
  [ -n "$target_grant" ]

  local root_init_cmd; root_init_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination" --requester-binding "$target_grant")"
  _run_cli_command "$root_init_cmd"
  [ "$status" -ne 0 ]
}

@test "RCG-BYPASS-ROOTINIT-NOGRANT: a direct 'root-init' invocation with NO grant flag at all, entirely bypassing context-provider-gate.js, must be rejected once the fix lands -- pre-fix it reaches and completes the protected operation unauthorized, which is exactly the vulnerability this whole pass closes" {
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination")"
  _run_cli_command "$cmd"
  [ "$status" -ne 0 ]
}

@test "RCG-BYPASS-ROOTINIT-FORGED: a direct 'root-init' invocation carrying a random, never-minted hex value as --requester-binding is rejected for a GRANT reason (absent/invalid), never treated as a valid reference -- distinct from RCG-BYPASS-ROOTINIT-NOGRANT (flag entirely absent) since this proves a well-formed-looking but fabricated value is equally rejected, not merely an omitted flag" {
  local forged; forged="$(_random_hex32)"
  local cmd; cmd="$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$PROJ/.planning/coordination" --requester-binding "$forged")"
  _run_cli_command "$cmd"
  # Discriminating specifically: pre-fix --requester-binding is not even a
  # recognized flag on root-init's COMMAND_FLAGS entry, so this already
  # exits non-zero for an entirely unrelated reason (USAGE_ERROR:
  # unrecognized flag) -- a bare `$status -ne 0` check would be vacuously
  # true regardless of whether grant validation is ever implemented. Once
  # the flag is real, the SAME forged value must be rejected for a genuine
  # grant reason (absent/invalid), which requires first getting PAST the
  # argv-parsing layer.
  # Verified empirically (not text-message matching -- runtime-consultation.cjs's
  # own CLI-result JSON envelope NEVER echoes the raw CliError message text,
  # only the terse {status,detail_code} pair): an unrecognized flag maps to
  # status:"USAGE_ERROR" (RC_FOR_STATUS.USAGE_ERROR===2) specifically. This is
  # the ONLY reliable way to detect "rejected at the argv-parsing layer,
  # before any grant logic could run" from the CLI's own real output shape.
  [[ "$output" != *'"status":"USAGE_ERROR"'* ]]
  [ "$status" -ne 0 ]
}

# claim-vehicle bypass coverage deliberately NOT duplicated here: without a
# real request.json (out of this file's scope, see the RCG-ATTACK section
# note above), a no-grant/forged-grant claim call already fails today for
# the unrelated "no such request" reason, which would make such a test
# vacuously green regardless of whether grant enforcement is ever
# implemented -- RCG-BYPASS-ROOTINIT-NOGRANT/FORGED above already prove the
# identical "direct core call bypassing hooks entirely" vulnerability on a
# vehicle where the signal is unambiguous.

# ══════════════════════════════════════════════════════════════════════════
# M7 completeness FINAL PASS (2026-08-09, RED phase only, dispatch
# team-lead-20260809-final-completeness): extends role-command-grant/v1
# requester-authority coverage to the 12 PLAN.md §15b requester subcommands
# NOT yet in ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND (runtime-consultation.cjs
# ~L5298-5305): publish-blob, publish-request, dispatch, record-delivery,
# takeover, await-result, accept-result, transaction-ack, cancel,
# worker-stop, cleanup, validate. This is the deliberate, disclosed
# scope-narrowing that constant's own comment (and context-provider-gate.js's
# own REQUESTER_ADMIN_SUBCOMMANDS comment) names as a reported follow-up, not
# a bug. No production fix lands in this pass -- every test below proves the
# gap still exists today.
#
# Wiring confirmed by direct read: main() calls
# validateAndConsumeRoleCommandGrantForCommand(command, flags, rawArgv)
# UNCONDITIONALLY before every handler (~L5676-5678), which itself no-ops
# for any command absent from ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND
# (~L5563-5564: "if (!authority) return; // not grant-gated in this pass's
# scope"). Extending enforcement to these 12 is therefore a pure DATA change
# (12 more map entries + a COMMAND_FLAGS extension) -- but that data change
# IS the implementation-phase fix, out of scope here.
#
# Discriminator: each command is called with argv conformant to the Frozen
# CLI ABI (PLAN.md ~L776-795) and NO grant flag at all. The target (GREEN,
# post-fix) assertion is `detail_code:"AUTHORITY_INVALID"` -- which is FALSE
# today for every one of the 12, since the check does not run. Each fixture
# is built to reach as far into real business logic as practically achievable
# without a grant (mirroring this file's own "vehicle choice" discipline from
# the RCG-ATTACK section above), so the RED is attributable to the missing
# CHECK, never to an unrelated fixture gap.
#
# KNOWN SCOPE LIMITATION (documented, not silently omitted -- mirrors this
# file's own RCG-ATTACK-CROSS-ROLE-CLAIM/AUTHORITY-SWAP precedent): COMMAND_FLAGS
# is NOT extended for any of these 12 (confirmed: the extension loop at
# runtime-consultation.cjs ~L5307-5310 only touches
# ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND's CURRENT 6 keys), so a
# --requester-binding flag on any of these 12 is UNRECOGNIZED ARGV today,
# rejected at the parseFlags layer (USAGE_ERROR) strictly BEFORE grant
# validation could ever run. The deeper adversarial matrix (replay,
# argv-tamper, expiry, authority-kind-swap, wrong request/attempt/epoch/
# role/worktree/plan_digest) all require the CLI to first ACCEPT a
# --requester-binding flag at all -- so it is NOT meaningfully testable at
# the CLI-argv level for these 12 commands until COMMAND_FLAGS is extended
# in the implementation phase. Writing such a test today would only ever
# prove "unrecognized flag -> USAGE_ERROR", true regardless of whether grant
# validation is ever wired -- a vacuous, non-discriminating test this file's
# own established philosophy explicitly rejects. Reported here, not faked.
#
# CARRIED FORWARD TO THE GREEN-PHASE PASS (explicit, per team-lead
# 2026-08-09): once toolkit-specialist extends COMMAND_FLAGS for these 12
# commands, the GREEN-phase test-specialist pass on this file MUST ALSO add
# the deeper adversarial matrix (replay/argv-tamper/expiry/authority-swap/
# wrong-scope-field) for them, mirroring the RCG-ATTACK-* section above's
# existing coverage of the 6 already-gated commands. A GREEN result on
# THIS pass's own RCG-REQ12-*-NOGRANT tests alone must never be read as
# "the 12 new commands' adversarial surface is fully covered" -- it proves
# only that the missing-grant gap has closed, not that the closed gate is
# itself adversarially hardened.
# ══════════════════════════════════════════════════════════════════════════

REQ12_WAVE_SLUG="tg-wave"
REQ12_GRANT_WRAPPER="$BATS_TEST_DIRNAME/fixtures/runtime-consultation-grant-wrapper.cjs"

_req12_sha256_string() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

_req12_repo_id() {
  local common_dir resolved
  common_dir="$(git -C "$PROJ" rev-parse --path-format=absolute --git-common-dir)"
  resolved="$(cd "$common_dir" 2>/dev/null && pwd -P)" || resolved="$common_dir"
  _req12_sha256_string "$resolved"
}

# Per-test fixture scope: root-inits $REQ12_COORD_ROOT (via the SAME grant-
# wrapper the pre-existing cli.bats/roots.bats/protocol.bats suites already
# rely on for this exact purpose -- root-init is one of the 6 ALREADY-gated
# commands, so it genuinely needs a grant to succeed at all) and computes
# every identity/scope field the request.json fixture builder below needs.
# Must be called once at the START of every @test in this section.
_req12_setup() {
  REQ12_COORD_ROOT="$PROJ/.planning/coordination"
  mkdir -p "$REQ12_COORD_ROOT"
  RCC_GRANT_PROJECT_ROOT="$PROJ" RCC_GRANT_ROLE=arch-testing NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$REQ12_GRANT_WRAPPER" root-init --coordination-root "$REQ12_COORD_ROOT" >/dev/null 2>&1
  REQ12_REPO_ID="$(_req12_repo_id)"
  REQ12_WORKTREE_ID="$(_worktree_id)"
  REQ12_PLAN_DIGEST="$(_plan_digest)"
  REQ12_SUBJECT_HEAD="$(git -C "$PROJ" rev-parse HEAD)"
}

_req12_plan_root() {
  printf '%s/%s/%s/%s' "$REQ12_COORD_ROOT" "$REQ12_REPO_ID" "$REQ12_WAVE_SLUG" "$REQ12_PLAN_DIGEST"
}

_req12_request_path() {
  printf '%s/transactions/%s/request.json' "$(_req12_plan_root)" "$1"
}

# consult/v2 fixture builder -- same override/__OMIT__ idiom as
# runtime-consultation-cli.bats/-roots.bats's own _write_request (this
# section's own scope reuses their PROVEN field defaults verbatim, including
# the routing_policy_digest placeholder those suites already establish is
# not strictly cross-checked against the live runtime-routing.json for the
# operations this section exercises).
_req12_write_request() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  local created_at expiry
  created_at="$(node -e 'process.stdout.write(new Date().toISOString().replace(/\.\d{3}Z$/,"Z"))')"
  expiry="$(node -e 'process.stdout.write(new Date(Date.parse(process.argv[1])+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))' "$created_at")"
  REQ12_CREATED_AT="$created_at" REQ12_EXPIRY="$expiry" \
  R12_REPO_ID="$REQ12_REPO_ID" R12_WORKTREE_ID="$REQ12_WORKTREE_ID" R12_PLAN_DIGEST="$REQ12_PLAN_DIGEST" \
  R12_SUBJECT_HEAD="$REQ12_SUBJECT_HEAD" \
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
      requester_worktree_id: e.R12_WORKTREE_ID,
      requester_instance_id: "c".repeat(64),
      repo_id: e.R12_REPO_ID,
      wave_slug: "tg-wave",
      protocol_profile: "runtime-consultation/v1",
      // Empirically confirmed (2026-08-09): a REAL-but-differently-derived
      // coordination_root_id hash trips SECURITY_INVALID (a forgery/identity
      // check, not a shape check) BEFORE reaching the target business logic
      // in this section -- vacuously "discriminating" for the wrong reason.
      // The placeholder below matches the proven _write_request convention
      // already established in runtime-consultation-roots.bats (RCR-blob-1
      // etc. reach real business logic with this exact placeholder). NOTE:
      // no apostrophes anywhere in this comment block -- it lives inside a
      // bash single-quoted node -e block (no escape mechanism), and a bare
      // apostrophe here silently truncates the script and breaks every
      // caller (empirically confirmed 2026-08-09 after m7-toolkit-impl found
      // this exact defect; see git history for the isolated repro).
      coordination_root_id: "0".repeat(64),
      plan_digest: e.R12_PLAN_DIGEST,
      subject_repo_id: e.R12_REPO_ID,
      subject_worktree_id: e.R12_WORKTREE_ID,
      subject_head: e.R12_SUBJECT_HEAD,
      subject_scope_digest: "d".repeat(64),
      question: "req12 fixture question",
      expected_result_kind: "TEST_RESULT",
      expiry: e.REQ12_EXPIRY,
      recovery_budget: 1,
      routing_policy_version: "runtime-routing/v1",
      routing_policy_digest: "e".repeat(64),
      initial_attempt_id: "f".repeat(64),
      initial_lease_epoch: 0,
      created_at: e.REQ12_CREATED_AT
    };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$overrides" "$out"
}

_req12_write_subject_bundle() {
  local out="$1" overrides="$2"
  mkdir -p "$(dirname "$out")"
  node -e '
    const fs = require("fs");
    const overrides = JSON.parse(process.argv[1]);
    const outPath = process.argv[2];
    const defaults = { schema: "coordination/subject-bundle-manifest/v1", entries: [] };
    const merged = Object.assign({}, defaults, overrides);
    for (const k of Object.keys(merged)) { if (merged[k] === "__OMIT__") delete merged[k]; }
    fs.writeFileSync(outPath, JSON.stringify(merged), { mode: 0o600 });
    fs.chmodSync(outPath, 0o600);
  ' "$overrides" "$out"
}

_req12_base64url_encode() {
  node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0)).toString("base64url"))'
}

@test "RCG-REQ12-PUBLISHREQUEST-NOGRANT: 'publish-request' with well-formed argv (PLAN.md ~L781) and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix publish-request is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (materializes plan_ref/routing-policy/subject-bundle and publishes request.json), proving the grant check does not run at all" {
  _req12_setup
  local intent intent_b64
  intent="$(printf '{"target_role":"arch-testing","question":"req12 publish-request fixture","expected_result_kind":"TEST_RESULT","expiry":"%s"}' "$(node -e 'process.stdout.write(new Date(Date.now()+1800000).toISOString().replace(/\.\d{3}Z$/,"Z"))')")"
  intent_b64="$(printf '%s' "$intent" | _req12_base64url_encode)"
  local bundle_file="$PROJ/.planning/req12-subject-bundle.json"
  _req12_write_subject_bundle "$bundle_file" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" publish-request --coordination-root "$REQ12_COORD_ROOT" --plan "$PROJ/.planning/wave-tg-wave/PLAN.md" \
      --subject-bundle "$bundle_file" --intent "$intent_b64"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-DISPATCH-NOGRANT: 'dispatch' with a well-formed, business-logic-reachable request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation (PLAN.md §15b names dispatch as requester-authority) -- pre-fix dispatch is entirely ungated, so this same call reaches real business logic and fails for the UNRELATED reason UNAVAILABLE/DRIVER_UNAVAILABLE instead (no routing-policy driver registered for this fixture, mirroring runtime-consultation-cli.bats's own CLI-RESULT-04 precedent exactly) -- proof the grant check does not run at all, not merely that it runs after this file's own driver-selection logic" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" dispatch --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-AWAITRESULT-NOGRANT: 'await-result' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix await-result is entirely ungated, so this same call reaches its own bounded poll and fails for the UNRELATED reason TIMEOUT/DEADLINE_EXCEEDED instead (no candidate result ever published, mirroring CLI-RESULT-05's own precedent) -- proof the grant check does not run first" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" await-result --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --timeout 1
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ACCEPTRESULT-NOGRANT: 'accept-result' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix accept-result is entirely ungated, so this same call reaches its own real correlation/state logic and fails for the DIFFERENT, grant-unrelated reason INVALID/CORRELATION_INVALID (no candidate result exists to accept, empirically confirmed 2026-08-09) instead of AUTHORITY_INVALID -- proof the grant check does not run first" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" accept-result --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-TRANSACTIONACK-NOGRANT: 'transaction-ack' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix transaction-ack is entirely ungated, so this same call reaches its own real correlation/state logic and fails for the DIFFERENT, grant-unrelated reason INVALID/CORRELATION_INVALID (no accepted-result.json exists yet, empirically confirmed 2026-08-09) instead of AUTHORITY_INVALID -- proof the grant check does not run first" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" transaction-ack --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --disposition accepted
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-CANCEL-NOGRANT: 'cancel' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix cancel is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (publishes cancel.json, mirroring CLI-RESULT-07's own first-call precedent), proving the grant check does not run at all" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cancel --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --reason explicit
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-CLEANUP-NOGRANT: 'cleanup' with a well-formed request and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix cleanup is entirely ungated" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-TAKEOVER-NOGRANT: 'takeover' with a well-formed request PLUS a genuinely eligible takeover predicate (an existing claim + an ALREADY-EXPIRED active-lease for its own attempt/epoch) and NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix takeover is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (publishes a new activation + takeover.json), proving the grant check does not run at all. Empirically confirmed (2026-08-09): a request with NO claim/lease at all is NOT a safe vehicle here -- takeover's OWN domain logic already reports AUTHORITY_INVALID for 'no legal takeover eligibility exists', which would make a no-claim fixture vacuously pass this exact assertion for a reason having nothing to do with role-command-grant/v1 -- exactly the non-discriminating-test trap this file's own RCG-ATTACK section explicitly guards against." {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  local txn_dir; txn_dir="$(dirname "$req_f")"
  mkdir -p "$txn_dir/claims" "$txn_dir/active-leases"
  local attempt_id; attempt_id="$(printf 'f%.0s' {1..64})"
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const txnDir = process.argv[1];
    const worktreeId = process.argv[2];
    const attemptId = process.argv[3];
    const claim = { schema: "coordination/claim/v1", request_id: "a".repeat(64), attempt_id: attemptId, lease_epoch: 0, claimant_role: "arch-testing", claimant_worktree_id: worktreeId, claimant_instance_id: "1".repeat(64), worker_session_id: null, target_role_profile_digest: "b".repeat(64), driver: "noop", created_at: "2020-01-01T00:00:00Z" };
    const claimPath = txnDir + "/claims/" + attemptId + ".json";
    fs.writeFileSync(claimPath, JSON.stringify(claim), { mode: 0o600 });
    fs.chmodSync(claimPath, 0o600);
    const claimDigest = crypto.createHash("sha256").update(fs.readFileSync(claimPath)).digest("hex");
    const lease = { schema: "coordination/active-lease/v1", attempt_id: attemptId, lease_epoch: 0, holder_role: "arch-testing", claimant_instance_id: "1".repeat(64), worker_session_id: null, claim_digest: claimDigest, ttl_seconds: 300, heartbeat_interval_seconds: 60, last_heartbeat_at: "2020-01-01T00:00:00Z", lease_expiry: "2020-01-01T00:05:00Z", created_at: "2020-01-01T00:00:00Z" };
    const leasePath = txnDir + "/active-leases/" + attemptId + ".json";
    fs.writeFileSync(leasePath, JSON.stringify(lease), { mode: 0o600 });
    fs.chmodSync(leasePath, 0o600);
  ' "$txn_dir" "$REQ12_WORKTREE_ID" "$attempt_id"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" takeover --coordination-root "$REQ12_COORD_ROOT" --request "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-RECORDDELIVERY-NOGRANT: 'record-delivery' with a well-formed request and its own initial_attempt_id/epoch, and NO grant flag, must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix record-delivery is entirely ungated, so this same call fails for the DIFFERENT, grant-unrelated reason INVALID/INVALID_ARGUMENT (empirically confirmed 2026-08-09 -- reached before any grant concept) instead of AUTHORITY_INVALID" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" record-delivery --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" \
      --attempt "$(printf 'f%.0s' {1..64})" --epoch 0 --driver noop --outcome noop --commit-point none
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-WORKERSTOP-NOGRANT: 'worker-stop' (session-shutdown kind, no --request needed per the ABI table) with NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix worker-stop is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (mints a new stop ID + publishes stop correlation), proving the grant check does not run at all" {
  _req12_setup
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" worker-stop --coordination-root "$REQ12_COORD_ROOT" --role arch-testing \
      --worker-session req12-workerstop-session --kind session-shutdown
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-VALIDATE-NOGRANT: 'validate' against a well-formed request artifact with NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix validate is entirely ungated, so this same call reaches real business logic and genuinely SUCCEEDS (full schema/path/authority validation passes, mirroring runtime-consultation-roots.bats's own RCR-blob-1 precedent), proving the grant check does not run at all" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" validate --coordination-root "$REQ12_COORD_ROOT" --kind consult-v2 --artifact "$req_f"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-PUBLISHBLOB-NOGRANT: 'publish-blob' with NO grant flag must be rejected with AUTHORITY_INVALID before any read/mutation -- pre-fix publish-blob is entirely ungated, so this same call fails for the DIFFERENT, grant-unrelated reason INVALID/SCHEMA_INVALID (empirically confirmed 2026-08-09) instead of AUTHORITY_INVALID. KNOWN SCOPE LIMITATION: this fixture's manifest entry is not a full BLOB-AUTH-style validated staging entry (that fixture machinery is cli.bats/protocol.bats's own, out of this section's budget) -- the discriminating claim is only that today's failure is not AUTHORITY_INVALID, proving the grant check itself does not run" {
  _req12_setup
  local bundle_file="$PROJ/.planning/req12-blob-subject-bundle.json"
  _req12_write_subject_bundle "$bundle_file" '{"entries":[{"path":"req12-fixture-entry.txt","size":4,"digest":"'"$(printf 'a%.0s' {1..64})"'"}]}'

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" publish-blob --coordination-root "$REQ12_COORD_ROOT" --plan "$PROJ/.planning/wave-tg-wave/PLAN.md" \
      --subject-bundle "$bundle_file" --entry req12-fixture-entry.txt
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

# ══════════════════════════════════════════════════════════════════════════
# M7 completeness GREEN-phase carry-forward (2026-08-09, task #24): deeper
# adversarial matrix for the 12 commands newly gated in Part A -- replay,
# argv-tamper, expiry, field-tamper, authority-kind-swap. Now testable:
# COMMAND_FLAGS was extended alongside ROLE_COMMAND_GRANT_AUTHORITY_FOR_COMMAND
# (confirmed by direct read, runtime-consultation.cjs ~L5331-5334), so a
# --requester-binding flag is real, recognized argv for all 18 commands now.
#
# Vehicle choice: `cleanup` (--coordination-root --request only), matching
# root-init's own precedent above -- a legitimate call genuinely reaches
# SUCCESS today (empirically confirmed during the RED phase), so a
# subsequent attack's failure is unambiguously attributable to the grant
# layer, never an unrelated fixture gap.
#
# Scope (reported, matching this file's own established practice): this
# section does NOT repeat the full matrix for all 12 commands individually.
# the shared validation+consumption pipeline (the code under test here) is
# COMPLETELY GENERIC across subcommands -- confirmed by direct read
# (runtime-consultation.cjs ~L5480-5576): it takes `expectedSubcommand` as a
# bare comparison value with no per-command branching anywhere in its own
# body. There is no per-command logic left to exercise per-command -- the
# SAME code path this section proves correct for `cleanup` is, byte-for-byte,
# the code path every other one of the 18 commands also runs through
# validateAndConsumeRoleCommandGrantForCommand. This mirrors the file's own
# root-init-as-primary-vehicle precedent (see the RCG-ATTACK section header
# above) rather than mechanically duplicating 5 variants x 12 commands.
#
# No hook mints requester grants for these 12 commands yet (context-provider-gate.js's
# own REQUESTER_ADMIN_SUBCOMMANDS is still root-init/root-validate only,
# confirmed by direct read 2026-08-09) -- so, unlike the RCG-ATTACK section's
# own root-init tests (which mint via the REAL hook, _run_cp_hook), this
# section mints DIRECTLY via the same production primitives the wrapper/hooks
# use (rll.createRequesterBinding + rll.mintRoleCommandGrant), mirroring this
# file's own _mint_role_actor_binding/_mint_pending_role_spawn_full precedent
# for the target surface exactly.
# ══════════════════════════════════════════════════════════════════════════

# Mints a REAL requester grant for `cleanup` against a well-formed request
# fixture, prints "<grant_id> <request_path>" -- the caller builds the
# legitimate command by appending `--requester-binding <grant_id>`. Callers
# MUST call `_req12_setup` THEMSELVES, directly, BEFORE this -- never inside
# a `$(...)` command-substitution subshell together with this function (a
# subshell's own variable assignments -- PROJ/REQ12_COORD_ROOT/etc, all set
# by _req12_setup -- never propagate back to the calling @test's own shell;
# empirically confirmed 2026-08-09 as the exact cause of an earlier version
# of this helper silently invoking _req12_setup INSIDE the substitution,
# which left the caller's own $REQ12_COORD_ROOT permanently empty).
_req12_mint_cleanup_grant() {
  # M6+M7 requester-authority closure (Group G fix): the shared
  # _req12_request_path helper builds .../transactions/a/request.json (a
  # LITERAL one-char directory), but _req12_write_request default template
  # hardcodes request_id:"a".repeat(64) into the JSON -- assertExactCanonicalGeometry
  # derives requestId from the directory segment and readCanonicalRequestRecord
  # cross-checks it against the JSON field, so a bare "a" directory never
  # accredits. Every OTHER caller of _req12_request_path never reaches
  # accreditation (fails earlier on the missing-grant-flag pre-check), so this
  # was latent everywhere else -- only this helper genuinely needs the
  # directory segment to match the JSON request_id.
  local req_f; req_f="$(_req12_plan_root)/transactions/$(printf 'a%.0s' {1..64})/request.json"
  _req12_write_request "$req_f" '{}'
  local grant_id
  grant_id="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const fs = require("fs");
    const projectRoot = process.argv[3];
    const reqPath = process.argv[4];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    if (!planResult.ok) { process.stderr.write("no PLAN discovered"); process.exit(1); }
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor, mirroring
    // runtime-consultation-grant-wrapper.cjs own RCC_GRANT_PROVIDER default --
    // this helper own callers (ROUNDTRIP/REPLAY/EXPIRED/ALTERED/AUTHORITYSWAP)
// test the generic grant validation+consumption mechanics, never
    // CLAUDE-ID-01-adjacent identity. No apostrophes in this comment block --
    // bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "req12-adversarial-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "req12-cleanup-grant-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    if (!bindingResult.ok) { process.stderr.write("binding mint failed: " + JSON.stringify(bindingResult)); process.exit(1); }
    // M6+M7 requester-authority closure (Group G fix): the fixture request
    // default source_role/requester_instance_id placeholders never correlate
    // with any real binding -- rewrite both to this exact minted binding
    // before the grant is consumed, mirroring resolveRequesterGrantScope own
    // requesterInstanceId/sourceRole cross-check inside
    // validateAndConsumeRoleCommandGrantForCommand.
    const reqObjForRewrite = JSON.parse(fs.readFileSync(reqPath, "utf8"));
    reqObjForRewrite.source_role = "arch-testing";
    reqObjForRewrite.requester_instance_id = bindingResult.binding.actor_instance_id;
    fs.writeFileSync(reqPath, rc.canonicalJSONStringify(reqObjForRewrite), { mode: 0o600 });
    fs.chmodSync(reqPath, 0o600);
    const rest = ["--coordination-root", process.argv[5], "--request", reqPath];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    // M6+M7 requester-authority closure (Group B): bind the grant to the
    // REAL request_id/initial_attempt_id/initial_lease_epoch this exact
    // fixture request carries, never null -- "cleanup" is one of the
    // TRANSACTIONAL (non-administrative) commands PLAN.md ~L592 requires to
    // "bind the exact request and its authoritative current attempt/epoch";
    // null is only correct for root-init/root-validate/validate (pre-request/
    // read-only admin ops). A null-modeled transactional grant here would
    // silently mask the missing request/attempt/epoch cross-check inside
// the shared grant pipeline (see RCG-REQ12-ATTACK-WRONGSCOPE-CLEANUP
    // below), since a null field is trivially shape-valid regardless of
    // whether it was ever cross-checked against anything real.
    const reqObj = JSON.parse(fs.readFileSync(reqPath, "utf8"));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "cleanup", argvDigest, reqObj.request_id, reqObj.initial_attempt_id, reqObj.initial_lease_epoch);
    if (!mintResult.ok) { process.stderr.write("grant mint failed: " + JSON.stringify(mintResult)); process.exit(1); }
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$LIB_DIR/runtime-consultation.cjs" "$PROJ" "$req_f" "$REQ12_COORD_ROOT")"
  printf '%s %s' "$grant_id" "$req_f"
}

# M6+M7 requester-authority closure (Group B, 2026-08-10): a 'cleanup' grant
# minted with a FABRICATED request_id/attempt_id/lease_epoch that does NOT
# match the real transaction it is presented against (argv/--request path
# UNCHANGED, zero argv tampering -- isolates this from
# RCG-REQ12-ATTACK-ARGVTAMPER-CLEANUP's own different-path mechanism) must be
# rejected. The regression below proves the full pipeline independently
# re-derives request.json plus the current authoritative attempt/epoch before
# creating the one-shot consumption marker; a valid-shape fabricated triple
# neither authorizes the transaction nor burns the grant.
@test "RCG-REQ12-ATTACK-WRONGSCOPE-CLEANUP BLOCK: a 'cleanup' grant minted with a fabricated request_id/attempt_id/lease_epoch unrelated to the real transaction it is presented against must be rejected" {
  _req12_setup
  # M6+M7 requester-authority closure (Group G fix): a bare "a" directory
  # never accredits against the JSON request_id:"a".repeat(64) default (see
  # _req12_mint_cleanup_grant own comment) -- without this, the assertion
  # below passes VACUOUSLY (any accreditation failure also yields
  # AUTHORITY_INVALID), never actually proving wrong-scope detection.
  local req_f; req_f="$(_req12_plan_root)/transactions/$(printf 'a%.0s' {1..64})/request.json"
  _req12_write_request "$req_f" '{}'
  local grant_id
  grant_id="$(node -e '
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const reqPath = process.argv[4];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor -- this
    // test own subject (wrong request/attempt/epoch scope rejection) is
    // provider-agnostic, never CLAUDE-ID-01-adjacent. No apostrophes in this
    // comment block -- bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "req12-wrongscope-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "req12-wrongscope-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    const rest = ["--coordination-root", process.argv[5], "--request", reqPath];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "cleanup", argvDigest, "b".repeat(64), "c".repeat(64), 999);
    process.stdout.write(mintResult.ok ? mintResult.grantId : "");
  ' "$RLL_IMPL" "$LIB_DIR/runtime-consultation.cjs" "$PROJ" "$req_f" "$REQ12_COORD_ROOT")"
  [ -n "$grant_id" ]

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]

  # Scope accreditation precedes the one-shot write: a valid-shape but wrong
  # transaction triple must not burn the grant or leave any `.consumed`
  # marker behind.
  run node -e '
    const fs = require("fs");
    const rll = require(process.argv[1]);
    const marker = rll.roleCommandGrantConsumedMarkerPathFor(process.argv[2], process.argv[3]);
    process.exit(fs.existsSync(marker) ? 1 : 0);
  ' "$RLL_IMPL" "$PROJ" "$grant_id"
  [ "$status" -eq 0 ]
}

@test "RCG-REQ12-ATTACK-ROUNDTRIP-CLEANUP PASS: a genuinely-minted requester grant for 'cleanup', presented via --requester-binding, lets the real production CLI reach SUCCESS -- control case establishing every attack below is attributable to the tamper, not an unrelated fixture gap" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  [ -n "$grant_id" ]
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"status":"SUCCESS"'* ]]
}

@test "RCG-REQ12-ATTACK-REPLAY-CLEANUP BLOCK: a genuinely-consumed 'cleanup' grant cannot be reused a second time -- one-time consumption" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  local cmd; cmd="node \"$CONSULTATION_CLI\" cleanup --coordination-root \"$REQ12_COORD_ROOT\" --request \"$req_f\" --requester-binding \"$grant_id\""
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" bash -c "$cmd"
  [[ "$output" == *'"status":"SUCCESS"'* ]]
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" bash -c "$cmd"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-ARGVTAMPER-CLEANUP BLOCK: a genuinely-minted 'cleanup' grant, presented against a DIFFERENT --request path than the one it was minted for, is rejected -- the recomputed pre-injection argv digest no longer matches" {
  _req12_setup
  local req_a req_b; req_a="$(_req12_request_path a)"; req_b="$(_req12_request_path b)"
  _req12_write_request "$req_a" '{}'
  _req12_write_request "$req_b" "{\"request_id\":\"$(printf 'b%.0s' {1..64})\"}"
  local grant_id
  grant_id="$(node -e '
    const rll = require(process.argv[1]); const rc = require(process.argv[2]);
    const projectRoot = process.argv[3]; const reqPath = process.argv[4];
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const planResult = rll.discoverPlan(projectRoot);
    // M6+M7 FULL CLOSURE (2026-08-11): defaults to codex-supervisor -- this
    // test own subject (argv-tamper-across-request-paths rejection) is
    // provider-agnostic, never CLAUDE-ID-01-adjacent. No apostrophes in this
    // comment block -- bash single-quoted node -e block, no escape mechanism.
    const identity = { ok: true, provider: process.env.RCC_GRANT_PROVIDER || "codex-supervisor", runtime_session_key: "req12-argvtamper-session" };
    const bindingResult = rll.createRequesterBinding(projectRoot, identity, "req12-argvtamper-agent", "arch-testing", worktreeId, planResult.planDigest, 3600);
    const rest = ["--coordination-root", process.argv[5], "--request", reqPath];
    const argvDigest = rc.sha256String(rc.canonicalJSONStringify(rest));
    const mintResult = rll.mintRoleCommandGrant(projectRoot, bindingResult.binding, "requester", "cleanup", argvDigest, null, null, null);
    process.stdout.write(mintResult.grantId);
  ' "$RLL_IMPL" "$LIB_DIR/runtime-consultation.cjs" "$PROJ" "$req_a" "$REQ12_COORD_ROOT")"

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_b" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-EXPIRED-CLEANUP BLOCK: a 'cleanup' grant whose on-disk expiry has already passed is rejected, never treated as still-live" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  _set_grant_field "$grant_id" expiry '"2000-01-01T00:00:00Z"'
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-ALTERED-CLEANUP BLOCK: a 'cleanup' grant whose on-disk 'plan_digest' field is tampered post-mint (still well-formed hex, no longer what was actually minted) is rejected" {
  _req12_setup
  local out grant_id req_f; out="$(_req12_mint_cleanup_grant)"; read -r grant_id req_f <<< "$out"
  _set_grant_field "$grant_id" plan_digest "\"$(printf 'f%.0s' {1..64})\""
  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$grant_id"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

@test "RCG-REQ12-ATTACK-AUTHORITYSWAP-CLEANUP BLOCK: a genuinely-minted TARGET grant (claim) is presented as --requester-binding on a 'cleanup' command -- must reject on authority mismatch" {
  _req12_setup
  local req_f; req_f="$(_req12_request_path a)"
  _req12_write_request "$req_f" '{}'
  local worktree_id plan_digest gen_id
  worktree_id="$(_worktree_id)"; plan_digest="$(_plan_digest)"
  gen_id="$(_random_hex32)"
  _mint_role_actor_binding arch-testing "$worktree_id" "$plan_digest" "$gen_id" 60
  local txn_id; txn_id="$(_random_hex32)"
  local claim_request_path="$REQ12_COORD_ROOT/$txn_id/request.json"
  _tg_write_minimal_request "$claim_request_path" arch-testing
  # M7 GREEN correction round 2, R5: see TG-CLAIM-1's own identical comment.
  _tg_write_activation_for_request "$claim_request_path" noop
  local claim_cmd; claim_cmd="$(_render_posix_direct node "$CONSULTATION_CLI" claim --coordination-root "$REQ12_COORD_ROOT" --request "$claim_request_path" --role arch-testing --worker-session req12-authswap-worker-session)"
  _make_input "$claim_cmd" arch-testing req12-authswap-caller
  _run_hook
  [ "$status" -eq 0 ]
  local target_grant; target_grant="$(_extract_injected target-binding)"
  [ -n "$target_grant" ]

  run --separate-stderr env NODE_ENV=test RUNTIME_CONSULTATION_TEST_CAPABILITY="$TG_CAPABILITY" \
    node "$CONSULTATION_CLI" cleanup --coordination-root "$REQ12_COORD_ROOT" --request "$req_f" --requester-binding "$target_grant"
  [[ "$output" == *'"detail_code":"AUTHORITY_INVALID"'* ]]
}

# Sixteenth §16b/16d RED. Produces a root-source action via the real lifecycle
# CLI, reserves it through the real Agent PreToolUse hook, creates its binding
# through the real SubagentStart hook, and retires it through the real
# SubagentStop hook. No root-source authority factory or grant-wrapper occurs.
_s16_create_and_retire_real_root_source() {
  local session_id="$1" agent_id="$2"
  # S16-RSB fixture correction: setup()'s $PROJ never leaves the protected
  # default branch (main/master), so subagent-start-context-bundle.js's own
  # getWaveSlug({useBranch:true,useAlias:false}) call returns null and its
  # `if (!waveSlug) process.exit(0)` fires BEFORE the root-source reservation
  # is ever consumed -- silently skipping createRootSourceBinding and leaving
  # `root-source-bindings/` absent (ENOENT). Root-source correlation itself
  # is wave-independent (PLAN.md §16b never references a wave slug); the real
  # fix is giving this fixture the same resolvable non-protected branch the
  # already-GREEN S16-RSB-SUBAGENTSTART-BINDING-01 fixture uses
  # (subagent-start-context-bundle.bats' own `checkout -b feature/...`).
  git -C "$PROJ" checkout -b "feature/s16-rsb-retired-fixture" -q 2>/dev/null
  NODE_ENV=test RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY="$TG_CAPABILITY" \
    RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY="s16-role-gate-retained-plane" node -e '
    const fs = require("fs");
    const path = require("path");
    const { spawnSync } = require("child_process");
    const rll = require(process.argv[1]);
    const rc = require(process.argv[2]);
    const projectRoot = process.argv[3];
    const lifecycleCli = process.argv[1];
    const agentGate = process.argv[4];
    const subagentHook = process.argv[5];
    const sessionId = process.argv[6];
    const agentId = process.argv[7];
    const retainedFixture = require(process.argv[8]);
    const intent = {
      source_role: "toolkit-specialist",
      reporting_architect: "arch-platform",
      question: "Inspect the bounded Sixteenth retired-binding fixture and return the implementation review.",
      expected_result_kind: "IMPLEMENTATION_REVIEW",
    };
    const encoded = Buffer.from(rc.canonicalJSONStringify(intent), "utf8").toString("base64url");
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) { process.stderr.write("S16 PLAN missing"); process.exit(1); }
    const identity = { ok: true, provider: "claude-hook", runtime_session_key: sessionId };
    const generation = rll.resolveSessionGeneration(projectRoot, identity);
    const main = rll.createMainOrchestratorBinding(projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600);
    if (!generation.ok || !main.ok) { process.stderr.write("S16 main authority setup failed"); process.exit(1); }
    retainedFixture.establishRetainedCodexSupportPlane(projectRoot, main.binding);
    const lifecycleGrant = rll.mintLifecycleCommandGrant(
      projectRoot, main.binding, rc.sha256String("root-source:" + encoded),
      "toolkit-specialist", "root-source", "main-orchestrator", "orchestrator", "normal", null,
    );
    if (!lifecycleGrant.ok) {
      process.stderr.write("S16 missing root-source lifecycle admission: " + JSON.stringify(lifecycleGrant));
      process.exit(1);
    }
    const cli = spawnSync(process.execPath, [
      lifecycleCli, "root-source", "--project-root", projectRoot, "--intent", encoded,
      "--lifecycle-binding", lifecycleGrant.grantId,
    ], { encoding: "utf8", env: process.env });
    let envelope;
    try { envelope = JSON.parse(cli.stdout); } catch { envelope = null; }
    if (cli.status !== 0 || !envelope || envelope.status !== "ACTION_REQUIRED"
      || !envelope.operation || envelope.operation.kind !== "root-source"
      || !Array.isArray(envelope.actions) || envelope.actions.length !== 1) {
      process.stderr.write("S16 real root-source CLI failed: " + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }));
      process.exit(1);
    }
    const action = envelope.actions[0];
    const p = action.payload;
    const commonEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projectRoot, CLAUDE_WAVE_SLUG: "" });
    const gate = spawnSync(process.execPath, [agentGate], {
      input: JSON.stringify({
        tool_name: "Agent",
        tool_input: { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message },
        tool_use_id: "s16-retired-tool-use-01", session_id: sessionId, agent_type: "", agent_id: "",
      }), encoding: "utf8", env: commonEnv,
    });
    let gateBody;
    try { gateBody = JSON.parse(gate.stdout); } catch { gateBody = null; }
    if (gate.status !== 0 || !gateBody || !gateBody.hookSpecificOutput || gateBody.hookSpecificOutput.permissionDecision !== "allow") {
      process.stderr.write("S16 Agent gate reservation failed: " + JSON.stringify({ status: gate.status, stdout: gate.stdout, stderr: gate.stderr }));
      process.exit(1);
    }
    const start = spawnSync(process.execPath, [subagentHook], {
      input: JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "toolkit-specialist", session_id: sessionId, agent_id: agentId }),
      encoding: "utf8", env: commonEnv,
    });
    if (start.status !== 0) { process.stderr.write("S16 SubagentStart failed: " + JSON.stringify(start)); process.exit(1); }
    const bindingsDir = path.join(rll.registryRepoDir(projectRoot), "root-source-bindings");
    let entries = [];
    try { entries = fs.readdirSync(bindingsDir, { withFileTypes: true }); } catch (err) {
      process.stderr.write("S16 genuine binding directory absent: " + err.code + "; SubagentStart=" + JSON.stringify({ status: start.status, stdout: start.stdout, stderr: start.stderr })); process.exit(1);
    }
    const bindings = entries.filter((e) => e.isFile() && /^[a-f0-9]{32}\.json$/.test(e.name))
      .map((e) => JSON.parse(fs.readFileSync(path.join(bindingsDir, e.name), "utf8")))
      .filter((b) => b.action_id === action.action_id && b.runtime_session_key === sessionId && b.agent_id === agentId);
    if (bindings.length !== 1) { process.stderr.write("S16 expected one genuine binding, got " + bindings.length); process.exit(1); }
    const binding = bindings[0];
    const stop = spawnSync(process.execPath, [subagentHook], {
      input: JSON.stringify({ hook_event_name: "SubagentStop", agent_type: "toolkit-specialist", session_id: sessionId, agent_id: agentId }),
      encoding: "utf8", env: commonEnv,
    });
    if (stop.status !== 0) { process.stderr.write("S16 SubagentStop failed: " + JSON.stringify(stop)); process.exit(1); }
    // Post-GREEN fixture update: the rewritten SubagentStop hook now
    // publishes an identity FENCE (M7 section 8.5: "no new retirement
    // artifact is written"), never the old per-binding <id>.retired.json --
    // that writer (retireRootSourceBinding) is already removed. Exact
    // authority_identity_id derivation (schema/provider/repo_id/
    // runtime_session_key/agent_id, hashed via canonicalJSONStringify) and
    // fence record shape (schema/authority_identity_id/reason/fenced_at,
    // reason CLOSED to exactly "agent-return") confirmed by direct read of
    // runtime-role-lifecycle.cjs own CLAUDE_AUTHORITY_IDENTITY_SCHEMA/
    // computeClaudeAuthorityIdentityId/CLAUDE_AUTHORITY_FENCE_SCHEMA/
    // CLAUDE_AUTHORITY_FENCE_KEYS/CLAUDE_AUTHORITY_FENCE_REASON_ENUM
    // constants (~1545-1571) before relying on any of it here.
    const authorityIdentity = {
      schema: "runtime/claude-authority-identity/v1",
      provider: "claude-hook",
      repo_id: rll.computeRepoId(projectRoot),
      runtime_session_key: sessionId,
      agent_id: agentId,
    };
    const authorityIdentityId = rc.sha256String(rc.canonicalJSONStringify(authorityIdentity));
    const fencePath = path.join(rll.registryRepoDir(projectRoot), "authority-identity-fences", authorityIdentityId + ".json");
    if (!fs.existsSync(fencePath)) { process.stderr.write("S16 fence record absent: " + fencePath); process.exit(1); }
    const fence = JSON.parse(fs.readFileSync(fencePath, "utf8"));
    if (fence.schema !== "runtime/claude-authority-fence/v1" || fence.authority_identity_id !== authorityIdentityId
      || fence.reason !== "agent-return") {
      process.stderr.write("S16 fence correlation invalid: " + JSON.stringify(fence)); process.exit(1);
    }
    process.stdout.write(binding.binding_id);
  ' "$RLL_IMPL" "$CONSULTATION_CLI" "$PROJ" "$AGENT_SPAWN_GATE_HOOK" "$SUBAGENT_START_HOOK" "$session_id" "$agent_id" "$S16_RETAINED_FIXTURE"
}

_s16_grant_tree_digest() {
  local dir; dir="$(_role_command_grants_dir)"
  node -e '
    const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
    const root = process.argv[1]; const rows = [];
    function walk(dir, prefix) {
      let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (e.code === "ENOENT") return; throw e; }
      for (const ent of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
        const abs = path.join(dir, ent.name); const rel = prefix ? prefix + "/" + ent.name : ent.name;
        if (ent.isDirectory() && !ent.isSymbolicLink()) walk(abs, rel);
        else rows.push(rel + "\t" + crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"));
      }
    }
    walk(root, ""); process.stdout.write(crypto.createHash("sha256").update(rows.join("\n")).digest("hex") + ":" + rows.length);
  ' "$dir"
}

@test "S16-RSB-RETIRED-NO-LATER-GRANT-01: a genuine root-source binding retired by real SubagentStop is denied across the real requester command table with no grants, used markers, or project edits" {
  local session_id="s16-retired-session" agent_id="s16-retired-agent"
  run _s16_create_and_retire_real_root_source "$session_id" "$agent_id"
  [ "$status" -eq 0 ]
  local binding_id="$output"
  [ -n "$binding_id" ]

  local coord="$PROJ/.planning/coordination"
  local request="$coord/transactions/$(printf 'a%.0s' {1..64})/request.json"
  local plan="$PROJ/.planning/wave-tg-wave/PLAN.md"
  local subject="$coord/subject-placeholder.json"
  local artifact="$request"
  local before_grants before_status
  before_grants="$(_s16_grant_tree_digest)"
  before_status="$(git -C "$PROJ" status --porcelain=v1 -uall)"

  local -a commands=(
    "$(_render_posix_direct node "$CONSULTATION_CLI" root-init --coordination-root "$coord")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" root-validate --coordination-root "$coord")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" validate --coordination-root "$coord" --kind consult-v2 --artifact "$artifact")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" publish-blob --coordination-root "$coord" --plan "$plan" --subject-bundle "$subject" --entry fixture.txt)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" publish-request --coordination-root "$coord" --plan "$plan" --subject-bundle "$subject" --intent e30)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" dispatch --coordination-root "$coord" --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" record-delivery --coordination-root "$coord" --request "$request" --attempt "$(printf 'b%.0s' {1..64})" --epoch 0 --driver noop --outcome delivered --commit-point accepted)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" takeover --coordination-root "$coord" --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" await-result --coordination-root "$coord" --request "$request" --timeout 1)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" accept-result --coordination-root "$coord" --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" transaction-ack --coordination-root "$coord" --request "$request" --disposition accepted)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" cancel --coordination-root "$coord" --request "$request" --reason operator)"
    "$(_render_posix_direct node "$CONSULTATION_CLI" worker-stop --coordination-root "$coord" --role toolkit-specialist --worker-session s16-retired-worker --kind session-shutdown --request "$request")"
    "$(_render_posix_direct node "$CONSULTATION_CLI" cleanup --coordination-root "$coord" --request "$request")"
  )
  [ "${#commands[@]}" -eq 14 ]

  local command hook_body
  for command in "${commands[@]}"; do
    _make_input "$command" "toolkit-specialist" "$session_id" "$agent_id"
    _run_cp_hook
    [ "$status" -eq 0 ]
    hook_body="$output"
    node -e '
      const body = JSON.parse(process.argv[1]);
      const h = body && body.hookSpecificOutput;
      if (!h || h.permissionDecision !== "deny" || typeof h.permissionDecisionReason !== "string"
        || !/root-source/i.test(h.permissionDecisionReason) || !/authority-fenced/.test(h.permissionDecisionReason)) process.exit(1);
    ' "$hook_body"
    [ "$(_s16_grant_tree_digest)" = "$before_grants" ]
    [ "$(git -C "$PROJ" status --porcelain=v1 -uall)" = "$before_status" ]
  done
}
