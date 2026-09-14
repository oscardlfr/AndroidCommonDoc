'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the resume-checkpoint
// half of `ensure` -- resume-handle discovery, the resume-checkpoint action
// finder, the resume-checkpoint reconciliation seam, and the shared
// quarantine-via-rehydrating helper. Never requires the facade or a sibling
// module.

function createResumeCheckpoint({
path, fs, canonicalJSONStringify, sha256String, isCanonicalIsoUtc, isoToMsForRegistry,
  currentClockMsForRegistry, nowIsoForRegistry, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace,
  hasExactKeys, roleProfileDigestFor, readRoleBindingState, transitionRoleBinding,
  transitionRoleBindingAtomicViaWaypoint, findUniqueClaudeResumeHandleForTarget,
  consumeClaudeResumeHandleForObservedActor, parkClaudeResumeHandleForRoleActor,
  CLAUDE_RESUME_HANDLE_TTL_SECONDS, computeClaudeAuthorityIdentityId, readClaudeAuthorityFence,
  makeOperation, roleBindingPathFor,
  CLAUDE_RESUME_HANDLE_KEYS, CLAUDE_RESUME_HANDLE_SCAN_CAP, CLAUDE_RESUME_HANDLE_SCHEMA,
  MAX_ACTION_REPO_SCAN_ENTRIES, actionForEnvelope, actionPathFor, buildRoleNotifyPayload,
  claudeResumeHandlePathFor, computeActionTtlSeconds, computeRepoId, futureIsoForRegistry, generateActionId,
  interpretedActionMarkerPathFor, isClaudeResumeHandleConsumed, mintRoleLifecycleAction, readClaudeResumeHandle,
  validateClaudeResumeHandleRecord,
}) {

// ── ensure (Frozen CLI ABI, PLAN.md ~L141) ──────────────────────────────────────

/** STDOUT-safe projection of a role-binding record (never echoes registry-
 * internal-only bookkeeping beyond what the envelope needs). */
function roleBindingForEnvelope(record) {
  return {
    schema: 'runtime/role-binding-summary/v1',
    binding_id: record.binding_id,
    role: record.role,
    state: record.state,
    driver: record.driver || null,
    session_generation_id: record.session_generation_id,
  };
}

// Respawn ceiling default when a policy's own max_respawns_per_role is absent
// from this code path's reach (defensive only -- isValidPolicy already requires
// the field; this is never hit in a policy that passed validation).
function respawnBudgetExceeded(record, policy) {
  const count = typeof record.respawn_count === 'number' ? record.respawn_count : 0;
  return count >= policy.max_respawns_per_role;
}

const RESUME_CHECKPOINT_REF_RE = /^checkpoint:[0-9a-f]{64}$/;
const RESUME_CHECKPOINT_COMPLETION_SCHEMA = 'runtime/resume-checkpoint-completion/v1';

function legacyResumeCheckpointMessage(checkpointRef, handleId, actionId) {
  return `Resume the parked actor for ${checkpointRef} using resume-handle:${handleId}; runtime-action:${actionId}.`;
}

function resumeCheckpointMessage(checkpointRef, handleId, actionId) {
  return [
    'RUNTIME_RESUME/v1',
    checkpointRef,
    `resume-handle:${handleId}`,
    `runtime-action:${actionId}`,
    'host-status:validated-and-consumed-before-delivery',
    'actor-action:none',
    'reply:none',
    'next:wait-for-correlated-task',
  ].join('\n');
}

function findLiveResumeHandlesForLifecycleRole(projectRoot, expected) {
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
    if (entry.name.startsWith('.') || entry.name.endsWith('.consumed')) continue;
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
    const handleId = entry.name.slice(0, -5);
    const raw = readRegistryRecord(claudeResumeHandlePathFor(projectRoot, handleId));
    if (!raw.ok || raw.absent || !raw.obj) return { ok: false, reason: 'INVALID' };
    const record = raw.obj;
    if (!hasExactKeys(record, CLAUDE_RESUME_HANDLE_KEYS) || record.schema !== CLAUDE_RESUME_HANDLE_SCHEMA || record.binding_id !== handleId) {
      return { ok: false, reason: 'INVALID' };
    }
    if (
      record.worktree_id !== expected.worktreeId
      || record.plan_digest !== expected.planDigest
      || record.session_generation_id !== expected.generationId
      || record.role !== expected.role
    ) {
      continue;
    }
    const validated = validateClaudeResumeHandleRecord(record, handleId);
    if (!validated.ok) {
      if (isClaudeResumeHandleConsumed(projectRoot, handleId)) continue;
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    if (!isClaudeResumeHandleConsumed(projectRoot, handleId)) records.push(validated.record);
  }
  return { ok: true, records };
}

function findResumeCheckpointActionForRole(projectRoot, expected) {
  const dir = path.join(registryRepoDir(projectRoot), 'actions');
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, action: null, handle: null, consumed: false, interpreted: false };
    return { ok: false, reason: 'INVALID' };
  }
  if (entries.length > MAX_ACTION_REPO_SCAN_ENTRIES) return { ok: false, reason: 'INVALID' };
  const matches = [];
  for (const entry of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) return { ok: false, reason: 'INVALID' };
    const actionId = entry.name.slice(0, -5);
    const read = readRegistryRecord(actionPathFor(projectRoot, actionId));
    if (!read.ok || read.absent || !read.obj) return { ok: false, reason: 'INVALID' };
    const action = read.obj;
    if (
      action.kind !== 'role-notify'
      || action.runtime !== 'claude-native'
      || action.worktree_id !== expected.worktreeId
      || action.plan_digest !== expected.planDigest
      || action.session_generation_id !== expected.generationId
      || action.role !== expected.role
      || !action.payload
      || action.payload.artifact_ref !== expected.checkpointRef
      || action.payload.artifact_kind !== 'session-control'
    ) {
      continue;
    }
    if (!hasExactKeys(action.payload, ['artifact_kind', 'artifact_ref', 'binding_id', 'message', 'teammate_name'])) {
      return { ok: false, reason: 'INVALID' };
    }
    const currentHandleMatch = /^RUNTIME_RESUME\/v1\ncheckpoint:[0-9a-f]{64}\nresume-handle:([0-9a-f]{32})\nruntime-action:([0-9a-f]{32})\nhost-status:validated-and-consumed-before-delivery\nactor-action:none\nreply:none\nnext:wait-for-correlated-task$/.exec(action.payload.message);
    const legacyHandleMatch = /^Resume the parked actor for checkpoint:[0-9a-f]{64} using resume-handle:([0-9a-f]{32}); runtime-action:([0-9a-f]{32})\.$/.exec(action.payload.message);
    const handleMatch = currentHandleMatch || legacyHandleMatch;
    if (!handleMatch || handleMatch[2] !== actionId || action.action_id !== actionId) return { ok: false, reason: 'INVALID' };
    const expectedMessage = currentHandleMatch
      ? resumeCheckpointMessage(expected.checkpointRef, handleMatch[1], actionId)
      : legacyResumeCheckpointMessage(expected.checkpointRef, handleMatch[1], actionId);
    if (action.payload.message !== expectedMessage) {
      return { ok: false, reason: 'INVALID' };
    }
    const handle = readClaudeResumeHandle(projectRoot, handleMatch[1]);
    if (!handle.ok) return { ok: false, reason: handle.reason };
    if (
      handle.record.worktree_id !== expected.worktreeId
      || handle.record.plan_digest !== expected.planDigest
      || handle.record.session_generation_id !== expected.generationId
      || handle.record.role !== expected.role
    ) {
      return { ok: false, reason: 'INVALID' };
    }
    matches.push({ action, handle: handle.record });
  }
  if (matches.length > 1) return { ok: false, reason: 'INVALID' };
  if (matches.length === 0) return { ok: true, action: null, handle: null, consumed: false, interpreted: false };
  const match = matches[0];
  return {
    ok: true,
    action: match.action,
    handle: match.handle,
    consumed: isClaudeResumeHandleConsumed(projectRoot, match.handle.binding_id),
    interpreted: fs.existsSync(interpretedActionMarkerPathFor(projectRoot, match.action.action_id)),
  };
}

