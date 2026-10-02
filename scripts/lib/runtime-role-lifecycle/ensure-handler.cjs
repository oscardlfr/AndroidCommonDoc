'use strict';
// Extracted behaviorally from runtime-role-lifecycle.cjs: the `ensure`
// CLI subcommand handler in full -- argv parse/grant validation, the
// resume-checkpoint and ephemeral-mode early exits, retained-supervisor
// reconciliation, the two-pass role classification/driver-resolution
// pipeline, and the codex-app-server/claude-sendmessage batch mints. Never
// requires the facade or a sibling module.
const fs = require('fs');
const { runPlanHandoff } = require('../runtime-ensure-plan-handoff.cjs');

function createEnsureHandler({
path, SUBCOMMAND_SPEC, parseSubcommandArgv, usageError, invalidError, unavailableError, emitAndExit,
  makeResult, RC, hasUniqueValues, CANONICAL_ROLES, resolvePolicyPair, RESUME_CHECKPOINT_REF_RE,
  sha256String, validateAndConsumeLifecycleCommandGrant, attachDerivedSessionGenerationId, discoverPlan,
  computeWorktreeId, executeResumeCheckpointEnsure, reconcileRetainedSupervisorForEnsure,
  getCapabilityManifest, roleProfileDigestFor, readRoleBindingState, retainedSupervisorBridgeApi,
  readRegistryRecord, actionPathFor, isoToMsForRegistry, currentClockMsForRegistry, transitionRoleBinding,
  classifyClaudeSupportRoleLiveness,
  claudeLivenessProbeMessage, findClaudeLivenessProbeState,
  findUniqueClaudeResumeHandleForTarget, findUniqueConsumedClaudeResumeHandleForBusyTarget,
  resolveHostOperationForAction, actionForEnvelope, respawnBudgetExceeded, quarantineViaRehydrating,
  isTestCapability, hasRegisteredValidatedDiskConsumer, codexAppServerStartupEligible,
  resolveSupervisorStartability, selectLifecycleEligibleDriverForRole, transitionRoleBindingAtomicViaWaypoint,
  roleBindingForEnvelope, mintSupervisorBatchUnderTransaction, computeRepoId, generateActionId,
  buildRoleSpawnPayload, buildRoleNotifyPayload, claudeReadyBootstrapMessageFor, effectiveActionTtlSeconds, futureIsoForRegistry,
  mintRoleLifecycleAction, canonicalJSONStringify,
  registryRepoDir, withRegistryLock,
  groupEnsurePendingSpawns, resolveOrMintLivenessProbe,
}) {

/**
 * `ensure --project-root <absolute> --role <role> [--role <role>...]
 * [--lifecycle-binding <grant-ref>]` -- idempotently return healthy bindings or
 * an ordered set of host-native actions; repeated/unknown roles rejected (no
 * partial ensure). WITHOUT `--lifecycle-binding`, `auto|ephemeral` degrades to
 * `EPHEMERAL_AVAILABLE`, `persistent|disk-only` reports
 * `UNAVAILABLE/CAPABILITY_UNAVAILABLE` (no capability provable without a
 * grant). WITH a valid grant, this drives the registry-backed state machine
 * in two passes: pass 1 classifies each role's current state (READY/WAITING/
 * BUSY collected directly; STARTING re-reports its pending action, never a
 * second mint; QUARANTINED/STOPPED/ROTATING/REHYDRATING mark
 * CAPABILITY_UNAVAILABLE, restart-only) and collects ABSENT/DEAD/UNAVAILABLE
 * roles needing a fresh connector without yet minting anything (UNAVAILABLE
 * alone is retryable within the same generation, point 3.1, excluding
 * exactly the driver that produced it); pass 2 resolves each one's driver
 * (pure lookup, skipping claude-agent/codex-mcp/runtime-spawn and a `noop`
 * lacking a registered consumer) and groups them so `codex-app-server` mints
 * exactly ONE batched `supervisor-start` action per group (PLAN.md ~L167),
 * while Claude-native roles get a `role-spawn` action each in this same call.
 * @param {string[]} rawArgv
 * @returns {never}
 */
function handleEnsure(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC.ensure);
  if (!parsed.ok) {
    usageError('ensure');
    return;
  }
  const projectRoot = parsed.values['--project-root'];
  if (!path.isAbsolute(projectRoot)) {
    usageError('ensure');
    return;
  }
  const roles = parsed.values['--role'];
  if (!hasUniqueValues(roles) || !roles.every((r) => CANONICAL_ROLES.includes(r))) {
    invalidError('ensure', 'NONE');
    return;
  }

  const pair = resolvePolicyPair(projectRoot);
  if (!pair.ok) {
    invalidError('ensure', 'POLICY_INVALID');
    return;
  }

  const lifecycleBindingRef = parsed.values['--lifecycle-binding'];

  // PLAN.md ~L150: every lifecycle command requires a grant, no carve-out
  // for ensure -- a missing grant is an AUTHORITY error, never a degraded
  // ephemeral success (mirrors probe/status's IDENTITY_MISMATCH shape).
  if (lifecycleBindingRef === undefined) {
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }

  // Order-independent binding scope (PLAN.md ~L748) -- sorted roles, never
  // the literal repeated-flag order a caller happened to type.
  const sortedRoles = roles.slice().sort();
  const waveSlug = parsed.values['--wave-slug']; const resumeCheckpointRef = parsed.values['--resume-checkpoint'];
  if (resumeCheckpointRef !== undefined && !RESUME_CHECKPOINT_REF_RE.test(resumeCheckpointRef)) {
    invalidError('ensure', 'NONE');
    return;
  }
  const argvDigest = sha256String(
    'ensure:' + sortedRoles.join(',')
    + (resumeCheckpointRef === undefined ? '' : ':resume:' + resumeCheckpointRef) + (waveSlug === undefined ? '' : ':wave:' + waveSlug),
  );
  // PLAN.md ~L576's closed role union: canonical STRING for single-role,
  // sorted-unique ARRAY for multi-role -- never a comma-joined string.
  const roleKey = sortedRoles.length === 1 ? sortedRoles[0] : sortedRoles;

  const consumeResult = validateAndConsumeLifecycleCommandGrant(projectRoot, lifecycleBindingRef, argvDigest, roleKey, 'ensure');
  if (!consumeResult.ok) {
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }
  const binding = consumeResult.binding;
  if (!attachDerivedSessionGenerationId(projectRoot, binding).ok) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }

  let planResult = waveSlug === undefined ? discoverPlan(projectRoot, binding.plan_digest) : discoverPlan(projectRoot, { waveSlug, expectedDigest: binding.plan_digest });
  // Preserve the established stale-binding diagnostic when the repository has
  // one unambiguous current PLAN: the comparison below must report identity
  // mismatch, not misclassify a valid policy surface as POLICY_INVALID. In a
  // multi-wave repository there is intentionally no guessing fallback.
  if (!planResult.ok && waveSlug === undefined) {
    const unscopedPlan = discoverPlan(projectRoot);
    if (unscopedPlan.ok) planResult = unscopedPlan;
  }
  if (!planResult.ok) {
    invalidError('ensure', 'POLICY_INVALID');
    return;
  }
  const currentWorktreeId = computeWorktreeId(projectRoot);
  if (binding.plan_digest !== planResult.planDigest || binding.worktree_id !== currentWorktreeId) {
    // Stale binding / identity drift -- never proceed against a mismatched scope.
    invalidError('ensure', 'IDENTITY_MISMATCH');
    return;
  }

  if (resumeCheckpointRef !== undefined) {
    const resumed = executeResumeCheckpointEnsure(projectRoot, binding, pair, sortedRoles, resumeCheckpointRef);
    if (!resumed.ok) {
      if (resumed.reason === 'UNAVAILABLE') unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
      else invalidError('ensure', 'INTERNAL_ERROR');
      return;
    }
    emitAndExit(makeResult(
      'ensure', RC.OK, resumed.status, 'NONE', resumed.bindings, resumed.actions, resumed.operation,
    ));
    return;
  }

  // PLAN.md ~L167: `ephemeral` mode returns EPHEMERAL_AVAILABLE and never
  // spawns/claims peers, unconditionally, regardless of routing/capability.
  // `auto` is deliberately excluded -- a granted `auto` call gets its own
  // real "richest capability-proven profile" resolution below.
  if (pair.policy.mode === 'ephemeral') {
    emitAndExit(makeResult('ensure', RC.OK, 'EPHEMERAL_AVAILABLE', 'NONE', [], []));
    return;
  }

  const retainedReconciliation = reconcileRetainedSupervisorForEnsure(
    projectRoot, binding, sortedRoles,
  );
  if (!retainedReconciliation.ok) {
    if (isTestCapability() && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DIAGNOSTICS === '1') process.stderr.write('[runtime-role-lifecycle ensure] retained-reconciliation: ' + String(retainedReconciliation.reason || 'unknown') + '\n');
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }

  // Immutable replacement: peers still alive under an OLD plan digest are stopped before anything is spawned (see the module).
  if (runPlanHandoff({ fs, path, registryRepoDir, readRegistryRecord, transitionRoleBinding, classifyClaudeSupportRoleLiveness,
    effectiveActionTtlSeconds, mintRoleLifecycleAction, generateActionId, computeRepoId, sha256String, canonicalJSONStringify,
    futureIsoForRegistry, currentClockMsForRegistry, isoToMsForRegistry, actionForEnvelope, emitAndExit, makeResult, RC,
    invalidError, unavailableError }, projectRoot, binding, pair, sortedRoles)) return;

  const capabilityManifest = getCapabilityManifest(projectRoot);
  const collectedActions = [];
  const collectedBindings = [];
  let sawActionRequired = false;
  let sawUnavailable = false;
  // Diagnostic-only per-role reasons (stderr, never stdout/the frozen ABI):
  // CAPABILITY_UNAVAILABLE alone can't distinguish an unresolvable retained
  // worker from a terminal state, exhausted respawn budget, no eligible
  // driver, or a refused supervisor transaction.
  const unavailableReasons = [];
  const noteUnavailable = (role, reason) => {
    sawUnavailable = true;
    unavailableReasons.push(String(role) + ':' + String(reason));
  };
  let hardError = false;

  // Pass 1: classify each role's current state; collect ABSENT/DEAD roles
  // needing a fresh connector without yet minting anything (batching
  // decision happens in pass 2, once every role's fate is known).
  const pendingSpawns = [];
  for (const role of sortedRoles) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role);
    if (!stateResult.ok) {
      hardError = true;
      break;
    }

    if (stateResult.state === 'READY' || stateResult.state === 'WAITING' || stateResult.state === 'BUSY') {
      if (stateResult.record.driver === 'claude-sendmessage') {
        const target = {
          planDigest: binding.plan_digest,
          sessionDigest: sha256String(binding.runtime_session_key),
          targetRole: role,
          worktreeId: binding.worktree_id,
        };
        let liveness;
        const expectedLiveness = {
          generationId: binding.session_generation_id, planDigest: binding.plan_digest,
          role, runtimeSessionKey: binding.runtime_session_key, worktreeId: binding.worktree_id,
        };
        if (stateResult.state === 'WAITING' || stateResult.state === 'BUSY') {
          const handle = stateResult.state === 'WAITING'
            ? findUniqueClaudeResumeHandleForTarget(projectRoot, {
              generationId: binding.session_generation_id, ...target,
            })
            : findUniqueConsumedClaudeResumeHandleForBusyTarget(projectRoot, {
              generationId: binding.session_generation_id, ...target,
            }, stateResult.record);
          // A durable terminal tombstone is newer and stronger evidence than
          // resume-handle history. Classify it even when multiple consumed
          // receipts make the BUSY handle lookup intentionally INVALID; an
          // explicit shutdown must still rehydrate a fresh actor.
          const classified = classifyClaudeSupportRoleLiveness(projectRoot, expectedLiveness);
          liveness = classified && classified.ok && classified.status === 'ABSENT' ? classified
            : (handle.ok ? classified : {
              ok: false, status: 'INVALID', reason: stateResult.state === 'WAITING'
                ? 'waiting-resume-handle-absent' : 'busy-resume-receipt-absent',
            });
        } else liveness = classifyClaudeSupportRoleLiveness(projectRoot, expectedLiveness);
        if (liveness && liveness.ok && liveness.status === 'UNVERIFIED') {
          const probe = resolveOrMintLivenessProbe(projectRoot, binding, pair, role, stateResult.record, liveness);
          if (!probe.ok) {
            noteUnavailable(role, 'claude-liveness-probe-' + (probe.reason || 'invalid'));
            continue;
          }
          if (probe.status === 'LIVE') {
            liveness = { ok: true, status: 'LIVE' };
          } else if (probe.status === 'ABSENT') {
            liveness = { ok: true, status: 'ABSENT' };
          } else if (probe.status === 'PENDING') {
            sawActionRequired = true;
            const operation = resolveHostOperationForAction(probe.action.kind, probe.action.runtime);
            collectedActions.push(operation
              ? Object.assign(actionForEnvelope(probe.action), { operation })
              : actionForEnvelope(probe.action));
            continue;
          } else { noteUnavailable(role, 'claude-liveness-probe-state-invalid'); continue; }
        }
        if (!liveness.ok) {
          noteUnavailable(role, 'claude-actor-' + (liveness.reason || 'invalid'));
          continue;
        }
        if (liveness.status === 'ABSENT') {
          const dead = transitionRoleBinding(
            projectRoot, binding.worktree_id, binding.plan_digest, profileDigest,
            binding.session_generation_id, role, stateResult.state, 'DEAD', stateResult.record, {},
          );
          if (!dead.ok) { hardError = true; break; }
          if (respawnBudgetExceeded(dead.record, pair.policy)) {
            const quarantine = quarantineViaRehydrating(
              projectRoot, binding.worktree_id, binding.plan_digest, profileDigest,
              binding.session_generation_id, role, 'DEAD', dead.record, 'respawn-budget-exceeded',
            );
            if (!quarantine.ok) { hardError = true; break; }
            noteUnavailable(role, 'respawn-budget-exceeded');
            continue;
          }
          pendingSpawns.push({
            role, profileDigest, fromState: 'DEAD', toState: 'REHYDRATING',
            fromRecord: dead.record, respawnCount: (dead.record.respawn_count || 0) + 1,
            excludeDriver: null, requiredDriver: 'claude-sendmessage',
          });
          continue;
        }
      }
      if (stateResult.record.driver === 'codex-app-server') {
        let liveWorker;
        try {
          liveWorker = retainedSupervisorBridgeApi().resolveLiveCodexAppServerWorker(
            projectRoot, role, profileDigest,
          );
        } catch (err) {
          hardError = true;
          break;
        }
        if (!liveWorker || !liveWorker.ok) {
          hardError = true;
          break;
        }
        if (!liveWorker.available) {
          noteUnavailable(role, 'retained-worker-' + (liveWorker.reason || 'unavailable'));
          continue;
        }
      }
      collectedBindings.push(roleBindingForEnvelope(stateResult.record));
      continue;
    }

    if (stateResult.state === 'STARTING') {
      const pendingId = stateResult.record.pending_action_id;
      if (pendingId) {
        const actionRead = readRegistryRecord(actionPathFor(projectRoot, pendingId));
        if (actionRead.ok && !actionRead.absent) {
          const pendingExpiryMs = isoToMsForRegistry(actionRead.obj.expires_at);
          if (!Number.isFinite(pendingExpiryMs)) {
            hardError = true;
            break;
          }
          if (currentClockMsForRegistry() >= pendingExpiryMs) {
            // A STARTING binding whose one-shot host action expired can no
            // longer make progress -- reconcile it here and immediately
            // route a replacement action for the same driver (merely
            // re-reporting the dead action would strand the role forever).
            const expired = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'STARTING', 'UNAVAILABLE', stateResult.record, { failure_reason: 'expired' });
            if (!expired.ok) {
              hardError = true;
              break;
            }
            // Expiry is an unconsumed transport action, not driver failure -- the replacement retains the same driver (excludeDriver/requiredDriver both null).
            pendingSpawns.push({ role, profileDigest, fromState: 'UNAVAILABLE', toState: 'STARTING', fromRecord: expired.record, respawnCount: expired.record.respawn_count || 0, excludeDriver: null, requiredDriver: null });
            continue;
          }
          sawActionRequired = true;
          // A role-spawn action minted by an earlier ensure() call must
          // still surface its resolved `operation` on this call's envelope,
          // via the pure, side-effect-free resolveHostOperationForAction
          // lookup ONLY -- never interpretRoleLifecycleAction (even with a
          // no-op executor), which would reach consumeInterpreterActionOnce
          // and permanently burn the action's one-time-use token with no
          // genuine execution ever having happened. Scoped to
          // kind==='role-spawn' only; a re-reported supervisor-start's own
          // operation surfacing is separate, unassigned scope.
          if (actionRead.obj.kind === 'role-spawn') {
            const operation = resolveHostOperationForAction(actionRead.obj.kind, actionRead.obj.runtime);
            collectedActions.push(operation
              ? Object.assign(actionForEnvelope(actionRead.obj), { operation })
              : actionForEnvelope(actionRead.obj));
          } else {
            collectedActions.push(actionForEnvelope(actionRead.obj));
          }
        } else {
          hardError = true;
          break;
        }
      } else {
        hardError = true;
        break;
      }
      continue;
    }

    if (stateResult.state === 'QUARANTINED' || stateResult.state === 'STOPPED' || stateResult.state === 'ROTATING' || stateResult.state === 'REHYDRATING') {
      // Terminal (QUARANTINED/STOPPED) or already mid-transition (ROTATING/
      // REHYDRATING -- ensure never races an in-flight rotation). Only a
      // NEW session_generation_id can recover these.
      noteUnavailable(role, 'binding-state-' + String(stateResult.state));
      continue;
    }

    // ABSENT or DEAD: needs a fresh (or respawned) connector.
    if (stateResult.state === 'DEAD' && respawnBudgetExceeded(stateResult.record, pair.policy)) {
      const quarantine = quarantineViaRehydrating(projectRoot, binding.worktree_id, binding.plan_digest, profileDigest, binding.session_generation_id, role, 'DEAD', stateResult.record, 'respawn-budget-exceeded');
      if (!quarantine.ok) { hardError = true; break; }
      noteUnavailable(role, 'respawn-budget-exceeded');
      continue;
    }

    // Point 3.1: UNAVAILABLE is the one binding-level terminal state
    // retryable within the SAME session generation -- a prior driver-
    // selection/action failure for this exact role (never respawn-budget/
    // ambiguous-owner/explicit-stop, which stay QUARANTINED/STOPPED above).
    // The failed record's `driver` is extracted so pass 2 excludes exactly
    // that one driver and selects the next eligible one.
    const fromState = stateResult.state; // 'ABSENT' | 'DEAD' | 'UNAVAILABLE'
    const toState = fromState === 'DEAD' ? 'REHYDRATING' : 'STARTING';
    const fromRecord = fromState === 'ABSENT' ? null : stateResult.record;
    const respawnCount = fromState === 'DEAD' ? ((stateResult.record.respawn_count || 0) + 1) : (fromState === 'UNAVAILABLE' ? (stateResult.record.respawn_count || 0) : 0);
    const excludeDriver = fromState === 'UNAVAILABLE' ? stateResult.record.driver : null;
    const requiredDriver = fromState === 'DEAD'
      && ['codex-app-server', 'claude-sendmessage'].includes(stateResult.record.driver)
      ? stateResult.record.driver : null;
    pendingSpawns.push({
      role, profileDigest, fromState, toState, fromRecord, respawnCount,
      excludeDriver, requiredDriver,
    });
  }

  if (hardError) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }

  const groupedSpawns = groupEnsurePendingSpawns(
    projectRoot, binding, pair, capabilityManifest, pendingSpawns,
  );
  if (!groupedSpawns.ok) {
    invalidError('ensure', 'INTERNAL_ERROR');
    return;
  }
  collectedBindings.push(...groupedSpawns.collectedBindings);
  for (const unavailable of groupedSpawns.unavailable) {
    noteUnavailable(unavailable.role, unavailable.reason);
  }
  const { codexAppServerGroup, claudeSendmessageGroup } = groupedSpawns;

  // codex-app-server: at most ONE retained supervisor per (worktree, plan,
  // session). classify+mint+transition+publish-owner all happen atomically
  // under mintSupervisorBatchUnderTransaction's single lock -- never a
  // separate read-then-act check outside it (the window that would let two
  // concurrent ensure(disjoint-roles) calls both mint).
  if (codexAppServerGroup.length > 0) {
    const repoId = computeRepoId(projectRoot);
    const txResult = mintSupervisorBatchUnderTransaction(projectRoot, pair, repoId, binding.worktree_id, binding.plan_digest, binding.session_generation_id, codexAppServerGroup, binding.expiry);
    if (!txResult.ok) {
      if (isTestCapability() && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_DIAGNOSTICS === '1') process.stderr.write('[runtime-role-lifecycle ensure] supervisor-batch-mint: ' + String(txResult.reason || 'unknown') + '\n');
      invalidError('ensure', 'INTERNAL_ERROR');
      return;
    }
    if (txResult.unavailable) {
      // The batch transaction covers the whole group, not one role -- read
      // the role name off each pending spawn descriptor.
      for (const groupSpawn of codexAppServerGroup) {
        noteUnavailable(groupSpawn.role, 'supervisor-transaction-' + String(txResult.reason || 'unavailable'));
      }
    } else {
      sawActionRequired = true;
      collectedActions.push(actionForEnvelope(txResult.action));
    }
  }

  // Accepted Claude profile: each missing persistent role maps directly to
  // one role-spawn/claude-native action; TeamCreate is not part of the
  // current host surface.
  if (claudeSendmessageGroup.length > 0) {
    const repoId = computeRepoId(projectRoot);
    sawActionRequired = true;
    const transitioned = [];
    for (const spawn of claudeSendmessageGroup) {
      const spawnPolicyDigest = sha256String(canonicalJSONStringify(pair.routing));
      const actionId = generateActionId();
      const payload = buildRoleSpawnPayload('wp3-support-plane', spawn.role, spawn.role, null, claudeReadyBootstrapMessageFor(actionId, spawn.role, projectRoot));
      const spawnTtlResult = effectiveActionTtlSeconds(pair.policy, binding.expiry, {
        kind: 'role-spawn', runtime: 'claude-native',
      });
      if (!spawnTtlResult.ok) { hardError = true; break; }
      const spawnExpiresAtIso = futureIsoForRegistry(spawnTtlResult.ttlSeconds);
      const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'role-spawn', 'claude-native', repoId, binding.worktree_id, binding.plan_digest, spawnPolicyDigest, binding.session_generation_id, spawn.role, payload, spawnExpiresAtIso);
      if (!mintResult.ok) { hardError = true; break; }
      const t1 = transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, spawn.profileDigest, binding.session_generation_id, spawn.role, spawn.fromState, spawn.toState, spawn.fromRecord, { driver: spawn.driver, respawn_count: spawn.respawnCount, pending_action_id: mintResult.actionId });
      if (!t1.ok) { hardError = true; break; }
      transitioned.push({ spawn, record: t1.record });
      const operation = resolveHostOperationForAction(mintResult.action.kind, mintResult.action.runtime);
      collectedActions.push(operation
        ? Object.assign(actionForEnvelope(mintResult.action), { operation })
        : actionForEnvelope(mintResult.action));
    }
    if (hardError) {
      for (const t of transitioned) {
        transitionRoleBinding(projectRoot, binding.worktree_id, binding.plan_digest, t.spawn.profileDigest, binding.session_generation_id, t.spawn.role, t.spawn.toState, 'QUARANTINED', t.record, { failure_reason: 'batch-sibling-transition-failed' });
      }
      invalidError('ensure', 'INTERNAL_ERROR');
      return;
    }
  }

  if (sawActionRequired) {
    // Dedup by action_id: a multi-role batch/re-report can push the same
    // action once per affected binding -- the envelope returns one action
    // per action_id, never a copy per binding.
    const seenActionIds = new Set();
    const dedupedActions = collectedActions.filter((a) => {
      if (seenActionIds.has(a.action_id)) return false;
      seenActionIds.add(a.action_id);
      return true;
    });
    emitAndExit(makeResult('ensure', RC.OK, 'ACTION_REQUIRED', 'NONE', collectedBindings, dedupedActions));
    return;
  }
  if (sawUnavailable) {
    // stderr is not part of the ABI -- stdout stays byte-identical.
    if (unavailableReasons.length > 0) {
      try {
        process.stderr.write('[ensure] roles unavailable: ' + unavailableReasons.join(', ') + '\n');
      } catch (err) { /* diagnostics must never change an outcome */ }
    }
    unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
    return;
  }
  emitAndExit(makeResult('ensure', RC.OK, 'READY', 'NONE', collectedBindings, []));
}

  return Object.freeze({
handleEnsure,
  });
}

module.exports = { createEnsureHandler };
