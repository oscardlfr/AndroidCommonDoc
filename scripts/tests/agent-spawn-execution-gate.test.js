#!/usr/bin/env node
'use strict';

// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A: must be the FIRST require in this file, before any require of
// runtime-role-lifecycle.cjs/runtime-bridge-codex.cjs -- see that file's own
// doc comment for why (registryBaseDir() is os.tmpdir()-rooted and shared
// with real production registry data on this machine without this).
require('./lib/private-registry-tmpdir-preload.cjs');

// Third HOLD (dispatch: team-lead direct, authorized via task #7 "Third
// HOLD: fix grant-injection defects + build two-phase reserve/commit
// protocol"; design validated by arch-testing-m7dispatch 2026-08-08; file
// write authorized via specialist-dispatches/test-specialist/
// arch-testing-20260808T202642Z.json) Part B, B1: PreToolUse hook for the
// Agent tool, main-orchestrator context only.
//
// Placement (arch-testing-endorsed): a NEW dedicated hook file on the SAME
// Task|Agent PreToolUse matcher agent-spawn-validator.js already uses --
// never mixed into that file. agent-spawn-validator.js has ZERO registry
// dependency today (only reads a static YAML manifest + template files for
// drift-checking); this hook needs deep registry access (binding/PLAN/
// session/role/expiry/team-ensure revalidation, atomic claim mint),
// comparable in weight to context-provider-gate.js's own M7/WP4 section.
// Multiple hooks sharing one PreToolUse matcher is already precedented in
// .claude/settings.json (agent-spawn-validator.js + wave-phase-gate.js both
// fire on the Agent matcher).
//
// This hook (.claude/hooks/agent-spawn-execution-gate.js) does not exist
// yet -- this file establishes RED for its existence and contract,
// mirroring this codebase's own established "propose the minimal interface,
// today it does not exist" precedent (runtime-role-lifecycle-statemachine.
// test.js's interpretRoleLifecycleAction/resolveCanonicalRoleProfile;
// context-provider-gate.test.js's own coordination/consult-result/v1 in its
// PP1-16 section; the M7/WP4 lifecycle-grant-injection LG1-4 section).
//
// EXECUTING representation (arch-testing-endorsed, mirrors the REAL,
// already-shipped SupervisorExecutionClaim/v1 idiom -- runtime-role-
// lifecycle.cjs:1695-1954 -- almost exactly, generalized only where that
// mechanism structurally cannot be reused: it hard-rejects any action whose
// kind !== 'supervisor-start' or role !== null, and it keys purely on
// action_id with no per-attempt sub-identity):
//   - NOT a mutable field on the immutable action record.
//   - NOT a new ROLE_BINDING_STATE_ENUM member (an action-execution-attempt
//     is not the role's own overall lifecycle state).
//   - A THIRD, separate no-clobber claim record, PATH-keyed by action_id
//     alone (so a second/concurrent/replayed attempt collides EEXIST --
//     this is what makes "only one invocation may win" atomic), carrying a
//     freshly CSPRNG-minted `reservation_id` FIELD (never caller-supplied,
//     never part of the path) as the per-attempt "receipt" identity B2 can
//     later correlate against. Exactly one `execution_state` value is ever
//     written, mirroring SupervisorExecutionClaim's own single-value
//     'ISSUED' (arch-testing Q2 guidance: "don't build a literal
//     PENDING->EXECUTING string state machine... match what's actually
//     shipped and working today").
//
// CRITICAL CORRECTION (arch-testing, 2026-08-08, after independently
// re-reading runtime-role-lifecycle.cjs:1690-1976 and runtime-bridge-
// codex.cjs:1370-1429): SupervisorExecutionClaim's mint half
// (mintSupervisorExecutionClaim) is hard-gated behind
// isFakeExecutorCapability() and so is NEVER actually called in real
// production -- only its validate/consume half has a real, unconditional
// production caller (runtime-bridge-codex.cjs:1399), meaning the sibling
// mechanism is "half-wired, awaiting the other half", not a live precedent
// to reconcile against. B1 is genuinely the first real wiring of this
// pattern -- and, precisely because of that, mintRoleSpawnExecutionClaim
// below must NEVER mirror the mint-side isFakeExecutorCapability() gate:
// the entire point of this HOLD is making Agent-tool spawning genuinely,
// unconditionally reserve/commit-gated in real production, not a second
// dormant scaffold. Mirror the VALIDATION rigor and shape (hasExactKeys,
// triple-bound expiry re-validation, atomic no-clobber consumption) --
// those are proven and worth copying exactly -- but the mint call itself
// must fire for real on every genuine PreToolUse(Agent) call. RB8 below
// proves this explicitly (reservation succeeds with
// RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY entirely absent from the
// hook's own environment).
//
// Proposed NEW runtime-role-lifecycle.cjs exports this file assumes (none
// exist yet -- toolkit-specialist's job; calling them today throws "is not
// a function", which IS this file's RED for the library half of the
// contract, exactly as the hook's own non-existence is the RED for the
// hook half):
//   ROLE_SPAWN_EXECUTION_CLAIM_SCHEMA = 'runtime/role-spawn-execution-claim/v1'
//   ROLE_SPAWN_EXECUTION_CLAIM_KEYS (sorted, exact-10+2 mirroring
//     EXECUTION_CLAIM_KEYS plus `reservation_id` and `role`):
//     [action_id, created_at, execution_state, expiry, main_binding_id,
//      plan_digest, reservation_id, role, schema, session_generation_id,
//      tool_input_digest, worktree_id]
//   roleSpawnExecutionClaimPathFor(repoDescriptor, actionId)
//   mintRoleSpawnExecutionClaim(repoDescriptor, action, mainBindingId, toolInputDigest, readyTimeoutSeconds)
//     -- mirrors mintSupervisorExecutionClaim's signature exactly, minus the
//     bridge_argv-specific digest source AND minus the mint-side
//     isFakeExecutorCapability() gate (see the CRITICAL CORRECTION above);
//     hard-rejects action.kind !== 'role-spawn' || action.runtime !==
//     'claude-native' || typeof action.role !== 'string' (the
//     role-spawn-specific mirror of mintSupervisorExecutionClaim's own
//     kind/role guard).
//   validateAndConsumeRoleSpawnExecutionClaim(repoDescriptor, action, expectedToolInputDigest, projectRoot)
//     -- mirrors validateAndConsumeExecutionClaim exactly: exact key-set
//     closure, schema literal, execution_state==='ISSUED', full action/
//     session/plan/worktree/digest correlation, triple-bound expiry
//     re-validation (action.expires_at, policy, binding.expiry -- never
//     merely the claim's own cached values), full independent
//     re-resolution of the referenced MainOrchestratorBinding, then atomic
//     one-use consumption via a SEPARATE no-clobber `.consumed` marker.
//
// LOW CONFIDENCE, flagged explicitly (mirrors this session's own LG2/LG4
// precedent for stating uncertainty rather than silently guessing): the
// exact `tool_input_digest` formula. This file proposes
// sha256(canonicalJSONStringify({subagent_type, name})) -- scoped to just
// the two fields agent-spawn-validator.js itself already reads
// (data.tool_input?.subagent_type, data.tool_input?.name) and the two the
// dispatch names ("tool_input... to exactly match the action's own
// payload... subagent_type etc.") -- deliberately excluding a possibly-long
// free-form `prompt`/`description` field from the digest, since those are
// not part of the action's own closed payload shape
// (buildRoleSpawnPayload's {team_name,teammate_name,agent_type,
// bootstrap_artifact_ref,bootstrap_message}) and matching on them would be
// matching against caller-authored prose the action never committed to.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const HOOK = path.resolve(__dirname, '../../.claude/hooks/agent-spawn-execution-gate.js');
const IMPL_RLL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL_RLL);
const rc = require(path.resolve(__dirname, '../lib/runtime-consultation.cjs'));
const rbc = require(path.resolve(__dirname, '../lib/runtime-bridge-codex.cjs'));
const S16_SUPPORT_ROLES = Object.freeze([
  'arch-platform', 'arch-testing', 'arch-integration', 'context-provider', 'doc-updater',
]);

const RB_ROLE = 'arch-testing';

// M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
// arch-testing-20260811T162225Z), Section A / item 5: hook paths for driving
// the REAL CLAUDE-ID-01 observation recorders (SubagentStart via
// subagent-start-context-bundle.js, PreToolUse via context-provider-gate.js)
// -- this file only imports agent-spawn-execution-gate.js (the B1 reservation
// hook) by default; these two are additive, needed only by the item-5 section
// far below, mirroring context-provider-gate.test.js's own
// SUBAGENT_START_HOOK_FOR_CLAUDEID01 constant and drive*/primeClaudeId01Trace
// helper conventions exactly (never a second, independent reimplementation).
const SUBAGENT_START_HOOK_FOR_CLAUDEID01 = path.resolve(__dirname, '../../.claude/hooks/subagent-start-context-bundle.js');
const CONTEXT_PROVIDER_GATE_HOOK_FOR_CLAUDEID01 = path.resolve(__dirname, '../../.claude/hooks/context-provider-gate.js');

function driveClaudeId01SubagentStartForItem5(projDir, agentType, sessionId, agentId) {
  return spawnSync('node', [SUBAGENT_START_HOOK_FOR_CLAUDEID01], {
    input: JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: agentType, session_id: sessionId, agent_id: agentId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projDir }),
    encoding: 'utf8',
  });
}

function driveClaudeId01PreToolUseForItem5(projDir, agentType, sessionId, agentId, toolUseId) {
  return spawnSync('node', [CONTEXT_PROVIDER_GATE_HOOK_FOR_CLAUDEID01], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'true' }, session_id: sessionId, agent_type: agentType, agent_id: agentId, tool_use_id: toolUseId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '' }),
    encoding: 'utf8',
  });
}

function mintClaudeId01ProbeActionForItem5(projDir, agentType, sessionId, suffix) {
  const generation = rll.resolveSessionGeneration(projDir, {
    ok: true,
    provider: 'claude-hook',
    runtime_session_key: sessionId,
  });
  assert.strictEqual(generation.ok, true);
  const plan = rll.discoverPlan(projDir);
  assert.strictEqual(plan.ok, true);
  const actionId = rll.generateActionId();
  const minted = rll.mintRoleLifecycleAction(
    projDir,
    actionId,
    'role-spawn',
    'claude-native',
    rll.computeRepoId(projDir),
    rll.computeWorktreeId(projDir),
    plan.planDigest,
    crypto.createHash('sha256').update('agent-spawn-claude-id01:' + suffix).digest('hex'),
    generation.generationId,
    agentType,
    rll.buildRoleSpawnPayload('claude-id01-probe', agentType, agentType, 'fixture', 'fixture'),
    new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  assert.strictEqual(minted.ok, true, 'CLAUDE-ID-01 probe action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function recordClaudeId01PrimarySequence(projDir, agentType, sessionId, agentId, actionId, prefix) {
  rll.recordClaudeId01SubagentStartObservation(projDir, { sessionId, agentId, agentType, actionId });
  rll.recordClaudeId01PreToolUseObservation(projDir, { sessionId, agentId, agentType, toolUseId: prefix + '-tu-1' });
  rll.recordClaudeId01PreToolUseObservation(projDir, { sessionId, agentId, agentType, toolUseId: prefix + '-tu-2' });
  rll.recordClaudeId01SubagentStartObservation(projDir, { sessionId, agentId, agentType, actionId });
  rll.recordClaudeId01PreToolUseObservation(projDir, { sessionId, agentId, agentType, toolUseId: prefix + '-tu-3' });
}

// Complete generation capability: peer A supplies the full sequence and a
// distinct peer B is observed on a distinct spawn action of the same role.
function primeClaudeId01TraceForItem5(projDir, agentType, sessionId, agentId) {
  const actionA = mintClaudeId01ProbeActionForItem5(projDir, agentType, sessionId, 'a-' + agentId);
  const actionB = mintClaudeId01ProbeActionForItem5(projDir, agentType, sessionId, 'b-' + agentId);
  recordClaudeId01PrimarySequence(projDir, agentType, sessionId, agentId, actionA, 'item5-prime-' + sessionId + '-' + agentId);
  rll.recordClaudeId01SubagentStartObservation(projDir, {
    sessionId,
    agentId: agentId + '-distinct-peer-b',
    agentType,
    actionId: actionB,
  });
  return { actionA, actionB };
}

// Test-only capability seam (mirrors runtime-role-lifecycle-statemachine.
// test.js and subagent-start-context-bundle.bats's own
// _mint_pending_role_spawn convention): needed to call
// registerTeamEnsureSuccess directly -- gated behind
// isFakeExecutorCapability(), "the capability gate lives HERE (mirrors
// mintSupervisorExecutionClaim)" per that function's own doc comment --
// when building fixtures below. NEVER needed for the reservation call
// itself (RB8 proves this explicitly).
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'agent-spawn-exec-gate-fixture-capability';
process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY = 'agent-spawn-exec-gate-fixture-executor';
process.env.RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES = '["claude-sendmessage"]';

function runHook(payload, env = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], {
    input,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Unlike runHook, builds the child's environment from scratch (never
// implicitly spreads THIS process's own env on top) -- needed for RB8,
// where the whole point is proving the hook's own environment genuinely
// lacks RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY, not merely that a
// caller-supplied override string happens not to mention it.
function runHookWithExplicitEnv(payload, explicitEnv) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [HOOK], { input, env: explicitEnv, encoding: 'utf8' });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-spawn-exec-'));
  const opts = { cwd: dir, encoding: 'utf8' };
  spawnSync('git', ['init', '-q'], opts);
  spawnSync('git', ['config', 'user.email', 'agent-spawn-exec-gate-test@test.local'], opts);
  spawnSync('git', ['config', 'user.name', 'Agent Spawn Exec Gate Test'], opts);
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], opts);
  spawnSync('git', ['branch', '-m', 'main'], opts);
  return dir;
}

function writePlanFixture(projectRoot, waveSlug) {
  const waveDir = path.join(projectRoot, '.planning', 'wave-' + waveSlug);
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# fixture plan for agent-spawn-execution-gate.test.js (' + waveSlug + ')\n');
}

function cleanup(dir) {
  try { fs.rmSync(rll.registryRepoDir(dir), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(dir, { recursive: true, force: true });
}

// Mints a REAL, fully-eligible pending role-spawn action for `role`: a
// genuinely SUCCEEDED team-ensure AND a genuinely PENDING role-spawn action
// (STARTING role-binding with pending_action_id), via the real production
// binding+grant+ensure machinery -- never a hand-fabricated action/marker.
// Mirrors context-provider-gate.test.js's own mintPendingRoleSpawnAction,
// extended to also settle team-ensure to SUCCEEDED (B1 must revalidate
// team-ensure-succeeded, so a fixture that never reaches SUCCEEDED cannot
// exercise the positive path at all).
function mintFullyEligibleRoleSpawnAction(proj, role, sessionKey) {
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionKey };
  const worktreeId = rll.computeWorktreeId(proj);
  const planResult = rll.discoverPlan(proj);
  if (!planResult.ok) throw new Error('mintFullyEligibleRoleSpawnAction: no PLAN discovered: ' + JSON.stringify(planResult));
  // Prove the generation capability on a disjoint canonical role so the two
  // probe actions cannot be mistaken for the role-spawn action this fixture
  // is about.
  primeClaudeId01TraceForItem5(proj, 'context-provider', sessionKey, 'context-provider-fixture-primary');
  const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planResult.planDigest, 120);
  if (!bindingResult.ok) throw new Error('mintFullyEligibleRoleSpawnAction: binding mint failed: ' + JSON.stringify(bindingResult));
  const argvDigest = crypto.createHash('sha256').update('ensure:' + role).digest('hex');
  const grantResult = rll.mintLifecycleCommandGrant(proj, bindingResult.binding, argvDigest, role, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
  if (!grantResult.ok) throw new Error('mintFullyEligibleRoleSpawnAction: grant mint failed: ' + JSON.stringify(grantResult));

  const ensureResult = spawnSync('node', [IMPL_RLL, 'ensure', '--project-root', proj, '--role', role, '--lifecycle-binding', grantResult.grantId], { env: process.env, encoding: 'utf8' });
  if (ensureResult.status !== 0) throw new Error('mintFullyEligibleRoleSpawnAction: ensure CLI failed (status=' + ensureResult.status + '): stdout=' + ensureResult.stdout + ' stderr=' + ensureResult.stderr);

  const genResult = rll.resolveSessionGeneration(proj, identity);
  if (!genResult.ok) throw new Error('mintFullyEligibleRoleSpawnAction: session generation lookup failed: ' + JSON.stringify(genResult));

  const repoDescriptor = { repoId: rll.computeRepoId(proj) };
  const teamEnsureState = rll.readTeamEnsureState(repoDescriptor, genResult.generationId, worktreeId, planResult.planDigest);
  if (!teamEnsureState.ok || teamEnsureState.state !== 'PENDING') {
    throw new Error('mintFullyEligibleRoleSpawnAction: expected a PENDING team-ensure marker after ensure: ' + JSON.stringify(teamEnsureState));
  }
  const registerResult = rll.registerTeamEnsureSuccess(repoDescriptor, genResult.generationId, worktreeId, planResult.planDigest, teamEnsureState.record.pending_action_id);
  if (!registerResult.ok) throw new Error('mintFullyEligibleRoleSpawnAction: registerTeamEnsureSuccess failed: ' + JSON.stringify(registerResult));

  const profileDigest = rll.roleProfileDigestFor(role);
  const stateResult = rll.readRoleBindingState(proj, worktreeId, planResult.planDigest, profileDigest, genResult.generationId, role);
  if (!stateResult.ok || !stateResult.record || !stateResult.record.pending_action_id) {
    throw new Error('mintFullyEligibleRoleSpawnAction: no pending_action_id found after ensure: ' + JSON.stringify(stateResult));
  }
  // M7 Correction (Fix 1): the action's own accredited bootstrap_message,
  // read back from the just-minted action record itself -- never guessed or
  // reconstructed independently -- so callers can build a tool_input.prompt
  // that genuinely matches (or, for a negative fixture, deliberately does
  // NOT match) the action's own closed payload.
  const actionRead = rll.findActionAcrossRepos(stateResult.record.pending_action_id);
  if (!actionRead.ok || actionRead.absent) {
    throw new Error('mintFullyEligibleRoleSpawnAction: could not read back the just-minted action: ' + JSON.stringify(actionRead));
  }
  return {
    roleSpawnActionId: stateResult.record.pending_action_id,
    teamEnsureActionId: teamEnsureState.record.pending_action_id,
    worktreeId, planDigest: planResult.planDigest, generationId: genResult.generationId,
    mainBindingId: bindingResult.binding.binding_id,
    repoDescriptor,
    bootstrapMessage: actionRead.action.payload.bootstrap_message,
  };
}

function runMainOrchestratorAgentCall(toolInput, projDir, sessionId) {
  return runHook(
    {
      tool_name: 'Agent',
      tool_input: toolInput,
      session_id: sessionId || ('rb-' + Math.random().toString(36).slice(2)),
      agent_type: '',
      agent_id: '',
    },
    { CLAUDE_PROJECT_DIR: projDir, CLAUDE_WAVE_SLUG: '' }
  );
}

function proposedToolInputDigest(toolInput) {
  return rc.sha256String(rc.canonicalJSONStringify({ subagent_type: toolInput.subagent_type, name: toolInput.name }));
}

function parseHookJSON(stdout, label) {
  if (!stdout || stdout.trim().length === 0) {
    assert.fail(label + ': hook produced no stdout -- expected a JSON hookSpecificOutput payload');
  }
  try {
    return JSON.parse(stdout);
  } catch (e) {
    assert.fail(label + ': hook stdout was not valid JSON: ' + JSON.stringify(stdout));
  }
}

// M7/WP4 hook-protocol cleanup: the official PreToolUse deny contract
// (code.claude.com/docs/en/hooks) is exit 0 + hookSpecificOutput{hookEventName:
// 'PreToolUse', permissionDecision:'deny', permissionDecisionReason}, never the
// deprecated top-level decision:'block' + exit 2 shape. Every RB* denial
// assertion in this file goes through this one helper so the full contract
// (exit code, JSON-parseability, exact schema, non-empty reason, absence of
// the deprecated top-level field) is checked identically everywhere, per-field,
// never merely "exit !== 0".
function assertPreToolUseDeny(r, label) {
  assert.strictEqual(r.exit, 0, label + ': a PreToolUse deny must exit 0 per the official hookSpecificOutput protocol: ' + JSON.stringify(r));
  const body = parseHookJSON(r.stdout, label);
  assert.strictEqual(typeof body, 'object', label + ': deny body must be a JSON object: ' + JSON.stringify(body));
  assert.ok(!Object.prototype.hasOwnProperty.call(body, 'decision'), label + ': deny body must NOT carry the deprecated top-level "decision" field: ' + JSON.stringify(body));
  assert.ok(body.hookSpecificOutput, label + ': deny body must carry hookSpecificOutput: ' + JSON.stringify(body));
  assert.strictEqual(body.hookSpecificOutput.hookEventName, 'PreToolUse', label + ': hookEventName must be PreToolUse: ' + JSON.stringify(body));
  assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'deny', label + ': permissionDecision must be "deny": ' + JSON.stringify(body));
  assert.ok(typeof body.hookSpecificOutput.permissionDecisionReason === 'string' && body.hookSpecificOutput.permissionDecisionReason.length > 0, label + ': permissionDecisionReason must be a non-empty string: ' + JSON.stringify(body));
  return body;
}

