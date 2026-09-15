'use strict';

function createClaudePeerBinding(deps) {
  const {
    ACTION_KIND_ENUM, ACTION_RUNTIME_ENUM, CANONICAL_ROLES, ROLE_ACTOR_BINDING_KEYS, ROLE_ACTOR_BINDING_SCHEMA,
    actionPathFor, canonicalJSONStringify, checkClaudeId01ProofComplete, computeClaudeAuthorityIdentityId,
    computeRepoId, computeWorktreeId, currentClockMsForRegistry, discoverPlan, ensureSecureRegistryDir, fs,
    generateActionId, hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64,
    isoPlusSecondsForRegistry, isoToMsForRegistry, nowIsoForRegistry, path, peekSessionGeneration,
    publishNoClobber, readClaudeAuthorityFence, readRegistryRecord, registryRepoDir, roleActorBindingPathFor,
    sha256String, validateRoleActorBindingFor, withRegistryLock,
  } = deps;

const CLAUDE_PEER_BINDING_SCHEMA = 'runtime/claude-peer-binding/v1';
const CLAUDE_PEER_BINDING_KEYS = Object.freeze([
  'actor_binding_id', 'agent_id', 'binding_id', 'created_at', 'expiry',
  'plan_digest', 'role', 'schema', 'session', 'teammate_name', 'worktree_id',
]);

function claudePeerBindingPathFor(projectRootOrRepoDescriptor, bindingId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-peer-bindings', bindingId + '.json');
}

function validateClaudePeerBindingRecord(record, bindingId) {
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'INVALID' };
  if (!record || !hasExactKeys(record, CLAUDE_PEER_BINDING_KEYS)) return { ok: false, reason: 'INVALID' };
  if (record.schema !== CLAUDE_PEER_BINDING_SCHEMA) return { ok: false, reason: 'INVALID' };
  if (!isHexActionId(record.binding_id) || record.binding_id !== bindingId) return { ok: false, reason: 'INVALID' };
  if (!isHexActionId(record.actor_binding_id)) return { ok: false, reason: 'INVALID' };
  if (typeof record.agent_id !== 'string' || record.agent_id.length === 0) return { ok: false, reason: 'INVALID' };
  if (typeof record.session !== 'string' || record.session.length === 0) return { ok: false, reason: 'INVALID' };
  if (typeof record.role !== 'string' || record.role.length === 0) return { ok: false, reason: 'INVALID' };
  if (typeof record.teammate_name !== 'string' || record.teammate_name.length === 0) return { ok: false, reason: 'INVALID' };
  if (!CANONICAL_ROLES.includes(record.role)) return { ok: false, reason: 'INVALID' };
  if (record.teammate_name !== record.role) return { ok: false, reason: 'INVALID' };
  if (!isHexDigest64(record.worktree_id) || !isHexDigest64(record.plan_digest)) return { ok: false, reason: 'INVALID' };
  if (!isCanonicalIsoUtc(record.created_at) || !isCanonicalIsoUtc(record.expiry)) return { ok: false, reason: 'INVALID' };
  const createdAtMs = isoToMsForRegistry(record.created_at);
  const expiryMs = isoToMsForRegistry(record.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'INVALID' };
  }
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'INVALID' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'INVALID' };
  return { ok: true, record };
}

