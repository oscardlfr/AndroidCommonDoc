'use strict';

function createRootSourceReservation(deps) {
  const {
    Buffer, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS, ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA, ROOT_SOURCE_RESERVATION_KEYS, ROOT_SOURCE_RESERVATION_SCHEMA, actionPathFor, canonicalJSONStringify,
    currentClockMsForRegistry, hasExactKeys, isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, isoToMsForRegistry, nowIsoForRegistry, publishNoClobber, readRegistryRecord,
    rootSourceReservationConsumedPathFor, rootSourceReservationPathFor, sha256String, validateMainOrchestratorBindingFor, validateRootSourceAction,
  } = deps;

function mintRootSourceReservation(projectRoot, action, context) {
  const valid = validateRootSourceAction(action);
  if (!valid.ok) return valid;
  if (currentClockMsForRegistry() >= isoToMsForRegistry(action.expires_at)) return { ok: false, reason: 'root-source-action-expired' };
  if (currentClockMsForRegistry() >= isoToMsForRegistry(action.payload.request_expiry)) return { ok: false, reason: 'root-source-request-expired' };
  const c = context || {};
  if (!isHexCsprng32(c.mainBindingId) || c.sessionGenerationId !== action.session_generation_id
      || typeof c.runtimeSessionKey !== 'string' || c.runtimeSessionKey.length === 0
      || typeof c.toolUseId !== 'string' || c.toolUseId.length === 0) return { ok: false, reason: 'root-source-reservation-context-invalid' };
  const main = validateMainOrchestratorBindingFor({ repoId: action.repo_id }, c.mainBindingId, action);
  if (!main.ok || main.binding.runtime_session_key !== c.runtimeSessionKey) return { ok: false, reason: 'root-source-reservation-main-binding-invalid' };
  let toolInputDigest = c.toolInputDigest;
  if (toolInputDigest === undefined && c.toolInput !== undefined) toolInputDigest = sha256String(canonicalJSONStringify(c.toolInput));
  if (!isHexDigest64(toolInputDigest)) return { ok: false, reason: 'root-source-reservation-tool-input-invalid' };
  if (!isHexDigest64(c.canonicalInputDigest) || !isHexDigest64(c.proposedInputDigest)
      || typeof c.modelDeviation !== 'boolean' || toolInputDigest !== c.canonicalInputDigest) {
    return { ok: false, reason: 'root-source-reservation-input-audit-invalid' };
  }
  const nowStr = nowIsoForRegistry();
  const record = {
    schema: ROOT_SOURCE_RESERVATION_SCHEMA, action_id: action.action_id,
    action_digest: sha256String(canonicalJSONStringify(action)), main_binding_id: c.mainBindingId,
    session_generation_id: action.session_generation_id, runtime_session_key: c.runtimeSessionKey,
    tool_use_id: c.toolUseId, tool_input_digest: toolInputDigest, reserved_at: nowStr,
    canonical_input_digest: c.canonicalInputDigest, proposed_input_digest: c.proposedInputDigest,
    model_deviation: c.modelDeviation,
    expiry: action.expires_at,
  };
  try {
    publishNoClobber(rootSourceReservationPathFor(projectRoot, action.action_id), Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) { return { ok: false, reason: 'root-source-reservation-publish-failed' }; }
  return { ok: true, reservation: record };
}

function validateRootSourceReservationRecord(record, action) {
  if (!record || !hasExactKeys(record, ROOT_SOURCE_RESERVATION_KEYS) || record.schema !== ROOT_SOURCE_RESERVATION_SCHEMA) return { ok: false, reason: 'root-source-reservation-shape-invalid' };
  if (!isHexActionId(record.action_id) || !isHexDigest64(record.action_digest) || !isHexCsprng32(record.main_binding_id)
      || !isHexCsprng32(record.session_generation_id) || typeof record.runtime_session_key !== 'string' || record.runtime_session_key.length === 0
      || typeof record.tool_use_id !== 'string' || record.tool_use_id.length === 0 || !isHexDigest64(record.tool_input_digest)
      || !isHexDigest64(record.canonical_input_digest) || !isHexDigest64(record.proposed_input_digest)
      || typeof record.model_deviation !== 'boolean' || record.tool_input_digest !== record.canonical_input_digest
      || !isCanonicalIsoUtc(record.reserved_at) || !isCanonicalIsoUtc(record.expiry)) return { ok: false, reason: 'root-source-reservation-shape-invalid' };
  if (isoToMsForRegistry(record.reserved_at) > isoToMsForRegistry(record.expiry)) return { ok: false, reason: 'root-source-reservation-time-invalid' };
  if (action) {
    const valid = validateRootSourceAction(action);
    if (!valid.ok || record.action_id !== action.action_id || record.action_digest !== sha256String(canonicalJSONStringify(action))
        || record.session_generation_id !== action.session_generation_id || record.expiry !== action.expires_at) return { ok: false, reason: 'root-source-reservation-action-mismatch' };
  }
  return { ok: true, record };
}

function validateAndConsumeRootSourceReservation(projectRoot, actionId, context) {
  if (!isHexActionId(actionId)) return { ok: false, reason: 'root-source-action-id-invalid' };
  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'root-source-action-absent' };
  const read = readRegistryRecord(rootSourceReservationPathFor(projectRoot, actionId));
  if (!read.ok || read.absent) return { ok: false, reason: 'root-source-reservation-absent' };
  const checked = validateRootSourceReservationRecord(read.obj, actionRead.obj);
  if (!checked.ok) return checked;
  const c = context || {};
  if (checked.record.runtime_session_key !== c.runtimeSessionKey || c.agentType !== 'toolkit-specialist') return { ok: false, reason: 'root-source-reservation-identity-mismatch' };
  if (currentClockMsForRegistry() >= isoToMsForRegistry(checked.record.expiry)) return { ok: false, reason: 'root-source-reservation-expired' };
  const consumed = {
    schema: ROOT_SOURCE_RESERVATION_CONSUMED_SCHEMA,
    action_id: actionId,
    reservation_digest: sha256String(canonicalJSONStringify(checked.record)),
    consumed_at: nowIsoForRegistry(),
  };
  if (!hasExactKeys(consumed, ROOT_SOURCE_RESERVATION_CONSUMED_KEYS)) return { ok: false, reason: 'root-source-reservation-consumed-shape-invalid' };
  try {
    publishNoClobber(rootSourceReservationConsumedPathFor(projectRoot, actionId), Buffer.from(canonicalJSONStringify(consumed), 'utf8'), {});
  } catch (err) { return { ok: false, reason: 'root-source-reservation-replay' }; }
  return { ok: true, reservation: checked.record, action: actionRead.obj };
}


  return Object.freeze({ mintRootSourceReservation, validateRootSourceReservationRecord, validateAndConsumeRootSourceReservation });
}

module.exports = { createRootSourceReservation };

