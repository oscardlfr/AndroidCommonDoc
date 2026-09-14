'use strict';

function createRootSourceBindingAdmission(deps) {
  const {
    Buffer, CLAUDE_AUTHORITY_IDENTITY_SCHEMA, ROOT_SOURCE_BINDING_SCHEMA_V2, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS, ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA, actionPathFor,
    admitClaudeAuthorityOperation, canonicalJSONStringify, checkClaudeAuthorityClassificationAgainstExpected, classifyClaudeAuthorityForIdentity, crypto, currentClockMsForRegistry, hasExactKeys,
    isCanonicalIsoUtc, isHexActionId, isoToMsForRegistry, nowIsoForRegistry, publishNoClobber, readLiveSessionGenerationById, readRegistryRecord, resolveM7RepoId, rootSourceBindingPathFor,
    rootSourceReservationConsumedPathFor, rootSourceReservationPathFor, sha256String, testM7Rendezvous, validateMainOrchestratorBindingFor, validateRootSourceReservationRecord,
    writeGuardedByClaudeAuthorityAdmission,
  } = deps;

function createRootSourceBinding(projectRoot, reservation, action, observed) {
  const checked = validateRootSourceReservationRecord(reservation, action);
  if (!checked.ok) return checked;
  if (currentClockMsForRegistry() >= isoToMsForRegistry(reservation.expiry)) return { ok: false, reason: 'root-source-reservation-expired' };
  const consumedRead = readRegistryRecord(rootSourceReservationConsumedPathFor(projectRoot, action.action_id));
  if (!consumedRead.ok || consumedRead.absent) return { ok: false, reason: 'root-source-reservation-not-consumed' };
  const consumed = consumedRead.obj;
  if (!consumed || !hasExactKeys(consumed, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS)
      || consumed.schema !== ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA
      || consumed.action_id !== action.action_id
      || consumed.reservation_digest !== sha256String(canonicalJSONStringify(reservation))
      || !isCanonicalIsoUtc(consumed.consumed_at)
      || isoToMsForRegistry(consumed.consumed_at) < isoToMsForRegistry(reservation.reserved_at)
      || isoToMsForRegistry(consumed.consumed_at) > isoToMsForRegistry(reservation.expiry)) return { ok: false, reason: 'root-source-reservation-consumed-marker-malformed' };
  const o = observed || {};
  if (o.agentType !== 'toolkit-specialist' || typeof o.agentId !== 'string' || o.agentId.length === 0) return { ok: false, reason: 'root-source-observation-invalid' };
  const main = validateMainOrchestratorBindingFor({ repoId: action.repo_id }, reservation.main_binding_id, action);
  if (!main.ok) return { ok: false, reason: 'root-source-main-binding-invalid' };
  const generation = readLiveSessionGenerationById({ repoId: action.repo_id }, action.session_generation_id);
  if (!generation.ok) return { ok: false, reason: generation.reason };
  const nowStr = nowIsoForRegistry();
  const bindingId = crypto.randomBytes(16).toString('hex');
  const expiryMs = Math.min(isoToMsForRegistry(action.payload.request_expiry), isoToMsForRegistry(main.binding.expiry), isoToMsForRegistry(generation.expiresAt));
  if (!(expiryMs > currentClockMsForRegistry())) return { ok: false, reason: 'root-source-binding-no-lifetime' };
  // M7 section 7 / section 8.1 steps 2-4: obtain create-binding admission
  // through the canonical classifier's full final predicate pass -- a
  // durably-fenced identity is rejected here, cut-first.
  const expiryIso = new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const authorityIdentity = {
    schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
    repo_id: resolveM7RepoId(projectRoot), runtime_session_key: reservation.runtime_session_key, agent_id: o.agentId,
  };
  const admission = admitClaudeAuthorityOperation(projectRoot, authorityIdentity, 'create-binding', expiryIso);
  if (!admission.ok) return { ok: false, reason: admission.reason };
  const authorityIdentityId = admission.capability.authorityIdentityId;
  const binding = {
    schema: ROOT_SOURCE_BINDING_SCHEMA_V2, binding_id: bindingId, action_id: action.action_id,
    actor_instance_id: crypto.randomBytes(16).toString('hex'), runtime: 'claude-hook',
    runtime_session_key: reservation.runtime_session_key, agent_id: o.agentId,
    agent_type: o.agentType, role: 'toolkit-specialist', reporting_architect: 'arch-platform',
    subject_bundle_ref: action.payload.subject_bundle_ref, subject_scope_digest: action.payload.subject_scope_digest,
    request_expiry: action.payload.request_expiry, worktree_id: action.worktree_id, plan_digest: action.plan_digest,
    session_generation_id: action.session_generation_id,
    created_at: nowStr, expiry: expiryIso,
  };
  testM7Rendezvous('create-after-admission-before-write', projectRoot);
  const writeResult = writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => {
    try {
      publishNoClobber(rootSourceBindingPathFor(projectRoot, bindingId), Buffer.from(canonicalJSONStringify(binding), 'utf8'), {});
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'root-source-binding-publish-failed' };
    }
  });
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  // M7 section 7 / defect 4 (GREEN section 4.2): rerun the full predicate --
  // the cross-family classifier, not just the fence -- after the write and
  // before returning success. A fence OR a concurrent conflicting/ambiguous
  // write that lands during the admission-to-write window must still deny
  // the operation, leaving only the already-written record as an inert
  // artifact.
  const postClassification = classifyClaudeAuthorityForIdentity(projectRoot, authorityIdentity);
  if (!postClassification.ok) return postClassification;
  const postCheck = checkClaudeAuthorityClassificationAgainstExpected(postClassification, { state: 'ONE', family: 'root-source', bindingId });
  if (!postCheck.ok) return postCheck;
  return { ok: true, binding };
}

