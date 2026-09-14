'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the codex-app-server
// batch mint under the supervisor lifecycle owner transaction, the
// underlying supervisor-start action mint, and the single-role
// spawn/rehydrate driver-selection mint `rotate` also uses. Never requires
// the facade or a sibling module.

function createSupervisorBatchMint({
path, fs, crypto, registryRepoDir, canonicalJSONStringify, sha256String, currentClockMsForRegistry,
  isoToMsForRegistry, nowIsoForRegistry, futureIsoForRegistry, computeCoordinationRootIdFromPath,
  withRegistryLock, supervisorLifecycleTxLockDirFor, readSupervisorLifecycleOwnerState,
  isSupervisorLifecycleOwnerActionStale, terminalizeSupervisorLifecycleOwnerIfCurrent,
  markSupervisorLifecycleOwnerRetained, supervisorLifecycleTransactionContentionBudgetMs,
  generateActionId, mintRoleLifecycleAction, actionForEnvelope, buildSupervisorStartPayload,
  effectiveActionTtlSeconds, transitionRoleBinding, transitionRoleBindingAtomicViaWaypoint,
  roleBindingForEnvelope, SUPERVISOR_LIFECYCLE_OWNER_SCHEMA, actionPathFor, buildRoleSpawnPayload,
  claudeReadyBootstrapMessageFor, computeCoordinationRootId, computeRepoId, coordinationRootPathFor,
  ensureSecureRegistryDir, hasRegisteredValidatedDiskConsumer, isCanonicalIsoUtc, isTestCapability,
  publishNoClobber, readLiveSessionGenerationById, readRegistryRecord, resolvedNodePath,
  selectLifecycleEligibleDriverForRole, supervisorLifecycleOwnerPathFor,
  supervisorRetainedServiceExpiryFromAction, transitionSupervisorLifecycleOwner, writeRegistryRecordReplace,
}) {

/**
 * Classify (is a supervisor already owned/being-established for this exact
 * coordination root), mint the ONE batched action, transition every
 * affected binding to STARTING, and publish/refresh the durable
 * SupervisorLifecycleOwner marker -- all inside a single lock. A partial
 * failure mid-transaction (e.g. a role-binding transition failing after the
 * action was already minted) rolls back EVERYTHING already done -- the
 * minted action file is deleted and any already-transitioned bindings are
 * quarantined -- before the lock releases, so no concurrent caller can ever
 * observe, and no retry can ever reference, an orphaned action.
 * @param {Array<{role:string,profileDigest:string,fromState:string,toState:string,fromRecord:object|null,respawnCount:number,driver:string}>} codexGroup
 * @returns {{ok:true,unavailable:boolean,actionId?:string,action?:object}|{ok:false,reason?:string}}
 */
function mintSupervisorBatchUnderTransaction(projectRoot, pair, repoId, worktreeId, planDigest, generationId, codexGroup, bindingExpiryIso) {
  const coordinationRootId = computeCoordinationRootId(projectRoot);
  const lockDir = supervisorLifecycleTxLockDirFor(projectRoot, coordinationRootId);
  const ownerPath = supervisorLifecycleOwnerPathFor(projectRoot, coordinationRootId);
  const result = withRegistryLock(lockDir, () => {
    // Fresh, lock-protected re-check -- never trust a pre-lock snapshot.
    const ownerState = readSupervisorLifecycleOwnerState(projectRoot, coordinationRootId);
    if (!ownerState.ok) return { ok: false, reason: ownerState.reason };

    let replacingSettledOwner = false;
    if (ownerState.state === 'ACTIVE') {
      const staleCheck = isSupervisorLifecycleOwnerActionStale(projectRoot, ownerState.record);
      if (!staleCheck.ok) return { ok: false, reason: staleCheck.reason };
      if (!staleCheck.stale) {
        // Group A / C4 slice (2026-08-10, user-authorized "segundo ensure()
        // demostrando reuse"): an ACTIVE, non-stale owner for THIS
        // coordination root already exists -- the physical singleton this
        // guards against is genuinely project-wide (at most one retained
        // codex-app-server supervisor per project), never session-scoped, so
        // a DIFFERENT session generation's ensure() call for the SAME
        // already-owned role set is a legitimate reuse, not a conflict. Only
        // when EVERY role this batch requests is already covered by the
        // active owner's own role set does this reuse the EXISTING action;
        // a request naming even ONE role the active owner does not already
        // cover stays genuinely unavailable below (never a partial/
        // fabricated substitution).
        // A RETAINED owner is already past launch admission.  Its startup
        // action may legitimately be expired and must never be surfaced as a
        // fresh ACTION_REQUIRED instruction. Healthy reuse is resolved from
        // its READY bindings before this transaction; any arrival here is an
        // unavailable/no-mint outcome.
        if (ownerState.record.phase === 'RETAINED') {
          return { ok: true, unavailable: true };
        }
        const requestedRoles = codexGroup.map((s) => s.role);
        const ownerCoversAllRequested = requestedRoles.length > 0 && requestedRoles.every((r) => ownerState.record.roles.includes(r));
        if (ownerCoversAllRequested) {
          const existingActionRead = readRegistryRecord(actionPathFor(projectRoot, ownerState.record.action_id));
          if (existingActionRead.ok && !existingActionRead.absent) {
            return { ok: true, unavailable: false, actionId: ownerState.record.action_id, action: existingActionRead.obj };
          }
        }
        return { ok: true, unavailable: true };
      }
      // Point B.3 self-heal: the owning action expired without ever being
      // explicitly resolved (crash) -- terminalize the stale owner right
      // here, under this SAME lock, before considering the root free.
      const healed = transitionSupervisorLifecycleOwner(projectRoot, coordinationRootId, 'ACTIVE', 'TERMINATED', ownerState.record, { failure_reason: 'stale-action-expired' });
      if (!healed.ok) return { ok: false, reason: healed.reason };
      replacingSettledOwner = true;
    } else if (ownerState.state === 'TERMINATED') {
      replacingSettledOwner = true;
    }
    // ownerState.state === 'ABSENT' -> replacingSettledOwner stays false (fresh create).

    // Test-only synchronous widening of this critical section, so a bats/
    // node:test can deterministically prove a SECOND real concurrent process
    // genuinely blocks on withRegistryLock rather than racing past it. Grants
    // no authority (timing only) -- single isTestCapability() gate is
    // sufficient, mirroring the bridge's own testAcquisitionDelayMs. Safe to
    // use a blocking sleep here (unlike session-run's long-lived acquisition
    // loop): `ensure` is a short-lived CLI invocation with no concurrent
    // signal-handling requirement to preserve.
    if (isTestCapability()) {
      const raw = process.env.RUNTIME_ROLE_LIFECYCLE_TEST_TX_DELAY_MS;
      const delayMs = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(delayMs) && delayMs > 0) {
        try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs); } catch (err) { /* best effort */ }
      }
    }

    const batched = mintBatchedSupervisorStartAction(projectRoot, pair, repoId, worktreeId, planDigest, generationId, codexGroup.map((s) => s.role), bindingExpiryIso);
    if (!batched.ok) return { ok: false, reason: 'mint-failed' };

    const transitioned = [];
    for (const spawn of codexGroup) {
      const t1 = transitionRoleBinding(projectRoot, worktreeId, planDigest, spawn.profileDigest, generationId, spawn.role, spawn.fromState, spawn.toState, spawn.fromRecord, { driver: spawn.driver, respawn_count: spawn.respawnCount, pending_action_id: batched.actionId });
      if (!t1.ok) {
        for (const t of transitioned) {
          transitionRoleBinding(projectRoot, worktreeId, planDigest, t.spawn.profileDigest, generationId, t.spawn.role, t.spawn.toState, 'QUARANTINED', t.record, { failure_reason: 'batch-sibling-transition-failed' });
        }
        try { fs.unlinkSync(actionPathFor(projectRoot, batched.actionId)); } catch (err) { /* best effort -- never fatal for a rollback */ }
        return { ok: false, reason: 'transition-failed' };
      }
      transitioned.push({ spawn, record: t1.record });
    }

    const ownerRecord = {
      schema: SUPERVISOR_LIFECYCLE_OWNER_SCHEMA,
      coordination_root_id: coordinationRootId,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      session_generation_id: generationId,
      action_id: batched.actionId,
      roles: codexGroup.map((s) => s.role).sort(),
      state: 'ACTIVE',
      phase: 'STARTING',
      service_expiry: supervisorRetainedServiceExpiryFromAction(batched.action),
      pid_identity: null,
      created_at: nowIsoForRegistry(),
      updated_at: nowIsoForRegistry(),
    };
    let publishOk = true;
    try {
      if (replacingSettledOwner) {
        // A prior batch at this SAME coordination root already definitively
        // settled (terminalized, just now or earlier) -- a plain no-clobber
        // create would wrongly EEXIST-reject the next legitimate batch.
        const replaced = writeRegistryRecordReplace(ownerPath, Buffer.from(canonicalJSONStringify(ownerRecord), 'utf8'));
        publishOk = replaced.ok;
      } else {
        const dirResult = ensureSecureRegistryDir(path.dirname(ownerPath));
        publishOk = dirResult.ok;
        if (publishOk) publishNoClobber(ownerPath, Buffer.from(canonicalJSONStringify(ownerRecord), 'utf8'), {});
      }
    } catch (err) {
      publishOk = false; // fall through to the shared rollback below
    }
    if (!publishOk) {
      // Structurally should be impossible (the prior state was just proven
      // under THIS SAME lock) -- fail closed and roll back rather than
      // proceed on an ambiguous durability outcome.
      for (const t of transitioned) {
        transitionRoleBinding(projectRoot, worktreeId, planDigest, t.spawn.profileDigest, generationId, t.spawn.role, t.spawn.toState, 'QUARANTINED', t.record, { failure_reason: 'owner-publish-failed' });
      }
      try { fs.unlinkSync(actionPathFor(projectRoot, batched.actionId)); } catch (err) { /* best effort */ }
      return { ok: false, reason: 'owner-publish-failed' };
    }

    return { ok: true, unavailable: false, actionId: batched.actionId, action: batched.action };
  }, { maxWaitMs: supervisorLifecycleTransactionContentionBudgetMs() });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

