'use strict';

function createChildrenModule(deps) {
  const {
    path,
    fs,
    CliError,
    requireHostBridgeCapability,
    requireHostBridgeRequestScope,
    validateConsultV2,
    MAX_DEPTH_LIMIT,
    cmdPublishRequest,
    dispatchCanonical,
    resolveAbsolute,
    accreditCanonicalRequest,
    planRootFromArtifact,
    requestPathFor,
    resolveActivationForRequestPath,
    readCanonicalRequestRecord,
    resolveAuthoritativeAttempt,
    resultPathFor,
    RESULT_V2_FIELDS,
    validateResultV2,
    cmdAcceptResult,
    cmdTransactionAck,
    acceptedResultPathFor,
    assertClosedShape,
    ACCEPTED_RESULT_V1_FIELDS,
    readDurableRecord,
    classifyDurableRead,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    assertAcceptedResultCorrelates,
    ACK_V1_FIELDS,
    canonicalJSONStringify,
    hasExactKeys,
    isHexId,
    isoToMs,
    RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES,
    RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN,
    getRuntimeRoleLifecycle
  } = deps;

  function hostBridgeAllowedChildRoles(role) {
    if (role === 'arch-platform' || role === 'arch-testing' || role === 'arch-integration') {
      return ['context-provider'];
    }
    if (
      role === 'toolkit-specialist' || role === 'test-specialist'
      || role === 'verifier' || role === 'quality-gater'
    ) {
      return ['arch-platform', 'arch-testing', 'arch-integration'];
    }
    return [];
  }

  /**
   * Publishes and dispatches one nested consultation on behalf of the exact
   * in-process Codex role capability that owns the parent request.  The model
   * supplies only the closed consult intent; the host derives PLAN, subject
   * bundle, parent, actor, expiry and routing authority from accredited disk
   * state.  No serialized requester grant is minted or accepted on this path.
   */
  function hostBridgePublishChildRequest(capability, coordRootRaw, parentRequestPathRaw, consult) {
    const checked = requireHostBridgeRequestScope(capability, coordRootRaw, parentRequestPathRaw);
    const allowed = hostBridgeAllowedChildRoles(checked.scope.role);
    if (
      !consult || typeof consult !== 'object' || Array.isArray(consult)
      || !hasExactKeys(consult, ['expected_result_kind', 'question', 'target_role'])
      || !allowed.includes(consult.target_role)
      || typeof consult.question !== 'string' || consult.question.length === 0
      || Buffer.byteLength(consult.question, 'utf8') > RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES
      || typeof consult.expected_result_kind !== 'string'
      || !RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN.test(consult.expected_result_kind)
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested consult intent is not allowed for this role');

    if (checked.reqObj.depth >= checked.reqObj.max_depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested consult would exceed max_depth');
    }

    const planRoot = planRootFromArtifact(checked.coordRoot, checked.requestPath);
    const transactionsDir = path.join(planRoot, 'transactions');
    let entries;
    try { entries = fs.readdirSync(transactionsDir, { withFileTypes: true }); }
    catch (err) { throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'unable to inspect nested consultation inventory'); }
    if (entries.length > 4096) throw new CliError('INVALID', 'SECURITY_INVALID', 'nested consultation inventory cap exceeded');

    let existingChildren = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || !isHexId(entry.name)) continue;
      const candidatePath = requestPathFor(planRoot, entry.name);
      let candidate;
      try { candidate = readCanonicalRequestRecord(candidatePath, entry.name, {}).obj; }
      catch (err) { throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'nested consultation inventory contains an unaccredited request'); }
      if (candidate.parent_request_id === checked.reqObj.request_id) existingChildren += 1;
    }
    if (existingChildren >= 2) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested consultation intent budget exhausted');
    }

    const seenRoles = new Set();
    let cursor = checked.reqObj;
    for (let depth = 0; depth <= MAX_DEPTH_LIMIT; depth += 1) {
      seenRoles.add(cursor.source_role);
      seenRoles.add(cursor.target_role);
      if (cursor.parent_request_id === null) break;
      const ancestorPath = requestPathFor(planRoot, cursor.parent_request_id);
      cursor = validateConsultV2(ancestorPath, checked.coordRoot);
    }
    if (seenRoles.has(consult.target_role)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested consultation repeats an ancestor role');
    }

    const nowMs = Date.now();
    const childExpiryMs = Math.min(isoToMs(checked.reqObj.expiry) - 20000, nowMs + 3600 * 1000);
    if (childExpiryMs - nowMs < 120000) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'parent deadline leaves no valid nested consultation lifetime');
    }

    let rll;
    try { rll = getRuntimeRoleLifecycle(); }
    catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
    const plan = rll.discoverPlan(checked.scope.projectRoot);
    if (!plan.ok || plan.planDigest !== checked.scope.planDigest) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'host bridge PLAN is not current');
    }
    const subjectBundlePath = path.join(
      planRoot, 'subject-bundles', checked.reqObj.subject_scope_digest, 'manifest.json',
    );
    const intent = {
      target_role: consult.target_role,
      question: consult.question,
      expected_result_kind: consult.expected_result_kind,
      expiry: new Date(childExpiryMs).toISOString(),
      parent_request_id: checked.reqObj.request_id,
    };
    const published = cmdPublishRequest({
      'coordination-root': checked.coordRoot,
      plan: plan.planPath,
      'subject-bundle': subjectBundlePath,
      intent: Buffer.from(canonicalJSONStringify(intent), 'utf8').toString('base64url'),
    }, {
      actorInstanceId: checked.scope.actorInstanceId,
      role: checked.scope.role,
      workerSessionId: checked.scope.workerSessionId,
      driver: 'codex-app-server',
      hostBridge: true,
    });
    // Sequence 46 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822) retained
    // child-driver repair: PLAN §16b requires the existing retained architect
    // to publish its context-provider child and resume the same architect
    // instance after the accepted child result. This HostBridgeCapability path
    // is already proven to run inside that retained Codex support plane, so its
    // child dispatch must call the same dispatchCanonical(...,
    // {requiredDriver:'codex-app-server'}) path retained-root dispatch already
    // uses (cmdDispatch's own isRootSourceGrantContext branch, ~L11542-11552) --
    // never ordinary cmdDispatch(), which lets requester-owned claude-agent win
    // whenever a live top-level Claude MainOrchestratorBinding exists. This
    // retained host neither owns nor executes a top-level-Claude
    // activation_action, so an unconstrained child dispatch stalls unclaimed
    // even though the exact retained codex-app-server target is READY --
    // WORKER_LEASE_EXPIRED at the parent is only the later downstream symptom
    // (Codex byte audit sequence45-child-driver-byte-audit.md). requiredDriver
    // already fails closed if the retained target is genuinely unavailable, so
    // this changes no TTL, routing-policy order or driver-eligibility rule --
    // only which candidate this opaque retained-host path is allowed to select.
    const dispatched = dispatchCanonical({
      'coordination-root': checked.coordRoot,
      request: published.artifact_ref,
    }, { requiredDriver: 'codex-app-server' });
    return {
      ok: true,
      requestId: published.request_id,
      requestPath: published.artifact_ref,
      activationPath: dispatched.artifact_ref,
      selectedDriver: resolveActivationForRequestPath(published.artifact_ref).activation.selected_driver,
    };
  }

  /**
   * Observes one nested result and, for ANSWERED, accepts it under the same
   * authenticated parent-role actor that published the child.  Absence is a
   * normal polling state; malformed, foreign, stale or BLOCKED results never
   * become accepted dependencies.
   */
  function hostBridgeObserveChildResult(capability, coordRootRaw, childRequestPathRaw) {
    const scope = requireHostBridgeCapability(capability);
    const coordRoot = resolveAbsolute(coordRootRaw);
    const requestPath = resolveAbsolute(childRequestPathRaw);
    const accredited = accreditCanonicalRequest(coordRoot, requestPath);
    const reqObj = accredited.obj;
    if (
      reqObj.source_role !== scope.role
      || reqObj.requester_instance_id !== scope.actorInstanceId
      || reqObj.requester_worktree_id !== scope.worktreeId
      || reqObj.plan_digest !== scope.planDigest
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'nested child is not owned by this HostBridgeCapability');
    const txnDir = path.dirname(requestPath);
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
    const candidatePath = resultPathFor(txnDir, auth.attemptId);
    const classified = classifyDurableRead(candidatePath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
    if (classified.state === DURABLE_ABSENT || classified.state === DURABLE_PENDING) {
      return { ok: true, ready: false };
    }
    const validatedRecord = validateResultV2(candidatePath, coordRoot);
    const validated = validatedRecord.obj;
    if (validated.status === 'BLOCKED') {
      const ack = cmdTransactionAck({
        'coordination-root': coordRoot, request: requestPath, disposition: 'blocked',
      });
      const ackRecord = readDurableRecord(ack.artifact_ref);
      assertClosedShape(ackRecord.obj, ACK_V1_FIELDS);
      return {
        ok: true, ready: true, status: 'BLOCKED', reason: validated.reason,
        requestPath, requestDigest: accredited.digest,
        resultPath: candidatePath, resultDigest: validatedRecord.digest,
        acceptedPath: null, acceptedDigest: null,
        ackPath: ack.artifact_ref, ackDigest: ackRecord.digest,
      };
    }
    const accepted = cmdAcceptResult({ 'coordination-root': coordRoot, request: requestPath }, {
      actorInstanceId: scope.actorInstanceId,
      role: scope.role,
      workerSessionId: scope.workerSessionId,
      driver: 'codex-app-server',
      hostBridge: true,
    });
    // Dependency digests come from the same fd-bound durable reads that parsed
    // and validated the records.  Never reopen either pathname merely to hash
    // it: that would reintroduce a path-swap window after validation.
    const acceptedRecord = readDurableRecord(accepted.artifact_ref);
    assertClosedShape(acceptedRecord.obj, ACCEPTED_RESULT_V1_FIELDS);
    assertAcceptedResultCorrelates(acceptedRecord.obj, txnDir, reqObj, coordRoot);
    const ack = cmdTransactionAck({
      'coordination-root': coordRoot, request: requestPath, disposition: 'accepted',
    });
    const ackRecord = readDurableRecord(ack.artifact_ref);
    assertClosedShape(ackRecord.obj, ACK_V1_FIELDS);
    return {
      ok: true,
      ready: true,
      status: 'ANSWERED',
      content: validated.content,
      resultKind: validated.result_kind,
      acceptedPath: accepted.artifact_ref,
      acceptedDigest: acceptedRecord.digest,
      resultPath: candidatePath,
      resultDigest: validatedRecord.digest,
      requestPath,
      requestDigest: accredited.digest,
      ackPath: ack.artifact_ref,
      ackDigest: ackRecord.digest,
      dependency: {
        request_id: reqObj.request_id,
        accepted_result_digest: acceptedRecord.digest,
        result_digest: validatedRecord.digest,
        from_role: validated.from_role,
      },
    };
  }


  return {
    hostBridgeAllowedChildRoles,
    hostBridgePublishChildRequest,
    hostBridgeObserveChildResult
  };
}

module.exports = { createChildrenModule };