/**
 * M7 FINAL REMEDIATION Part A, Stage B (Codex architecture_ruling,
 * root_source): the ONE canonical RootSource ownership operation the
 * SubagentStart hook now uses instead of separately calling
 * validateAndConsumeRootSourceReservation then createRootSourceBinding as
 * two independent, already-complete operations -- that ordering let a
 * durable fence/terminal/deadline cut land in the gap between them and
 * leave the reservation permanently consumed with zero binding to show for
 * it (A-RED-ROOT-01). Reads and fd-bound validates the action and the
 * STILL-ISSUED reservation (never consuming it), computes the candidate
 * RootSourceBinding/v2, then runs the SAME full authority admission pass
 * createRootSourceBinding always ran -- cut-first, before the reservation is
 * ever touched. Only on admission success does the guarded write publish
 * the consumed marker (no-clobber) immediately before the binding itself
 * (no-clobber), both under the SAME one-use capability. Legacy
 * validateAndConsumeRootSourceReservation/createRootSourceBinding remain
 * exported and unchanged for existing non-hook callers; this is the only
 * entry point the hook's own RootSource path may call.
 * @param {string} projectRoot
 * @param {string} actionId
 * @param {{runtimeSessionKey:string, agentType:string, agentId:string}} context
 * @returns {{ok:true,binding:object}|{ok:false,reason:string}}
 */
