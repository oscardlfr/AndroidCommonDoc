'use strict';

function createClaudeResumeRecord(deps) {
  const {
    CANONICAL_ROLES,
    canonicalJSONStringify,
    CLAUDE_STARTUP_ACTOR_KEYS,
    CLAUDE_STARTUP_ACTOR_SCHEMA,
    claudeStartupActorPathFor,
    computeClaudeAuthorityIdentityId,
    computeWorktreeId,
    currentClockMsForRegistry,
    discoverPlan,
    findUniqueClaudePeerRoleActorBinding,
    fs,
    ensureSecureRegistryDir,
    hasExactKeys,
    isCanonicalIsoUtc,
    isHexActionId,
    isHexCsprng32,
    isHexDigest64,
    isClaudeId01RawTraceWellFormed,
    isoToMsForRegistry,
    path,
    peekSessionGeneration,
    readClaudeAuthorityFence,
    readRegistryRecord,
    registryRepoDir,
    publishNoClobber,
    sha256String,
    validateRoleActorBindingFor,
  } = deps;

const CLAUDE_RESUME_HANDLE_SCHEMA = 'runtime/claude-resume-handle/v1';
const CLAUDE_RESUME_HANDLE_KEYS = Object.freeze([
  'actor_binding_id', 'agent_id', 'binding_id', 'created_at', 'expiry',
  'plan_digest', 'role', 'schema', 'session', 'session_generation_id',
  'teammate_name', 'worktree_id',
]);
const CLAUDE_RESUME_HANDLE_SCAN_CAP = 1024;
const CLAUDE_SUPPORT_ROLE_TERMINAL_SCHEMA = 'runtime/claude-support-role-terminal/v1';
const CLAUDE_SUPPORT_ROLE_TERMINAL_KEYS = Object.freeze([
  'actor_binding_id', 'agent_digest', 'authority_identity_id', 'fenced_at',
  'plan_digest', 'role', 'schema', 'session_digest', 'session_generation_id',
  'worktree_id',
]);

function claudeSupportRoleTerminalPathFor(projectRootOrRepoDescriptor, expected) {
  const key = sha256String(canonicalJSONStringify([
    expected.sessionGenerationId, expected.worktreeId, expected.planDigest, expected.role,
    expected.actorBindingId,
  ]));
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-support-role-terminals', key + '.json');
}

function readClaudeSupportRoleTerminal(projectRoot, expected) {
  const read = readRegistryRecord(claudeSupportRoleTerminalPathFor(projectRoot, expected));
  if (!read.ok) return { ok: false, reason: 'terminal-read-failed' };
  if (read.absent) return { ok: true, absent: true };
  const record = read.obj;
  if (!record || !hasExactKeys(record, CLAUDE_SUPPORT_ROLE_TERMINAL_KEYS)
      || record.schema !== CLAUDE_SUPPORT_ROLE_TERMINAL_SCHEMA
      || record.session_generation_id !== expected.sessionGenerationId
      || record.worktree_id !== expected.worktreeId
      || record.plan_digest !== expected.planDigest || record.role !== expected.role
      || record.actor_binding_id !== expected.actorBindingId
      || !isHexActionId(record.actor_binding_id)
      || !isHexDigest64(record.session_digest) || !isHexDigest64(record.agent_digest)
      || !isHexDigest64(record.authority_identity_id) || !isCanonicalIsoUtc(record.fenced_at)) {
    return { ok: false, reason: 'terminal-shape-invalid' };
  }
  const fence = readClaudeAuthorityFence(projectRoot, record.authority_identity_id);
  if (!fence.ok || fence.absent || fence.fence.fenced_at !== record.fenced_at) {
    return { ok: false, reason: 'terminal-fence-invalid' };
  }
  return { ok: true, absent: false, record };
}

/** Persist the scope-to-fence join before best-effort raw trace cleanup. */
function publishClaudeSupportRoleTerminal(projectRoot, event) {
  try {
    if (!event || typeof event.sessionId !== 'string' || event.sessionId.length === 0
        || typeof event.agentId !== 'string' || event.agentId.length === 0
        || !CANONICAL_ROLES.includes(event.agentType)) return { ok: false, reason: 'terminal-event-invalid' };
    const worktreeId = computeWorktreeId(projectRoot);
    const generation = peekSessionGeneration(projectRoot, {
      provider: 'claude-hook', runtime_session_key: event.sessionId,
    });
    if (!generation.ok) return { ok: false, reason: 'terminal-scope-invalid' };
    const startupRead = readRegistryRecord(
      claudeStartupActorPathFor(projectRoot, generation.generationId, event.agentId),
    );
    // Not every canonical phase-scoped Claude agent is a persistent
    // RoleActorBinding. Absence is therefore a legitimate no-op; a present
    // but malformed startup record is never silently ignored.
    if (!startupRead.ok) return { ok: false, reason: 'terminal-startup-read-failed' };
    if (startupRead.absent) return { ok: true, skipped: true };
    if (!startupRead.obj || !hasExactKeys(startupRead.obj, CLAUDE_STARTUP_ACTOR_KEYS)) {
      return { ok: false, reason: 'terminal-startup-absent' };
    }
    const startup = startupRead.obj;
    if (startup.schema !== CLAUDE_STARTUP_ACTOR_SCHEMA
        || !isHexActionId(startup.action_id) || !isHexActionId(startup.actor_binding_id)
        || !isHexDigest64(startup.action_digest) || !isHexDigest64(startup.claim_digest)
        || !isHexDigest64(startup.host_contract_digest) || !isHexDigest64(startup.plan_digest)
        || !isHexDigest64(startup.worktree_id) || !isHexDigest64(startup.session_digest)
        || !isHexDigest64(startup.agent_digest) || !isHexDigest64(startup.session_generation_digest)
        || !isCanonicalIsoUtc(startup.created_at) || !isCanonicalIsoUtc(startup.expiry)
        || isoToMsForRegistry(startup.created_at) > currentClockMsForRegistry()
        || currentClockMsForRegistry() >= isoToMsForRegistry(startup.expiry)
        || startup.session_digest !== sha256String(event.sessionId)
        || startup.agent_digest !== sha256String(event.agentId)
        || startup.session_generation_digest !== sha256String(generation.generationId)
        || startup.worktree_id !== worktreeId
        || startup.role !== event.agentType) return { ok: false, reason: 'terminal-startup-mismatch' };
    const actor = findUniqueClaudePeerRoleActorBinding(projectRoot, {
      generationId: generation.generationId, planDigest: startup.plan_digest,
      role: event.agentType, worktreeId,
    });
    if (!actor.ok || startup.actor_binding_id !== actor.binding.binding_id) {
      return { ok: false, reason: 'terminal-actor-invalid' };
    }
    const authorityIdentityId = computeClaudeAuthorityIdentityId(
      projectRoot, 'claude-hook', event.sessionId, event.agentId,
    );
    const fence = readClaudeAuthorityFence(projectRoot, authorityIdentityId);
    if (!fence.ok || fence.absent) return { ok: false, reason: 'terminal-fence-absent' };
    const record = {
      schema: CLAUDE_SUPPORT_ROLE_TERMINAL_SCHEMA,
      session_generation_id: generation.generationId,
      worktree_id: worktreeId,
      plan_digest: startup.plan_digest,
      role: event.agentType,
      actor_binding_id: actor.binding.binding_id,
      session_digest: startup.session_digest,
      agent_digest: startup.agent_digest,
      authority_identity_id: authorityIdentityId,
      fenced_at: fence.fence.fenced_at,
    };
    const terminalPath = claudeSupportRoleTerminalPathFor(projectRoot, {
      sessionGenerationId: generation.generationId, worktreeId,
      planDigest: startup.plan_digest, role: event.agentType,
      actorBindingId: actor.binding.binding_id,
    });
    const secured = ensureSecureRegistryDir(path.dirname(terminalPath));
    if (!secured.ok) return { ok: false, reason: 'terminal-dir-invalid' };
    try { publishNoClobber(terminalPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {}); }
    catch {
      const existing = readClaudeSupportRoleTerminal(projectRoot, {
        sessionGenerationId: generation.generationId, worktreeId,
        planDigest: startup.plan_digest, role: event.agentType,
        actorBindingId: actor.binding.binding_id,
      });
      return existing.ok && !existing.absent
        && canonicalJSONStringify(existing.record) === canonicalJSONStringify(record)
        ? { ok: true, record: existing.record, idempotent: true }
        : { ok: false, reason: 'terminal-conflict' };
    }
    return { ok: true, record, idempotent: false };
  } catch {
    return { ok: false, reason: 'terminal-publish-failed' };
  }
}

/**
 * Reconciles the durable READY/WAITING/BUSY projection with the exact
 * hook-observed Claude actor identity.  RoleBinding is intentionally not an
 * actor identity, so callers must not treat its state as liveness by itself.
 *
 * A startup record is joined to the raw CLAUDE-ID-01 trace by the two
 * one-way identity digests.  That gives us the raw session/agent tuple
 * needed to read the immutable authority fence.  A fenced actor is proven
 * ABSENT. An exact, unexpired startup/raw observation without a fence remains
 * the bounded positive evidence accepted by the current host contract; once
 * it expires it is history and fails closed. Missing, ambiguous, expired, or
 * cross-boundary evidence fails closed too.
 */
function classifyClaudeSupportRoleLiveness(projectRoot, expected) {
  try {
    const expectedKeys = ['generationId', 'planDigest', 'role', 'runtimeSessionKey', 'worktreeId'];
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)
        || !hasExactKeys(expected, expectedKeys)
        || !isHexCsprng32(expected.generationId)
        || !isHexDigest64(expected.worktreeId)
        || !isHexDigest64(expected.planDigest)
        || !CANONICAL_ROLES.includes(expected.role)
        || typeof expected.runtimeSessionKey !== 'string' || expected.runtimeSessionKey.length === 0) {
      return { ok: false, status: 'INVALID', reason: 'expected-scope-invalid' };
    }
    const actor = findUniqueClaudePeerRoleActorBinding(projectRoot, {
      generationId: expected.generationId,
      planDigest: expected.planDigest,
      role: expected.role,
      worktreeId: expected.worktreeId,
    });
    if (!actor.ok) return { ok: false, status: 'INVALID', reason: 'actor-binding-' + actor.reason.toLowerCase() };
    const terminal = readClaudeSupportRoleTerminal(projectRoot, {
      sessionGenerationId: expected.generationId, worktreeId: expected.worktreeId,
      planDigest: expected.planDigest, role: expected.role,
      actorBindingId: actor.binding.binding_id,
    });
    if (!terminal.ok) return { ok: false, status: 'INVALID', reason: terminal.reason };
    if (!terminal.absent) {
      return { ok: true, status: 'ABSENT', actorBindingId: terminal.record.actor_binding_id };
    }

    const traceDir = path.join(registryRepoDir(projectRoot), 'claude-id01-traces');
    let entries;
    try { entries = fs.readdirSync(traceDir, { withFileTypes: true }); }
    catch (error) {
      return error && error.code === 'ENOENT'
        ? { ok: false, status: 'INVALID', reason: 'actor-trace-absent' }
        : { ok: false, status: 'INVALID', reason: 'actor-trace-unreadable' };
    }
    if (entries.length > CLAUDE_RESUME_HANDLE_SCAN_CAP) {
      return { ok: false, status: 'INVALID', reason: 'actor-trace-scan-cap' };
    }
    const startup = [];
    const raw = [];
    for (const entry of entries.slice().sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        return { ok: false, status: 'INVALID', reason: 'actor-trace-entry-invalid' };
      }
      const read = readRegistryRecord(path.join(traceDir, entry.name));
      if (!read.ok || read.absent || !read.obj) {
        return { ok: false, status: 'INVALID', reason: 'actor-trace-read-failed' };
      }
      const record = read.obj;
      if (record.schema === CLAUDE_STARTUP_ACTOR_SCHEMA) {
        if (!hasExactKeys(record, CLAUDE_STARTUP_ACTOR_KEYS)) {
          return { ok: false, status: 'INVALID', reason: 'startup-trace-shape-invalid' };
        }
        if (record.session_generation_digest === sha256String(expected.generationId)
            && record.worktree_id === expected.worktreeId
            && record.plan_digest === expected.planDigest
            && record.role === expected.role) startup.push(record);
      } else if (record.schema === 'runtime/claude-id01-trace/v1') {
        const potentiallyCorrelated = record.agent_type === expected.role
          && record.worktree_id === expected.worktreeId
          && record.plan_digest === expected.planDigest;
        if (!potentiallyCorrelated) continue;
        if (!isClaudeId01RawTraceWellFormed(record)) {
          return { ok: false, status: 'INVALID', reason: 'raw-identity-shape-invalid' };
        }
        if (currentClockMsForRegistry() >= isoToMsForRegistry(record.expiry)) continue;
        raw.push(record);
      }
    }
    if (startup.length !== 1) {
      return { ok: false, status: 'INVALID', reason: startup.length === 0 ? 'startup-trace-absent' : 'startup-trace-ambiguous' };
    }
    const observed = startup[0];
    if (!isHexActionId(observed.actor_binding_id)
        || !isHexDigest64(observed.session_digest)
        || !isHexDigest64(observed.agent_digest)
        || !isCanonicalIsoUtc(observed.created_at)
        || !isCanonicalIsoUtc(observed.expiry)
        || currentClockMsForRegistry() >= isoToMsForRegistry(observed.expiry)
        || observed.actor_binding_id !== actor.binding.binding_id
        || observed.session_digest !== sha256String(expected.runtimeSessionKey)) {
      return { ok: false, status: 'INVALID', reason: 'actor-identity-mismatch' };
    }
    const identities = raw.filter((record) => record
      && record.agent_type === expected.role
      && record.worktree_id === expected.worktreeId
      && record.plan_digest === expected.planDigest
      && sha256String(record.session_id) === observed.session_digest
      && sha256String(record.agent_id) === observed.agent_digest);
    if (identities.length !== 1) {
      return { ok: false, status: 'INVALID', reason: identities.length === 0 ? 'raw-identity-absent' : 'raw-identity-ambiguous' };
    }
    const identity = identities[0];
    const fence = readClaudeAuthorityFence(projectRoot,
      computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', identity.session_id, identity.agent_id));
    if (!fence.ok) return { ok: false, status: 'INVALID', reason: 'authority-fence-invalid' };
    return fence.absent
      ? { ok: true, status: 'LIVE', actorBindingId: actor.binding.binding_id }
      : { ok: true, status: 'ABSENT', actorBindingId: actor.binding.binding_id };
  } catch {
    return { ok: false, status: 'INVALID', reason: 'actor-liveness-internal' };
  }
}

