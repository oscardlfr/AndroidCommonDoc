'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: SupervisorLifecycleTransaction
// -- the coordination_root_id-anchored ACTIVE/TERMINATED owner-marker state
// machine singleton-guarding a retained codex-app-server supervisor batch.
// Never requires the facade or a sibling module.

function createSupervisorLifecycleOwner({
path, registryRepoDir, readRegistryRecord, writeRegistryRecordReplace, withRegistryLock,
  hasOnlyAllowedKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, currentClockMsForRegistry,
  isoToMsForRegistry, nowIsoForRegistry, canonicalJSONStringify, sha256String, CANONICAL_ROLES,
  hasExactKeys, actionPathFor, computeCoordinationRootIdFromPath, readRoleBindingState, roleProfileDigestFor,
  supervisorRetainedServiceExpiryFromAction,
}) {
/**
 * Mints ONE `supervisor-start` action covering the complete sorted+deduped
 * set of `roles` routed to `codex-app-server` (PLAN.md ~L167: "retained
 * Codex emits AT MOST ONE supervisor-start for that complete set, and no
 * later add-role/second-supervisor path exists" -- previously simplified to
 * one action per role; fixed per WP3 item C correction). `roles.length===1`
 * is the trivial single-role case `rotate` also uses via
 * `spawnOrRehydrateSingleRole` below -- same payload shape either way.
 * @returns {{ok:true,actionId:string,action:object}|{ok:false}}
 */
// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C correction pass R2 (point 1), hardened R3 (points B.1/B.3/B.4):
// ONE authoritative lock+durable-owner marker per `coordination_root_id`
// ALONE -- never per {worktree,plan,session_generation}. coordination_root
// IS a deterministic function of repo/projectRoot (PLAN.md's own frozen
// `.planning/coordination` shape), so worktree_id is implied by it, but
// plan_digest and session_generation_id are NOT: PLAN.md ~L536-538 anchors
// the underlying retained-process singleton (the bridge's own role-owner
// records) to `coordination_root_id` alone, and a supervisor-start batch
// backs exactly ONE such retained process. Scoping the LIFECYCLE-level
// owner marker any narrower (as a prior pass did, keying it by
// session_generation_id) let a second, fully independent batch mint for the
// SAME coordination root the moment a new generation appeared -- which the
// bridge would eventually reject at session-run time, but only after
// wastefully starting a second real supervisor race. Classify-singleton,
// mint-the-one-action, transition-the-whole-batch, and publish-the-global-
// owner all happen under this SAME lock -- per-role owner locks
// (roleOwnerLockDirFor, in the bridge) are strictly SUBORDINATE: they
// serialize the LATER real-process rendezvous claim for an ALREADY-decided
// action, never the decision to mint one in the first place. Two concurrent
// `ensure` calls, even for fully disjoint roles and even across two
// DIFFERENT session generations, can therefore never both mint: whichever
// acquires this lock second always finds the first's owner marker already
// published (ACTIVE) and returns unavailable without minting anything --
// never an orphaned action file from a "loser".
//
// The owner marker is itself an explicit, recoverable two-state durable
// machine (point B.3) -- ACTIVE while its action_id's fate is still
// undecided, TERMINATED once that fate is settled -- rather than a
// write-once marker whose mere PRESENCE blocked every future mint forever.
// Two independent, redundant paths drive ACTIVE->TERMINATED, so neither a
// missed explicit call NOR a hard crash can leave the scope permanently,
// silently blocked:
//   1. Explicit (point B.4): `action-failed` (CLI or bridge-internal, both
//      funnel through the SAME `terminalizeSupervisorStartAction`) settles
//      the owner in the SAME call that settles its role-bindings.
//   2. Self-healing (point B.3): a LATER mint attempt that finds an ACTIVE
//      owner independently re-checks whether ITS OWN referenced action has
//      since expired (the SAME bounded TTL every other authority artifact
//      in this system already carries) -- a crash that killed the process
//      before it could ever call action-failed still self-heals here,
//      bounded by that action's own expiry, never by an unbounded wait.
// A rollback mid-transaction (a sibling role-binding transition failing
// after the action was already minted) is unaffected: it unwinds BEFORE the
// owner marker is ever published, so it can never itself strand one. An
// orphaned LOCK directory (the mkdir itself never released) is a SEPARATE
// concern from the owner marker above and is explicitly NOT self-healing:
// withRegistryLock never inspects a held lock's age, so a waiter always
// times out loudly (an explicit {ok:false,reason:'lock-timeout'}, never a
// hang, never a force-reclaim/adopt of someone else's lock) -- proven
// directly against THIS file's own withRegistryLock, at the exact
// supervisorLifecycleTxLockDirFor path shape, by
// runtime-role-lifecycle-registry.test.js's "point 2.5" test (the
// LOCK-ORPHAN-01 name/pattern in runtime-consultation.cjs covers a
// SEPARATE, structurally-similar-but-different lock implementation --
// cited here only as prior art, never as evidence for this one). Because
// nothing can enter this critical section while the lock is held, the
// owner record it protects cannot be corrupted by a stuck lock -- only
// progress on this exact coordination root pauses until an operator
// clears the orphan (declared STOP; no accredited automatic recovery
// exists for this case).
// ─────────────────────────────────────────────────────────────────────────────

const SUPERVISOR_LIFECYCLE_OWNER_SCHEMA = 'runtime/supervisor-lifecycle-owner/v1';
const SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM = Object.freeze(['ACTIVE', 'TERMINATED']);
const SUPERVISOR_LIFECYCLE_OWNER_PHASE_ENUM = Object.freeze(['STARTING', 'RETAINED']);
const SUPERVISOR_PID_IDENTITY_KEYS = Object.freeze(['birth_observed_at', 'executable', 'pid'].sort());
const SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS = Object.freeze([
  'action_id', 'coordination_root_id', 'created_at', 'failure_reason', 'phase',
  'pid_identity', 'plan_digest', 'roles', 'schema', 'service_expiry',
  'session_generation_id', 'state', 'updated_at', 'worktree_id',
].sort());

function isSupervisorPidIdentityShape(value) {
  return !!value
    && typeof value === 'object'
    && hasExactKeys(value, SUPERVISOR_PID_IDENTITY_KEYS)
    && Number.isInteger(value.pid) && value.pid > 0
    && typeof value.executable === 'string' && value.executable.length > 0
    && Buffer.byteLength(value.executable, 'utf8') <= 4096
    && typeof value.birth_observed_at === 'string' && value.birth_observed_at.length > 0
    && Buffer.byteLength(value.birth_observed_at, 'utf8') <= 4096;
}

function supervisorLifecycleTxLockDirFor(projectRootOrRepoId, coordinationRootId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'supervisor-lifecycle-tx', coordinationRootId + '.lock');
}

function supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId) {
  return path.join(registryRepoDir(projectRootOrRepoId), 'supervisor-lifecycle-tx', coordinationRootId + '.json');
}

/**
 * Reads the current owner marker, or synthesizes ABSENT if none exists yet.
 * Closed shape/schema/state-enum/coordination_root_id correlation -- a
 * subset of fields (schema alone) can never authorize treating a foreign or
 * malformed record as this exact scope's owner (mirrors
 * `readRoleBindingState`'s point A.3 closure).
 * @returns {{ok:true,state:'ABSENT'}|{ok:true,state:string,record:object}|{ok:false,reason:string}}
 */
function readSupervisorLifecycleOwnerState(projectRootOrRepoId, coordinationRootId) {
  const recordPath = supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId);
  const read = readRegistryRecord(recordPath);
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, state: 'ABSENT' };
  const rec = read.obj;
  const hasFailureReason = !!rec && Object.prototype.hasOwnProperty.call(rec, 'failure_reason');
  // A definitively TERMINATED pre-Fifteenth record carries no live authority
  // and is accepted only so the next mint can replace it. ACTIVE legacy
  // records remain invalid: inferring a retained phase/PID for a live owner
  // would fabricate authority.
  const legacyTerminated = !!rec && rec.state === 'TERMINATED'
    && !Object.prototype.hasOwnProperty.call(rec, 'phase')
    && !Object.prototype.hasOwnProperty.call(rec, 'service_expiry')
    && !Object.prototype.hasOwnProperty.call(rec, 'pid_identity');
  if (
    !rec || !hasOnlyAllowedKeys(rec, SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS)
    || rec.schema !== SUPERVISOR_LIFECYCLE_OWNER_SCHEMA
    || !SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM.includes(rec.state)
    || (!legacyTerminated && !SUPERVISOR_LIFECYCLE_OWNER_PHASE_ENUM.includes(rec.phase))
    || rec.coordination_root_id !== coordinationRootId
    || !isHexDigest64(rec.worktree_id)
    || !isHexDigest64(rec.plan_digest)
    || !isHexCsprng32(rec.session_generation_id)
    || !isHexActionId(rec.action_id)
    || !Array.isArray(rec.roles) || rec.roles.length === 0
    || !rec.roles.every((r) => CANONICAL_ROLES.includes(r))
    || new Set(rec.roles).size !== rec.roles.length
    || rec.roles.join('\0') !== rec.roles.slice().sort().join('\0')
    || !isCanonicalIsoUtc(rec.created_at) || !isCanonicalIsoUtc(rec.updated_at)
    || (!legacyTerminated && !isCanonicalIsoUtc(rec.service_expiry))
    || (!legacyTerminated && (rec.phase === 'STARTING' ? rec.pid_identity !== null : !isSupervisorPidIdentityShape(rec.pid_identity)))
    || (rec.state === 'TERMINATED' ? (typeof rec.failure_reason !== 'string' || rec.failure_reason.length === 0) : hasFailureReason)
  ) {
    return { ok: false, reason: 'supervisor-lifecycle-owner-shape-invalid' };
  }
  return { ok: true, state: rec.state, record: rec };
}

