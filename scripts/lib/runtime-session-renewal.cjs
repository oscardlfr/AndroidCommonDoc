'use strict';

// Sliding-session renewal, for HOOKS ONLY (never a CLI subcommand, never the model). Called at a PreToolUse once the event's own
// identity is known. Nothing is renewed unless the identity proof passes first:
//   - a subagent (agentId present): its full CLAUDE-ID-01 startup proof for the current PLAN (the check the gates use: fence,
//     binding, generation, capability); then its actor binding, its requester binding and the session generation slide;
//   - a policy-defined phase/wave actor without startup proof: the trusted native hook tuple, signed host scope, live
//     generation and unfenced authority classification suffice to slide only the generation. With valid startup proof,
//     its existing actor/requester bindings follow the full-proof path above.
//   - the top-level session (no agentId): the session generation slides if it is still live.
// Only an `expires_at`/`expiry` field is rewritten (atomic replace under the record's own lock), to now + idle TTL capped at
// created_at + absolute TTL, and only when less than the cadence threshold remains. An expired, fenced, foreign or
// absolute-expired record is never resurrected. Immutable records (startup trace, capability) are never touched.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const rll = require('./runtime-role-lifecycle.cjs');
const rc = require('./runtime-consultation.cjs');
const claudeHost = require('./runtime-host-claude.cjs');
const {
  SESSION_IDLE_TTL_SECONDS, SESSION_RENEW_BELOW_SECONDS, absoluteLimitMs,
} = require('./runtime-session-lifetime.cjs');

const GENERATION_KEYS = ['created_at', 'expires_at', 'generation_id', 'provider', 'runtime_session_key', 'schema'];
const RENEWAL_LOCK_OWNER_SCHEMA = 'runtime/session-renewal-lock-owner/v1';
const RENEWAL_LOCK_STALE_MS = 30 * 1000;
const TEST_FSYNC_PLATFORM_SYMBOL = Symbol.for('android-common-doc.runtime-session-renewal-fsync-platform');
const now = () => Date.now();
const isoSeconds = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const sameKeys = (obj, keys) => obj && typeof obj === 'object' && Object.keys(obj).sort().join() === keys.join();

/** The renewed expiry, or null when the record has plenty of idle time left or cannot be extended. */
function renewedExpiry(createdAt, expiresAt) {
  const nowMs = now();
  const expiresMs = Date.parse(expiresAt);
  if (expiresMs - nowMs >= SESSION_RENEW_BELOW_SECONDS * 1000) return null;
  const iso = isoSeconds(Math.min(nowMs + SESSION_IDLE_TTL_SECONDS * 1000, absoluteLimitMs(createdAt)));
  return Date.parse(iso) > expiresMs ? iso : null;
}

/*
 * Mutable records are enumerated by strict registry readers.  A lock directory
 * or replace temporary beside one of those records is therefore observable as
 * corrupt registry state.  Renewal coordination lives in a sibling namespace
 * instead: the primary repo namespace contains records, and only records.
 */
function renewalCoordinationPaths(projectRoot, recordPath) {
  const repoDir = path.resolve(rll.registryRepoDir(projectRoot));
  const resolvedRecord = path.resolve(recordPath);
  const relative = path.relative(repoDir, resolvedRecord);
  if (relative === '' || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
  const coordinationRoot = path.join(path.dirname(repoDir), '.' + path.basename(repoDir) + '.session-renewal');
  const recordKey = rc.sha256String(relative.split(path.sep).join('/'));
  return {
    lockDir: path.join(coordinationRoot, 'locks', recordKey + '.lock'),
    tempDir: path.join(coordinationRoot, 'tmp'),
  };
}

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) throw new Error('short-write');
    offset += written;
  }
}

function fsyncDirectory(dirPath) {
  const selectedPlatform = globalThis[TEST_FSYNC_PLATFORM_SYMBOL] === 'win32' ? 'win32' : process.platform;
  // Node/Win32 does not provide a portable directory handle that can be
  // fsync'd.  The durable file fsync and same-volume atomic rename remain the
  // supported Windows publication boundary (the same fallback used by the
  // signed-host contract writer).  POSIX must prove the directory barrier.
  if (selectedPlatform === 'win32') return true;
  let fd;
  try {
    fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return true;
  } catch {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
    return false;
  }
}