function claudeResumeHandlePathFor(projectRootOrRepoDescriptor, handleId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'claude-resume-handles', handleId + '.json');
}

function claudeResumeHandleConsumedMarkerPathFor(projectRootOrRepoDescriptor, handleId) {
  return claudeResumeHandlePathFor(projectRootOrRepoDescriptor, handleId) + '.consumed';
}

function validateClaudeResumeHandleRecordShape(record, handleId) {
  if (!isHexActionId(handleId)) return { ok: false, reason: 'INVALID' };
  if (!record || !hasExactKeys(record, CLAUDE_RESUME_HANDLE_KEYS)) return { ok: false, reason: 'INVALID' };
  if (record.schema !== CLAUDE_RESUME_HANDLE_SCHEMA) return { ok: false, reason: 'INVALID' };
  if (!isHexActionId(record.binding_id) || record.binding_id !== handleId) return { ok: false, reason: 'INVALID' };
  if (!isHexActionId(record.actor_binding_id)) return { ok: false, reason: 'INVALID' };
  if (typeof record.session !== 'string' || record.session.length === 0) return { ok: false, reason: 'INVALID' };
  if (typeof record.agent_id !== 'string' || record.agent_id.length === 0) return { ok: false, reason: 'INVALID' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'INVALID' };
  if (typeof record.role !== 'string' || !CANONICAL_ROLES.includes(record.role)) return { ok: false, reason: 'INVALID' };
  if (record.teammate_name !== record.role) return { ok: false, reason: 'INVALID' };
  if (!isHexDigest64(record.worktree_id) || !isHexDigest64(record.plan_digest)) return { ok: false, reason: 'INVALID' };
  if (!isCanonicalIsoUtc(record.created_at) || !isCanonicalIsoUtc(record.expiry)) return { ok: false, reason: 'INVALID' };
  const createdAtMs = isoToMsForRegistry(record.created_at);
  const expiryMs = isoToMsForRegistry(record.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) {
    return { ok: false, reason: 'INVALID' };
  }
  return { ok: true, record };
}

