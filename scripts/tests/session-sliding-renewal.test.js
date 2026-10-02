'use strict';

// Sliding session: the session generation and an actor's binding expire after ONE HOUR OF INACTIVITY (idle timeout) and never
// live beyond TWELVE HOURS from their creation (absolute timeout). Only a hook renews, after the identity proof has passed.
// The injectable clock moves this process's Date (the same offset the full-wave test gives its children).

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const rll = require('../lib/runtime-role-lifecycle.cjs');
const rc = require('../lib/runtime-consultation.cjs');
const renewal = require('../lib/runtime-session-renewal.cjs');
const { installConsumerFixture, toolkitHostContractAvailable } = require('./lib/consumer-runtime-fixture.cjs');
const { primeClaudeId01V2ActorProof } = require('./fixtures/runtime-claude-id01-v2-fixture.cjs');

const SKIP = toolkitHostContractAvailable() ? false : `no signed Claude host contract for ${process.platform} in this toolkit`;
const POSIX_ONLY_SKIP = SKIP || (process.platform === 'win32' ? 'POSIX directory barrier only' : false);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const RealDate = Date;
const clock = { offsetMs: 0 };
class OffsetDate extends RealDate {
  constructor(...args) { if (args.length === 0) super(RealDate.now() + clock.offsetMs); else super(...args); }
  static now() { return RealDate.now() + clock.offsetMs; }
}
global.Date = OffsetDate;

const SESSION = 'sliding-session';
const ROLE = 'arch-testing';
const TEST_FSYNC_PLATFORM_SYMBOL = Symbol.for('android-common-doc.runtime-session-renewal-fsync-platform');

function project() {
  const fixture = installConsumerFixture('L2');
  const root = fixture.consumerRoot;
  fs.mkdirSync(path.join(root, '.planning', 'wave-sliding'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'wave-sliding', 'PLAN.md'), '# sliding\n');
  spawnSync('git', ['switch', '-q', '-c', 'feature/sliding'], { cwd: root });
  return root;
}

function actor(root, agentId) {
  const generation = rll.resolveSessionGeneration(root, { ok: true, provider: 'claude-hook', runtime_session_key: SESSION });
  const plan = rll.discoverPlan(root);
  const mint = (suffix) => {
    const id = rll.generateActionId();
    const minted = rll.mintRoleLifecycleAction(root, id, 'role-spawn', 'claude-native', rll.computeRepoId(root), rll.computeWorktreeId(root),
      plan.planDigest, crypto.createHash('sha256').update('sliding:' + suffix).digest('hex'), generation.generationId, ROLE,
      rll.buildRoleSpawnPayload('claude-id01-probe', ROLE, ROLE, 'fixture', 'fixture'),
      new Date(Date.now() + 600000).toISOString().replace(/\.\d{3}Z$/, 'Z'));
    assert.strictEqual(minted.ok, true, JSON.stringify(minted));
    return id;
  };
  const a = mint('a-' + agentId); const b = mint('b-' + agentId);
  const o = { sessionId: SESSION, agentId, agentType: ROLE };
  rll.recordClaudeId01SubagentStartObservation(root, { ...o, actionId: a });
  rll.recordClaudeId01PreToolUseObservation(root, { ...o, toolUseId: 't1' + agentId });
  rll.recordClaudeId01PreToolUseObservation(root, { ...o, toolUseId: 't2' + agentId });
  rll.recordClaudeId01SubagentStartObservation(root, { ...o, actionId: a });
  rll.recordClaudeId01PreToolUseObservation(root, { ...o, toolUseId: 't3' + agentId });
  rll.recordClaudeId01SubagentStartObservation(root, { sessionId: SESSION, agentId: agentId + '-b', agentType: ROLE, actionId: b });
  primeClaudeId01V2ActorProof({ projectRoot: root, agentType: ROLE, sessionId: SESSION, agentId, actionId: a, prefix: 'sliding-v2', actorBindingTtlSeconds: 3600 });
  return { generation, plan, worktreeId: rll.computeWorktreeId(root) };
}

