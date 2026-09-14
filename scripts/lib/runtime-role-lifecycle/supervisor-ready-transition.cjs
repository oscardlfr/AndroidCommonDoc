'use strict';

function createSupervisorReadyTransition(deps) {
  const {
    path, process, Buffer, CANONICAL_ROLES, EXECUTION_CLAIM_KEYS, EXECUTION_CLAIM_SCHEMA, canonicalJSONStringify, currentClockMsForRegistry, executionClaimPathFor, hasExactKeys, isCanonicalIsoUtc,
    isHexCsprng32, isSupervisorPidIdentityShape, isTestCapability, isoToMsForRegistry, markSupervisorLifecycleOwnerRetained, readRegistryRecord, readRoleBindingState, realpathOrSelf, registryRepoDir,
    resolvedNodePath, roleProfileDigestFor, sha256String, terminalizeSupervisorStartAction, transitionRoleBinding, validateMainOrchestratorBindingFor, validateRetainedServiceAuthority,
    validateSupervisorStartAction,
  } = deps;

/**
 * M6 GROUP B: read-only sibling of `validateAndConsumeExecutionClaim` --
 * proves a genuine, correctly-scoped SupervisorExecutionClaim/v1 exists for
 * `action`, minted under the RETAINED session/service authority that is
 * STILL live, WITHOUT ever consuming it (no `.consumed` marker write).
 * Consumption stays `session-run`'s own exclusive one-time act (PLAN.md's
 * "session-run consumes the production claim before every other registry
 * mutation") -- this function exists so a SEPARATE caller
 * (`transitionSupervisorBatchToReady` below, callable in production only
 * from the exact `session-run` process) can verify the SAME
 * authority repeatably, idempotently, without racing or pre-empting that
 * one-time consumption. Deliberately does not check the `.consumed` marker
 * itself either way -- a claim already consumed by a genuine `session-run`
 * run stays just as valid a proof of admission as a not-yet-consumed one
 * (`execution_state` itself is never mutated by consumption, only a
 * separate marker file is created).
 *
 * SUPERVISOR_STARTUP_BUDGET correction (PLAN item 53/58, 2026-09-12): this
 * no longer requires the CLAIM's own short-lived `expiry` (bound by
 * min(ready_timeout_seconds, 120s) -- sized for the local, non-network
 * action/claim admission this ceiling governs, never for a real per-role
 * app-server startup pipeline including a genuine model turn) to still be
 * in the future. What it DOES still require, via the two calls immediately
 * below, is that the underlying RETAINED session/service authority -- the
 * SAME authority runtime-bridge-codex.cjs derives its own bounded post-
 * claim startup lease from -- is still live: validateMainOrchestratorBindingFor
 * independently re-checks the binding itself has not expired, and
 * validateRetainedServiceAuthority re-derives and cross-checks the retained
 * --session-expiry argv value against min(binding.expiry,
 * generation.expiresAt), the exact EXPIRY-SPLIT-01 invariant, re-verified
 * here too. Removing the CLAIM's OWN short-expiry re-check changes nothing
 * observable for `revalidateSupervisorStartAction`'s own (pre-consumption)
 * caller of this function: at that point essentially no time has elapsed
 * since mint, and the ACTUAL, authoritative, one-time-consuming gate
 * (`validateAndConsumeExecutionClaim`, called moments later, an entirely
 * separate implementation this function never calls) still independently,
 * fully enforces the claim's own short expiry against the policy AND the
 * action AND the binding (TTL-02) before consumption can ever succeed.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action
 * @returns {boolean}
 */
function peekLiveSupervisorExecutionClaim(repoDescriptor, action) {
  const actionValidation = validateSupervisorStartAction(action, null);
  if (!actionValidation.ok) return false;
  const claimRead = readRegistryRecord(executionClaimPathFor(repoDescriptor, action.action_id));
  if (!claimRead.ok || claimRead.absent || !claimRead.obj) return false;
  const claim = claimRead.obj;
  if (!hasExactKeys(claim, EXECUTION_CLAIM_KEYS)) return false;
  if (claim.schema !== EXECUTION_CLAIM_SCHEMA) return false;
  if (claim.execution_state !== 'ISSUED') return false;
  if (claim.action_id !== action.action_id) return false;
  if (claim.session_generation_id !== action.session_generation_id) return false;
  if (claim.plan_digest !== action.plan_digest) return false;
  if (claim.worktree_id !== action.worktree_id) return false;
  if (!Array.isArray(action.payload && action.payload.bridge_argv)) return false;
  const expectedArgvDigest = sha256String(canonicalJSONStringify(action.payload.bridge_argv));
  if (claim.canonical_argv_digest !== expectedArgvDigest) return false;
  if (!isCanonicalIsoUtc(claim.created_at) || !isCanonicalIsoUtc(claim.expiry)) return false;
  const createdAtMs = isoToMsForRegistry(claim.created_at);
  const expiryMs = isoToMsForRegistry(claim.expiry);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiryMs) || createdAtMs > expiryMs) return false;
  const nowMs = currentClockMsForRegistry();
  if (createdAtMs > nowMs) return false;
  const bindingResult = validateMainOrchestratorBindingFor(repoDescriptor, claim.main_binding_id, action);
  if (!bindingResult.ok) return false;
  if (!validateRetainedServiceAuthority(repoDescriptor, action, bindingResult.binding).ok) return false;
  return true;
}