function validateClaudeResumeHandleRecord(record, handleId) {
  const shaped = validateClaudeResumeHandleRecordShape(record, handleId);
  if (!shaped.ok) return shaped;
  const createdAtMs = isoToMsForRegistry(record.created_at);
  const expiryMs = isoToMsForRegistry(record.expiry);
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return { ok: false, reason: 'INVALID' };
  if (nowMs >= expiryMs) return { ok: false, reason: 'INVALID' };
  return { ok: true, record };
}

function readClaudeResumeHandle(projectRootOrRepoDescriptor, handleId) {
  if (!isHexActionId(handleId)) return { ok: false, reason: 'INVALID' };
  let read;
  try {
    read = readRegistryRecord(claudeResumeHandlePathFor(projectRootOrRepoDescriptor, handleId));
  } catch {
    return { ok: false, reason: 'INVALID' };
  }
  if (!read.ok) return { ok: false, reason: 'INVALID' };
  if (read.absent) return { ok: false, reason: 'UNAVAILABLE' };
  return validateClaudeResumeHandleRecord(read.obj, handleId);
}

/** Best-effort, fail-closed: any unreadable state is treated as consumed/unusable, never as "free to reuse". */
function isClaudeResumeHandleConsumed(projectRootOrRepoDescriptor, handleId) {
  try {
    return fs.existsSync(claudeResumeHandleConsumedMarkerPathFor(projectRootOrRepoDescriptor, handleId));
  } catch {
    return true;
  }
}

