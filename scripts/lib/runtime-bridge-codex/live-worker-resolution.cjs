'use strict';

// Resolves one retained, currently-live Codex app-server worker for an exact project/role/profile tuple -- role-binding + lifecycle owner + supervisor action + process owner + fresh worker-presence, all corroborating.

function createLiveWorkerResolution({
  CANONICAL_ROLES,
  PID_IDENTITY_KEYS,
  READY_WORKER_SCAN_CAP,
  ROLE_OWNER_KEYS,
  ROLE_OWNER_SCHEMA,
  WORKER_PRESENCE_KEYS,
  WORKER_PRESENCE_LEASE_MS,
  WORKER_PRESENCE_SCHEMA,
  classifyProcessIdentityLiveness,
  computeCoordinationRootId,
  computeRepoId,
  computeWorktreeId,
  coordinationRootPathFor,
  discoverPlan,
  findActionDirect,
  fs,
  gitRevParse,
  hasExactKeys,
  isHexActionId,
  path,
  readRegistryRecord,
  readRoleBindingState,
  readSupervisorLifecycleOwnerState,
  realpathOrSelf,
  registryRepoDir,
  resolveSealedGitCache,
  roleOwnerPathFor,
  roleProfileDigestFor,
  validateSupervisorStartAction,
  workerPresencePathFor,
}) {
// M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1 follow-up (empirically forced):
// removing hostBridgeWorkerResolutionMemo exposed that this function's own
// opening block spawns `git rev-parse` FOUR times per call -- gitRevParse
// directly, then again inside computeWorktreeId, again inside
// coordinationRootPathFor (all three with the byte-identical
// '--show-toplevel' args against the SAME cwd), plus once more inside
// computeRepoId with '--git-common-dir'. Measured: ROOT-INGRESS-E2E hung
// past 10 minutes under the real five-role plane with this unmemoized (a
// live process snapshot showed the retained supervisor had consumed 43s of
// CPU in under a minute of wall-clock -- a genuine busy loop, not I/O
// wait); the self-pid ps-spawn shortcut above was NOT sufficient by itself.
// None of these four facts is owner/PID/birth/binding/presence/lease -- they
// are the git worktree's own structural identity (toplevel path,
// coordination-root path, repo id) for a projectRoot that cannot change for
// the life of this process (session-run is permanently scoped to the ONE
// project root it was launched against). Memoized once, forever, per
// distinct projectRoot string -- never a TTL, never reused across a
// DIFFERENT projectRoot, and never covering discoverPlan (plan CONTENT) or
// anything downstream of it, which stays fully fresh on every call exactly
// as before.
// M6+M7 SIXTEENTH Phase 2C: this Map is now sealed-cache-backed (see
// resolveSealedGitCache / sealGitIdentityFor, runtime-consultation.cjs) --
// "memoized once, forever" no longer means "trusted once, forever": every
// reuse cheaply reproves the exact on-disk .git/gitdir/common-dir identity
// this entry was sealed against before returning it, and fails closed on any
// mismatch rather than silently recomputing and accepting a new topology.
const projectGitFactsOnce = new Map();
function resolveProjectGitFactsOnce(projectRoot) {
  const sealed = resolveSealedGitCache(projectGitFactsOnce, projectRoot, (root) => {
    const projectReal = gitRevParse(root, ['rev-parse', '--show-toplevel']);
    const gitCommonDirReal = realpathOrSelf(gitRevParse(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    return {
      ok: true,
      projectReal,
      gitCommonDirReal,
      worktreeId: computeWorktreeId(projectReal),
      coordinationRootReal: coordinationRootPathFor(projectReal),
      repoId: computeRepoId(projectReal),
    };
  });
  // Preserves this function's pre-existing throw-on-failure contract (its
  // one caller below already wraps it in try/catch).
  if (!sealed.ok) throw new Error(sealed.reason);
  const { projectReal, worktreeId, coordinationRootReal, repoId } = sealed.derived;
  return { projectReal, worktreeId, coordinationRootReal, repoId };
}

/**
 * Resolves one retained, currently-live Codex app-server worker for an exact
 * project/role/profile tuple.  A READY role-binding is necessary but never
 * sufficient: the same active lifecycle owner, supervisor action, process
 * owner and fresh worker-presence record must all corroborate it.  This is
 * the production capability proof consumed by runtime-consultation dispatch;
 * it has no environment or test-only success branch.
 *
 * @returns {{ok:true,available:true,worker:object}|{ok:true,available:false,reason:string}|{ok:false,reason:string}}
 */
function resolveLiveCodexAppServerWorkerUncached(projectRoot, role, expectedProfileDigest) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) {
    return { ok: false, reason: 'project-root-invalid' };
  }
  if (!CANONICAL_ROLES.includes(role)) return { ok: false, reason: 'role-not-canonical' };

  let projectReal;
  let worktreeId;
  let plan;
  let profileDigest;
  let coordinationRootReal;
  let repoId;
  try {
    ({ projectReal, worktreeId, coordinationRootReal, repoId } = resolveProjectGitFactsOnce(projectRoot));
    plan = discoverPlan(projectReal);
    profileDigest = roleProfileDigestFor(role);
  } catch (err) {
    return { ok: false, reason: 'worker-scope-unresolvable' };
  }
  if (!plan.ok) return { ok: false, reason: 'plan-unresolvable' };
  if (expectedProfileDigest !== undefined && expectedProfileDigest !== profileDigest) {
    return { ok: true, available: false, reason: 'profile-digest-mismatch' };
  }

  const repoDescriptor = { repoId };
  const coordinationRootId = computeCoordinationRootId(coordinationRootReal);
  const lifecycleOwner = readSupervisorLifecycleOwnerState(repoDescriptor, coordinationRootId);
  if (!lifecycleOwner.ok) return { ok: false, reason: lifecycleOwner.reason };
  if (
    lifecycleOwner.state !== 'ACTIVE' || !lifecycleOwner.record
    || lifecycleOwner.record.phase !== 'RETAINED'
  ) {
    return { ok: true, available: false, reason: 'supervisor-lifecycle-owner-not-active' };
  }
  const owner = lifecycleOwner.record;
  if (
    owner.worktree_id !== worktreeId
    || owner.plan_digest !== plan.planDigest
    || !Array.isArray(owner.roles)
    || !owner.roles.includes(role)
    || !owner.pid_identity || !hasExactKeys(owner.pid_identity, PID_IDENTITY_KEYS)
    || !Number.isFinite(Date.parse(owner.service_expiry))
    || Date.now() >= Date.parse(owner.service_expiry)
  ) return { ok: true, available: false, reason: 'supervisor-lifecycle-owner-scope-mismatch' };

  const lifecycleProcess = classifyProcessIdentityLiveness(owner.pid_identity);
  if (!lifecycleProcess.ok || lifecycleProcess.status === 'INDETERMINATE') {
    return { ok: false, reason: 'supervisor-process-liveness-indeterminate' };
  }
  if (lifecycleProcess.status !== 'LIVE') {
    return { ok: true, available: false, reason: 'supervisor-process-not-live' };
  }

  // M6+M7 SIXTEENTH Phase 2A: repoDescriptor is already resolved above (from
  // the caller-supplied projectRoot via resolveProjectGitFactsOnce) -- a
  // direct actionPathFor lookup, never a full-registry scan.
  const actionRead = findActionDirect(repoDescriptor, owner.action_id);
  if (!actionRead.ok) return { ok: false, reason: actionRead.reason };
  if (actionRead.absent || !actionRead.action) {
    return { ok: true, available: false, reason: 'supervisor-action-absent' };
  }
  const actionValidation = validateSupervisorStartAction(actionRead.action, projectReal);
  if (
    !actionValidation.ok
    || actionRead.action.worktree_id !== worktreeId
    || actionRead.action.plan_digest !== plan.planDigest
    || actionRead.action.session_generation_id !== owner.session_generation_id
    || actionRead.action.action_id !== owner.action_id
    || !actionValidation.roles.includes(role)
  ) return { ok: true, available: false, reason: 'supervisor-action-scope-mismatch' };
  const retainedExpiryIndex = actionRead.action.payload.bridge_argv.indexOf('--session-expiry');
  if (
    retainedExpiryIndex < 0
    || actionRead.action.payload.bridge_argv[retainedExpiryIndex + 1] !== owner.service_expiry
  ) return { ok: false, reason: 'supervisor-retained-expiry-correlation-invalid' };

  const binding = readRoleBindingState(
    repoDescriptor, worktreeId, plan.planDigest, profileDigest,
    owner.session_generation_id, role,
  );
  if (
    !binding.ok || binding.state !== 'READY' || !binding.record
    || binding.record.driver !== 'codex-app-server'
  ) return { ok: true, available: false, reason: 'role-binding-not-ready' };

  const ownerPath = roleOwnerPathFor(repoDescriptor, coordinationRootId, role);
  const processOwnerRead = readRegistryRecord(ownerPath);
  if (!processOwnerRead.ok) return { ok: false, reason: processOwnerRead.reason };
  if (processOwnerRead.absent || !processOwnerRead.obj) {
    return { ok: true, available: false, reason: 'process-owner-absent' };
  }
  const processOwner = processOwnerRead.obj;
  if (
    !hasExactKeys(processOwner, ROLE_OWNER_KEYS)
    || processOwner.schema !== ROLE_OWNER_SCHEMA
    || processOwner.coordination_root_id !== coordinationRootId
    || processOwner.role !== role
    || !isHexActionId(processOwner.rendezvous_instance_id)
    || !isHexActionId(processOwner.supervisor_instance_id)
    || !processOwner.pid_identity || !hasExactKeys(processOwner.pid_identity, PID_IDENTITY_KEYS)
    || !Number.isInteger(processOwner.pid_identity.pid) || processOwner.pid_identity.pid <= 0
    || typeof processOwner.pid_identity.executable !== 'string' || processOwner.pid_identity.executable.length === 0
    || typeof processOwner.pid_identity.birth_observed_at !== 'string' || processOwner.pid_identity.birth_observed_at.length === 0
    || processOwner.pid_identity.pid !== owner.pid_identity.pid
    || processOwner.pid_identity.executable !== owner.pid_identity.executable
    || processOwner.pid_identity.birth_observed_at !== owner.pid_identity.birth_observed_at
  ) return { ok: false, reason: 'process-owner-shape-invalid' };

  // processOwner.pid_identity was just proven byte-identical to
  // owner.pid_identity above (pid, executable, birth_observed_at all
  // checked), so reusing lifecycleProcess here is not a cache of past
  // external state -- it is the same call's own already-computed answer to
  // the identical question, re-derived by the checks immediately above,
  // never by a TTL or cross-call memo.
  const processLiveness = lifecycleProcess;
  if (!processLiveness.ok || processLiveness.status === 'INDETERMINATE') {
    return { ok: false, reason: 'process-owner-liveness-indeterminate' };
  }
  if (processLiveness.status !== 'LIVE') {
    return { ok: true, available: false, reason: 'process-owner-not-live' };
  }

  const presenceDir = path.join(registryRepoDir(repoDescriptor), 'workers', role);
  let entries;
  try {
    entries = fs.readdirSync(presenceDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, available: false, reason: 'worker-presence-absent' };
    return { ok: false, reason: 'worker-presence-scan-failed' };
  }
  if (entries.length > READY_WORKER_SCAN_CAP) return { ok: false, reason: 'worker-presence-scan-cap-exceeded' };

  const nowMs = Date.now();
  const live = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isHexActionId(entry.name)) continue;
    const presencePath = workerPresencePathFor(repoDescriptor, role, entry.name);
    const read = readRegistryRecord(presencePath);
    if (!read.ok) return { ok: false, reason: read.reason };
    if (read.absent || !read.obj) continue;
    const presence = read.obj;
    const startedAt = Date.parse(presence.started_at);
    const heartbeatAt = Date.parse(presence.heartbeat_at);
    const leaseExpiry = Date.parse(presence.lease_expiry);
    if (!hasExactKeys(presence, WORKER_PRESENCE_KEYS) || presence.schema !== WORKER_PRESENCE_SCHEMA) {
      return { ok: false, reason: 'worker-presence-shape-invalid' };
    }
    if (presence.role !== role || presence.worker_session_id !== entry.name) {
      return { ok: false, reason: 'worker-presence-role-or-session-mismatch' };
    }
    if (!Number.isInteger(presence.pid) || presence.pid <= 0) {
      return { ok: false, reason: 'worker-presence-pid-invalid' };
    }
    // Presence records are durable history and are intentionally not deleted
    // when a prior supervisor dies. A record NOT owned by the current process
    // is therefore a stale historical candidate by construction -- its
    // worktree_id/role_profile_digest legitimately reflect an OLD scope
    // (e.g. before the role's .claude/agents/<role>.md template was last
    // edited) and must never be compared against the current worker's own
    // scope. Skip it before any current-scope comparison, never after: only
    // a record owned by the exact current process PID is held to the
    // current worktree_id/role_profile_digest below.
    if (presence.pid !== processOwner.pid_identity.pid) continue;
    if (presence.worktree_id !== worktreeId || presence.role_profile_digest !== profileDigest) {
      return { ok: false, reason: 'worker-presence-worktree-or-profile-mismatch' };
    }
    if (
      !Number.isFinite(startedAt) || !Number.isFinite(heartbeatAt) || !Number.isFinite(leaseExpiry)
      || startedAt > heartbeatAt || heartbeatAt > nowMs + 1000
      || nowMs - heartbeatAt > WORKER_PRESENCE_LEASE_MS || nowMs >= leaseExpiry
    ) return { ok: false, reason: 'worker-presence-time-invalid' };
    if (!(
      presence.thread_id === null
      || (typeof presence.thread_id === 'string' && presence.thread_id.length > 0 && Buffer.byteLength(presence.thread_id, 'utf8') <= 4096)
    )) return { ok: false, reason: 'worker-presence-thread-invalid' };
    live.push({ presencePath, record: presence });
  }
  if (live.length === 0) return { ok: true, available: false, reason: 'worker-presence-not-live' };
  if (live.length !== 1) return { ok: false, reason: 'worker-presence-ambiguous' };

  return {
    ok: true,
    available: true,
    worker: {
      projectRoot: projectReal,
      repoId: repoDescriptor.repoId,
      worktreeId,
      planDigest: plan.planDigest,
      role,
      profileDigest,
      actionId: owner.action_id,
      sessionGenerationId: owner.session_generation_id,
      bindingId: binding.record.binding_id,
      supervisorInstanceId: processOwner.supervisor_instance_id,
      rendezvousInstanceId: processOwner.rendezvous_instance_id,
      workerSessionId: live[0].record.worker_session_id,
      threadId: live[0].record.thread_id,
      pid: processOwner.pid_identity.pid,
      pidIdentity: Object.freeze({
        pid: processOwner.pid_identity.pid,
        executable: processOwner.pid_identity.executable,
        birth_observed_at: processOwner.pid_identity.birth_observed_at,
      }),
    },
  };
}