/**
 * M6 GROUP B: a PERMANENT, one-way fact -- "was a SupervisorExecutionClaim/v1
 * EVER minted for this exact action" -- deliberately weaker than
 * `peekLiveSupervisorExecutionClaim` above (no expiry/TTL check): once
 * minted, the claim file exists forever, so this never races a shutdown/
 * expiry path that fires at (or after) the SAME deadline the claim's own
 * TTL is bound by. Used by `terminalizeSupervisorStartAction` below to
 * distinguish a role genuinely READY because THIS action's own batch
 * (`transitionSupervisorBatchToReady`, which itself requires a live claim to
 * ever run) admitted and promoted it, from a role that happens to be READY
 * under the identical (worktree,plan,profile,generation,role) scope for a
 * completely UNRELATED reason (e.g. a test/caller directly forcing the
 * transition, or in principle some other future mechanism) -- only the
 * former is this action's own business to terminalize.
 * @param {{repoId:string}} repoDescriptor
 * @param {string} actionId
 * @returns {boolean}
 */
function wasExecutionClaimEverIssuedFor(repoDescriptor, actionId) {
  const claimRead = readRegistryRecord(executionClaimPathFor(repoDescriptor, actionId));
  if (!claimRead.ok || claimRead.absent || !claimRead.obj) return false;
  const claim = claimRead.obj;
  return !!(
    hasExactKeys(claim, EXECUTION_CLAIM_KEYS)
    && claim.schema === EXECUTION_CLAIM_SCHEMA
    && claim.action_id === actionId
  );
}