const proof = (root, ctx, agentId) => rll.checkClaudeId01ProofComplete(root, SESSION, ctx.worktreeId, ctx.plan.planDigest, ROLE, agentId);
const generationRecord = (root) => JSON.parse(fs.readFileSync(rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION }), 'utf8'));
const hookRenew = (root, agentId) => renewal.renewSessionActivityForHook(root, { sessionId: SESSION, agentId, agentType: ROLE });
const authorityIdentity = (root, agentId) => ({
  schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
  provider: 'claude-hook',
  repo_id: rll.computeRepoId(root),
  runtime_session_key: SESSION,
  agent_id: agentId,
});
function requesterRecord(root, agentId) {
  const classified = rll.classifyClaudeAuthorityForIdentity(root, authorityIdentity(root, agentId));
  assert.strictEqual(classified.ok, true, JSON.stringify(classified));
  assert.strictEqual(classified.state, 'ONE', JSON.stringify(classified));
  assert.strictEqual(classified.family, 'requester', JSON.stringify(classified));
  const recordPath = rll.requesterBindingPathFor(root, classified.binding.binding_id);
  return { path: recordPath, record: JSON.parse(fs.readFileSync(recordPath, 'utf8')) };
}

test('idle timeout: one hour without activity expires the proof, with the idle reason', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'idle-agent');
    assert.strictEqual(proof(root, ctx, 'idle-agent').ok, true);
    clock.offsetMs = 61 * MIN;
    assert.strictEqual(proof(root, ctx, 'idle-agent').ok, false, 'no activity for 61 minutes: the proof is gone');
    assert.strictEqual(rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION }).reason, 'session-generation-expired');
  } finally { clock.offsetMs = 0; }
});

test('verified activity every 30 minutes keeps the proof alive past the first hour, up to +5 h, with no respawn', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'live-agent');
    const created = generationRecord(root).created_at;
    for (let minutes = 30; minutes <= 5 * 60; minutes += 30) {
      clock.offsetMs = minutes * MIN;
      const renewal = hookRenew(root, 'live-agent');
      assert.strictEqual(renewal.reason, undefined, `renewal at +${minutes} min: ${JSON.stringify(renewal)}`);
      assert.strictEqual(proof(root, ctx, 'live-agent').ok, true, `proof alive at +${minutes} min`);
    }
    assert.strictEqual(generationRecord(root).generation_id, ctx.generation.generationId, 'the generation id never changes');
    assert.strictEqual(generationRecord(root).created_at, created);
  } finally { clock.offsetMs = 0; }
});

test('absolute timeout: continuous activity still ends at 12 hours from creation', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'abs-agent');
    for (let minutes = 30; minutes < 12 * 60; minutes += 30) { clock.offsetMs = minutes * MIN; hookRenew(root, 'abs-agent'); }
    clock.offsetMs = 12 * HOUR - MIN;
    assert.strictEqual(rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION }).ok, true, 'alive one minute before the absolute limit');
    clock.offsetMs = 12 * HOUR + MIN;
    const peek = rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION });
    assert.strictEqual(peek.reason, 'session-generation-absolute-expired');
    assert.strictEqual(proof(root, ctx, 'abs-agent').ok, false);
    const late = hookRenew(root, 'abs-agent');
    assert.strictEqual(late.renewed, false, 'nothing is renewed past the absolute limit');
  } finally { clock.offsetMs = 0; }
});