// Sixteenth §16b/16d RED. These two cases deliberately start at the real
// lifecycle CLI / real PreToolUse hook boundary. They do not mint a
// root-source action, reservation, or requester binding through a fixture
// constructor. S16_FOCAL lets the RED cases be executed one at a time before
// this file's historical script-style suite.
function base64urlJson(value) {
  return Buffer.from(rc.canonicalJSONStringify(value), 'utf8').toString('base64url');
}

function listRegistryFiles(projectRoot) {
  const root = rll.registryRepoDir(projectRoot);
  const out = [];
  function walk(dir, prefix) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) walk(abs, rel);
      else out.push(rel);
    }
  }
  walk(root, '');
  return out;
}

function invokeRealRootSourceCli(projectRoot, sessionId) {
  const intent = {
    source_role: 'toolkit-specialist',
    reporting_architect: 'arch-platform',
    question: 'Inspect the bounded Sixteenth root-source fixture and report the requested implementation result.',
    expected_result_kind: 'IMPLEMENTATION_REVIEW',
  };
  const encodedIntent = base64urlJson(intent);
  const plan = rll.discoverPlan(projectRoot);
  assert.strictEqual(plan.ok, true, 'S16 root-source setup: PLAN must resolve');
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(projectRoot, identity);
  assert.strictEqual(generation.ok, true, 'S16 root-source setup: session generation must resolve');
  const main = rll.createMainOrchestratorBinding(
    projectRoot, identity, rll.computeWorktreeId(projectRoot), plan.planDigest, 3600,
  );
  assert.strictEqual(main.ok, true, 'S16 root-source setup: real main binding must mint: ' + JSON.stringify(main));
  const sortedRoles = S16_SUPPORT_ROLES.slice().sort();
  const ensureDigest = rc.sha256String('ensure:' + sortedRoles.join(','));
  const ensureGrant = rll.mintLifecycleCommandGrant(
    projectRoot, main.binding, ensureDigest, sortedRoles, 'ensure',
    'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(ensureGrant.ok, true, 'S16 root-source setup: retained-plane ensure grant must mint: ' + JSON.stringify(ensureGrant));
  const ensureArgv = [IMPL_RLL, 'ensure', '--project-root', projectRoot];
  for (const role of S16_SUPPORT_ROLES) ensureArgv.push('--role', role);
  ensureArgv.push('--lifecycle-binding', ensureGrant.grantId);
  const ensured = spawnSync('node', ensureArgv, {
    env: Object.assign({}, process.env, { RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES: '["codex-app-server"]' }),
    encoding: 'utf8',
  });
  assert.strictEqual(ensured.status, 0, 'S16 root-source setup: retained-plane ensure must succeed: ' + JSON.stringify(ensured));
  const ensureEnvelope = JSON.parse(String(ensured.stdout).trim());
  const supervisorAction = ensureEnvelope.actions.find((candidate) => candidate.kind === 'supervisor-start');
  assert.ok(supervisorAction, 'S16 root-source setup: supervisor-start action must exist: ' + ensured.stdout);
  const foundAction = rll.findActionAcrossRepos(supervisorAction.action_id);
  assert.strictEqual(foundAction.ok && !foundAction.absent, true, 'S16 root-source setup: supervisor action must resolve: ' + JSON.stringify(foundAction));
  const supervisorLifecycleAction = foundAction.action;
  const repoDescriptor = { repoId: rll.computeRepoId(projectRoot) };
  const claim = rll.mintSupervisorExecutionClaim(repoDescriptor, supervisorLifecycleAction, main.binding.binding_id, 120);
  assert.strictEqual(claim.ok, true, 'S16 root-source setup: execution claim must mint: ' + JSON.stringify(claim));
  const readyEvidence = sortedRoles.map((role) => {
    const workerSessionId = crypto.randomBytes(16).toString('hex');
    const now = new Date();
    const presence = {
      schema: 'coordination/worker-presence/v1', role, worker_session_id: workerSessionId,
      worktree_id: supervisorLifecycleAction.worktree_id, thread_id: 's16-thread-' + workerSessionId,
      role_profile_digest: rll.roleProfileDigestFor(role), pid: process.pid,
      started_at: now.toISOString(), heartbeat_at: now.toISOString(),
      lease_expiry: new Date(now.getTime() + 60_000).toISOString(),
    };
    const presencePath = path.join(rll.registryRepoDir(projectRoot), 'workers', role, workerSessionId, 'presence.json');
    const written = rll.writeRegistryRecordReplace(presencePath, Buffer.from(JSON.stringify(presence), 'utf8'));
    assert.strictEqual(written.ok, true, 'S16 root-source setup: worker presence must publish for ' + role + ': ' + JSON.stringify(written));
    return { role, worker_session_id: workerSessionId };
  });
  const priorReadyCapability = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY;
  process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = 's16-agent-spawn-ready-capability';
  const pidIdentity = rbc.defaultProcessIdentityProvider();
  const ready = rll.transitionSupervisorBatchToReady(repoDescriptor, supervisorLifecycleAction, sortedRoles, readyEvidence, pidIdentity);
  if (priorReadyCapability === undefined) delete process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY;
  else process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY = priorReadyCapability;
  assert.strictEqual(ready.ok, true, 'S16 root-source setup: retained support plane must reach READY: ' + JSON.stringify(ready));
  const coordinationRootId = rll.computeCoordinationRootId(projectRoot);
  const rendezvousInstanceId = crypto.randomBytes(16).toString('hex');
  const supervisorInstanceId = crypto.randomBytes(16).toString('hex');
  for (const role of sortedRoles) {
    const owner = rbc.claimRoleOwner(
      repoDescriptor, coordinationRootId, role,
      rendezvousInstanceId, supervisorInstanceId, pidIdentity,
    );
    assert.strictEqual(owner.ok, true, 'S16 root-source setup: process owner must publish for ' + role + ': ' + JSON.stringify(owner));
  }
  const liveArchitect = rbc.resolveLiveCodexAppServerWorker(projectRoot, 'arch-platform', rll.roleProfileDigestFor('arch-platform'));
  assert.strictEqual(liveArchitect.ok && liveArchitect.available, true, 'S16 root-source setup: reporting architect must resolve live: ' + JSON.stringify(liveArchitect));
  const argvDigest = rc.sha256String('root-source:' + encodedIntent);
  const grant = rll.mintLifecycleCommandGrant(
    projectRoot, main.binding, argvDigest, 'toolkit-specialist', 'root-source',
    'main-orchestrator', 'orchestrator', 'normal', null,
  );
  assert.strictEqual(
    grant.ok, true,
    'S16 root-source setup: normal-profile root-source must accept a real one-use main lifecycle grant; failure here is the missing Sixteenth lifecycle admission, never a fabricated root authority: ' + JSON.stringify(grant),
  );
  const cli = spawnSync('node', [
    IMPL_RLL, 'root-source', '--project-root', projectRoot, '--intent', encodedIntent,
    '--lifecycle-binding', grant.grantId,
  ], { env: process.env, encoding: 'utf8' });
  assert.strictEqual(
    cli.status, 0,
    'S16 root-source setup: the real CLI must produce the action (no action factory): ' + JSON.stringify({ status: cli.status, stdout: cli.stdout, stderr: cli.stderr }),
  );
  let envelope;
  try { envelope = JSON.parse(cli.stdout); } catch (err) {
    assert.fail('S16 root-source setup: lifecycle stdout must be one JSON envelope: ' + JSON.stringify(cli.stdout));
  }
  assert.strictEqual(envelope.status, 'ACTION_REQUIRED', 'S16 root-source must arm one foreground Agent action: ' + JSON.stringify(envelope));
  assert.ok(envelope.operation && envelope.operation.kind === 'root-source', 'S16 root-source result must expose its closed operation: ' + JSON.stringify(envelope));
  assert.strictEqual(envelope.actions.length, 1, 'S16 root-source must return exactly one action: ' + JSON.stringify(envelope));
  const action = envelope.actions[0];
  assert.strictEqual(action.kind, 'root-source-spawn');
  assert.strictEqual(action.runtime, 'claude-native');
  assert.strictEqual(action.role, 'toolkit-specialist');
  assert.strictEqual(envelope.operation.operation_id, action.action_id);
  return { action, envelope, mainBinding: main.binding, generation: generation.generationId };
}

function runS16RootSourceOwningReserves() {
  const proj = fs.realpathSync(makeGitProject());
  try {
    writePlanFixture(proj, 's16-root-source-owning');
    const sessionId = 's16-root-source-owning-session';
    const setup = invokeRealRootSourceCli(proj, sessionId);
    const p = setup.action.payload;
    const toolInput = { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message };
    const hook = runHook({
      tool_name: 'Agent', tool_input: toolInput, tool_use_id: 's16-root-source-tool-use-01',
      session_id: sessionId, agent_type: '', agent_id: '',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
    assert.strictEqual(hook.exit, 0, 'S16-RSG-ROOT-SOURCE-OWNING-RESERVES-01: hook process must exit cleanly: ' + JSON.stringify(hook));
    const body = parseHookJSON(hook.stdout, 'S16-RSG-ROOT-SOURCE-OWNING-RESERVES-01');
    assert.strictEqual(body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision, 'allow', 'S16 root-source owning call must be explicitly allowed: ' + JSON.stringify(body));

    const reservationPath = path.join(
      rll.registryRepoDir(proj), 'root-source-actions', setup.action.action_id + '.reservation.json',
    );
    assert.ok(fs.existsSync(reservationPath), 'S16 root-source owning call must publish the exact reservation path: ' + reservationPath);
    const reservation = JSON.parse(fs.readFileSync(reservationPath, 'utf8'));
    assert.deepStrictEqual(Object.keys(reservation).sort(), [
      'action_digest', 'action_id', 'expiry', 'main_binding_id', 'reserved_at',
      'runtime_session_key', 'schema', 'session_generation_id', 'tool_input_digest', 'tool_use_id',
    ].sort(), 'S16 root-source reservation must be recursively closed');
    assert.strictEqual(reservation.schema, 'runtime/root-source-reservation/v1');
    assert.strictEqual(reservation.action_id, setup.action.action_id);
    assert.strictEqual(reservation.main_binding_id, setup.mainBinding.binding_id);
    assert.strictEqual(reservation.session_generation_id, setup.generation);
    assert.strictEqual(reservation.runtime_session_key, sessionId);
    assert.strictEqual(reservation.tool_use_id, 's16-root-source-tool-use-01');
    assert.match(reservation.action_digest, /^[a-f0-9]{64}$/);
    assert.match(reservation.tool_input_digest, /^[a-f0-9]{64}$/);
    console.log('S16-RSG-ROOT-SOURCE-OWNING-RESERVES-01: PASS');
  } finally {
    cleanup(proj);
  }
}

function runS16ZeroCandidatePassthrough() {
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 's16-root-source-zero-candidate');
    const before = listRegistryFiles(proj);
    const hook = runHook({
      tool_name: 'Agent',
      tool_input: { subagent_type: 'toolkit-specialist', name: 'ad-hoc-toolkit', prompt: 'unowned ad-hoc task' },
      tool_use_id: 's16-zero-candidate-tool-use-01',
      session_id: 's16-zero-candidate-session', agent_type: '', agent_id: '',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
    assert.strictEqual(hook.exit, 0, 'S16-RSG-ZERO-CANDIDATE-PASSTHROUGH-01: non-owning call exits 0: ' + JSON.stringify(hook));
    assert.strictEqual((hook.stdout || '').trim(), '', 'S16 zero-candidate call must emit no decision');
    assert.deepStrictEqual(listRegistryFiles(proj), before, 'S16 zero-candidate call must create zero registry artifacts');
    console.log('S16-RSG-ZERO-CANDIDATE-PASSTHROUGH-01: PASS');
  } finally {
    cleanup(proj);
  }
}

// ── M6-M7-ROOT-SOURCE-EXPIRED-HISTORY-CLOSURE-20260820 ─────────────────────
// A VALID but EXPIRED historical root-source action for the same
// role/worktree/plan must never block discovery of a newer, still-live
// action (production root cause: action 7c20935b… expired at 18:20:13Z hid
// the live action fa546b2c… expiring at 18:51:25Z, so the gate denied
// root-source-action-expired although a live owning action existed).
//
// Every case below starts from the SAME real retained-plane + real
// root-source CLI ceremony (invokeRealRootSourceCli) and then derives the
// historical/sibling action INSIDE the hermetic fixture from that real
// action: another action_id and/or another expires_at, published through
// the real durable registry writer (0600, temp+fsync+rename) so it passes
// every closed-shape/durability/validateRootSourceAction check the scanner
// applies. The ONLY thing distinguishing a historical action is its clock
// position -- no fake clock, no production seam.
const S16_EXPIRED_HISTORY_LABEL = 'S16-RSG-EXPIRED-HISTORY-LIVE-01';
const S16_EXPIRED_ONLY_LABEL = 'S16-RSG-EXPIRED-HISTORY-ONLY-DENIES-01';
const S16_TWO_LIVE_LABEL = 'S16-RSG-EXPIRED-HISTORY-TWO-LIVE-AMBIGUOUS-01';
const S16_MALFORMED_EXPIRED_LABEL = 'S16-RSG-EXPIRED-HISTORY-MALFORMED-STILL-DENIES-01';

function pastCanonicalIsoUtc(secondsAgo) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function rootSourceReservationPathsFor(proj, actionId) {
  const dir = path.join(rll.registryRepoDir(proj), 'root-source-actions');
  return {
    reservation: path.join(dir, actionId + '.reservation.json'),
    consumed: path.join(dir, actionId + '.reservation.consumed.json'),
  };
}

// Publishes a sibling of `realAction` into the real actions registry with
// `overrides` applied (deep-cloned; the real action is never mutated in
// memory). Returns the record exactly as published.
function publishDerivedRootSourceAction(proj, realAction, overrides, label) {
  const derived = JSON.parse(JSON.stringify(realAction));
  for (const key of Object.keys(overrides)) {
    if (key === 'payload') Object.assign(derived.payload, overrides.payload);
    else derived[key] = overrides[key];
  }
  const target = rll.actionPathFor(proj, derived.action_id);
  if (derived.action_id !== realAction.action_id) {
    assert.ok(!fs.existsSync(target), label + ' fixture: derived action_id must not collide: ' + target);
  }
  const written = rll.writeRegistryRecordReplace(target, Buffer.from(rc.canonicalJSONStringify(derived), 'utf8'));
  assert.strictEqual(written.ok, true, label + ' fixture: derived action must publish durably: ' + JSON.stringify(written));
  const reread = rll.readRegistryRecord(target);
  assert.strictEqual(reread.ok && !reread.absent, true, label + ' fixture: derived action must re-read as a durable registry record: ' + JSON.stringify(reread));
  assert.deepStrictEqual(reread.obj, derived, label + ' fixture: on-disk derived action must equal the published record');
  return derived;
}

function rootSourceToolInputFor(action) {
  const p = action.payload;
  return { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message };
}

function runRootSourceHookFor(proj, sessionId, action, toolUseId) {
  return runHook({
    tool_name: 'Agent', tool_input: rootSourceToolInputFor(action), tool_use_id: toolUseId,
    session_id: sessionId, agent_type: '', agent_id: '',
  }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
}

function assertNoRootSourceReservationArtifacts(proj, label) {
  const dir = path.join(rll.registryRepoDir(proj), 'root-source-actions');
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
  assert.deepStrictEqual(entries, [], label + ': a denied call must mint zero root-source reservation artifacts: ' + JSON.stringify(entries));
}

// Principal case: one expired historical action + one live action, Agent
// input == the LIVE action's payload. RED (pre-fix): the gate denies with
// the exact scanner reason root-source-action-expired. GREEN: the gate
// allows exactly the live action and the reservation binds to ITS
// action_id; the historical action is neither reserved, consumed nor
// deleted (classification, not cleanup).
function runS16ExpiredHistoryLive() {
  const label = S16_EXPIRED_HISTORY_LABEL;
  const proj = fs.realpathSync(makeGitProject());
  try {
    writePlanFixture(proj, 's16-root-source-expired-history');
    const sessionId = 's16-root-source-expired-history-session';
    const setup = invokeRealRootSourceCli(proj, sessionId);
    const live = setup.action;
    assert.ok(Date.parse(live.expires_at) > Date.now(), label + ' fixture: the real CLI action must still be live: ' + live.expires_at);
    const historical = publishDerivedRootSourceAction(proj, live, {
      action_id: crypto.randomBytes(16).toString('hex'),
      expires_at: pastCanonicalIsoUtc(30 * 60),
    }, label);
    // Fixture sanity on a DIFFERENT field than the semantic assertion: the
    // historical record is a fully valid closed action (only its clock
    // position differs), so any later deny cannot be attributed to shape.
    assert.strictEqual(rll.validateRootSourceAction(historical).ok, true, label + ' fixture: historical action must stay a valid closed action: ' + JSON.stringify(rll.validateRootSourceAction(historical)));
    assert.ok(Date.parse(historical.expires_at) < Date.now(), label + ' fixture: historical action must already be expired');
    assert.notStrictEqual(historical.action_id, live.action_id);
    assert.strictEqual(historical.worktree_id, live.worktree_id);
    assert.strictEqual(historical.plan_digest, live.plan_digest);
    assert.strictEqual(historical.role, live.role);

    const hook = runRootSourceHookFor(proj, sessionId, live, 's16-expired-history-tool-use-01');
    assert.strictEqual(hook.exit, 0, label + ': hook process must exit cleanly: ' + JSON.stringify(hook));
    const body = parseHookJSON(hook.stdout, label);
    assert.strictEqual(
      body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision, 'allow',
      label + ': a live root-source action must be allowed even when an expired historical action for the same role/worktree/plan exists; got: ' + JSON.stringify(body),
    );
    assert.deepStrictEqual(body.hookSpecificOutput.updatedInput, rootSourceToolInputFor(live), label + ': updatedInput must be the live action payload');

    const livePaths = rootSourceReservationPathsFor(proj, live.action_id);
    const historicalPaths = rootSourceReservationPathsFor(proj, historical.action_id);
    assert.ok(fs.existsSync(livePaths.reservation), label + ': reservation must bind to the LIVE action_id: ' + livePaths.reservation);
    assert.ok(!fs.existsSync(historicalPaths.reservation), label + ': the historical action must NOT be reserved');
    assert.ok(!fs.existsSync(historicalPaths.consumed), label + ': the historical action must NOT be consumed');
    assert.ok(!fs.existsSync(livePaths.consumed), label + ': the live reservation must not be consumed by the gate itself');
    const reservation = JSON.parse(fs.readFileSync(livePaths.reservation, 'utf8'));
    assert.strictEqual(reservation.schema, 'runtime/root-source-reservation/v1');
    assert.strictEqual(reservation.action_id, live.action_id, label + ': reservation.action_id must be the live action');
    const liveOnDisk = rll.readRegistryRecord(rll.actionPathFor(proj, live.action_id));
    assert.strictEqual(liveOnDisk.ok && !liveOnDisk.absent, true);
    assert.strictEqual(reservation.action_digest, rc.sha256String(rc.canonicalJSONStringify(liveOnDisk.obj)), label + ': reservation.action_digest must be the live action digest');
    assert.strictEqual(reservation.expiry, live.expires_at, label + ': reservation.expiry must be the live expires_at');
    assert.strictEqual(reservation.main_binding_id, setup.mainBinding.binding_id);
    assert.strictEqual(reservation.session_generation_id, setup.generation);
    assert.strictEqual(reservation.runtime_session_key, sessionId);
    assert.strictEqual(reservation.tool_use_id, 's16-expired-history-tool-use-01');
    const historicalOnDisk = rll.readRegistryRecord(rll.actionPathFor(proj, historical.action_id));
    assert.strictEqual(historicalOnDisk.ok && !historicalOnDisk.absent, true, label + ': the historical action must remain on disk untouched (classification, not cleanup)');
    assert.deepStrictEqual(historicalOnDisk.obj, historical);
    // Evidence lines: the exact historical/live records and the minted
    // reservation this run exercised (closed canonical JSON, no secrets).
    console.log(label + ': historical_action=' + rc.canonicalJSONStringify(historical));
    console.log(label + ': live_action=' + rc.canonicalJSONStringify(liveOnDisk.obj));
    console.log(label + ': reservation=' + rc.canonicalJSONStringify(reservation));
    console.log(label + ': PASS');
  } finally {
    cleanup(proj);
  }
}

// Control 1: ONLY an expired historical action (no live one) keeps the
// explicit root-source-action-expired deny; it must never degrade into the
// zero-candidate passthrough.
function runS16ExpiredHistoryOnlyDenies() {
  const label = S16_EXPIRED_ONLY_LABEL;
  const proj = fs.realpathSync(makeGitProject());
  try {
    writePlanFixture(proj, 's16-root-source-expired-only');
    const sessionId = 's16-root-source-expired-only-session';
    const setup = invokeRealRootSourceCli(proj, sessionId);
    const real = setup.action;
    // The real action itself becomes the expired historical one (same
    // action_id, past expires_at): exactly one matching action, none live.
    const historical = publishDerivedRootSourceAction(proj, real, { expires_at: pastCanonicalIsoUtc(30 * 60) }, label);
    assert.strictEqual(rll.validateRootSourceAction(historical).ok, true, label + ' fixture: historical action must stay a valid closed action');
    const hook = runRootSourceHookFor(proj, sessionId, historical, 's16-expired-only-tool-use-01');
    assert.notStrictEqual((hook.stdout || '').trim(), '', label + ': an expired-only scope must NOT pass through silently: ' + JSON.stringify(hook));
    const body = assertPreToolUseDeny(hook, label);
    const reason = body.hookSpecificOutput.permissionDecisionReason;
    assert.ok(/root-source owning-state validation failed for "toolkit-specialist": root-source-action-expired$/.test(reason), label + ': deny reason must be exactly the scanner reason root-source-action-expired: ' + reason);
    assertNoRootSourceReservationArtifacts(proj, label);
    console.log(label + ': PASS');
  } finally {
    cleanup(proj);
  }
}

// Control 2: two LIVE actions for the same role/worktree/plan keep
// root-source-action-ambiguous (a live sibling is never selected by
// readdir order).
function runS16TwoLiveAmbiguous() {
  const label = S16_TWO_LIVE_LABEL;
  const proj = fs.realpathSync(makeGitProject());
  try {
    writePlanFixture(proj, 's16-root-source-two-live');
    const sessionId = 's16-root-source-two-live-session';
    const setup = invokeRealRootSourceCli(proj, sessionId);
    const live = setup.action;
    const sibling = publishDerivedRootSourceAction(proj, live, { action_id: crypto.randomBytes(16).toString('hex') }, label);
    assert.strictEqual(rll.validateRootSourceAction(sibling).ok, true, label + ' fixture: sibling action must stay a valid closed action');
    assert.ok(Date.parse(sibling.expires_at) > Date.now(), label + ' fixture: sibling must be live');
    const hook = runRootSourceHookFor(proj, sessionId, live, 's16-two-live-tool-use-01');
    const body = assertPreToolUseDeny(hook, label);
    const reason = body.hookSpecificOutput.permissionDecisionReason;
    assert.ok(/root-source owning-state validation failed for "toolkit-specialist": root-source-action-ambiguous$/.test(reason), label + ': deny reason must be exactly root-source-action-ambiguous: ' + reason);
    assertNoRootSourceReservationArtifacts(proj, label);
    console.log(label + ': PASS');
  } finally {
    cleanup(proj);
  }
}

// Control 3: a MALFORMED action that is also chronologically expired is
// still rejected for its malformation (validateRootSourceAction runs before
// any clock classification); it must neither be skipped as "expired
// history" nor let the live sibling through.
function runS16MalformedExpiredStillDenies() {
  const label = S16_MALFORMED_EXPIRED_LABEL;
  const proj = fs.realpathSync(makeGitProject());
  try {
    writePlanFixture(proj, 's16-root-source-malformed-expired');
    const sessionId = 's16-root-source-malformed-expired-session';
    const setup = invokeRealRootSourceCli(proj, sessionId);
    const live = setup.action;
    const malformed = publishDerivedRootSourceAction(proj, live, {
      action_id: crypto.randomBytes(16).toString('hex'),
      expires_at: pastCanonicalIsoUtc(30 * 60),
      payload: { agent_type: 'general-purpose' },
    }, label);
    const malformedCheck = rll.validateRootSourceAction(malformed);
    assert.strictEqual(malformedCheck.ok, false, label + ' fixture: derived action must be malformed');
    assert.strictEqual(malformedCheck.reason, 'root-source-action-payload-invalid', label + ' fixture: malformation reason must be payload-invalid: ' + JSON.stringify(malformedCheck));
    const hook = runRootSourceHookFor(proj, sessionId, live, 's16-malformed-expired-tool-use-01');
    const body = assertPreToolUseDeny(hook, label);
    const reason = body.hookSpecificOutput.permissionDecisionReason;
    assert.ok(/root-source owning-state validation failed for "toolkit-specialist": root-source-action-payload-invalid$/.test(reason), label + ': deny reason must be the malformation reason, never root-source-action-expired nor allow: ' + reason);
    assert.ok(!/root-source-action-expired/.test(reason), label + ': an expired malformed action must not be reclassified as benign expired history');
    assertNoRootSourceReservationArtifacts(proj, label);
    console.log(label + ': PASS');
  } finally {
    cleanup(proj);
  }
}

const S16_FOCAL = process.env.S16_FOCAL || '';
if (S16_FOCAL) {
  if (S16_FOCAL === 'S16-RSG-ROOT-SOURCE-OWNING-RESERVES-01') runS16RootSourceOwningReserves();
  else if (S16_FOCAL === 'S16-RSG-ZERO-CANDIDATE-PASSTHROUGH-01') runS16ZeroCandidatePassthrough();
  else if (S16_FOCAL === S16_EXPIRED_HISTORY_LABEL) runS16ExpiredHistoryLive();
  else if (S16_FOCAL === S16_EXPIRED_ONLY_LABEL) runS16ExpiredHistoryOnlyDenies();
  else if (S16_FOCAL === S16_TWO_LIVE_LABEL) runS16TwoLiveAmbiguous();
  else if (S16_FOCAL === S16_MALFORMED_EXPIRED_LABEL) runS16MalformedExpiredStillDenies();
  else assert.fail('unknown S16_FOCAL: ' + S16_FOCAL);
  process.exit(0);
}

// Keep both controls in the ordinary file run as well. The zero-candidate
// positive runs first; the owning case is the intentional RED until §16b exists.
runS16ZeroCandidatePassthrough();
runS16RootSourceOwningReserves();
// M6-M7-ROOT-SOURCE-EXPIRED-HISTORY-CLOSURE-20260820: focal + its three
// minimal controls run in the ordinary file run as well.
runS16ExpiredHistoryLive();
runS16ExpiredHistoryOnlyDenies();
runS16TwoLiveAmbiguous();
runS16MalformedExpiredStillDenies();

// ══════════════════════════════════════════════════════════════════════════
// M7 SUBAGENTSTOP -- CIERRE FINAL DE IDENTIDAD Y ATOMICIDAD (2026-08-15).
// REDs 4/5/7/9 (ROOTSOURCE-WRONG-TYPE, CROSS-FAMILY-DIFFERENT-ROLE,
// ROOTSOURCE-REPLAY-IDEMPOTENT, RETIRE-THROW-BLOCKS) live HERE, not in
// claude-one-shot-binding-red.bats, because they need a REAL, LIVE
// root-source BINDING -- not merely a reservation -- and the mission's own
// explicit instruction for RED-5 ("usar la ceremonia root-source real
// existente; no sustituirla por mock") applies equally to every RED needing
// that same binding. invokeRealRootSourceCli/runS16RootSourceOwningReserves
// above already drive the real retained-plane + real root-source CLI + real
// gate reservation; setupRealRootSourceBinding below is the ONE new step
// needed on top -- a real SubagentStart (subagent-start-context-bundle.js,
// already required by this file's own item-5 section below via
// SUBAGENT_START_HOOK_FOR_CLAUDEID01) that actually CONSUMES that real
// reservation into a real runtime/root-source-binding/v1 record. No mock, no
// hand-fabricated reservation/action pair -- every object touched here was
// minted by real production code.
// ══════════════════════════════════════════════════════════════════════════

function driveSubagentStop(projDir, agentType, sessionId, agentId) {
  const result = spawnSync('node', [SUBAGENT_START_HOOK_FOR_CLAUDEID01], {
    input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: agentType, session_id: sessionId, agent_id: agentId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projDir }),
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Real root-source ceremony end to end: retained plane READY (via
// invokeRealRootSourceCli) -> real root-source CLI action -> real gate
// PreToolUse reservation -> real SubagentStart consumption -> exactly one
// real runtime/root-source-binding/v1 record, found back via the real
// findRootSourceBindingsByAction scanner (never guessed at). Requires a
// feature/<waveSlug> branch (unlike makeGitProject's own default "main")
// because subagent-start-context-bundle.js's own SubagentStart handler
// gates root-source consumption behind a resolvable getWaveSlug() -- see
// that file's own doc comment; mirrors claude-one-shot-binding-red.bats's
// own _cosb_e2e_make_project convention exactly.
// M7 LIFECYCLE -- ATOMIC REVOCATION PREP + NODE HARNESS CONTAINMENT (2026-08-16),
// PART A item 5: exception-safe. Every caller of this function opens its OWN
// try/finally{cleanup(proj)} around the RETURNED proj -- but that finally
// block is only ever entered if this function itself returns successfully.
// Before this fix, a mid-ceremony assertion failure here (any of the
// asserts below) propagated straight out, past every caller's own
// try/finally (which had not been entered yet), leaking the mktemp'd git
// project and its now-privately-contained (per PART A's own preload) but
// still orphaned registry data. Wrapped so cleanup ALWAYS runs, on success
// or failure, and the original error still propagates to the caller either
// way -- callers observe the identical failure they always did.
//
// FINAL CONTRACT RECONCILIATION (2026-08-16) follow-up: the try/catch below
// used to start AFTER `const proj = fs.realpathSync(makeGitProject())` --
// makeGitProject()'s own mkdtempSync + git init already happened, and a
// throw from realpathSync itself (or anything between mkdtemp and the try)
// left that real directory (and whatever registry data a partially-run
// ceremony had already written under it) leaked with no cleanup path at
// all, since `proj` was never assigned for the catch below to reference.
// The raw (pre-realpath) directory is now captured FIRST and is what the
// catch cleans up -- cleanup(dir)'s own registryRepoDir(dir) resolution
// works identically on the raw or realpath'd form (git resolves the
// worktree toplevel internally either way), so nothing downstream needed
// to change to accept it.
function setupRealRootSourceBinding(waveSlug, sessionId, agentId) {
  const rawDir = makeGitProject();
  try {
    const proj = fs.realpathSync(rawDir);
    const co = spawnSync('git', ['checkout', '-q', '-b', 'feature/' + waveSlug], { cwd: proj, encoding: 'utf8' });
    assert.strictEqual(co.status, 0, 'setupRealRootSourceBinding: git checkout -b feature/' + waveSlug + ' must succeed: ' + JSON.stringify(co));
    writePlanFixture(proj, waveSlug);
    const setup = invokeRealRootSourceCli(proj, sessionId);
    const p = setup.action.payload;
    const toolInput = { subagent_type: p.agent_type, name: p.name, prompt: p.bootstrap_message };
    const gate = runHook({
      tool_name: 'Agent', tool_input: toolInput, tool_use_id: 'cierre-final-red-tool-use-' + crypto.randomBytes(4).toString('hex'),
      session_id: sessionId, agent_type: '', agent_id: '',
    }, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
    assert.strictEqual(gate.exit, 0, 'setupRealRootSourceBinding: gate must exit cleanly: ' + JSON.stringify(gate));
    const gateBody = parseHookJSON(gate.stdout, 'setupRealRootSourceBinding gate');
    assert.strictEqual(gateBody.hookSpecificOutput && gateBody.hookSpecificOutput.permissionDecision, 'allow', 'setupRealRootSourceBinding: gate must allow: ' + JSON.stringify(gateBody));

    const start = driveClaudeId01SubagentStartForItem5(proj, 'toolkit-specialist', sessionId, agentId);
    assert.strictEqual(start.status, 0, 'setupRealRootSourceBinding: real SubagentStart must exit cleanly: ' + JSON.stringify(start));

    const bindings = rll.findRootSourceBindingsByAction(proj, setup.action.action_id);
    assert.strictEqual(bindings.ok, true, 'setupRealRootSourceBinding: binding lookup must succeed: ' + JSON.stringify(bindings));
    assert.strictEqual(bindings.bindings.length, 1, 'setupRealRootSourceBinding: exactly one real root-source binding must exist after the real SubagentStart: ' + JSON.stringify(bindings));
    return { proj, action: setup.action, binding: bindings.bindings[0] };
  } catch (err) {
    cleanup(rawDir);
    throw err;
  }
}

function runRedRootSourceWrongType() {
  const { proj, binding } = setupRealRootSourceBinding('red4-rootsource-wrongtype', 'red4-session', 'red4-agent-id');
  try {
    const before = listRegistryFiles(proj);
    // Same session_id+agent_id as the real binding; agent_type is WRONG
    // (verifier, not toolkit-specialist) -- must be a VISIBLE, found live
    // authority whose identity check fails, never silently "absent" merely
    // because the resolver used to filter by agent_type.
    const stop = driveSubagentStop(proj, 'verifier', 'red4-session', 'red4-agent-id');
    assert.strictEqual(stop.exit, 0, 'ROOTSOURCE-WRONG-TYPE: hook must exit cleanly: ' + JSON.stringify(stop));
    let body;
    try { body = JSON.parse(stop.stdout); } catch (e) { assert.fail('ROOTSOURCE-WRONG-TYPE: stdout must be JSON: ' + stop.stdout); }
    assert.strictEqual(body && body.decision, 'block', 'ROOTSOURCE-WRONG-TYPE: must block, never silently pass: ' + JSON.stringify(body));
    // M7 GREEN correction round 2, R6 (resolves GAP-1): 'verifier' is a
    // CANONICAL role, so shouldFence is true unconditionally for this
    // identity -- classification already found this exact session_id/
    // agent_id owning the live root-source binding (state:'ONE'), so per
    // section 8.4 ("publishes the identity fence first") the durable fence
    // is published BEFORE the agent_type claim check that then blocks this
    // stop. "Zero mutation" is no longer this scenario's contract -- EXACTLY
    // one new artifact (the identity fence for this exact session/agent) is
    // now expected, and the root-source binding itself must remain
    // completely untouched (never retired, never rewritten) alongside it.
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId({ repoId: rll.computeRepoId(proj) }, 'claude-hook', 'red4-session', 'red4-agent-id');
    const expectedFenceRel = 'authority-identity-fences/' + authorityIdentityId + '.json';
    const after = listRegistryFiles(proj);
    const afterMinusFence = after.filter((p) => p !== expectedFenceRel);
    assert.deepStrictEqual(afterMinusFence, before, 'ROOTSOURCE-WRONG-TYPE: every OTHER registry file must stay byte-for-byte unchanged (only the new identity fence is expected)');
    assert.strictEqual(after.includes(expectedFenceRel), true, 'ROOTSOURCE-WRONG-TYPE: the identity fence for this exact session/agent must now be durable (R6: fence-before-agent_type-check): ' + JSON.stringify(after));
    const fenceRead = rll.readClaudeAuthorityFence({ repoId: rll.computeRepoId(proj) }, authorityIdentityId);
    assert.strictEqual(fenceRead.ok, true, 'ROOTSOURCE-WRONG-TYPE: fence must read back cleanly: ' + JSON.stringify(fenceRead));
    assert.strictEqual(fenceRead.absent, false, 'ROOTSOURCE-WRONG-TYPE: fence must not be absent: ' + JSON.stringify(fenceRead));
    // M7 GREEN correction round 2, R6: the binding record ITSELF is never
    // synchronously deleted or rewritten (already proven above -- its file
    // is absent from the before/after diff, i.e. byte-for-byte untouched).
    // "Live" is a DERIVED validation result, not a file-mutation fact -- and
    // per section 5 point 4 ("the actor fence is durably absent" is part of
    // the total authority predicate), a fenced identity's own binding now
    // CORRECTLY fails liveness with authority-fenced specifically, never any
    // other reason -- this is the fence actually doing its job, not a
    // retirement.
    const check = rll.validateRootSourceBindingFor(proj, binding.binding_id, 'toolkit-specialist', binding.worktree_id, binding.plan_digest);
    assert.strictEqual(check.ok, false, 'ROOTSOURCE-WRONG-TYPE: binding must no longer validate as live now that its exact identity is fenced: ' + JSON.stringify(check));
    assert.strictEqual(check.reason, 'authority-fenced', 'ROOTSOURCE-WRONG-TYPE: must fail specifically for authority-fenced, never a different reason: ' + JSON.stringify(check));
    console.log('ROOTSOURCE-WRONG-TYPE: PASS');
  } finally {
    cleanup(proj);
  }
}

function runRedCrossFamilyDifferentRole() {
  const sessionId = 'red5-session';
  const agentId = 'red5-agent-id';
  const { proj, binding: rootBinding } = setupRealRootSourceBinding('red5-crossfamily', sessionId, agentId);
  try {
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    assert.strictEqual(planResult.ok, true, 'CROSS-FAMILY setup: PLAN must resolve');
    // A genuinely different one-shot binding (arch-testing), same exact
    // session_id+agent_id as the real root-source binding above -- the
    // ROOT-SOURCE half is what must never be a mock per the mission's own
    // instruction, and it is not -- it came from setupRealRootSourceBinding's
    // real ceremony above. M7 CORRECTION (2026-08-17): the one-shot half can
    // no longer go through the real createClaudeOneShotBinding creator --
    // defects 1/2's now-landed fix makes it correctly reject a second,
    // cross-family mint for an identity that already has a live root-source
    // binding ({ok:false, reason:'authority-binding-conflict'}), which is
    // exactly the M7-mandated property M7-CROSS-FAMILY-CREATE-REJECTED
    // proves. So, mirroring runtime-role-lifecycle-registry.test.js's own
    // M7-CROSS-FAMILY-AMBIGUITY-21 precedent, the one-shot side is planted
    // DIRECTLY as a byte-for-byte valid runtime/claude-one-shot-binding/v2
    // record via the same secure writeRegistryRecordReplace primitive every
    // real creator uses, at the exact path a real createClaudeOneShotBinding
    // call would have used -- simulating the diagnostic-record-left-behind
    // scenario the contract itself anticipates (section 6: "Concurrent
    // cross-family writers may leave two diagnostic records..."), never
    // going through the (now correctly stricter) creation API a second time.
    // This isolates this RED's own actual subject (handleSubagentStop's
    // ambiguity handling against two simultaneously-live cross-family
    // bindings) from the separate, now-covered-elsewhere question of whether
    // the creators themselves prevent the collision from happening at all.
    const oneShotBindingId = crypto.randomBytes(16).toString('hex');
    const genForOneShot = rll.resolveSessionGeneration(proj, { provider: 'claude-hook', runtime_session_key: sessionId });
    assert.strictEqual(genForOneShot.ok, true, 'CROSS-FAMILY setup: session generation must resolve for the planted one-shot record: ' + JSON.stringify(genForOneShot));
    const oneShotRecord = {
      schema: 'runtime/claude-one-shot-binding/v2',
      binding_id: oneShotBindingId,
      actor_instance_id: crypto.randomBytes(16).toString('hex'),
      runtime_session_key: sessionId,
      agent_id: agentId,
      agent_type: 'arch-testing',
      native_spawn_action_id: 'a'.repeat(32),
      request_id: 'b'.repeat(64),
      attempt_id: 'c'.repeat(64),
      lease_epoch: 0,
      role: 'arch-testing',
      worktree_id: worktreeId,
      plan_digest: planResult.planDigest,
      session_generation_id: genForOneShot.generationId,
      created_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      expiry: new Date(Date.now() + 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };
    const oneShotPath = rll.claudeOneShotBindingPathFor(proj, oneShotBindingId);
    const planted = rll.writeRegistryRecordReplace(oneShotPath, Buffer.from(JSON.stringify(oneShotRecord), 'utf8'));
    assert.strictEqual(planted.ok, true, 'CROSS-FAMILY setup: planting the diagnostic one-shot record must succeed: ' + JSON.stringify(planted));
    const oneShotResult = { ok: true, binding: oneShotRecord };

    const before = listRegistryFiles(proj);
    const stop = driveSubagentStop(proj, 'arch-testing', sessionId, agentId);
    assert.strictEqual(stop.exit, 0, 'CROSS-FAMILY: hook must exit cleanly: ' + JSON.stringify(stop));
    let body;
    try { body = JSON.parse(stop.stdout); } catch (e) { assert.fail('CROSS-FAMILY: stdout must be JSON: ' + stop.stdout); }
    assert.strictEqual(body && body.decision, 'block', 'CROSS-FAMILY: more than one live authority must block: ' + JSON.stringify(body));
    assert.deepStrictEqual(listRegistryFiles(proj), before, 'CROSS-FAMILY: zero mutation on block');

    const rootCheck = rll.validateRootSourceBindingFor(proj, rootBinding.binding_id, 'toolkit-specialist', rootBinding.worktree_id, rootBinding.plan_digest);
    assert.strictEqual(rootCheck.ok, true, 'CROSS-FAMILY: root-source binding must remain live: ' + JSON.stringify(rootCheck));
    const oneShotCheck = rll.validateClaudeOneShotBindingFor(proj, oneShotResult.binding.binding_id, {
      requestId: 'b'.repeat(64), attemptId: 'c'.repeat(64), leaseEpoch: 0, role: 'arch-testing', worktreeId, planDigest: planResult.planDigest,
    });
    assert.strictEqual(oneShotCheck.ok, true, 'CROSS-FAMILY: one-shot binding must remain live: ' + JSON.stringify(oneShotCheck));
    console.log('CROSS-FAMILY-DIFFERENT-ROLE: PASS');
  } finally {
    cleanup(proj);
  }
}

// M7 CORRECTION (2026-08-17): this test formerly asserted a per-binding
// <binding_id>.retired.json marker under root-source-bindings/ -- that
// writer (retireRootSourceBinding) was already removed BEFORE this session's
// own correction pass began (runtime-role-lifecycle.cjs ~L2608-2613's own
// comment: "retireRootSourceBinding (the retirement-artifact writer) is
// REMOVED. No new retirement artifact is written for root-source...
// monotonic cuts, never via a retirement marker"), so this property was
// silently untested (masked by the CROSS-FAMILY-DIFFERENT-ROLE crash making
// this function unreachable) rather than a regression introduced by today's
// fixes. Root-source's replacement mechanism is the SAME durable identity
// fence every other Claude-actor family now uses (M7 section 1:
// "ClaudeAuthorityFence/v1 is the actor-lifecycle cut written by a real
// SubagentStop/Agent return... applies uniformly across ALL Claude-actor
// families, not just one-shot") -- mirrors claude-one-shot-binding-red.bats's
// own established two-halves precedent for this exact property: a single
// real SubagentStop durably publishes the fence (COSB-E2E-SUBAGENTSTOP-
// RETIRES-PROSE-ONLY-RETURN's own before/after fence-presence proof) and a
// SECOND SubagentStop for the identical identity is a byte-identical,
// no-clobber idempotent no-op against that SAME fence (COSB-CUSTOMNAME-NEG-
// FENCED-BINDING-REPLAY-NOOP), applied here to root-source instead of
// one-shot.
function runRedRootSourceReplayIdempotent() {
  const sessionId = 'red7-session';
  const agentId = 'red7-agent-id';
  const { proj, binding } = setupRealRootSourceBinding('red7-replay', sessionId, agentId);
  try {
    const authorityIdentityId = rll.computeClaudeAuthorityIdentityId({ repoId: rll.computeRepoId(proj) }, 'claude-hook', sessionId, agentId);
    const fenceBefore = rll.readClaudeAuthorityFence(proj, authorityIdentityId);
    assert.strictEqual(fenceBefore.ok && fenceBefore.absent, true, 'ROOTSOURCE-REPLAY: fixture sanity: no identity fence may exist yet before the first real stop: ' + JSON.stringify(fenceBefore));

    const first = driveSubagentStop(proj, 'toolkit-specialist', sessionId, agentId);
    assert.strictEqual(first.exit, 0, 'ROOTSOURCE-REPLAY: first stop must exit cleanly: ' + JSON.stringify(first));
    assert.strictEqual((first.stdout || '').trim(), '', 'ROOTSOURCE-REPLAY: first stop must be a clean retire, no decision:block: ' + JSON.stringify(first));

    const fenceAfterFirst = rll.readClaudeAuthorityFence(proj, authorityIdentityId);
    assert.strictEqual(fenceAfterFirst.ok, true, 'ROOTSOURCE-REPLAY: fence read must succeed after the first stop: ' + JSON.stringify(fenceAfterFirst));
    assert.strictEqual(fenceAfterFirst.absent, false, 'ROOTSOURCE-REPLAY: the durable identity fence must exist after the first real stop -- root-source authority is cut via the SAME ClaudeAuthorityFence/v1 mechanism as every other Claude-actor family (M7 section 1), never a per-binding .retired marker (removed -- M7 section 4/8.5)');
    const rootCheckAfterFirst = rll.validateRootSourceBindingFor(proj, binding.binding_id, 'toolkit-specialist', binding.worktree_id, binding.plan_digest);
    assert.strictEqual(rootCheckAfterFirst.ok, false, 'ROOTSOURCE-REPLAY: the root-source binding must no longer validate live once its identity is fenced: ' + JSON.stringify(rootCheckAfterFirst));
    const fenceBytesFirst = fs.readFileSync(rll.claudeAuthorityFencePathFor(proj, authorityIdentityId));

    const second = driveSubagentStop(proj, 'toolkit-specialist', sessionId, agentId);
    assert.strictEqual(second.exit, 0, 'ROOTSOURCE-REPLAY: second (replay) stop must exit cleanly: ' + JSON.stringify(second));
    assert.strictEqual((second.stdout || '').trim(), '', 'ROOTSOURCE-REPLAY: second (replay) stop must be an idempotent no-op, never decision:block: ' + JSON.stringify(second));

    const fenceBytesSecond = fs.readFileSync(rll.claudeAuthorityFencePathFor(proj, authorityIdentityId));
    assert.ok(fenceBytesFirst.equals(fenceBytesSecond), 'ROOTSOURCE-REPLAY: the identity fence must stay byte-identical across the replay -- a second stop for the same identity resolves to the SAME immutable fence (no error, no re-write)');
    console.log('ROOTSOURCE-REPLAY-IDEMPOTENT: PASS');
  } finally {
    cleanup(proj);
  }
}

// M7 CORRECTION (2026-08-17): this test formerly injected the throw into
// retireClaudeOneShotBinding / retireRootSourceBinding specifically -- BOTH
// are now genuinely absent from the source (confirmed by direct read: M7
// section 4/8.5 removed both per-family retirement-artifact writers; neither
// call site nor named export exists anymore). Patching a dead export name is
// a silent no-op: `mod[fnName] = () => { throw }` merely adds an unused
// property to the module's exports object, the REAL (fence-based) retirement
// path never touches it, and the throw never fires -- which is exactly why
// this reproduced as an empty-stdout (clean, unblocked) stop instead of the
// intended block. Real production retirement is now unconditionally routed
// through the ONE shared primitive every Claude-actor family uses --
// publishClaudeAuthorityFence (M7 section 1: "the actor-lifecycle cut
// written by a real SubagentStop/Agent return... applies uniformly across
// ALL Claude-actor families") -- confirmed exported (used directly by
// claude-one-shot-binding-red.bats's own _cosb_plant_fence) and, by direct
// read, itself unconditionally defensive (publishNoClobber wraps every risky
// fs operation in its own try/catch, converting every failure mode into a
// structured return, never an escaping exception under NORMAL operation) --
// proof this codebase's write path is well-defended, not a gap, and exactly
// why this test still needs Node's own module-cache injection rather than a
// black-box filesystem fault to force a throw at all. To empirically prove
// the HOOK's OWN try/catch wrapping genuinely blocks a throw rather than
// silently falling through the outer catch-all to a spurious success (the
// exact defect class HARD NO-GO item 6/mutation (e) names), this test forces
// a REAL, uncaught exception via Node's own module cache -- never patching
// the production file on disk, never a shape/behavior mock of the hook's own
// decision logic: it replaces ONE named export on the ALREADY-loaded
// runtime-role-lifecycle.cjs module object (same resolved absolute path the
// hook itself requires, so the SAME cached exports object is mutated) with a
// function that throws, then drives the REAL, completely unmodified hook
// against it via `node --require <preload>`. Both halves below now retarget
// the SAME shared publishClaudeAuthorityFence export -- deliberately kept as
// two separate fixtures (one-shot-owning vs root-source-owning) rather than
// collapsed into one, since each proves the hook's own try/catch wrapping
// holds from a genuinely different entry/classification state, not merely
// that the shared primitive itself is defensive.
function makeThrowPreload(fnName) {
  const rllRealPath = fs.realpathSync(IMPL_RLL);
  const preloadPath = path.join(os.tmpdir(), 'red9-throw-' + crypto.randomBytes(8).toString('hex') + '.cjs');
  fs.writeFileSync(preloadPath, [
    'const mod = require(' + JSON.stringify(rllRealPath) + ');',
    'mod[' + JSON.stringify(fnName) + '] = function () { throw new Error("RED9-forced-retire-throw"); };',
  ].join('\n'));
  return preloadPath;
}

function driveSubagentStopWithPreload(preloadPath, projDir, agentType, sessionId, agentId) {
  const result = spawnSync('node', ['--require', preloadPath, SUBAGENT_START_HOOK_FOR_CLAUDEID01], {
    input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: agentType, session_id: sessionId, agent_id: agentId }),
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: projDir }),
    encoding: 'utf8',
  });
  return { exit: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runRedRetireThrowBlocks() {
  {
    const proj = fs.realpathSync(makeGitProject());
    try {
      writePlanFixture(proj, 'red9-oneshot');
      const worktreeId = rll.computeWorktreeId(proj);
      const planResult = rll.discoverPlan(proj);
      assert.strictEqual(planResult.ok, true, 'RETIRE-THROW-BLOCKS (one-shot) setup: PLAN must resolve');
      // M7 correction round 1 (C9): the old 12-arg signature had no
      // sessionGenerationId param -- resolveSessionGeneration (mint-or-reuse)
      // establishes the live generation for this fixture's own identity in
      // setup, same pattern as this mission's original signature migration.
      const genResult = rll.resolveSessionGeneration(proj, { provider: 'claude-hook', runtime_session_key: 'red9-oneshot-session' });
      assert.strictEqual(genResult.ok, true, 'RETIRE-THROW-BLOCKS (one-shot) setup: session generation must resolve: ' + JSON.stringify(genResult));
      const mint = rll.createClaudeOneShotBinding(
        proj, 'red9-oneshot-session', genResult.generationId, 'red9-oneshot-agent', 'arch-testing',
        'a'.repeat(32), 'b'.repeat(64), 'c'.repeat(64), 0, 'arch-testing',
        worktreeId, planResult.planDigest, 3600,
      );
      assert.strictEqual(mint.ok, true, 'RETIRE-THROW-BLOCKS (one-shot): binding must mint: ' + JSON.stringify(mint));
      const preload = makeThrowPreload('publishClaudeAuthorityFence');
      const before = listRegistryFiles(proj);
      const stop = driveSubagentStopWithPreload(preload, proj, 'arch-testing', 'red9-oneshot-session', 'red9-oneshot-agent');
      fs.rmSync(preload, { force: true });
      assert.strictEqual(stop.exit, 0, 'RETIRE-THROW-BLOCKS (one-shot): hook must exit cleanly: ' + JSON.stringify(stop));
      let body;
      try { body = JSON.parse(stop.stdout); } catch (e) { assert.fail('RETIRE-THROW-BLOCKS (one-shot): stdout must be JSON: ' + stop.stdout); }
      assert.strictEqual(body && body.decision, 'block', 'RETIRE-THROW-BLOCKS (one-shot): a throwing retirement must block, never fall through the outer catch-all to a silent success: ' + JSON.stringify(body));
      assert.deepStrictEqual(listRegistryFiles(proj), before, 'RETIRE-THROW-BLOCKS (one-shot): zero mutation on block');
      const check = rll.validateClaudeOneShotBindingFor(proj, mint.binding.binding_id, {
        requestId: 'b'.repeat(64), attemptId: 'c'.repeat(64), leaseEpoch: 0, role: 'arch-testing', worktreeId, planDigest: planResult.planDigest,
      });
      assert.strictEqual(check.ok, true, 'RETIRE-THROW-BLOCKS (one-shot): binding must remain live/unretired: ' + JSON.stringify(check));
      console.log('RETIRE-THROW-BLOCKS (one-shot half): PASS');
    } finally {
      cleanup(proj);
    }
  }
  {
    const sessionId = 'red9-rootsource-session';
    const agentId = 'red9-rootsource-agent';
    const { proj, binding } = setupRealRootSourceBinding('red9-rootsource', sessionId, agentId);
    try {
      const preload = makeThrowPreload('publishClaudeAuthorityFence');
      const before = listRegistryFiles(proj);
      const stop = driveSubagentStopWithPreload(preload, proj, 'toolkit-specialist', sessionId, agentId);
      fs.rmSync(preload, { force: true });
      assert.strictEqual(stop.exit, 0, 'RETIRE-THROW-BLOCKS (root-source): hook must exit cleanly: ' + JSON.stringify(stop));
      let body;
      try { body = JSON.parse(stop.stdout); } catch (e) { assert.fail('RETIRE-THROW-BLOCKS (root-source): stdout must be JSON: ' + stop.stdout); }
      assert.strictEqual(body && body.decision, 'block', 'RETIRE-THROW-BLOCKS (root-source): a throwing retirement must block: ' + JSON.stringify(body));
      assert.deepStrictEqual(listRegistryFiles(proj), before, 'RETIRE-THROW-BLOCKS (root-source): zero mutation on block');
      const check = rll.validateRootSourceBindingFor(proj, binding.binding_id, 'toolkit-specialist', binding.worktree_id, binding.plan_digest);
      assert.strictEqual(check.ok, true, 'RETIRE-THROW-BLOCKS (root-source): binding must remain live: ' + JSON.stringify(check));
      console.log('RETIRE-THROW-BLOCKS (root-source half): PASS');
    } finally {
      cleanup(proj);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Undertested gap found by toolkit-specialist while implementing the M7
// correction pass (2026-08-17), reported to test-specialist for a RED: the
// exact symmetric case of M7-STALE-GRANT-AFTER-TERMINAL-ZERO-CONSUMED-MARKER
// (runtime-consultation-cli.test.js), for root-source/requester authority
// instead of one-shot/target. Confirmed by direct read: enforceRootSourceGrantBoundary
// (runtime-consultation.cjs ~L6314-6374, called from
// validateAndConsumeRoleCommandGrantForCommand's authority==='requester'
// branch) checks ROOT_SOURCE_POST_INGRESS_COMMANDS membership and
// request_id/source_role/requester_instance_id scope correlation against the
// ingress record, but -- unlike the sibling one-shot/target terminal recheck
// a few dozen lines below it in the SAME function (~L6571-6590, gated
// strictly on claudeAuthorityFamily === 'one-shot') -- never checks whether
// the transaction has already become terminal (ack.json/cancel.json) before
// letting a root-source-backed requester grant for one of the 7 post-ingress
// subcommands (dispatch|await-result|accept-result|transaction-ack|cancel|
// cleanup|record-delivery) be consumed.
//
// Fixture construction (team-lead guidance, 2026-08-17): the root-source
// binding is REAL, via this file's own setupRealRootSourceBinding -- never a
// mock, per this file's own explicit mission instruction (see this file's
// own header comment for REDs 4/5/7/9). The underlying transaction is a
// "carrier" publish-request through an ORDINARY, non-root-source stable
// requester binding, with its own simple, unrelated intent -- never going
// through root-source's own PRE-INGRESS bootstrap-intent-matching branch at
// all. rll.publishRootIngress(projectRoot, binding, {requestId,
// requestDigest}) (runtime-role-lifecycle.cjs ~L2531-2551, read in full) is
// then called DIRECTLY -- a plain, non-hook/CLI-gated function -- to
// correlate that carrier transaction to the real root-source binding,
// producing a genuine runtime/root-ingress/v1 record whose every OTHER field
// (action_id, requester_instance_id, subject_scope_digest, request_expiry,
// worktree_id, plan_digest) it derives directly from the binding itself --
// never from the carrier request, and never hand-constructed by this
// fixture.
// ══════════════════════════════════════════════════════════════════════════
function runRedRootSourceStaleGrantAfterTerminal() {
  const waveSlug = 'red-rootsource-stale-grant';
  const sessionId = 'red-rootsource-stale-session';
  const agentId = 'red-rootsource-stale-agent';
  const { proj, binding } = setupRealRootSourceBinding(waveSlug, sessionId, agentId);
  try {
    const IMPL_RC = path.resolve(__dirname, '../lib/runtime-consultation.cjs');
    const TEST_CAP = 'rootsource-stale-grant-fixture-capability';
    assert.strictEqual(rll.discoverPlan(proj).ok, true, 'ROOTSOURCE-STALE-GRANT setup: PLAN must resolve');
    const coordRoot = rll.coordinationRootPathFor(proj);
    const cliEnv = Object.assign({}, process.env, { NODE_ENV: 'test', RUNTIME_CONSULTATION_TEST_CAPABILITY: TEST_CAP });

    // Carrier publish-request: an UNRELATED, ordinary stable requester
    // identity -- mirrors runtime-consultation-role-gate.bats's own proven
    // M7-ROOT-TERMINAL-CUT-16 precedent exactly (read in full, team-lead
    // guidance 2026-08-17): a root-source binding's own publish-request
    // pre-ingress bootstrap flow is a one-time, ceremony-integrated step
    // (setupRealRootSourceBinding above already completed it) -- a SECOND,
    // independent attempt to mint a publish-request grant against the SAME
    // already-established binding is rejected (root-source-bootstrap-scope-
    // mismatch, empirically confirmed during authoring), matching that
    // precedent's own choice to publish the carrier under a completely
    // unrelated identity instead.
    //
    // That precedent's own carrier stays deliberately UNCORRELATED to the
    // root-source binding (publishRootIngress only needs shape-valid
    // requestId/requestDigest) -- sufficient for ITS OWN target
    // (mintRoleCommandGrant called directly, isolating exactly the mint-time
    // gap under test, never the full CLI). THIS test's own target is the
    // CONSUME-time gap specifically, reachable only through the real CLI's
    // validateAndConsumeRoleCommandGrantForCommand -- and that function's own
    // requester-authority branch independently cross-checks the CURRENT
    // transaction's own recorded source_role/requester_instance_id
    // (resolveRequesterGrantScope, re-derived from request.json) against the
    // CONSUMING grant's own role/actorInstanceId (=binding's), strictly
    // BEFORE ever reaching enforceRootSourceGrantBoundary. An unrelated
    // carrier's own requester_instance_id therefore can never match the
    // root-source binding's own actor_instance_id (independently-random
    // values), which would reject every consumption attempt on that
    // unrelated mismatch alone -- never reaching, let alone proving, the
    // actual terminal-recheck gap (empirically confirmed during authoring:
    // this exact failure mode, AUTHORITY_INVALID with zero relation to any
    // terminal). The carrier's request.json is therefore patched, directly
    // and minimally, to carry the root-source binding's own actor_instance_id
    // in place of whatever independent value its own real (but unrelated)
    // publisher naturally produced -- the ONE field this specific cross-check
    // needs, nothing else touched, nothing else about the real publish
    // faked.
    const carrierIdentity = { ok: true, provider: 'codex-supervisor', runtime_session_key: 'red-rootsource-stale-carrier-session' };
    const carrierBindingResult = rll.createRequesterBinding(proj, carrierIdentity, 'red-rootsource-stale-carrier-agent', 'arch-testing', rll.computeWorktreeId(proj), rll.discoverPlan(proj).planDigest, 3600);
    assert.strictEqual(carrierBindingResult.ok, true, 'ROOTSOURCE-STALE-GRANT setup: carrier requester binding must mint: ' + JSON.stringify(carrierBindingResult));

    const subjectBundlePath = path.join(proj, '.planning', 'coordination-subject-bundle-manifest.json');
    fs.mkdirSync(path.dirname(subjectBundlePath), { recursive: true });
    fs.writeFileSync(subjectBundlePath, JSON.stringify({ schema: 'coordination/subject-bundle-manifest/v1', entries: [] }));
    const planPath = rll.discoverPlan(proj).planPath;

    const intentB64 = Buffer.from(JSON.stringify({
      target_role: 'arch-testing',
      question: 'ROOTSOURCE-STALE-GRANT unrelated carrier request for root-source ingress correlation',
      expected_result_kind: 'TEST_RESULT',
      expiry: new Date(Date.now() + 1800000).toISOString(),
    }), 'utf8').toString('base64url');
    const publishRest = ['--coordination-root', coordRoot, '--plan', planPath, '--subject-bundle', subjectBundlePath, '--intent', intentB64];
    const publishArgvDigest = rc.sha256String(rc.canonicalJSONStringify(publishRest));
    const publishGrant = rll.mintRoleCommandGrant(proj, carrierBindingResult.binding, 'requester', 'publish-request', publishArgvDigest, null, null, null);
    assert.strictEqual(publishGrant.ok, true, 'ROOTSOURCE-STALE-GRANT setup: carrier publish-request grant must mint: ' + JSON.stringify(publishGrant));
    const published = spawnSync('node', [IMPL_RC, 'publish-request'].concat(publishRest, ['--requester-binding', publishGrant.grantId]), { encoding: 'utf8', env: cliEnv });
    assert.strictEqual(published.status, 0, 'ROOTSOURCE-STALE-GRANT setup: carrier publish-request must succeed: ' + JSON.stringify({ status: published.status, stdout: published.stdout, stderr: published.stderr }));
    const publishedBody = JSON.parse(published.stdout.trim());
    assert.strictEqual(publishedBody.status, 'SUCCESS', 'ROOTSOURCE-STALE-GRANT setup: carrier publish-request must report SUCCESS: ' + published.stdout);
    const requestPath = publishedBody.artifact_ref;

    const reqObjBeforePatch = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    assert.notStrictEqual(reqObjBeforePatch.requester_instance_id, binding.actor_instance_id, 'fixture sanity: the carrier must genuinely be an unrelated identity before the patch, never accidentally already matching');
    assert.notStrictEqual(reqObjBeforePatch.source_role, binding.role, 'fixture sanity: the carrier must genuinely be an unrelated role before the patch, never accidentally already matching');
    // Both fields patched together -- validateAndConsumeRoleCommandGrantForCommand's
    // own requester-authority branch cross-checks BOTH expectedScope.sourceRole
    // (===validated.role) and expectedScope.requesterInstanceId
    // (===validated.actorInstanceId) before ever reaching
    // enforceRootSourceGrantBoundary; patching only one leaves the other
    // mismatched and rejects for that unrelated reason instead.
    const reqObj = Object.assign({}, reqObjBeforePatch, { requester_instance_id: binding.actor_instance_id, source_role: binding.role });
    fs.writeFileSync(requestPath, rc.canonicalJSONStringify(reqObj));

    // Correlate the (now patched) carrier transaction to the REAL root-source
    // binding -- a plain, non-hook/CLI-gated library call (see this
    // section's own header comment).
    const requestDigest = rc.sha256File(requestPath);
    const ingressResult = rll.publishRootIngress(proj, binding, { requestId: reqObj.request_id, requestDigest });
    assert.strictEqual(ingressResult.ok, true, 'ROOTSOURCE-STALE-GRANT setup: publishRootIngress must succeed against the real root-source binding: ' + JSON.stringify(ingressResult));

    // Mint a root-source-backed requester grant for `dispatch` (one of the 7
    // post-ingress subcommands) while the transaction is still genuinely
    // live -- mirrors M7-STALE-GRANT-AFTER-TERMINAL-ZERO-CONSUMED-MARKER's
    // own "still-live mint must succeed" fixture sanity.
    const dispatchRest = ['--coordination-root', coordRoot, '--request', requestPath];
    const dispatchArgvDigest = rc.sha256String(rc.canonicalJSONStringify(dispatchRest));
    const dispatchScope = rc.resolveRequesterGrantScope('dispatch', { 'coordination-root': coordRoot, request: requestPath });
    assert.strictEqual(dispatchScope.ok, true, 'ROOTSOURCE-STALE-GRANT: dispatch grant scope must resolve against the real, live transaction: ' + JSON.stringify(dispatchScope));
    const dispatchGrant = rll.mintRoleCommandGrant(proj, binding, 'requester', 'dispatch', dispatchArgvDigest, dispatchScope.requestId, dispatchScope.attemptId, dispatchScope.leaseEpoch);
    assert.strictEqual(dispatchGrant.ok, true, 'ROOTSOURCE-STALE-GRANT: minting a root-source-backed requester grant against a still-live (non-terminal) transaction must succeed: ' + JSON.stringify(dispatchGrant));

    const repoId = rll.computeRepoId(proj);
    const principalId = typeof process.getuid === 'function' ? ('uid-' + process.getuid()) : ('user-' + rc.sha256String(os.userInfo().username));
    const consumedMarkerPath = path.join(os.tmpdir(), 'android-common-doc-runtime', principalId, repoId, 'role-command-grants', dispatchGrant.grantId + '.consumed');
    assert.strictEqual(fs.existsSync(consumedMarkerPath), false, 'ROOTSOURCE-STALE-GRANT: fixture sanity: the consumed marker must not exist before consumption is even attempted');

    // The transaction becomes terminal AFTER the grant already exists -- a
    // legitimate concurrent completion this grant's own holder has not yet
    // observed, never a synthetic same-instant race. Real `cancel` call,
    // reusing the SAME real root-source binding that published the request
    // (see this section's own header comment for why it must be the SAME
    // binding), so its own recorded source_role/requester_instance_id
    // genuinely authorizes this cancel.
    const cancelRest = ['--coordination-root', coordRoot, '--request', requestPath, '--reason', 'explicit'];
    const cancelArgvDigest = rc.sha256String(rc.canonicalJSONStringify(cancelRest));
    const cancelScope = rc.resolveRequesterGrantScope('cancel', { 'coordination-root': coordRoot, request: requestPath });
    assert.strictEqual(cancelScope.ok, true, 'ROOTSOURCE-STALE-GRANT: cancel grant scope must resolve: ' + JSON.stringify(cancelScope));
    const cancelGrant = rll.mintRoleCommandGrant(proj, binding, 'requester', 'cancel', cancelArgvDigest, cancelScope.requestId, cancelScope.attemptId, cancelScope.leaseEpoch);
    assert.strictEqual(cancelGrant.ok, true, 'ROOTSOURCE-STALE-GRANT: cancel grant must mint: ' + JSON.stringify(cancelGrant));
    const cancelled = spawnSync('node', [IMPL_RC, 'cancel'].concat(cancelRest, ['--requester-binding', cancelGrant.grantId]), { encoding: 'utf8', env: cliEnv });
    assert.strictEqual(cancelled.status, 0, 'ROOTSOURCE-STALE-GRANT: real cancel must succeed: ' + JSON.stringify({ status: cancelled.status, stdout: cancelled.stdout, stderr: cancelled.stderr }));
    const cancelledBody = JSON.parse(cancelled.stdout.trim());
    assert.strictEqual(cancelledBody.status, 'SUCCESS', 'ROOTSOURCE-STALE-GRANT: real cancel must report SUCCESS: ' + cancelled.stdout);

    // Bypasses grant auto-minting deliberately (mirrors M7-STALE-GRANT-AFTER-
    // TERMINAL-ZERO-CONSUMED-MARKER's own identical technique) -- direct
    // spawn of the real CLI with this test's OWN pre-minted, pre-terminal
    // root-source grantId explicit on --requester-binding.
    const consumeResult = spawnSync('node', [IMPL_RC, 'dispatch'].concat(dispatchRest, ['--requester-binding', dispatchGrant.grantId]), { encoding: 'utf8', env: cliEnv });
    const consumeData = JSON.parse(consumeResult.stdout.trim());
    // Unlike M7-STALE-GRANT-AFTER-TERMINAL-ZERO-CONSUMED-MARKER's own
    // one-shot/target case (where a SEPARATE, unrelated application-level
    // check in cmdClaim also happens to reject the outer command regardless
    // of the AUTHORITY-layer bug, making that particular assertion a weak
    // "fixture sanity" that holds either way) -- cmdDispatch has no such
    // separate cancel.json check of its own (empirically confirmed during
    // authoring: on today's unfixed code this call returns ok:true/SUCCESS,
    // a real activation genuinely gets created). This assertion is therefore
    // NOT merely fixture sanity here -- it is itself part of the real proof:
    // it holds true only once enforceRootSourceGrantBoundary gains its own
    // terminal recheck and throws AUTHORITY_INVALID before cmdDispatch's
    // handler ever runs. The .consumed marker check right after remains the
    // MOST precise, targeted assertion (proves the AUTHORITY layer
    // specifically never wrote a consumption record, independent of exactly
    // how/why the outer command failed), so both are kept.
    assert.strictEqual(
      consumeData.ok, false,
      'the M7 role-command-grant AUTHORITY layer must deny a root-source-backed requester grant once its backing transaction has become terminal -- today enforceRootSourceGrantBoundary/validateAndConsumeRoleCommandGrantForCommand perform zero terminal (ack.json/cancel.json) recheck for claudeAuthorityFamily===\'root-source\' (only \'one-shot\' gets that recheck, a few dozen lines below in the SAME function), so a grant minted while the transaction was still live is silently consumed and the dispatch actually runs: ' + JSON.stringify(consumeData)
    );
    assert.strictEqual(
      fs.existsSync(consumedMarkerPath), false,
      'the M7 role-command-grant AUTHORITY layer must never consume (write a .consumed marker for) a root-source-backed requester grant once its backing transaction has become terminal -- today enforceRootSourceGrantBoundary/validateAndConsumeRoleCommandGrantForCommand perform zero terminal (ack.json/cancel.json) recheck for claudeAuthorityFamily===\'root-source\' (only \'one-shot\' gets that recheck, a few dozen lines below in the SAME function), so this stale grant is silently consumed: ' + JSON.stringify(consumeData)
    );
    console.log('ROOTSOURCE-STALE-GRANT-AFTER-TERMINAL: PASS');
  } finally {
    cleanup(proj);
  }
}

// GATE RULE 1 positive (isolated, zero ceremony): the canonical-role
// namespace is reserved GLOBALLY, independent of whether subagent_type
// itself owns anything at all -- toolkit-specialist has ZERO owning
// candidates in a totally fresh project (no root-source action, no
// claude-agent activation, no role-lifecycle action), yet `name` is a
// DIFFERENT canonical role: must still deny, purely on the reserved-
// namespace violation, before any ownership resolution ever runs.
function runPositiveCanonicalNameZeroCandidateStillDenies() {
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'positive-canonical-zero-candidate');
    const before = listRegistryFiles(proj);
    const r = runMainOrchestratorAgentCall(
      { subagent_type: 'toolkit-specialist', name: 'test-specialist', prompt: 'irrelevant' },
      proj, 'positive-zero-candidate-session',
    );
    assertPreToolUseDeny(r, 'CANONICAL-NAME-ZERO-CANDIDATE-STILL-DENIES');
    assert.deepStrictEqual(listRegistryFiles(proj), before, 'CANONICAL-NAME-ZERO-CANDIDATE-STILL-DENIES: zero registry side effects on deny');
    console.log('CANONICAL-NAME-ZERO-CANDIDATE-STILL-DENIES: PASS');
  } finally {
    cleanup(proj);
  }
}

// GATE RULE 2 positive: name OMITTED entirely (PLAN.md's own documented
// Agent(subagent_type=<canonical-role>) invocation) must be canonicalized
// internally to subagent_type for an owning role-lifecycle spawn -- an
// owning call, never a silent non-owning passthrough merely because `name`
// was never provided. (The name===subagent_type positive is already RB1,
// re-verified unchanged below; the non-canonical-name/zero-authority
// positive is already runS16ZeroCandidatePassthrough above, re-verified
// unchanged -- both reused rather than duplicated.)
function runPositiveOwningNameAbsent() {
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'positive-owning-name-absent');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'positive-name-absent-session');
    const toolInput = { subagent_type: RB_ROLE, prompt: fixture.bootstrapMessage };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'positive-name-absent-session');
    assert.strictEqual(r.exit, 0, 'OWNING-NAME-ABSENT: hook must exit cleanly: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'OWNING-NAME-ABSENT');
    assert.strictEqual(body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision, 'allow', 'OWNING-NAME-ABSENT: an owning call with name omitted must be ALLOWED, canonicalized internally to subagent_type: ' + JSON.stringify(body));
    const claimRead = rll.readRegistryRecord(rll.roleSpawnExecutionClaimPathFor(fixture.repoDescriptor, fixture.roleSpawnActionId));
    assert.strictEqual(claimRead.ok && !claimRead.absent, true, 'OWNING-NAME-ABSENT: a real RoleSpawnExecutionClaim must be minted: ' + JSON.stringify(claimRead));
    console.log('OWNING-NAME-ABSENT: PASS');
  } finally {
    cleanup(proj);
  }
}

runRedRootSourceWrongType();
runRedCrossFamilyDifferentRole();
runRedRootSourceReplayIdempotent();
runRedRetireThrowBlocks();
runRedRootSourceStaleGrantAfterTerminal();
runPositiveCanonicalNameZeroCandidateStillDenies();
runPositiveOwningNameAbsent();

// RB1: a well-formed main-orchestrator Agent() call whose tool_input
// (subagent_type/name) exactly matches a fully-eligible (team-ensure
// SUCCEEDED, role-spawn PENDING) action's own payload must be ALLOWED, and
// must genuinely, atomically reserve that action -- proven by an
// independent round-trip through the proposed
// validateAndConsumeRoleSpawnExecutionClaim, never a shape-only check on
// the hook's own stdout (this codebase's own established testing
// philosophy, e.g. LG1/the sibling runtime-role-lifecycle-handlers.test.js).
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb1-wave');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb1-session');
    // M7 Correction (Fix 1): prompt must match the action's own accredited
    // bootstrap_message -- without this, a positive-path fixture would
    // itself start denying once Fix 1 lands (prompt undefined !== the
    // action's own real bootstrap_message).
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixture.bootstrapMessage };

    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb1-session');
    assert.strictEqual(r.exit, 0, 'RB1: a well-formed, fully-eligible reservation attempt must be allowed: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'RB1');
    assert.ok(body.hookSpecificOutput, 'RB1: response must carry hookSpecificOutput: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.hookEventName, 'PreToolUse', 'RB1: hookEventName must be PreToolUse: ' + JSON.stringify(body));
    assert.strictEqual(body.hookSpecificOutput.permissionDecision, 'allow', 'RB1: permissionDecision must be "allow" per PLAN.md ~L600\'s "every owning hook returns... permissionDecision:\'allow\'": ' + JSON.stringify(body));

    const actionRead = rll.findActionAcrossRepos(fixture.roleSpawnActionId);
    assert.strictEqual(actionRead.ok, true, 'RB1: the reserved action must still be readable: ' + JSON.stringify(actionRead));
    const expectedDigest = proposedToolInputDigest(toolInput);
    const consumeResult = rll.validateAndConsumeRoleSpawnExecutionClaim(fixture.repoDescriptor, actionRead.action, expectedDigest, proj);
    assert.strictEqual(consumeResult.ok, true, 'RB1: a genuine, round-trip-consumable reservation claim must exist for this exact action after a successful hook call: ' + JSON.stringify(consumeResult));
    assert.strictEqual(consumeResult.claim.action_id, fixture.roleSpawnActionId, 'RB1: the claim must reference the exact action that was reserved: ' + JSON.stringify(consumeResult.claim));
    assert.ok(consumeResult.claim.reservation_id, 'RB1: the claim must carry a fresh reservation_id (the per-attempt receipt B2 will later correlate against): ' + JSON.stringify(consumeResult.claim));

    console.log('RB1 well-formed main-orchestrator Agent() call reserves a genuine, round-trip-consumable claim: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB2: a second, concurrent/replayed reservation attempt for the SAME
// action must be DENIED -- only one invocation may win the atomic
// reservation. Mirrors the no-clobber-as-election idiom already
// established throughout this codebase (grant-consumed markers,
// execution-claim `.consumed` markers).
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb2-wave');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb2-session');
    // M7 Correction (Fix 1): see RB1's own comment for why prompt must match.
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixture.bootstrapMessage };

    const r1 = runMainOrchestratorAgentCall(toolInput, proj, 'rb2-session');
    assert.strictEqual(r1.exit, 0, 'RB2a: the first reservation attempt must be allowed: ' + JSON.stringify(r1));

    const r2 = runMainOrchestratorAgentCall(toolInput, proj, 'rb2-session');
    assertPreToolUseDeny(r2, 'RB2b: a second, concurrent/replayed reservation attempt for the SAME action must be DENIED');

    console.log('RB2 second/replayed reservation attempt for the same action is denied (atomic single-winner): PASS');
  } finally {
    cleanup(proj);
  }
}

// RB3 (RECLASSIFIED, team-lead + user, 2026-08-08): a main-orchestrator
// Agent() call whose subagent_type requests a role with NO pending
// role-spawn action of its own (here: 'toolkit-specialist', while the
// only real action that exists in this fixture is for
// RB_ROLE='arch-testing') is NON-OWNING per item 1's tuple check -- "role"
// means the role the INCOMING call actually requests, and no action
// exists for THAT role at all. Mirrors RB9's framing exactly (empty
// stdout, exit 0). Originally written (before the owning/non-owning
// boundary was precisely specified) to assert denial; team-lead
// re-derived and confirmed this reclassification independently -- RB11
// now correctly owns the "same role, wrong payload" mismatch case this
// test used to imprecisely represent, so no coverage is lost. The full
// state space stays complete: no action for the requested role -> non-
// owning (RB9, RB3); action exists for the role but other details
// mismatch -> owning+deny (RB11); everything matches -> owning+reserve
// (RB1).
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb3-wave');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb3-session');
    const toolInputForUnrelatedRole = { subagent_type: 'toolkit-specialist', name: 'toolkit-specialist' };

    const r = runMainOrchestratorAgentCall(toolInputForUnrelatedRole, proj, 'rb3-session');
    assert.strictEqual(r.exit, 0, 'RB3: an Agent() call requesting a role with no pending action of its own must be allowed to proceed -- non-owning, never denied, even while a DIFFERENT role\'s action genuinely exists in the same project/session: ' + JSON.stringify(r));
    assert.strictEqual((r.stdout || '').trim(), '', 'RB3: non-owning must produce EMPTY stdout -- no decision of any kind: ' + JSON.stringify(r));

    // Discriminates a genuine denial from a VACUOUS pass (see RB5's own
    // comment for the same rationale): the OTHER role's (RB_ROLE's) own
    // genuinely-eligible action must remain completely UNRESERVED by this
    // unrelated toolkit-specialist call -- proves this non-owning call
    // never accidentally reserves a DIFFERENT role's pending action just
        // because one exists somewhere in the same project/session.
    const claimPath = rll.roleSpawnExecutionClaimPathFor(proj, fixture.roleSpawnActionId);
    assert.strictEqual(fs.existsSync(claimPath), false, 'RB3: a call for an unrelated role must never reserve a DIFFERENT role\'s existing action: ' + claimPath);

    console.log('RB3 (non-owning) an Agent() call for a role with no pending action of its own proceeds unaffected, never cross-reserving a DIFFERENT role\'s existing action: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB4 (regression guard): a specialist/architect (non-empty agent_type)
// issuing the IDENTICAL well-formed Agent() call must get NO reservation
// behavior at all -- this mechanism is main-orchestrator-only, mirroring
// LG3's own "non-main-orchestrator caller unaffected" precedent in
// context-provider-gate.test.js. Pinned explicitly so a future, over-broad
// implementation can never widen reservation to non-main-orchestrator
// callers.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb4-wave');
    mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb4-session');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };

    const r = runHook(
      {
        tool_name: 'Agent',
        tool_input: toolInput,
        session_id: 'rb4-session',
        agent_type: 'arch-testing',
        agent_id: 'arch-testing',
      },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assert.strictEqual(r.exit, 0, 'RB4: a peer agent\'s own Agent() call must be unaffected by this main-orchestrator-only mechanism -- must pass through allowed: ' + JSON.stringify(r));
    let hadReservationDecision = false;
    if (r.stdout && r.stdout.trim().length > 0) {
      try {
        const body = JSON.parse(r.stdout);
        hadReservationDecision = !!(body && body.hookSpecificOutput);
      } catch { /* non-JSON stdout is fine here -- definitely no reservation decision */ }
    }
    assert.strictEqual(hadReservationDecision, false, 'RB4: a non-main-orchestrator caller must never receive a reservation decision from this hook: ' + JSON.stringify(r));

    console.log('RB4 non-main-orchestrator (specialist/architect) Agent() call unaffected by this mechanism (regression guard): PASS');
  } finally {
    cleanup(proj);
  }
}