/**
 * M6 GROUP B: `session-run`'s own single admission point for "this
 * `supervisor-start` action's COMPLETE batched role set has genuinely
 * finished its per-role bootstrap chain" (spawn, initialize, login,
 * thread/start, bootstrap turn, presence -- all already proven true by the
 * caller for EVERY role in `roles` before this is ever invoked). Read-only
 * pre-validates every role is currently STARTING/REHYDRATING with
 * `pending_action_id===action.action_id` BEFORE any write -- a single role
 * failing this check aborts the whole call with ZERO writes, never a
 * partial batch. Transitions are then applied sequentially via the closed
 * PUBLIC `transitionRoleBinding` graph (never `*Unchecked`); if any
 * individual transition fails partway through (a genuine TOCTOU race -- the
 * pre-validation read is not itself locked across the whole batch), this
 * function invokes the SAME existing one-path cleanup the dispatch's own
 * text names -- `terminalizeSupervisorStartAction` -- exactly once, for the
 * WHOLE action, rather than hand-rolling a second, parallel rollback
 * mechanism. That function's own per-role loop already (a) quarantines
 * every STARTING/REHYDRATING sibling still pending this action (unchanged,
 * pre-existing behavior) and (b) transitions any sibling that ALREADY
 * reached READY back down to UNAVAILABLE via the READY->UNAVAILABLE edge
 * (ROLE_BINDING_TRANSITIONS, M6 GROUP B addition) -- so the complete owned
 * batch is uniformly terminalized regardless of which roles got how far,
 * never leaving one durably stuck at READY while siblings are quarantined.
 * Consolidating onto this ONE shared path (rather than a bespoke internal
 * rollback here) is deliberate: it is correct for BOTH callers below without
 * either needing its own separate cleanup-on-failure logic.
 *
 * Callable only from `session-run`, after that process has completed and
 * supplied corroborating per-role worker-presence evidence for the complete
 * batch. `wait-ready` is deliberately read-only: it observes READY but can
 * never manufacture it from an execution claim. A claim proves admission;
 * it does not prove that spawn/login/thread/turn/presence completed.
 * @param {{repoId:string}} repoDescriptor
 * @param {object} action - the supervisor-start action (role:null) this batch belongs to.
 * @param {string[]} roles - the complete role set this action's own bridge session owns.
 * @returns {{ok:true,records:object[]}|{ok:false,reason:string}}
 */
const SUPERVISOR_READY_EVIDENCE_KEYS = Object.freeze(['role', 'worker_session_id']);
const WORKER_PRESENCE_KEYS = Object.freeze([
  'heartbeat_at', 'lease_expiry', 'pid', 'role', 'role_profile_digest',
  'schema', 'started_at', 'thread_id', 'worker_session_id', 'worktree_id',
]);

function validateSupervisorReadyEvidence(repoDescriptor, action, roles, readyEvidence) {
  if (!Array.isArray(readyEvidence) || readyEvidence.length !== roles.length) {
    return { ok: false, reason: 'ready-evidence-count-invalid' };
  }
  const byRole = new Map();
  for (const evidence of readyEvidence) {
    if (
      !hasExactKeys(evidence, SUPERVISOR_READY_EVIDENCE_KEYS)
      || !roles.includes(evidence.role)
      || !isHexCsprng32(evidence.worker_session_id)
      || byRole.has(evidence.role)
    ) return { ok: false, reason: 'ready-evidence-shape-invalid' };
    byRole.set(evidence.role, evidence);
  }

  const nowMs = currentClockMsForRegistry();
  for (const role of roles) {
    const evidence = byRole.get(role);
    if (!evidence) return { ok: false, reason: 'ready-evidence-role-missing:' + role };
    const presencePath = path.join(
      registryRepoDir(repoDescriptor), 'workers', role,
      evidence.worker_session_id, 'presence.json',
    );
    // The bridge has just published this immutable bootstrap snapshot and
    // does not begin heartbeat replacement until after batch admission, so
    // the stronger path-identity read is both valid and preferable here.
    const presenceRead = readRegistryRecord(presencePath);
    if (!presenceRead.ok || presenceRead.absent || !presenceRead.obj) {
      return { ok: false, reason: 'worker-presence-absent-or-invalid:' + role };
    }
    const presence = presenceRead.obj;
    const startedAtMs = Date.parse(presence.started_at);
    const heartbeatAtMs = Date.parse(presence.heartbeat_at);
    const leaseExpiryMs = Date.parse(presence.lease_expiry);
    if (
      !hasExactKeys(presence, WORKER_PRESENCE_KEYS)
      || presence.schema !== 'coordination/worker-presence/v1'
      || presence.role !== role
      || presence.worker_session_id !== evidence.worker_session_id
      || presence.worktree_id !== action.worktree_id
      || presence.role_profile_digest !== roleProfileDigestFor(role)
      || presence.pid !== process.pid
      || !(
        presence.thread_id === null
        || (typeof presence.thread_id === 'string'
          && presence.thread_id.length > 0
          && Buffer.byteLength(presence.thread_id, 'utf8') <= 4096)
      )
      || !Number.isFinite(startedAtMs) || !Number.isFinite(heartbeatAtMs) || !Number.isFinite(leaseExpiryMs)
      || startedAtMs > heartbeatAtMs || heartbeatAtMs > nowMs + 1000 || nowMs >= leaseExpiryMs
    ) return { ok: false, reason: 'worker-presence-scope-invalid:' + role };
  }
  return { ok: true };
}