test('renewal is cadenced: no write while more than 3000 s of idle time remain', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  try {
    actor(root, 'cadence-agent');
    const before = fs.readFileSync(rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION }), 'utf8');
    let renewalLockAttempts = 0;
    fs.mkdirSync = function countRenewalLocks(candidate, ...args) {
      if (String(candidate).includes('.session-renewal') && String(candidate).endsWith('.lock')) renewalLockAttempts += 1;
      return realMkdirSync.call(this, candidate, ...args);
    };
    clock.offsetMs = 5 * MIN; // 55 minutes left
    assert.strictEqual(hookRenew(root, 'cadence-agent').renewed, false);
    assert.strictEqual(renewalLockAttempts, 0, 'the cadence fast path performs no lock attempt');
    assert.strictEqual(fs.readFileSync(rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION }), 'utf8'), before, 'the record was not rewritten');
    clock.offsetMs = 15 * MIN; // 45 minutes left: below the threshold
    assert.strictEqual(hookRenew(root, 'cadence-agent').renewed, true);
    assert.ok(renewalLockAttempts > 0, 'due renewal acquires coordination only after the cadence precheck');
  } finally { fs.mkdirSync = realMkdirSync; clock.offsetMs = 0; }
});

test('due session, actor and requester renewals use sibling coordination namespaces, never the primary record namespace', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  const realOpenSync = fs.openSync;
  const coordinationPaths = [];
  try {
    const ctx = actor(root, 'namespace-agent');
    const requester = rll.createRequesterBinding(
      root,
      { ok: true, provider: 'claude-hook', runtime_session_key: SESSION },
      'namespace-agent', ROLE, ctx.worktreeId, ctx.plan.planDigest, 3600,
    );
    assert.strictEqual(requester.ok, true, JSON.stringify(requester));
    const requesterBefore = requesterRecord(root, 'namespace-agent');
    clock.offsetMs = 15 * MIN;
    fs.mkdirSync = function observedMkdir(candidate, ...args) {
      if (String(candidate).includes('.session-renewal')) coordinationPaths.push(path.resolve(candidate));
      return realMkdirSync.call(this, candidate, ...args);
    };
    fs.openSync = function observedOpen(candidate, ...args) {
      if (String(candidate).includes('.session-renewal')) coordinationPaths.push(path.resolve(candidate));
      return realOpenSync.call(this, candidate, ...args);
    };

    const result = hookRenew(root, 'namespace-agent');
    assert.strictEqual(result.renewed, true, JSON.stringify(result));
    assert.ok(coordinationPaths.some((candidate) => candidate.endsWith('.lock')), 'a renewal lock was observed');
    assert.ok(coordinationPaths.some((candidate) => candidate.endsWith('.tmp')), 'a renewal replace temporary was observed');
    const primary = path.resolve(rll.registryRepoDir(root));
    for (const candidate of coordinationPaths) {
      const relative = path.relative(primary, candidate);
      assert.ok(relative === '..' || relative.startsWith('..' + path.sep), `coordination path escaped primary records: ${candidate}`);
    }
    const requesterAfter = requesterRecord(root, 'namespace-agent');
    assert.ok(Date.parse(requesterAfter.record.expiry) > Date.parse(requesterBefore.record.expiry), 'requester expiry was renewed too');
  } finally {
    fs.mkdirSync = realMkdirSync;
    fs.openSync = realOpenSync;
    clock.offsetMs = 0;
  }
});

test('deterministic renewal race revalidates cadence under lock and preserves the competing winner', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  try {
    actor(root, 'race-agent');
    const recordPath = rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION });
    clock.offsetMs = 15 * MIN;
    const winnerExpiry = new Date(Date.now() + 59 * MIN).toISOString().replace(/\.\d{3}Z$/, 'Z');
    let injected = false;
    fs.mkdirSync = function injectWinnerBeforeLock(candidate, ...args) {
      if (!injected && String(candidate).includes('.session-renewal') && String(candidate).endsWith('.lock')) {
        injected = true;
        const current = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
        fs.writeFileSync(recordPath, rc.canonicalJSONStringify({ ...current, expires_at: winnerExpiry }));
      }
      return realMkdirSync.call(this, candidate, ...args);
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(injected, true, 'the competing winner was injected after the unlocked precheck');
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.renewed, false, 'the under-lock cadence recheck avoids a redundant overwrite');
    assert.strictEqual(generationRecord(root).expires_at, winnerExpiry, 'the competing renewal remains authoritative');
  } finally {
    fs.mkdirSync = realMkdirSync;
    clock.offsetMs = 0;
  }
});

