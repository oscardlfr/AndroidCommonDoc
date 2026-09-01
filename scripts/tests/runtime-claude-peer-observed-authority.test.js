#!/usr/bin/env node
'use strict';

require('./lib/private-registry-tmpdir-preload.cjs');
process.env.NODE_ENV = 'test';
process.env.RUNTIME_ROLE_LIFECYCLE_TEST_CAPABILITY = 'peer-custody-fixture';

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const IMPL = path.resolve(__dirname, '../lib/runtime-role-lifecycle.cjs');
const rll = require(IMPL);

function makeGitProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-peer-observed-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'claude-peer-observed-test@test.local']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Claude Peer Observed Test']);
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

function listFilesRecursive(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function snapshotRegistry(projectRoot) {
  const root = rll.registryRepoDir(projectRoot);
  return listFilesRecursive(root).map((p) => ({
    relPath: path.relative(root, p),
    content: fs.readFileSync(p, 'utf8'),
  }));
}

function mintProofAction(project, worktreeId, planDigest, generationId, suffix) {
  const actionId = rll.generateActionId();
  const payload = rll.buildRoleSpawnPayload('claude-id01-probe', 'arch-platform', 'arch-platform', 'fixture', 'fixture');
  const expiry = new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const minted = rll.mintRoleLifecycleAction(
    project, actionId, 'role-spawn', 'claude-native', rll.computeRepoId(project), worktreeId,
    planDigest, crypto.createHash('sha256').update('peer-observed-probe-policy:' + suffix).digest('hex'),
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
  rll.recordClaudeId01PreToolUseObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', toolUseId: 'obs-tu-1-' + sessionId + '-' + primaryAgentId });
  rll.recordClaudeId01PreToolUseObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', toolUseId: 'obs-tu-2-' + sessionId + '-' + primaryAgentId });
  rll.recordClaudeId01SubagentStartObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', actionId: actionA });
  rll.recordClaudeId01PreToolUseObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', toolUseId: 'obs-tu-3-' + sessionId + '-' + primaryAgentId });
  rll.recordClaudeId01SubagentStartObservation(project, { sessionId, agentId: peerB, agentType: 'arch-platform', actionId: actionB });
}

function primeIncompleteProof(project, sessionId, worktreeId, planDigest, generationId, primaryAgentId) {
  const actionA = mintProofAction(project, worktreeId, planDigest, generationId, 'incomplete-' + primaryAgentId);
  rll.recordClaudeId01SubagentStartObservation(project, { sessionId, agentId: primaryAgentId, agentType: 'arch-platform', actionId: actionA });
}

function setupBase(project) {
  const sessionId = 'obs-session-' + crypto.randomBytes(4).toString('hex');
  const primaryAgentId = 'obs-proof-agent';
  const generation = rll.resolveSessionGeneration(project, { ok: true, provider: 'claude-hook', runtime_session_key: sessionId });
  assert.strictEqual(generation.ok, true, 'session generation must resolve: ' + JSON.stringify(generation));
  const worktreeId = rll.computeWorktreeId(project);
  const plan = rll.discoverPlan(project);
  assert.strictEqual(plan.ok, true, 'PLAN must resolve');
  return {
    sessionId, primaryAgentId, generationId: generation.generationId, worktreeId, planDigest: plan.planDigest,
  };
}

function targetEvent(base) {
  return { sessionId: base.sessionId, agentId: 'peer-custody-observed', agentType: 'arch-testing' };
}

function expireSessionGeneration(project, sessionId) {
  const recordPath = rll.sessionGenerationPathFor(project, { provider: 'claude-hook', runtime_session_key: sessionId });
  const obj = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const nowMs = Date.now();
  obj.created_at = new Date(nowMs - 7200000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  obj.expires_at = new Date(nowMs - 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  fs.writeFileSync(recordPath, JSON.stringify(obj), { mode: 0o600 });
  fs.chmodSync(recordPath, 0o600);
}

// ── 1. malformed event ──────────────────────────────────────────────────────

test('rejects non-exact or malformed observed event as INVALID with zero writes', () => {
  withProject((project) => {
    const before = snapshotRegistry(project);
    const malformed = [
      null,
      undefined,
      42,
      [],
      {},
      { sessionId: 's' },
      { sessionId: 's', agentId: 'a', agentType: 'arch-testing', extra: 'x' },
      { sessionId: '', agentId: 'a', agentType: 'arch-testing' },
      { sessionId: 's', agentId: '', agentType: 'arch-testing' },
      { sessionId: 's', agentId: 'a', agentType: 'not-a-canonical-role' },
      { sessionId: 1, agentId: 'a', agentType: 'arch-testing' },
    ];
    for (const event of malformed) {
      const result = rll.resolveClaudePeerObservedActorAuthority(project, event);
      assert.deepStrictEqual(result, { ok: false, reason: 'INVALID' });
    }
    assert.deepStrictEqual(snapshotRegistry(project), before);
  });
});

// ── 2. generation absent/expired ────────────────────────────────────────────

test('returns UNAVAILABLE when current claude-hook generation is absent or expired', () => {
  withProject((project) => {
    const absentEvent = { sessionId: 'never-had-generation', agentId: 'a', agentType: 'arch-testing' };
    const absentResult = rll.resolveClaudePeerObservedActorAuthority(project, absentEvent);
    assert.deepStrictEqual(absentResult, { ok: false, reason: 'UNAVAILABLE' });

    const base = setupBase(project);
    expireSessionGeneration(project, base.sessionId);
    const expiredResult = rll.resolveClaudePeerObservedActorAuthority(project, targetEvent(base));
    assert.deepStrictEqual(expiredResult, { ok: false, reason: 'UNAVAILABLE' });
  });
});

// ── 3. proof incomplete ─────────────────────────────────────────────────────

test('returns UNAVAILABLE when CLAUDE-ID-01 proof is incomplete', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeIncompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const result = rll.resolveClaudePeerObservedActorAuthority(project, targetEvent(base));
    assert.deepStrictEqual(result, { ok: false, reason: 'UNAVAILABLE' });
  });
});

// ── 4. fence exists ──────────────────────────────────────────────────────────

test('returns INVALID when the exact observed actor authority fence exists', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const event = targetEvent(base);
    const created = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    assert.strictEqual(created.ok, true);
    const fencePublish = rll.publishClaudeAuthorityFence(
      project, rll.computeClaudeAuthorityIdentityId(project, 'claude-hook', event.sessionId, event.agentId),
    );
    assert.strictEqual(fencePublish.ok, true, 'fence publish must succeed: ' + JSON.stringify(fencePublish));
    const result = rll.resolveClaudePeerObservedActorAuthority(project, event);
    assert.deepStrictEqual(result, { ok: false, reason: 'INVALID' });
  });
});

