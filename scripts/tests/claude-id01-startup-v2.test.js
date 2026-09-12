#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');

const assert = require('node:assert');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const rc = require('../lib/runtime-consultation.cjs');
const host = require('../lib/runtime-host-claude.cjs');

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function makeFixture(label) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-startup-v2-' + label + '-'));
  execFileSync('git', ['-C', projectRoot, 'init', '-q']);
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'startup-v2@test.local']);
  execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Startup V2 Test']);
  execFileSync('git', ['-C', projectRoot, 'commit', '-q', '--allow-empty', '-m', 'init']);
  const waveDir = path.join(projectRoot, '.planning', 'wave-startup-v2');
  fs.mkdirSync(waveDir, { recursive: true });
  fs.writeFileSync(path.join(waveDir, 'PLAN.md'), '# startup v2 fixture\n');

  const sessionId = 'startup-session-' + label;
  const agentId = 'startup-agent-' + label;
  const role = 'arch-platform';
  const identity = { ok: true, provider: 'claude-hook', runtime_session_key: sessionId };
  const generation = rll.resolveSessionGeneration(projectRoot, identity);
  const worktreeId = rll.computeWorktreeId(projectRoot);
  const planDigest = rll.discoverPlan(projectRoot).planDigest;
  const main = rll.createMainOrchestratorBinding(projectRoot, identity, worktreeId, planDigest, 600);
  assert.strictEqual(generation.ok, true);
  assert.strictEqual(main.ok, true);
  const actionId = rll.generateActionId();
  const actionResult = rll.mintRoleLifecycleAction(
    projectRoot, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(projectRoot),
    worktreeId, planDigest, digest('policy-' + label), generation.generationId, role,
    rll.buildRoleSpawnPayload('startup-v2', role, role, null, 'bootstrap-' + label),
    new Date(Date.now() + 240000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  );
  assert.strictEqual(actionResult.ok, true, JSON.stringify(actionResult));
  const action = actionResult.action;
  const canonical = rll.canonicalNativeAgentInputForAction(action);
  const toolUseId = 'startup-agent-tool-' + label;
  const claimResult = rll.mintRoleSpawnExecutionClaim({ repoId: action.repo_id }, action, main.binding.binding_id, {
    runtimeSessionId: sessionId,
    sourceToolUseId: toolUseId,
    canonicalInputDigest: digest(rc.canonicalJSONStringify(canonical)),
    proposedInputDigest: digest(rc.canonicalJSONStringify(canonical)),
    modelDeviation: false,
  }, 240);
  assert.strictEqual(claimResult.ok, true, JSON.stringify(claimResult));
  const consumed = rll.validateAndConsumeRoleSpawnExecutionClaim(projectRoot, action,
    { sessionId, agentId, agentType: role }, projectRoot);
  assert.strictEqual(consumed.ok, true, JSON.stringify(consumed));
  const actorBinding = rll.createRoleActorBinding(projectRoot, role, worktreeId, planDigest, generation.generationId, 600);
  assert.strictEqual(actorBinding.ok, true, JSON.stringify(actorBinding));
  const profileDigest = rll.roleProfileDigestFor(role);
  const starting = rll.transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest,
    generation.generationId, role, 'ABSENT', 'STARTING', null,
    { driver: 'claude-sendmessage', respawn_count: 0, pending_action_id: actionId });
  assert.strictEqual(starting.ok, true, JSON.stringify(starting));
  return {
    projectRoot, sessionId, agentId, role, generation, worktreeId, planDigest, action,
    claim: consumed.claim, actorBinding: actorBinding.binding, profileDigest, starting: starting.record,
  };
}

function withSessionEvidence(fixture, fn) {
  const saved = host.getProductionSessionIdentity;
  host.getProductionSessionIdentity = (projectRoot, sessionId) => {
    if (projectRoot !== fixture.projectRoot || sessionId !== fixture.sessionId) return { ok: false };
    return { ok: true, record: {
      worktree_id: fixture.worktreeId,
      plan_digest: fixture.planDigest,
      host_contract_digest: digest('host-contract'),
      expires_at: new Date(Date.now() + 600000).toISOString(),
    } };
  };
  try { return fn(); } finally { host.getProductionSessionIdentity = saved; }
}