test('renewal lock contention is immediate best-effort maintenance and never fails a healthy hook', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  try {
    actor(root, 'contention-agent');
    clock.offsetMs = 15 * MIN;
    const before = generationRecord(root);
    fs.mkdirSync = function forceRenewalContention(candidate, ...args) {
      if (String(candidate).includes('.session-renewal') && String(candidate).endsWith('.lock')) {
        const error = new Error('deterministic renewal contention');
        error.code = 'EEXIST';
        throw error;
      }
      return realMkdirSync.call(this, candidate, ...args);
    };

    const started = process.hrtime.bigint();
    const direct = renewal.renewSessionGeneration(root, SESSION);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.deepStrictEqual(direct, { ok: true, renewed: false, contended: true });
    assert.ok(elapsedMs < 500, `contention is non-blocking, observed ${elapsedMs.toFixed(1)} ms`);
    const hook = hookRenew(root, 'contention-agent');
    assert.strictEqual(hook.renewed, false, JSON.stringify(hook));
    assert.strictEqual(hook.reason, undefined, 'contention is not surfaced as a hook failure');
    assert.deepStrictEqual(generationRecord(root), before, 'the contended attempt changes no record');
  } finally {
    fs.mkdirSync = realMkdirSync;
    clock.offsetMs = 0;
  }
});

test('a crash-orphaned renewal lock is reclaimed once and the due session renewal completes', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  let orphanLock = null;
  try {
    actor(root, 'orphan-agent');
    clock.offsetMs = 15 * MIN;
    fs.mkdirSync = function injectDeadOwner(candidate, ...args) {
      if (!orphanLock && String(candidate).includes('.session-renewal') && String(candidate).endsWith('.lock')) {
        orphanLock = path.resolve(candidate);
        realMkdirSync.call(this, candidate, ...args);
        fs.writeFileSync(path.join(candidate, 'owner.json'), rc.canonicalJSONStringify({
          schema: 'runtime/session-renewal-lock-owner/v1',
          token: 'a'.repeat(32),
          pid: 2147483647,
          created_at: new Date(Date.now() - MIN).toISOString().replace(/\.\d{3}Z$/, 'Z'),
          expires_at: new Date(Date.now() - 30 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        }));
        const error = new Error('simulated process crashed after publishing its lock owner');
        error.code = 'EEXIST';
        throw error;
      }
      return realMkdirSync.call(this, candidate, ...args);
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.renewed, true, JSON.stringify(result));
    assert.ok(orphanLock, 'the crash orphan was injected');
    assert.strictEqual(fs.existsSync(orphanLock), false, 'the recovered lock is released after publication');
  } finally {
    fs.mkdirSync = realMkdirSync;
    clock.offsetMs = 0;
  }
});

test('an expired renewal lease is reclaimed even when its PID is live', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  let expiredLock = null;
  try {
    actor(root, 'expired-lease-agent');
    clock.offsetMs = 15 * MIN;
    fs.mkdirSync = function injectExpiredLiveOwner(candidate, ...args) {
      if (!expiredLock && String(candidate).includes('.session-renewal') && String(candidate).endsWith('.lock')) {
        expiredLock = path.resolve(candidate);
        realMkdirSync.call(this, candidate, ...args);
        fs.writeFileSync(path.join(candidate, 'owner.json'), rc.canonicalJSONStringify({
          schema: 'runtime/session-renewal-lock-owner/v1',
          token: 'b'.repeat(32),
          pid: process.pid,
          created_at: new Date(Date.now() - MIN).toISOString().replace(/\.\d{3}Z$/, 'Z'),
          expires_at: new Date(Date.now() - 30 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        }));
        const error = new Error('simulated expired owner with a reused or paused PID');
        error.code = 'EEXIST';
        throw error;
      }
      return realMkdirSync.call(this, candidate, ...args);
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.renewed, true, JSON.stringify(result));
    assert.ok(expiredLock, 'the expired live-PID lease was injected');
    assert.strictEqual(fs.existsSync(expiredLock), false, 'the replacement owner releases its lock normally');
  } finally {
    fs.mkdirSync = realMkdirSync;
    clock.offsetMs = 0;
  }
});

