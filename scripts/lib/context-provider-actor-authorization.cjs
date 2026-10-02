'use strict';

// Durable architect -> mediated-recipient handoff authorization.
//
// Presentation names (`SendMessage.to`) and hook-observed `agent_type` are
// deliberately absent from the authority key. Claude may suffix either
// while retaining the same actor. Authority is instead bound to the exact
// host identity (session_id + agent_id), its durable actor binding, and the
// current worktree/PLAN/wave scope.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const rll = require('./runtime-role-lifecycle.cjs');
const rc = require('./runtime-consultation.cjs');

const SCHEMA = 'runtime/context-provider-actor-authorization/v1';
const ACTIVE_SCHEMA = 'runtime/context-provider-actor-authorization-active/v1';
const ARCHITECT_ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const MEDIATED_ROLES = Object.freeze(['planner', 'toolkit-specialist', 'test-specialist', 'verifier']);
const RECORD_KEYS = Object.freeze([
  'authorization_id', 'created_at', 'expires_at',
  'issuer_actor_instance_id', 'issuer_agent_id', 'issuer_role', 'issuer_session_id',
  'plan_digest', 'repo_id', 'schema',
  'target_actor_instance_id', 'target_agent_id', 'target_role', 'target_session_id',
  'wave_slug', 'worktree_id',
].sort());
const ACTIVE_KEYS = Object.freeze([...RECORD_KEYS.filter((key) => key !== 'schema'), 'activated_at', 'schema'].sort());