// ── 5. no matching binding ──────────────────────────────────────────────────

test('returns UNAVAILABLE when no current matching RoleActorBinding exists', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const result = rll.resolveClaudePeerObservedActorAuthority(project, targetEvent(base));
    assert.deepStrictEqual(result, { ok: false, reason: 'UNAVAILABLE' });
  });
});

// ── 6. ambiguous binding ────────────────────────────────────────────────────

test('returns INVALID when current matching RoleActorBinding is ambiguous', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const first = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    const second = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(second.ok, true);
    const result = rll.resolveClaudePeerObservedActorAuthority(project, targetEvent(base));
    assert.deepStrictEqual(result, { ok: false, reason: 'INVALID' });
  });
});

// ── 7. success ───────────────────────────────────────────────────────────────

test('returns exact authority for one unfenced proof-complete observed actor and one current matching RoleActorBinding', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const created = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    assert.strictEqual(created.ok, true);
    const event = targetEvent(base);
    const result = rll.resolveClaudePeerObservedActorAuthority(project, event);
    assert.strictEqual(result.ok, true, 'expected success: ' + JSON.stringify(result));
    assert.deepStrictEqual(Object.keys(result).sort(), ['authority', 'ok']);
    assert.strictEqual(result.authority.sessionId, event.sessionId);
    assert.strictEqual(result.authority.agentId, event.agentId);
    assert.strictEqual(result.authority.role, 'arch-testing');
    assert.strictEqual(result.authority.worktreeId, base.worktreeId);
    assert.strictEqual(result.authority.planDigest, base.planDigest);
    assert.strictEqual(result.authority.generationId, base.generationId);
    assert.strictEqual(result.authority.actorBinding.binding_id, created.binding.binding_id);
  });
});

// ── 8. lookup-only, no mutation ─────────────────────────────────────────────

test('is lookup-only and leaves the complete registry byte-for-byte unchanged on success and failure', () => {
  withProject((project) => {
    const base = setupBase(project);
    primeCompleteProof(project, base.sessionId, base.worktreeId, base.planDigest, base.generationId, base.primaryAgentId);
    const beforeFailure = snapshotRegistry(project);
    const failureResult = rll.resolveClaudePeerObservedActorAuthority(project, targetEvent(base));
    assert.deepStrictEqual(failureResult, { ok: false, reason: 'UNAVAILABLE' });
    assert.deepStrictEqual(snapshotRegistry(project), beforeFailure);

    const created = rll.createRoleActorBinding(project, 'arch-testing', base.worktreeId, base.planDigest, base.generationId, 120);
    assert.strictEqual(created.ok, true);
    const beforeSuccess = snapshotRegistry(project);
    const successResult = rll.resolveClaudePeerObservedActorAuthority(project, targetEvent(base));
    assert.strictEqual(successResult.ok, true, 'expected success: ' + JSON.stringify(successResult));
    assert.deepStrictEqual(snapshotRegistry(project), beforeSuccess);
  });
});