function executeResumeCheckpointEnsure(projectRoot, binding, pair, sortedRoles, checkpointRef) {
  const collectedBindings = [];
  const collectedActions = [];
  const resumedRoles = [];
  let waitingForParkOrStart = false;
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));

  for (const role of sortedRoles) {
    const profileDigest = roleProfileDigestFor(role);
    const state = readRoleBindingState(
      projectRoot, binding.worktree_id, binding.plan_digest, profileDigest,
      binding.session_generation_id, role,
    );
    if (!state.ok || !state.record || !['READY', 'WAITING', 'BUSY'].includes(state.state)) {
      return { ok: false, reason: 'UNAVAILABLE' };
    }
    if (state.record.driver !== 'claude-sendmessage') return { ok: false, reason: 'UNAVAILABLE' };
    collectedBindings.push(roleBindingForEnvelope(state.record));

    const existing = findResumeCheckpointActionForRole(projectRoot, {
      worktreeId: binding.worktree_id,
      planDigest: binding.plan_digest,
      generationId: binding.session_generation_id,
      role,
      checkpointRef,
    });
    if (!existing.ok) return existing;
    if (existing.action) {
      if (existing.action.payload.binding_id !== state.record.binding_id) return { ok: false, reason: 'INVALID' };
      if (existing.consumed) {
        resumedRoles.push(role);
      } else if (existing.interpreted) {
        waitingForParkOrStart = true;
      } else {
        if (currentClockMsForRegistry() >= isoToMsForRegistry(existing.action.expires_at)) return { ok: false, reason: 'UNAVAILABLE' };
        collectedActions.push(Object.assign(actionForEnvelope(existing.action), { operation: 'SendMessage' }));
      }
      continue;
    }

    if (state.state !== 'WAITING') {
      waitingForParkOrStart = true;
      continue;
    }
    const handles = findLiveResumeHandlesForLifecycleRole(projectRoot, {
      worktreeId: binding.worktree_id,
      planDigest: binding.plan_digest,
      generationId: binding.session_generation_id,
      role,
    });
    if (!handles.ok) return handles;
    if (handles.records.length !== 1) return { ok: false, reason: handles.records.length === 0 ? 'UNAVAILABLE' : 'INVALID' };
    const handle = handles.records[0];
    const actionId = generateActionId();
    const ttl = computeActionTtlSeconds(pair.policy, binding.expiry);
    if (!ttl.ok) return { ok: false, reason: 'INVALID' };
    const payload = buildRoleNotifyPayload(
      state.record.binding_id,
      role,
      checkpointRef,
      'session-control',
      resumeCheckpointMessage(checkpointRef, handle.binding_id, actionId),
    );
    const minted = mintRoleLifecycleAction(
      projectRoot, actionId, 'role-notify', 'claude-native', computeRepoId(projectRoot),
      binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id,
      role, payload, futureIsoForRegistry(ttl.ttlSeconds),
    );
    if (!minted.ok) return { ok: false, reason: 'INVALID' };
    collectedActions.push(Object.assign(actionForEnvelope(minted.action), { operation: 'SendMessage' }));
  }

  if (resumedRoles.length === sortedRoles.length) {
    return {
      ok: true,
      status: 'READY',
      bindings: collectedBindings,
      actions: [],
      operation: {
        schema: RESUME_CHECKPOINT_COMPLETION_SCHEMA,
        checkpoint_ref: checkpointRef,
        resumed_roles: resumedRoles,
      },
    };
  }
  return {
    ok: true,
    status: 'ACTION_REQUIRED',
    bindings: collectedBindings,
    actions: collectedActions,
    waiting: waitingForParkOrStart,
  };
}