// RB5: team-ensure that has NOT yet reached SUCCEEDED (still PENDING) must
// DENY reservation -- "revalidate... team-ensure-succeeded" is a genuine,
// independently-checked precondition, not merely "does a pending role-spawn
// action exist".
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb5-wave');
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb5-session' };
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    primeClaudeId01TraceForItem5(proj, 'context-provider', 'rb5-session', 'rb5-capability-primary');
    const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planResult.planDigest, 120);
    const argvDigest = crypto.createHash('sha256').update('ensure:' + RB_ROLE).digest('hex');
    const grantResult = rll.mintLifecycleCommandGrant(proj, bindingResult.binding, argvDigest, RB_ROLE, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
    const ensureResult = spawnSync('node', [IMPL_RLL, 'ensure', '--project-root', proj, '--role', RB_ROLE, '--lifecycle-binding', grantResult.grantId], { env: process.env, encoding: 'utf8' });
    assert.strictEqual(ensureResult.status, 0, 'RB5 setup: ensure CLI must succeed: ' + ensureResult.stdout + ensureResult.stderr);
    // Deliberately NEVER call registerTeamEnsureSuccess -- team-ensure stays PENDING.
    const genResult = rll.resolveSessionGeneration(proj, identity);
    const repoDescriptor = { repoId: rll.computeRepoId(proj) };
    const teamEnsureState = rll.readTeamEnsureState(repoDescriptor, genResult.generationId, worktreeId, planResult.planDigest);
    assert.strictEqual(teamEnsureState.state, 'PENDING', 'RB5 setup sanity: team-ensure must genuinely still be PENDING (never SUCCEEDED) for this test: ' + JSON.stringify(teamEnsureState));

    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb5-session');
    assertPreToolUseDeny(r, 'RB5: reservation must be DENIED while team-ensure has not yet reached SUCCEEDED, even though a genuinely pending role-spawn action exists for this role');

    // Discriminates a genuine denial from a VACUOUS pass (the hook file not
    // existing at all ALSO produces a non-zero exit, which would otherwise
    // trivially satisfy the assertion above regardless of whether
    // team-ensure revalidation is implemented at all): no reservation claim
    // may exist for this action either way.
    const bindingStateAfter = rll.readRoleBindingState(proj, worktreeId, planResult.planDigest, rll.roleProfileDigestFor(RB_ROLE), genResult.generationId, RB_ROLE);
    const claimPath = rll.roleSpawnExecutionClaimPathFor(proj, bindingStateAfter.record.pending_action_id);
    assert.strictEqual(fs.existsSync(claimPath), false, 'RB5: no reservation claim may exist at all when team-ensure has not yet succeeded: ' + claimPath);

    console.log('RB5 team-ensure not yet SUCCEEDED (still PENDING) denies reservation, with no claim minted: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB6 (Part C -- operation independently re-derived from the action's own
// kind/runtime; CORRECTED per m7-correction-spec.md §4 Fix 3, second half --
// see below): a PENDING action for this exact role that is NOT a
// role-spawn/claude-native action (e.g. a role-notify action, whose
// resolveHostOperationForAction('role-notify','claude-native') resolves to
// 'SendMessage', never 'Agent') must NEVER be treated as this Agent-tool
// gate's reservation target.
//
// M7 CORRECTION (flip from the ORIGINAL RB6): this test used to assert the
// PENDING role-notify action makes the call OWNING-and-DENIED (a non-Agent
// action for this role gets found as a "candidate", then explicitly
// rejected via the operation!=='Agent' check). Per the corrected design,
// that is itself the bug: `findOwningRoleLifecycleCandidate`'s second scan
// loop (over bare actions with no role-binding) matches ANY
// coordination/role-lifecycle-action/v1 for the role, INCLUDING
// kind:'role-notify' -- which silently converts an unrelated, legitimate
// ad-hoc Agent(subagent_type: X) dispatch into "owning" for a role that
// merely happens to have a pending role-notify, then denies it outright.
// This breaks ordinary ad-hoc dispatch for no real security reason (a
// pending role-notify action never maps to an Agent-tool call at all, so it
// should never make an UNRELATED Agent() call for the same role "owning" in
// the first place). The fix filters loop 2's candidates by
// resolveHostOperationForAction(...)==='Agent' BEFORE they are ever
// considered a candidate -- so this exact scenario must now be NON-OWNING
// (empty stdout, exit 0), the same shape as RB9/RB10a, not an explicit deny.
// Left the setup (role-notify action minting) unchanged; only the final
// assertion and this comment changed.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb6-wave');
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb6-session' };
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planResult.planDigest, 120);
    const repoId = rll.computeRepoId(proj);
    const genResult = rll.resolveSessionGeneration(proj, identity);
    const pair = rll.resolvePolicyPair(proj);
    assert.strictEqual(pair.ok, true, 'RB6 setup: policy pair must resolve: ' + JSON.stringify(pair));
    const policyDigest = rc.sha256String(rc.canonicalJSONStringify(pair.routing));

    assert.strictEqual(rll.resolveHostOperationForAction('role-notify', 'claude-native'), 'SendMessage', 'RB6 setup sanity: role-notify/claude-native must resolve to SendMessage, never Agent -- this is the whole premise of this test');

    const notifyActionId = rll.generateActionId();
    const notifyPayload = rll.buildRoleNotifyPayload(bindingResult.binding.binding_id, RB_ROLE, 'fixture-artifact-ref', 'context', 'fixture notify message');
    const expiresAtIso = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const mintResult = rll.mintRoleLifecycleAction(proj, notifyActionId, 'role-notify', 'claude-native', repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, RB_ROLE, notifyPayload, expiresAtIso);
    assert.strictEqual(mintResult.ok, true, 'RB6 setup: role-notify action must mint successfully: ' + JSON.stringify(mintResult));

    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb6-session');
    // CORRECTED assertion (was: assert.notStrictEqual(r.exit, 0, ...) -- see
    // the header comment above): a same-role, non-Agent-mapped pending
    // action (role-notify) must make this an unrelated, ordinary ad-hoc
    // Agent() dispatch -- NON-OWNING, exactly like RB9/RB10a's own shape.
    assert.strictEqual(r.exit, 0, 'RB6 (Part C, corrected): an unrelated ad-hoc Agent() dispatch must proceed even while a same-role PENDING role-notify action exists -- its own operation is SendMessage, not Agent, so it must never make this call "owning" at all: ' + JSON.stringify(r));
    assert.strictEqual((r.stdout || '').trim(), '', 'RB6 (Part C, corrected): non-owning must produce EMPTY stdout -- no decision of any kind, mirroring RB9/RB10a: ' + JSON.stringify(r));

    // Discriminates a genuine non-owning pass from a VACUOUS one (see RB5's
    // own comment for the same rationale, inverted): no reservation claim
    // may ever exist for the role-notify action either way.
    const claimPath = rll.roleSpawnExecutionClaimPathFor(proj, notifyActionId);
    assert.strictEqual(fs.existsSync(claimPath), false, 'RB6: no reservation claim may ever exist for the role-notify action: ' + claimPath);

    console.log('RB6 (Part C, corrected) a same-role PENDING action of a non-Agent operation kind never makes an unrelated ad-hoc Agent() dispatch "owning" (non-owning pass-through, regression-proves Fix 3 second half): PASS');
  } finally {
    cleanup(proj);
  }
}

