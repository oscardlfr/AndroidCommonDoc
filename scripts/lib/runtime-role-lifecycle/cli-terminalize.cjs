'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the closed
// interpreter boundary -- supervisor-start batch terminalization, the
// shared per-kind action-failed transition logic, the one-use interpreted-
// action marker, and interpretRoleLifecycleAction itself (the sole caller
// of any executor(operation, action) side effect). Never requires the
// facade or a sibling module.

function createCliTerminalize({
path, fs, registryRepoDir, wasExecutionClaimEverIssuedFor, withRegistryLock, roleProfileDigestFor,
  readRoleBindingState, transitionRoleBinding, computeCoordinationRootIdFromPath,
  terminalizeSupervisorLifecycleOwnerIfCurrent, teamEnsureMarkerPathFor, readTeamEnsureState,
  nowIsoForRegistry, writeRegistryRecordReplace, canonicalJSONStringify, findRoleBindingsDependentOnTeamEnsure,
  ensureSecureRegistryDir, publishNoClobber, readLiveSessionGenerationById, roleBindingPathFor, isHexActionId,
  readRegistryRecord, actionPathFor, ACTION_KIND_ENUM, ACTION_RUNTIME_ENUM, resolveHostOperationForAction,
  validateRootSourceAction, currentClockMsForRegistry, isoToMsForRegistry,
}) {

/**
 * Point B: correlates the EXACT role set from a `supervisor-start` action's
 * own `bridge_argv` (repeated `--role` flags) and atomically terminalizes
 * every STARTING/REHYDRATING binding still pending on THIS action -- never
 * leaves one hanging just because a sibling role in the same batch already
 * resolved independently. Shared by `handleActionFailed`'s own supervisor-
 * start branch AND `session-run` itself (point B: "si el execution claim ya
 * fue consumido y owner acquisition falla, la acción termina de forma
 * recuperable/fail-closed" -- the bridge calls this directly, in-process,
 * rather than shelling back out to the `action-failed` CLI).
 * @param {object} action
 * @param {string} reason - ACTION_FAILED_REASON_ENUM member.
 * @returns {{ok:true,anyTerminalized:boolean}|{ok:false,reason:string}}
 */
/**
 * WP3 item C correction pass R2 (point 2): batch terminalization runs under
 * a SINGLE lock scoped to this exact action -- never independent per-role
 * writes with no shared state, which let one role's transient failure
 * silently strand the REMAINING roles (a mid-loop `return` never even
 * attempted them). Under the lock, EVERY role is attempted regardless of
 * an individual failure (never stop at the first one), and success for a
 * role that reached its terminal state is never rolled back merely because
 * a sibling failed -- that transition was correct and durable on its own.
 * The existing per-role idempotent skip (a role already resolved/superseded
 * for this action is left alone) makes this function naturally safe to
 * retry: a caller that sees `ok:false` can call it again and only the
 * still-outstanding roles are retried, never a role already terminalized.
 */
function terminalizeSupervisorStartAction(action, reason, disposition = 'startup-failure') {
  if (!['startup-failure', 'premature-loss', 'session-expiry'].includes(disposition)) {
    return { ok: false, reason: 'terminalization-disposition-invalid' };
  }
  const repoDescriptor = { repoId: action.repo_id };
  const bridgeArgv = action.payload && action.payload.bridge_argv;
  if (!Array.isArray(bridgeArgv)) return { ok: false, reason: 'action-payload-malformed' };
  const roles = [];
  for (let i = 0; i < bridgeArgv.length - 1; i++) {
    if (bridgeArgv[i] === '--role') roles.push(bridgeArgv[i + 1]);
  }
  if (roles.length === 0) return { ok: false, reason: 'no-roles-in-payload' };

  const lockDir = path.join(registryRepoDir(repoDescriptor), 'terminalize-locks', action.action_id + '.lock');
  // M6 GROUP B: computed ONCE, outside the per-role loop -- a permanent,
  // action-scoped (not role-scoped) fact. See wasExecutionClaimEverIssuedFor's
  // own doc comment for why a READY role is only ever this action's business
  // to terminalize when a claim was genuinely issued for it -- a role that
  // happens to be READY under the identical scope for a completely UNRELATED
  // reason (no claim ever issued for THIS action) is never this action's
  // concern, exactly like the pre-existing STARTING/REHYDRATING pending_
  // action_id-mismatch case just below it.
  const claimEverIssued = wasExecutionClaimEverIssuedFor(repoDescriptor, action.action_id);
  const result = withRegistryLock(lockDir, () => {
    let anyTerminalized = false;
    let anyFailed = false;
    let allRecoveryTargetsSettled = disposition !== 'startup-failure';
    for (const role of roles) {
      const profileDigest = roleProfileDigestFor(role);
      const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
      if (!stateResult.ok) { anyFailed = true; continue; }
      // M6 GROUP B: a role already READY under this EXACT scope (worktree/
      // plan/profile/session-generation, all pinned to `action`'s own
      // fields by the readRoleBindingState call above) belongs to THIS
      // action's own batch (transitionSupervisorBatchToReady, which itself
      // requires a live claim to ever run) only when a SupervisorExecutionClaim
      // was genuinely issued for `action` -- role-binding records are keyed
      // 1:1 by scope alone, so scope match ALONE is not sufficient
      // correlation (a role can independently reach READY under the
      // identical scope for a completely unrelated reason). Unlike STARTING/
      // REHYDRATING there is no `pending_action_id` left on a READY record
      // to correlate against (stripped on promotion) -- the claim-issued
      // fact is the correlation instead. Torn back down via the SAME new
      // READY->UNAVAILABLE edge (ROLE_BINDING_TRANSITIONS) STARTING already
      // uses -- the owner record must still be released once this action's
      // own process is shutting down/failing, regardless of whether its
      // role-binding ALSO independently reached READY first (point B.4's
      // owner-release must never be skipped merely because the batch
      // happened to succeed before the shutdown/failure was observed).
      const isLiveUnderThisAction = (
        (stateResult.state === 'READY' || stateResult.state === 'WAITING' || stateResult.state === 'BUSY')
        && claimEverIssued
      );
      const alreadySettledForRecovery = (
        disposition === 'premature-loss' && stateResult.state === 'DEAD'
      ) || (
        disposition === 'session-expiry'
        && stateResult.state === 'STOPPED'
        && stateResult.record && stateResult.record.stop_reason === 'session-expiry'
      );
      if (alreadySettledForRecovery) continue;
      if (
        !isLiveUnderThisAction
        && (
          (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
          || !stateResult.record || stateResult.record.pending_action_id !== action.action_id
        )
      ) {
        allRecoveryTargetsSettled = false;
        continue; // already resolved/superseded for this role -- not fatal for the others.
      }
      let transition;
      if (isLiveUnderThisAction && disposition === 'premature-loss') {
        transition = transitionRoleBinding(
          repoDescriptor, action.worktree_id, action.plan_digest, profileDigest,
          action.session_generation_id, role, stateResult.state, 'DEAD', stateResult.record, {},
        );
      } else if (isLiveUnderThisAction && disposition === 'session-expiry') {
        let currentState = stateResult.state;
        let currentRecord = stateResult.record;
        if (currentState === 'BUSY') {
          const waiting = transitionRoleBinding(
            repoDescriptor, action.worktree_id, action.plan_digest, profileDigest,
            action.session_generation_id, role, 'BUSY', 'WAITING', currentRecord, {},
          );
          if (!waiting.ok) { anyFailed = true; continue; }
          currentState = 'WAITING';
          currentRecord = waiting.record;
        }
        const stopping = transitionRoleBinding(
          repoDescriptor, action.worktree_id, action.plan_digest, profileDigest,
          action.session_generation_id, role, currentState, 'STOPPING', currentRecord,
          { stop_reason: 'session-expiry' },
        );
        if (!stopping.ok) { anyFailed = true; continue; }
        transition = transitionRoleBinding(
          repoDescriptor, action.worktree_id, action.plan_digest, profileDigest,
          action.session_generation_id, role, 'STOPPING', 'STOPPED', stopping.record,
          { stop_reason: 'session-expiry' },
        );
      } else {
        const toState = stateResult.state === 'REHYDRATING' ? 'QUARANTINED' : 'UNAVAILABLE';
        transition = transitionRoleBinding(
          repoDescriptor, action.worktree_id, action.plan_digest, profileDigest,
          action.session_generation_id, role, stateResult.state, toState,
          stateResult.record, { failure_reason: reason },
        );
      }
      if (!transition || !transition.ok) { anyFailed = true; continue; }
      anyTerminalized = true;
    }
    if (anyFailed) return { ok: false, reason: 'ambiguous' };
    return { ok: true, anyTerminalized, allRecoveryTargetsSettled };
  }, { maxWaitMs: 2000 });
  if (!result.ok) return { ok: false, reason: result.reason };

  // Point B.4/2.3/2.4 (R4-hardened): terminalize the corresponding
  // coordination-root-anchored owner/intent record too -- reusing the SAME
  // cross-generation singleton scope point B.1 anchors minting to, so a
  // LATER ensure (same or a different session generation) is never
  // blocked by a batch that has already definitively failed.
  //
  // Point 2.3: startup-failure retains the original `anyTerminalized` gate.
  // Retained-owner recovery is also retry-safe after a torn first attempt:
  // if every role is already at the exact disposition-specific target
  // (DEAD, or STOPPED/session-expiry), the prior call durably completed the
  // role half and this retry must still settle the matching ACTIVE owner.
  // A superseded/mixed role set leaves allRecoveryTargetsSettled=false and
  // can never authorize owner termination.
  //
  // Point 2.4: a genuine owner-transition FAILURE now PROPAGATES as this
  // function's own `{ok:false}` -- never best-effort-swallowed. The
  // role-binding transitions above already committed durably and are
  // never rolled back merely because this LATER, separate step failed
  // (they were correct and complete on their own); but the CALLER must
  // still be told the owner side did not fully settle, rather than
  // silently reporting overall success while the coordination root
  // remains ambiguously ACTIVE.
  if (result.value.anyTerminalized || result.value.allRecoveryTargetsSettled) {
    let coordRootFromArgv = null;
    for (let i = 0; i < bridgeArgv.length - 1; i++) {
      if (bridgeArgv[i] === '--coordination-root') { coordRootFromArgv = bridgeArgv[i + 1]; break; }
    }
    if (typeof coordRootFromArgv === 'string' && coordRootFromArgv.length > 0) {
      const ownerResult = terminalizeSupervisorLifecycleOwnerIfCurrent(repoDescriptor, computeCoordinationRootIdFromPath(coordRootFromArgv), action.action_id, reason);
      if (!ownerResult.ok) return { ok: false, reason: 'owner-termination-failed:' + ownerResult.reason };
    }
  }

  return result.value;
}

/**
 * M6 CORRECTION PASS (P0-2): the exact per-kind terminalization logic
 * `action-failed`'s CLI handler applies (team-ensure lock+FAILED-transition
 * +dependent-invalidation; supervisor-start's own batch terminalization;
 * role-scoped STARTING/REHYDRATING->UNAVAILABLE/QUARANTINED), factored out
 * so any OTHER caller -- specifically `interpretRoleLifecycleAction`'s own
 * expiry-settlement path -- can settle an action through the exact SAME
 * path, never a parallel reimplementation. Never validates a grant itself
 * (that stays the CLI-only concern of `handleActionFailed`); this is purely
 * the registry-transition logic once authorization is already established.
 * @param {object} action
 * @param {string} reason
 * @returns {{ok:true}|{ok:false,code:'REPLAY'|'AMBIGUOUS_OWNER'|'INTERNAL_ERROR'|'UNSUPPORTED'}}
 */
function terminalizeActionAsFailed(action, reason) {
  const repoDescriptor = { repoId: action.repo_id };
  if (action.role === null) {
    if (action.kind === 'team-ensure') {
      const lockDir = teamEnsureMarkerPathFor(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest) + '.lock';
      const locked = withRegistryLock(lockDir, () => {
        const stateResult = readTeamEnsureState(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest);
        if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
        if (stateResult.state !== 'PENDING' || stateResult.record.pending_action_id !== action.action_id) {
          // Not the current live pending team-ensure -- already resolved,
          // superseded, or never was; fails closed, never guesses.
          return { ok: false, reason: 'not-current-pending' };
        }
        const record = Object.assign({}, stateResult.record, { state: 'FAILED', failure_reason: reason, updated_at: nowIsoForRegistry() });
        return writeRegistryRecordReplace(teamEnsureMarkerPathFor(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest), Buffer.from(canonicalJSONStringify(record), 'utf8'));
      });
      const result = locked.ok ? locked.value : { ok: false, reason: locked.reason };
      if (!result.ok) return { ok: false, code: 'REPLAY' };
      // Point C: a team-ensure failure must invalidate/transition every
      // DEPENDENT role-spawn binding, never leave one hanging in STARTING
      // referencing a team-ensure that will never succeed.
      const dependentsResult = findRoleBindingsDependentOnTeamEnsure(repoDescriptor, action.worktree_id, action.plan_digest, action.session_generation_id, action.action_id);
      if (!dependentsResult.ok) return { ok: false, code: 'INTERNAL_ERROR' };
      for (const dep of dependentsResult.dependents) {
        if (dep.state !== 'STARTING' && dep.state !== 'REHYDRATING') continue;
        const toState = dep.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
        transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, dep.profileDigest, action.session_generation_id, dep.role, dep.state, toState, dep.record, { failure_reason: 'team-ensure-failed' });
      }
      return { ok: true };
    }
    if (action.kind === 'supervisor-start') {
      const result = terminalizeSupervisorStartAction(action, reason);
      if (!result.ok) return { ok: false, code: result.reason === 'ambiguous' ? 'AMBIGUOUS_OWNER' : 'INTERNAL_ERROR' };
      if (!result.anyTerminalized) return { ok: false, code: 'REPLAY' };
      return { ok: true };
    }
    return { ok: false, code: 'UNSUPPORTED' };
  }

  const profileDigest = roleProfileDigestFor(action.role);
  const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role);
  if (!stateResult.ok) return { ok: false, code: 'INTERNAL_ERROR' };
  if (
    (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
    || stateResult.record.pending_action_id !== action.action_id
  ) {
    // Not the current live pending action for this binding -- already
    // resolved, superseded, or never was; fails closed, never guesses.
    return { ok: false, code: 'REPLAY' };
  }

  const toState = stateResult.state === 'STARTING' ? 'UNAVAILABLE' : 'QUARANTINED';
  const transition = transitionRoleBinding(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, action.role, stateResult.state, toState, stateResult.record, { failure_reason: reason });
  if (!transition.ok) return { ok: false, code: 'AMBIGUOUS_OWNER' };
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// M6 CORRECTION PASS (P0-2): closed interpreter boundary. resolveHostOperationForAction
// above is a pure, side-effect-free lookup table -- nothing validated or
// consumed an action around it. This section adds that missing boundary:
// full schema/scope/role/template-digest/session/expiry/ordering/one-use
// validation, then (and ONLY then) calls the caller-supplied executor
// EXACTLY once. Like resolveHostOperationForAction itself, this file NEVER
// calls TeamCreate/Agent/SendMessage or any other host action --
// interpretRoleLifecycleAction only ever calls the caller-supplied
// `executor` parameter.
// ─────────────────────────────────────────────────────────────────────────────

function interpretedActionMarkerPathFor(projectRootOrRepoId, actionId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'interpreted-actions', actionId + '.json');
}

/**
 * One-use consumption for the closed interpreter boundary -- a no-clobber
 * publish, atomically failing a second (replayed) attempt for the same
 * actionId. A separate durable record from the action itself (immutable,
 * never mutated to record interpretation) and from the role-binding it may
 * pair with (not always present -- see findAnyRoleBindingPendingAction).
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function consumeInterpreterActionOnce(projectRoot, actionId) {
  const markerPath = interpretedActionMarkerPathFor(projectRoot, actionId);
  const dirResult = ensureSecureRegistryDir(path.dirname(markerPath));
  if (!dirResult.ok) return { ok: false, reason: dirResult.reason };
  const record = { schema: 'coordination/role-lifecycle-action-interpreted/v1', action_id: actionId, interpreted_at: nowIsoForRegistry() };
  try {
    publishNoClobber(markerPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: (err && err.detailCode) || 'action-already-consumed' };
  }
  return { ok: true };
}

/**
 * Mirrors the sibling bridge module's own sessionGenerationIsLive -- proves
 * a claimed session_generation_id is a REAL, LIVE record this repo minted,
 * never merely a self-consistently-tampered value the caller/action happen
 * to agree on.
 * @returns {boolean}
 */
function sessionGenerationIsLiveById(projectRoot, generationId) {
  return readLiveSessionGenerationById(projectRoot, generationId).ok;
}

/**
 * P0-2: scans this repo's role-bindings registry for ANY record -- regardless
 * of which profile_digest it happens to be keyed under -- whose
 * (worktree,plan,session-generation,role) matches and whose pending_action_id
 * equals actionId. Unlike readRoleBindingState (a single canonical-digest
 * lookup), this is the only way to distinguish "no binding at all" from "a
 * binding exists, but only at a STALE (non-current) profile digest" -- both
 * look identical at the canonical path alone.
 * @returns {{found:false}|{found:true,state:string,record:object,profileDigest:string}}
 */
function findAnyRoleBindingPendingAction(projectRoot, worktreeId, planDigest, generationId, role, actionId) {
  const bindingsDir = path.join(registryRepoDir(projectRoot), 'role-bindings');
  let entries;
  try {
    entries = fs.readdirSync(bindingsDir, { withFileTypes: true });
  } catch (err) {
    return { found: false };
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidatePath = path.join(bindingsDir, entry.name);
    const rawRead = readRegistryRecord(candidatePath);
    if (!rawRead.ok || rawRead.absent || !rawRead.obj) continue;
    const rec = rawRead.obj;
    if (
      typeof rec.worktree_id !== 'string' || typeof rec.plan_digest !== 'string'
      || typeof rec.profile_digest !== 'string' || typeof rec.session_generation_id !== 'string'
      || typeof rec.role !== 'string'
    ) continue;
    if (roleBindingPathFor(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role) !== candidatePath) continue;
    if (rec.worktree_id !== worktreeId || rec.plan_digest !== planDigest || rec.session_generation_id !== generationId || rec.role !== role) continue;
    if (rec.pending_action_id !== actionId) continue;
    const stateResult = readRoleBindingState(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role);
    if (!stateResult.ok) continue;
    return { found: true, state: stateResult.state, record: stateResult.record, profileDigest: rec.profile_digest };
  }
  return { found: false };
}

/**
 * WP3 M6 (P0-2): the closed interpreter boundary around
 * resolveHostOperationForAction -- validates a role-lifecycle-action's full
 * schema/scope/role/template-digest/session/expiry/ordering/one-use contract,
 * then calls the CALLER-SUPPLIED executor exactly once for a well-formed,
 * unexpired, first-use action whose resolved operation matches
 * HOST_OPERATION_FOR_ACTION exactly -- ZERO times for anything else
 * (unresolvable (kind,runtime), wrong role/scope, stale template/profile
 * digest, replay, expiry, cross-session use, or a role-spawn suppressed by
 * an unsatisfied team-ensure predecessor). An expired action settles its
 * affected role-binding through the SAME terminalizeActionAsFailed path
 * `action-failed` itself uses -- never a silent drop. This function NEVER
 * itself calls TeamCreate/Agent/SendMessage or any other host action --
 * `executor(operation, action)` is the only side-effecting call it ever
 * makes, and only once.
 * @param {string} projectRoot
 * @param {string} actionId
 * @param {{worktreeId:string,planDigest:string,sessionGenerationId:string,role:(string|null)}} callerScope
 * @param {function(string, object): void} executor
 * @returns {{ok:true,operation:string,action:object}|{ok:false,reason:string}}
 */
function interpretRoleLifecycleAction(projectRoot, actionId, callerScope, executor) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0 || !isHexActionId(actionId) || typeof executor !== 'function') {
    return { ok: false, reason: 'invalid-arguments' };
  }
  if (
    !callerScope || typeof callerScope.worktreeId !== 'string' || typeof callerScope.planDigest !== 'string'
    || typeof callerScope.sessionGenerationId !== 'string'
    || (callerScope.role !== null && callerScope.role !== undefined && typeof callerScope.role !== 'string')
  ) {
    return { ok: false, reason: 'invalid-caller-scope' };
  }
  const callerRole = (callerScope.role === undefined) ? null : callerScope.role;

  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent || !actionRead.obj) return { ok: false, reason: 'action-not-found' };
  const action = actionRead.obj;
  if (
    action.schema !== 'coordination/role-lifecycle-action/v1' || action.action_id !== actionId
    || !ACTION_KIND_ENUM.includes(action.kind) || !ACTION_RUNTIME_ENUM.includes(action.runtime)
  ) {
    return { ok: false, reason: 'action-shape-invalid' };
  }
  const actionRole = (action.role === undefined) ? null : action.role;
  if (
    action.worktree_id !== callerScope.worktreeId || action.plan_digest !== callerScope.planDigest
    || action.session_generation_id !== callerScope.sessionGenerationId || actionRole !== callerRole
  ) {
    return { ok: false, reason: 'scope-mismatch' };
  }

  if (!sessionGenerationIsLiveById(projectRoot, action.session_generation_id)) {
    return { ok: false, reason: 'session-generation-not-live' };
  }

  const operation = resolveHostOperationForAction(action.kind, action.runtime);
  if (!operation) return { ok: false, reason: 'action-kind-runtime-not-in-closed-table' };
  if (action.kind === 'root-source-spawn') {
    const rootSourceValid = validateRootSourceAction(action);
    if (!rootSourceValid.ok) return { ok: false, reason: rootSourceValid.reason };
  }

  if (currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at)) {
    // Never a silent drop: settle the affected role-binding (if any) through
    // the SAME path action-failed itself uses. This function's own return
    // value is intentionally not consulted further here -- the dispatch
    // above is refused regardless of whether settlement itself succeeds.
    terminalizeActionAsFailed(action, 'deadline');
    return { ok: false, reason: 'action-expired' };
  }

  if (actionRole !== null) {
    const pending = findAnyRoleBindingPendingAction(projectRoot, action.worktree_id, action.plan_digest, action.session_generation_id, actionRole, actionId);
    if (pending.found) {
      if (pending.profileDigest !== roleProfileDigestFor(actionRole)) {
        return { ok: false, reason: 'role-binding-stale-profile-digest' };
      }
      if (pending.state !== 'STARTING' && pending.state !== 'REHYDRATING') {
        return { ok: false, reason: 'role-binding-not-pending' };
      }
      if (pending.record.team_ensure_action_id) {
        const teamState = readTeamEnsureState(projectRoot, action.session_generation_id, action.worktree_id, action.plan_digest);
        if (!teamState.ok || teamState.state !== 'SUCCEEDED') {
          return { ok: false, reason: 'dependent-team-ensure-not-succeeded' };
        }
      }
    }
  }

  const consumeResult = consumeInterpreterActionOnce(projectRoot, actionId);
  if (!consumeResult.ok) return { ok: false, reason: 'action-already-consumed' };

  executor(operation, action);
  return { ok: true, operation, action };
}

  return Object.freeze({
terminalizeSupervisorStartAction, terminalizeActionAsFailed, interpretedActionMarkerPathFor,
    consumeInterpreterActionOnce, sessionGenerationIsLiveById, findAnyRoleBindingPendingAction,
    interpretRoleLifecycleAction,
  });
}

module.exports = { createCliTerminalize };
