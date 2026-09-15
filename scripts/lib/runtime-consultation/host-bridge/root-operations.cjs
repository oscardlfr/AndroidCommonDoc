'use strict';

function createRootOperationsModule(deps) {
  const {
    path,
    CliError,
    rootConsultIntentContext,
    rootConsultOperationResult,
    readExistingRootConsultCompletion,
    requestInputForRootIntent,
    buildCanonicalRequest,
    assertBuiltRootRequestMatchesIntent,
    publishPreallocatedRequest,
    dispatchCanonical,
    canonicalRequestPathForRootIntent,
    hostBridgeObserveChildResult,
    nowIso,
    canonicalJSONStringify,
    sha256Buffer,
    readLifecycleRecordRequired,
    requireHostBridgeCapability
  } = deps;

  function hostBridgeAdvanceRootConsult(capability, coordRootRaw, intentPathRaw) {
    const c = rootConsultIntentContext(capability, coordRootRaw, intentPathRaw);
    if (c.blocked) return rootConsultOperationResult('blocked', c, { reason: c.blocked });
    const completed = readExistingRootConsultCompletion(c);
    if (completed) return rootConsultOperationResult('completed', c, completed);
    const input = requestInputForRootIntent(c);
    const built = buildCanonicalRequest(capability, input);
    assertBuiltRootRequestMatchesIntent(built, c.intent, c.scope);
    const lockDir = c.rll.rootConsultLockDirFor(c.scope.projectRoot, c.intentId);
    const locked = c.rll.withRegistryLock(lockDir, () => {
      const expectedReservation = {
        intent_id: c.intentId, intent_digest: c.intentRec.digest,
        request_id: c.intent.request_id, request_digest: built.digest,
        requester_actor_instance_id: c.scope.actorInstanceId,
      };
      const reservationPath = c.rll.rootConsultReservationPathFor(c.scope.projectRoot, c.intentId);
      let reservationRec = readLifecycleRecordRequired(
        c.rll, reservationPath, c.rll.validateRootConsultReservationRecord,
        expectedReservation, 'root-consult reservation',
      );
      if (!reservationRec) {
        const reservation = Object.assign({ schema: 'runtime/root-consult-reservation/v1' }, expectedReservation, {
          reserved_at: nowIso(), expiry: c.intent.expiry,
        });
        const valid = c.rll.validateRootConsultReservationRecord(reservation, expectedReservation);
        if (!valid.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'root-consult reservation construction failed');
        const bytes = Buffer.from(canonicalJSONStringify(reservation), 'utf8');
        c.rll.publishNoClobber(reservationPath, bytes, { allowIdenticalIdempotent: true });
        reservationRec = { obj: reservation, bytes, digest: sha256Buffer(bytes), path: reservationPath };
      }
      const published = publishPreallocatedRequest(capability, input);
      if (published.request_digest !== built.digest) throw new CliError('INVALID', 'CORRELATION_INVALID', 'published root request digest changed');
      const requestRef = path.posix.join('transactions', c.intent.request_id, 'request.json');
      const publishedExpected = {
        intent_id: c.intentId, intent_digest: c.intentRec.digest,
        reservation_digest: reservationRec.digest, request_id: c.intent.request_id,
        request_ref: requestRef, request_digest: built.digest,
      };
      const publishedPath = c.rll.rootConsultPublishedPathFor(c.scope.projectRoot, c.intentId);
      let publishedRec = readLifecycleRecordRequired(
        c.rll, publishedPath, c.rll.validateRootConsultPublishedRecord,
        publishedExpected, 'root-consult published marker',
      );
      if (!publishedRec) {
        const marker = Object.assign({ schema: 'runtime/root-consult-published/v1' }, publishedExpected, { published_at: nowIso() });
        const valid = c.rll.validateRootConsultPublishedRecord(marker, publishedExpected);
        if (!valid.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'root-consult published marker construction failed');
        const bytes = Buffer.from(canonicalJSONStringify(marker), 'utf8');
        c.rll.publishNoClobber(publishedPath, bytes, { allowIdenticalIdempotent: true });
        publishedRec = { obj: marker, bytes, digest: sha256Buffer(bytes), path: publishedPath };
      }
      return { published, publishedRec };
    });
    if (!locked || locked.ok !== true) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult WAL lock/advance failed');
    }
    const wal = locked.value;
    const dispatched = dispatchCanonical({
      'coordination-root': c.coordRoot, request: built.requestPath,
    }, { requiredDriver: 'codex-app-server', allowIdenticalIdempotent: true });
    return rootConsultOperationResult('ready', c, {
      requestPath: built.requestPath,
      requestRef: wal.publishedRec.obj.request_ref,
      requestDigest: built.digest,
      activationPath: dispatched.artifact_ref,
      item: {
        requestPath: built.requestPath, requestId: c.intent.request_id,
        evidencePolicy: c.intent.evidence_policy,
      },
    });
  }

  function hostBridgeObserveAndCompleteRootConsult(capability, coordRootRaw, intentPathRaw) {
    const c = rootConsultIntentContext(capability, coordRootRaw, intentPathRaw);
    if (c.blocked) return rootConsultOperationResult('blocked', c, { reason: c.blocked });
    const completed = readExistingRootConsultCompletion(c);
    if (completed) return rootConsultOperationResult('completed', c, completed);
    const publishedPath = c.rll.rootConsultPublishedPathFor(c.scope.projectRoot, c.intentId);
    const publishedRec = readLifecycleRecordRequired(
      c.rll, publishedPath, c.rll.validateRootConsultPublishedRecord,
      { intent_id: c.intentId, intent_digest: c.intentRec.digest, request_id: c.intent.request_id },
      'root-consult published marker',
    );
    if (!publishedRec) return rootConsultOperationResult('pending', c);
    const requestPath = canonicalRequestPathForRootIntent(c);
    const observed = hostBridgeObserveChildResult(capability, c.coordRoot, requestPath);
    if (!observed.ready) return rootConsultOperationResult('pending', c, { requestPath, requestDigest: publishedRec.obj.request_digest });
    const completionPath = c.rll.rootConsultCompletionPathFor(c.scope.projectRoot, c.intentId);
    if (observed.status === 'BLOCKED') {
      return rootConsultOperationResult('blocked', c, {
        reason: observed.reason, requestPath, requestDigest: observed.requestDigest,
        resultRef: path.posix.join('transactions', c.intent.request_id, 'results', path.basename(observed.resultPath)),
        resultDigest: observed.resultDigest,
        ackRef: path.posix.join('transactions', c.intent.request_id, 'ack.json'), ackDigest: observed.ackDigest,
      });
    }
    const completion = {
      schema: 'runtime/root-consult-completion/v1', intent_id: c.intentId,
      request_id: c.intent.request_id, request_digest: observed.requestDigest,
      result_ref: path.posix.join('transactions', c.intent.request_id, 'results', path.basename(observed.resultPath)),
      result_digest: observed.resultDigest,
      accepted_result_ref: path.posix.join('transactions', c.intent.request_id, 'accepted-result.json'),
      accepted_result_digest: observed.acceptedDigest,
      ack_ref: path.posix.join('transactions', c.intent.request_id, 'ack.json'), ack_digest: observed.ackDigest,
      requester_actor_instance_id: c.scope.actorInstanceId, created_at: nowIso(),
    };
    const valid = c.rll.validateRootConsultCompletionRecord(completion, {
      intent_id: c.intentId, request_id: c.intent.request_id,
      requester_actor_instance_id: c.scope.actorInstanceId,
    });
    if (!valid.ok) throw new CliError('INVALID', 'SCHEMA_INVALID', 'root-consult completion construction failed');
    const completionBytes = Buffer.from(canonicalJSONStringify(completion), 'utf8');
    const completionLock = c.rll.withRegistryLock(
      c.rll.rootConsultLockDirFor(c.scope.projectRoot, c.intentId),
      () => {
        // Same actor/capability remains current at the final publication point;
        // a successor cannot complete the predecessor's root operation.
        requireHostBridgeCapability(capability);
        c.rll.publishNoClobber(completionPath, completionBytes, { allowIdenticalIdempotent: true });
        return true;
      },
    );
    if (!completionLock || completionLock.ok !== true || completionLock.value !== true) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'root-consult completion lock/publication failed');
    }
    const completionRec = readLifecycleRecordRequired(
      c.rll, completionPath, c.rll.validateRootConsultCompletionRecord,
      completion, 'root-consult completion',
    );
    return rootConsultOperationResult('completed', c, {
      requestPath, requestDigest: observed.requestDigest,
      resultPath: observed.resultPath, resultDigest: observed.resultDigest,
      acceptedPath: observed.acceptedPath, acceptedDigest: observed.acceptedDigest,
      ackPath: observed.ackPath, ackDigest: observed.ackDigest,
      completionPath, completionDigest: completionRec.digest,
      item: observed,
    });
  }


  return {
    hostBridgeAdvanceRootConsult,
    hostBridgeObserveAndCompleteRootConsult
  };
}

module.exports = { createRootOperationsModule };