test('an old holder whose owner token is replaced cannot publish its prepared renewal', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realMkdirSync = fs.mkdirSync;
  const realOpenSync = fs.openSync;
  const realFsyncSync = fs.fsyncSync;
  let lockDir = null;
  let tempFd = null;
  let takeoverInjected = false;
  try {
    actor(root, 'fenced-holder-agent');
    const before = generationRecord(root);
    clock.offsetMs = 15 * MIN;
    fs.mkdirSync = function observeRenewalLock(candidate, ...args) {
      if (String(candidate).includes('.session-renewal') && String(candidate).endsWith('.lock')) lockDir = path.resolve(candidate);
      return realMkdirSync.call(this, candidate, ...args);
    };
    fs.openSync = function observeRenewalTemp(candidate, ...args) {
      const fd = realOpenSync.call(this, candidate, ...args);
      if (String(candidate).includes('.session-renewal') && String(candidate).endsWith('.tmp')) tempFd = fd;
      return fd;
    };
    fs.fsyncSync = function replaceOwnerAfterPreparedFile(fd) {
      const result = realFsyncSync.call(this, fd);
      if (!takeoverInjected && fd === tempFd && lockDir) {
        takeoverInjected = true;
        const ownerPath = path.join(lockDir, 'owner.json');
        const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
        fs.writeFileSync(ownerPath, rc.canonicalJSONStringify({ ...owner, token: 'c'.repeat(32) }));
      }
      return result;
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(takeoverInjected, true, 'the owner token changed after the replacement file was prepared');
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.reason, 'lock-ownership-lost');
    assert.deepStrictEqual(generationRecord(root), before, 'the fenced former holder never renames its prepared file');
  } finally {
    fs.mkdirSync = realMkdirSync;
    fs.openSync = realOpenSync;
    fs.fsyncSync = realFsyncSync;
    if (lockDir) {
      try { fs.unlinkSync(path.join(lockDir, 'owner.json')); } catch { /* test cleanup */ }
      try { fs.rmdirSync(lockDir); } catch { /* test cleanup */ }
    }
    clock.offsetMs = 0;
  }
});

test('a sibling-temp publication failure is fail-closed and leaves the primary record unchanged', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realRenameSync = fs.renameSync;
  try {
    actor(root, 'write-failure-agent');
    const before = generationRecord(root);
    clock.offsetMs = 15 * MIN;
    fs.renameSync = function failRenewalRename(source, target) {
      if (String(source).includes('.session-renewal') && String(source).endsWith('.tmp')) {
        const error = new Error('deterministic publication failure');
        error.code = 'EIO';
        throw error;
      }
      return realRenameSync.call(this, source, target);
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.reason, 'rename-failed');
    assert.deepStrictEqual(generationRecord(root), before, 'the failed atomic publication did not alter the record');
  } finally {
    fs.renameSync = realRenameSync;
    clock.offsetMs = 0;
  }
});

test('the Windows fallback keeps file-fsync plus atomic rename without attempting an unsupported directory open', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realOpenSync = fs.openSync;
  let directoryOpenAttempts = 0;
  try {
    actor(root, 'windows-fsync-agent');
    clock.offsetMs = 15 * MIN;
    globalThis[TEST_FSYNC_PLATFORM_SYMBOL] = 'win32';
    fs.openSync = function observeDirectoryOpen(candidate, flags, ...args) {
      if (flags === 'r' || flags === 'r+') directoryOpenAttempts += 1;
      return realOpenSync.call(this, candidate, flags, ...args);
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.renewed, true, JSON.stringify(result));
    assert.strictEqual(directoryOpenAttempts, 0, 'Win32 fallback never opens a directory as a file');
  } finally {
    fs.openSync = realOpenSync;
    delete globalThis[TEST_FSYNC_PLATFORM_SYMBOL];
    clock.offsetMs = 0;
  }
});