/**
 * Bounded scan for every LIVE (schema/shape/expiry-valid) resume handle
 * matching the exact {worktreeId,planDigest,role,session,agentId,
 * actorBindingId} tuple, regardless of consumed status (callers filter by
 * `isClaudeResumeHandleConsumed` themselves -- consumption is a separate
 * marker file, never a scan-time exclusion here, so both park's no-clobber
 * check and consume's own lookup share ONE scan implementation).
 */
function findClaudeResumeHandlesForActor(projectRoot, expected) {
  const dir = path.join(registryRepoDir(projectRoot), 'claude-resume-handles');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, records: [] };
    return { ok: false, reason: 'INVALID' };
  }
  if (entries.length > CLAUDE_RESUME_HANDLE_SCAN_CAP) return { ok: false, reason: 'INVALID' };
  const records = [];
  for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue;
    // Consumption markers (<handleId>.json.consumed) live in this SAME
    // directory, deliberately never their own registry -- skip them here
    // exactly like readClaudeResumeHandle's own callers already skip
    // absence; anything else non-conforming still fails closed.
    if (entry.name.endsWith('.consumed')) continue;
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
    const handleId = entry.name.slice(0, -5);
    const read = readRegistryRecord(claudeResumeHandlePathFor(projectRoot, handleId));
    if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'INVALID' };
    const shaped = validateClaudeResumeHandleRecordShape(read.obj, handleId);
    if (!shaped.ok) return { ok: false, reason: 'INVALID' };
    const record = shaped.record;
    if (
      record.worktree_id === expected.worktreeId && record.plan_digest === expected.planDigest
      && record.role === expected.role && record.session === expected.session
      && record.agent_id === expected.agentId && record.actor_binding_id === expected.actorBindingId
    ) {
      const live = validateClaudeResumeHandleRecord(record, handleId);
      if (!live.ok) return { ok: false, reason: 'INVALID' };
      records.push(live.record);
    }
  }
  return { ok: true, records };
}