const SUPERVISOR_BATCH_READY_TEST_CAPABILITY_ENV = 'RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_CAPABILITY';

/**
 * READY promotion is a process-owned operation. In production, the current
 * Node invocation must byte-correlate to the action's complete bridge argv;
 * importing this module and calling the exported helper directly is never
 * sufficient authority. Unit tests use a separate, double-gated capability
 * because they deliberately exercise rollback without spawning the bridge.
 */
function currentProcessOwnsSupervisorReadyTransition(action) {
  if (
    isTestCapability()
    && typeof process.env[SUPERVISOR_BATCH_READY_TEST_CAPABILITY_ENV] === 'string'
    && process.env[SUPERVISOR_BATCH_READY_TEST_CAPABILITY_ENV].length > 0
  ) return true;
  const expected = action && action.payload && action.payload.bridge_argv;
  if (!Array.isArray(expected) || process.argv.length !== expected.length) return false;
  if (expected[0] !== resolvedNodePath()) return false;
  if (realpathOrSelf(process.argv[1]) !== realpathOrSelf(expected[1])) return false;
  for (let i = 2; i < expected.length; i += 1) {
    if (process.argv[i] !== expected[i]) return false;
  }
  return true;
}

function transitionSupervisorBatchToReady(repoDescriptor, action, roles, readyEvidence, pidIdentity) {
  const actionValidation = validateSupervisorStartAction(action, null);
  if (!actionValidation.ok) return { ok: false, reason: actionValidation.reason };
  if (!currentProcessOwnsSupervisorReadyTransition(action)) {
    return { ok: false, reason: 'supervisor-ready-caller-not-session-run' };
  }
  if (!isSupervisorPidIdentityShape(pidIdentity)) {
    return { ok: false, reason: 'supervisor-ready-pid-identity-invalid' };
  }
  if (!Array.isArray(roles) || roles.length === 0 || !roles.every((r) => typeof r === 'string' && CANONICAL_ROLES.includes(r))) {
    return { ok: false, reason: 'roles-invalid' };
  }
  const normalizedRoles = Array.from(new Set(roles)).sort();
  if (
    normalizedRoles.length !== roles.length
    || normalizedRoles.join('\0') !== actionValidation.roles.join('\0')
  ) {
    return { ok: false, reason: 'roles-action-mismatch' };
  }
  if (!peekLiveSupervisorExecutionClaim(repoDescriptor, action)) {
    return { ok: false, reason: 'execution-claim-absent-or-invalid' };
  }
  const evidenceResult = validateSupervisorReadyEvidence(repoDescriptor, action, roles, readyEvidence);
  if (!evidenceResult.ok) return evidenceResult;

  const pending = [];
  for (const role of roles) {
    const profileDigest = roleProfileDigestFor(role);
    const stateResult = readRoleBindingState(repoDescriptor, action.worktree_id, action.plan_digest, profileDigest, action.session_generation_id, role);
    if (
      !stateResult.ok
      || (stateResult.state !== 'STARTING' && stateResult.state !== 'REHYDRATING')
      || !stateResult.record
      || stateResult.record.pending_action_id !== action.action_id
    ) {
      return { ok: false, reason: 'role-not-pending-this-action:' + role };
    }
    pending.push({ role, profileDigest, fromState: stateResult.state, record: stateResult.record });
  }

  const readyRecords = [];
  for (const entry of pending) {
    if (
      isTestCapability()
      && process.env.RUNTIME_ROLE_LIFECYCLE_TEST_BATCH_READY_FAIL_ROLE === entry.role
    ) {
      const rollback = terminalizeSupervisorStartAction(action, 'native-tool-error');
      return rollback.ok
        ? { ok: false, reason: 'batch-transition-failed:' + entry.role }
        : { ok: false, reason: 'batch-rollback-failed:' + entry.role + ':' + rollback.reason };
    }
    const result = transitionRoleBinding(
      repoDescriptor, action.worktree_id, action.plan_digest, entry.profileDigest,
      action.session_generation_id, entry.role, entry.fromState, 'READY', entry.record, {},
    );
    if (!result.ok) {
      const rollback = terminalizeSupervisorStartAction(action, 'native-tool-error');
      return rollback.ok
        ? { ok: false, reason: 'batch-transition-failed:' + entry.role }
        : { ok: false, reason: 'batch-rollback-failed:' + entry.role + ':' + rollback.reason };
    }
    readyRecords.push(result.record);
  }

  const retained = markSupervisorLifecycleOwnerRetained(
    repoDescriptor, action, normalizedRoles, pidIdentity,
  );
  if (!retained.ok) {
    const rollback = terminalizeSupervisorStartAction(action, 'native-tool-error');
    return rollback.ok
      ? { ok: false, reason: 'supervisor-owner-retain-failed:' + retained.reason }
      : { ok: false, reason: 'supervisor-owner-retain-rollback-failed:' + rollback.reason };
  }

  return { ok: true, records: readyRecords };
}