function writeRenewedRecord(recordPath, bytes, tempDir, stillOwnsLock) {
  const dirs = rll.ensureSecureRegistryDir([path.dirname(recordPath), tempDir]);
  if (!dirs.ok) return dirs;
  const tempPath = path.join(tempDir, path.basename(recordPath) + '.' + crypto.randomBytes(8).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(tempPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  } catch {
    return { ok: false, reason: 'temp-open-failed' };
  }
  try {
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
  } catch {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    return { ok: false, reason: 'write-failed' };
  }
  try { fs.closeSync(fd); } catch { /* already closed */ }
  if (!stillOwnsLock()) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    return { ok: false, reason: 'lock-ownership-lost' };
  }
  try {
    // The sibling namespace is on the same registry filesystem, so rename is
    // still the atomic publication boundary without exposing a primary temp.
    fs.renameSync(tempPath, recordPath);
  } catch {
    try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    return { ok: false, reason: 'rename-failed' };
  }
  if (!fsyncDirectory(path.dirname(recordPath))) return { ok: false, reason: 'directory-fsync-failed' };
  return { ok: true };
}

function lockOwnerPath(lockDir) {
  return path.join(lockDir, 'owner.json');
}

function readLockOwner(lockDir) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockOwnerPath(lockDir), 'utf8'));
    if (!owner || Object.keys(owner).sort().join() !== ['created_at', 'expires_at', 'pid', 'schema', 'token'].join()
      || owner.schema !== RENEWAL_LOCK_OWNER_SCHEMA || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || typeof owner.token !== 'string' || !/^[a-f0-9]{32}$/.test(owner.token)
      || typeof owner.created_at !== 'string' || !Number.isFinite(Date.parse(owner.created_at))
      || typeof owner.expires_at !== 'string' || !Number.isFinite(Date.parse(owner.expires_at))
      || Date.parse(owner.expires_at) <= Date.parse(owner.created_at)) return null;
    return owner;
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function lockOwnedBy(lockDir, token) {
  const owner = readLockOwner(lockDir);
  return Boolean(owner && owner.token === token && owner.pid === process.pid && now() < Date.parse(owner.expires_at));
}

