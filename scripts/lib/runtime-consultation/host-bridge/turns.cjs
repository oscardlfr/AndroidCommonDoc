'use strict';

function createTurnsModule(deps) {
  const {
    path,
    CliError,
    requireHostBridgeRequestScope,
    cmdClaim,
    cmdLeaseHeartbeat,
    resolveAbsolute,
    resolveAuthoritativeAttempt,
    claimPathFor,
    readClosedRecord,
    CLAIM_V1_FIELDS,
    readCanonicalCancelRecordOptional,
    cancelPathFor,
    readJsonDurableOptional,
    acceptedResultPathFor,
    ACCEPTED_RESULT_V1_FIELDS,
    resultPathFor,
    RESULT_V2_FIELDS,
    activationIntentPathFor,
    deliveryPathFor,
    nowIso,
    publishNoClobber,
    canonicalJSONStringify,
    ACTIVATION_INTENT_V1_FIELDS,
    hostBridgeCommittedTurnIds,
    isNonEmptyString,
    utf8ByteLength,
    assertClosedShape,
    DELIVERY_V1_FIELDS,
    blobPathFor,
    assertArtifactMatchesReceipt,
    sha256Buffer,
    patternEvidencePathFor,
    PATTERN_EVIDENCE_V1_FIELDS,
    isCanonicalContext7LibraryId,
    sha256String,
    evidenceRelativeRefFor,
    isoToMs,
    assertLockedScopeIdentity,
    withLock,
    planRootFromArtifact,
    validateRuntimeTurnEnvelope,
    validatePatternGap,
    resolveRootEvidenceAuthority,
    isHex64,
    isPatternEvidenceDependencyShape,
    validateConsultationDependencySet,
    cmdPublishResult
  } = deps;

  function hostBridgeClaim(capability, coordRoot, requestPath) {
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    return cmdClaim({
      'coordination-root': checked.coordRoot,
      request: checked.requestPath,
      role: checked.scope.role,
      'worker-session': checked.scope.workerSessionId,
    }, {
      actorInstanceId: checked.scope.actorInstanceId,
      role: checked.scope.role,
      workerSessionId: checked.scope.workerSessionId,
      driver: 'codex-app-server',
      hostBridge: true,
    });
  }

  function hostBridgeLeaseHeartbeat(capability, coordRoot, requestPath, claimPath) {
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    return cmdLeaseHeartbeat({
      'coordination-root': checked.coordRoot,
      request: checked.requestPath,
      claim: resolveAbsolute(claimPath),
    }, {
      actorInstanceId: checked.scope.actorInstanceId,
      role: checked.scope.role,
      workerSessionId: checked.scope.workerSessionId,
      driver: 'codex-app-server',
      hostBridge: true,
    });
  }

  function assertHostBridgeClaimMatches(checked, claimPath) {
    const txnDir = path.dirname(checked.requestPath);
    const auth = resolveAuthoritativeAttempt(checked.reqObj, txnDir);
    const canonicalClaimPath = claimPathFor(txnDir, auth.attemptId);
    if (path.resolve(claimPath) !== path.resolve(canonicalClaimPath)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'host bridge claim is not canonical');
    }
    const claimRec = readClosedRecord(canonicalClaimPath, CLAIM_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'host bridge claim does not resolve',
    });
    if (
      claimRec.obj.request_id !== checked.reqObj.request_id
      || claimRec.obj.attempt_id !== auth.attemptId
      || claimRec.obj.lease_epoch !== auth.leaseEpoch
      || claimRec.obj.claimant_role !== checked.scope.role
      || claimRec.obj.claimant_instance_id !== checked.scope.actorInstanceId
      || claimRec.obj.worker_session_id !== checked.scope.workerSessionId
      || claimRec.obj.driver !== 'codex-app-server'
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge claim does not match capability/current activation');
    return { auth, claimRec, claimPath: canonicalClaimPath };
  }

  function hostBridgeScheduleTurn(capability, coordRoot, requestPath, claimPath) {
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    const claim = assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
    const txnDir = path.dirname(checked.requestPath);
    // CANCEL-AUDIT-01: reads cancel.json ONLY through the sanctioned choke
    // point, never an inline shape-check -- also strictly stronger than a bare
    // shape check, since it additionally accredits the record (matches
    // request_id, cancelled_by/cancelled_at semantics) rather than trusting an
    // unaccredited-but-shape-valid file.
    if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction is cancelled');
    }
    if (readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) }) !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction is already accepted');
    }
    if (readJsonDurableOptional(resultPathFor(txnDir, claim.auth.attemptId), { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) }) !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has a current result');
    }
    const intent = {
      schema: 'coordination/activation-intent/v1',
      request_digest: checked.requestDigest,
      attempt_id: claim.auth.attemptId,
      lease_epoch: claim.auth.leaseEpoch,
      driver: 'codex-app-server',
      commit_point_pending: true,
      created_at: nowIso(),
    };
    const intentPath = activationIntentPathFor(txnDir, claim.auth.attemptId);
    publishNoClobber(intentPath, Buffer.from(canonicalJSONStringify(intent), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
    return {
      ok: true,
      requestId: checked.reqObj.request_id,
      request: checked.reqObj,
      requestDigest: checked.requestDigest,
      attemptId: claim.auth.attemptId,
      leaseEpoch: claim.auth.leaseEpoch,
      claimPath: claim.claimPath,
      claimDigest: claim.claimRec.digest,
      intentPath,
    };
  }

  function hostBridgeRecordTurnStartAccepted(capability, coordRoot, requestPath, claimPath, turnId) {
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    const claim = assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
    const txnDir = path.dirname(checked.requestPath);
    const intentPath = activationIntentPathFor(txnDir, claim.auth.attemptId);
    const intentRec = readClosedRecord(intentPath, ACTIVATION_INTENT_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'Codex activation intent does not resolve',
    });
    if (
      intentRec.obj.request_digest !== checked.requestDigest
      || intentRec.obj.attempt_id !== claim.auth.attemptId
      || intentRec.obj.lease_epoch !== claim.auth.leaseEpoch
      || intentRec.obj.driver !== 'codex-app-server'
      || intentRec.obj.commit_point_pending !== true
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'Codex activation intent is not current');
    let byRequest = null;
    if (turnId !== undefined) {
      if (!isNonEmptyString(turnId) || utf8ByteLength(turnId) > 512) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'host bridge turn id is invalid');
      }
      byRequest = hostBridgeCommittedTurnIds.get(capability);
      const existing = byRequest && byRequest.get(checked.reqObj.request_id);
      if (existing !== undefined && existing !== turnId) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge delivery already binds a different first turn');
      }
    }
    const delivery = {
      schema: 'coordination/delivery/v1',
      request_id: checked.reqObj.request_id,
      attempt_id: claim.auth.attemptId,
      lease_epoch: claim.auth.leaseEpoch,
      driver: 'codex-app-server',
      claim_digest: claim.claimRec.digest,
      commit_point: 'turn-start-accepted',
      commit_point_at: nowIso(),
      created_at: nowIso(),
      delivered: true,
      outcome: 'possibly-delivered',
      detail_code: 'NONE',
    };
    assertClosedShape(delivery, DELIVERY_V1_FIELDS);
    const deliveryPath = deliveryPathFor(txnDir, claim.auth.attemptId);
    publishNoClobber(deliveryPath, Buffer.from(canonicalJSONStringify(delivery), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
    if (turnId !== undefined) {
      if (!byRequest) {
        byRequest = new Map();
        hostBridgeCommittedTurnIds.set(capability, byRequest);
      }
      byRequest.set(checked.reqObj.request_id, turnId);
    }
    return { ok: true, requestId: checked.reqObj.request_id, deliveryPath };
  }

  function ensureUtf8Bytes(value, maxBytes, label) {
    if (!Buffer.isBuffer(value) || value.length === 0 || value.length > maxBytes) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', label + ' bytes are missing or exceed the bound');
    }
    try {
      // TextDecoder's fatal mode rejects malformed byte sequences instead of
      // silently normalizing them through U+FFFD.
      new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch (err) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', label + ' bytes are not valid UTF-8');
    }
    return Buffer.from(value);
  }

  function publishEvidenceBlob(planRoot, bytes) {
    const digest = sha256Buffer(bytes);
    const blobPath = blobPathFor(planRoot, digest);
    const receipt = publishNoClobber(blobPath, bytes, { allowIdenticalIdempotent: true });
    assertArtifactMatchesReceipt(blobPath, receipt, bytes);
    return { blob: digest, digest, size: bytes.length };
  }

  /**
   * Sixteenth §16c host-only evidence writer.  External bytes are accepted only
   * in-process behind a current HostBridgeCapability/current claim, stored in
   * the digest-addressed blob store, and then correlated under the transaction
   * transition lock.  No serialized CLI surface can call this primitive.
   */
  function hostBridgePublishPatternEvidence(capability, coordRoot, requestPath, claimPath, input) {
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    const preClaim = assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
    if (checked.reqObj.target_role !== 'context-provider') {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pattern evidence is context-provider-only');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence input is invalid');
    }
    if (!isNonEmptyString(input.turnId) || !isHex64(input.internalSearchDigest)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'pattern evidence turn/internal-search identity is invalid');
    }
    const committedTurns = hostBridgeCommittedTurnIds.get(capability);
    if (!committedTurns || committedTurns.get(checked.reqObj.request_id) !== input.turnId) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pattern evidence turn does not match the committed first CP turn');
    }
    const gapValidation = validatePatternGap(input.gap);
    if (!gapValidation.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', gapValidation.reason);
    if (!isCanonicalContext7LibraryId(input.libraryId)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'selected Context7 library id is invalid');
    }
    if (input.gap.library_id !== null && input.gap.library_id !== input.libraryId) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'selected Context7 library id does not match the supplied gap id');
    }
    const queryDigest = sha256String(input.gap.query);
    if (input.queryDigest !== undefined && input.queryDigest !== queryDigest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'query digest does not match the exact gap query');
    }
    const gapDigest = sha256String(canonicalJSONStringify(input.gap));
    if (input.gapDigest !== undefined && input.gapDigest !== gapDigest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'gap digest does not match the exact validated gap');
    }
    const contentBytes = ensureUtf8Bytes(input.contentBytes, 1024 * 1024, 'Context7 content');
    const suppliedId = input.gap.library_id !== null;
    if (suppliedId !== (input.resolutionBytes === null || input.resolutionBytes === undefined)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'Context7 resolution bytes do not match supplied-id/search branch');
    }
    const planRoot = planRootFromArtifact(checked.coordRoot, checked.requestPath);
    const contentRef = publishEvidenceBlob(planRoot, contentBytes);
    let resolutionRef = null;
    if (!suppliedId) {
      const resolutionBytes = ensureUtf8Bytes(input.resolutionBytes, 256 * 1024, 'Context7 resolution');
      try { JSON.parse(resolutionBytes.toString('utf8')); }
      catch (err) { throw new CliError('INVALID', 'SCHEMA_INVALID', 'Context7 resolution bytes are not valid JSON'); }
      resolutionRef = publishEvidenceBlob(planRoot, resolutionBytes);
    }
    const txnDir = path.dirname(checked.requestPath);
    return withLock(txnDir, checked.coordRoot, (lockToken) => {
      assertLockedScopeIdentity(lockToken);
      const inLock = requireHostBridgeRequestScope(capability, checked.coordRoot, checked.requestPath);
      const claim = assertHostBridgeClaimMatches(inLock, preClaim.claimPath);
      if (claim.auth.attemptId !== preClaim.auth.attemptId || claim.auth.leaseEpoch !== preClaim.auth.leaseEpoch) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'pattern evidence attempt changed before publication');
      }
      const evidence = {
        schema: 'coordination/pattern-evidence/v1',
        request_id: inLock.reqObj.request_id,
        request_digest: inLock.requestDigest,
        attempt_id: claim.auth.attemptId,
        lease_epoch: claim.auth.leaseEpoch,
        turn_id: input.turnId,
        provider: 'context7',
        internal_search_digest: input.internalSearchDigest,
        gap_digest: gapDigest,
        library_id: input.libraryId,
        query_digest: queryDigest,
        resolution_ref: resolutionRef,
        resolution_digest: resolutionRef === null ? null : resolutionRef.digest,
        source_uri: 'https://context7.com/api/v2/context',
        content_ref: contentRef,
        created_at: nowIso(),
      };
      assertClosedShape(evidence, PATTERN_EVIDENCE_V1_FIELDS);
      if (isoToMs(evidence.created_at) >= isoToMs(inLock.reqObj.expiry)) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'request expired before pattern evidence publication');
      }
      const evidencePath = patternEvidencePathFor(txnDir);
      const evidenceBytes = Buffer.from(canonicalJSONStringify(evidence), 'utf8');
      assertLockedScopeIdentity(lockToken);
      const receipt = publishNoClobber(evidencePath, evidenceBytes, { allowIdenticalIdempotent: true, raceDetailCode: 'AUTHORITY_INVALID' });
      assertLockedScopeIdentity(lockToken);
      assertArtifactMatchesReceipt(evidencePath, receipt, evidenceBytes);
      const dependency = {
        evidence_ref: evidenceRelativeRefFor(evidence.request_id),
        evidence_digest: sha256Buffer(evidenceBytes),
        provider: 'context7',
        internal_search_digest: evidence.internal_search_digest,
        gap_digest: evidence.gap_digest,
        library_id: evidence.library_id,
        query_digest: evidence.query_digest,
        resolution_digest: evidence.resolution_digest,
      };
      return {
        ok: true, dependency, contentRef, contentDigest: contentRef.digest,
        evidencePath, evidenceDigest: dependency.evidence_digest,
      };
    });
  }

  function hostBridgePublishTerminalResult(capability, coordRoot, requestPath, claimPath, resultEnvelope, consultationDependencies, patternEvidenceDependency) {
    const checked = requireHostBridgeRequestScope(capability, coordRoot, requestPath);
    assertHostBridgeClaimMatches(checked, resolveAbsolute(claimPath));
    const validation = validateRuntimeTurnEnvelope({
      schema: 'coordination/runtime-turn-envelope/v1', kind: 'terminal-result', result: resultEnvelope,
    }, checked.reqObj.expected_result_kind, []);
    if (!validation.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid terminal result envelope: ' + validation.reason);
    const suppliedPatternDependency = patternEvidenceDependency === undefined ? null : patternEvidenceDependency;
    if (resultEnvelope.status === 'BLOCKED' && suppliedPatternDependency !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'BLOCKED results must not depend on pattern evidence');
    }
    if (suppliedPatternDependency !== null && !isPatternEvidenceDependencyShape(suppliedPatternDependency)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid host-derived pattern evidence dependency');
    }
    const planRoot = planRootFromArtifact(checked.coordRoot, checked.requestPath);
    const evidenceAuthority = resolveRootEvidenceAuthority(checked.reqObj, checked.requestDigest, checked.coordRoot, checked.scope);
    const evidencePolicy = evidenceAuthority.policy;
    if (
      resultEnvelope.status === 'ANSWERED' && checked.scope.role === 'context-provider'
      && evidencePolicy === 'context7-required' && suppliedPatternDependency === null
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required root answer has no host-derived pattern evidence');
    if (
      resultEnvelope.status === 'ANSWERED' && checked.scope.role === 'context-provider'
      && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred') && evidenceAuthority.libraryId !== null
      && suppliedPatternDependency !== null && suppliedPatternDependency.library_id !== evidenceAuthority.libraryId
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host-derived pattern evidence library_id does not match the approved directive');
    const dependencies = consultationDependencies === undefined ? [] : consultationDependencies;
    // M6/M7 terminal functional closure, point F: the SAME canonical
    // consultation_dependencies validator validateResultV2 later reuses on
    // every reopen -- never a lighter, publish-time-only shape check. The
    // architect-side "exactly one context-provider dependency, question
    // preserved" half only ever applies to an ANSWERED result (point F scopes
    // it to "Bajo un resultado ANSWERED de architect").
    validateConsultationDependencySet(
      dependencies, checked.reqObj, planRoot, checked.coordRoot,
      resultEnvelope.status === 'ANSWERED' ? evidenceAuthority : undefined,
    );
    const flags = {
      'coordination-root': checked.coordRoot,
      request: checked.requestPath,
      claim: resolveAbsolute(claimPath),
    };
    if (resultEnvelope.status === 'ANSWERED') {
      flags.content = Buffer.from(resultEnvelope.content, 'utf8').toString('base64url');
    } else {
      flags['blocked-reason'] = resultEnvelope.reason;
    }
    return cmdPublishResult(flags, {
      actorInstanceId: checked.scope.actorInstanceId,
      role: checked.scope.role,
      workerSessionId: checked.scope.workerSessionId,
      driver: 'codex-app-server',
      hostBridge: true,
      consultationDependencies: dependencies,
      patternEvidenceDependency: suppliedPatternDependency,
    });
  }


  return {
    hostBridgeClaim,
    hostBridgeLeaseHeartbeat,
    hostBridgeScheduleTurn,
    hostBridgeRecordTurnStartAccepted,
    hostBridgePublishPatternEvidence,
    hostBridgePublishTerminalResult
  };
}

module.exports = { createTurnsModule };