function exactKeys(value, expected) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function boundedString(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= max;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function currentScope(projectRoot) {
  try {
    const plan = rll.discoverPlan(projectRoot);
    if (!plan.ok || !boundedString(plan.planPath, 8192) || !/^[0-9a-f]{64}$/.test(plan.planDigest)) {
      return { ok: false, reason: 'scope-unavailable' };
    }
    const waveDir = path.basename(path.dirname(plan.planPath));
    if (!waveDir.startsWith('wave-') || waveDir.length <= 'wave-'.length) {
      return { ok: false, reason: 'scope-invalid' };
    }
    return {
      ok: true,
      repoId: rll.computeRepoId(projectRoot),
      worktreeId: rll.computeWorktreeId(projectRoot),
      planDigest: plan.planDigest,
      waveSlug: waveDir.slice('wave-'.length),
    };
  } catch {
    return { ok: false, reason: 'scope-invalid' };
  }
}

function resolveStableActor(projectRoot, identity) {
  if (!identity || !boundedString(identity.sessionId) || !boundedString(identity.agentId)) {
    return { ok: false, reason: 'actor-identity-invalid' };
  }
  let repoId;
  let scope;
  try {
    repoId = rll.computeRepoId(projectRoot);
    scope = currentScope(projectRoot);
  } catch { return { ok: false, reason: 'actor-scope-invalid' }; }
  if (!scope.ok) return scope;
  const observed = {
    schema: rll.CLAUDE_AUTHORITY_IDENTITY_SCHEMA,
    provider: 'claude-hook',
    repo_id: repoId,
    runtime_session_key: identity.sessionId,
    agent_id: identity.agentId,
  };
  let classified;
  try { classified = rll.classifyClaudeAuthorityForIdentity(projectRoot, observed); } catch {
    return { ok: false, reason: 'actor-authority-invalid' };
  }
  let binding = classified && classified.ok === true && classified.state === 'ONE'
    ? classified.binding
    : null;
  if (!binding && classified && classified.ok === true && classified.state === 'ABSENT') {
    // Persistent Claude SendMessage peers are represented by
    // ClaudePeerBinding rather than the request/one-shot families scanned by
    // classifyClaudeAuthorityForIdentity. Resolve that registry without any
    // observed agent_type hint: search the finite canonical role set, then
    // require exactly one record whose own stable agent_id matches.
    const matches = [];
    for (const role of rll.CANONICAL_ROLES) {
      const found = rll.findUniqueClaudePeerBindingForTarget(projectRoot, {
        sessionDigest: sha256(identity.sessionId),
        worktreeId: scope.worktreeId,
        planDigest: scope.planDigest,
        targetRole: role,
      });
      if (found.ok) {
        if (found.record.agent_id === identity.agentId) matches.push(found.record);
      } else if (found.reason !== 'UNAVAILABLE') {
        return { ok: false, reason: 'actor-authority-invalid' };
      }
    }
    if (matches.length === 1) {
      const peer = matches[0];
      binding = {
        role: peer.role,
        actor_instance_id: peer.actor_binding_id,
        worktree_id: peer.worktree_id,
        plan_digest: peer.plan_digest,
        expiry: peer.expiry,
      };
    } else if (matches.length > 1) {
      return { ok: false, reason: 'actor-authority-ambiguous' };
    }
  }
  if (!binding) return { ok: false, reason: 'actor-authority-unavailable' };
  if (!boundedString(binding.role) || !boundedString(binding.actor_instance_id)
      || !boundedString(binding.worktree_id) || !boundedString(binding.plan_digest)
      || !boundedString(binding.expiry)) {
    return { ok: false, reason: 'actor-authority-invalid' };
  }
  return {
    ok: true,
    sessionId: identity.sessionId,
    agentId: identity.agentId,
    role: binding.role,
    actorInstanceId: binding.actor_instance_id,
    worktreeId: binding.worktree_id,
    planDigest: binding.plan_digest,
    expiresAt: binding.expiry,
  };
}

function authorizationIdFor(scope, target) {
  return sha256(rc.canonicalJSONStringify([
    SCHEMA, scope.repoId, scope.worktreeId, scope.planDigest, scope.waveSlug,
    target.sessionId, target.agentId, target.actorInstanceId,
  ]));
}

function authorizationDir(projectRoot) {
  return path.join(rll.registryRepoDir(projectRoot), 'context-provider-actor-authorizations');
}

function pathsFor(projectRoot, authorizationId) {
  const dir = authorizationDir(projectRoot);
  return {
    dir,
    pending: path.join(dir, authorizationId + '.pending.json'),
    active: path.join(dir, authorizationId + '.active.json'),
    lock: path.join(dir, 'locks', authorizationId + '.lock'),
  };
}

function validateRecord(record, expectedSchema, expectedKeys, expectedId) {
  if (!exactKeys(record, expectedKeys) || record.schema !== expectedSchema
      || record.authorization_id !== expectedId
      || !/^[0-9a-f]{64}$/.test(record.authorization_id)
      || !/^[0-9a-f]{64}$/.test(record.repo_id)
      || !/^[0-9a-f]{64}$/.test(record.worktree_id)
      || !/^[0-9a-f]{64}$/.test(record.plan_digest)
      || !boundedString(record.wave_slug)
      || !ARCHITECT_ROLES.includes(record.issuer_role)
      || !MEDIATED_ROLES.includes(record.target_role)
      || !boundedString(record.issuer_session_id) || !boundedString(record.issuer_agent_id)
      || !boundedString(record.issuer_actor_instance_id)
      || !boundedString(record.target_session_id) || !boundedString(record.target_agent_id)
      || !boundedString(record.target_actor_instance_id)
      || !boundedString(record.created_at) || !boundedString(record.expires_at)
      || !Number.isFinite(Date.parse(record.created_at)) || !Number.isFinite(Date.parse(record.expires_at))
      || Date.parse(record.created_at) > Date.parse(record.expires_at)) {
    return { ok: false, reason: 'authorization-invalid' };
  }
  if (expectedSchema === ACTIVE_SCHEMA
      && (!boundedString(record.activated_at) || !Number.isFinite(Date.parse(record.activated_at)))) {
    return { ok: false, reason: 'authorization-invalid' };
  }
  return { ok: true, record };
}

function readAuthorization(file, schema, keys, id) {
  let read;
  try { read = rll.readRegistryRecord(file); } catch { return { ok: false, reason: 'authorization-unreadable' }; }
  if (!read.ok) return { ok: false, reason: 'authorization-unreadable' };
  if (read.absent) return { ok: false, reason: 'authorization-unavailable', absent: true };
  return validateRecord(read.obj, schema, keys, id);
}

function publishResolvedAuthorization(projectRoot, issuer, target) {
  const scope = currentScope(projectRoot);
  if (!scope.ok || !issuer || !target
      || !ARCHITECT_ROLES.includes(issuer.role) || !MEDIATED_ROLES.includes(target.role)
      || issuer.worktreeId !== scope.worktreeId || target.worktreeId !== scope.worktreeId
      || issuer.planDigest !== scope.planDigest || target.planDigest !== scope.planDigest
      || issuer.sessionId !== target.sessionId) {
    return { ok: false, reason: 'authorization-scope-invalid' };
  }
  const expiresMs = Math.min(Date.parse(issuer.expiresAt), Date.parse(target.expiresAt));
  if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
    return { ok: false, reason: 'authorization-expired' };
  }
  const id = authorizationIdFor(scope, target);
  const paths = pathsFor(projectRoot, id);
  const secured = rll.ensureSecureRegistryDir([paths.dir, path.dirname(paths.lock)]);
  if (!secured.ok) return { ok: false, reason: 'authorization-registry-invalid' };
  const record = {
    schema: SCHEMA,
    authorization_id: id,
    repo_id: scope.repoId,
    worktree_id: scope.worktreeId,
    plan_digest: scope.planDigest,
    wave_slug: scope.waveSlug,
    issuer_session_id: issuer.sessionId,
    issuer_agent_id: issuer.agentId,
    issuer_actor_instance_id: issuer.actorInstanceId,
    issuer_role: issuer.role,
    target_session_id: target.sessionId,
    target_agent_id: target.agentId,
    target_actor_instance_id: target.actorInstanceId,
    target_role: target.role,
    created_at: nowIso(),
    expires_at: new Date(expiresMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const valid = validateRecord(record, SCHEMA, RECORD_KEYS, id);
  if (!valid.ok) return valid;
  try {
    const locked = rll.withRegistryLock(paths.lock, () => {
      const existingActive = readAuthorization(paths.active, ACTIVE_SCHEMA, ACTIVE_KEYS, id);
      if (existingActive.ok) return { ok: true, authorizationId: id, reused: true, active: true };
      if (!existingActive.absent) return existingActive;
      const existing = readAuthorization(paths.pending, SCHEMA, RECORD_KEYS, id);
      if (existing.ok) return { ok: true, authorizationId: id, reused: true, active: false };
      if (!existing.absent) return existing;
      rc.publishNoClobber(paths.pending, Buffer.from(rc.canonicalJSONStringify(record), 'utf8'), {});
      return { ok: true, authorizationId: id, reused: false, active: false };
    });
    if (!locked.ok) return { ok: false, reason: locked.reason || 'authorization-lock-failed' };
    return locked.value;
  } catch {
    return { ok: false, reason: 'authorization-publish-failed' };
  }
}

function recordMediatedAuthorization(projectRoot, event, options = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
      || !boundedString(event.session_id) || !boundedString(event.agent_id)
      || !event.tool_response || event.tool_response.success !== true
      || !boundedString(event.tool_response.resumedAgentId)) {
    return { ok: false, reason: 'authorization-event-invalid' };
  }
  const resolver = options.resolveActor || resolveStableActor;
  const issuer = resolver(projectRoot, { sessionId: event.session_id, agentId: event.agent_id });
  if (!issuer.ok) return issuer;
  const target = resolver(projectRoot, { sessionId: event.session_id, agentId: event.tool_response.resumedAgentId });
  if (!target.ok) return target;
  return publishResolvedAuthorization(projectRoot, issuer, target);
}

function activateOrReadAuthorization(projectRoot, identity, options = {}) {
  const scope = currentScope(projectRoot);
  if (!scope.ok) return scope;
  const resolver = options.resolveActor || resolveStableActor;
  const target = resolver(projectRoot, identity);
  if (!target.ok || target.worktreeId !== scope.worktreeId || target.planDigest !== scope.planDigest
      || !MEDIATED_ROLES.includes(target.role)) {
    return { ok: false, reason: 'authorization-actor-invalid' };
  }
  const id = authorizationIdFor(scope, target);
  const paths = pathsFor(projectRoot, id);
  try {
    const locked = rll.withRegistryLock(paths.lock, () => {
      const active = readAuthorization(paths.active, ACTIVE_SCHEMA, ACTIVE_KEYS, id);
      const recordResult = active.ok ? active : readAuthorization(paths.pending, SCHEMA, RECORD_KEYS, id);
      if (!active.ok && !active.absent) return active;
      if (!recordResult.ok) return recordResult;
      const record = recordResult.record;
      if (record.repo_id !== scope.repoId || record.worktree_id !== scope.worktreeId
          || record.plan_digest !== scope.planDigest || record.wave_slug !== scope.waveSlug
          || record.target_session_id !== identity.sessionId || record.target_agent_id !== identity.agentId
          || record.target_actor_instance_id !== target.actorInstanceId || record.target_role !== target.role
          || Date.parse(record.expires_at) <= Date.now()) {
        return { ok: false, reason: 'authorization-mismatch' };
      }
      if (active.ok) return { ok: true, authorizationId: id, record, activated: false };
      const activated = { ...record, schema: ACTIVE_SCHEMA, activated_at: nowIso() };
      const validated = validateRecord(activated, ACTIVE_SCHEMA, ACTIVE_KEYS, id);
      if (!validated.ok) return validated;
      rc.publishNoClobber(paths.active, Buffer.from(rc.canonicalJSONStringify(activated), 'utf8'), {});
      return { ok: true, authorizationId: id, record: activated, activated: true };
    });
    if (!locked.ok) return { ok: false, reason: locked.reason || 'authorization-lock-failed' };
    return locked.value;
  } catch {
    return { ok: false, reason: 'authorization-activation-failed' };
  }
}

module.exports = Object.freeze({
  SCHEMA,
  ACTIVE_SCHEMA,
  ARCHITECT_ROLES,
  MEDIATED_ROLES,
  resolveStableActor,
  recordMediatedAuthorization,
  activateOrReadAuthorization,
  // Narrow construction seam for deterministic unit fixtures. Production
  // hooks call recordMediatedAuthorization, which resolves both actors from
  // the host-private authority registry before reaching this function.
  publishResolvedAuthorization,
  authorizationDir,
});
