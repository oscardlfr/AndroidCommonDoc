'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: direct-role-host
// admission -- the single atomic gate a direct (non-Claude-Code-native)
// role/root-source host actor passes through exactly once per action,
// idempotent on replay. Composes role-actor-binding, root-source-binding,
// CLAUDE-ID-01 observation, role-binding-state, and role-spawn-execution-claim
// authorities (all injected) -- never requires the facade or a sibling
// module, and is never itself required by them.

function createDirectRoleHostAdmission({
  path, registryRepoDir, readRegistryRecord, ensureSecureRegistryDir, publishNoClobber,
  canonicalJSONStringify, sha256String, isHexActionId, nowIsoForRegistry, withRegistryLock,
  findActionDirect, validateRootSourceBindingFor, admitAndCreateRootSourceBinding,
  recordClaudeStartupActorObservation, readRoleBindingState, transitionRoleBinding,
  roleProfileDigestFor, createRoleActorBinding, validateRoleActorBindingFor,
  ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS, validateAndConsumeRoleSpawnExecutionClaim,
}) {
const DIRECT_ROLE_HOST_ADMISSION_SCHEMA = 'runtime/direct-role-host-admission/v1';

function directRoleHostAdmissionPathFor(projectRootOrRepoDescriptor, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'direct-role-host-admissions', actionId + '.json');
}