function reclaimStaleRenewalLock(lockDir) {
  let stat;
  try {
    stat = fs.lstatSync(lockDir);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  const owner = readLockOwner(lockDir);
  const ageMs = owner ? 0 : now() - stat.mtimeMs;
  // A dead recorded process is a proven crash.  A live but expired owner is
  // also reclaimable: the opaque token fences that holder before publication.
  // An ownerless/torn lock gets a grace period so contenders cannot steal it
  // between mkdir and owner fsync.
  const reclaimable = owner
    ? (!processIsAlive(owner.pid) || now() >= Date.parse(owner.expires_at))
    : ageMs >= RENEWAL_LOCK_STALE_MS;
  if (!reclaimable) return false;
  const quarantine = lockDir + '.stale.' + crypto.randomBytes(8).toString('hex');
  try {
    fs.renameSync(lockDir, quarantine);
  } catch {
    return false;
  }
  // The exact, derived lock path is free atomically at rename.  Cleanup never
  // follows symlinks and does not affect acquisition correctness if it fails.
  try {
    const entries = fs.readdirSync(quarantine);
    if (entries.length === 1 && entries[0] === 'owner.json') fs.unlinkSync(path.join(quarantine, 'owner.json'));
    if (fs.readdirSync(quarantine).length === 0) fs.rmdirSync(quarantine);
  } catch { /* leave quarantined evidence for diagnosis */ }
  fsyncDirectory(path.dirname(lockDir));
  return true;
}

function publishLockOwner(lockDir, token) {
  const ownerPath = lockOwnerPath(lockDir);
  let fd;
  try {
    fd = fs.openSync(ownerPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    const createdAt = now();
    writeAll(fd, Buffer.from(rc.canonicalJSONStringify({
      schema: RENEWAL_LOCK_OWNER_SCHEMA,
      token,
      pid: process.pid,
      created_at: isoSeconds(createdAt),
      expires_at: isoSeconds(createdAt + RENEWAL_LOCK_STALE_MS),
    }), 'utf8'));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (!fsyncDirectory(lockDir)) return { ok: false, reason: 'lock-owner-fsync-failed' };
    return { ok: true };
  } catch {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* best effort */ }
    return { ok: false, reason: 'lock-owner-write-failed' };
  }
}

function tryWithRenewalLock(lockDir, fn) {
  const parent = rll.ensureSecureRegistryDir(path.dirname(lockDir));
  if (!parent.ok) return parent;
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      acquired = true;
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return { ok: false, reason: 'lock-create-failed' };
      if (attempt > 0 || !reclaimStaleRenewalLock(lockDir)) {
        // Another healthy hook is already doing the same best-effort
        // maintenance.  A PreToolUse never waits for it or fails because of it.
        return { ok: true, contended: true };
      }
    }
  }
  const secure = rll.ensureSecureRegistryDir(lockDir);
  if (!secure.ok) {
    try { fs.rmdirSync(lockDir); } catch { /* best effort */ }
    return secure;
  }
  const token = crypto.randomBytes(16).toString('hex');
  const ownerWrite = publishLockOwner(lockDir, token);
  if (!ownerWrite.ok) {
    try { fs.unlinkSync(lockOwnerPath(lockDir)); } catch { /* best effort */ }
    try { fs.rmdirSync(lockDir); } catch { /* best effort */ }
    return ownerWrite;
  }
  try {
    return { ok: true, value: fn(() => lockOwnedBy(lockDir, token)) };
  } finally {
    if (lockOwnedBy(lockDir, token)) {
      try { fs.unlinkSync(lockOwnerPath(lockDir)); } catch { /* best effort */ }
      try { fs.rmdirSync(lockDir); } catch { /* best effort */ }
      fsyncDirectory(path.dirname(lockDir));
    }
  }
}

function renewalCandidate(field, validate) {
  const valid = validate();
  if (!valid.ok) return { ok: false, renewed: false, reason: valid.reason };
  const expiry = renewedExpiry(valid.record.created_at, valid.record[field]);
  return expiry === null
    ? { ok: true, renewed: false }
    : { ok: true, renewed: true, expiry, record: valid.record };
}

function renewRecord(projectRoot, recordPath, field, validate) {
  // The common case performs no coordination at all.  This read-only cadence
  // check keeps every PreToolUse outside the lock until renewal is actually due.
  const precheck = renewalCandidate(field, validate);
  if (!precheck.ok || !precheck.renewed) return precheck;

  const coordination = renewalCoordinationPaths(projectRoot, recordPath);
  if (!coordination) return { ok: false, renewed: false, reason: 'renewal-record-outside-registry' };
  const locked = tryWithRenewalLock(coordination.lockDir, (stillOwnsLock) => {
    // A competing hook may have renewed the record after our precheck.  Always
    // re-prove identity/liveness and cadence while holding the publication lock.
    const current = renewalCandidate(field, validate);
    if (!current.ok || !current.renewed) return current;
    const write = writeRenewedRecord(
      recordPath,
      Buffer.from(rc.canonicalJSONStringify({ ...current.record, [field]: current.expiry }), 'utf8'),
      coordination.tempDir,
      stillOwnsLock,
    );
    return write.ok
      ? { ok: true, renewed: true, expiry: current.expiry }
      : { ok: false, renewed: false, reason: write.reason };
  });
  if (locked.ok && locked.contended) return { ok: true, renewed: false, contended: true };
  return locked.ok ? locked.value : { ok: false, renewed: false, reason: locked.reason };
}

