'use strict';

function createEnsureActiveRouting(deps) {
  const {
    actionForEnvelope,
    buildRoleNotifyPayload,
    canonicalJSONStringify,
    claudeLivenessProbeMessage,
    codexAppServerStartupEligible,
    computeRepoId,
    effectiveActionTtlSeconds,
    findClaudeLivenessProbeState,
    futureIsoForRegistry,
    generateActionId,
    hasRegisteredValidatedDiskConsumer,
    isTestCapability,
    indexClaudeLivenessProbeAction,
    mintRoleLifecycleAction,
    path,
    registryRepoDir,
    resolveHostOperationForAction,
    resolveSupervisorStartability,
    roleBindingForEnvelope,
    selectLifecycleEligibleDriverForRole,
    sha256String,
    transitionRoleBindingAtomicViaWaypoint,
    withRegistryLock,
  } = deps;

  function resolveOrMintLivenessProbe(projectRoot, binding, pair, role, stateRecord, liveness) {
    const lockKey = sha256String(canonicalJSONStringify([
      binding.session_generation_id, binding.worktree_id, binding.plan_digest,
      role, liveness.actorBindingId, liveness.actorDigest,
    ]));
    const lockDir = path.join(registryRepoDir(projectRoot), 'locks', 'claude-liveness-scope-' + lockKey + '.lock');
    const locked = withRegistryLock(lockDir, () => {
      const probe = findClaudeLivenessProbeState(projectRoot, {
        generationId: binding.session_generation_id, planDigest: binding.plan_digest,
        role, worktreeId: binding.worktree_id,
        actorBindingId: liveness.actorBindingId, actorDigest: liveness.actorDigest,
      });
      if (!probe.ok || probe.status !== 'NONE') return probe;
      const actionId = generateActionId();
      const message = claudeLivenessProbeMessage(actionId, liveness.actorBindingId, liveness.actorDigest);
      const payload = buildRoleNotifyPayload(
        stateRecord.binding_id, role, `liveness:${liveness.actorBindingId}:${liveness.actorDigest}`,
        'session-control', message,
      );
      const ttl = effectiveActionTtlSeconds(pair.policy, binding.expiry, {
        kind: 'role-notify', runtime: 'claude-native',
      });
      if (!ttl.ok) return { ok: false, reason: 'liveness-action-ttl-invalid' };
      const minted = mintRoleLifecycleAction(
        projectRoot, actionId, 'role-notify', 'claude-native', computeRepoId(projectRoot),
        binding.worktree_id, binding.plan_digest,
        sha256String(canonicalJSONStringify(pair.routing)), binding.session_generation_id,
        role, payload, futureIsoForRegistry(ttl.ttlSeconds),
      );
      if (!minted.ok) return { ok: false, reason: 'liveness-action-mint-failed' };
      const indexed = indexClaudeLivenessProbeAction(projectRoot, {
        generationId: binding.session_generation_id, planDigest: binding.plan_digest,
        role, worktreeId: binding.worktree_id,
        actorBindingId: liveness.actorBindingId, actorDigest: liveness.actorDigest,
      }, minted.action);
      return indexed.ok
        ? { ok: true, status: 'PENDING', action: minted.action }
        : { ok: false, reason: indexed.reason || 'liveness-action-index-failed' };
    }, { maxWaitMs: 5000 });
    return locked.ok && locked.value
      ? locked.value : { ok: false, reason: 'liveness-scope-lock-failed' };
  }

  function groupEnsurePendingSpawns(projectRoot, binding, pair, capabilityManifest, pendingSpawns) {
    const codexAppServerGroup = [];
    const claudeSendmessageGroup = [];
    const collectedBindings = [];
    const unavailable = [];
    const deterministicAppServerTestBackend = (
      isTestCapability()
      && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BACKEND === 'deterministic-app-server-v1'
    );
    const policySelectedLifecycleDriverBase = (!deterministicAppServerTestBackend
      && pair.policy.schema === 'runtime-collaboration-policy/v2'
      && pair.policy.selection.requested_host === 'claude'
      && pair.policy.selection.requested_role_engine === 'claude'
      && pair.policy.selection.fallback.mode === 'deny'
      && pair.policy.selection.fallback.allowed.length === 0
    ) ? 'claude-sendmessage' : null;
    const codexWorkerOptInRolesForEnsure = (
      pair.policy.schema === 'runtime-collaboration-policy/v2'
      && Array.isArray(pair.policy.selection.codex_worker_opt_in_roles)
    ) ? pair.policy.selection.codex_worker_opt_in_roles : [];
    let supervisorStartabilityResult = null;
    const ensureSupervisorStartabilityChecked = () => {
      if (supervisorStartabilityResult === null) {
        supervisorStartabilityResult = resolveSupervisorStartability(projectRoot, 'codex-app-server');
      }
      return supervisorStartabilityResult;
    };
    for (const spawn of pendingSpawns) {
      const perRoleExclusions = []
        .concat(spawn.excludeDriver ? [spawn.excludeDriver] : [])
        .concat(hasRegisteredValidatedDiskConsumer(
          projectRoot, spawn.role, binding.worktree_id, binding.plan_digest, binding.session_generation_id,
        ) ? [] : ['noop']);
      let policySelectedLifecycleDriver = policySelectedLifecycleDriverBase;
      if (codexWorkerOptInRolesForEnsure.includes(spawn.role)) policySelectedLifecycleDriver = null;
      let driver = null;
      if (policySelectedLifecycleDriver) {
        if (!perRoleExclusions.includes(policySelectedLifecycleDriver)
            && capabilityManifest.availableDrivers.includes(policySelectedLifecycleDriver)) {
          driver = policySelectedLifecycleDriver;
        }
      } else if (spawn.requiredDriver === 'claude-sendmessage') {
        if (!perRoleExclusions.includes('claude-sendmessage')
            && capabilityManifest.availableDrivers.includes('claude-sendmessage')) driver = 'claude-sendmessage';
      } else if (spawn.requiredDriver === 'codex-app-server' || codexWorkerOptInRolesForEnsure.includes(spawn.role)) {
        if (codexAppServerStartupEligible(pair.routing, spawn.role, perRoleExclusions)
            && ensureSupervisorStartabilityChecked().ok) driver = 'codex-app-server';
      } else {
        driver = selectLifecycleEligibleDriverForRole(
          pair.routing, spawn.role, capabilityManifest, perRoleExclusions,
        );
      }
      if (!policySelectedLifecycleDriver && !spawn.requiredDriver && !driver
          && codexAppServerStartupEligible(pair.routing, spawn.role, perRoleExclusions)
          && ensureSupervisorStartabilityChecked().ok) {
        driver = 'codex-app-server';
      }
      if (!driver) {
        unavailable.push({ role: spawn.role, reason: 'no-eligible-driver' });
        continue;
      }
      if (driver === 'noop') {
        const transitioned = transitionRoleBindingAtomicViaWaypoint(
          projectRoot, binding.worktree_id, binding.plan_digest, spawn.profileDigest,
          binding.session_generation_id, spawn.role, spawn.fromState, spawn.toState,
          'READY', spawn.fromRecord, { driver, respawn_count: spawn.respawnCount },
        );
        if (!transitioned.ok) return { ok: false };
        collectedBindings.push(roleBindingForEnvelope(transitioned.record));
        continue;
      }
      if (driver === 'codex-app-server') {
        codexAppServerGroup.push(Object.assign({ driver }, spawn));
        continue;
      }
      if (driver === 'claude-sendmessage') {
        claudeSendmessageGroup.push(Object.assign({ driver }, spawn));
        continue;
      }
      return { ok: false };
    }
    return { ok: true, claudeSendmessageGroup, codexAppServerGroup, collectedBindings, unavailable };
  }

  return Object.freeze({ groupEnsurePendingSpawns, resolveOrMintLivenessProbe });
}

module.exports = Object.freeze({ createEnsureActiveRouting });
