'use strict';

function createClaudeResumeLifecycle(deps) {
  const {
    CLAUDE_RESUME_HANDLE_SCAN_CAP,
    CLAUDE_RESUME_HANDLE_SCHEMA,
    canonicalJSONStringify,
    claudeResumeHandleConsumedMarkerPathFor,
    claudeResumeHandlePathFor,
    computeClaudeAuthorityIdentityId,
    currentClockMsForRegistry,
    ensureSecureRegistryDir,
    findClaudeResumeHandlesForActor,
    fs,
    generateActionId,
    hasExactKeys,
    isCanonicalIsoUtc,
    isClaudeResumeHandleConsumed,
    isHexCsprng32,
    isoPlusSecondsForRegistry,
    isoToMsForRegistry,
    nowIsoForRegistry,
    path,
    publishNoClobber,
    readClaudeAuthorityFence,
    readClaudeResumeHandle,
    readRegistryRecord,
    readRoleBindingState,
    registryRepoDir,
    resolveClaudeResumeRoleActorScope,
    roleProfileDigestFor,
    sha256String,
    transitionRoleBinding,
    validateClaudePeerExpected,
    validateClaudeResumeHandleRecord,
    validateClaudeResumeHandleRecordShape,
    validateRoleActorBindingFor,
    withRegistryLock,
  } = deps;

const CLAUDE_RESUME_HANDLE_TTL_SECONDS = 3600;

/**
 * Parks the exact correlated persistent claude-sendmessage role actor as
 * resumable WAITING, creating (or, no-clobber, returning) exactly one live
 * host-private resume handle. Succeeds only for a role-binding currently
 * READY or BUSY, with driver EXACTLY 'claude-sendmessage', in the SAME
 * session-generation/worktree/PLAN scope as a unique live RoleActorBinding,
 * with no authority fence for this exact actor identity. Idempotent while
 * a live (unconsumed) handle already exists; once that handle is consumed it
 * is immutable history and never blocks (or is returned by) a later park --
 * a fresh handle is minted instead, supporting multiple idle cycles.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function parkClaudeResumeHandleForRoleActor(projectRoot, event) {
  try {
    const scopeResult = resolveClaudeResumeRoleActorScope(projectRoot, event);
    if (!scopeResult.ok) return scopeResult;
    const scope = scopeResult.scope;
    const profileDigest = roleProfileDigestFor(scope.role);

    const lockKey = sha256String(canonicalJSONStringify([
      'claude-resume-handle-park', scope.generationId, scope.worktreeId, scope.planDigest,
      scope.role, event.agentId, scope.actorBinding.binding_id,
    ]));
    const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-resume-handle-park-' + lockKey + '.lock');
    const locked = withRegistryLock(lockDir, () => {
      // Re-resolve under the lock -- never trust the pre-lock read.
      const currentScopeResult = resolveClaudeResumeRoleActorScope(projectRoot, event);
      if (!currentScopeResult.ok) return currentScopeResult;
      const current = currentScopeResult.scope;
      if (
        current.generationId !== scope.generationId || current.worktreeId !== scope.worktreeId
        || current.planDigest !== scope.planDigest || current.role !== scope.role
        || current.actorBinding.binding_id !== scope.actorBinding.binding_id
      ) {
        return { ok: false, reason: 'INVALID' };
      }

      const existing = findClaudeResumeHandlesForActor(projectRoot, {
        worktreeId: current.worktreeId, planDigest: current.planDigest, role: current.role,
        session: event.sessionId, agentId: event.agentId, actorBindingId: current.actorBinding.binding_id,
      });
      if (!existing.ok) return existing;
      const liveUnconsumed = existing.records.filter((r) => !isClaudeResumeHandleConsumed(projectRoot, r.binding_id));
      if (liveUnconsumed.length > 1) return { ok: false, reason: 'INVALID' };
      if (liveUnconsumed.length === 1) return { ok: true, record: liveUnconsumed[0] };

      const stateResult = readRoleBindingState(projectRoot, current.worktreeId, current.planDigest, profileDigest, current.generationId, current.role);
      if (!stateResult.ok) return { ok: false, reason: 'INVALID' };
      if (stateResult.state !== 'READY' && stateResult.state !== 'BUSY') return { ok: false, reason: 'UNAVAILABLE' };
      if (!stateResult.record || stateResult.record.driver !== 'claude-sendmessage') return { ok: false, reason: 'UNAVAILABLE' };

      const createdAt = nowIsoForRegistry();
      const expiryMs = Math.min(
        isoToMsForRegistry(current.actorBinding.expiry),
        isoToMsForRegistry(current.generationExpiresAt),
        isoToMsForRegistry(isoPlusSecondsForRegistry(createdAt, CLAUDE_RESUME_HANDLE_TTL_SECONDS)),
      );
      if (!Number.isFinite(expiryMs) || expiryMs <= currentClockMsForRegistry()) return { ok: false, reason: 'UNAVAILABLE' };
      const handleId = generateActionId();
      const record = {
        actor_binding_id: current.actorBinding.binding_id,
        agent_id: event.agentId,
        binding_id: handleId,
        created_at: createdAt,
        expiry: new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        plan_digest: current.planDigest,
        role: current.role,
        schema: CLAUDE_RESUME_HANDLE_SCHEMA,
        session: event.sessionId,
        session_generation_id: current.generationId,
        teammate_name: current.role,
        worktree_id: current.worktreeId,
      };
      const staticValid = validateClaudeResumeHandleRecord(record, handleId);
      if (!staticValid.ok) return { ok: false, reason: 'INVALID' };
      const handlePath = claudeResumeHandlePathFor(projectRoot, handleId);
      const dirResult = ensureSecureRegistryDir(path.dirname(handlePath));
      if (!dirResult.ok) return { ok: false, reason: 'INVALID' };
      try {
        publishNoClobber(handlePath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
      } catch (err) {
        return { ok: false, reason: 'INVALID' };
      }

      const parked = transitionRoleBinding(
        projectRoot, current.worktreeId, current.planDigest, profileDigest, current.generationId, current.role,
        stateResult.state, 'WAITING', stateResult.record, {},
      );
      if (!parked.ok) return { ok: false, reason: 'INVALID' };

      return readClaudeResumeHandle(projectRoot, handleId);
    }, { maxWaitMs: 5000 });
    if (!locked.ok || !locked.value) return { ok: false, reason: 'INVALID' };
    return locked.value;
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

/**
 * Consumes the exact unique live (unconsumed) resume handle for this exact
 * observed actor, publishing a SEPARATE immutable consumed marker (the
 * no-clobber handle bytes themselves are never rewritten) and moving the
 * parked role-binding WAITING -> BUSY. Rejects replay (already-consumed),
 * wrong identity/role/scope, expiry, a present authority fence, and
 * ambiguity (more than one live match) -- all fail closed.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function consumeClaudeResumeHandleForObservedActor(projectRoot, event) {
  try {
    const scopeResult = resolveClaudeResumeRoleActorScope(projectRoot, event);
    if (!scopeResult.ok) return scopeResult;
    const scope = scopeResult.scope;
    const profileDigest = roleProfileDigestFor(scope.role);

    const found = findClaudeResumeHandlesForActor(projectRoot, {
      worktreeId: scope.worktreeId, planDigest: scope.planDigest, role: scope.role,
      session: event.sessionId, agentId: event.agentId, actorBindingId: scope.actorBinding.binding_id,
    });
    if (!found.ok) return found;
    const liveUnconsumed = found.records.filter((r) => !isClaudeResumeHandleConsumed(projectRoot, r.binding_id));
    if (liveUnconsumed.length === 0) return { ok: false, reason: 'UNAVAILABLE' };
    if (liveUnconsumed.length > 1) return { ok: false, reason: 'INVALID' };
    const handleRecord = liveUnconsumed[0];

    const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-resume-handle-consume-' + handleRecord.binding_id + '.lock');
    const locked = withRegistryLock(lockDir, () => {
      if (isClaudeResumeHandleConsumed(projectRoot, handleRecord.binding_id)) return { ok: false, reason: 'INVALID' };
      const reread = readClaudeResumeHandle(projectRoot, handleRecord.binding_id);
      if (!reread.ok) return reread;
      if (
        reread.record.session !== event.sessionId || reread.record.agent_id !== event.agentId
        || reread.record.role !== scope.role || reread.record.actor_binding_id !== scope.actorBinding.binding_id
        || reread.record.worktree_id !== scope.worktreeId || reread.record.plan_digest !== scope.planDigest
      ) {
        return { ok: false, reason: 'INVALID' };
      }
      const stateResult = readRoleBindingState(projectRoot, scope.worktreeId, scope.planDigest, profileDigest, scope.generationId, scope.role);
      if (!stateResult.ok) return { ok: false, reason: 'INVALID' };
      if (stateResult.state !== 'WAITING') return { ok: false, reason: 'UNAVAILABLE' };

      const markerPath = claudeResumeHandleConsumedMarkerPathFor(projectRoot, handleRecord.binding_id);
      try {
        publishNoClobber(markerPath, Buffer.from(canonicalJSONStringify({ consumed_at: nowIsoForRegistry() }), 'utf8'), {});
      } catch (err) {
        return { ok: false, reason: 'INVALID' };
      }

      const busy = transitionRoleBinding(
        projectRoot, scope.worktreeId, scope.planDigest, profileDigest, scope.generationId, scope.role,
        'WAITING', 'BUSY', stateResult.record, {},
      );
      if (!busy.ok) return { ok: false, reason: 'INVALID' };

      return { ok: true, record: reread.record };
    }, { maxWaitMs: 5000 });
    if (!locked.ok || !locked.value) return { ok: false, reason: 'INVALID' };
    return locked.value;
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

/**
 * Dispatch-side finder: the unique LIVE, unconsumed resume handle for the
 * exact requested target scope (mirrors findUniqueClaudePeerBindingForTarget
 * exactly, including its expected-object validation), re-validated against
 * its own backing RoleActorBinding (still live) and authority fence (still
 * absent) at lookup time -- a handle that was live moments ago but whose
 * actor has since gone terminal, or been fenced, must never be selected.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function findUniqueClaudeResumeHandleForTarget(projectRoot, expected) {
  try {
    const expectedValid = validateClaudePeerExpected(expected);
    if (!expectedValid.ok) return expectedValid;
    const dir = path.join(registryRepoDir(projectRoot), 'claude-resume-handles');
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, reason: 'UNAVAILABLE' };
      return { ok: false, reason: 'INVALID' };
    }
    if (entries.length > CLAUDE_RESUME_HANDLE_SCAN_CAP) return { ok: false, reason: 'INVALID' };
    const matches = [];
    for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.endsWith('.consumed')) continue;
      if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
      const handleId = entry.name.slice(0, -5);
      const read = readRegistryRecord(claudeResumeHandlePathFor(projectRoot, handleId));
      if (!read.ok) return { ok: false, reason: 'INVALID' };
      if (read.absent || !read.obj) continue;
      // Expiry is routine immutable history, not structural corruption. Read
      // and validate the complete closed shape first so malformed stale files
      // still poison the scan; then skip a well-formed expired record before
      // considering it as a target candidate. Calling readClaudeResumeHandle
      // here used to collapse both future-created corruption and ordinary
      // expiry to INVALID, so one old handle from any prior session disabled
      // every otherwise-live Claude target in this repo indefinitely.
      const shaped = validateClaudeResumeHandleRecordShape(read.obj, handleId);
      if (!shaped.ok) return { ok: false, reason: 'INVALID' };
      const nowMs = currentClockMsForRegistry();
      const createdAtMs = isoToMsForRegistry(shaped.record.created_at);
      const expiryMs = isoToMsForRegistry(shaped.record.expiry);
      if (createdAtMs > nowMs) return { ok: false, reason: 'INVALID' };
      if (nowMs >= expiryMs) continue;
      if (isClaudeResumeHandleConsumed(projectRoot, handleId)) continue;
      const record = shaped.record;
      if (
        sha256String(record.session) === expected.sessionDigest && record.role === expected.targetRole
        && record.worktree_id === expected.worktreeId && record.plan_digest === expected.planDigest
      ) {
        matches.push(record);
      }
    }
    if (matches.length === 0) return { ok: false, reason: 'UNAVAILABLE' };
    if (matches.length !== 1) return { ok: false, reason: 'INVALID' };
    const record = matches[0];
    const actorValid = validateRoleActorBindingFor(projectRoot, record.actor_binding_id, record.role, record.worktree_id, record.plan_digest);
    if (!actorValid.ok) return { ok: false, reason: 'INVALID' };
    const fenceRead = readClaudeAuthorityFence(
      projectRoot, computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', record.session, record.agent_id),
    );
    if (!fenceRead.ok || !fenceRead.absent) return { ok: false, reason: 'INVALID' };
    return { ok: true, record };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

/**
 * BUSY-side counterpart to findUniqueClaudeResumeHandleForTarget.  A
 * successful native SendMessage resume consumes the parked handle and then
 * transitions the same role binding WAITING -> BUSY.  Bootstrap-only Claude
 * actors have not necessarily made a second PreToolUse yet, so a
 * ClaudePeerBinding is not guaranteed to exist at this boundary.  The
 * consumed handle is the durable transition receipt that does exist.
 *
 * Correlate one current-generation handle to the exact main session/scope,
 * require its immutable consumed marker to coincide with the BUSY
 * transition, then revalidate the backing RoleActorBinding and authority
 * fence. Historical handles are filtered by generation before liveness is
 * checked and cannot poison a later session. Ambiguity fails closed.
 */
function findUniqueConsumedClaudeResumeHandleForBusyTarget(projectRoot, expected, busyRoleBinding) {
  try {
    const expectedKeys = ['generationId', 'planDigest', 'sessionDigest', 'targetRole', 'worktreeId'];
    if (!expected || typeof expected !== 'object' || Array.isArray(expected)
        || !hasExactKeys(expected, expectedKeys)
        || !isHexCsprng32(expected.generationId)) {
      return { ok: false, reason: 'INVALID' };
    }
    const peerExpected = {
      planDigest: expected.planDigest,
      sessionDigest: expected.sessionDigest,
      targetRole: expected.targetRole,
      worktreeId: expected.worktreeId,
    };
    if (!validateClaudePeerExpected(peerExpected).ok
        || !busyRoleBinding || busyRoleBinding.state !== 'BUSY'
        || busyRoleBinding.driver !== 'claude-sendmessage'
        || busyRoleBinding.session_generation_id !== expected.generationId
        || busyRoleBinding.role !== expected.targetRole
        || busyRoleBinding.worktree_id !== expected.worktreeId
        || busyRoleBinding.plan_digest !== expected.planDigest
        || !isCanonicalIsoUtc(busyRoleBinding.updated_at)) {
      return { ok: false, reason: 'INVALID' };
    }

    const dir = path.join(registryRepoDir(projectRoot), 'claude-resume-handles');
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: false, reason: 'UNAVAILABLE' };
      return { ok: false, reason: 'INVALID' };
    }
    if (entries.length > CLAUDE_RESUME_HANDLE_SCAN_CAP) return { ok: false, reason: 'INVALID' };
    const matches = [];
    for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name.startsWith('.') || entry.name.endsWith('.consumed')) continue;
      if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
      const handleId = entry.name.slice(0, -5);
      const raw = readRegistryRecord(claudeResumeHandlePathFor(projectRoot, handleId));
      if (!raw.ok || raw.absent || !raw.obj) return { ok: false, reason: 'INVALID' };
      const shaped = validateClaudeResumeHandleRecordShape(raw.obj, handleId);
      if (!shaped.ok) return { ok: false, reason: 'INVALID' };
      const record = shaped.record;
      if (record.session_generation_id !== expected.generationId
          || sha256String(record.session) !== expected.sessionDigest
          || record.role !== expected.targetRole
          || record.worktree_id !== expected.worktreeId
          || record.plan_digest !== expected.planDigest) {
        continue;
      }
      const live = validateClaudeResumeHandleRecord(record, handleId);
      if (!live.ok) return { ok: false, reason: 'INVALID' };
      const markerRead = readRegistryRecord(claudeResumeHandleConsumedMarkerPathFor(projectRoot, handleId));
      if (!markerRead.ok || markerRead.absent || !markerRead.obj
          || !hasExactKeys(markerRead.obj, ['consumed_at'])
          || !isCanonicalIsoUtc(markerRead.obj.consumed_at)) {
        continue;
      }
      const consumedAtMs = isoToMsForRegistry(markerRead.obj.consumed_at);
      const busyAtMs = isoToMsForRegistry(busyRoleBinding.updated_at);
      // publish marker precedes transitionRoleBinding immediately. Canonical
      // timestamps have one-second precision, so the two durable writes can
      // differ by at most one second across a clock boundary.
      if (busyAtMs < consumedAtMs || busyAtMs - consumedAtMs > 1000) continue;
      matches.push(record);
    }
    if (matches.length === 0) return { ok: false, reason: 'UNAVAILABLE' };
    if (matches.length !== 1) return { ok: false, reason: 'INVALID' };
    const record = matches[0];
    const actorValid = validateRoleActorBindingFor(
      projectRoot, record.actor_binding_id, record.role, record.worktree_id, record.plan_digest,
    );
    if (!actorValid.ok || actorValid.binding.session_generation_id !== expected.generationId) {
      return { ok: false, reason: 'INVALID' };
    }
    const fenceRead = readClaudeAuthorityFence(
      projectRoot, computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', record.session, record.agent_id),
    );
    if (!fenceRead.ok || !fenceRead.absent) return { ok: false, reason: 'INVALID' };
    return { ok: true, record };
  } catch (err) {
    return { ok: false, reason: 'INVALID' };
  }
}

  return Object.freeze({
    CLAUDE_RESUME_HANDLE_TTL_SECONDS,
    parkClaudeResumeHandleForRoleActor,
    consumeClaudeResumeHandleForObservedActor,
    findUniqueClaudeResumeHandleForTarget,
    findUniqueConsumedClaudeResumeHandleForBusyTarget,
  });
}

module.exports = Object.freeze({ createClaudeResumeLifecycle });

