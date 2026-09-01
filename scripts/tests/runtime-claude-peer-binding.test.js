#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'peer-custody-fixture';

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync, spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-peer-binding-e2e-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'claude-peer-binding-e2e-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Claude Peer Binding E2E Test']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'init']);
  fs.mkdirSync(path.join(dir, '.planning', 'wave-peer-custody'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.planning', 'wave-peer-custody', 'PLAN.md'), '# peer custody fixture plan\n');
  return dir;
}

function withProject(fn) {
  const projectRoot = makeGitProject();
  try {
    fn(projectRoot);
  } finally {
    fs.rmSync(rll.registryRepoDir(projectRoot), { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

async function withProjectAsync(fn) {
  const projectRoot = makeGitProject();
  try {
    await fn(projectRoot);
  } finally {
    fs.rmSync(rll.registryRepoDir(projectRoot), { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
}

function listPeerBindingFiles(project) {
  const dir = path.join(rll.registryRepoDir(project), 'claude-peer-bindings');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((n) => n.endsWith('.json'));
}

function mintProofAction(project, worktreeId, planDigest, generationId, suffix) {
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('claude-id01-probe', 'arch-platform', 'arch-platform', 'fixture', 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    project, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(project), worktreeId,
    planDigest, crypto.createHash('sha256').update('peer-binding-probe-policy:' + suffix).digest('hex'),
    generationId, 'arch-platform', payload, expiry,
  );
  assert.strictEqual(minted.ok, true, 'proof probe action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function primeCompleteProof(project, sessionId, worktreeId, planDigest, generationId, primaryAgentId) {
  const actionA = mintProofAction(project, worktreeId, planDigest, generationId, 'a-' + primaryAgentId);
  const actionB = mintProofAction(project, worktreeId, planDigest, generationId, 'b-' + primaryAgentId);
  const peerB = primaryAgentId + '-distinct-peer-b';
  rll.recordClaudeId01SubagentStartObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', toolUseId: 'peer-tu-1-' + sessionId + '-' + primaryAgentId });
  rll.recordClaudeId01PreToolUseObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', toolUseId: 'peer-tu-2-' + sessionId + '-' + primaryAgentId });
  rll.recordClaudeId01SubagentStartObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', toolUseId: 'peer-tu-3-' + sessionId + '-' + primaryAgentId });
  rll.recordClaudeId01SubagentStartObservation(project, { sessionId, agentId: peerB, agentType: 'arch-platform', actionId: actionB });
}

function setupBase(project) {
  const sessionId = 'peer-session-' + crypto.randomBytes(4).toString('hex');
  const primaryAgentId = 'peer-proof-agent';
  const generation = rll.resolveSessionGeneration(project, { ok: true, provider: 'claude-hook', runtime_session_key: sessionId });
  assert.strictEqual(generation.ok, true, 'session generation must resolve: ' + JSON.stringify(generation));
  const worktreeId = rll.computeWorktreeId(project);
  const plan = rll.discoverPlan(project);
  assert.strictEqual(plan.ok, true, 'PLAN must resolve');
  return {
    sessionId, primaryAgentId, generationId: generation.generationId, worktreeId, planDigest: plan.planDigest,
  };
}

// Full ready-to-correlate fixture: complete proof + one live target
// RoleActorBinding for arch-testing. Caller then mints exactly one live
// target action (spawn or rebind) to complete the correlation surface.
function setupReadyBase(project) {
  const base = setupBase(project);
  primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
  const created = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
  assert.strictEqual(created.ok, true, 'target actor binding must mint: ' + JSON.stringify(created));
  base.actorBinding = created.binding;
  base.event = { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
  return base;
}

function mintTargetSpawnAction(project, base, suffix) {
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('wp3-support-plane', 'arch-testing', 'arch-testing', null, 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    project, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(project), base.worktreeId,
    base.planDigest, crypto.createHash('sha256').update('peer-binding-target-spawn:' + (suffix || '')).digest('hex'),
    base.generationId, 'arch-testing', payload, expiry,
  );
  assert.strictEqual(minted.ok, true, 'target spawn action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function mintTargetRebindAction(project, base, suffix) {
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleRebindClaudeNativePayload(base.actorBinding.binding_id, 'arch-testing', null, 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    project, actionId, 'role-rebind', 'claude-native', rll.computeRepoId(project), base.worktreeId,
    base.planDigest, crypto.createHash('sha256').update('peer-binding-target-rebind:' + (suffix || '')).digest('hex'),
    base.generationId, 'arch-testing', payload, expiry,
  );
  assert.strictEqual(minted.ok, true, 'target rebind action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function expectedFor(base) {
  return {
    sessionDigest: rll.sha256String ? rll.sha256String(base.event.sessionId) : crypto.createHash('sha256').update(base.event.sessionId).digest('hex'),
    worktreeId: base.worktreeId,
    planDigest: base.planDigest,
    targetRole: 'arch-testing',
  };
}

// ── 1. spawn correlation ────────────────────────────────────────────────────

test('spawn correlation mints one exact durable peer record and returns it', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    mintTargetSpawnAction(project, base, '1');
    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(result.ok, true, 'expected success: ' + JSON.stringify(result));
    assert.strictEqual(result.record.role, 'arch-testing');
    assert.strictEqual(result.record.session, base.event.sessionId);
    assert.strictEqual(result.record.agent_id, base.event.agentId);
    assert.strictEqual(result.record.actor_binding_id, base.actorBinding.binding_id);
    assert.strictEqual(result.record.worktree_id, base.worktreeId);
    assert.strictEqual(result.record.plan_digest, base.planDigest);
    assert.strictEqual(listPeerBindingFiles(project).length, 1);
  });
});

// ── 2. rebind correlation ───────────────────────────────────────────────────

test('rebind correlation mints one exact durable peer record and returns it', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    mintTargetRebindAction(project, base, '1');
    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(result.ok, true, 'expected success: ' + JSON.stringify(result));
    assert.strictEqual(result.record.role, 'arch-testing');
    assert.strictEqual(result.record.actor_binding_id, base.actorBinding.binding_id);
    assert.strictEqual(listPeerBindingFiles(project).length, 1);
  });
});

// ── 3. idempotency ──────────────────────────────────────────────────────────

test('repeat ensure is idempotent and returns the same record with no second peer file', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    mintTargetSpawnAction(project, base, '1');
    const first = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(first.ok, true);
    const second = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(second.ok, true);
    assert.deepStrictEqual(second.record, first.record);
    assert.strictEqual(listPeerBindingFiles(project).length, 1);
  });
});

// ── 4. malformed event / expected objects ───────────────────────────────────

test('non-exact or malformed event and expected objects are INVALID with zero writes', () => {
  withProject((project) => {
    const malformedEvents = [
      null, undefined, 42, [], {},
      { sessionId: 's' },
      { sessionId: 's', agentId: 'a', agentType: 'arch-testing', extra: 'x' },
      { sessionId: '', agentId: 'a', agentType: 'arch-testing' },
      { sessionId: 's', agentId: 'a', agentType: 'not-a-canonical-role' },
    ];
    for (const event of malformedEvents) {
      assert.deepStrictEqual(
        rll.ensureClaudePeerBindingForObservedActor(project, event),
        { ok: false, reason: 'INVALID' },
      );
    }
    assert.strictEqual(listPeerBindingFiles(project).length, 0);

    const base = setupBase(project);
    const malformedExpected = [
      null, undefined, 42, [],
      { sessionDigest: 'x'.repeat(64), worktreeId: 'y'.repeat(64), planDigest: 'z'.repeat(64) },
      {
        sessionDigest: 'x'.repeat(64), worktreeId: 'y'.repeat(64),
        planDigest: 'z'.repeat(64), targetRole: 'not-a-role',
      },
      {
        sessionDigest: 'short', worktreeId: base.worktreeId,
        planDigest: base.planDigest, targetRole: 'arch-testing',
      },
    ];
    const fakeBindingId = crypto.randomBytes(16).toString('hex');
    for (const expected of malformedExpected) {
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, fakeBindingId, expected),
        { ok: false, reason: 'INVALID' },
      );
      assert.deepStrictEqual(
        rll.findUniqueClaudePeerBindingForTarget(project, expected),
        { ok: false, reason: 'INVALID' },
      );
    }
    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 5. missing/expired generation, incomplete proof ─────────────────────────

test('missing or expired generation and incomplete proof are UNAVAILABLE with zero peer writes', () => {
  withProject((project) => {
    const neverEvent = { sessionId: 'peer-never-generation', agentId: 'a', agentType: 'arch-testing' };
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, neverEvent),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    const baseExpired = setupBase(project);
    const recordPath = rll.sessionGenerationPathFor(project, { provider: 'claude-hook', runtime_session_key: baseExpired.sessionId });
    const obj = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    const nowMs = Date.now();
    obj.created_at = new Date(nowMs - 7200000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    obj.expires_at = new Date(nowMs - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.writeFileSync(recordPath, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(recordPath, 0o600);
    const expiredEvent = { sessionId: baseExpired.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, expiredEvent),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    const baseIncomplete = setupBase(project);
    const actionA = mintProofAction(
      project, baseIncomplete.worktreeId, baseIncomplete.planDigest, baseIncomplete.generationId, 'incomplete',
    );
    rll.recordClaudeId01SubagentStartObservation(project, {
      sessionId: baseIncomplete.sessionId, agentId: baseIncomplete.primaryAgentId, agentType: 'arch-platform', actionId: actionA,
    });
    const incompleteEvent = { sessionId: baseIncomplete.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, incompleteEvent),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 6. present fence ─────────────────────────────────────────────────────────

test('present exact actor fence is INVALID with zero peer writes', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    mintTargetSpawnAction(project, base, '1');
    const fencePublish = rll.publishClaudeAuthorityFence(
      project, rll.computeClaudeAuthorityIdentityId(project, 'claude-hook', base.event.sessionId, base.event.agentId),
    );
    assert.strictEqual(fencePublish.ok, true, 'fence publish must succeed: ' + JSON.stringify(fencePublish));
    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.deepStrictEqual(result, { ok: false, reason: 'INVALID' });
    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 7. missing/ambiguous RoleActorBinding ───────────────────────────────────

test('missing current RoleActorBinding is UNAVAILABLE and ambiguous RoleActorBinding is INVALID', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const event = { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, event),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    const first = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    const second = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, true);
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, event),
      { ok: false, reason: 'INVALID' },
    );
    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 8. zero matching actions ────────────────────────────────────────────────

test('zero matching live claude-native actions is UNAVAILABLE', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.deepStrictEqual(result, { ok: false, reason: 'UNAVAILABLE' });
    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 9. two matching actions ─────────────────────────────────────────────────

test('two matching live claude-native actions is INVALID', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    mintTargetSpawnAction(project, base, 'first');
    mintTargetRebindAction(project, base, 'second');
    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.deepStrictEqual(result, { ok: false, reason: 'INVALID' });
    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 10. non-correlating action shapes ───────────────────────────────────────

test('expired, wrong-generation, wrong-scope, wrong-runtime, wrong-kind, or non-exact payload action does not correlate', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    const repoId = rll.computeRepoId(project);
    const otherGeneration = rll.resolveSessionGeneration(project, { ok: true, provider: 'claude-hook', runtime_session_key: base.sessionId + '-other' });
    assert.strictEqual(otherGeneration.ok, true);
    const otherPlanDigest = crypto.createHash('sha256').update('other-plan').digest('hex');
    const otherWorktreeId = crypto.createHash('sha256').update('other-worktree').digest('hex');

    const spawnPayload = rll.buildRoleSpawnPayload('wp3-support-plane', 'arch-testing', 'arch-testing', null, 'fixture');
    const rebindPayload = rll.buildRoleRebindClaudeNativePayload(base.actorBinding.binding_id, 'arch-testing', null, 'fixture');

    // Expired.
    const expiredId = rll.generateActionId();
    const nearExpiry = new Date(Date.now() + 1500).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const expiredMint = rll.mintRoleLifecycleAction(
      project, expiredId, 'role-spawn', 'claude-native', repoId, base.worktreeId,
      base.planDigest, crypto.createHash('sha256').update('nc-expired').digest('hex'),
      base.generationId, 'arch-testing', spawnPayload, nearExpiry,
    );
    assert.strictEqual(expiredMint.ok, true);
    const actionPath = rll.actionPathFor(project, expiredId);
    const rewritten = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    rewritten.expires_at = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.writeFileSync(actionPath, JSON.stringify(rewritten), { mode: 0o600 });
    fs.chmodSync(actionPath, 0o600);

    // Wrong generation.
    const wrongGenId = rll.generateActionId();
    const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    rll.mintRoleLifecycleAction(
      project, wrongGenId, 'role-spawn', 'claude-native', repoId, base.worktreeId,
      base.planDigest, crypto.createHash('sha256').update('nc-wrong-gen').digest('hex'),
      otherGeneration.generationId, 'arch-testing', spawnPayload, expiry,
    );

    // Wrong scope (worktree/plan).
    const wrongScopeId = rll.generateActionId();
    rll.mintRoleLifecycleAction(
      project, wrongScopeId, 'role-spawn', 'claude-native', repoId, otherWorktreeId,
      otherPlanDigest, crypto.createHash('sha256').update('nc-wrong-scope').digest('hex'),
      base.generationId, 'arch-testing', spawnPayload, expiry,
    );

    // Wrong runtime.
    const wrongRuntimeId = rll.generateActionId();
    rll.mintRoleLifecycleAction(
      project, wrongRuntimeId, 'role-spawn', 'host-process', repoId, base.worktreeId,
      base.planDigest, crypto.createHash('sha256').update('nc-wrong-runtime').digest('hex'),
      base.generationId, 'arch-testing', spawnPayload, expiry,
    );

    // Wrong kind.
    const wrongKindId = rll.generateActionId();
    rll.mintRoleLifecycleAction(
      project, wrongKindId, 'role-notify', 'claude-native', repoId, base.worktreeId,
      base.planDigest, crypto.createHash('sha256').update('nc-wrong-kind').digest('hex'),
      base.generationId, 'arch-testing',
      rll.buildRoleNotifyPayload(base.actorBinding.binding_id, 'arch-testing', 'ref', 'kind', 'msg'), expiry,
    );

    // Non-exact payload (rebind kind, spawn-shaped payload).
    const nonExactId = rll.generateActionId();
    rll.mintRoleLifecycleAction(
      project, nonExactId, 'role-rebind', 'claude-native', repoId, base.worktreeId,
      base.planDigest, crypto.createHash('sha256').update('nc-non-exact').digest('hex'),
      base.generationId, 'arch-testing', { ...rebindPayload, extra_field: 'x' }, expiry,
    );

    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.deepStrictEqual(result, { ok: false, reason: 'UNAVAILABLE' });
    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
});

// ── 11. validator drift rejections ──────────────────────────────────────────

test(
  'validator accepts the exact durable peer and rejects session digest, role, worktree, plan, actor, fence, proof, generation, and action drift',
  () => {
    withProject((project) => {
      const base = setupReadyBase(project);
      mintTargetSpawnAction(project, base, '1');
      const minted = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
      assert.strictEqual(minted.ok, true);
      const expected = expectedFor(base);

      const acceptResult = rll.validateClaudePeerBindingFor(project, minted.record.binding_id, expected);
      assert.strictEqual(acceptResult.ok, true, 'expected accept: ' + JSON.stringify(acceptResult));
      assert.deepStrictEqual(acceptResult.record, minted.record);

      const wrongSessionDigest = { ...expected, sessionDigest: crypto.randomBytes(32).toString('hex') };
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, wrongSessionDigest),
        { ok: false, reason: 'INVALID' },
      );

      const wrongRole = { ...expected, targetRole: 'arch-platform' };
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, wrongRole),
        { ok: false, reason: 'INVALID' },
      );

      const wrongWorktree = { ...expected, worktreeId: crypto.randomBytes(32).toString('hex') };
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, wrongWorktree),
        { ok: false, reason: 'INVALID' },
      );

      const wrongPlan = { ...expected, planDigest: crypto.randomBytes(32).toString('hex') };
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, wrongPlan),
        { ok: false, reason: 'INVALID' },
      );

      // Actor drift: rewrite the owned peer record's actor_binding_id.
      const peerPath = rll.claudePeerBindingPathFor(project, minted.record.binding_id);
      const originalBytes = fs.readFileSync(peerPath, 'utf8');
      const withWrongActor = { ...minted.record, actor_binding_id: crypto.randomBytes(16).toString('hex') };
      fs.writeFileSync(peerPath, JSON.stringify(withWrongActor), { mode: 0o600 });
      fs.chmodSync(peerPath, 0o600);
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, expected),
        { ok: false, reason: 'INVALID' },
      );
      fs.writeFileSync(peerPath, originalBytes, { mode: 0o600 });
      fs.chmodSync(peerPath, 0o600);
      assert.strictEqual(rll.validateClaudePeerBindingFor(project, minted.record.binding_id, expected).ok, true);

      // Fence drift: publish the fence for this exact observed identity.
      const fencePublish = rll.publishClaudeAuthorityFence(
        project, rll.computeClaudeAuthorityIdentityId(project, 'claude-hook', base.event.sessionId, base.event.agentId),
      );
      assert.strictEqual(fencePublish.ok, true);
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, expected),
        { ok: false, reason: 'INVALID' },
      );
    });

    withProject((project) => {
      const base = setupReadyBase(project);
      mintTargetSpawnAction(project, base, '2');
      const minted = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
      assert.strictEqual(minted.ok, true);
      const expected = expectedFor(base);

      // Generation drift: expire the current generation.
      const recordPath = rll.sessionGenerationPathFor(project, { provider: 'claude-hook', runtime_session_key: base.sessionId });
      const genObj = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      const nowMs = Date.now();
      genObj.created_at = new Date(nowMs - 7200000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      genObj.expires_at = new Date(nowMs - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      fs.writeFileSync(recordPath, JSON.stringify(genObj), { mode: 0o600 });
      fs.chmodSync(recordPath, 0o600);
      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, expected),
        { ok: false, reason: 'UNAVAILABLE' },
      );
    });

    withProject((project) => {
      const base = setupReadyBase(project);
      const spawnActionId = mintTargetSpawnAction(project, base, '3');
      const minted = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
      assert.strictEqual(minted.ok, true);
      const expected = expectedFor(base);

      const actionPath = rll.actionPathFor(project, spawnActionId);
      const actionObj = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
      actionObj.expires_at = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      fs.writeFileSync(actionPath, JSON.stringify(actionObj), { mode: 0o600 });
      fs.chmodSync(actionPath, 0o600);

      assert.deepStrictEqual(
        rll.validateClaudePeerBindingFor(project, minted.record.binding_id, expected),
        { ok: false, reason: 'UNAVAILABLE' },
      );
    });
  },
);