function renewSessionGeneration(projectRoot, sessionId, verifyActivity) {
  const identity = { provider: 'claude-hook', runtime_session_key: sessionId };
  const recordPath = rll.sessionGenerationPathFor(projectRoot, identity);
  return renewRecord(projectRoot, recordPath, 'expires_at', () => {
    if (verifyActivity) {
      const activity = verifyActivity();
      if (!activity.ok) return activity;
    }
    const read = rll.readRegistryRecord(recordPath);
    if (!read.ok || read.absent) return { ok: false, reason: 'session-generation-absent' };
    // peekSessionGeneration is the live judge: expired, absolute-expired and malformed records are refused.
    const live = rll.peekSessionGeneration(projectRoot, identity);
    if (!live.ok) return { ok: false, reason: live.reason };
    const rec = read.obj;
    if (!sameKeys(rec, GENERATION_KEYS) || rec.runtime_session_key !== sessionId || rec.generation_id !== live.generationId) {
      return { ok: false, reason: 'session-generation-shape-invalid' };
    }
    return { ok: true, record: rec };
  });
}

function renewRoleActorBinding(projectRoot, bindingId, role, worktreeId, planDigest) {
  const recordPath = rll.roleActorBindingPathFor(projectRoot, bindingId);
  return renewRecord(projectRoot, recordPath, 'expiry', () => {
    const valid = rll.validateRoleActorBindingFor(projectRoot, bindingId, role, worktreeId, planDigest);
    return valid.ok ? { ok: true, record: valid.binding } : { ok: false, reason: valid.reason };
  });
}

function renewRequesterBinding(projectRoot, sessionId, agentId, role, worktreeId, planDigest) {
  const classified = rll.classifyClaudeAuthorityForIdentity(projectRoot, {
    schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
    repo_id: rll.computeRepoId(projectRoot), runtime_session_key: sessionId, agent_id: agentId,
  });
  if (!classified.ok || classified.state !== 'ONE' || classified.family !== 'requester' || !classified.binding) {
    return { ok: true, renewed: false, reason: 'no-live-requester-binding' };
  }
  const bindingId = classified.binding.binding_id;
  return renewRecord(projectRoot, rll.requesterBindingPathFor(projectRoot, bindingId), 'expiry', () => {
    const valid = rll.validateRequesterBindingFor(projectRoot, bindingId, role, worktreeId, planDigest);
    return valid.ok ? { ok: true, record: valid.binding } : { ok: false, reason: valid.reason };
  });
}

function canonicalObservedRole(agentType) {
  if (typeof agentType !== 'string' || Buffer.byteLength(agentType, 'utf8') > 512) return null;
  if (rll.CANONICAL_ROLES.includes(agentType)) return agentType;
  // Same harness instance convention as the native spawn boundary: N >= 2,
  // without leading zeroes or conversion of an unbounded number.
  const instance = /^(.+)-([1-9][0-9]*)$/.exec(agentType);
  if (!instance || (instance[2].length === 1 && instance[2] < '2')) return null;
  return rll.CANONICAL_ROLES.includes(instance[1]) ? instance[1] : null;
}

function checkPhaseActorSessionActivity(projectRoot, sessionId, agentId, role, worktreeId, planDigest) {
  const pair = rll.resolvePolicyPair(projectRoot);
  if (!pair.ok || !role || pair.policy.support_plane.includes(role)
      || (!pair.policy.phase_scoped_roles.includes(role) && !Object.hasOwn(pair.routing.routes, role))) {
    return { ok: false, reason: 'phase-actor-role-invalid' };
  }
  const currentPlan = rll.discoverPlan(projectRoot);
  if (!currentPlan.ok || currentPlan.planDigest !== planDigest || rll.computeWorktreeId(projectRoot) !== worktreeId) {
    return { ok: false, reason: 'phase-actor-scope-drift' };
  }
  const generation = rll.peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: sessionId });
  if (!generation.ok) return generation;
  const host = claudeHost.getProductionSessionIdentity(projectRoot, sessionId, { worktreeId, planDigest });
  if (!host.ok || !host.record || host.record.session_digest !== rc.sha256String(sessionId)
      || host.record.worktree_id !== worktreeId || host.record.plan_digest !== planDigest) {
    return { ok: false, reason: 'phase-actor-host-unproven' };
  }
  const authority = rll.classifyClaudeAuthorityForIdentity(projectRoot, {
    schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
    repo_id: rll.computeRepoId(projectRoot), runtime_session_key: sessionId, agent_id: agentId,
  });
  if (!authority.ok || !['ABSENT', 'ONE'].includes(authority.state)) {
    return { ok: false, reason: authority.reason || 'phase-actor-authority-invalid' };
  }
  if (authority.state === 'ONE' && (!authority.binding || authority.binding.role !== role
      || authority.binding.worktree_id !== worktreeId || authority.binding.plan_digest !== planDigest
      || authority.binding.session_generation_id !== generation.generationId)) {
    return { ok: false, reason: 'phase-actor-authority-scope-invalid' };
  }
  // This is session maintenance, never actor admission: ABSENT remains ABSENT,
  // no binding/grant is minted, and the normal tool gate still decides access.
  return { ok: true };
}

