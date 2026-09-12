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
const {
  primeClaudeId01V2ActorProof,
  claudeId01V2SessionEvidenceFor,
} = require('./fixtures/runtime-claude-id01-v2-fixture.cjs');
const SESSION_IDENTITY_PRELOAD = path.resolve(__dirname, 'fixtures/runtime-claude-session-identity-preload.cjs');

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

function mintProofAction(project, worktreeId, planDigest, generationId, suffix, role = 'arch-platform') {
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('claude-id01-probe', role, role, 'fixture', 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    project, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(project), worktreeId,
    planDigest, crypto.createHash('sha256').update('peer-binding-probe-policy:' + suffix).digest('hex'),
    generationId, role, payload, expiry,
  );
  assert.strictEqual(minted.ok, true, 'proof probe action must mint: ' + JSON.stringify(minted));
  return actionId;
}

function primeCompleteProof(project, sessionId, worktreeId, planDigest, generationId, agentId, agentType = 'arch-platform', actorBindingTtlSeconds = 600) {
  const actionId = mintProofAction(project, worktreeId, planDigest, generationId, 'complete-' + agentId, agentType);
  const proof = primeClaudeId01V2ActorProof({
    projectRoot: project, agentType, sessionId, agentId,
    actionId, actorBindingTtlSeconds, prefix: 'peer-binding-v2',
  });
  // The peer-correlation tests mint their own candidate action. The startup
  // action has already been incorporated into the immutable v2 proof and may
  // therefore be treated as registry-GC'd for this independent read surface.
  fs.rmSync(rll.actionPathFor(project, actionId), { force: true });
  return proof.actorBinding;
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
  base.event = { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
  base.actorBinding = primeCompleteProof(
    project, base.sessionId, base.worktreeId, base.planDigest, base.generationId,
    base.event.agentId, base.event.agentType,
  );
  base.sessionEvidence = claudeId01V2SessionEvidenceFor(project, base.sessionId);
  assert.ok(base.sessionEvidence, 'target actor session evidence must remain available');
  return base;
}

// P4 fixture correction (reported explicitly, not silent): setupReadyBase
// mints a RoleActorBinding directly, bypassing the ensure/ready CLI
// entirely -- correct for the pre-existing ClaudePeerBinding tests above,
// none of which ever inspect role-binding state. parkClaudeResumeHandleFor
// RoleActor/consumeClaudeResumeHandleForObservedActor instead require a REAL
// role-binding record (the separate 'role-bindings' state machine,
// driver='claude-sendmessage', READY/BUSY) to exist. This wraps
// setupReadyBase and additionally drives that record there directly via the
// same transitionRoleBinding primitive production itself uses (no CLI
// surface exists to mint a role-binding directly either way, so a direct
// transitionRoleBinding call mirrors this suite's own established
// "mirror the production primitive directly" convention, identical in
// spirit to createRoleActorBinding's own test-mint precedent above).
function setupReadyBaseWithClaudeSendMessageRoleBinding(project) {
  return setupReadyBase(project);
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
    const event = { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
    const provenBinding = primeCompleteProof(
      project, base.sessionId, base.worktreeId, base.planDigest, base.generationId,
      event.agentId, event.agentType,
    );
    fs.rmSync(rll.roleActorBindingPathFor(project, provenBinding.binding_id), { force: true });
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, event),
      { ok: false, reason: 'UNAVAILABLE' },
    );

    assert.strictEqual(listPeerBindingFiles(project).length, 0);
  });
  withProject((project) => {
    const base = setupReadyBase(project);
    const second = rll.createRoleActorBinding(
      project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120,
    );
    assert.strictEqual(second.ok, true);
    assert.deepStrictEqual(
      rll.ensureClaudePeerBindingForObservedActor(project, base.event),
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

// P4 correction (reported explicitly): the "Expired" sub-case this test used
// to bundle here is REMOVED, not merely relaxed -- it is no longer a
// non-correlating shape. ensureClaudePeerBindingForObservedActor's mint path
// now falls back to ignoring ONLY expiry once a genuine RoleActorBinding +
// complete same-identity CLAUDE-ID-01 proof already correlate this exact
// actor (the P4 bootstrap correction: the original short-lived role-spawn/
// rebind action must not still need to be unexpired once that authority
// chain exists -- see the 'RED startup action' test above, which asserts
// this exact expired-but-otherwise-matching shape now DOES correlate). This
// test's remaining five shapes (wrong-generation/scope/runtime/kind/payload)
// are UNCHANGED and still must not correlate -- ignoreExpiry relaxes only
// the expiry check, never any of these.
test('wrong-generation, wrong-scope, wrong-runtime, wrong-kind, or non-exact payload action does not correlate', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    const repoId = rll.computeRepoId(project);
    const otherGeneration = rll.resolveSessionGeneration(project, { ok: true, provider: 'claude-hook', runtime_session_key: base.sessionId + '-other' });
    assert.strictEqual(otherGeneration.ok, true);
    const otherPlanDigest = crypto.createHash('sha256').update('other-plan').digest('hex');
    const otherWorktreeId = crypto.createHash('sha256').update('other-worktree').digest('hex');

    const spawnPayload = rll.buildRoleSpawnPayload('wp3-support-plane', 'arch-testing', 'arch-testing', null, 'fixture');
    const rebindPayload = rll.buildRoleRebindClaudeNativePayload(base.actorBinding.binding_id, 'arch-testing', null, 'fixture');
    const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    // Wrong generation.
    const wrongGenId = rll.generateActionId();
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
  'validator accepts the exact durable peer and rejects session digest, role, worktree, plan, actor, fence, proof, and generation drift',
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

      const afterStartupActionExpiry = rll.validateClaudePeerBindingFor(
        project, minted.record.binding_id, expected,
      );
      assert.strictEqual(
        afterStartupActionExpiry.ok,
        true,
        'an already-created persistent peer must not expire with its startup action: '
          + JSON.stringify(afterStartupActionExpiry),
      );
      assert.deepStrictEqual(afterStartupActionExpiry.record, minted.record);
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
        const child = spawn(process.execPath, ['--require', SESSION_IDENTITY_PRELOAD, '-e', childScript], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            RUNTIME_TEST_CLAUDE_SESSION_EVIDENCE: Buffer.from(JSON.stringify({
              projectRoot: project,
              repoId: rll.computeRepoId(project),
              sessionId: base.sessionId,
              record: base.sessionEvidence.record,
            })).toString('base64url'),
          },
        });
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

// ═══════════════════════════════════════════════════════════════════════════
// RED: Windows P4 native-Claude persistence correction (bounded RED-test
// authorship only -- no production changes in this section).
//
// Confirmed live fact: in Claude Code 2.1.219, one background Task completed,
// then SendMessage to that exact stopped/completed Task resumed the IDENTICAL
// Task identity -- a normal completed Task is natively resumable, not
// terminal product death.
//
// Confirmed harness defect: subagent-start-context-bundle.js's
// handleSubagentStop fences every canonical role and deletes its
// CLAUDE-ID-01 trace on an ordinary stop. A resumed SubagentStart for the
// SAME still-live actor then sees no live role-spawn claim and quarantines
// it. Dispatch can only select claude-sendmessage AFTER a full
// ClaudePeerBinding exists, but that binding requires the second
// same-identity SubagentStart to already have succeeded -- a bootstrap
// deadlock.
//
// Accepted correction: a first ordinary stop for an exactly correlated
// persistent claude-sendmessage role actor parks the role as resumable
// WAITING instead of fencing, and creates/preserves exactly one
// host-private, bounded, no-clobber RESUME HANDLE tied to exact repo,
// session generation, raw session id, raw agent id, canonical role,
// worktree, PLAN digest and RoleActorBinding. It is NOT requester/target
// authority -- it authorizes only the bootstrap SendMessage route.
//
// Proposed NEW runtime-role-lifecycle.cjs exports these tests assume
// (mirrors ensureClaudePeerBindingForObservedActor's own
// {sessionId,agentId,agentType} event shape and INVALID/UNAVAILABLE
// vocabulary exactly). None exist yet -- calling them throws "is not a
// function", which IS this section's RED for the library half of the
// contract:
//   parkClaudeResumeHandleForRoleActor(project, event)
//     -> {ok:true, record}|{ok:false, reason:'INVALID'|'UNAVAILABLE'}
// Registry directory proposed as 'claude-resume-handles' under
// registryRepoDir, mirroring 'claude-peer-bindings' exactly.
// ═══════════════════════════════════════════════════════════════════════════

function listResumeHandleFiles(project) {
  const dir = path.join(rll.registryRepoDir(project), 'claude-resume-handles');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((n) => n.endsWith('.json'));
}

test('RED park: a first ordinary stop of a correlated persistent claude-sendmessage role actor mints one exact durable resume handle scoped to repo/session/agent/role/worktree/plan/RoleActorBinding', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const result = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(result.ok, true, 'expected a parked resume handle: ' + JSON.stringify(result));
    assert.strictEqual(result.record.role, 'arch-testing');
    assert.strictEqual(result.record.session, base.event.sessionId);
    assert.strictEqual(result.record.agent_id, base.event.agentId);
    assert.strictEqual(result.record.actor_binding_id, base.actorBinding.binding_id);
    assert.strictEqual(result.record.worktree_id, base.worktreeId);
    assert.strictEqual(result.record.plan_digest, base.planDigest);
    assert.strictEqual(result.record.session_generation_id, base.generationId);
    assert.strictEqual(listResumeHandleFiles(project).length, 1);
  });
});