/**
 * Quarantines a binding that needs a fresh connector but has exhausted its
 * respawn budget or has no capable driver. `DEAD` and `ROTATING` have no
 * DIRECT edge to `QUARANTINED` in the closed transition graph -- only
 * `REHYDRATING` does -- so this hops through the mandatory REHYDRATING
 * waypoint rather than widening the (already exhaustively tested) graph.
 * R4 round 2, point 4: REHYDRATING here is a pure STRUCTURAL graph
 * waypoint, never a genuine wait for a real pending action -- persisting it
 * (the OLD two-write approach) left a durable, on-disk REHYDRATING record
 * with no `pending_action_id`, which is exactly the shape
 * `roleBindingExtraFieldsAreClosedForState`'s now-bidirectional check
 * correctly rejects. `transitionRoleBindingAtomicViaWaypoint` validates
 * both hops but persists only the final QUARANTINED record, so the
 * incomplete waypoint is never durably observable at all.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function quarantineViaRehydrating(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, fromState, fromRecord, reason) {
  // Point A.3: the extraFields KEY is failure_reason, matching every other
  // quarantine/terminalization path (terminalizeSupervisorStartAction et
  // al.) and ROLE_BINDING_ALLOWED_KEYS -- a bare `reason` here was a
  // pre-existing field-name drift readRoleBindingState's closed key-set
  // check correctly surfaces as role-binding-shape-invalid.
  return transitionRoleBindingAtomicViaWaypoint(repoDirDescriptor, worktreeId, planDigest, profileDigest, generationId, role, fromState, 'REHYDRATING', 'QUARANTINED', fromRecord, { failure_reason: reason });
}

  return Object.freeze({
roleBindingForEnvelope, respawnBudgetExceeded, legacyResumeCheckpointMessage, resumeCheckpointMessage,
    findLiveResumeHandlesForLifecycleRole, findResumeCheckpointActionForRole,
    executeResumeCheckpointEnsure, quarantineViaRehydrating, RESUME_CHECKPOINT_REF_RE,
  });
}

module.exports = { createResumeCheckpoint };
