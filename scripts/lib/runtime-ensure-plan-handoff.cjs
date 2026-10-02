'use strict';

// Plan handoff for `ensure` (immutable replacement). A role's identity proof is bound to the PLAN digest it started under, and
// an existing actor's identity is never migrated to another PLAN. So when `ensure` runs for a new PLAN digest while peers of
// the SAME worktree and session generation are still alive under an OLD one (the draft PLAN of a wave, for instance), those
// peers are stopped first and the roles are started again under the new digest, with the same names:
//   1. a live old-plan peer gets a `role-stop-owned` action carrying the canonical shutdown_request (the host sends it as a
//      SendMessage; the host boundary reserves and settles the support-role terminal for it, whatever plan it was bound to);
//   2. while any old-plan peer has no terminal, `ensure` starts nothing: a pending stop is re-reported, never duplicated, up
//      to STOP_ATTEMPT_LIMIT, after which the role is reported as `draft-peer-not-terminal`;
//   3. once every old-plan peer has its terminal, `ensure` proceeds and spawns under the new digest as it always does.
// With no old-plan peer alive this step is a no-op.

const STOP_ATTEMPT_LIMIT = 3;
const STOP_REASON = 'plan-handoff';
const HANDOFF_SHUTDOWN_REQUEST = Object.freeze({ type: 'shutdown_request', reason: STOP_REASON });

const isRecordName = (name) => /^[0-9a-f]{64}\.json$/.test(name);

/** Role-binding records of this worktree and generation that belong to ANOTHER plan digest, for the requested roles. */
function oldPlanBindings(api, projectRoot, binding, roles) {
  const dir = api.path.join(api.registryRepoDir(projectRoot), 'role-bindings');
  let names;
  try { names = api.fs.readdirSync(dir); } catch (error) { return error && error.code === 'ENOENT' ? { ok: true, records: [] } : { ok: false }; }
  const files = names.filter(isRecordName);
  if (files.length > 1024) return { ok: false };
  const records = [];
  for (const name of files) {
    const read = api.readRegistryRecord(api.path.join(dir, name));
    if (!read.ok) return { ok: false };
    const rec = read.obj;
    if (read.absent || !rec || rec.schema !== 'runtime/role-binding/v1') continue;
    if (rec.worktree_id !== binding.worktree_id || rec.session_generation_id !== binding.session_generation_id) continue;
    if (rec.plan_digest === binding.plan_digest || !roles.includes(rec.role) || rec.driver !== 'claude-sendmessage') continue;
    records.push(rec);
  }
  return { ok: true, records };
}

function stopActionsFor(api, projectRoot, rec) {
  const dir = api.path.join(api.registryRepoDir(projectRoot), 'actions');
  let names;
  try { names = api.fs.readdirSync(dir); } catch (error) { return error && error.code === 'ENOENT' ? [] : null; }
  if (names.length > 4096) return null;
  const found = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const read = api.readRegistryRecord(api.path.join(dir, name));
    const action = read.ok && !read.absent ? read.obj : null;
    if (action && action.kind === 'role-stop-owned' && action.role === rec.role && action.plan_digest === rec.plan_digest
      && action.payload && action.payload.binding_id === rec.binding_id && action.payload.reason === STOP_REASON) found.push(action);
  }
  return found;
}

function liveness(api, projectRoot, binding, rec) {
  return api.classifyClaudeSupportRoleLiveness(projectRoot, {
    generationId: binding.session_generation_id, planDigest: rec.plan_digest, role: rec.role,
    runtimeSessionKey: binding.runtime_session_key, worktreeId: binding.worktree_id,
  });
}

function mintStop(api, projectRoot, binding, pair, rec) {
  const ttl = api.effectiveActionTtlSeconds(pair.policy, binding.expiry, { kind: 'role-stop-owned', runtime: 'claude-native' });
  if (!ttl.ok) return null;
  const payload = { binding_id: rec.binding_id, teammate_name: rec.role, reason: STOP_REASON, message: HANDOFF_SHUTDOWN_REQUEST };
  const minted = api.mintRoleLifecycleAction(projectRoot, api.generateActionId(), 'role-stop-owned', 'claude-native',
    api.computeRepoId(projectRoot), binding.worktree_id, rec.plan_digest, api.sha256String(api.canonicalJSONStringify(pair.routing)),
    binding.session_generation_id, rec.role, payload, api.futureIsoForRegistry(ttl.ttlSeconds));
  return minted.ok ? minted.action : null;
}