// RB7: an expired main-orchestrator binding must DENY reservation -- fresh
// revalidation, never trusting a stale/expired authority snapshot, mirrors
// validateAndConsumeExecutionClaim's own "re-validate expiry against the
// CURRENT... never merely the claim's own stored expiry" discipline.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb7-wave');
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb7-session' };
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    primeClaudeId01TraceForItem5(proj, 'context-provider', 'rb7-session', 'rb7-capability-primary');
    // A binding minted with a short (3s) TTL -- long enough that the ensure
    // CLI subprocess spawn below (which itself independently re-validates
    // the binding has >=1000ms remaining, computeActionTtlSeconds's own
    // 'binding-remaining-lifetime-insufficient' guard) does not race the
    // expiry, but short enough to busy-wait past deterministically. The
    // deadline is computed from the binding's OWN creation instant, not a
    // fixed post-setup sleep -- robust regardless of how long the setup
    // subprocess spawns below actually take.
    const bindingResult = rll.createMainOrchestratorBinding(proj, identity, worktreeId, planResult.planDigest, 3);
    const bindingCreatedAtMs = Date.now();
    const argvDigest = crypto.createHash('sha256').update('ensure:' + RB_ROLE).digest('hex');
    const grantResult = rll.mintLifecycleCommandGrant(proj, bindingResult.binding, argvDigest, RB_ROLE, 'ensure', 'main-orchestrator', 'orchestrator', 'normal', null);
    const ensureResult = spawnSync('node', [IMPL_RLL, 'ensure', '--project-root', proj, '--role', RB_ROLE, '--lifecycle-binding', grantResult.grantId], { env: process.env, encoding: 'utf8' });
    assert.strictEqual(ensureResult.status, 0, 'RB7 setup: ensure CLI must succeed: ' + ensureResult.stdout + ensureResult.stderr);
    const genResult = rll.resolveSessionGeneration(proj, identity);
    const repoDescriptor = { repoId: rll.computeRepoId(proj) };
    const teamEnsureState = rll.readTeamEnsureState(repoDescriptor, genResult.generationId, worktreeId, planResult.planDigest);
    rll.registerTeamEnsureSuccess(repoDescriptor, genResult.generationId, worktreeId, planResult.planDigest, teamEnsureState.record.pending_action_id);

    // Busy-wait until DEFINITELY past the binding's 3-second expiry,
    // measured from its own creation instant (registry operations are pure
    // local fs syscalls per this file's own withRegistryLock precedent --
    // no async wait needed elsewhere in this suite, but binding expiry
    // genuinely needs real wall-clock time here).
    const deadline = bindingCreatedAtMs + 3300;
    while (Date.now() < deadline) { /* busy-wait past the 3s binding TTL */ }

    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb7-session');
    assertPreToolUseDeny(r, 'RB7: reservation must be DENIED once the referenced main-orchestrator binding has expired, even though the role-spawn action and team-ensure state were both genuinely valid at mint time');

    // Discriminates a genuine denial from a VACUOUS pass (see RB5's own
    // comment for the same rationale): no reservation claim may exist for
    // this action once its authorizing binding has expired.
    const bindingStateAfter = rll.readRoleBindingState(proj, worktreeId, planResult.planDigest, rll.roleProfileDigestFor(RB_ROLE), genResult.generationId, RB_ROLE);
    const claimPath = rll.roleSpawnExecutionClaimPathFor(proj, bindingStateAfter.record.pending_action_id);
    assert.strictEqual(fs.existsSync(claimPath), false, 'RB7: no reservation claim may exist at all once the authorizing binding has expired: ' + claimPath);

    console.log('RB7 expired main-orchestrator binding denies reservation (fresh revalidation, never trusting stale authority), with no claim minted: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB8 (arch-testing correction, 2026-08-08): unlike mintSupervisorExecutionClaim
// (its sibling, hard-gated behind isFakeExecutorCapability() -- "proof that
// the (fake, until WP4) top-level spawn-gate admitted this exact action for
// execution", runtime-role-lifecycle.cjs:1821-1839), mintRoleSpawnExecutionClaim
// must NEVER be gated behind that test-only capability. The whole point of
// this HOLD is making Agent-tool spawning genuinely, unconditionally
// reserve/commit-gated in real production, not a second dormant scaffold
// awaiting a WP4 that never comes for THIS surface. This test proves the
// reservation succeeds even with RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_
// CAPABILITY entirely ABSENT from the hook's own environment -- mint must
// fire for real on every genuine PreToolUse(Agent) call, never sit behind a
// flag. (Team-ensure settlement in the fixture setup below still legitimately
// needs the capability -- that is a SEPARATE, pre-existing, correctly-gated
// mechanism, per arch-testing's own confirmation; only the reservation call
// itself is exercised env-stripped here.)
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb8-wave');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb8-session');
    // M7 Correction (Fix 1): see RB1's own comment for why prompt must match.
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixture.bootstrapMessage };

    const envWithoutExecutorCapability = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' });
    delete envWithoutExecutorCapability.RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY;

    const r = runHookWithExplicitEnv(
      {
        tool_name: 'Agent',
        tool_input: toolInput,
        session_id: 'rb8-session',
        agent_type: '',
        agent_id: '',
      },
      envWithoutExecutorCapability
    );
    assert.strictEqual(r.exit, 0, 'RB8: reservation must succeed even with RUNTIME_ROLE_LIFECYCLE_FAKE_EXECUTOR_CAPABILITY entirely absent from the hook\'s own environment -- mint must never be gated behind the test-only executor capability flag, unlike its SupervisorExecutionClaim sibling: ' + JSON.stringify(r));
    const body = parseHookJSON(r.stdout, 'RB8');
    assert.strictEqual(body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision, 'allow', 'RB8: must genuinely allow: ' + JSON.stringify(body));

    const actionRead = rll.findActionAcrossRepos(fixture.roleSpawnActionId);
    const expectedDigest = proposedToolInputDigest(toolInput);
    const consumeResult = rll.validateAndConsumeRoleSpawnExecutionClaim(fixture.repoDescriptor, actionRead.action, expectedDigest, proj);
    assert.strictEqual(consumeResult.ok, true, 'RB8: the reservation minted without the executor capability flag must still be genuinely valid and round-trip-consumable: ' + JSON.stringify(consumeResult));

    console.log('RB8 reservation mint fires unconditionally, never gated behind the test-only executor capability flag (unlike SupervisorExecutionClaim): PASS');
  } finally {
    cleanup(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Fourth HOLD (team-lead direct, arch-platform's gap + user's precise
// answer, 2026-08-08): the owning/non-owning boundary. RB1-RB8 above never
// covered the single most common real case -- a main-orchestrator Agent()
// call for which NO adapter-managed role-spawn action exists at all (every
// ad-hoc specialist/architect dispatch throughout this entire session
// looks exactly like this). RB9-RB13 close that gap.
//
// NOTE on RB1-RB8's own session-id fixture convention (flagged to and
// approved by team-lead, 2026-08-08): RB1-RB8 originally minted each
// fixture action under one session-id string (e.g. 'rb1-session') and then
// fired the Agent() call under a DIFFERENT one (e.g. 'rb1-session-caller')
// -- an arbitrary log-distinguishing habit, not intentional design,
// predating item 5's explicit session-correlation requirement below.
// team-lead approved a narrowly-scoped fix: each RBn's two session-id
// literals were unified to the SAME string (mint call and Agent() call now
// both use e.g. 'rb1-session') -- RB1, RB2 (both calls), RB3, RB4, RB5,
// RB6, RB7, RB8 all received exactly this one-line-per-occurrence change,
// nothing else about their assertions/logic was touched. RB9 onward were
// already self-consistent by design (deliberately DIFFERENT strings only
// in RB12a, where session mismatch is the thing under test).
// ════════════════════════════════════════════════════════════════════════

// RB9 (non-owning: no adapter-managed action at all): the hook must be
// non-owning -- no decision of any kind (empty stdout, mirroring
// context-provider-gate.js's own established "not applicable" convention
// of a bare process.exit(0) with zero stdout writes) -- and genuinely zero
// registry side effects, so the ad-hoc Agent() call proceeds entirely
// under whatever OTHER hooks already apply (agent-spawn-validator.js
// etc.). This mechanism must never acquire lifecycle binding/READY/reuse/
// grant/authority for a call it doesn't own.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb9-wave');
    // Deliberately never call ensure/mint anything for this role -- a
    // genuinely ad-hoc dispatch, exactly like this session's own
    // specialist spawns.
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb9-session');

    assert.strictEqual(r.exit, 0, 'RB9: an ad-hoc Agent() call with no matching lifecycle action at all must be allowed to proceed -- non-owning, never denied: ' + JSON.stringify(r));
    assert.strictEqual((r.stdout || '').trim(), '', 'RB9: a non-owning hook must produce EMPTY stdout -- no hookSpecificOutput, no decision of any kind -- so the ad-hoc call proceeds entirely under whatever OTHER hooks (e.g. agent-spawn-validator.js) already govern it: ' + JSON.stringify(r));

    // Genuinely zero registry side effects: this ad-hoc call must never
    // mint a session generation (a pure lookup, peekSessionGeneration,
    // never resolveSessionGeneration) merely because it was inspected and
    // found non-owning.
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb9-session' };
    const genPeek = rll.peekSessionGeneration(proj, identity);
    assert.strictEqual(genPeek.ok, false, 'RB9: a non-owning hook call must never mint a session generation as a side effect -- none should exist for a session that only ever made an ad-hoc, non-lifecycle Agent() call: ' + JSON.stringify(genPeek));

    console.log('RB9 (non-owning) ad-hoc Agent() call with no matching action at all produces zero decision and zero lifecycle side effects: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB10: explicit owning-vs-non-owning contrast, confirming RB1's existing
// "exact matching action -> reservation succeeds" already satisfies the
// user's "owning" framing (a decisive, non-empty stdout) as the exact
// OPPOSITE shape from RB9's "non-owning" framing (empty stdout) -- proven
// side by side against otherwise-IDENTICAL setup, varying only whether the
// action exists.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb10-wave');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };

    // (a) non-owning leg: no action minted at all.
    const rNonOwning = runMainOrchestratorAgentCall(toolInput, proj, 'rb10-nonowning-session');
    assert.strictEqual((rNonOwning.stdout || '').trim(), '', 'RB10a: with no matching action, stdout must be EMPTY (non-owning): ' + JSON.stringify(rNonOwning));

    // (b) owning leg: an eligible action exists for the SAME role, in the
    // SAME project (a genuine same-role, same-project contrast, not two
    // unrelated fixtures). Same session string used for mint and call.
    // M7 Correction (Fix 1): a SEPARATE toolInput carrying the correct
    // prompt (see RB1's own comment) -- the non-owning leg's toolInput above
    // deliberately has no prompt at all, since Fix 1's check only applies
    // once an owning candidate is actually found.
    const fixtureB = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb10-owning-session');
    const toolInputOwning = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixtureB.bootstrapMessage };
    const rOwning = runMainOrchestratorAgentCall(toolInputOwning, proj, 'rb10-owning-session');
    assert.notStrictEqual((rOwning.stdout || '').trim(), '', 'RB10b: with a genuinely matching action, stdout must be NON-EMPTY (owning, a real decision) -- the exact opposite shape from RB10a: ' + JSON.stringify(rOwning));
    const body = parseHookJSON(rOwning.stdout, 'RB10b');
    assert.strictEqual(body.hookSpecificOutput && body.hookSpecificOutput.permissionDecision, 'allow', 'RB10b: the owning leg must genuinely allow: ' + JSON.stringify(body));

    console.log('RB10 owning (decisive, non-empty stdout) vs non-owning (empty stdout) are genuinely, oppositely distinguishable for otherwise-identical setups: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB11: the precise "same role, wrong payload" tightening of RB3 --
// subagent_type correctly identifies WHICH action is owned (so this is
// genuinely an OWNING-scope call, never non-owning), but `name` does not
// match that action's own teammate_name. Must produce an EXPLICIT deny
// decision (non-empty stdout, decision:'block') -- never silently fall
// back to RB9/RB10a's empty-stdout non-owning shape. A mismatch inside an
// owning scope is fundamentally different from "this mechanism doesn't
// apply at all".
//
// NOTE (flagged explicitly, mirrors the session-id note above): RB3
// constructs its mismatch via a DIFFERENT subagent_type
// ('toolkit-specialist', which has no action of its own) rather than a
// matching subagent_type with a different name. Under this dispatch's
// newly-precise framing, RB3's specific scenario reads structurally as
// NON-OWNING (no action exists for 'toolkit-specialist' at all), not
// owning-scope mismatch -- RB3 currently asserts denial (r.exit !== 0),
// which this file's design now says should instead be non-owning (empty
// stdout, exit 0) once correctly implemented. Left RB3 completely
// unmodified per this dispatch's explicit "stays as-is" instruction;
// flagged in my report rather than silently resolved either direction.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb11-wave');
    mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb11-session');
    const mismatchedToolInput = { subagent_type: RB_ROLE, name: 'some-other-teammate-name' };

    const r = runMainOrchestratorAgentCall(mismatchedToolInput, proj, 'rb11-session');
    assertPreToolUseDeny(r, 'RB11: an owning-scope mismatch (correct role, wrong payload) must produce an explicit deny decision -- never the empty-stdout non-owning shape');

    console.log('RB11 owning-scope tool_input mismatch (same role, wrong payload) produces an explicit deny decision, never a silent non-owning pass-through: PASS');
  } finally {
    cleanup(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// M6+M7 RESIDUAL AUTHORITY CORRECTION (2026-08-11, dispatch arch-testing
// arch-testing-20260811T162225Z), Section A / item 5: "Dos spawn-actions
// distintos con mismo agent_id no completan CLAUDE-ID-01; con IDs diferentes
// sí. Un evento de B nunca cuenta dentro de la secuencia de A." Section A's
// own explicit instruction: "Reutiliza la correlación existente de
// spawn-action/reservation/ClaudeOneShotBinding; no uses prose, nombres o
// selección por rol" -- this test therefore grounds "peer A" and "peer B" in
// two GENUINELY DISTINCT, real coordination/role-lifecycle-action/v1 records
// (real spawn-actions, minted via mintRoleLifecycleAction, this file's own
// RB6 fixture technique -- never merely two differently-named string
// literals), rather than reproducing case 3/case 7's own bare-hook-event
// framing (runtime-role-lifecycle-registry.test.js) a second time.
//
// Confirmed by direct read: the CLAUDE-ID-01 raw-trace/attestation record
// path (claudeId01RecordPathFor) is keyed EXCLUSIVELY by
// {sessionGenerationId, worktreeId, planDigest, role, agentDigest} -- it has
// NO action_id/spawn-action dimension anywhere. So two genuinely DISTINCT
// spawn-actions sharing the identical {session, worktree, plan, role,
// agent_id} tuple structurally collide on the exact SAME record: once peer A
// (spawn-action A) completes a full trace, peer B (spawn-action B, a
// completely independent, later real action) needs only ONE bare
// SubagentStart of its own to be treated as ALREADY CLAUDE-ID-01-proof-complete
// -- inheriting A's attestation wholesale, never establishing (or being asked
// for) any evidence of its own. This is the precise, worse-than-"never
// counts" failure mode: an event of B does not merely fail to count toward
// A's sequence -- B needs no events at all once A has completed.
// ════════════════════════════════════════════════════════════════════════

{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'item5-wave');
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'item5-session' };
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    assert.strictEqual(planResult.ok, true, 'item5 fixture: PLAN must be discoverable: ' + JSON.stringify(planResult));
    const repoId = rll.computeRepoId(proj);
    const genResult = rll.resolveSessionGeneration(proj, identity);
    assert.strictEqual(genResult.ok, true, 'item5 fixture: session generation must resolve: ' + JSON.stringify(genResult));
    const pair = rll.resolvePolicyPair(proj);
    assert.strictEqual(pair.ok, true, 'item5 fixture: policy pair must resolve: ' + JSON.stringify(pair));
    const policyDigest = rc.sha256String(rc.canonicalJSONStringify(pair.routing));
    const expiresAtIso = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Two GENUINELY DISTINCT real spawn-actions (role-spawn/claude-native),
    // for the SAME role -- minted directly via mintRoleLifecycleAction
    // (mirrors this file's own RB6 fixture technique exactly), bypassing the
    // role-BINDING single-pending-action constraint since this test's own
    // subject is the CLAUDE-ID-01 attestation layer specifically, never the
    // role-binding state machine (which RB1-RB13 above already cover).
    const payloadA = rll.buildRoleSpawnPayload('item5-team-a', RB_ROLE, RB_ROLE, 'item5-fixture-artifact-ref-a', 'item5 fixture bootstrap message A');
    const actionA = rll.mintRoleLifecycleAction(proj, rll.generateActionId(), 'role-spawn', 'claude-native', repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, RB_ROLE, payloadA, expiresAtIso);
    assert.strictEqual(actionA.ok, true, 'item5 fixture: spawn-action A must mint: ' + JSON.stringify(actionA));
    const payloadB = rll.buildRoleSpawnPayload('item5-team-b', RB_ROLE, RB_ROLE, 'item5-fixture-artifact-ref-b', 'item5 fixture bootstrap message B');
    const actionB = rll.mintRoleLifecycleAction(proj, rll.generateActionId(), 'role-spawn', 'claude-native', repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, RB_ROLE, payloadB, expiresAtIso);
    assert.strictEqual(actionB.ok, true, 'item5 fixture: spawn-action B must mint: ' + JSON.stringify(actionB));
    assert.notStrictEqual(actionA.actionId, actionB.actionId, 'item5 fixture sanity: the two spawn-actions must be genuinely distinct records');

    const sharedAgentId = 'item5-shared-agent';
    const sharedSessionId = 'item5-session';

    // Peer A supplies the full sequence on spawn-action A.
    recordClaudeId01PrimarySequence(
      proj, RB_ROLE, sharedSessionId, sharedAgentId, actionA.actionId, 'item5-same-id-primary',
    );
    const proofAfterA = rll.checkClaudeId01ProofComplete(proj, sharedSessionId, worktreeId, planResult.planDigest, RB_ROLE, sharedAgentId);
    assert.strictEqual(proofAfterA.ok, false, 'a full primary sequence alone is insufficient without a distinct peer: ' + JSON.stringify(proofAfterA));

    // Peer B: a SECOND, genuinely DISTINCT spawn-action (action B, minted
    // above, a completely independent real record) -- correlated with a
    // SINGLE fresh SubagentStart under the IDENTICAL agent_id/session/role,
    // contributing ZERO PreToolUse events of its own.
    rll.recordClaudeId01SubagentStartObservation(proj, {
      sessionId: sharedSessionId,
      agentId: sharedAgentId,
      agentType: RB_ROLE,
      actionId: actionB.actionId,
    });
    const proofForB = rll.checkClaudeId01ProofComplete(proj, sharedSessionId, worktreeId, planResult.planDigest, RB_ROLE, sharedAgentId);
    assert.notStrictEqual(
      proofForB.ok, true,
      'a second action presenting the SAME agent_id is not the distinct peer B required to establish runtime capability: ' + JSON.stringify(proofForB)
    );
    console.log('ITEM5-DISTINCT-SPAWN-ACTIONS-SAME-AGENT-ID cannot satisfy the distinct-peer capability requirement: PASS');
  } finally {
    cleanup(proj);
  }
}

// Positive contrast (mirrors case 7's own "different agent_id -> genuinely
// independent" framing, but grounded in two real, distinct spawn-actions):
// two genuinely DIFFERENT spawn-actions, two genuinely DIFFERENT agent_ids,
// each independently completing its OWN full CLAUDE-ID-01 trace. This is
// NOT expected to be RED -- it is the "con IDs diferentes sí" half of item 5,
// confirming the fixture technique itself (real, distinct spawn-actions) is
// not what breaks the different-agent_id case.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'item5-diffid-wave');
    const identity = { ok: true, provider: 'claude-hook', runtime_session_key: 'item5-diffid-session' };
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    const repoId = rll.computeRepoId(proj);
    const genResult = rll.resolveSessionGeneration(proj, identity);
    const pair = rll.resolvePolicyPair(proj);
    const policyDigest = rc.sha256String(rc.canonicalJSONStringify(pair.routing));
    const expiresAtIso = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    const payloadA = rll.buildRoleSpawnPayload('item5-diffid-team-a', RB_ROLE, RB_ROLE, 'item5-diffid-fixture-artifact-ref-a', 'item5 diffid fixture bootstrap message A');
    const actionA = rll.mintRoleLifecycleAction(proj, rll.generateActionId(), 'role-spawn', 'claude-native', repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, RB_ROLE, payloadA, expiresAtIso);
    assert.strictEqual(actionA.ok, true, JSON.stringify(actionA));
    const payloadB = rll.buildRoleSpawnPayload('item5-diffid-team-b', RB_ROLE, RB_ROLE, 'item5-diffid-fixture-artifact-ref-b', 'item5 diffid fixture bootstrap message B');
    const actionB = rll.mintRoleLifecycleAction(proj, rll.generateActionId(), 'role-spawn', 'claude-native', repoId, worktreeId, planResult.planDigest, policyDigest, genResult.generationId, RB_ROLE, payloadB, expiresAtIso);
    assert.strictEqual(actionB.ok, true, JSON.stringify(actionB));

    const sharedSessionId = 'item5-diffid-session';
    recordClaudeId01PrimarySequence(
      proj, RB_ROLE, sharedSessionId, 'item5-diffid-agent-a', actionA.actionId, 'item5-diff-primary',
    );
    const proofA = rll.checkClaudeId01ProofComplete(proj, sharedSessionId, worktreeId, planResult.planDigest, RB_ROLE, 'item5-diffid-agent-a');
    assert.strictEqual(proofA.ok, false, 'the primary sequence alone remains insufficient: ' + JSON.stringify(proofA));

    rll.recordClaudeId01SubagentStartObservation(proj, {
      sessionId: sharedSessionId,
      agentId: 'item5-diffid-agent-b',
      agentType: RB_ROLE,
      actionId: actionB.actionId,
    });
    const proofB = rll.checkClaudeId01ProofComplete(proj, sharedSessionId, worktreeId, planResult.planDigest, RB_ROLE, 'item5-diffid-agent-b');
    assert.strictEqual(proofB.ok, true, 'two distinct actions and distinct observed agent IDs establish the generation capability: ' + JSON.stringify(proofB));

    // Peer A's own proof is still independently intact after peer B's -- a
    // different agent_id must never disturb an already-complete sibling.
    const proofAAfter = rll.checkClaudeId01ProofComplete(proj, sharedSessionId, worktreeId, planResult.planDigest, RB_ROLE, 'item5-diffid-agent-a');
    assert.strictEqual(proofAAfter.ok, true, 'the established runtime capability is generation-scoped, not revoked by observing peer B: ' + JSON.stringify(proofAAfter));
    console.log('ITEM5-DISTINCT-SPAWN-ACTIONS-DIFFERENT-AGENT-ID establishes the generation capability: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB12: correlation is never by role alone -- session, worktree, PLAN,
// binding, and action must ALL match (tightens A3's session-scoping
// discipline consistently into B1). Two sub-cases: (a) a DIFFERENT session
// than the one that minted the action, and (b) a DIFFERENT PLAN (changed
// after mint), each otherwise-matching (same role, same payload, and --
// for (b) -- same session), must both be DENIED, never silently matched by
// role alone.
{
  // (a) different session_id than the one that minted the action --
  // session mismatch is deliberately the ONLY varying input here.
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb12a-wave');
    mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb12a-minting-session');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };

    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb12a-DIFFERENT-session');
    assertPreToolUseDeny(r, 'RB12a: a DIFFERENT session_id than the one that minted the action must be DENIED, even with an otherwise-identical, correctly-matching role/payload -- correlation is never by role alone');

    // Discriminates a genuine denial from a VACUOUS pass (see RB5's own
    // comment for the same rationale -- the hook file not existing at all
    // ALSO produces a non-zero exit, which would otherwise trivially
    // satisfy the assertion above regardless of whether session
    // correlation is implemented at all): no reservation claim may exist
    // for this action either way.
    const worktreeIdA = rll.computeWorktreeId(proj);
    const planResultA = rll.discoverPlan(proj);
    const mintIdentityA = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb12a-minting-session' };
    const genResultA = rll.resolveSessionGeneration(proj, mintIdentityA);
    const bindingStateAfterA = rll.readRoleBindingState(proj, worktreeIdA, planResultA.planDigest, rll.roleProfileDigestFor(RB_ROLE), genResultA.generationId, RB_ROLE);
    const claimPathA = rll.roleSpawnExecutionClaimPathFor(proj, bindingStateAfterA.record.pending_action_id);
    assert.strictEqual(fs.existsSync(claimPathA), false, 'RB12a: no reservation claim may exist at all when the calling session differs from the minting session: ' + claimPathA);

    console.log('RB12a a different session_id than the one that minted the action denies reservation, with no claim minted: PASS');
  } finally {
    cleanup(proj);
  }
}
{
  // (b) different PLAN (PLAN.md content -- hence plan_digest -- changed
  // between mint time and the reservation attempt). Same session string
  // for mint and call -- PLAN mismatch is deliberately the ONLY varying
  // input here.
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb12b-wave');
    mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb12b-session');
    // Mutate PLAN.md's content in place -- a genuinely different
    // plan_digest for the SAME wave slug/path, simulating a PLAN change
    // after the action was minted against the OLD content.
    const planPath = path.join(proj, '.planning', 'wave-rb12b-wave', 'PLAN.md');
    fs.writeFileSync(planPath, '# a DIFFERENT fixture plan -- content changed after mint (rb12b)\n');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };

    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb12b-session');
    assertPreToolUseDeny(r, 'RB12b: a changed PLAN (different plan_digest) than the one the action was minted against must be DENIED, even with an otherwise-matching role/payload/session');

    // Discriminates a genuine denial from a VACUOUS pass (see RB5's own
    // comment for the same rationale): no reservation claim may exist for
    // this action either way. Looked up via the OLD (mint-time) plan
    // digest, since the action itself is keyed by action_id alone, not by
    // plan_digest -- the claim path does not change just because PLAN.md's
    // current content did.
    const worktreeIdB = rll.computeWorktreeId(proj);
    const mintIdentityB = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb12b-session' };
    const genResultB = rll.resolveSessionGeneration(proj, mintIdentityB);
    // Re-derive the ORIGINAL plan_digest independently of the now-mutated
    // PLAN.md on disk -- profileDigest/generationId/role are enough to find
    // the role-binding's own recorded pending_action_id regardless of which
    // plan_digest the binding itself was scoped under.
    const bindingsDirB = path.join(rll.registryRepoDir(proj), 'role-bindings');
    let pendingActionIdB = null;
    for (const entry of fs.readdirSync(bindingsDirB, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const rec = JSON.parse(fs.readFileSync(path.join(bindingsDirB, entry.name), 'utf8'));
      if (rec.role === RB_ROLE && rec.session_generation_id === genResultB.generationId && rec.pending_action_id) {
        pendingActionIdB = rec.pending_action_id;
        break;
      }
    }
    assert.ok(pendingActionIdB, 'RB12b setup sanity: must find the minted role-binding\'s own pending_action_id: ' + bindingsDirB);
    const claimPathB = rll.roleSpawnExecutionClaimPathFor(proj, pendingActionIdB);
    assert.strictEqual(fs.existsSync(claimPathB), false, 'RB12b: no reservation claim may exist at all when the current PLAN no longer matches the one the action was minted against: ' + claimPathB);

    console.log('RB12b a changed PLAN (different plan_digest) than the one the action was minted against denies reservation, with no claim minted: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB13 (LOW-MEDIUM CONFIDENCE, flagged explicitly): a claude-agent-driven
// ActivationAction (PLAN.md's own separately-frozen one-shot
// mediated-consultation protocol, carrying a core-generated
// native_spawn_action_id, governed entirely by runtime-consultation.cjs's
// own commit-then-activate machinery -- NOT runtime-role-lifecycle.cjs's
// action registry at all; ACTION_KIND_ENUM has no 'claude-agent' member,
// and LIFECYCLE_INELIGIBLE_DRIVERS explicitly excludes claude-agent from
// ever having an ensure()-mintable persistent role-lifecycle-action) must
// never be misclassified by this gate -- neither treated as an ordinary
// role-spawn reservation target (it structurally never is one) nor
// incorrectly blocked as if it were a malformed/mismatched lifecycle
// attempt. I do NOT know the exact real tool_input shape Claude's own
// Agent-tool invocation carries for a genuine claude-agent activation (the
// mechanism is documented in PLAN.md prose -- ~L612-614 -- but I found no
// implementation of it in any hook file I've read), so this proves the
// NARROWER, still-meaningful claim I AM confident about: an unrecognized/
// extra tool_input field (standing in for whatever a real ActivationAction
// payload might carry) must never change this gate's non-owning
// classification for a role with no pending role-spawn action -- extra
// fields are never a backdoor into owning-scope treatment.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb13-wave');
    // No role-spawn action minted for this role at all -- mirrors a
    // genuine claude-agent one-shot dispatch, which never mints one.
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, native_spawn_action_id: crypto.randomBytes(16).toString('hex') };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb13-session');

    assert.strictEqual(r.exit, 0, 'RB13: an extra/unrecognized tool_input field must never turn a no-action role into a blocked one: ' + JSON.stringify(r));
    assert.strictEqual((r.stdout || '').trim(), '', 'RB13: a claude-agent-shaped (or any other unrecognized-extra-field) tool_input for a role with no pending role-spawn action must still be classified non-owning (empty stdout) -- extra fields are never a backdoor into owning-scope reservation/denial logic: ' + JSON.stringify(r));

    console.log('RB13 (LOW-MEDIUM CONFIDENCE, see comment) an unrecognized extra tool_input field never changes non-owning classification for a role with no pending action: PASS');
  } finally {
    cleanup(proj);
  }
}

// ════════════════════════════════════════════════════════════════════════
// M7 Correction pass (m7-correction-spec.md §4): Fix 1 (prompt validation),
// Fix 2 (full-tool_input digest), Fix 3 first half (multiplicity/ambiguity
// -- second half is RB6, corrected above), Fix 4 (missing session_id while
// an owning candidate exists must deny, never silently bypass).
// ════════════════════════════════════════════════════════════════════════

// RB-PROMPT-MISMATCH (Fix 1): tool_input.prompt not matching the reserved
// action's own accredited bootstrap_message must deny with the new, exact
// reason -- pre-fix nothing checks prompt at all (only subagent_type/name are
// correlated), so a call is allowed regardless of what prompt carries.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb-promptmismatch-wave');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb-promptmismatch-session');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: 'this is NOT the accredited bootstrap message' };
    assert.notStrictEqual(toolInput.prompt, fixture.bootstrapMessage, 'RB-PROMPT-MISMATCH setup sanity: the fixture prompt must genuinely differ from the real bootstrap_message');

    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb-promptmismatch-session');
    const body = assertPreToolUseDeny(r, 'RB-PROMPT-MISMATCH: a prompt not matching the reserved action\'s own bootstrap_message must deny');
    assert.ok(body.hookSpecificOutput.permissionDecisionReason.toLowerCase().includes('prompt'), 'RB-PROMPT-MISMATCH: reason must reference the prompt mismatch specifically: ' + JSON.stringify(body));

    const claimPath = rll.roleSpawnExecutionClaimPathFor(proj, fixture.roleSpawnActionId);
    assert.strictEqual(fs.existsSync(claimPath), false, 'RB-PROMPT-MISMATCH: no reservation claim may exist when the prompt does not match: ' + claimPath);
    console.log('RB-PROMPT-MISMATCH tool_input.prompt not matching the action\'s own bootstrap_message denies with the new exact reason: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB-DIGEST-SCOPE (Fix 2, RESOLVED 2026-08-09 -- see m7-correction-spec.md
// "Fix 2 -- RESOLVED"): the accredited claim's tool_input_digest is
// INTENTIONALLY scoped to role identity ({subagent_type, name}) only, never
// widened to cover the full tool_input. Widening it is structurally
// incompatible with subagent-start-context-bundle.js's own B2 confirmation:
// SubagentStart never receives tool_input at all (confirmed empirically --
// zero occurrences across every fixture in that file), so B2 cannot
// reconstruct any digest wider than the two fields it already knows
// (agentType alone supplies both subagent_type and name). This test proves
// the scoping is deliberate, not an oversight this file's own original
// header comment once flagged LOW CONFIDENCE: two otherwise-identical
// reservations differing ONLY in an extra field (model) must produce the
// IDENTICAL tool_input_digest. Divergent tool_input coverage where it
// actually matters -- a caller-supplied prompt not matching the action's
// own accredited bootstrap_message -- is RB-PROMPT-MISMATCH's job, above;
// that check is the real, sufficient defense against a tampered/mismatched
// spawn request, verified independently of this digest.
{
  const projA = makeGitProject();
  const projB = makeGitProject();
  try {
    writePlanFixture(projA, 'rb-digest-a-wave');
    writePlanFixture(projB, 'rb-digest-b-wave');
    const fixtureA = mintFullyEligibleRoleSpawnAction(projA, RB_ROLE, 'rb-digest-a-session');
    const fixtureB = mintFullyEligibleRoleSpawnAction(projB, RB_ROLE, 'rb-digest-b-session');
    const toolInputA = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixtureA.bootstrapMessage, model: 'model-a' };
    const toolInputB = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixtureB.bootstrapMessage, model: 'model-b' };

    const rA = runMainOrchestratorAgentCall(toolInputA, projA, 'rb-digest-a-session');
    assert.strictEqual(rA.exit, 0, 'RB-DIGEST-SCOPE setup A must succeed: ' + JSON.stringify(rA));
    const rB = runMainOrchestratorAgentCall(toolInputB, projB, 'rb-digest-b-session');
    assert.strictEqual(rB.exit, 0, 'RB-DIGEST-SCOPE setup B must succeed: ' + JSON.stringify(rB));

    const claimA = JSON.parse(fs.readFileSync(rll.roleSpawnExecutionClaimPathFor(projA, fixtureA.roleSpawnActionId), 'utf8'));
    const claimB = JSON.parse(fs.readFileSync(rll.roleSpawnExecutionClaimPathFor(projB, fixtureB.roleSpawnActionId), 'utf8'));
    assert.strictEqual(
      claimA.tool_input_digest, claimB.tool_input_digest,
      'RB-DIGEST-SCOPE: two reservations whose tool_input differs ONLY in an extra field (model) must produce the IDENTICAL tool_input_digest -- the digest is intentionally scoped to role identity ({subagent_type,name}) only, never widened, since SubagentStart/B2 cannot reconstruct anything wider (it never receives tool_input): ' + JSON.stringify({ a: claimA.tool_input_digest, b: claimB.tool_input_digest })
    );
    console.log('RB-DIGEST-SCOPE tool_input_digest is intentionally scoped to role identity, unaffected by extra fields like model -- RB-PROMPT-MISMATCH covers divergent tool_input where it actually matters: PASS');
  } finally {
    cleanup(projA);
    cleanup(projB);
  }
}