test('RED park: repeat park for the identical actor is no-clobber -- returns the same resume handle, never a second', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const first = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(first.ok, true, 'expected a parked resume handle: ' + JSON.stringify(first));
    const second = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(second.ok, true);
    assert.deepStrictEqual(second.record, first.record);
    assert.strictEqual(listResumeHandleFiles(project).length, 1);
  });
});

test('park ignores a structurally valid but expired historical RoleActorBinding outside the current generation', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const historicalGeneration = rll.resolveSessionGeneration(project, {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: base.sessionId + '-historical',
    });
    assert.strictEqual(historicalGeneration.ok, true);
    const historical = rll.createRoleActorBinding(
      project,
      base.event.agentType,
      base.worktreeId,
      base.planDigest,
      historicalGeneration.generationId,
      120,
    );
    assert.strictEqual(historical.ok, true);
    const historicalPath = rll.roleActorBindingPathFor(project, historical.binding.binding_id);
    const expiredRecord = JSON.parse(fs.readFileSync(historicalPath, 'utf8'));
    expiredRecord.created_at = '1999-01-01T00:00:00Z';
    expiredRecord.expiry = '2000-01-01T00:00:00Z';
    fs.writeFileSync(historicalPath, JSON.stringify(expiredRecord));

    const result = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(
      result.ok,
      true,
      'an expired binding from another generation is history, not ambiguity in the current scope: ' + JSON.stringify(result),
    );
    assert.strictEqual(result.record.actor_binding_id, base.actorBinding.binding_id);
    assert.strictEqual(listResumeHandleFiles(project).length, 1);
  });
});