function readClaudePeerBinding(projectRootOrRepoDescriptor, bindingId) {
  if (!isHexActionId(bindingId)) return { ok: false, reason: 'INVALID' };
  let read;
  try {
    read = readRegistryRecord(claudePeerBindingPathFor(projectRootOrRepoDescriptor, bindingId));
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (!read.ok) return { ok: false, reason: 'INVALID' };
  if (read.absent) return { ok: false, reason: 'UNAVAILABLE' };
  const validated = validateClaudePeerBindingRecord(read.obj, bindingId);
  if (!validated.ok) return { ok: false, reason: 'INVALID' };
  return validated;
}

// P3 U0A1B1A: lookup-only observed actor authority
const CLAUDE_PEER_BINDING_SCAN_CAP = 1024;

function findUniqueClaudePeerRoleActorBinding(projectRoot, expected) {
  try {
    const expectedKeys = ['generationId', 'planDigest', 'role', 'worktreeId'];
    if (!expected || typeof expected !== 'object' || Array.isArray(expected) || !hasExactKeys(expected, expectedKeys)) {
      return { ok: false, reason: 'INVALID' };
    }
    if (!CANONICAL_ROLES.includes(expected.role)) return { ok: false, reason: 'INVALID' };
    if (!isHexDigest64(expected.worktreeId) || !isHexDigest64(expected.planDigest)) return { ok: false, reason: 'INVALID' };
    if (!isHexCsprng32(expected.generationId)) return { ok: false, reason: 'INVALID' };

    const bindingsDir = path.join(registryRepoDir(projectRoot), 'role-actor-bindings');
    let entries;
    try {
      entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        entries = [];
      } else {
        return { ok: false, reason: 'INVALID' };
      }
    }
    if (entries.length > CLAUDE_PEER_BINDING_SCAN_CAP) return { ok: false, reason: 'INVALID' };
    const sorted = entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    const matches = [];
    for (const entry of sorted) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.name.endsWith('.json')) continue;
      if (!entry.isFile()) return { ok: false, reason: 'INVALID' };
      const id = entry.name.slice(0, -5);
      if (!isHexCsprng32(id)) return { ok: false, reason: 'INVALID' };
      const read = readRegistryRecord(roleActorBindingPathFor(projectRoot, id));
      if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'INVALID' };
      const record = read.obj;
      if (
        !hasExactKeys(record, ROLE_ACTOR_BINDING_KEYS)
        || record.schema !== ROLE_ACTOR_BINDING_SCHEMA
        || record.binding_id !== id
      ) {
        return { ok: false, reason: 'INVALID' };
      }
      // This lookup is scoped to one exact current generation. Historical
      // bindings are immutable registry history and may legitimately be
      // expired; validating their liveness before filtering by generation
      // made one old record poison every later SubagentStop park attempt.
      // Keep the scan fail-closed for malformed identity/scope fields, then
      // apply the exact scope filter before the live validator.
      if (
        !isHexActionId(record.actor_instance_id)
        || !CANONICAL_ROLES.includes(record.role)
        || !isHexDigest64(record.worktree_id)
        || !isHexDigest64(record.plan_digest)
        || !isHexCsprng32(record.session_generation_id)
      ) {
        return { ok: false, reason: 'INVALID' };
      }
      if (
        record.role !== expected.role
        || record.worktree_id !== expected.worktreeId
        || record.plan_digest !== expected.planDigest
        || record.session_generation_id !== expected.generationId
      ) {
        continue;
      }
      const validated = validateRoleActorBindingFor(projectRoot, id, record.role, record.worktree_id, record.plan_digest);
      if (!validated.ok) return { ok: false, reason: 'INVALID' };
      const binding = validated.binding;
      matches.push(binding);
    }
    if (matches.length === 0) return { ok: false, reason: 'UNAVAILABLE' };
    if (matches.length !== 1) return { ok: false, reason: 'INVALID' };
    return { ok: true, binding: matches[0] };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