function admitDirectRoleHostStartupUnlocked(projectRoot, actor, actionId) {
  if (!actor || actor.family !== 'direct-role-host' ||
      typeof actor.sessionId !== 'string' || actor.sessionId.length === 0 ||
      typeof actor.agentId !== 'string' || actor.agentId.length === 0 ||
      typeof actor.agentType !== 'string' || actor.agentType.length === 0 ||
      typeof actionId !== 'string' || actor.actionId !== actionId) {
    return { ok: false, reason: 'direct-role-host-actor-invalid' };
  }
  const actionRead = findActionDirect(projectRoot, actionId);
  if (!actionRead.ok || actionRead.absent || !actionRead.action) {
    return { ok: false, reason: 'direct-role-host-action-unreadable' };
  }
  const action = actionRead.action;
  const actionRole = action.payload && action.payload.agent_type;
  const persistentRole = action.kind === 'role-spawn';
  const rootSource = action.kind === 'root-source-spawn';
  if ((!persistentRole && !rootSource) || action.runtime !== 'claude-native' ||
      actionRole !== actor.agentType || (persistentRole && action.role !== actor.agentType)) {
    return { ok: false, reason: 'direct-role-host-action-mismatch' };
  }
  const markerPath = directRoleHostAdmissionPathFor(projectRoot, actionId);
  const markerRead = readRegistryRecord(markerPath);
  if (markerRead.ok && !markerRead.absent) {
    const marker = markerRead.obj;
    const binding = rootSource
      ? validateRootSourceBindingFor(projectRoot, marker && marker.binding_id,
        actor.agentType, action.worktree_id, action.plan_digest)
      : validateRoleActorBindingFor(projectRoot, marker && marker.binding_id,
        action.role, action.worktree_id, action.plan_digest);
    const validMarker = marker && marker.schema === DIRECT_ROLE_HOST_ADMISSION_SCHEMA &&
      marker.action_id === actionId && marker.action_digest === sha256String(canonicalJSONStringify(action)) &&
      marker.session_digest === sha256String(actor.sessionId) &&
      marker.agent_digest === sha256String(actor.agentId) && marker.role === actor.agentType &&
      binding.ok && (binding.binding || binding.record).session_generation_id === action.session_generation_id &&
      marker.binding_id === (binding.binding || binding.record).binding_id;
    return validMarker
      ? { ok: true, idempotent: true, action, claim: null,
        actorBinding: rootSource ? null : binding.binding,
        rootSourceBinding: rootSource ? binding.record : null }
      : { ok: false, reason: 'direct-role-host-admission-conflict' };
  }
  if (!markerRead.ok) return { ok: false, reason: markerRead.reason || 'direct-role-host-admission-unreadable' };
  if (rootSource) {
    const rootBinding = admitAndCreateRootSourceBinding(projectRoot, actionId, {
      runtimeSessionKey: actor.sessionId,
      agentType: actor.agentType,
      agentId: actor.agentId,
    });
    if (!rootBinding.ok) return rootBinding;
    const marker = {
      schema: DIRECT_ROLE_HOST_ADMISSION_SCHEMA,
      action_id: actionId,
      action_digest: sha256String(canonicalJSONStringify(action)),
      session_digest: sha256String(actor.sessionId),
      agent_digest: sha256String(actor.agentId),
      role: actor.agentType,
      binding_id: rootBinding.binding.binding_id,
      admitted_at: nowIsoForRegistry(),
    };
    const secure = ensureSecureRegistryDir(path.dirname(markerPath));
    if (!secure.ok) return { ok: false, reason: secure.reason };
    try {
      publishNoClobber(markerPath, Buffer.from(canonicalJSONStringify(marker), 'utf8'), {});
    } catch {
      return { ok: false, reason: 'direct-role-host-admission-conflict' };
    }
    return { ok: true, idempotent: false, action, claim: null,
      actorBinding: null, rootSourceBinding: rootBinding.binding };
  }
  const consumed = validateAndConsumeRoleSpawnExecutionClaim(projectRoot, action, {
    sessionId: actor.sessionId,
    agentId: actor.agentId,
    agentType: actor.agentType,
  }, projectRoot);
  if (!consumed.ok) return consumed;
  const actorBindingResult = createRoleActorBinding(
    projectRoot, action.role, action.worktree_id, action.plan_digest,
    action.session_generation_id, ROLE_ACTOR_BINDING_TTL_CEILING_SECONDS,
  );
  if (!actorBindingResult.ok) {
    return { ok: false, reason: 'direct-role-host-binding-' + actorBindingResult.reason };
  }
  const startup = recordClaudeStartupActorObservation(projectRoot, {
    sessionId: actor.sessionId,
    agentId: actor.agentId,
    agentType: actor.agentType,
    action,
    claim: consumed.claim,
    actorBinding: actorBindingResult.binding,
  });
  if (!startup.ok) return { ok: false, reason: 'direct-role-host-startup-' + startup.reason };
  const profileDigest = roleProfileDigestFor(action.role);
  const roleState = readRoleBindingState(
    projectRoot, action.worktree_id, action.plan_digest, profileDigest,
    action.session_generation_id, action.role,
  );
  if (!roleState.ok || !roleState.record ||
      (roleState.state !== 'STARTING' && roleState.state !== 'REHYDRATING') ||
      roleState.record.pending_action_id !== actionId) {
    return { ok: false, reason: 'direct-role-host-state-unavailable' };
  }
  const ready = transitionRoleBinding(
    projectRoot, action.worktree_id, action.plan_digest, profileDigest,
    action.session_generation_id, action.role, roleState.state, 'READY', roleState.record, {},
  );
  if (!ready.ok) return { ok: false, reason: 'direct-role-host-ready-transition-failed' };
  const marker = {
    schema: DIRECT_ROLE_HOST_ADMISSION_SCHEMA,
    action_id: actionId,
    action_digest: sha256String(canonicalJSONStringify(action)),
    session_digest: sha256String(actor.sessionId),
    agent_digest: sha256String(actor.agentId),
    role: actor.agentType,
    binding_id: actorBindingResult.binding.binding_id,
    admitted_at: nowIsoForRegistry(),
  };
  const secure = ensureSecureRegistryDir(path.dirname(markerPath));
  if (!secure.ok) return { ok: false, reason: secure.reason };
  try {
    publishNoClobber(markerPath, Buffer.from(canonicalJSONStringify(marker), 'utf8'), {});
  } catch {
    return { ok: false, reason: 'direct-role-host-admission-conflict' };
  }
  return {
    ok: true, idempotent: false, action, claim: consumed.claim,
    actorBinding: actorBindingResult.binding, startup: startup.record,
  };
}

function admitDirectRoleHostStartup(projectRoot, actor, actionId) {
  if (typeof actionId !== 'string' || !isHexActionId(actionId)) {
    return { ok: false, reason: 'direct-role-host-action-invalid' };
  }
  let repoDir;
  try { repoDir = registryRepoDir(projectRoot); } catch {
    return { ok: false, reason: 'direct-role-host-project-invalid' };
  }
  const lockDir = path.join(repoDir, 'locks', `direct-role-host-admission-${actionId}.lock`);
  const locked = withRegistryLock(lockDir,
    () => admitDirectRoleHostStartupUnlocked(projectRoot, actor, actionId),
    { maxWaitMs: 5000 });
  if (!locked.ok || !locked.value) {
    return { ok: false, reason: locked.reason || 'direct-role-host-admission-lock-failed' };
  }
  return locked.value;
}

  return Object.freeze({ admitDirectRoleHostStartup, directRoleHostAdmissionPathFor });
}

module.exports = { createDirectRoleHostAdmission };