// ── 12. finder absence + unique success ─────────────────────────────────────

test('finder returns UNAVAILABLE for absence and the unique fully validated target record for one match', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    const expected = expectedFor(base);
    assert.deepStrictEqual(
      rll.findUniqueClaudePeerBindingForTarget(project, expected),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    mintTargetSpawnAction(project, base, '1');
    const minted = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(minted.ok, true);
    const found = rll.findUniqueClaudePeerBindingForTarget(project, expected);
    assert.strictEqual(found.ok, true, 'expected unique find: ' + JSON.stringify(found));
    assert.deepStrictEqual(found.record, minted.record);
  });
});

// ── 13. finder duplicate/malformed/non-regular/scan-cap ─────────────────────

test('finder returns INVALID for duplicate target peers, malformed entries, non-regular entries, or scan-cap overflow', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    const expected = expectedFor(base);
    mintTargetSpawnAction(project, base, '1');
    const first = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(first.ok, true);

    // Duplicate: hand-write a second structurally valid peer for the same target tuple.
    const dupId = crypto.randomBytes(16).toString('hex');
    const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const dupRecord = {
      actor_binding_id: base.actorBinding.binding_id,
      agent_id: 'peer-custody-observed-duplicate',
      binding_id: dupId,
      created_at: createdAt,
      expiry: new Date(Date.now() + 120000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      plan_digest: base.planDigest,
      role: 'arch-testing',
      schema: rll.CLAUDE_PEER_BINDING_SCHEMA,
      session: base.event.sessionId,
      teammate_name: 'arch-testing',
      worktree_id: base.worktreeId,
    };
    const dupPath = rll.claudePeerBindingPathFor(project, dupId);
    fs.mkdirSync(path.dirname(dupPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(dupPath), 0o700);
    fs.writeFileSync(dupPath, JSON.stringify(dupRecord), { mode: 0o600 });
    fs.chmodSync(dupPath, 0o600);
    assert.deepStrictEqual(
      rll.findUniqueClaudePeerBindingForTarget(project, expected),
      { ok: false, reason: 'INVALID' },
    );
    fs.rmSync(dupPath);

    assert.strictEqual(rll.findUniqueClaudePeerBindingForTarget(project, expected).ok, true);

    // Malformed entry in the same directory.
    const malformedPath = rll.claudePeerBindingPathFor(project, crypto.randomBytes(16).toString('hex'));
    fs.writeFileSync(malformedPath, '{not json', { mode: 0o600 });
    fs.chmodSync(malformedPath, 0o600);
    assert.deepStrictEqual(
      rll.findUniqueClaudePeerBindingForTarget(project, expected),
      { ok: false, reason: 'INVALID' },
    );
    fs.rmSync(malformedPath);

    // Non-regular entry (subdirectory) in the same directory.
    const bogusDir = path.join(rll.registryRepoDir(project), 'claude-peer-bindings', 'notabinding.json');
    fs.mkdirSync(bogusDir, { recursive: true, mode: 0o700 });
    assert.deepStrictEqual(
      rll.findUniqueClaudePeerBindingForTarget(project, expected),
      { ok: false, reason: 'INVALID' },
    );
    fs.rmSync(bogusDir, { recursive: true, force: true });

    assert.strictEqual(rll.findUniqueClaudePeerBindingForTarget(project, expected).ok, true);

    // Scan-cap overflow: 1025 additional bogus entries.
    const peerDir = path.join(rll.registryRepoDir(project), 'claude-peer-bindings');
    for (let i = 0; i < 1025; i += 1) {
      fs.writeFileSync(path.join(peerDir, crypto.randomBytes(16).toString('hex') + '.json'), '{}', { mode: 0o600 });
    }
    assert.deepStrictEqual(
      rll.findUniqueClaudePeerBindingForTarget(project, expected),
      { ok: false, reason: 'INVALID' },
    );
  });
});

