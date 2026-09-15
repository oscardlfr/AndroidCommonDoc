'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the rotate and
// stop-owned CLI subcommand handlers -- both grant-bound, owned-binding-only
// mutations sharing the same respawn/driver-selection and stop-payload
// seams. Never requires the facade or a sibling module.

function createCliRotateStopHandlers({
path, SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, CANONICAL_ROLES, invalidError, resolvePolicyPair,
  validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId, discoverPlan, computeWorktreeId,
  roleProfileDigestFor, readRoleBindingState, unavailableError, transitionRoleBinding, respawnBudgetExceeded,
  quarantineViaRehydrating, getCapabilityManifest, spawnOrRehydrateSingleRole, emitAndExit, makeResult, RC,
  roleBindingForEnvelope, actionForEnvelope, sha256String, buildSupervisorStopOwnedPayload,
  buildRoleStopOwnedPayload, generateActionId, canonicalJSONStringify, computeActionTtlSeconds,
  futureIsoForRegistry, mintRoleLifecycleAction, computeRepoId,
}) {

// ── rotate (Frozen CLI ABI, PLAN.md ~L147) ──────────────────────────────────────

/**
 * `rotate --project-root <absolute> --role <role> [--lifecycle-binding <grant-ref>]`
 * -- invalidate one owned binding and return the next policy-permitted action.
 * Only a currently READY/WAITING (owned+healthy) binding can be rotated; ABSENT
 * (no owned binding -- LRL-rotate-3's exact case)/BUSY/already-transitioning/
 * terminal states fail closed rather than fabricating a respawn. Reuses the
 * same `spawnOrRehydrate` driver-selection/action-mint step `ensure`'s own
 * DEAD->REHYDRATING path uses, bounded by the same `max_respawns_per_role`.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleRotate(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.rotate);
  if (!parsed.ok) {
    usageError('rotate');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('rotate');
    return;
  }
  const role = parsed.values['--role'];
  if (!CANONICAL_ROLES.includes(role)) {
    invalidError('rotate', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('rotate', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('rotate', 'IDENTITY_MISMATCH');
    return;
  }

  const argvDigest = sha256String('rotate:' + role);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role, 'rotate');
  if (!consumeResult.ok) {
    invalidError('rotate', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('rotate', 'INTERNAL_ERROR');
    return;
  }

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('rotate', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    invalidError('rotate', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(role);
  const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
  if (!stateResult.ok) {
    invalidError('rotate', 'INTERNAL_ERROR');
    return;
  }
  if (stateResult.state !== 'READY' && stateResult.state !== 'WAITING') {
    unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const toRotating = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, stateResult.state, 'ROTATING', stateResult.record, {});
  if (!toRotating.ok) {
    invalidError('rotate', 'AMBIGUOUS_OWNER');
    return;
  }

  if (respawnBudgetExceeded(toRotating.record, pair.policy)) {
    quarantineViaRehydrating(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'ROTATING', toRotating.record, 'respawn-budget-exceeded');
    unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const capabilityManifest = getCapabilityManifest(projectRoot);
  const respawnCount = (toRotating.record.respawn_count || 0) + 1;
  const spawnResult = spawnOrRehydrateSingleRole(projectRoot, pair, capabilityManifest, role, profileDigest, binding.worktree_id, binding.plan_digest, binding.session_generation_id, 'ROTATING', 'REHYDRATING', toRotating.record, respawnCount, binding.expiry);
  if (!spawnResult.ok) {
    if (spawnResult.unavailable) {
      quarantineViaRehydrating(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'ROTATING', toRotating.record, 'no-capable-driver');
      unavailableError('rotate', 'CAPABILITY_UNAVAILABLE');
      return;
    }
    invalidError('rotate', 'INTERNAL_ERROR');
    return;
  }

  if (spawnResult.terminal) {
    emitAndExit(makeResult('rotate', RC.OK, 'READY', 'NONE', [roleBindingForEnvelope(spawnResult.record)], []));
    return;
  }
  emitAndExit(makeResult('rotate', RC.OK, 'ACTION_REQUIRED', 'NONE', [], [actionForEnvelope(spawnResult.action)]));
}

// ── stop-owned (Frozen CLI ABI, PLAN.md ~L148) ──────────────────────────────────

const STOP_OWNED_REASON_ENUM = Object.freeze(['rotation', 'session-close', 'operator']);

/**
 * `stop-owned --project-root <absolute> --role <role> --reason <rotation|session-close|operator>
 * [--lifecycle-binding <grant-ref>]` -- return a stop action only for a binding
 * created/owned by the current session generation (grant-bound, exactly like
 * `rotate`); an unowned/absent/already-terminal binding fails closed
 * (LRL-stopowned-3's exact case) rather than addressing an ambiguous peer.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleStopOwned(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['stop-owned']);
  if (!parsed.ok) {
    usageError('stop-owned');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('stop-owned');
    return;
  }
  const reason = parsed.values['--reason'];
  if (!STOP_OWNED_REASON_ENUM.includes(reason)) {
    usageError('stop-owned');
    return;
  }
  const role = parsed.values['--role'];
  if (!CANONICAL_ROLES.includes(role)) {
    invalidError('stop-owned', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('stop-owned', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];
  if (lifecycleBindingRef === undefined) {
    invalidError('stop-owned', 'IDENTITY_MISMATCH');
    return;
  }

  const argvDigest = sha256String('stop-owned:' + role + ':' + reason);
  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, role, 'stop-owned');
  if (!consumeResult.ok) {
    invalidError('stop-owned', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }

  const planResult = discoverPlan(projectRoot);
  if (!planResult.ok) {
    invalidError('stop-owned', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    invalidError('stop-owned', 'IDENTITY_MISMATCH');
    return;
  }

  const profileDigest = roleProfileDigestFor(role);
  const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
  if (!stateResult.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }
  if (stateResult.state !== 'READY' && stateResult.state !== 'WAITING') {
    // ABSENT (no owned binding)/BUSY/already-terminal: never addresses an
    // unowned or ambiguous peer.
    unavailableError('stop-owned', 'CAPABILITY_UNAVAILABLE');
    return;
  }

  const toStopping = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, stateResult.state, 'STOPPING', stateResult.record, { stop_reason: reason });
  if (!toStopping.ok) {
    invalidError('stop-owned', 'AMBIGUOUS_OWNER');
    return;
  }

  const driver = toStopping.record.driver;
  const isCodex = driver === 'codex-app-server';
  const payload = isCodex
    ? buildSupervisorStopOwnedPayload(toStopping.record.binding_id, role, reason)
    : buildRoleStopOwnedPayload(toStopping.record.binding_id, role, reason, 'Stop your owned role binding and exit cleanly.');
  const actionId = generateActionId();
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const stopTtlResult = computeActionTtlSeconds(pair.policy, binding.expiry);
  if (!stopTtlResult.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }
  const stopExpiresAtIso = futureIsoForRegistry(stopTtlResult.ttlSeconds);
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, isCodex ? 'supervisor-stop-owned' : 'role-stop-owned', isCodex ? 'host-process' : 'claude-native', computeRepoId(projectRoot), binding.worktree_id, binding.plan_digest, policyDigest, binding.session_generation_id, role, payload, stopExpiresAtIso);
  if (!mintResult.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }

  const toStopped = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'STOPPING', 'STOPPED', toStopping.record, {});
  if (!toStopped.ok) {
    invalidError('stop-owned', 'INTERNAL_ERROR');
    return;
  }

  emitAndExit(makeResult('stop-owned', RC.OK, 'STOPPED', 'NONE', [], [actionForEnvelope(mintResult.action)]));
}

  return Object.freeze({
handleRotate, handleStopOwned,
  });
}

module.exports = { createCliRotateStopHandlers };