// RB-AMBIGUOUS (Fix 3, first half): two simultaneously-live candidates for
// the SAME role (candidate A: role-binding-backed, loop 1; candidate B: an
// independent role-spawn action with NO role-binding at all, loop 2) must
// deny as ambiguous, never silently pick one. Deterministic regardless of
// directory-iteration order: findOwningRoleLifecycleCandidate's loop 1
// unconditionally takes priority over loop 2 today whenever loop 1 finds
// ANY match -- candidate A is the ONLY loop-1 entry here, so pre-fix it is
// always selected first (via runMainOrchestratorAgentCall's own session,
// which genuinely correlates to A) and B is never even inspected, letting
// the call succeed despite a genuine second candidate for the role existing.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb-ambiguous-wave');
    const fixtureA = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb-ambiguous-session');

    const identityB = { ok: true, provider: 'claude-hook', runtime_session_key: 'rb-ambiguous-session-b' };
    const worktreeId = rll.computeWorktreeId(proj);
    const planResult = rll.discoverPlan(proj);
    const bindingResultB = rll.createMainOrchestratorBinding(proj, identityB, worktreeId, planResult.planDigest, 120);
    assert.strictEqual(bindingResultB.ok, true, 'RB-AMBIGUOUS setup: candidate B binding must mint: ' + JSON.stringify(bindingResultB));
    const genResultB = rll.resolveSessionGeneration(proj, identityB);
    const repoId = rll.computeRepoId(proj);
    const pair = rll.resolvePolicyPair(proj);
    assert.strictEqual(pair.ok, true, 'RB-AMBIGUOUS setup: policy pair must resolve: ' + JSON.stringify(pair));
    const policyDigest = rc.sha256String(rc.canonicalJSONStringify(pair.routing));
    const actionIdB = rll.generateActionId();
    const payloadB = rll.buildRoleSpawnPayload('team-b', RB_ROLE, RB_ROLE, 'fixture-artifact-ref-b', 'fixture bootstrap message B');
    const expiresAtIsoB = new Date(Date.now() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const mintResultB = rll.mintRoleLifecycleAction(proj, actionIdB, 'role-spawn', 'claude-native', repoId, worktreeId, planResult.planDigest, policyDigest, genResultB.generationId, RB_ROLE, payloadB, expiresAtIsoB);
    assert.strictEqual(mintResultB.ok, true, 'RB-AMBIGUOUS setup: candidate B action must mint successfully: ' + JSON.stringify(mintResultB));

    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixtureA.bootstrapMessage };
    const r = runMainOrchestratorAgentCall(toolInput, proj, 'rb-ambiguous-session');
    assertPreToolUseDeny(r, 'RB-AMBIGUOUS: two simultaneously-live candidates for the same role must deny as ambiguous, never silently pick one');

    const claimPathA = rll.roleSpawnExecutionClaimPathFor(proj, fixtureA.roleSpawnActionId);
    const claimPathB = rll.roleSpawnExecutionClaimPathFor(proj, actionIdB);
    assert.strictEqual(fs.existsSync(claimPathA), false, 'RB-AMBIGUOUS: no reservation claim may exist for candidate A when ambiguous: ' + claimPathA);
    assert.strictEqual(fs.existsSync(claimPathB), false, 'RB-AMBIGUOUS: no reservation claim may exist for candidate B when ambiguous: ' + claimPathB);
    console.log('RB-AMBIGUOUS two simultaneously-live candidates for the same role deny as ambiguous, never silently picking one: PASS');
  } finally {
    cleanup(proj);
  }
}