/**
 * CAS-verified state transition, mirroring `transitionRoleBinding`'s shape.
 * NEVER acquires its own lock -- every caller already holds
 * `supervisorLifecycleTxLockDirFor` for the SAME coordination_root_id, so a
 * self-contained lock here would either be redundant or (nested) deadlock.
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function transitionSupervisorLifecycleOwner(projectRootOrRepoId, coordinationRootId, fromState, toState, fromRecord, extraFields) {
  if (fromState === toState || !SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM.includes(toState)) {
    return { ok: false, reason: 'illegal-owner-transition' };
  }
  const recordPath = supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId);
  const current = readRegistryRecord(recordPath);
  if (!current.ok) return { ok: false, reason: current.reason };
  if (current.absent || !current.obj || current.obj.action_id !== fromRecord.action_id || current.obj.state !== fromState) {
    return { ok: false, reason: 'stale-owner-read' };
  }
  const nextRecord = Object.assign({}, fromRecord, { state: toState, updated_at: nowIsoForRegistry() }, extraFields || {});
  const writeResult = writeRegistryRecordReplace(recordPath, Buffer.from(canonicalJSONStringify(nextRecord), 'utf8'));
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  return { ok: true, record: nextRecord };
}

/**
 * Point B.3: is the ACTIVE owner's own referenced action past its bounded
 * expiry (or gone entirely)? The SAME self-expiry idiom every other
 * authority artifact in this system already carries (grants, claims,
 * bindings) -- an owner marker is never authoritative for longer than the
 * one action it backs could possibly still be alive.
 * @returns {{ok:true,stale:boolean}|{ok:false,reason:string}}
 */
function isSupervisorLifecycleOwnerActionStale(projectRootOrRepoId, ownerRecord) {
  // Once READY has been corroborated, the startup action is historical.  A
  // RETAINED owner is governed by service_expiry plus exact process liveness;
  // callers must never reclaim it merely because action.expires_at elapsed.
  if (ownerRecord && ownerRecord.phase === 'RETAINED') return { ok: true, stale: false };
  const actionRead = readRegistryRecord(actionPathFor(projectRootOrRepoId, ownerRecord.action_id));
  if (!actionRead.ok) return { ok: false, reason: actionRead.reason };
  if (actionRead.absent) return { ok: true, stale: true };
  const expiryMs = isoToMsForRegistry(actionRead.obj && actionRead.obj.expires_at);
  if (!Number.isFinite(expiryMs)) return { ok: true, stale: true };
  return { ok: true, stale: currentClockMsForRegistry() >= expiryMs };
}

/**
 * Marks the lifecycle owner RETAINED only after the complete batch is READY.
 * This is a same-state (ACTIVE) phase CAS, deliberately separate from the
 * ACTIVE->TERMINATED state transition helper.
 */
function markSupervisorLifecycleOwnerRetained(projectRootOrRepoId, action, roles, pidIdentity) {
  if (!isSupervisorPidIdentityShape(pidIdentity)) {
    return { ok: false, reason: 'supervisor-pid-identity-invalid' };
  }
  const argv = action && action.payload && action.payload.bridge_argv;
  let coordinationRoot = null;
  for (let i = 0; Array.isArray(argv) && i < argv.length - 1; i += 1) {
    if (argv[i] === '--coordination-root') { coordinationRoot = argv[i + 1]; break; }
  }
  if (typeof coordinationRoot !== 'string' || !path.isAbsolute(coordinationRoot)) {
    return { ok: false, reason: 'supervisor-coordination-root-invalid' };
  }
  const coordinationRootId = computeCoordinationRootIdFromPath(coordinationRoot);
  const normalizedRoles = Array.from(new Set(roles || [])).sort();
  const serviceExpiry = supervisorRetainedServiceExpiryFromAction(action);
  const lockDir = supervisorLifecycleTxLockDirFor(projectRootOrRepoId, coordinationRootId);
  const locked = withRegistryLock(lockDir, () => {
    const ownerState = readSupervisorLifecycleOwnerState(projectRootOrRepoId, coordinationRootId);
    if (!ownerState.ok) return { ok: false, reason: ownerState.reason };
    const owner = ownerState.record;
    if (
      ownerState.state !== 'ACTIVE' || !owner || owner.phase !== 'STARTING'
      || owner.action_id !== action.action_id
      || owner.worktree_id !== action.worktree_id
      || owner.plan_digest !== action.plan_digest
      || owner.session_generation_id !== action.session_generation_id
      || owner.service_expiry !== serviceExpiry
      || owner.roles.join('\0') !== normalizedRoles.join('\0')
    ) return { ok: false, reason: 'supervisor-owner-retain-cas-mismatch' };
    for (const role of normalizedRoles) {
      const state = readRoleBindingState(
        projectRootOrRepoId, action.worktree_id, action.plan_digest,
        roleProfileDigestFor(role), action.session_generation_id, role,
      );
      if (!state.ok || state.state !== 'READY') {
        return { ok: false, reason: 'supervisor-owner-role-not-ready:' + role };
      }
    }
    const next = Object.assign({}, owner, {
      phase: 'RETAINED',
      pid_identity: Object.assign({}, pidIdentity),
      updated_at: nowIsoForRegistry(),
    });
    const write = writeRegistryRecordReplace(
      supervisorLifecycleOwnerPathFor(projectRootOrRepoId, coordinationRootId),
      Buffer.from(canonicalJSONStringify(next), 'utf8'),
    );
    return write.ok ? { ok: true, record: next } : { ok: false, reason: write.reason };
  }, { maxWaitMs: 2000 });
  return locked.ok ? locked.value : { ok: false, reason: locked.reason };
}