test('a POSIX target-directory fsync failure preserves the exact durability reason', { skip: POSIX_ONLY_SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  const realOpenSync = fs.openSync;
  try {
    actor(root, 'dir-fsync-agent');
    clock.offsetMs = 15 * MIN;
    const recordPath = rll.sessionGenerationPathFor(root, { provider: 'claude-hook', runtime_session_key: SESSION });
    const targetDir = path.dirname(recordPath);
    fs.openSync = function failTargetDirectoryBarrier(candidate, flags, ...args) {
      if (path.resolve(String(candidate)) === path.resolve(targetDir) && flags === 'r') {
        const error = new Error('deterministic directory fsync failure');
        error.code = 'EIO';
        throw error;
      }
      return realOpenSync.call(this, candidate, flags, ...args);
    };

    const result = renewal.renewSessionGeneration(root, SESSION);
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.reason, 'directory-fsync-failed');
  } finally {
    fs.openSync = realOpenSync;
    clock.offsetMs = 0;
  }
});

test('only a verified identity renews: a fenced actor, an unknown agent id and a foreign role extend nothing', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'real-agent');
    clock.offsetMs = 40 * MIN;
    // Another identity that never proved itself.
    assert.strictEqual(hookRenew(root, 'impostor-agent').renewed, false);
    // The right agent id under a role it does not hold.
    assert.strictEqual(renewal.renewSessionActivityForHook(root, { sessionId: SESSION, agentId: 'real-agent', agentType: 'arch-platform' }).renewed, false);
    const untouched = generationRecord(root);
    assert.strictEqual(untouched.expires_at, ctx.generation.expiresAt, 'neither attempt extended the generation');
    // A fenced actor (returned): no renewal either.
    const identityId = rll.computeClaudeAuthorityIdentityId(root, 'claude-hook', SESSION, 'real-agent');
    assert.strictEqual(rll.publishClaudeAuthorityFence(root, identityId).ok, true);
    assert.strictEqual(hookRenew(root, 'real-agent').renewed, false);
    assert.strictEqual(generationRecord(root).expires_at, ctx.generation.expiresAt, 'a fenced actor extends nothing');
  } finally { clock.offsetMs = 0; }
});

test('immutable startup records carry an absolute lifetime and their digests never change across renewals', { skip: SKIP }, () => {
  const root = project(); clock.offsetMs = 0;
  try {
    const ctx = actor(root, 'digest-agent');
    const generation = rll.peekSessionGeneration(root, { provider: 'claude-hook', runtime_session_key: SESSION });
    const tracesDir = path.join(rll.registryRepoDir(root), 'claude-id01-traces');
    const traceFile = fs.readdirSync(tracesDir).find((name) => name.startsWith('startup-v2-'));
    const readTrace = () => JSON.parse(fs.readFileSync(path.join(tracesDir, traceFile), 'utf8'));
    const trace = readTrace();
    const absoluteLimit = Date.parse(generation.createdAt) + 12 * HOUR;
    assert.ok(Date.parse(trace.expiry) > Date.now() + 2 * HOUR, `trace expiry is absolute, not one hour: ${trace.expiry}`);
    assert.ok(Date.parse(trace.expiry) <= absoluteLimit, 'and never beyond the absolute limit');
    const digestBefore = rc.sha256String(rc.canonicalJSONStringify(trace));
    for (let minutes = 30; minutes <= 3 * 60; minutes += 30) { clock.offsetMs = minutes * MIN; hookRenew(root, 'digest-agent'); }
    assert.strictEqual(rc.sha256String(rc.canonicalJSONStringify(readTrace())), digestBefore, 'the trace was never rewritten');
    assert.strictEqual(proof(root, ctx, 'digest-agent').ok, true, 'and the capability that embeds its digest still verifies');
  } finally { clock.offsetMs = 0; }
});