/** @returns {{renewed:boolean, reason?:string}} */
function renewSessionActivityForHook(projectRoot, { sessionId, agentId, agentType } = {}) {
  try {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || Buffer.byteLength(sessionId, 'utf8') > 512) return { renewed: false, reason: 'session-id-invalid' };
    if (agentId !== undefined && (typeof agentId !== 'string' || Buffer.byteLength(agentId, 'utf8') > 512)) {
      return { renewed: false, reason: 'agent-id-invalid' };
    }
    if (agentType !== undefined && agentType !== '' && (typeof agentId !== 'string' || agentId.length === 0)) {
      return { renewed: false, reason: 'agent-id-invalid' };
    }
    if (typeof agentId !== 'string' || agentId.length === 0) {
      const generation = renewSessionGeneration(projectRoot, sessionId);
      return { renewed: generation.renewed, reason: generation.reason };
    }
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) return { renewed: false, reason: 'plan-not-discoverable' };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const role = canonicalObservedRole(agentType);
    if (!role) return { renewed: false, reason: 'actor-role-invalid' };
    const phase = checkPhaseActorSessionActivity(projectRoot, sessionId, agentId, role, worktreeId, plan.planDigest);
    if (!phase.ok && phase.reason !== 'phase-actor-role-invalid') return { renewed: false, reason: phase.reason };
    const proof = rll.checkClaudeId01ProofComplete(projectRoot, sessionId, worktreeId, plan.planDigest, role, agentId);
    if (!proof.ok || !proof.binding) {
      if (!phase.ok) return { renewed: false, reason: proof.reason || 'identity-proof-failed' };
      // No persistent proof is required for a native phase actor, but an
      // existing expired binding is never renewed or replaced by this path.
      const generation = renewSessionGeneration(projectRoot, sessionId, () =>
        checkPhaseActorSessionActivity(projectRoot, sessionId, agentId, role, worktreeId, plan.planDigest));
      return { renewed: generation.renewed, reason: generation.reason };
    }
    // A phase role can also own a genuine startup capability. Preserve all
    // of its existing sliding records rather than taking the phase-only path.
    const binding = renewRoleActorBinding(projectRoot, proof.binding.binding_id, role, worktreeId, plan.planDigest);
    const generation = renewSessionGeneration(projectRoot, sessionId, phase.ok ? () =>
      checkPhaseActorSessionActivity(projectRoot, sessionId, agentId, role, worktreeId, plan.planDigest) : undefined);
    const requester = renewRequesterBinding(projectRoot, sessionId, agentId, role, worktreeId, plan.planDigest);
    return {
      renewed: Boolean(binding.renewed || generation.renewed || requester.renewed),
      reason: binding.reason || generation.reason || (requester.ok ? undefined : requester.reason),
    };
  } catch {
    return { renewed: false, reason: 'renewal-failed' };
  }
}

module.exports = Object.freeze({ renewSessionActivityForHook, renewSessionGeneration, renewRoleActorBinding, renewRequesterBinding });