// M6+M7 SIXTEENTH CIERRE DEFINITIVO Phase 1: the prior NO-GO Correction B fix
// here was a 3000ms wall-clock TTL cache keyed by (projectRoot, role,
// profileDigest) -- a real authority hole (a target killed/retired mid-
// window still read "available:true" for up to 3s, fail-OPEN). The
// queueMicrotask-scoped memo that replaced it closed the cross-tick window
// but not a same-tick one: a caller that runs a synchronous external
// mutation (spawnSync, or any blocking subprocess call) between two resolves
// still observed the stale first result, because queueMicrotask never runs
// until the blocking call returns and the synchronous stack unwinds.
// S16-HOSTBRIDGE-LIVENESS-NO-SAME-TICK-STALE-01 is the discriminating
// regression test. No replacement memo: every call independently re-proves
// lifecycle owner+phase, PID+birth identity, binding READY, worker
// presence+lease and exact scope, exactly as dispatch/materialization/
// consult-root/target-availability each require as their own external
// decision. The redundant ps spawn this removal would otherwise reintroduce
// per call is eliminated at its actual source in
// resolveLiveCodexAppServerWorkerUncached (below), not disguised here.
function resolveLiveCodexAppServerWorker(projectRoot, role, expectedProfileDigest) {
  return resolveLiveCodexAppServerWorkerUncached(projectRoot, role, expectedProfileDigest);
}

  return Object.freeze({
    resolveLiveCodexAppServerWorker,
    resolveLiveCodexAppServerWorkerUncached,
    resolveProjectGitFactsOnce,
  });
}

module.exports = Object.freeze({ createLiveWorkerResolution });
