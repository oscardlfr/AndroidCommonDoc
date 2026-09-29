'use strict';

function createClaudeLivenessProbe(deps) {
  const {
    actionPathFor,
    canonicalJSONStringify,
    currentClockMsForRegistry,
    ensureSecureRegistryDir,
    fs,
    hasExactKeys,
    isCanonicalIsoUtc,
    isHexActionId,
    isoPlusSecondsForRegistry,
    isoToMsForRegistry,
    nowIsoForRegistry,
    path,
    publishNoClobber,
    readLiveSessionGenerationById,
    readRegistryRecord,
    readRoleBindingState,
    registryRepoDir,
    roleProfileDigestFor,
    sha256String,
    transitionRoleBinding,
    validateRoleActorBindingFor,
    withRegistryLock,
    writeRegistryRecordReplace,
  } = deps;

  const CLAUDE_LIVENESS_PROBE_SCHEMA = 'runtime/claude-liveness-probe/v1';
  const CLAUDE_LIVENESS_OUTCOME_SCHEMA = 'runtime/claude-liveness-outcome/v1';
  const CLAUDE_LIVENESS_INDEX_SCHEMA = 'runtime/claude-liveness-index/v1';
  const CLAUDE_LIVENESS_INDEX_KEYS = Object.freeze([
    'action_id', 'actor_binding_id', 'actor_digest', 'plan_digest', 'role',
    'schema', 'session_generation_id', 'worktree_id',
  ]);
  const CLAUDE_LIVENESS_OUTCOME_TTL_SECONDS = 60;
  const CLAUDE_LIVENESS_MESSAGE_RE = /^RUNTIME_LIVENESS_PROBE\/v1\nactor-binding:([0-9a-f]{32})\nactor-digest:([0-9a-f]{64})\nruntime-action:([0-9a-f]{32})\nexpected-response:resumed-agent-id\nactor-action:none\nreply:none\nnext:wait$/;

  function claudeLivenessProbeMessage(actionId, actorBindingId, actorDigest) {
    if (!isHexActionId(actionId) || !isHexActionId(actorBindingId) || !/^[0-9a-f]{64}$/.test(actorDigest || '')) {
      throw new TypeError('invalid-liveness-probe');
    }
    return `RUNTIME_LIVENESS_PROBE/v1\nactor-binding:${actorBindingId}\nactor-digest:${actorDigest}\nruntime-action:${actionId}\nexpected-response:resumed-agent-id\nactor-action:none\nreply:none\nnext:wait`;
  }

  function claudeLivenessRecipientAbsentMessage(recipient) {
    return `No agent named '${recipient}' is reachable.\nUse ListAgents to see everyone you can message.`;
  }

  function livenessProbePath(projectRoot, actionId, suffix) {
    return path.join(registryRepoDir(projectRoot), 'claude-liveness-probes', actionId + suffix);
  }

  function livenessIndexPath(projectRoot, expected) {
    const scopeKey = sha256String(canonicalJSONStringify([
      expected.generationId, expected.worktreeId, expected.planDigest,
      expected.role, expected.actorBindingId, expected.actorDigest,
    ]));
    return path.join(registryRepoDir(projectRoot), 'claude-liveness-index', scopeKey + '.json');
  }

  function indexClaudeLivenessProbeAction(projectRoot, expected, action) {
    try {
      if (!action || action.kind !== 'role-notify' || action.runtime !== 'claude-native'
          || action.action_id === undefined || action.role !== expected.role
          || action.worktree_id !== expected.worktreeId || action.plan_digest !== expected.planDigest
          || action.session_generation_id !== expected.generationId || !action.payload) {
        return { ok: false, reason: 'liveness-index-action-invalid' };
      }
      const parsed = CLAUDE_LIVENESS_MESSAGE_RE.exec(action.payload.message);
      if (!parsed || parsed[1] !== expected.actorBindingId || parsed[2] !== expected.actorDigest
          || parsed[3] !== action.action_id) {
        return { ok: false, reason: 'liveness-index-scope-mismatch' };
      }
      const record = {
        schema: CLAUDE_LIVENESS_INDEX_SCHEMA,
        action_id: action.action_id,
        actor_binding_id: expected.actorBindingId,
        actor_digest: expected.actorDigest,
        role: expected.role,
        worktree_id: expected.worktreeId,
        plan_digest: expected.planDigest,
        session_generation_id: expected.generationId,
      };
      const written = writeRegistryRecordReplace(
        livenessIndexPath(projectRoot, expected),
        Buffer.from(canonicalJSONStringify(record), 'utf8'),
      );
      return written.ok ? { ok: true } : { ok: false, reason: 'liveness-index-write-failed' };
    } catch { return { ok: false, reason: 'liveness-index-internal' }; }
  }

  function reserveClaudeLivenessProbeBeforeDelivery(projectRoot, event) {
    try {
      const match = CLAUDE_LIVENESS_MESSAGE_RE.exec(event && event.message);
      if (!match || match[3] !== event.actionId || typeof event.sessionId !== 'string' || event.sessionId.length === 0
          || typeof event.toolUseId !== 'string' || event.toolUseId.length === 0
          || typeof event.recipient !== 'string' || event.recipient.length === 0) {
        return { ok: false, reason: 'liveness-probe-invalid' };
      }
      const read = readRegistryRecord(actionPathFor(projectRoot, event.actionId));
      if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'liveness-action-absent' };
      const action = read.obj;
      const generation = readLiveSessionGenerationById(projectRoot, action.session_generation_id);
      if (action.kind !== 'role-notify' || action.runtime !== 'claude-native'
          || action.role !== event.recipient || !action.payload
          || action.payload.teammate_name !== event.recipient || action.payload.message !== event.message
          || action.payload.artifact_kind !== 'session-control'
          || action.payload.artifact_ref !== `liveness:${match[1]}:${match[2]}`
          || currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at)
          || !generation.ok || generation.record.provider !== 'claude-hook'
          || generation.record.runtime_session_key !== event.sessionId) {
        return { ok: false, reason: 'liveness-action-mismatch' };
      }
      const actor = validateRoleActorBindingFor(projectRoot, match[1], action.role, action.worktree_id, action.plan_digest);
      const state = readRoleBindingState(projectRoot, action.worktree_id, action.plan_digest,
        roleProfileDigestFor(action.role), action.session_generation_id, action.role);
      if (!actor.ok || actor.binding.session_generation_id !== action.session_generation_id
          || !state.ok || !['READY', 'WAITING', 'BUSY'].includes(state.state)
          || state.record.driver !== 'claude-sendmessage') {
        return { ok: false, reason: 'liveness-actor-not-ready' };
      }
      const record = {
        schema: CLAUDE_LIVENESS_PROBE_SCHEMA, action_id: action.action_id,
        action_digest: sha256String(canonicalJSONStringify(action)),
        actor_binding_id: match[1], actor_digest: match[2], role: action.role,
        recipient: event.recipient,
        input_digest: sha256String(canonicalJSONStringify({ recipient: event.recipient, message: event.message })),
        session_digest: sha256String(event.sessionId), tool_use_digest: sha256String(event.toolUseId),
        worktree_id: action.worktree_id, plan_digest: action.plan_digest,
        session_generation_id: action.session_generation_id, reserved_at: nowIsoForRegistry(),
        role_state: state.state,
        role_state_digest: sha256String(canonicalJSONStringify(state.record)),
        role_state_updated_at: state.record.updated_at,
      };
      const destination = livenessProbePath(projectRoot, action.action_id, '.pending.json');
      const secured = ensureSecureRegistryDir(path.dirname(destination));
      if (!secured.ok) return { ok: false, reason: 'liveness-probe-dir-invalid' };
      const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-liveness-probe-' + action.action_id + '.lock');
      const locked = withRegistryLock(lockDir, () => {
        try { publishNoClobber(destination, Buffer.from(canonicalJSONStringify(record), 'utf8'), {}); }
        catch {
          const existing = readRegistryRecord(destination);
          const comparableExisting = existing.ok && !existing.absent && existing.obj
            ? Object.assign({}, existing.obj, { reserved_at: record.reserved_at }) : null;
          if (!comparableExisting || canonicalJSONStringify(comparableExisting) !== canonicalJSONStringify(record)) {
            return { ok: false, reason: 'liveness-probe-conflict' };
          }
          return { ok: true, actionId: action.action_id, idempotent: true };
        }
        return { ok: true, actionId: action.action_id, idempotent: false };
      }, { maxWaitMs: 5000 });
      return locked.ok && locked.value ? locked.value : { ok: false, reason: 'liveness-probe-lock-failed' };
    } catch { return { ok: false, reason: 'liveness-probe-internal' }; }
  }

  function settleClaudeLivenessProbeOutcome(projectRoot, event) {
    try {
      const match = CLAUDE_LIVENESS_MESSAGE_RE.exec(event && event.message);
      if (!match || match[3] !== event.actionId) return { ok: false, ignored: true };
      const pendingRead = readRegistryRecord(livenessProbePath(projectRoot, event.actionId, '.pending.json'));
      if (!pendingRead.ok || pendingRead.absent || !pendingRead.obj) return { ok: false, reason: 'liveness-probe-unreserved' };
      const pending = pendingRead.obj;
      const pendingKeys = ['action_digest','action_id','actor_binding_id','actor_digest','input_digest','plan_digest','recipient','reserved_at','role','role_state','role_state_digest','role_state_updated_at','schema','session_digest','session_generation_id','tool_use_digest','worktree_id'];
      if (!hasExactKeys(pending, pendingKeys) || pending.schema !== CLAUDE_LIVENESS_PROBE_SCHEMA
          || pending.action_id !== event.actionId || pending.actor_binding_id !== match[1]
          || pending.actor_digest !== match[2] || pending.session_digest !== sha256String(event.sessionId)
          || pending.tool_use_digest !== sha256String(event.toolUseId)
          || pending.recipient !== event.recipient || pending.role !== event.recipient
          || !['READY', 'WAITING', 'BUSY'].includes(pending.role_state)
          || pending.input_digest !== sha256String(canonicalJSONStringify({ recipient: event.recipient, message: event.message }))) {
        return { ok: false, reason: 'liveness-probe-correlation-mismatch' };
      }
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, event.actionId));
      const action = actionRead.ok && !actionRead.absent ? actionRead.obj : null;
      const generation = action && readLiveSessionGenerationById(projectRoot, action.session_generation_id);
      const reservedAtMs = isoToMsForRegistry(pending.reserved_at);
      const nowMs = currentClockMsForRegistry();
      if (!action || pending.action_digest !== sha256String(canonicalJSONStringify(action))
          || action.kind !== 'role-notify' || action.runtime !== 'claude-native'
          || action.role !== pending.role || action.worktree_id !== pending.worktree_id
          || action.plan_digest !== pending.plan_digest
          || action.session_generation_id !== pending.session_generation_id
          || !action.payload || action.payload.teammate_name !== pending.recipient
          || action.payload.message !== event.message
          || !Number.isFinite(reservedAtMs) || reservedAtMs > nowMs
          || !generation.ok || generation.record.provider !== 'claude-hook'
          || generation.record.runtime_session_key !== event.sessionId) {
        return { ok: false, reason: 'liveness-action-stale' };
      }
      const actionExpired = nowMs >= isoToMsForRegistry(action.expires_at);
      const destination = livenessProbePath(projectRoot, event.actionId, '.outcome.json');
      const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-liveness-outcome-' + event.actionId + '.lock');
      const locked = withRegistryLock(lockDir, () => {
        const currentState = readRoleBindingState(projectRoot, pending.worktree_id, pending.plan_digest,
          roleProfileDigestFor(pending.role), pending.session_generation_id, pending.role);
        const currentActor = validateRoleActorBindingFor(
          projectRoot, pending.actor_binding_id, pending.role, pending.worktree_id, pending.plan_digest,
        );
        if (!currentState.ok || !currentState.record || !['READY', 'WAITING', 'BUSY', 'DEAD'].includes(currentState.state)
            || !currentActor.ok || currentActor.binding.session_generation_id !== pending.session_generation_id) {
          return { ok: false, reason: 'liveness-probe-stale' };
        }
        const stateUnchanged = sha256String(canonicalJSONStringify(currentState.record)) === pending.role_state_digest
          && currentState.record.updated_at === pending.role_state_updated_at;
        const response = event.response && typeof event.response === 'object' ? event.response : null;
        // Claude Code has exposed the resumed identity in two compatible
        // host-owned response shapes across 2.1 patch releases:
        // `resumedAgentId` and, newer, `pin.id`.  Bind either one to the
        // startup actor digest instead of pinning the runtime to one patch.
        const observedAgentId = response && typeof response.resumedAgentId === 'string'
          ? response.resumedAgentId
          : (response && response.pin && typeof response.pin.id === 'string'
            ? response.pin.id : null);
        const legacyResumeShape = response && hasExactKeys(response, ['resumedAgentId', 'success']);
        const pinnedResumeShape = response && hasExactKeys(response, ['message', 'pin', 'success'])
          && response.pin && hasExactKeys(response.pin, ['id', 'name', 'ref']);
        const identityReceipt = response && response.success === true
          && (legacyResumeShape || pinnedResumeShape) && typeof observedAgentId === 'string'
          && sha256String(observedAgentId) === pending.actor_digest
          && (!response.pin || response.pin.name === pending.recipient);
        // An already-running teammate is not resumed.  Claude instead returns
        // a host-generated inbox receipt.  The correlated PostToolUse plus the
        // exact routed recipient proves that the registered role is reachable.
        const inboxReceipt = response && hasExactKeys(response, ['message', 'msg_id', 'routing', 'success'])
          && response.routing && hasExactKeys(response.routing,
            ['content', 'sender', 'summary', 'target', 'targetColor'])
          && response.success === true
          && response.message === `Message sent to ${pending.recipient}'s inbox`
          && typeof response.msg_id === 'string' && response.msg_id.length > 0
          && response.routing.target === '@' + pending.recipient;
        const exactRecipientAbsent = !actionExpired && event.success === true
          && hasExactKeys(event.response, ['message', 'success'])
          && event.response.success === false
          && event.response.message === claudeLivenessRecipientAbsentMessage(pending.recipient);
        const healthyState = ['READY', 'WAITING', 'BUSY'].includes(currentState.state);
        const sameSnapshot = currentState.state === pending.role_state && stateUnchanged;
        const liveStateCompatible = currentState.state === pending.role_state
          || (pending.role_state === 'WAITING' && currentState.state === 'BUSY');
        const status = healthyState && sameSnapshot && exactRecipientAbsent
          ? 'ABSENT'
          : (!actionExpired && healthyState && liveStateCompatible
            && event.success === true && stateUnchanged && (identityReceipt || inboxReceipt)
            ? 'LIVE' : 'UNVERIFIED');
        const observedAt = nowIsoForRegistry();
        const outcome = {
          schema: CLAUDE_LIVENESS_OUTCOME_SCHEMA, action_id: event.actionId,
          actor_binding_id: pending.actor_binding_id, actor_digest: pending.actor_digest,
          role: pending.role, worktree_id: pending.worktree_id, plan_digest: pending.plan_digest,
          session_generation_id: pending.session_generation_id, status,
          observed_at: observedAt,
          expires_at: isoPlusSecondsForRegistry(observedAt, CLAUDE_LIVENESS_OUTCOME_TTL_SECONDS),
        };
        const existing = readRegistryRecord(destination);
        let idempotent = false;
        if (!existing.ok) return { ok: false, reason: 'liveness-outcome-read-failed' };
        if (!existing.absent) {
          const comparableExisting = existing.obj
            ? Object.assign({}, existing.obj, { observed_at: outcome.observed_at, expires_at: outcome.expires_at }) : null;
          const repairableAbsent = existing.obj && existing.obj.status === 'ABSENT' && exactRecipientAbsent
            && currentState.state === 'DEAD';
          if (!repairableAbsent
              && (!comparableExisting || canonicalJSONStringify(comparableExisting) !== canonicalJSONStringify(outcome))) {
            return { ok: false, reason: 'liveness-outcome-conflict' };
          }
          if (repairableAbsent) outcome.status = 'ABSENT';
          idempotent = true;
        } else {
          try { publishNoClobber(destination, Buffer.from(canonicalJSONStringify(outcome), 'utf8'), {}); }
          catch { return { ok: false, reason: 'liveness-outcome-publish-failed' }; }
        }
        if (outcome.status === 'ABSENT') {
          if (healthyState && sameSnapshot) {
            const dead = transitionRoleBinding(
              projectRoot, pending.worktree_id, pending.plan_digest, roleProfileDigestFor(pending.role),
              pending.session_generation_id, pending.role, currentState.state, 'DEAD', currentState.record, {},
            );
            if (!dead.ok) return { ok: false, reason: 'liveness-absent-transition-failed' };
          } else if (currentState.state !== 'DEAD' || !idempotent) {
            return { ok: false, reason: 'liveness-absent-stale' };
          }
        }
        return { ok: true, status: outcome.status, idempotent };
      }, { maxWaitMs: 5000 });
      return locked.ok && locked.value ? locked.value : { ok: false, reason: 'liveness-outcome-lock-failed' };
    } catch { return { ok: false, reason: 'liveness-outcome-internal' }; }
  }

  function findClaudeLivenessProbeState(projectRoot, expected) {
    try {
      const indexRead = readRegistryRecord(livenessIndexPath(projectRoot, expected));
      if (!indexRead.ok) return { ok: false, reason: 'liveness-index-read-failed' };
      if (indexRead.absent) return { ok: true, status: 'NONE' };
      const index = indexRead.obj;
      if (!index || !hasExactKeys(index, CLAUDE_LIVENESS_INDEX_KEYS)
          || index.schema !== CLAUDE_LIVENESS_INDEX_SCHEMA
          || index.actor_binding_id !== expected.actorBindingId || index.actor_digest !== expected.actorDigest
          || index.role !== expected.role || index.worktree_id !== expected.worktreeId
          || index.plan_digest !== expected.planDigest || index.session_generation_id !== expected.generationId
          || !isHexActionId(index.action_id)) {
        return { ok: false, reason: 'liveness-index-invalid' };
      }
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, index.action_id));
      if (!actionRead.ok || actionRead.absent || !actionRead.obj) {
        return { ok: false, reason: 'liveness-action-read-failed' };
      }
      const action = actionRead.obj;
      const parsed = action.payload && CLAUDE_LIVENESS_MESSAGE_RE.exec(action.payload.message);
      if (action.kind !== 'role-notify' || action.runtime !== 'claude-native'
          || action.action_id !== index.action_id || action.role !== expected.role
          || action.worktree_id !== expected.worktreeId || action.plan_digest !== expected.planDigest
          || action.session_generation_id !== expected.generationId
          || !parsed || parsed[1] !== expected.actorBindingId || parsed[2] !== expected.actorDigest
          || parsed[3] !== action.action_id) {
        return { ok: false, reason: 'liveness-action-index-mismatch' };
      }
      const outcomeRead = readRegistryRecord(livenessProbePath(projectRoot, action.action_id, '.outcome.json'));
      if (!outcomeRead.ok) return { ok: false, reason: 'liveness-outcome-read-failed' };
      if (outcomeRead.absent) {
        return currentClockMsForRegistry() < isoToMsForRegistry(action.expires_at)
          ? { ok: true, status: 'PENDING', action }
          : { ok: true, status: 'NONE' };
      }
      const outcome = outcomeRead.obj;
      const outcomeKeys = ['action_id','actor_binding_id','actor_digest','expires_at','observed_at','plan_digest','role','schema','session_generation_id','status','worktree_id'];
      if (!outcome || !hasExactKeys(outcome, outcomeKeys)
          || outcome.schema !== CLAUDE_LIVENESS_OUTCOME_SCHEMA || outcome.action_id !== action.action_id
          || outcome.actor_binding_id !== expected.actorBindingId || outcome.actor_digest !== expected.actorDigest
          || outcome.role !== expected.role || outcome.worktree_id !== expected.worktreeId
          || outcome.plan_digest !== expected.planDigest || outcome.session_generation_id !== expected.generationId
          || !['ABSENT','LIVE','UNVERIFIED'].includes(outcome.status)
          || !isCanonicalIsoUtc(outcome.observed_at) || !isCanonicalIsoUtc(outcome.expires_at)) {
        return { ok: false, reason: 'liveness-outcome-invalid' };
      }
      const observedAtMs = isoToMsForRegistry(outcome.observed_at);
      const expiresAtMs = isoToMsForRegistry(outcome.expires_at);
      const nowMs = currentClockMsForRegistry();
      if (!Number.isFinite(observedAtMs) || !Number.isFinite(expiresAtMs)
          || observedAtMs > nowMs || expiresAtMs - observedAtMs !== CLAUDE_LIVENESS_OUTCOME_TTL_SECONDS * 1000) {
        return { ok: false, reason: 'liveness-outcome-chronology-invalid' };
      }
      if (outcome.status === 'LIVE' && nowMs < expiresAtMs) return { ok: true, status: 'LIVE', action };
      if (outcome.status === 'ABSENT' && nowMs < expiresAtMs) return { ok: true, status: 'ABSENT', action };
      // UNVERIFIED and expired outcomes are settled history. The scope index
      // is atomically replaced when the next probe is minted, so unrelated
      // immutable actions can never exhaust or poison liveness discovery.
      return { ok: true, status: 'NONE' };
    } catch { return { ok: false, reason: 'liveness-action-internal' }; }
  }

  return Object.freeze({
    CLAUDE_LIVENESS_PROBE_SCHEMA,
    CLAUDE_LIVENESS_OUTCOME_SCHEMA,
    claudeLivenessProbeMessage,
    reserveClaudeLivenessProbeBeforeDelivery,
    settleClaudeLivenessProbeOutcome,
    findClaudeLivenessProbeState,
    indexClaudeLivenessProbeAction,
  });
}

module.exports = Object.freeze({ createClaudeLivenessProbe });