// RB-MISSING-SESSION-OWNING (Fix 4a): a genuinely owning candidate exists
// for this role, but session_id is missing -- must DENY (explicit block),
// never silently pass through as if non-owning. pre-fix the session_id
// presence/shape check runs and exits 0 BEFORE
// findOwningRoleLifecycleCandidate is ever called (~L142-163), so a missing
// session_id always looks identical to "no owning action exists" even when
// one genuinely does.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb-missingsession-owning-wave');
    const fixture = mintFullyEligibleRoleSpawnAction(proj, RB_ROLE, 'rb-missingsession-owning-session');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE, prompt: fixture.bootstrapMessage };
    const r = runHook(
      { tool_name: 'Agent', tool_input: toolInput, agent_type: '', agent_id: '' /* session_id deliberately OMITTED */ },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assertPreToolUseDeny(r, 'RB-MISSING-SESSION-OWNING: a missing session_id while a genuine owning candidate exists must DENY, never silently pass through');
    const claimPath = rll.roleSpawnExecutionClaimPathFor(proj, fixture.roleSpawnActionId);
    assert.strictEqual(fs.existsSync(claimPath), false, 'RB-MISSING-SESSION-OWNING: no reservation claim may exist when session_id is missing: ' + claimPath);
    console.log('RB-MISSING-SESSION-OWNING missing session_id with a genuine owning candidate denies (never a silent bypass): PASS');
  } finally {
    cleanup(proj);
  }
}

