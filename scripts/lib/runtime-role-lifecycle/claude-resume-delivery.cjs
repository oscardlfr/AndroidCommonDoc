'use strict';

function createClaudeResumeDelivery(deps) {
  const {
    actionPathFor,
    canonicalJSONStringify,
    claudeResumeHandleConsumedMarkerPathFor,
    computeClaudeAuthorityIdentityId,
    currentClockMsForRegistry,
    hasExactKeys,
    isCanonicalIsoUtc,
    isClaudeResumeHandleConsumed,
    isHexActionId,
    isoToMsForRegistry,
    nowIsoForRegistry,
    path,
    publishNoClobber,
    readClaudeAuthorityFence,
    readClaudeResumeHandle,
    readLiveSessionGenerationById,
    readRegistryRecord,
    readRoleBindingState,
    registryRepoDir,
    roleProfileDigestFor,
    sha256String,
    transitionRoleBinding,
    validateRoleActorBindingFor,
    withRegistryLock,
    withClaudeResumeHandleRegistryLock,
  } = deps;

  function consumeNativeResumeNotificationBeforeDelivery(projectRoot, event) {
    const actionId = event && event.actionId;
    if (typeof projectRoot !== 'string' || !isHexActionId(actionId) || !event ||
        typeof event.sessionId !== 'string' || typeof event.recipient !== 'string' ||
        typeof event.message !== 'string' || typeof event.toolUseId !== 'string' || event.toolUseId.length === 0) {
      return { ok: false, reason: 'invalid-arguments' };
    }
    const match = /^RUNTIME_RESUME\/v1\ncheckpoint:[0-9a-f]{64}\nresume-handle:([0-9a-f]{32})\nruntime-action:([0-9a-f]{32})\nhost-status:validated-and-consumed-before-delivery\nactor-action:none\nreply:none\nnext:wait-for-correlated-task$/.exec(event.message);
    if (!match || match[2] !== actionId) return { ok: false, reason: 'resume-message-invalid' };
    const handleId = match[1];
    const lockKey = sha256String(canonicalJSONStringify(['native-resume-delivery', actionId, handleId]));
    const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'native-resume-delivery-' + lockKey + '.lock');
    const locked = withRegistryLock(lockDir, () => {
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
      if (!actionRead.ok || actionRead.absent || !actionRead.obj) return { ok: false, reason: 'action-unavailable' };
      const action = actionRead.obj;
      if (action.kind !== 'role-notify' || action.runtime !== 'claude-native' || !action.payload ||
          action.payload.artifact_kind !== 'session-control' || action.payload.message !== event.message ||
          action.payload.teammate_name !== event.recipient || action.role !== event.recipient) {
        return { ok: false, reason: 'action-input-mismatch' };
      }
      if (currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at) ||
          !readLiveSessionGenerationById(projectRoot, action.session_generation_id).ok) {
        return { ok: false, reason: 'action-expired-or-generation-closed' };
      }
      const handleRead = readClaudeResumeHandle(projectRoot, handleId);
      if (!handleRead.ok) return { ok: false, reason: 'resume-handle-unavailable' };
      const handle = handleRead.record;
      if (handle.role !== action.role || handle.worktree_id !== action.worktree_id ||
          handle.plan_digest !== action.plan_digest || handle.session_generation_id !== action.session_generation_id ||
          handle.session !== event.sessionId) return { ok: false, reason: 'resume-handle-scope-mismatch' };
      if (isClaudeResumeHandleConsumed(projectRoot, handleId)) return { ok: false, reason: 'resume-delivery-replay' };
      const actor = validateRoleActorBindingFor(
        projectRoot, handle.actor_binding_id, handle.role, handle.worktree_id, handle.plan_digest,
      );
      const fence = readClaudeAuthorityFence(
        projectRoot, computeClaudeAuthorityIdentityId(projectRoot, 'claude-hook', handle.session, handle.agent_id),
      );
      if (!actor.ok || actor.binding.session_generation_id !== action.session_generation_id ||
          !fence.ok || !fence.absent) return { ok: false, reason: 'resume-actor-authority-invalid' };
      const profileDigest = roleProfileDigestFor(action.role);
      const state = readRoleBindingState(
        projectRoot, action.worktree_id, action.plan_digest, profileDigest,
        action.session_generation_id, action.role,
      );
      if (!state.ok || state.state !== 'WAITING' || !state.record || state.record.driver !== 'claude-sendmessage') {
        return { ok: false, reason: 'resume-role-not-waiting' };
      }
      const consumedAt = nowIsoForRegistry();
      try {
        const published = withClaudeResumeHandleRegistryLock(projectRoot, () => {
          publishNoClobber(claudeResumeHandleConsumedMarkerPathFor(projectRoot, handleId), Buffer.from(canonicalJSONStringify({
            schema: 'runtime/native-resume-delivery/v1', action_id: actionId, handle_id: handleId,
            session_digest: sha256String(event.sessionId), tool_use_digest: sha256String(event.toolUseId),
            consumed_at: consumedAt,
          }), 'utf8'), {});
          return { ok: true };
        });
        if (!published.ok) return published;
      } catch {
        return { ok: false, reason: 'resume-delivery-replay' };
      }
      const busy = transitionRoleBinding(
        projectRoot, action.worktree_id, action.plan_digest, profileDigest,
        action.session_generation_id, action.role, 'WAITING', 'BUSY', state.record, {},
      );
      if (!busy.ok) {
        const reread = readRoleBindingState(
          projectRoot, action.worktree_id, action.plan_digest, profileDigest,
          action.session_generation_id, action.role,
        );
        if (!reread.ok || reread.state !== 'BUSY') return { ok: false, reason: 'resume-role-transition-failed' };
      }
      return { ok: true, actionId, handleId };
    }, { maxWaitMs: 5000 });
    return locked.ok && locked.value ? locked.value : { ok: false, reason: 'resume-delivery-lock-failed' };
  }

  /** Settle an exact, already-consumed native resume failure as BUSY -> DEAD. */
  function settleNativeResumeNotificationFailure(projectRoot, event) {
    const actionId = event && event.actionId;
    if (typeof projectRoot !== 'string' || !isHexActionId(actionId) || !event ||
        typeof event.sessionId !== 'string' || event.sessionId.length === 0 ||
        typeof event.toolUseId !== 'string' || event.toolUseId.length === 0 ||
        typeof event.recipient !== 'string' || typeof event.message !== 'string') {
      return { ok: false, reason: 'invalid-arguments' };
    }
    const match = /^RUNTIME_RESUME\/v1\ncheckpoint:[0-9a-f]{64}\nresume-handle:([0-9a-f]{32})\nruntime-action:([0-9a-f]{32})\nhost-status:validated-and-consumed-before-delivery\nactor-action:none\nreply:none\nnext:wait-for-correlated-task$/.exec(event.message);
    if (!match || match[2] !== actionId) return { ok: false, reason: 'resume-message-invalid' };
    const handleId = match[1];
    const lockKey = sha256String(canonicalJSONStringify(['native-resume-failure', actionId, handleId]));
    const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'native-resume-failure-' + lockKey + '.lock');
    const locked = withRegistryLock(lockDir, () => {
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
      if (!actionRead.ok || actionRead.absent || !actionRead.obj) return { ok: false, reason: 'action-unavailable' };
      const action = actionRead.obj;
      if (action.kind !== 'role-notify' || action.runtime !== 'claude-native' || !action.payload ||
          action.payload.artifact_kind !== 'session-control' || action.payload.message !== event.message ||
          action.payload.teammate_name !== event.recipient || action.role !== event.recipient) {
        return { ok: false, reason: 'action-input-mismatch' };
      }

      const markerRead = readRegistryRecord(claudeResumeHandleConsumedMarkerPathFor(projectRoot, handleId));
      if (!markerRead.ok || markerRead.absent || !markerRead.obj) {
        return { ok: false, reason: 'resume-delivery-unconsumed' };
      }
      const marker = markerRead.obj;
      if (!hasExactKeys(marker, ['action_id', 'consumed_at', 'handle_id', 'schema', 'session_digest', 'tool_use_digest']) ||
          marker.schema !== 'runtime/native-resume-delivery/v1' || marker.action_id !== actionId ||
          marker.handle_id !== handleId || marker.session_digest !== sha256String(event.sessionId) ||
          marker.tool_use_digest !== sha256String(event.toolUseId) || !isCanonicalIsoUtc(marker.consumed_at)) {
        return { ok: false, reason: 'resume-delivery-correlation-mismatch' };
      }

      const handleRead = readClaudeResumeHandle(projectRoot, handleId);
      if (!handleRead.ok) return { ok: false, reason: 'resume-handle-unavailable' };
      const handle = handleRead.record;
      if (handle.role !== action.role || handle.worktree_id !== action.worktree_id ||
          handle.plan_digest !== action.plan_digest || handle.session_generation_id !== action.session_generation_id ||
          handle.session !== event.sessionId) return { ok: false, reason: 'resume-handle-scope-mismatch' };

      const profileDigest = roleProfileDigestFor(action.role);
      const state = readRoleBindingState(
        projectRoot, action.worktree_id, action.plan_digest, profileDigest,
        action.session_generation_id, action.role,
      );
      if (!state.ok || !state.record || state.record.driver !== 'claude-sendmessage') {
        return { ok: false, reason: 'resume-role-state-invalid' };
      }
      if (state.state === 'DEAD') return { ok: true, actionId, handleId, idempotent: true };
      if (state.state !== 'BUSY') return { ok: false, reason: 'resume-failure-stale' };
      const dead = transitionRoleBinding(
        projectRoot, action.worktree_id, action.plan_digest, profileDigest,
        action.session_generation_id, action.role, 'BUSY', 'DEAD', state.record, {},
      );
      if (!dead.ok) return { ok: false, reason: 'resume-failure-transition-failed' };
      return { ok: true, actionId, handleId, idempotent: false };
    }, { maxWaitMs: 5000 });
    return locked.ok && locked.value ? locked.value : { ok: false, reason: 'resume-failure-lock-failed' };
  }

  return Object.freeze({
    consumeNativeResumeNotificationBeforeDelivery,
    settleNativeResumeNotificationFailure,
  });
}

module.exports = Object.freeze({ createClaudeResumeDelivery });