function completeStartup(fixture, options = {}) {
  return withSessionEvidence(fixture, () => {
    const actor = rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: options.agentId || fixture.agentId,
      agentType: options.role || fixture.role, action: fixture.action,
      claim: fixture.claim, actorBinding: fixture.actorBinding,
    });
    if (!actor.ok) return { actor };
    const readyToolUseId = 'startup-ready-tool-' + (options.suffix || 'ok');
    const argvDigest = rc.sha256String('ready:' + fixture.action.action_id);
    const grant = rll.mintLifecycleCommandGrant(fixture.projectRoot, fixture.actorBinding, argvDigest,
      fixture.role, 'ready', 'role-actor', 'target', 'target', fixture.action.action_id);
    if (!grant.ok) return { actor, grant };
    const pre = rll.recordClaudeStartupReadyPreObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role,
      toolUseId: readyToolUseId, action: fixture.action, actorBinding: fixture.actorBinding,
      grantId: grant.grantId,
    });
    if (!pre.ok) return { actor, grant, pre };
    const consumedGrant = rll.validateAndConsumeLifecycleCommandGrant(fixture.projectRoot, grant.grantId,
      argvDigest, fixture.role, 'ready', fixture.action.action_id);
    if (!consumedGrant.ok) return { actor, grant, pre, consumedGrant };
    const ready = rll.transitionRoleBinding(fixture.projectRoot, fixture.worktreeId, fixture.planDigest,
      fixture.profileDigest, fixture.generation.generationId, fixture.role, 'STARTING', 'READY',
      fixture.starting, {});
    if (!ready.ok) return { actor, grant, pre, consumedGrant, ready };
    const outcome = rll.recordClaudeStartupReadyOutcome(fixture.projectRoot, {
      hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: fixture.sessionId,
      tool_use_id: readyToolUseId, agent_id: fixture.agentId, agent_type: fixture.role,
    });
    return { actor, grant, pre, consumedGrant, ready, outcome };
  });
}

function cleanup(fixture) {
  try { fs.rmSync(rll.registryRepoDir(fixture.projectRoot), { recursive: true, force: true }); } catch { /* best effort */ }
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
}

test('P1-ID01-V2 initial consumed claim plus real actor binding and successful target-gated ready promotes one actor without a second peer', () => {
  const fixture = makeFixture('positive');
  try {
    const completed = completeStartup(fixture);
    assert.strictEqual(completed.actor.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.pre.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.outcome.ok, true, JSON.stringify(completed));
    assert.strictEqual(completed.outcome.capability.schema, 'runtime/claude-id01-capability/v2');
    assert.deepStrictEqual(Object.keys(completed.outcome.capability).sort(), [
      'completed_at', 'created_at', 'expiry', 'host_contract_digest', 'plan_digest',
      'schema', 'session_generation_digest', 'startup_actor_observed',
      'startup_trace_digest', 'worktree_id',
    ].sort());
    const proof = withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, fixture.agentId,
    ));
    assert.strictEqual(proof.ok, true, JSON.stringify(proof));
    const requester = withSessionEvidence(fixture, () => rll.createRequesterBinding(
      fixture.projectRoot,
      { ok: true, provider: 'claude-hook', runtime_session_key: fixture.sessionId },
      fixture.agentId, fixture.role, fixture.worktreeId, fixture.planDigest, 600,
    ));
    assert.strictEqual(requester.ok, true, JSON.stringify(requester));
    assert.strictEqual(withSessionEvidence(fixture, () => rll.validateRequesterBindingFor(
      fixture.projectRoot, requester.binding.binding_id, fixture.role, fixture.worktreeId, fixture.planDigest,
    )).ok, true);
    const observed = { sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role };
    assert.strictEqual(rll.preflightClaudeId01TraceForSession(fixture.projectRoot, observed).ok, true);
    const identityId = rll.computeClaudeAuthorityIdentityId(
      fixture.projectRoot, 'claude-hook', fixture.sessionId, fixture.agentId,
    );
    assert.strictEqual(rll.publishClaudeAuthorityFence(fixture.projectRoot, identityId).ok, true);
    assert.strictEqual(rll.deleteClaudeId01TraceForSession(fixture.projectRoot, observed).ok, true);
    const afterStop = withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, fixture.agentId,
    ));
    assert.strictEqual(afterStop.ok, false);
    assert.strictEqual(afterStop.reason, 'claude-id01-startup-trace-absent');
  } finally { cleanup(fixture); }
});

test('P1-ID01-V2 missing host evidence, failed/missing ready, foreign actor and old generation-wide v1 capability grant no requester proof', () => {
  const fixture = makeFixture('negative');
  try {
    const noSession = rll.recordClaudeStartupActorObservation(fixture.projectRoot, {
      sessionId: fixture.sessionId, agentId: fixture.agentId, agentType: fixture.role,
      action: fixture.action, claim: fixture.claim, actorBinding: fixture.actorBinding,
    });
    assert.strictEqual(noSession.ok, false);
    assert.strictEqual(rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, fixture.agentId,
    ).ok, false);
    assert.strictEqual(rll.checkClaudeId01RuntimeCapability(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest,
    ).reason, 'claude-id01-actor-scope-required');
    const completed = completeStartup(fixture);
    assert.strictEqual(completed.outcome.ok, true, JSON.stringify(completed));
    const foreign = withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, 'foreign-agent',
    ));
    assert.strictEqual(foreign.ok, false);
    const oldPath = rll.claudeId01CapabilityPathFor(fixture.projectRoot, fixture.generation.generationId,
      fixture.worktreeId, fixture.planDigest);
    fs.mkdirSync(path.dirname(oldPath), { recursive: true });
    fs.writeFileSync(oldPath, JSON.stringify({ schema: 'runtime/claude-id01-capability/v1', proof_complete: true }));
    assert.strictEqual(withSessionEvidence(fixture, () => rll.checkClaudeId01ProofComplete(
      fixture.projectRoot, fixture.sessionId, fixture.worktreeId, fixture.planDigest, fixture.role, 'another-agent',
    )).ok, false);
  } finally { cleanup(fixture); }
});