function resolveClaudePeerObservedActorAuthority(projectRoot, event) {
  try {
    const eventKeys = ['agentId', 'agentType', 'sessionId'];
    if (!event || typeof event !== 'object' || Array.isArray(event) || !hasExactKeys(event, eventKeys)) {
      return { ok: false, reason: 'INVALID' };
    }
    if (
      typeof event.sessionId !== 'string' || event.sessionId.length === 0
      || typeof event.agentId !== 'string' || event.agentId.length === 0
      || typeof event.agentType !== 'string' || event.agentType.length === 0
      || !CANONICAL_ROLES.includes(event.agentType)
    ) {
      return { ok: false, reason: 'INVALID' };
    }

    const worktreeId = computeWorktreeId(projectRoot);
    const planResult = discoverPlan(projectRoot);
    if (!planResult.ok) return { ok: false, reason: 'INVALID' };
    const planDigest = planResult.planDigest;

    const generation = peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: event.sessionId });
    if (!generation.ok) {
      if (generation.reason === 'session-generation-absent' || generation.reason === 'session-generation-expired') {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
      return { ok: false, reason: 'INVALID' };
    }
    const generationId = generation.generationId;

    let proof;
    try {
      proof = checkClaudeId01ProofComplete(projectRoot, event.sessionId, worktreeId, planDigest, event.agentType, event.agentId);
    } catch (err) {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    if (!proof.ok) {
      // A published authority fence is an explicit revocation, not missing
      // evidence. Preserve that distinction at this public resolver boundary.
      return {
        ok: false,
        reason: proof.reason === 'claude-id01-actor-fenced' ? 'INVALID' : 'UNAVAILABLE',
      };
    }

    const fenceRead = readClaudeAuthorityFence(
      projectRoot, computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', event.sessionId, event.agentId),
    );
    if (!fenceRead.ok || !fenceRead.absent) return { ok: false, reason: 'INVALID' };

    const found = findUniqueClaudePeerRoleActorBinding(projectRoot, {
      role: event.agentType, worktreeId, planDigest, generationId,
    });
    if (!found.ok) return found;

    return {
      ok: true,
      authority: {
        sessionId: event.sessionId,
        agentId: event.agentId,
        role: event.agentType,
        worktreeId,
        planDigest,
        generationId,
        generationExpiresAt: generation.expiresAt,
        actorBinding: found.binding,
      },
    };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

// P3 Claude peer custody: correlates one exact live claude-native
// role-spawn/role-rebind action to one observed {session,agent,role} actor and
// mints/returns exactly one durable runtime/claude-peer-binding/v1 record.
const CLAUDE_PEER_EXPECTED_KEYS = Object.freeze(['planDigest', 'sessionDigest', 'targetRole', 'worktreeId']);
const CLAUDE_PEER_ACTION_KEYS = Object.freeze([
  'action_id', 'expires_at', 'kind', 'payload', 'plan_digest', 'policy_digest',
  'repo_id', 'role', 'runtime', 'schema', 'session_generation_id', 'worktree_id',
]);
const CLAUDE_PEER_SPAWN_PAYLOAD_KEYS = Object.freeze([
  'agent_type', 'bootstrap_artifact_ref', 'bootstrap_message', 'team_name', 'teammate_name',
]);
const CLAUDE_PEER_REBIND_PAYLOAD_KEYS = Object.freeze([
  'binding_id', 'bootstrap_artifact_ref', 'bootstrap_message', 'teammate_name',
]);

function validateClaudePeerExpected(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)
      || !hasExactKeys(expected, CLAUDE_PEER_EXPECTED_KEYS)) {
    return { ok: false, reason: 'INVALID' };
  }
  if (!isHexDigest64(expected.sessionDigest) || !isHexDigest64(expected.worktreeId)
      || !isHexDigest64(expected.planDigest) || !CANONICAL_ROLES.includes(expected.targetRole)) {
    return { ok: false, reason: 'INVALID' };
  }
  return { ok: true };
}

function scanClaudePeerBindingsForExpected(projectRoot, expected) {
  const dir = path.join(registryRepoDir(projectRoot), 'claude-peer-bindings');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, records: [] };
    return { ok: false, reason: 'INVALID' };
  }
  if (entries.length > CLAUDE_PEER_BINDING_SCAN_CAP) return { ok: false, reason: 'INVALID' };
  const records = [];
  for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
    const bindingId = entry.name.slice(0, -5);
    const read = readClaudePeerBinding(projectRoot, bindingId);
    if (!read.ok) return { ok: false, reason: 'INVALID' };
    const record = read.record;
    if (sha256String(record.session) === expected.sessionDigest
        && record.role === expected.targetRole
        && record.worktree_id === expected.worktreeId
        && record.plan_digest === expected.planDigest) {
      records.push(record);
    }
  }
  return { ok: true, records };
}

