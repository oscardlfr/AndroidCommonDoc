'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: team-ensure marker
// state machine (PENDING/SUCCEEDED/FAILED), its mint/register/dependents
// seams, and the codex-app-server singleton finder `ensure` uses alongside
// it. Never requires the facade or a sibling module.

function createTeamEnsure({
path, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace, withRegistryLock,
  canonicalJSONStringify, nowIsoForRegistry, hasExactKeys, isCanonicalIsoUtc, generateActionId,
  buildTeamEnsurePayload, mintRoleLifecycleAction, roleProfileDigestFor, roleBindingPathFor,
  readRoleBindingState, CANONICAL_ROLES, actionPathFor, computeActionTtlSeconds, futureIsoForRegistry,
  isFakeExecutorCapability,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C, point A.3: team-ensure ordering (PLAN.md ~L167: "Claude orders
// team-ensure before role-spawn; failure suppresses the dependent spawn and
// triggers routing fallback" -- previously simplified to skip straight to
// role-spawn). A per-session-generation marker tracks whether a team-ensure
// action has already been minted: a repeat `ensure` call while it is still
// PENDING re-reports the SAME action_id (idempotent, never a second mint,
// mirroring the STARTING-state "re-report the pending action" idiom already
// used for role-bindings); `action-failed` on that action_id moves it to
// FAILED, after which affected roles report CAPABILITY_UNAVAILABLE rather
// than silently retrying forever ("routing fallback" -- a fresh `ensure` in
// a NEW session generation is the natural retry path, same as any other
// terminal-for-this-generation state elsewhere in this file). The mint
// itself cannot be awaited synchronously (the executor's TeamCreate call
// happens OUTSIDE this process) -- ordering is expressed by returning
// team-ensure FIRST in the `actions[]` array, per PLAN.md's own "ordered..."
// action-envelope contract; the executor's own sequencing contract (PLAN.md
// ~L165) is what actually suppresses the dependent Agent()/SendMessage calls
// on team-ensure failure.
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_ENSURE_STATE_ENUM = Object.freeze(['PENDING', 'SUCCEEDED', 'FAILED']);
const TEAM_ENSURE_MARKER_SCHEMA = 'runtime/team-ensure-marker/v1';

// Marker path is keyed by BOTH session generation AND plan_digest -- a
// draft->final PLAN transition changes plan_digest, which by construction
// addresses a DISJOINT marker path (same structural-invalidation idiom as
// session_generation_id itself elsewhere in this file), so a marker bound to
// the OLD PLAN can never be silently reused after a PLAN change.
// WP3 item C correction pass R2 (point 5): worktree_id is part of the PATH,
// not merely the record's own cross-checked field -- two distinct worktrees
// of the same repo (same repoId) that happened to share a session
// generation and PLAN digest would otherwise collide on the SAME marker
// path despite being logically disjoint team-ensure contexts.
function teamEnsureMarkerPathFor(projectRootOrRepoId, generationId, worktreeId, planDigest) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'team-ensures', generationId, worktreeId, planDigest + '.json');
}

/**
 * @returns {{ok:true,state:'ABSENT'}|{ok:true,state:'PENDING'|'SUCCEEDED'|'FAILED',record:object}|{ok:false,reason:string}}
 */
function readTeamEnsureState(repoDescriptor, generationId, worktreeId, planDigest) {
  const read = readRegistryRecord(teamEnsureMarkerPathFor(repoDescriptor, generationId, worktreeId, planDigest));
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  if (
    !rec || rec.schema !== TEAM_ENSURE_MARKER_SCHEMA || !TEAM_ENSURE_STATE_ENUM.includes(rec.state)
    // Defense in depth: cross-check the marker's OWN embedded scope against
    // the caller's expected scope, not merely trusting the path encoding.
    || rec.session_generation_id !== generationId || rec.worktree_id !== worktreeId || rec.plan_digest !== planDigest
  ) {
    return { ok: false, reason: 'team-ensure-marker-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * Locked check-then-mint: idempotently returns the current team-ensure state
 * for this exact (session generation, worktree, PLAN), minting a fresh
 * PENDING one only if none exists yet. Mirrors `resolveSessionGeneration`'s
 * own locked check-then-write idiom to close the same two-concurrent-callers
 * race. Reaching SUCCEEDED requires a SEPARATE call to
 * `registerTeamEnsureSuccess` (point C: minting PENDING alone never unlocks
 * dependent role-spawns).
 * @returns {{ok:true,state:'PENDING',actionId:string,action:object|null}|{ok:true,state:'SUCCEEDED'|'FAILED'}|{ok:false,reason:string}}
 */
function ensureTeamEnsureAction(projectRoot, repoId, worktreeId, planDigest, policyDigest, generationId, policy, bindingExpiryIso) {
  const lockDir = teamEnsureMarkerPathFor(projectRoot, generationId, worktreeId, planDigest) + '.lock';
  const result = withRegistryLock(lockDir, () => {
    const stateResult = readTeamEnsureState(projectRoot, generationId, worktreeId, planDigest);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    if (stateResult.state === 'FAILED') return { ok: true, state: 'FAILED' };
    if (stateResult.state === 'SUCCEEDED') return { ok: true, state: 'SUCCEEDED', actionId: stateResult.record.pending_action_id };
    if (stateResult.state === 'PENDING') {
      const actionRead = readRegistryRecord(actionPathFor(projectRoot, stateResult.record.pending_action_id));
      return { ok: true, state: 'PENDING', actionId: stateResult.record.pending_action_id, action: (actionRead.ok && !actionRead.absent) ? actionRead.obj : null };
    }
    const actionId = generateActionId();
    const payload = buildTeamEnsurePayload('wp3-support-plane', 'WP3 persistent support plane');
    const ttlResult = computeActionTtlSeconds(policy, bindingExpiryIso);
    if (!ttlResult.ok) return { ok: false, reason: ttlResult.reason };
    const expiresAtIso = futureIsoForRegistry(ttlResult.ttlSeconds);
    const mintResult = mintRoleLifecycleAction(projectRoot, actionId, 'team-ensure', 'claude-native', repoId, worktreeId, planDigest, policyDigest, generationId, null, payload, expiresAtIso);
    if (!mintResult.ok) return { ok: false, reason: 'team-ensure-mint-failed' };
    const record = {
      schema: TEAM_ENSURE_MARKER_SCHEMA,
      session_generation_id: generationId,
      worktree_id: worktreeId,
      plan_digest: planDigest,
      pending_action_id: actionId,
      state: 'PENDING',
      created_at: nowIsoForRegistry(),
    };
    const writeResult = writeRegistryRecordReplace(teamEnsureMarkerPathFor(projectRoot, generationId, worktreeId, planDigest), Buffer.from(canonicalJSONStringify(record), 'utf8'));
    if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
    return { ok: true, state: 'PENDING', actionId, action: mintResult.action };
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

/**
 * Host-authority registration that team-ensure SUCCEEDED -- the capability
 * gate lives HERE (mirrors `mintSupervisorExecutionClaim`), not merely in a
 * wrapper. Only a CURRENT PENDING marker for `expectedActionId` may
 * transition (replay/stale/wrong-action rejected). Point 3.4 (R4): `ensure`
 * now eagerly mints role-spawn action(s) alongside a freshly-PENDING
 * team-ensure too (ordered after it) -- this registration is no longer a
 * PREREQUISITE for role-spawn to exist, only for the interpreter to know it
 * may proceed to actually EXECUTE (Agent-spawn) the already-minted one.
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function registerTeamEnsureSuccess(repoDescriptor, generationId, worktreeId, planDigest, expectedActionId) {
  if (!isFakeExecutorCapability()) return { ok: false, reason: 'fake-executor-capability-absent' };
  const lockDir = teamEnsureMarkerPathFor(repoDescriptor, generationId, worktreeId, planDigest) + '.lock';
  const locked = withRegistryLock(lockDir, () => {
    const stateResult = readTeamEnsureState(repoDescriptor, generationId, worktreeId, planDigest);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    if (stateResult.state !== 'PENDING' || stateResult.record.pending_action_id !== expectedActionId) {
      return { ok: false, reason: 'team-ensure-not-current-pending' };
    }
    const record = Object.assign({}, stateResult.record, { state: 'SUCCEEDED', updated_at: nowIsoForRegistry() });
    return writeRegistryRecordReplace(teamEnsureMarkerPathFor(repoDescriptor, generationId, worktreeId, planDigest), Buffer.from(canonicalJSONStringify(record), 'utf8'));
  });
  const inner = locked.ok ? locked.value : { ok: false, reason: locked.reason };
  if (!inner.ok) return { ok: false, reason: inner.reason };
  return { ok: true };
}

/**
 * Finds every role-binding in this (worktree, plan, session) whose
 * `team_ensure_action_id` matches -- the dependents a team-ensure FAILURE
 * must terminalize (point C: "un fallo debe invalidar/transicionar todos
 * los bindings/actions dependientes"). Scans the closed `CANONICAL_ROLES`
 * set (bounded, cheap) rather than requiring a separate reverse index.
 * @returns {{ok:true,dependents:Array<{role:string,state:string,record:object}>}|{ok:false,reason:string}}
 */
function findRoleBindingsDependentOnTeamEnsure(repoDescriptor, worktreeId, planDigest, generationId, teamEnsureActionId) {
  const dependents = [];
  for (const role of CANONICAL_ROLES) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(repoDescriptor, worktreeId, planDigest, profileDigest, generationId, role);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    if (stateResult.state === 'ABSENT') continue;
    if (stateResult.record && stateResult.record.team_ensure_action_id === teamEnsureActionId) {
      dependents.push({ role, state: stateResult.state, record: stateResult.record, profileDigest });
    }
  }
  return { ok: true, dependents };
}


/**
 * Scans every canonical role for a LIVE/PENDING binding whose driver is
 * `codex-app-server` -- point A's singleton check: at most one retained
 * supervisor per (worktree, plan, session), regardless of which role
 * originally spawned it. Bounded (10 canonical roles), cheap.
 * @returns {{ok:true,found:false}|{ok:true,found:true,role:string,pendingActionId:string|null}|{ok:false,reason:string}}
 */
function findExistingSupervisorBinding(repoDescriptor, worktreeId, planDigest, generationId) {
  for (const role of CANONICAL_ROLES) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(repoDescriptor, worktreeId, planDigest, profileDigest, generationId, role);
    if (!stateResult.ok) return { ok: false, reason: stateResult.reason };
    const rec = stateResult.record;
    if (
      rec && rec.driver === 'codex-app-server'
      && (stateResult.state === 'STARTING' || stateResult.state === 'REHYDRATING' || stateResult.state === 'READY' || stateResult.state === 'WAITING' || stateResult.state === 'BUSY')
    ) {
      return { ok: true, found: true, role, pendingActionId: rec.pending_action_id || null };
    }
  }
  return { ok: true, found: false };
}

  return Object.freeze({
TEAM_ENSURE_STATE_ENUM, teamEnsureMarkerPathFor, readTeamEnsureState, ensureTeamEnsureAction,
    registerTeamEnsureSuccess, findRoleBindingsDependentOnTeamEnsure, findExistingSupervisorBinding,
  });
}

module.exports = { createTeamEnsure };
