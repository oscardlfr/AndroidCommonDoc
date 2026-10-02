'use strict';

// Sliding-session renewal, for HOOKS ONLY (never a CLI subcommand, never the model). Called at a PreToolUse once the event's own
// identity is known. Nothing is renewed unless the identity proof passes first:
//   - a subagent (agentId present): its full CLAUDE-ID-01 startup proof for the current PLAN (the check the gates use: fence,
//     binding, generation, capability); then its actor binding, its requester binding and the session generation slide;
//   - the top-level session (no agentId): the session generation slides if it is still live.
// Only an `expires_at`/`expiry` field is rewritten (atomic replace under the record's own lock), to now + idle TTL capped at
// created_at + absolute TTL, and only when less than the cadence threshold remains. An expired, fenced, foreign or
// absolute-expired record is never resurrected. Immutable records (startup trace, capability) are never touched.

const rll = require('./runtime-role-lifecycle.cjs');
const rc = require('./runtime-consultation.cjs');
const {
  SESSION_IDLE_TTL_SECONDS, SESSION_RENEW_BELOW_SECONDS, absoluteLimitMs,
} = require('./runtime-session-lifetime.cjs');

const GENERATION_KEYS = ['created_at', 'expires_at', 'generation_id', 'provider', 'runtime_session_key', 'schema'];
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

function renewRecord(recordPath, field, validate) {
  const locked = rll.withRegistryLock(recordPath + '.lock', () => {
    const valid = validate();
    if (!valid.ok) return { ok: false, renewed: false, reason: valid.reason };
    const renewed = renewedExpiry(valid.record.created_at, valid.record[field]);
    if (renewed === null) return { ok: true, renewed: false };
    const write = rll.writeRegistryRecordReplace(
      recordPath, Buffer.from(rc.canonicalJSONStringify({ ...valid.record, [field]: renewed }), 'utf8'),
    );
    return write.ok ? { ok: true, renewed: true, expiry: renewed } : { ok: false, renewed: false, reason: write.reason };
  }, { maxWaitMs: 2000 });
  return locked.ok ? locked.value : { ok: false, renewed: false, reason: locked.reason };
}

function renewSessionGeneration(projectRoot, sessionId) {
  const identity = { provider: 'claude-hook', runtime_session_key: sessionId };
  const recordPath = rll.sessionGenerationPathFor(projectRoot, identity);
  return renewRecord(recordPath, 'expires_at', () => {
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
  return renewRecord(recordPath, 'expiry', () => {
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
  return renewRecord(rll.requesterBindingPathFor(projectRoot, bindingId), 'expiry', () => {
    const valid = rll.validateRequesterBindingFor(projectRoot, bindingId, role, worktreeId, planDigest);
    return valid.ok ? { ok: true, record: valid.binding } : { ok: false, reason: valid.reason };
  });
}

/** @returns {{renewed:boolean, reason?:string}} */
function renewSessionActivityForHook(projectRoot, { sessionId, agentId, agentType } = {}) {
  try {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return { renewed: false, reason: 'session-id-invalid' };
    if (typeof agentId !== 'string' || agentId.length === 0) {
      const generation = renewSessionGeneration(projectRoot, sessionId);
      return { renewed: generation.renewed, reason: generation.reason };
    }
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok) return { renewed: false, reason: 'plan-not-discoverable' };
    const worktreeId = rll.computeWorktreeId(projectRoot);
    const proof = rll.checkClaudeId01ProofComplete(projectRoot, sessionId, worktreeId, plan.planDigest, agentType, agentId);
    if (!proof.ok || !proof.binding) return { renewed: false, reason: proof.reason || 'identity-proof-failed' };
    const binding = renewRoleActorBinding(projectRoot, proof.binding.binding_id, agentType, worktreeId, plan.planDigest);
    const generation = renewSessionGeneration(projectRoot, sessionId);
    const requester = renewRequesterBinding(projectRoot, sessionId, agentId, agentType, worktreeId, plan.planDigest);
    return {
      renewed: Boolean(binding.renewed || generation.renewed || requester.renewed),
      reason: binding.reason || generation.reason || (requester.ok ? undefined : requester.reason),
    };
  } catch {
    return { renewed: false, reason: 'renewal-failed' };
  }
}

module.exports = Object.freeze({ renewSessionActivityForHook, renewSessionGeneration, renewRoleActorBinding, renewRequesterBinding });