function findUniqueLiveClaudePeerAction(projectRoot, expected, options) {
  const dir = path.join(registryRepoDir(projectRoot), 'actions');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'UNAVAILABLE' };
    return { ok: false, reason: 'INVALID' };
  }
  if (entries.length > CLAUDE_PEER_BINDING_SCAN_CAP) return { ok: false, reason: 'INVALID' };
  const matches = [];
  const repoId = computeRepoId(projectRoot);
  for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
    const actionId = entry.name.slice(0, -5);
    const read = readRegistryRecord(actionPathFor(projectRoot, actionId));
    if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'INVALID' };
    const action = read.obj;
    if (!hasExactKeys(action, CLAUDE_PEER_ACTION_KEYS)
        || action.schema !== 'coordination/role-lifecycle-action/v1'
        || action.action_id !== actionId || !isHexActionId(action.action_id)
        || !ACTION_KIND_ENUM.includes(action.kind) || !ACTION_RUNTIME_ENUM.includes(action.runtime)
        || action.repo_id !== repoId || !isHexDigest64(action.worktree_id)
        || !isHexDigest64(action.plan_digest) || !isHexDigest64(action.policy_digest)
        || !isHexCsprng32(action.session_generation_id)
        || !(action.role === null || CANONICAL_ROLES.includes(action.role))
        || !isCanonicalIsoUtc(action.expires_at)
        || !action.payload || typeof action.payload !== 'object' || Array.isArray(action.payload)) {
      return { ok: false, reason: 'INVALID' };
    }
    // The observed proof path may retry a matching historical spawn after its
    // strict live-action scan; only expiry is relaxed by that explicit option.
    const ignoreExpiry = !!(options && options.ignoreExpiry === true);
    if (action.runtime !== 'claude-native'
        || (action.kind !== 'role-spawn' && action.kind !== 'role-rebind')
        || action.session_generation_id !== expected.generationId
        || action.role !== expected.role || action.worktree_id !== expected.worktreeId
        || action.plan_digest !== expected.planDigest
        || (!ignoreExpiry && currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at))) {
      continue;
    }
    if (action.kind === 'role-spawn') {
      if (!hasExactKeys(action.payload, CLAUDE_PEER_SPAWN_PAYLOAD_KEYS)
          || action.payload.agent_type !== expected.role
          || action.payload.teammate_name !== expected.role) continue;
    } else if (!hasExactKeys(action.payload, CLAUDE_PEER_REBIND_PAYLOAD_KEYS)
        || action.payload.binding_id !== expected.actorBindingId
        || action.payload.teammate_name !== expected.role) {
      continue;
    }
    matches.push(action);
  }
  if (matches.length === 0) return { ok: false, reason: 'UNAVAILABLE' };
  if (matches.length !== 1) return { ok: false, reason: 'INVALID' };
  return { ok: true, action: matches[0] };
}