test('park ignores a structurally valid but expired historical resume handle outside the current actor scope', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const historicalSession = base.sessionId + '-historical-handle';
    const historicalGeneration = rll.resolveSessionGeneration(project, {
      ok: true,
      provider: 'claude-hook',
      runtime_session_key: historicalSession,
    });
    assert.strictEqual(historicalGeneration.ok, true);
    const historicalActor = rll.createRoleActorBinding(
      project,
      'arch-platform',
      base.worktreeId,
      base.planDigest,
      historicalGeneration.generationId,
      120,
    );
    assert.strictEqual(historicalActor.ok, true);

    const historicalHandleId = crypto.randomBytes(16).toString('hex');
    const historicalHandlePath = rll.claudeResumeHandlePathFor(project, historicalHandleId);
    fs.mkdirSync(path.dirname(historicalHandlePath), { recursive: true });
    fs.writeFileSync(historicalHandlePath, JSON.stringify({
      actor_binding_id: historicalActor.binding.binding_id,
      agent_id: 'historical-agent',
      binding_id: historicalHandleId,
      created_at: '1999-01-01T00:00:00Z',
      expiry: '2000-01-01T00:00:00Z',
      plan_digest: base.planDigest,
      role: 'arch-platform',
      schema: rll.CLAUDE_RESUME_HANDLE_SCHEMA,
      session: historicalSession,
      session_generation_id: historicalGeneration.generationId,
      teammate_name: 'arch-platform',
      worktree_id: base.worktreeId,
    }), { mode: 0o600 });

    const result = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(
      result.ok,
      true,
      'an expired handle for another actor is immutable history, not a failure in the current actor scope: '
        + JSON.stringify(result),
    );
    assert.strictEqual(result.record.actor_binding_id, base.actorBinding.binding_id);
    assert.strictEqual(listResumeHandleFiles(project).length, 2);
  });
});

