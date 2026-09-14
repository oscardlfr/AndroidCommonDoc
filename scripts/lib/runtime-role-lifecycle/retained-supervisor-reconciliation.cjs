'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the codex-app-server
// startup-eligibility pure lookup and the retained-supervisor-owner
// reconciliation `ensure` runs before classifying role records.
// `retainedSupervisorBridgeApi` (a lazy require of runtime-bridge-codex.cjs)
// itself stays in the facade -- no internal module may perform that upward
// require -- and is injected here as a plain function. Never requires the
// facade or a sibling module.

function createRetainedSupervisorReconciliation({
  retainedSupervisorBridgeApi, computeRepoId, computeCoordinationRootId,
  readSupervisorLifecycleOwnerState, currentClockMsForRegistry, isoToMsForRegistry,
  readRegistryRecord, actionPathFor, terminalizeSupervisorStartAction,
}) {
/**
 * M6 CORRECTION PASS (P0-1) wiring: is `codex-app-server` even a legitimate
 * candidate for `role`, independent of whether it is CURRENTLY capability-
 * manifest-available? True only when routing genuinely lists it for this
 * role AND it is not excluded by this role's OWN per-call exclusion set
 * (e.g. Point 3.1's "never re-select the driver that just failed for THIS
 * role this generation" -- a codex-app-server attempt that already failed
 * must stay excluded here exactly as it would for any other driver, never
 * silently re-tried through this fallback). Never consults capability or
 * startability itself -- callers combine this with a real
 * `resolveSupervisorStartability` result.
 * @param {object} routing
 * @param {string} role
 * @param {string[]} exclusions
 * @returns {boolean}
 */
function codexAppServerStartupEligible(routing, role, exclusions) {
  const allowed = routing.routes[role];
  if (!Array.isArray(allowed) || !allowed.includes('codex-app-server')) return false;
  if (exclusions && exclusions.includes('codex-app-server')) return false;
  return true;
}

/**
 * Reconciles one ACTIVE/RETAINED owner before ensure classifies role records.
 * LIVE blocks replacement and is later corroborated per role; INDETERMINATE
 * stops; confirmed ABSENT securely releases the dead process's role-owner
 * records and terminalizes the complete prior batch as DEAD (or STOPPED at
 * true retained-service expiry).
 */
function reconcileRetainedSupervisorForEnsure(projectRoot, binding, sortedRoles) {
  const repoDescriptor = { repoId: computeRepoId(projectRoot) };
  const coordinationRootId = computeCoordinationRootId(projectRoot);
  const ownerState = readSupervisorLifecycleOwnerState(repoDescriptor, coordinationRootId);
  if (!ownerState.ok) return { ok: false, reason: ownerState.reason };
  if (ownerState.state !== 'ACTIVE' || ownerState.record.phase !== 'RETAINED') {
    return { ok: true, retained: false };
  }
  const owner = ownerState.record;
  // A caller that asks for roles this supervisor does not hold is the NORMAL support plane, not an
  // error: under the Codex worker opt-in the plane splits, and a five-role ensure legitimately
  // covers two roles owned by a retained supervisor and three served natively. Requiring the whole
  // requested set to be owned made that shape unreconcilable, and its failure reached the caller as
  // a bare INTERNAL_ERROR -- which is precisely why every P5 attempt reported
  // support-plane-action-required for as long as it polled, with every role genuinely READY.
  // Standing is per-role, and each role is re-validated individually further down; what matters
  // here is only whether this request has anything to do with THIS supervisor.
  const requestSharesOwnerRoles = sortedRoles.some((role) => owner.roles.includes(role));
  // Scope first, and for BOTH outcomes: reuse and recovery alike are confined to this same project
  // worktree and PLAN. An owner from another scope is never reused and never reaped here.
  if (owner.worktree_id !== binding.worktree_id || owner.plan_digest !== binding.plan_digest) {
    return { ok: false, reason: 'retained-supervisor-scope-mismatch' };
  }
  let bridge;
  try { bridge = retainedSupervisorBridgeApi(); }
  catch (err) { return { ok: false, reason: 'retained-supervisor-bridge-unavailable' }; }
  if (
    !bridge || typeof bridge.classifyProcessIdentityLiveness !== 'function'
    || typeof bridge.releaseConfirmedDeadSupervisorOwners !== 'function'
  ) return { ok: false, reason: 'retained-supervisor-recovery-api-unavailable' };
  const liveness = bridge.classifyProcessIdentityLiveness(owner.pid_identity);
  if (!liveness.ok || liveness.status === 'INDETERMINATE') {
    return { ok: false, reason: 'retained-supervisor-liveness-indeterminate' };
  }
  const serviceExpired = currentClockMsForRegistry() >= isoToMsForRegistry(owner.service_expiry);
  if (liveness.status === 'LIVE') {
    // Nothing of this request belongs to this supervisor: it is simply not this ensure's concern.
    // Per-role classification proceeds untouched, and a second supervisor for the same coordination
    // root is still refused on its own terms by the mint transaction.
    if (!requestSharesOwnerRoles) return { ok: true, retained: false };
    // An expired-but-still-live owner remains an error, exactly as before.
    return serviceExpired
      ? { ok: false, reason: 'retained-supervisor-expired-but-still-live' }
      : { ok: true, retained: true, live: true, owner };
  }

  // Recovery of a supervisor whose process is PROVEN absent is deliberately NOT conditioned on
  // which roles the new caller happens to ask for. It once required the exact prior role set, on
  // the reasoning that recovery should be all-or-nothing -- but the reaping below is already
  // all-or-nothing in the only sense that matters: it releases the DEAD OWNER'S OWN complete role
  // set and terminalizes its whole batch, never a subset and never anything the caller named. The
  // requested set therefore has no bearing on what gets reaped, and making it a precondition only
  // meant a dead supervisor could hold a coordination root hostage until its service expiry
  // because the next generation asked for a different set of roles. Live P5 attempt N9 lost its
  // entire run to exactly that: an owner left ACTIVE and RETAINED by a terminated process, which a
  // five-role init-session could not reap because the dead batch held two.

  const released = bridge.releaseConfirmedDeadSupervisorOwners(
    repoDescriptor, coordinationRootId, owner.roles, owner.pid_identity,
  );
  if (!released.ok) return { ok: false, reason: released.reason };
  const actionRead = readRegistryRecord(actionPathFor(repoDescriptor, owner.action_id));
  if (!actionRead.ok || actionRead.absent || !actionRead.obj) {
    return { ok: false, reason: 'retained-supervisor-action-absent' };
  }
  const disposition = serviceExpired ? 'session-expiry' : 'premature-loss';
  const terminalized = terminalizeSupervisorStartAction(
    actionRead.obj,
    serviceExpired ? 'deadline' : 'native-tool-error',
    disposition,
  );
  if (!terminalized.ok) return { ok: false, reason: terminalized.reason };
  return { ok: true, retained: false, recovered: true, serviceExpired };
}

  return Object.freeze({
    codexAppServerStartupEligible, reconcileRetainedSupervisorForEnsure,
  });
}

module.exports = { createRetainedSupervisorReconciliation };