function validateClaudePeerBindingFor(projectRoot, bindingId, expected) {
  try {
    if (!isHexActionId(bindingId)) return { ok: false, reason: 'INVALID' };
    const expectedValid = validateClaudePeerExpected(expected);
    if (!expectedValid.ok) return expectedValid;
    const read = readClaudePeerBinding(projectRoot, bindingId);
    if (!read.ok) return read;
    const record = read.record;
    if (sha256String(record.session) !== expected.sessionDigest
        || record.role !== expected.targetRole || record.teammate_name !== expected.targetRole
        || record.worktree_id !== expected.worktreeId || record.plan_digest !== expected.planDigest) {
      return { ok: false, reason: 'INVALID' };
    }
    const authorityResult = resolveClaudePeerObservedActorAuthority(projectRoot, {
      sessionId: record.session, agentId: record.agent_id, agentType: record.role,
    });
    if (!authorityResult.ok) return authorityResult;
    const authority = authorityResult.authority;
    if (authority.actorBinding.binding_id !== record.actor_binding_id
        || authority.worktreeId !== expected.worktreeId
        || authority.planDigest !== expected.planDigest || authority.role !== expected.targetRole) {
      return { ok: false, reason: 'INVALID' };
    }
    // The startup action proves authority only while creating this binding.
    // Once the peer record exists, its own bounded expiry plus the live
    // actor/generation/ID01/fence chain above govern liveness; expiring the
    // consumed short-lived action must not kill a retained peer.
    return { ok: true, record };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

function findUniqueClaudePeerBindingForTarget(projectRoot, expected) {
  try {
    const expectedValid = validateClaudePeerExpected(expected);
    if (!expectedValid.ok) return expectedValid;
    const scan = scanClaudePeerBindingsForExpected(projectRoot, expected);
    if (!scan.ok) return scan;
    if (scan.records.length === 0) return { ok: false, reason: 'UNAVAILABLE' };
    if (scan.records.length !== 1) return { ok: false, reason: 'INVALID' };
    return validateClaudePeerBindingFor(projectRoot, scan.records[0].binding_id, expected);
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

function ensureClaudePeerBindingForObservedActor(projectRoot, event) {
  try {
    const eventKeys = ['agentId', 'agentType', 'sessionId'];
    if (!event || typeof event !== 'object' || Array.isArray(event) || !hasExactKeys(event, eventKeys)
        || typeof event.sessionId !== 'string' || event.sessionId.length === 0
        || typeof event.agentId !== 'string' || event.agentId.length === 0
        || !CANONICAL_ROLES.includes(event.agentType)) {
      return { ok: false, reason: 'INVALID' };
    }
    const first = resolveClaudePeerObservedActorAuthority(projectRoot, event);
    if (!first.ok) return first;
    const authority = first.authority;
    const expected = {
      sessionDigest: sha256String(event.sessionId),
      worktreeId: authority.worktreeId,
      planDigest: authority.planDigest,
      targetRole: authority.role,
    };
    const lockKey = sha256String(canonicalJSONStringify([
      authority.generationId, authority.worktreeId, authority.planDigest,
      authority.role, event.agentId, authority.actorBinding.binding_id,
    ]));
    const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-peer-binding-' + lockKey + '.lock');
    const locked = withRegistryLock(lockDir, () => {
      const currentResult = resolveClaudePeerObservedActorAuthority(projectRoot, event);
      if (!currentResult.ok) return currentResult;
      const current = currentResult.authority;
      if (current.generationId !== authority.generationId || current.worktreeId !== authority.worktreeId
          || current.planDigest !== authority.planDigest || current.role !== authority.role
          || current.actorBinding.binding_id !== authority.actorBinding.binding_id) {
        return { ok: false, reason: 'INVALID' };
      }
      const peers = scanClaudePeerBindingsForExpected(projectRoot, expected);
      if (!peers.ok) return peers;
      if (peers.records.length > 1) return { ok: false, reason: 'INVALID' };
      if (peers.records.length === 1) {
        return validateClaudePeerBindingFor(projectRoot, peers.records[0].binding_id, expected);
      }
      const actionExpected = {
        actorBindingId: current.actorBinding.binding_id,
        generationId: current.generationId,
        planDigest: current.planDigest,
        role: current.role,
        worktreeId: current.worktreeId,
      };
      let action = findUniqueLiveClaudePeerAction(projectRoot, actionExpected);
      if (!action.ok && action.reason === 'UNAVAILABLE') {
        // No LIVE (unexpired) action correlates -- but `current` above already
        // proved a genuine RoleActorBinding + complete same-identity
        // CLAUDE-ID-01 proof for this exact actor. That authority chain does
        // not depend on the original short-lived role-spawn/rebind action
        // still being unexpired (P4 correction): retry ignoring ONLY expiry.
        action = findUniqueLiveClaudePeerAction(projectRoot, actionExpected, { ignoreExpiry: true });
      }
      if (!action.ok) return action;
      const createdAt = nowIsoForRegistry();
      const expiryMs = Math.min(
        isoToMsForRegistry(current.actorBinding.expiry),
        isoToMsForRegistry(current.generationExpiresAt),
        isoToMsForRegistry(isoPlusSecondsForRegistry(createdAt, 3600)),
      );
      if (!Number.isFinite(expiryMs) || expiryMs <= currentClockMsForRegistry()) {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
      const bindingId = generateActionId();
      const record = {
        actor_binding_id: current.actorBinding.binding_id,
        agent_id: event.agentId,
        binding_id: bindingId,
        created_at: createdAt,
        expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        plan_digest: current.planDigest,
        role: current.role,
        schema: CLAUDE_PEER_BINDING_SCHEMA,
        session: event.sessionId,
        teammate_name: current.role,
        worktree_id: current.worktreeId,
      };
      const staticValid = validateClaudePeerBindingRecord(record, bindingId);
      if (!staticValid.ok) return { ok: false, reason: 'INVALID' };
      const peerPath = claudePeerBindingPathFor(projectRoot, bindingId);
      const dirResult = ensureSecureRegistryDir(path.dirname(peerPath));
      if (!dirResult.ok) return { ok: false, reason: 'INVALID' };
      try {
        publishNoClobber(peerPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
      } catch (err) {
        return { ok: false, reason: 'INVALID' };
      }
      return validateClaudePeerBindingFor(projectRoot, bindingId, expected);
    }, { maxWaitMs: 5000 });
    if (!locked.ok || !locked.value) return { ok: false, reason: 'INVALID' };
    return locked.value;
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 Windows native-Claude persistence correction: runtime/claude-resume-
// handle/v1. A first ordinary SubagentStop for an exactly correlated
// persistent claude-sendmessage role actor parks the role as resumable
// WAITING instead of publishing the terminal authority fence -- this handle
// is the host-private, bounded, no-clobber artifact that authorizes ONLY the
// bootstrap SendMessage route for that exact actor (never requester/target
// authority) until the resumed SubagentStart consumes it. Tied to exact
// repo, session generation, raw session id, raw agent id, canonical role,
// worktree, PLAN digest and RoleActorBinding -- mirrors ClaudePeerBinding's
// own schema/scan/lock conventions closely, but is a genuinely separate
// registry (a resume handle is consumed-once history, never rewritten;
// idle-cycling mints a FRESH handle each time the prior one is consumed).
  return Object.freeze({
    CLAUDE_PEER_BINDING_SCHEMA, CLAUDE_PEER_BINDING_KEYS, claudePeerBindingPathFor,
    validateClaudePeerBindingRecord, readClaudePeerBinding, CLAUDE_PEER_BINDING_SCAN_CAP,
    findUniqueClaudePeerRoleActorBinding, resolveClaudePeerObservedActorAuthority,
    CLAUDE_PEER_EXPECTED_KEYS, CLAUDE_PEER_ACTION_KEYS, CLAUDE_PEER_SPAWN_PAYLOAD_KEYS,
    CLAUDE_PEER_REBIND_PAYLOAD_KEYS, validateClaudePeerExpected,
    scanClaudePeerBindingsForExpected, findUniqueLiveClaudePeerAction,
    validateClaudePeerBindingFor, findUniqueClaudePeerBindingForTarget,
    ensureClaudePeerBindingForObservedActor,
  });
}

module.exports = Object.freeze({ createClaudePeerBinding });