test('RED park: malformed event, a present actor fence, and an ambiguous RoleActorBinding are all fail-closed with zero resume-handle writes', () => {
  withProject((project) => {
    const malformedEvents = [
      null, undefined, 42, [], {},
      { sessionId: 's' },
      { sessionId: '', agentId: 'a', agentType: 'arch-testing' },
      { sessionId: 's', agentId: 'a', agentType: 'not-a-canonical-role' },
    ];
    for (const event of malformedEvents) {
      const result = rll.parkClaudeResumeHandleForRoleActor(project, event);
      assert.strictEqual(result.ok, false, 'expected fail-closed for malformed event: ' + JSON.stringify(event));
    }
    assert.strictEqual(listResumeHandleFiles(project).length, 0);
  });

  withProject((project) => {
    const base = setupReadyBase(project);
    const fencePublish = rll.publishClaudeAuthorityFence(
      project, rll.computeClaudeAuthorityIdentityId(project, 'claude-hook', base.event.sessionId, base.event.agentId),
    );
    assert.strictEqual(fencePublish.ok, true, 'fence publish must succeed: ' + JSON.stringify(fencePublish));
    const result = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(result.ok, false, 'a fenced actor identity must never be parked for resume: ' + JSON.stringify(result));
    assert.strictEqual(listResumeHandleFiles(project).length, 0);
  });

  withProject((project) => {
    const base = setupBase(project);
    const event = { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
    const first = primeCompleteProof(
      project, base.sessionId, base.worktreeId, base.planDigest, base.generationId,
      event.agentId, event.agentType,
    );
    const second = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    assert.ok(first.binding_id);
    assert.strictEqual(second.ok, true);
    const result = rll.parkClaudeResumeHandleForRoleActor(project, event);
    assert.strictEqual(result.ok, false, 'an ambiguous (two live) RoleActorBinding must never be parked for resume: ' + JSON.stringify(result));
    assert.strictEqual(listResumeHandleFiles(project).length, 0);
  });
});

test('RED startup action: full ClaudePeerBinding mint after the genuine resumed same-identity proof completes does not require the original short-lived role-spawn action to remain unexpired', () => {
  withProject((project) => {
    const base = setupReadyBase(project);
    const spawnActionId = mintTargetSpawnAction(project, base, 'startupaction-red');
    const actionPath = rll.actionPathFor(project, spawnActionId);
    const actionObj = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
    actionObj.expires_at = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.writeFileSync(actionPath, JSON.stringify(actionObj), { mode: 0o600 });
    fs.chmodSync(actionPath, 0o600);

    const result = rll.ensureClaudePeerBindingForObservedActor(project, base.event);
    assert.strictEqual(result.ok, true, 'the already-correlated RoleActorBinding plus completed same-identity CLAUDE-ID-01 proof must be sufficient authority, independent of the original short-lived role-spawn action already having expired: ' + JSON.stringify(result));
    assert.strictEqual(result.record.actor_binding_id, base.actorBinding.binding_id);
    assert.strictEqual(listPeerBindingFiles(project).length, 1);
  });
});

test('RED resume: consumeClaudeResumeHandleForObservedActor admits the exact live resume handle once, marks it consumed via a separate immutable marker (never rewriting the no-clobber handle bytes), and rejects replay', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true, 'fixture: park must succeed: ' + JSON.stringify(parked));
    const handlePath = rll.claudeResumeHandlePathFor(project, parked.record.binding_id);
    const beforeBytes = fs.readFileSync(handlePath, 'utf8');

    const first = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(first.ok, true, 'expected the live resume handle to be admitted: ' + JSON.stringify(first));
    assert.deepStrictEqual(first.record, parked.record);

    const afterBytes = fs.readFileSync(handlePath, 'utf8');
    assert.strictEqual(afterBytes, beforeBytes, 'consuming a resume handle must never rewrite its own no-clobber bytes');

    const consumedMarkerPath = handlePath + '.consumed';
    assert.strictEqual(fs.existsSync(consumedMarkerPath), true, 'consumption must be recorded via a separate immutable marker file: ' + consumedMarkerPath);

    const replay = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(replay.ok, false, 'a second consumption of the SAME resume handle is a replay and must be rejected: ' + JSON.stringify(replay));
  });
});