function admitAndCreateRootSourceBinding(projectRoot, actionId, context) {
  if (!isHexActionId(actionId)) return { ok: false, reason: 'root-source-action-id-invalid' };
  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'root-source-action-absent' };
  const action = actionRead.obj;
  const reservationRead = readRegistryRecord(rootSourceReservationPathFor(projectRoot, actionId));
  if (!reservationRead.ok || reservationRead.absent) return { ok: false, reason: 'root-source-reservation-absent' };
  const checked = validateRootSourceReservationRecord(reservationRead.obj, action);
  if (!checked.ok) return checked;
  const reservation = checked.record;
  const c = context || {};
  if (reservation.runtime_session_key !== c.runtimeSessionKey || c.agentType !== 'toolkit-specialist') return { ok: false, reason: 'root-source-reservation-identity-mismatch' };
  if (currentClockMsForRegistry() >= isoToMsForRegistry(reservation.expiry)) return { ok: false, reason: 'root-source-reservation-expired' };
  if (typeof c.agentId !== 'string' || c.agentId.length === 0) return { ok: false, reason: 'root-source-observation-invalid' };
  const main = validateMainOrchestratorBindingFor({ repoId: action.repo_id }, reservation.main_binding_id, action);
  if (!main.ok) return { ok: false, reason: 'root-source-main-binding-invalid' };
  const generation = readLiveSessionGenerationById({ repoId: action.repo_id }, action.session_generation_id);
  if (!generation.ok) return { ok: false, reason: generation.reason };
  const nowStr = nowIsoForRegistry();
  const bindingId = crypto.randomBytes(16).toString('hex');
  const expiryMs = Math.min(isoToMsForRegistry(action.payload.request_expiry), isoToMsForRegistry(main.binding.expiry), isoToMsForRegistry(generation.expiresAt));
  if (!(expiryMs > currentClockMsForRegistry())) return { ok: false, reason: 'root-source-binding-no-lifetime' };
  const expiryIso = new Date(expiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const authorityIdentity = {
    schema: CLAUDE_AUTHORITY_IDENTITY_SCHEMA, provider: 'claude-hook',
    repo_id: resolveM7RepoId(projectRoot), runtime_session_key: reservation.runtime_session_key, agent_id: c.agentId,
  };
  // Cut-first: admission runs against the STILL-ISSUED reservation -- a
  // durable fence/deadline cut here denies with the reservation still
  // byte-identical/ISSUED, zero consumed marker, zero binding.
  const admission = admitClaudeAuthorityOperation(projectRoot, authorityIdentity, 'create-binding', expiryIso);
  if (!admission.ok) return { ok: false, reason: admission.reason };
  const binding = {
    schema: ROOT_SOURCE_BINDING_SCHEMA_V2, binding_id: bindingId, action_id: action.action_id,
    actor_instance_id: crypto.randomBytes(16).toString('hex'), runtime: 'claude-hook',
    runtime_session_key: reservation.runtime_session_key, agent_id: c.agentId,
    agent_type: c.agentType, role: 'toolkit-specialist', reporting_architect: 'arch-platform',
    subject_bundle_ref: action.payload.subject_bundle_ref, subject_scope_digest: action.payload.subject_scope_digest,
    request_expiry: action.payload.request_expiry, worktree_id: action.worktree_id, plan_digest: action.plan_digest,
    session_generation_id: action.session_generation_id,
    created_at: nowStr, expiry: expiryIso,
  };
  // Single guarded write: the reservation is consumed (marker published)
  // immediately before the binding, both inside this ONE capability-guarded
  // callback -- there is no window where the marker can land without the
  // binding write being attempted under the SAME already-admitted capability.
  const writeResult = writeGuardedByClaudeAuthorityAdmission(admission.capability, 'create-binding', () => {
    const consumed = {
      schema: ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA,
      action_id: actionId,
      reservation_digest: sha256String(canonicalJSONStringify(reservation)),
      consumed_at: nowIsoForRegistry(),
    };
    if (!hasExactKeys(consumed, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS)) return { ok: false, reason: 'root-source-reservation-consumed-shape-invalid' };
    try {
      publishNoClobber(rootSourceReservationConsumedPathFor(projectRoot, actionId), Buffer.from(canonicalJSONStringify(consumed), 'utf8'), {});
    } catch (err) { return { ok: false, reason: 'root-source-reservation-replay' }; }
    try {
      publishNoClobber(rootSourceBindingPathFor(projectRoot, bindingId), Buffer.from(canonicalJSONStringify(binding), 'utf8'), {});
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'root-source-binding-publish-failed' };
    }
  });
  if (!writeResult.ok) return { ok: false, reason: writeResult.reason };
  const postClassification = classifyClaudeAuthorityForIdentity(projectRoot, authorityIdentity);
  if (!postClassification.ok) return postClassification;
  const postCheck = checkClaudeAuthorityClassificationAgainstExpected(postClassification, { state: 'ONE', family: 'root-source', bindingId });
  if (!postCheck.ok) return postCheck;
  return { ok: true, binding };
}

// M7 section 4.4: this SHARED shape-checker (used by the plain find/scan
// helpers below, none of which themselves distinguish authoritative-vs-
// legacy) accepts EITHER a well-formed v1 OR v2 record as structurally
// valid -- version/authority distinction is applied only by the specific
// callers that need it (validateRootSourceBindingFor, mintRoleCommandGrant,
// the M7 classifier), never here. A record matching NEITHER exact shape is
// genuinely malformed.

  return Object.freeze({ createRootSourceBinding, admitAndCreateRootSourceBinding });
}

module.exports = { createRootSourceBindingAdmission };