function mintBatchedSupervisorStartAction(projectRoot, pair, repoId, worktreeId, planDigest, generationId, roles, bindingExpiryIso) {
  const sortedUniqueRoles = Array.from(new Set(roles)).sort();
  const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
  const actionId = generateActionId();
  // Runtime code belongs to the installed source-referenced toolkit.  The
  // consumer root remains the authority/state root passed to the bridge.
  const bridgePath = path.join(__dirname, '..', 'runtime-bridge-codex.cjs');
  const coordRoot = coordinationRootPathFor(projectRoot);
  // The action deadline remains the bounded launch/READY authority.  The
  // retained-service boundary is independently derived from the two live
  // session authorities and is only carried by --session-expiry.
  // Minted WITH its own scope, exactly as the three claude-native startup mints already do. Without
  // it the resolver cannot tell a supervisor start from an ordinary correlation window and falls to
  // the 120-second action ceiling -- the whole startup budget for creating an isolation root per
  // role, confining it, materializing its config, spawning a real app-server, proving its birth
  // provenance, initializing, logging in, starting a thread and completing a live bootstrap turn,
  // for every role in the batch. Measured on live attempt N10: this action expired 364 seconds
  // before the native startups minted beside it, the batch never reached READY, and init-session
  // reported support-plane-action-required for 37 polls until the relayed set expired.
  const ttlResult = effectiveActionTtlSeconds(pair.policy, bindingExpiryIso, {
    kind: 'supervisor-start', runtime: 'host-process',
  });
  if (!ttlResult.ok) return { ok: false, reason: ttlResult.reason };
  const expiresAtIso = futureIsoForRegistry(ttlResult.ttlSeconds);
  const generation = readLiveSessionGenerationById(projectRoot, generationId);
  if (!generation.ok || !isCanonicalIsoUtc(bindingExpiryIso)) {
    return { ok: false, reason: generation.ok ? 'binding-expiry-invalid' : generation.reason };
  }
  const retainedServiceExpiry = (
    isoToMsForRegistry(bindingExpiryIso) <= isoToMsForRegistry(generation.expiresAt)
      ? bindingExpiryIso : generation.expiresAt
  );
  if (!(isoToMsForRegistry(retainedServiceExpiry) > isoToMsForRegistry(expiresAtIso))) {
    return { ok: false, reason: 'retained-service-expiry-not-after-action' };
  }
  const payload = buildSupervisorStartPayload(
    resolvedNodePath(), bridgePath, actionId, coordRoot, sortedUniqueRoles, retainedServiceExpiry,
  );
  const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'supervisor-start', 'host-process', repoId, worktreeId, planDigest, policyDigest, generationId, null, payload, expiresAtIso);
  if (!mintResult.ok) return { ok: false };
  return { ok: true, actionId: mintResult.actionId, action: mintResult.action };
}