test('RED resume: wrong agent, wrong session, wrong role, an expired handle, a present identity fence, ambiguity, and a no-longer-live actor binding are all fail-closed for consumeClaudeResumeHandleForObservedActor', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true);

    const wrongAgent = rll.consumeClaudeResumeHandleForObservedActor(project, { ...base.event, agentId: 'someone-else' });
    assert.strictEqual(wrongAgent.ok, false, 'wrong agent_id must never admit the parked handle: ' + JSON.stringify(wrongAgent));

    const wrongSession = rll.consumeClaudeResumeHandleForObservedActor(project, { ...base.event, sessionId: 'wrong-session' });
    assert.strictEqual(wrongSession.ok, false, 'wrong session must never admit the parked handle: ' + JSON.stringify(wrongSession));

    const wrongRole = rll.consumeClaudeResumeHandleForObservedActor(project, { ...base.event, agentType: 'arch-platform' });
    assert.strictEqual(wrongRole.ok, false, 'wrong role must never admit the parked handle: ' + JSON.stringify(wrongRole));
  });

  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true);
    const handlePath = rll.claudeResumeHandlePathFor(project, parked.record.binding_id);
    const obj = JSON.parse(fs.readFileSync(handlePath, 'utf8'));
    obj.expiry = new Date(Date.now() - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    fs.writeFileSync(handlePath, JSON.stringify(obj), { mode: 0o600 });
    fs.chmodSync(handlePath, 0o600);
    const expired = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(expired.ok, false, 'an expired resume handle must never be admitted: ' + JSON.stringify(expired));
  });

  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true);
    const fencePublish = rll.publishClaudeAuthorityFence(
      project, rll.computeClaudeAuthorityIdentityId(project, 'claude-hook', base.event.sessionId, base.event.agentId),
    );
    assert.strictEqual(fencePublish.ok, true);
    const fenced = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(fenced.ok, false, 'a fenced actor identity must never admit its own resume handle: ' + JSON.stringify(fenced));
  });

  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true);
    const dupId = crypto.randomBytes(16).toString('hex');
    const dupRecord = { ...parked.record, binding_id: dupId };
    fs.writeFileSync(rll.claudeResumeHandlePathFor(project, dupId), JSON.stringify(dupRecord), { mode: 0o600 });
    const ambiguous = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(ambiguous.ok, false, 'two live resume handles for the identical actor must never both be consumable: ' + JSON.stringify(ambiguous));
  });

  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true);
    // Proxy for a terminal (STOPPING/STOPPED/QUARANTINED) role actor: the
    // resume handle's own backing RoleActorBinding is no longer live.
    fs.rmSync(rll.roleActorBindingPathFor(project, base.actorBinding.binding_id), { force: true });
    const gone = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(gone.ok, false, 'a resume handle whose backing RoleActorBinding is no longer live (terminal) must never be admitted: ' + JSON.stringify(gone));
  });
});