// ── 14. concurrency convergence ─────────────────────────────────────────────

test('concurrent equivalent ensure calls converge to one durable peer record and byte-identical success results', async () => {
  await withProjectAsync(async (project) => {
    const base = setupReadyBase(project);
    mintTargetSpawnAction(project, base, '1');

    const childScript = `
      const rll = require(${JSON.stringify(IMPL)});
      const project = ${JSON.stringify(project)};
      const event = ${JSON.stringify(base.event)};
      const result = rll.ensureClaudePeerBindingForObservedActor(project, event);
      process.stdout.write(JSON.stringify(result));
    `;

    function runChild() {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', childScript], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });
    }

    const firstResult = runChild();
    const secondResult = runChild();
    const [first, second] = await Promise.all([firstResult, secondResult]);

    assert.strictEqual(first.code, 0, 'first child must exit 0: ' + first.stderr);
    assert.strictEqual(second.code, 0, 'second child must exit 0: ' + second.stderr);
    assert.strictEqual(first.stdout, second.stdout, 'concurrent ensure results must be byte-identical JSON');
    const parsed = JSON.parse(first.stdout);
    assert.strictEqual(parsed.ok, true, 'expected success: ' + first.stdout);
    assert.strictEqual(listPeerBindingFiles(project).length, 1);
  });
});
