'use strict';

function createPatternEvidenceProtocol(deps) {
  const {
    CliError,
    path,
    sha256Buffer,
    isCanonicalContext7LibraryId,
    hasExactKeys,
    isoToMs,
    patternEvidencePathFor,
    readClosedRecord,
    classifyDurableRead,
    DURABLE_PENDING,
    DURABLE_PRESENT,
    assertClosedShape,
    isHexId,
    isHex64,
    isNonEmptyString,
    isNonNegativeInteger,
    isIsoTimestamp,
    orNull,
    isContentRefHandle,
    isPlainObject,
    resolveAuthoritativeAttempt,
    resolveContentRefOrThrow,
  } = deps;

const PATTERN_EVIDENCE_DEPENDENCY_KEYS = Object.freeze([
  'evidence_digest', 'evidence_ref', 'gap_digest', 'internal_search_digest',
  'library_id', 'provider', 'query_digest', 'resolution_digest',
].sort());
const PATTERN_EVIDENCE_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/pattern-evidence/v1' },
  request_id: { check: isHexId },
  request_digest: { check: isHex64 },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  turn_id: { check: isNonEmptyString },
  provider: { check: (v) => v === 'context7' },
  internal_search_digest: { check: isHex64 },
  gap_digest: { check: isHex64 },
  library_id: { check: isCanonicalContext7LibraryId },
  query_digest: { check: isHex64 },
  resolution_ref: { check: (v) => v === null || isContentRefHandle(v) },
  resolution_digest: { check: orNull(isHex64) },
  source_uri: { check: (v) => v === 'https://context7.com/api/v2/context' },
  content_ref: { check: isContentRefHandle },
  created_at: { check: isIsoTimestamp },
};

function isPatternEvidenceDependencyShape(value) {
  if (!hasExactKeys(value, PATTERN_EVIDENCE_DEPENDENCY_KEYS)) return false;
  return (
    isNonEmptyString(value.evidence_ref) && isHex64(value.evidence_digest)
    && value.provider === 'context7' && isHex64(value.internal_search_digest)
    && isHex64(value.gap_digest) && isCanonicalContext7LibraryId(value.library_id)
    && isHex64(value.query_digest) && (value.resolution_digest === null || isHex64(value.resolution_digest))
  );
}

function evidenceRelativeRefFor(requestId) {
  return path.posix.join('transactions', requestId, 'evidence', 'context7.json');
}

function readAndValidatePatternEvidenceRecord(resultObj, reqRec, txnDir, planRoot, classified) {
  const evidencePath = patternEvidencePathFor(txnDir);
  let evidenceRec;
  if (classified && classified.state === DURABLE_PRESENT) {
    assertClosedShape(classified.obj, PATTERN_EVIDENCE_V1_FIELDS);
    evidenceRec = {
      obj: classified.obj,
      bytes: classified.bytes,
      digest: sha256Buffer(classified.bytes),
      path: evidencePath,
    };
  } else {
    evidenceRec = readClosedRecord(evidencePath, PATTERN_EVIDENCE_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'pattern evidence does not resolve',
    });
  }
  const evidence = evidenceRec.obj;
  const auth = resolveAuthoritativeAttempt(reqRec.obj, txnDir);
  if (
    evidence.request_id !== resultObj.in_reply_to
    || evidence.request_digest !== reqRec.digest
    || evidence.attempt_id !== resultObj.attempt_id || evidence.attempt_id !== auth.attemptId
    || evidence.lease_epoch !== resultObj.lease_epoch || evidence.lease_epoch !== auth.leaseEpoch
  ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence does not match the current transaction');
  if (isoToMs(evidence.created_at) >= isoToMs(reqRec.obj.expiry)) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence was created at/after request expiry');
  }
  resolveContentRefOrThrow(planRoot, evidence.content_ref);
  if ((evidence.resolution_ref === null) !== (evidence.resolution_digest === null)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence resolution ref/digest nullability mismatch');
  }
  if (evidence.resolution_ref !== null) {
    if (evidence.resolution_ref.digest !== evidence.resolution_digest || evidence.resolution_ref.blob !== evidence.resolution_digest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence resolution digest does not match its blob handle');
    }
    resolveContentRefOrThrow(planRoot, evidence.resolution_ref);
  }
  return evidenceRec;
}

function validatePatternEvidenceForResult(dependency, resultObj, reqRec, txnDir, planRoot) {
  const evidencePath = patternEvidencePathFor(txnDir);
  if (dependency === null) {
    const classified = classifyDurableRead(evidencePath, { parse: true });
    if (classified.state === DURABLE_PENDING) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'pattern evidence is pending while result declares no dependency');
    }
    if (classified.state === DURABLE_PRESENT && resultObj.status !== 'BLOCKED') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'result omits its existing pattern evidence dependency');
    }
    // Sixteenth explicitly makes the dependency nullable for every BLOCKED
    // result, including a CP that emits BLOCKED on its second, evidence-fed
    // turn.  The durable evidence is still fully reopened and correlated; it
    // simply is not represented as an answer dependency.
    if (classified.state === DURABLE_PRESENT) {
      return readAndValidatePatternEvidenceRecord(resultObj, reqRec, txnDir, planRoot, classified);
    }
    return null;
  }
  if (resultObj.status === 'BLOCKED' || resultObj.from_role !== 'context-provider') {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence dependency is forbidden for this result');
  }
  if (!isPatternEvidenceDependencyShape(dependency)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence dependency shape invalid');
  }
  const expectedRef = evidenceRelativeRefFor(resultObj.in_reply_to);
  if (dependency.evidence_ref !== expectedRef) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence dependency ref is not canonical');
  }
  const evidenceRec = readAndValidatePatternEvidenceRecord(resultObj, reqRec, txnDir, planRoot);
  const evidence = evidenceRec.obj;
  if (
    evidenceRec.digest !== dependency.evidence_digest
    || evidence.provider !== dependency.provider
    || evidence.internal_search_digest !== dependency.internal_search_digest
    || evidence.gap_digest !== dependency.gap_digest
    || evidence.library_id !== dependency.library_id
    || evidence.query_digest !== dependency.query_digest
    || evidence.resolution_digest !== dependency.resolution_digest
  ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'pattern evidence dependency does not match its evidence record/current transaction');
  return { obj: evidence, bytes: evidenceRec.bytes, digest: evidenceRec.digest, path: evidencePath };
}


  return {
    PATTERN_EVIDENCE_DEPENDENCY_KEYS,
    PATTERN_EVIDENCE_V1_FIELDS,
    isPatternEvidenceDependencyShape,
    evidenceRelativeRefFor,
    readAndValidatePatternEvidenceRecord,
    validatePatternEvidenceForResult,
  };
}

module.exports = { createPatternEvidenceProtocol };