/**
 * Resolves the exact role-actor SCOPE a park/consume call operates on --
 * mirrors resolveClaudePeerObservedActorAuthority closely (same event shape,
 * same fence-absent gate, same unique-live-RoleActorBinding correlation) but
 * deliberately never requires complete CLAUDE-ID-01 proof: parking happens
 * at the FIRST SubagentStop, before the resumed actor's first post-resume
 * PreToolUse can ever complete that chain -- requiring it here would make
 * the bootstrap this correction exists for impossible.
 */
function resolveClaudeResumeRoleActorScope(projectRoot, event) {
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
    const generation = peekSessionGeneration(projectRoot, { provider: 'claude-hook', runtime_session_key: event.sessionId });
    if (!generation.ok) {
      if (generation.reason === 'session-generation-absent' || generation.reason === 'session-generation-expired') {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
      return { ok: false, reason: 'INVALID' };
    }
    const generationId = generation.generationId;

    const traceRead = readRegistryRecord(
      claudeStartupActorPathFor(projectRoot, generationId, event.agentId),
    );
    let planDigest;
    let actorBinding;
    if (traceRead.ok && !traceRead.absent && traceRead.obj) {
      if (!hasExactKeys(traceRead.obj, CLAUDE_STARTUP_ACTOR_KEYS)) return { ok: false, reason: 'INVALID' };
      const trace = traceRead.obj;
      if (trace.schema !== CLAUDE_STARTUP_ACTOR_SCHEMA ||
          trace.session_digest !== sha256String(event.sessionId) ||
          trace.agent_digest !== sha256String(event.agentId) ||
          trace.role !== event.agentType || trace.worktree_id !== worktreeId ||
          trace.session_generation_digest !== sha256String(generationId) ||
          currentClockMsForRegistry() >= isoToMsForRegistry(trace.expiry)) {
        return { ok: false, reason: 'INVALID' };
      }
      planDigest = trace.plan_digest;
      actorBinding = validateRoleActorBindingFor(
        projectRoot, trace.actor_binding_id, trace.role, trace.worktree_id, trace.plan_digest,
      );
      if (!actorBinding.ok || actorBinding.binding.session_generation_id !== generationId) {
        return { ok: false, reason: 'INVALID' };
      }
      const uniqueActorBinding = findUniqueClaudePeerRoleActorBinding(projectRoot, {
        role: trace.role, worktreeId, planDigest, generationId,
      });
      if (!uniqueActorBinding.ok ||
          uniqueActorBinding.binding.binding_id !== actorBinding.binding.binding_id) {
        return { ok: false, reason: 'INVALID' };
      }
    } else if (traceRead.ok && traceRead.absent) {
      const planResult = discoverPlan(projectRoot);
      if (!planResult.ok) return { ok: false, reason: 'UNAVAILABLE' };
      planDigest = planResult.planDigest;
      actorBinding = findUniqueClaudePeerRoleActorBinding(projectRoot, {
        role: event.agentType, worktreeId, planDigest, generationId,
      });
      if (!actorBinding.ok) return actorBinding;
    } else {
      return { ok: false, reason: 'INVALID' };
    }

    const fenceRead = readClaudeAuthorityFence(
      projectRoot, computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', event.sessionId, event.agentId),
    );
    if (!fenceRead.ok || !fenceRead.absent) return { ok: false, reason: 'INVALID' };

    return {
      ok: true,
      scope: {
        sessionId: event.sessionId, agentId: event.agentId, role: event.agentType,
        worktreeId, planDigest, generationId, generationExpiresAt: generation.expiresAt,
        actorBinding: actorBinding.binding,
      },
    };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}


  return Object.freeze({
    CLAUDE_RESUME_HANDLE_SCHEMA,
    CLAUDE_RESUME_HANDLE_KEYS,
    CLAUDE_RESUME_HANDLE_SCAN_CAP,
    claudeResumeHandlePathFor,
    claudeResumeHandleConsumedMarkerPathFor,
    validateClaudeResumeHandleRecordShape,
    validateClaudeResumeHandleRecord,
    readClaudeResumeHandle,
    isClaudeResumeHandleConsumed,
    findClaudeResumeHandlesForActor,
    resolveClaudeResumeRoleActorScope,
    classifyClaudeSupportRoleLiveness,
    CLAUDE_SUPPORT_ROLE_TERMINAL_SCHEMA,
    claudeSupportRoleTerminalPathFor,
    readClaudeSupportRoleTerminal,
    publishClaudeSupportRoleTerminal,
  });
}

module.exports = Object.freeze({ createClaudeResumeRecord });