// RB-MISSING-SESSION-NONOWNING (positive control for Fix 4, proves it did
// NOT overcorrect): a missing session_id with NO owning candidate at all
// must still pass through non-owning -- mirrors RB13's own "extra/
// unrecognized input never flips non-owning" principle, applied to a
// MISSING session_id too.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'rb-missingsession-nonowning-wave');
    const toolInput = { subagent_type: RB_ROLE, name: RB_ROLE };
    const r = runHook(
      { tool_name: 'Agent', tool_input: toolInput, agent_type: '', agent_id: '' /* session_id deliberately OMITTED */ },
      { CLAUDE_PROJECT_DIR: proj, CLAUDE_WAVE_SLUG: '' }
    );
    assert.strictEqual(r.exit, 0, 'RB-MISSING-SESSION-NONOWNING: a missing session_id with NO owning candidate must still pass through non-owning: ' + JSON.stringify(r));
    assert.strictEqual((r.stdout || '').trim(), '', 'RB-MISSING-SESSION-NONOWNING: non-owning must produce EMPTY stdout: ' + JSON.stringify(r));
    console.log('RB-MISSING-SESSION-NONOWNING missing session_id with no owning candidate still passes through non-owning (Fix 4 did not overcorrect): PASS');
  } finally {
    cleanup(proj);
  }
}