// ─────────────────────────────────────────────────────────────────────────────
// WP3: CapabilityProvider -- separate from RuntimeIdentityProvider: identity
// answers "who/what session is this", capability answers "is a specific
// connector (Claude Agent Teams / retained Codex) ACTUALLY usable right now".
// Binary existence, an environment variable, or model-authored text NEVER
// proves capability (explicit user ruling). Production (no injected fake) is
// honest: no real capability-proof source is wired yet (WP4 connects the real
// TeamCreate/Codex-supervisor observation) -- always reports every driver
// unavailable, never fabricates READY. Tests inject a deterministic manifest via
// RUNTIME_ROLE_LIFECYCLE_FAKE_CAPABILITIES (test-capability-gated JSON: an array
// of available driver names), mirroring the RuntimeIdentityProvider fake seam.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * M6: scans this repo's OWN role-binding registry for a genuinely READY
 * binding whose `driver` matches `driverName` -- real, falsifiable,
 * registry-derived evidence (never a binary/env/model-authored claim).
 * Every candidate is re-validated through `readRoleBindingState`'s own full
 * closed-shape check (never trusted from a bare directory read), and its
 * claimed scope tuple must hash back to the EXACT registry path it was
 * found at (`roleBindingPathFor`) -- a record sitting at a mismatched/
 * forged path is never trusted.
 * @param {string} projectRoot
 * @param {string} driverName
 * @returns {boolean}
 */

  return Object.freeze({ peekLiveSupervisorExecutionClaim, wasExecutionClaimEverIssuedFor, SUPERVISOR_READY_EVIDENCE_KEYS, WORKER_PRESENCE_KEYS, validateSupervisorReadyEvidence, SUPERVISOR_BATCH_READY_TEST_CAPABILITY_ENV, currentProcessOwnsSupervisorReadyTransition, transitionSupervisorBatchToReady });
}

module.exports = { createSupervisorReadyTransition };