/**
 * Point B.4/B.3: settle the owner marker for `coordinationRootId` IF it is
 * still the one this exact action_id minted -- never touch a record a
 * different, later batch has already superseded. Acquires the SAME
 * `supervisorLifecycleTxLockDirFor` lock a concurrent mint attempt would, as
 * a SEPARATE (non-nested) critical section from the caller's own
 * per-action role-binding lock: a brief window where role-bindings are
 * already terminal but the owner is not YET is benign (a racing ensure()
 * for THIS exact generation already sees terminal role-bindings and never
 * re-mints; only a DIFFERENT generation's mint could observe stale-ACTIVE
 * here, and its own staleness self-heal above covers that).
 * @returns {{ok:true,terminalized:boolean}|{ok:false,reason:string}}
 */
function terminalizeSupervisorLifecycleOwnerIfCurrent(projectRootOrRepoId, coordinationRootId, actionId, reason) {
  const lockDir = supervisorLifecycleTxLockDirFor(projectRootOrRepoId, coordinationRootId);
  const result = withRegistryLock(lockDir, () => {
    const ownerState = readSupervisorLifecycleOwnerState(projectRootOrRepoId, coordinationRootId);
    if (!ownerState.ok) return { ok: false, reason: ownerState.reason };
    if (ownerState.state !== 'ACTIVE' || ownerState.record.action_id !== actionId) {
      return { ok: true, terminalized: false };
    }
    const transitioned = transitionSupervisorLifecycleOwner(projectRootOrRepoId, coordinationRootId, 'ACTIVE', 'TERMINATED', ownerState.record, { failure_reason: reason });
    return transitioned.ok ? { ok: true, terminalized: true } : { ok: false, reason: transitioned.reason };
  }, { maxWaitMs: 2000 });
  if (!result.ok) return { ok: false, reason: result.reason };
  return result.value;
}

/**
 * Contention budget for the multi-record supervisor lifecycle transaction.
 *
 * Windows secures every registry directory through an ACL subprocess, so a
 * competing transaction can legitimately hold this lock substantially longer
 * than on POSIX. Resolve the platform at call time so test seams and embedded
 * hosts observe their current platform instead of a module-load snapshot.
 * This budget is intentionally private to mintSupervisorBatchUnderTransaction;
 * ordinary registry locks retain their existing fail-fast behaviour.
 *
 * @returns {number}
 */
function supervisorLifecycleTransactionContentionBudgetMs() {
  return process.platform === 'win32' ? 30_000 : 2_000;
}

  return Object.freeze({
SUPERVISOR_LIFECYCLE_OWNER_SCHEMA, SUPERVISOR_LIFECYCLE_OWNER_STATE_ENUM,
    SUPERVISOR_LIFECYCLE_OWNER_PHASE_ENUM, SUPERVISOR_LIFECYCLE_OWNER_ALLOWED_KEYS,
    isSupervisorPidIdentityShape, supervisorLifecycleTxLockDirFor, supervisorLifecycleOwnerPathFor,
    readSupervisorLifecycleOwnerState, transitionSupervisorLifecycleOwner,
    isSupervisorLifecycleOwnerActionStale, markSupervisorLifecycleOwnerRetained,
    terminalizeSupervisorLifecycleOwnerIfCurrent, supervisorLifecycleTransactionContentionBudgetMs,
  });
}

module.exports = { createSupervisorLifecycleOwner };
