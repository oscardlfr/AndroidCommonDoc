'use strict';

function createRootSourceBindingRecords(deps) {
  const {
    path, ROOT_SOURCE_BINDING_KEYS, ROOT_SOURCE_BINDING_KEYS_V2, ROOT_SOURCE_BINDING_SCHEMA, ROOT_SOURCE_BINDING_SCHEMA_V2, ROOT_SOURCE_INGRESS_KEYS, ROOT_SOURCE_INGRESS_SCHEMA,
    ROOT_SOURCE_RETIREMENT_KEYS, ROOT_SOURCE_RETIREMENT_REASON_ENUM, ROOT_SOURCE_RETIREMENT_SCHEMA, actionPathFor, computeClaudeAuthorityIdentityId, currentClockMsForRegistry, hasExactKeys,
    isCanonicalIsoUtc, isHexActionId, isHexCsprng32, isHexDigest64, isoToMsForRegistry, peekSessionGeneration, readClaudeAuthorityFence, readRegistryRecord, rootSourceBindingPathFor,
    validateExpectedRecordFields, validateRootSourceAction, loadConsultation,
  } = deps;

function validateRootSourceBindingRecord(b, expected) {
  const isV1 = !!b && hasExactKeys(b, ROOT_SOURCE_BINDING_KEYS) && b.schema === ROOT_SOURCE_BINDING_SCHEMA;
  const isV2 = !!b && hasExactKeys(b, ROOT_SOURCE_BINDING_KEYS_V2) && b.schema === ROOT_SOURCE_BINDING_SCHEMA_V2;
  if (!b || !(isV1 || isV2)
      || !isHexActionId(b.action_id) || !isHexCsprng32(b.actor_instance_id) || b.runtime !== 'claude-hook'
      || typeof b.runtime_session_key !== 'string' || b.runtime_session_key.length === 0 || typeof b.agent_id !== 'string' || b.agent_id.length === 0
      || b.agent_type !== 'toolkit-specialist' || b.role !== 'toolkit-specialist' || b.reporting_architect !== 'arch-platform'
      || typeof b.subject_bundle_ref !== 'string' || b.subject_bundle_ref.length === 0 || !isHexDigest64(b.subject_scope_digest)
      || !isHexDigest64(b.worktree_id) || !isHexDigest64(b.plan_digest) || !isCanonicalIsoUtc(b.request_expiry)
      || (isV2 && !isHexCsprng32(b.session_generation_id))
      || !isCanonicalIsoUtc(b.created_at) || !isCanonicalIsoUtc(b.expiry)
      || !validateExpectedRecordFields(b, expected)) return { ok: false, reason: 'root-source-binding-shape-invalid' };
  if (isoToMsForRegistry(b.created_at) > isoToMsForRegistry(b.expiry)
      || isoToMsForRegistry(b.created_at) > isoToMsForRegistry(b.request_expiry)
      || isoToMsForRegistry(b.expiry) > isoToMsForRegistry(b.request_expiry)) return { ok: false, reason: 'root-source-binding-time-invalid' };
  return { ok: true, record: b };
}

// M7 section 4.2: exact v1 key-set plus session_generation_id, nothing else.
function validateRootSourceBindingRecordV2(b, expected) {
  if (!b || !hasExactKeys(b, ROOT_SOURCE_BINDING_KEYS_V2) || b.schema !== ROOT_SOURCE_BINDING_SCHEMA_V2
      || !isHexActionId(b.action_id) || !isHexCsprng32(b.actor_instance_id) || b.runtime !== 'claude-hook'
      || typeof b.runtime_session_key !== 'string' || b.runtime_session_key.length === 0 || typeof b.agent_id !== 'string' || b.agent_id.length === 0
      || b.agent_type !== 'toolkit-specialist' || b.role !== 'toolkit-specialist' || b.reporting_architect !== 'arch-platform'
      || typeof b.subject_bundle_ref !== 'string' || b.subject_bundle_ref.length === 0 || !isHexDigest64(b.subject_scope_digest)
      || !isHexDigest64(b.worktree_id) || !isHexDigest64(b.plan_digest) || !isCanonicalIsoUtc(b.request_expiry)
      || !isHexCsprng32(b.session_generation_id)
      || !isCanonicalIsoUtc(b.created_at) || !isCanonicalIsoUtc(b.expiry)
      || !validateExpectedRecordFields(b, expected)) return { ok: false, reason: 'root-source-binding-shape-invalid' };
  if (isoToMsForRegistry(b.created_at) > isoToMsForRegistry(b.expiry)
      || isoToMsForRegistry(b.created_at) > isoToMsForRegistry(b.request_expiry)
      || isoToMsForRegistry(b.expiry) > isoToMsForRegistry(b.request_expiry)) return { ok: false, reason: 'root-source-binding-time-invalid' };
  return { ok: true, record: b };
}

function validateRootSourceBindingFor(projectRootOrRepoDescriptor, bindingId, expectedRole, expectedWorktreeId, expectedPlanDigest) {
  if (!isHexCsprng32(bindingId)) return { ok: false, reason: 'root-source-binding-id-invalid' };
  const read = readRegistryRecord(rootSourceBindingPathFor(projectRootOrRepoDescriptor, bindingId));
  if (!read.ok || read.absent) return { ok: false, reason: read.ok ? 'root-source-binding-absent' : read.reason };
  // M7 section 4.4: exact well-formed v1 is LEGACY_STALE, never a backing or
  // candidate -- recognized and reported distinctly from a genuinely
  // malformed record.
  if (read.obj && hasExactKeys(read.obj, ROOT_SOURCE_BINDING_KEYS) && read.obj.schema === ROOT_SOURCE_BINDING_SCHEMA) {
    return { ok: false, reason: 'root-source-binding-legacy-v1' };
  }
  const raw = validateRootSourceBindingRecordV2(read.obj, { binding_id: bindingId });
  if (!raw.ok) return raw;
  const b = raw.record;
  if (b.role !== expectedRole || b.worktree_id !== expectedWorktreeId || b.plan_digest !== expectedPlanDigest) return { ok: false, reason: 'root-source-binding-scope-mismatch' };
  if (currentClockMsForRegistry() >= isoToMsForRegistry(b.expiry) || currentClockMsForRegistry() >= isoToMsForRegistry(b.request_expiry)) return { ok: false, reason: 'root-source-binding-expired' };
  // M7 section 5 point 2: exact current live SessionGeneration -- a direct
  // session_generation_id VALUE comparison. peekSessionGeneration is a pure
  // lookup: validation must never create or rotate state as a side effect.
  const generation = peekSessionGeneration(projectRootOrRepoDescriptor, { provider: 'claude-hook', runtime_session_key: b.runtime_session_key });
  if (!generation.ok || generation.generationId !== b.session_generation_id) {
    return { ok: false, reason: 'root-source-binding-generation-mismatch' };
  }
  // M7 section 5 point 4: the actor fence is durably absent.
  const authorityIdentityId = computeClaudeAuthorityIdentityId(projectRootOrRepoDescriptor, 'claude-hook', b.runtime_session_key, b.agent_id);
  const fenceRead = readClaudeAuthorityFence(projectRootOrRepoDescriptor, authorityIdentityId);
  if (!fenceRead.ok) return { ok: false, reason: 'authority-fence-invalid' };
  if (!fenceRead.absent) return { ok: false, reason: 'authority-fenced' };
  const actionRead = readRegistryRecord(actionPathFor(projectRootOrRepoDescriptor, b.action_id));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'root-source-action-absent' };
  const actionValid = validateRootSourceAction(actionRead.obj);
  if (!actionValid.ok
      || actionRead.obj.worktree_id !== b.worktree_id || actionRead.obj.plan_digest !== b.plan_digest
      || actionRead.obj.payload.reporting_architect !== b.reporting_architect
      || actionRead.obj.payload.subject_bundle_ref !== b.subject_bundle_ref
      || actionRead.obj.payload.subject_scope_digest !== b.subject_scope_digest
      || actionRead.obj.payload.request_expiry !== b.request_expiry) {
    return { ok: false, reason: 'root-source-binding-action-mismatch' };
  }
  // M7 section 4.4/section 6 (defect 7): authority liveness never consults
  // the legacy root-source retirement marker -- it is non-authoritative
  // whether or not it exists (the existing closed reader/writer pair remain
  // only for the read-only v1-compatibility status projection, never as a
  // gate here). Liveness is cut exclusively via fence/generation/expiry
  // above; the transaction terminal (ack.json/cancel.json) is a SEPARATE,
  // transaction-scoped check applied by mintRoleCommandGrant after ingress.
  return { ok: true, binding: b };
}