// S16-RS-AUTOSUFFIX-NAMESPACE-SPOOF-01 (M67-RS-HARNESS-SUFFIX-IDENTITY-01):
// the harness's own numeric-suffix namespace ("<canonical-role>-<N>", N>=2)
// is reserved GLOBALLY, exactly like the bare canonical-role namespace
// (GATE RULE 1 above) -- an unrelated, non-owning caller (subagent_type=
// 'verifier') must never be able to pre-claim that exact shape for a role
// it does not own, regardless of whether the suffixed role itself has any
// live owning state. Edge shapes that do NOT match the reserved pattern
// (N<2, a leading zero, non-numeric) must fall through as ordinary
// non-owning passthrough -- proving the regex is precise in both
// directions, not merely permissive.
{
  const proj = makeGitProject();
  try {
    writePlanFixture(proj, 'positive-suffix-namespace-spoof');
    const before = listRegistryFiles(proj);

    // Codex's own primary example: denied, matches the reserved suffix
    // namespace for the real canonical role "toolkit-specialist".
    {
      const r = runMainOrchestratorAgentCall(
        { subagent_type: 'verifier', name: 'toolkit-specialist-2', prompt: 'irrelevant' },
        proj, 'spoof-primary-session',
      );
      const body = assertPreToolUseDeny(r, 'SPOOF-PRIMARY-toolkit-specialist-2');
      assert.ok(/reserved harness numeric-suffix namespace/.test(body.hookSpecificOutput.permissionDecisionReason), 'SPOOF-PRIMARY: must be denied by the NEW suffix-namespace check specifically: ' + JSON.stringify(body));
    }

    // Foreign canonical role's suffix -- proves generality, not hardcoded
    // to toolkit-specialist.
    {
      const r = runMainOrchestratorAgentCall(
        { subagent_type: 'verifier', name: 'arch-platform-2', prompt: 'irrelevant' },
        proj, 'spoof-foreign-session',
      );
      const body = assertPreToolUseDeny(r, 'SPOOF-FOREIGN-PREFIX-arch-platform-2');
      assert.ok(/reserved harness numeric-suffix namespace/.test(body.hookSpecificOutput.permissionDecisionReason), 'SPOOF-FOREIGN-PREFIX: must be denied by the NEW suffix-namespace check: ' + JSON.stringify(body));
    }

    // Huge numeric suffix -- proves the shape-only regex never overflows,
    // mis-parses, or throws on an arbitrarily long digit run, and still
    // denies correctly.
    {
      const r = runMainOrchestratorAgentCall(
        { subagent_type: 'verifier', name: 'toolkit-specialist-99999999999999999999999999999999', prompt: 'irrelevant' },
        proj, 'spoof-huge-session',
      );
      const body = assertPreToolUseDeny(r, 'SPOOF-HUGE-NUMERIC-SUFFIX');
      assert.ok(/reserved harness numeric-suffix namespace/.test(body.hookSpecificOutput.permissionDecisionReason), 'SPOOF-HUGE-NUMERIC-SUFFIX: must be denied: ' + JSON.stringify(body));
    }

    // Non-matching edge shapes: N<2, leading zero, non-numeric -- none of
    // these match the reserved pattern, so none are owning (no root-source
    // action exists for 'verifier' either) -- ordinary non-owning
    // passthrough, zero registry side effects, exactly like any other
    // unrelated custom name.
    for (const badSuffix of ['toolkit-specialist-0', 'toolkit-specialist-1', 'toolkit-specialist-02', 'toolkit-specialist-abc']) {
      const r = runMainOrchestratorAgentCall(
        { subagent_type: 'verifier', name: badSuffix },
        proj, 'spoof-edge-' + badSuffix,
      );
      assert.strictEqual(r.exit, 0, 'SPOOF-EDGE-' + badSuffix + ': non-matching suffix shape must pass through non-owning: ' + JSON.stringify(r));
      assert.strictEqual((r.stdout || '').trim(), '', 'SPOOF-EDGE-' + badSuffix + ': non-owning must produce EMPTY stdout: ' + JSON.stringify(r));
    }

    assert.deepStrictEqual(listRegistryFiles(proj), before, 'S16-RS-AUTOSUFFIX-NAMESPACE-SPOOF-01: zero registry side effects across every case (denied or non-owning)');
    console.log('S16-RS-AUTOSUFFIX-NAMESPACE-SPOOF-01: PASS');
  } finally {
    cleanup(proj);
  }
}

console.log('\nAll agent-spawn-execution-gate tests passed.');