test('RED park: a later park of the same fully proven peer, after its first resume handle was already consumed, mints a NEW bounded handle -- the old handle and its consumed marker stay byte-identical, and exactly one live unconsumed handle exists', () => {
  withProject((project) => {
    const base = setupReadyBaseWithClaudeSendMessageRoleBinding(project);
    const first = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(first.ok, true, 'fixture: first park must succeed: ' + JSON.stringify(first));
    const firstPath = rll.claudeResumeHandlePathFor(project, first.record.binding_id);

    const consumed = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(consumed.ok, true, 'fixture: consume must succeed: ' + JSON.stringify(consumed));
    const firstBytesAfterConsume = fs.readFileSync(firstPath, 'utf8');
    const firstMarkerPath = firstPath + '.consumed';
    assert.strictEqual(fs.existsSync(firstMarkerPath), true, 'fixture: consumed marker must exist');
    const firstMarkerBytes = fs.readFileSync(firstMarkerPath, 'utf8');

    const second = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(second.ok, true, 'a later park after consumption must mint a NEW handle, a consumed handle is immutable history and can never authorize another resume: ' + JSON.stringify(second));
    assert.notStrictEqual(second.record.binding_id, first.record.binding_id, 'the new handle must have a different binding_id -- never reused');

    assert.strictEqual(fs.readFileSync(firstPath, 'utf8'), firstBytesAfterConsume, 'the old (consumed) handle bytes must stay untouched');
    assert.strictEqual(fs.readFileSync(firstMarkerPath, 'utf8'), firstMarkerBytes, 'the old consumed marker must stay untouched');

    const dir = path.join(rll.registryRepoDir(project), 'claude-resume-handles');
    const jsonFiles = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
    const liveUnconsumed = jsonFiles.filter((n) => !fs.existsSync(path.join(dir, n + '.consumed')));
    assert.strictEqual(jsonFiles.length, 2, 'both the old (consumed) and new (live) handle files must exist: ' + JSON.stringify(jsonFiles));
    assert.strictEqual(liveUnconsumed.length, 1, 'exactly one live unconsumed handle must exist: ' + JSON.stringify(liveUnconsumed));
    assert.strictEqual(liveUnconsumed[0], second.record.binding_id + '.json');

    const secondConsumed = rll.consumeClaudeResumeHandleForObservedActor(project, base.event);
    assert.strictEqual(secondConsumed.ok, true, 'the new live handle must itself be admitted exactly once: ' + JSON.stringify(secondConsumed));
    assert.strictEqual(secondConsumed.record.binding_id, second.record.binding_id);
  });
});

// P4 correction (clean9 live evidence, 2026-09-05): ROLE_ACTOR_BINDING_TTL_
// SECONDS=120 (subagent-start-context-bundle.js) plus createRoleActorBinding's
// OWN ceiling being ACTION_TTL_CEILING_SECONDS (also 120) forced every parked
// resume handle down to a two-minute lifetime -- observed live, every handle
// had already expired (~04:52Z) before the same top-level session finished
// init-session (~04:54Z) and could resume work. RoleActorBinding is a
// PERSISTENT support-plane lifecycle primitive (READY/WAITING/BUSY across
// idle gaps), never a role-spawn-action-scoped one -- its own ceiling is now
// SEPARATE (3600s, matching SESSION_GENERATION_TTL_SECONDS), while
// ACTION_TTL_CEILING_SECONDS stays 120 for startup actions unchanged.
test('RED TTL: a persistent RoleActorBinding accepts the new 3600-second ceiling, and a resume handle parked from it has materially more than 120 seconds remaining, never exceeding the actor binding or session generation lifetime', () => {
  withProject((project) => {
    const base = setupBase(project);
    base.event = { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
    base.actorBinding = primeCompleteProof(
      project, base.sessionId, base.worktreeId, base.planDigest, base.generationId,
      base.event.agentId, base.event.agentType, 3600,
    );
    assert.ok(base.actorBinding.binding_id, 'a RoleActorBinding must accept the new 3600-second persistent ceiling');

    const parked = rll.parkClaudeResumeHandleForRoleActor(project, base.event);
    assert.strictEqual(parked.ok, true, 'expected a parked resume handle: ' + JSON.stringify(parked));

    const nowMs = Date.now();
    const handleExpiryMs = new Date(parked.record.expiry).getTime();
    const remainingSeconds = (handleExpiryMs - nowMs) / 1000;
    assert.ok(
      remainingSeconds > 1000,
      'a resume handle minted from a 3600s RoleActorBinding must have materially more than 120s remaining, got ' + remainingSeconds + 's: ' + JSON.stringify(parked),
    );

    const actorBindingExpiryMs = new Date(base.actorBinding.expiry).getTime();
    assert.ok(
      handleExpiryMs <= actorBindingExpiryMs,
      'the handle must never outlive its own actor binding: ' + JSON.stringify({ handleExpiryMs, actorBindingExpiryMs }),
    );

    const genRecordPath = rll.sessionGenerationPathFor(project, { provider: 'claude-hook', runtime_session_key: base.sessionId });
    const genObj = JSON.parse(fs.readFileSync(genRecordPath, 'utf8'));
    const generationExpiryMs = new Date(genObj.expires_at).getTime();
    assert.ok(
      handleExpiryMs <= generationExpiryMs,
      'the handle must never outlive its own session generation: ' + JSON.stringify({ handleExpiryMs, generationExpiryMs }),
    );
  });
});