function validateRootSourceIngressRecord(record, expected) {
  if (!record || !hasExactKeys(record, ROOT_SOURCE_INGRESS_KEYS) || record.schema !== ROOT_SOURCE_INGRESS_SCHEMA) return { ok: false, reason: 'root-source-ingress-shape-invalid' };
  if (!isHexCsprng32(record.binding_id) || !isHexActionId(record.action_id) || !isHexActionId(record.request_id)
      || !isHexDigest64(record.request_digest) || record.source_role !== 'toolkit-specialist'
      || !isHexCsprng32(record.requester_instance_id) || record.target_role !== 'arch-platform'
      || !isHexDigest64(record.subject_scope_digest) || !isCanonicalIsoUtc(record.request_expiry)
      || !isHexDigest64(record.worktree_id) || !isHexDigest64(record.plan_digest)
      || !isCanonicalIsoUtc(record.created_at) || !validateExpectedRecordFields(record, expected)) {
    return { ok: false, reason: 'root-source-ingress-shape-invalid' };
  }
  if (isoToMsForRegistry(record.created_at) > isoToMsForRegistry(record.request_expiry)) return { ok: false, reason: 'root-source-ingress-time-invalid' };
  return { ok: true, record };
}

function validateRootSourceRetirementRecord(record, expected) {
  if (!record || !hasExactKeys(record, ROOT_SOURCE_RETIREMENT_KEYS) || record.schema !== ROOT_SOURCE_RETIREMENT_SCHEMA) return { ok: false, reason: 'root-source-retirement-shape-invalid' };
  if (!isHexCsprng32(record.binding_id) || !isHexActionId(record.action_id)
      || !(record.request_id === null || isHexActionId(record.request_id))
      || !ROOT_SOURCE_RETIREMENT_REASON_ENUM.includes(record.reason)
      || !(record.terminal_ref === null || (typeof record.terminal_ref === 'string' && record.terminal_ref.length > 0))
      || !(record.terminal_digest === null || isHexDigest64(record.terminal_digest))
      || (record.terminal_ref === null) !== (record.terminal_digest === null)
      || !isCanonicalIsoUtc(record.retired_at) || !validateExpectedRecordFields(record, expected)) {
    return { ok: false, reason: 'root-source-retirement-shape-invalid' };
  }
  if ((record.reason === 'acked' || record.reason === 'cancelled')
      && (record.request_id === null || record.terminal_ref === null || record.terminal_digest === null)) {
    return { ok: false, reason: 'root-source-retirement-terminal-required' };
  }
  // NO-GO Correction C.6: terminal_ref must be EXACTLY the canonical ref
  // ackPathFor/cancelPathFor derive for THIS record's own request_id --
  // never "any non-empty string". A path-traversal/foreign-ref floor ahead
  // of readRootSourceTerminalArtifacts's own fd-bound correlation.
  if (record.terminal_ref !== null) {
    let rc;
    try { rc = loadConsultation(); } catch (err) { return { ok: false, reason: 'root-source-retirement-shape-invalid' }; }
    const expectedBasename = record.reason === 'acked'
      ? path.basename(rc.ackPathFor('x')) : path.basename(rc.cancelPathFor('x'));
    const expectedRef = 'transactions/' + record.request_id + '/' + expectedBasename;
    if (record.terminal_ref !== expectedRef) return { ok: false, reason: 'root-source-retirement-terminal-ref-not-canonical' };
  }
  return { ok: true, record };
}


  return Object.freeze({ validateRootSourceBindingRecord, validateRootSourceBindingRecordV2, validateRootSourceBindingFor, validateRootSourceIngressRecord, validateRootSourceRetirementRecord });
}

module.exports = { createRootSourceBindingRecords };