/**
 * @returns {{ok:false}|{ok:true, actions:object[], blocked:{role:string,reason:string}[]}}
 *   `actions`: stop actions to hand to the host (no spawn may happen this call); `blocked`: roles that cannot proceed.
 */
function resolvePlanHandoff(api, projectRoot, binding, pair, roles) {
  const found = oldPlanBindings(api, projectRoot, binding, roles);
  if (!found.ok) return { ok: false };
  const actions = [];
  const blocked = [];
  for (const rec of found.records) {
    if (rec.state === 'STOPPED' || rec.state === 'QUARANTINED' || rec.state === 'DEAD') continue;
    if (!['READY', 'WAITING', 'STOPPING'].includes(rec.state)) { blocked.push({ role: rec.role, reason: 'draft-peer-' + rec.state.toLowerCase() }); continue; }
    const live = liveness(api, projectRoot, binding, rec);
    if (live.ok && live.status === 'ABSENT') { // its terminal is published: the old peer is gone
      if (rec.state === 'STOPPING') {
        const stopped = api.transitionRoleBinding(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role, 'STOPPING', 'STOPPED', rec, {});
        if (!stopped.ok) return { ok: false };
      }
      continue;
    }
    const previous = stopActionsFor(api, projectRoot, rec);
    if (previous === null) return { ok: false };
    const nowMs = api.currentClockMsForRegistry();
    const pending = previous.find((action) => api.isoToMsForRegistry(action.expires_at) > nowMs);
    if (pending) { actions.push(pending); continue; }
    if (previous.length >= STOP_ATTEMPT_LIMIT) { blocked.push({ role: rec.role, reason: 'draft-peer-not-terminal' }); continue; }
    let from = rec;
    if (rec.state !== 'STOPPING') {
      const stopping = api.transitionRoleBinding(projectRoot, rec.worktree_id, rec.plan_digest, rec.profile_digest, rec.session_generation_id, rec.role, rec.state, 'STOPPING', rec, { stop_reason: STOP_REASON });
      if (!stopping.ok) return { ok: false };
      from = stopping.record;
    }
    const action = mintStop(api, projectRoot, binding, pair, from);
    if (!action) return { ok: false };
    actions.push(action);
  }
  return { ok: true, actions, blocked };
}

/**
 * Runs the handoff for one `ensure` call and, when it has something to say, answers the CLI itself. Returns true when it did
 * (the caller must return), false when `ensure` may proceed to classify and spawn under the new digest.
 */
function runPlanHandoff(api, projectRoot, binding, pair, roles) {
  const handoff = resolvePlanHandoff(api, projectRoot, binding, pair, roles);
  if (!handoff.ok) { api.invalidError('ensure', 'INTERNAL_ERROR'); return true; }
  if (handoff.actions.length > 0) {
    const envelope = handoff.actions.map((action) => Object.assign(api.actionForEnvelope(action), { operation: 'SendMessage' }));
    api.emitAndExit(api.makeResult('ensure', api.RC.OK, 'ACTION_REQUIRED', 'NONE', [], envelope));
    return true;
  }
  if (handoff.blocked.length > 0) {
    try { process.stderr.write('[ensure] roles unavailable: ' + handoff.blocked.map((b) => b.role + ':' + b.reason).join(', ') + '\n'); } catch { /* diagnostics only */ }
    api.unavailableError('ensure', 'CAPABILITY_UNAVAILABLE');
    return true;
  }
  return false;
}

module.exports = Object.freeze({ runPlanHandoff, resolvePlanHandoff, STOP_ATTEMPT_LIMIT, STOP_REASON, HANDOFF_SHUTDOWN_REQUEST });