/**
 * `rotate`'s own single-role "this role-binding needs a fresh connector"
 * step (ROTATING->REHYDRATING): selects a capability-proven driver, then
 * either transitions straight through to READY (`noop`) or mints the
 * matching closed action (a batch-of-one `supervisor-start` via
 * `mintBatchedSupervisorStartAction`, or a `role-spawn`) and leaves the
 * binding in REHYDRATING with `pending_action_id` recorded. Team-ensure
 * ordering does not apply here -- rotate only ever respawns an ALREADY
 * previously-READY binding, so a team-ensure must already have succeeded
 * the first time this role was spawned via `ensure`.
 * @returns {{ok:true,terminal:boolean,record:object,action:object|null}|{ok:false,unavailable?:boolean}}
 */
function spawnOrRehydrateSingleRole(projectRoot, pair, capabilityManifest, role, profileDigest, worktreeId, planDigest, generationId, fromState, toState, fromRecord, respawnCount, bindingExpiryIso) {
  // R4 NO-GO round 2 (point 3): rotate must reuse the EXACT same
  // lifecycle-eligible selector + noop consumer gate as ensure's pass 2
  // (points 3.2/3.3) -- a prior pass fixed ensure's driver-selection loop
  // but never touched this SEPARATE, rotate-only selection call, leaving it
  // with the SAME two bugs ensure had before that fix: falling through to a
  // dishonestly-labeled claude-native role-spawn for claude-agent/codex-mcp/
  // runtime-spawn (see the closed-enum check below), and declaring noop
  // unconditionally READY with zero registered-consumer check.
  const excludedDrivers = hasRegisteredValidatedDiskConsumer(projectRoot, role, worktreeId, planDigest, generationId) ? [] : ['noop'];
  const driver = selectLifecycleEligibleDriverForRole(pair.routing, role, capabilityManifest, excludedDrivers);
  if (!driver) return { ok: false, unavailable: true };

  if (driver === 'noop') {
    // R4 round 2, point 4: a single atomic fromState->READY write (via the
    // toState waypoint, validated but never persisted) -- never the OLD
    // two-write fromState->toState->READY that left a durable,
    // pending_action_id-less waypoint record on disk.
    const t = transitionRoleBindingAtomicViaWaypoint(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, 'READY', fromRecord, { driver, respawn_count: respawnCount });
    if (!t.ok) return { ok: false };
    return { ok: true, terminal: true, record: t.record, action: null };
  }

  if (driver === 'codex-app-server') {
    // Point A: rotate must never mint a batch-of-one supervisor-start --
    // that would be a second retained supervisor racing whatever the
    // (possibly still-live) original one is doing. C1 has no real
    // control/rebind path to hand this role to an EXISTING supervisor yet
    // (that is C2's job) -- fail closed rather than fabricate one.
    return { ok: false, unavailable: true };
  }

  if (driver !== 'claude-sendmessage') {
    // Closed routing-driver enum minus the always-excluded
    // LIFECYCLE_INELIGIBLE_DRIVERS (selectLifecycleEligibleDriverForRole
    // already excludes claude-agent/codex-mcp/runtime-spawn) makes this
    // structurally unreachable -- fail closed rather than silently mint a
    // role-spawn action carrying a dishonest driver literal.
    return { ok: false };
  }

  const repoId = computeRepoId(projectRoot);
  let mintResult;
  {
    const policyDigest = sha256String(canonicalJSONStringify(pair.routing));
    const actionId = generateActionId();
    // M6: agent_type is the role's OWN canonical value -- matching its real
    // setup/agent-templates/<role>.md template (and the byte-mirrored
    // .claude/agents/<role>.md) -- never the harness-generic 'general-purpose'
    // fallback, which agent-spawn-validator.bats would never accept for a
    // canonical subagent_type anyway.
    const payload = buildRoleSpawnPayload('wp3-support-plane', role, role, null, claudeReadyBootstrapMessageFor(actionId, role, projectRoot));
    const ttlResult = effectiveActionTtlSeconds(pair.policy, bindingExpiryIso, {
      kind: 'role-spawn', runtime: 'claude-native',
    });
    if (!ttlResult.ok) return { ok: false, reason: ttlResult.reason };
    const expiresAtIso = futureIsoForRegistry(ttlResult.ttlSeconds);
    mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-spawn', 'claude-native', repoId, worktreeId, planDigest, policyDigest, generationId, role, payload, expiresAtIso);
  }
  if (!mintResult.ok) return { ok: false };

  const t1 = transitionRoleBinding(projectRoot, worktreeId, planDigest, profileDigest, generationId, role, fromState, toState, fromRecord, { driver, respawn_count: respawnCount, pending_action_id: mintResult.actionId });
  if (!t1.ok) return { ok: false };
  return { ok: true, terminal: false, record: t1.record, action: mintResult.action };
}

  return Object.freeze({
mintSupervisorBatchUnderTransaction, mintBatchedSupervisorStartAction, spawnOrRehydrateSingleRole,
  });
}

module.exports = { createSupervisorBatchMint };
