'use strict';

function createRootStatusModule(deps) {
  const {
    path, fs, CliError, HOST_BRIDGE_ID_RE, requireHostBridgeCapabilityWithLiveWorker,
    resolveAbsolute, getRuntimeRoleLifecycle, readLifecycleRecordRequired, computeRepoId,
    computeWorktreeId, gitRevParse, computeCoordRootId, isoToMs, planRootPath, requestPathFor,
    accreditCanonicalRequest, classifyDurableRead, DURABLE_ABSENT, DURABLE_PENDING,
    pendingDurableStop, cancelPathFor, classifyCanonicalCancelRecord, resolveAuthoritativeAttempt,
    resultPathFor, readClosedRecord, acceptedResultPathFor, ACCEPTED_RESULT_V1_FIELDS,
    ackPathFor, ACK_V1_FIELDS, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS, SUBJECT_BUNDLE_ENTRY_FIELDS,
    assertClosedShape, readDurableRecord, sha256Buffer, readCanonicalRequestRecord,
    validateResultV2, assertAcceptedResultCorrelates, canonicalJSONStringify,
  } = deps;

  function rootConsultIntentContext(capability, coordRootRaw, intentPathRaw) {
    const { scope, live } = requireHostBridgeCapabilityWithLiveWorker(capability);
    const coordRoot = resolveAbsolute(coordRootRaw);
    const intentPath = resolveAbsolute(intentPathRaw);
    let rll;
    try { rll = getRuntimeRoleLifecycle(); }
    catch (err) { throw new CliError('INVALID', 'INTERNAL_ERROR', 'role lifecycle module unavailable'); }
    const intentId = path.basename(intentPath, '.json');
    if (!HOST_BRIDGE_ID_RE.test(intentId) || path.resolve(intentPath) !== path.resolve(rll.rootConsultIntentPathFor(scope.projectRoot, intentId))) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'root-consult intent path is not canonical');
    }
    const intentRec = readLifecycleRecordRequired(
      rll, intentPath, rll.validateRootConsultIntentRecord,
      {
        intent_id: intentId, requester_actor_instance_id: scope.actorInstanceId,
        requester_role: scope.role, worktree_id: scope.worktreeId,
        plan_digest: scope.planDigest, coordination_root_id: computeCoordRootId(coordRoot),
      }, 'root-consult intent',
    );
    if (!intentRec) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult intent is absent');
    const intent = intentRec.obj;
    // live is the SAME proof requireHostBridgeCapabilityWithLiveWorker above
    // already obtained for this exact (scope.projectRoot, scope.role) pair,
    // moments earlier in this same synchronous call -- reused explicitly
    // rather than re-derived (see that function's own comment). The
    // bindingId/sessionGenerationId checks below are genuinely new (this
    // intent's own recorded actor), never covered by the capability's own
    // generic liveness proof.
    if (
      !live || live.ok !== true || live.available !== true || !live.worker
      || live.worker.bindingId !== intent.requester_binding_id
      || live.worker.sessionGenerationId !== intent.session_generation_id
      || live.worker.workerSessionId !== scope.workerSessionId
    ) return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: 'source-actor-retired' };
    // NO-GO Correction A (PLAN.md §16a line 53): intent.expiry (<=30s) gates
    // ONLY whether the source's WAL may still RESERVE this intent -- once
    // reserved, continued work (publish/dispatch/observe/complete) is bound
    // to intent.request_expiry (up to 3600s) instead, never re-blocked by the
    // activation window it already cleared. A raw existence check (not a full
    // validated read) is deliberate: this is a boolean "did activation
    // succeed" gate, not a trust decision -- hostBridgeAdvanceRootConsult
    // below fully re-reads and validates the reservation record itself before
    // relying on its content.
    const reservationPath = rll.rootConsultReservationPathFor(scope.projectRoot, intentId);
    const reservationExists = fs.existsSync(reservationPath);
    if (!reservationExists) {
      if (isoToMs(intent.expiry) <= Date.now()) {
        return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: 'intent-expired' };
      }
    } else if (isoToMs(intent.request_expiry) <= Date.now()) {
      return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: 'request-expired' };
    }
    return { scope, coordRoot, intentPath, intentId, intentRec, intent, rll, blocked: null };
  }

  function requestInputForRootIntent(context) {
    const i = context.intent;
    // ROOT-INGRESS-E2E finding: subject_bundle_ref is coordination-root-RELATIVE
    // (s16CoordinationRelativeRef's own output, same shape as root-source's
    // subject_bundle_ref -- see enforceRootSourceGrantBoundary's identical fix).
    // resolveAbsolute() alone resolves it against this long-running retained
    // worker's own process.cwd(), never the intent's own coordRoot -- proven by
    // a live retained worker crashing (APP_SERVER_POLL_FAILED, artifact not
    // found under the repo checkout root) the moment it tried to advance a
    // genuine root-consult intent.
    const manifestRec = readDurableRecord(path.join(context.coordRoot, i.subject_bundle_ref));
    const manifest = manifestRec.obj;
    assertClosedShape(manifest, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
    for (const entry of manifest.entries) assertClosedShape(entry, SUBJECT_BUNDLE_ENTRY_FIELDS);
    if (sha256Buffer(Buffer.from(canonicalJSONStringify(manifest), 'utf8')) !== i.subject_scope_digest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-consult subject manifest digest mismatch');
    }
    const plan = context.rll.discoverPlan(context.scope.projectRoot);
    if (!plan.ok || plan.planDigest !== i.plan_digest) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult PLAN is not current');
    }
    return {
      coordinationRoot: context.coordRoot,
      planPath: plan.planPath,
      subjectBundleManifest: manifest,
      requestId: i.request_id,
      initialAttemptId: i.initial_attempt_id,
      createdAt: i.request_created_at,
      expiry: i.request_expiry,
      parentRequestId: null,
      targetRole: i.target_role,
      targetRoleProfileVersion: i.target_role_profile_version,
      targetRoleProfileDigest: i.target_role_profile_digest,
      question: i.question,
      expectedResultKind: i.expected_result_kind,
      routingPolicyVersion: i.routing_policy_version,
      routingPolicyDigest: i.routing_policy_digest,
    };
  }

  function assertBuiltRootRequestMatchesIntent(built, intent, scope) {
    const r = built.request;
    const expected = {
      request_id: intent.request_id,
      root_request_id: intent.request_id,
      parent_request_id: null,
      depth: 0,
      source_role: scope.role,
      requester_instance_id: scope.actorInstanceId,
      requester_worktree_id: intent.worktree_id,
      repo_id: intent.repo_id,
      coordination_root_id: intent.coordination_root_id,
      plan_digest: intent.plan_digest,
      target_role: intent.target_role,
      target_role_profile_version: intent.target_role_profile_version,
      target_role_profile_digest: intent.target_role_profile_digest,
      subject_repo_id: intent.subject_repo_id,
      subject_worktree_id: intent.subject_worktree_id,
      subject_head: intent.subject_head,
      subject_scope_digest: intent.subject_scope_digest,
      routing_policy_version: intent.routing_policy_version,
      routing_policy_digest: intent.routing_policy_digest,
      created_at: intent.request_created_at,
      expiry: intent.request_expiry,
      initial_attempt_id: intent.initial_attempt_id,
      question: intent.question,
      expected_result_kind: intent.expected_result_kind,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (r[key] !== value) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-consult request field diverges from immutable intent: ' + key);
      }
    }
  }

  function rootConsultOperationResult(status, context, values) {
    return Object.assign({
      ok: true, status, intent: context.intent,
      intentPath: context.intentPath, intentId: context.intentId,
    }, values || {});
  }

  function canonicalRequestPathForRootIntent(c) {
    const plan = c.rll.discoverPlan(c.scope.projectRoot);
    if (!plan.ok || plan.planDigest !== c.intent.plan_digest) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'root-consult PLAN is not current');
    }
    const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
    return requestPathFor(
      planRootPath(c.coordRoot, c.intent.repo_id, waveSlug, c.intent.plan_digest),
      c.intent.request_id,
    );
  }

  /**
   * Read-only lifecycle-facing projection for the one root terminal state that
   * deliberately has no completion record: BLOCKED result + blocked ack.  It
   * reuses consultation's canonical request/result/ack schemas so lifecycle
   * never grows a second, weaker transaction parser.
   */
  function readRootConsultTerminalStatus(projectRootRaw, intentInput) {
    try {
      const projectRoot = gitRevParse(resolveAbsolute(projectRootRaw), ['rev-parse', '--show-toplevel']);
      let rll;
      try { rll = getRuntimeRoleLifecycle(); }
      catch (err) { return { ok: false, reason: 'role-lifecycle-unavailable' }; }
      const initial = rll.validateRootConsultIntentRecord(intentInput);
      if (!initial || initial.ok !== true) return { ok: false, reason: 'root-consult-intent-invalid' };
      const intent = initial.record;
      const found = rll.findRootConsultIntentByRequestId({ repoId: intent.repo_id }, intent.request_id);
      if (!found || found.ok !== true || found.absent === true || !found.intent) {
        return { ok: false, reason: (found && found.reason) || 'root-consult-intent-not-current' };
      }
      if (canonicalJSONStringify(found.intent) !== canonicalJSONStringify(intent)) {
        return { ok: false, reason: 'root-consult-intent-input-mismatch' };
      }
      const plan = rll.discoverPlan(projectRoot);
      const coordRoot = rll.coordinationRootPathFor(projectRoot);
      if (
        !plan.ok || plan.planDigest !== intent.plan_digest
        || computeRepoId(projectRoot) !== intent.repo_id
        || computeWorktreeId(projectRoot) !== intent.worktree_id
        || computeCoordRootId(coordRoot) !== intent.coordination_root_id
      ) return { ok: false, reason: 'root-consult-project-scope-mismatch' };
      const waveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
      const planRoot = planRootPath(coordRoot, intent.repo_id, waveSlug, intent.plan_digest);
      const requestPath = requestPathFor(planRoot, intent.request_id);
      const requestState = classifyDurableRead(requestPath, { parse: true });
      if (requestState.state === DURABLE_ABSENT) return { ok: true, state: 'WAITING' };
      if (requestState.state === DURABLE_PENDING) return { ok: false, reason: 'root-consult-request-pending-durability' };
      const requestRec = accreditCanonicalRequest(coordRoot, requestPath);
      assertBuiltRootRequestMatchesIntent(
        { request: requestRec.obj }, intent,
        { role: intent.requester_role, actorInstanceId: intent.requester_actor_instance_id },
      );
      const txnDir = path.dirname(requestPath);
      const auth = resolveAuthoritativeAttempt(requestRec.obj, txnDir);
      const candidatePath = resultPathFor(txnDir, auth.attemptId);
      const resultState = classifyDurableRead(candidatePath, { parse: true });
      if (resultState.state === DURABLE_ABSENT) return { ok: true, state: 'WAITING' };
      if (resultState.state === DURABLE_PENDING) return { ok: false, reason: 'root-consult-result-pending-durability' };
      const resultRec = validateResultV2(candidatePath, coordRoot);
      if (resultRec.obj.status !== 'BLOCKED') return { ok: true, state: 'WAITING' };
      const acceptedState = classifyDurableRead(acceptedResultPathFor(txnDir), { parse: true });
      if (acceptedState.state !== DURABLE_ABSENT) {
        return { ok: false, reason: acceptedState.state === DURABLE_PENDING
          ? 'root-consult-accepted-result-pending-durability'
          : 'root-consult-blocked-has-accepted-result' };
      }
      const ackPath = ackPathFor(txnDir);
      const ackState = classifyDurableRead(ackPath, { parse: true });
      if (ackState.state === DURABLE_ABSENT) return { ok: true, state: 'WAITING' };
      if (ackState.state === DURABLE_PENDING) return { ok: false, reason: 'root-consult-ack-pending-durability' };
      assertClosedShape(ackState.obj, ACK_V1_FIELDS);
      if (
        ackState.obj.disposition !== 'blocked'
        || ackState.obj.in_reply_to_attempt_id !== auth.attemptId
      ) return { ok: false, reason: 'root-consult-blocked-ack-mismatch' };
      const ackDigest = sha256Buffer(ackState.bytes);
      return {
        ok: true,
        state: 'BLOCKED',
        request_ref: path.posix.join('transactions', intent.request_id, 'request.json'),
        request_digest: requestRec.digest,
        result_ref: path.posix.join('transactions', intent.request_id, 'results', auth.attemptId + '.json'),
        result_digest: resultRec.digest,
        ack_ref: path.posix.join('transactions', intent.request_id, 'ack.json'),
        ack_digest: ackDigest,
      };
    } catch (err) {
      return {
        ok: false,
        reason: (err && (err.detailCode || err.message)) || 'root-consult-terminal-status-failed',
      };
    }
  }

  /**
   * NO-GO Correction C, M7 section 9 update: the ONE canonical read-only
   * helper for a root-source operation's terminal artifacts -- and now the
   * SOLE classifier of which terminal (acked, cancelled, or neither yet)
   * governs, since M7 removes the retirement record that used to tell the
   * caller which reason to pass. Reopens/accredits request, authoritative
   * result, accepted-result (acked only) and ack-or-cancel through the SAME
   * fd-bound primitives production already trusts for ordinary consultation
   * (never a second, weaker parser -- mirrors readRootConsultTerminalStatus/
   * validateRootConsultCompletionArtifacts's established root-consult
   * pattern), and recomputes every digest fresh from disk before emission
   * (PLAN.md line 226: "any non-null digest is recomputed from fd-bound
   * bytes"). Returns null when neither ack.json nor cancel.json is durably
   * present yet -- an ordinary WAITING case, not an error.
   *
   * M6+M7 SIXTEENTH CODEX ACCEPTANCE Correction C: 'acked' still requires an
   * authoritative result (an ack can only ever follow one); 'cancelled' does
   * NOT -- a cancellation raised before any result ever landed is the common
   * case, not an error, and must reach BLOCKED/NONE with result_ref/digest
   * genuinely null rather than throwing (this function's own caller,
   * handleRootSourceStatus, previously observed that throw as an opaque
   * DURABILITY_UNPROVEN, indistinguishable from real corruption). ack.json and
   * cancel.json are mutually exclusive terminal markers for the SAME request
   * (each is written no-clobber, by disjoint code paths gated on opposite
   * terminal outcomes) -- both durably present at once is fail-closed here,
   * never silently resolved by trusting whichever one happens to be read first.
   */
  function readRootSourceTerminalArtifacts(coordRoot, planRoot, requestId) {
    const requestPath = requestPathFor(planRoot, requestId);
    const requestRec = readCanonicalRequestRecord(requestPath, requestId, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'root-source request is absent',
    });
    const txnDir = path.dirname(requestPath);
    const auth = resolveAuthoritativeAttempt(requestRec.obj, txnDir);
    const resultPath = resultPathFor(txnDir, auth.attemptId);

    const ackPath = ackPathFor(txnDir);
    const cancelPath = cancelPathFor(txnDir);
    // M7 CORRECTION C3 (Codex final ruling): a single SHAPE-FREE presence read
    // of each path decides mutual-exclusion FIRST (S16-RSTA-MUTUAL-EXCLUSION-01:
    // two contradictory terminal markers is a fail-closed condition in its own
    // right, and must win over -- never be masked by -- a shape problem in
    // either individual file). Shape/correlation validation for whichever ONE
    // terminal actually applies happens further below, from THIS SAME already
    // -read ack bytes/obj (never a second, independent reopen); the cancel
    // side stays routed through its own sanctioned choke-point reader
    // (CANCEL-AUDIT-01/02 restrict CANCEL_V1_FIELDS/accreditCancelRecord to
    // their three existing entry points, so a shape-free-then-validate split
    // is not achievable there without a fourth, unsanctioned call site).
    const ackClassified = classifyDurableRead(ackPath, { parse: true });
    if (ackClassified.state === DURABLE_PENDING) throw pendingDurableStop(ackPath);
    // M7 GREEN correction round 2, R3: ONE fd-bound read of cancel.json, via
    // the SAME sanctioned CANCEL-AUDIT-01 choke point classifyCanonicalCancelRecord
    // already uses elsewhere -- never a shape-free presence probe followed by
    // a second, independent reopen purely to obtain shape/correlation/digest.
    // Every value used below (state, obj, reqObj, bytes, digest) comes from
    // THIS SAME read.
    const cancelClassified = classifyCanonicalCancelRecord(cancelPath, coordRoot);
    if (cancelClassified.state === DURABLE_PENDING) throw pendingDurableStop(cancelPath);
    if (ackClassified.state !== DURABLE_ABSENT && cancelClassified.state !== DURABLE_ABSENT) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'root-source request has both ack and cancel terminal markers');
    }
    // M7 section 9: the sole fd-bound classifier/reader -- derives the exact
    // terminalState from that SAME pair of reads, never a caller-supplied
    // reason. Neither durably present yet is OPEN, a real, ordinary case
    // (WAITING at the handler), not an error.
    const terminalState = ackClassified.state !== DURABLE_ABSENT ? 'ACKED' : (cancelClassified.state !== DURABLE_ABSENT ? 'CANCELLED' : 'OPEN');

    // Result: required once ACKED (an acked request must have an authoritative
    // result); otherwise included, validated, whenever already durable --
    // OPEN validates any result already present (a genuine window exists
    // between publish-result and transaction-ack/cancel). CANCELLED also
    // reports a result if one happens to already exist (section 9: "ingress +
    // valid cancel -> ... with request/result-if-present/cancel refs").
    let resultRef = null;
    let resultDigest = null;
    const resultState = classifyDurableRead(resultPath, { parse: true });
    if (resultState.state === DURABLE_PENDING) throw pendingDurableStop(resultPath);
    if (resultState.state !== DURABLE_ABSENT) {
      const resultRec = validateResultV2(resultPath, coordRoot);
      resultRef = path.posix.join('transactions', requestId, 'results', auth.attemptId + '.json');
      resultDigest = resultRec.digest;
    } else if (terminalState === 'ACKED') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source acked request has no authoritative result');
    }

    // Accepted-result: required once ACKED; for OPEN, included/validated only
    // when already durable (the real accept-result-before-transaction-ack
    // window) -- never for CANCELLED, which section 9's own table never lists
    // it for.
    let acceptedResultRef = null;
    let acceptedResultDigest = null;
    if (terminalState !== 'CANCELLED') {
      const acceptedPath = acceptedResultPathFor(txnDir);
      const acceptedState = classifyDurableRead(acceptedPath, { parse: true });
      if (acceptedState.state === DURABLE_PENDING) throw pendingDurableStop(acceptedPath);
      if (acceptedState.state !== DURABLE_ABSENT) {
        const acceptedRec = readClosedRecord(acceptedPath, ACCEPTED_RESULT_V1_FIELDS, {
          absentDetail: 'CORRELATION_INVALID', absentMessage: 'root-source accepted-result is absent',
        });
        assertAcceptedResultCorrelates(acceptedRec.obj, txnDir, requestRec.obj, coordRoot);
        acceptedResultRef = path.posix.join('transactions', requestId, 'accepted-result.json');
        acceptedResultDigest = acceptedRec.digest;
      } else if (terminalState === 'ACKED') {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source accepted-result is absent');
      }
    }

    // M7 GREEN section 4.7: ackRef/ackDigest and cancelRef/cancelDigest are
    // GENUINELY SEPARATE fields -- ACKED populates only ack*, CANCELLED
    // populates only cancel* (never reusing the ack* pair for a cancel.json
    // ref/digest as before), OPEN leaves all four null.
    let ackRef = null;
    let ackDigest = null;
    let cancelRef = null;
    let cancelDigest = null;
    if (terminalState === 'ACKED') {
      // M7 CORRECTION C3: shape+correlation validated from the SAME
      // ackClassified bytes/obj the presence/terminalState decision above
      // already read -- never a second, independent reopen.
      assertClosedShape(ackClassified.obj, ACK_V1_FIELDS);
      if (ackClassified.obj.disposition !== 'accepted' || ackClassified.obj.in_reply_to_attempt_id !== auth.attemptId) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source ack does not correlate to the authoritative attempt');
      }
      ackRef = path.posix.join('transactions', requestId, 'ack.json');
      ackDigest = sha256Buffer(ackClassified.bytes);
    } else if (terminalState === 'CANCELLED') {
      // M7 GREEN correction round 2, R3: shape+correlation already fully
      // validated by classifyCanonicalCancelRecord's own accreditCancelRecord
      // call above (the SAME fd-bound read the presence/terminalState
      // decision used) -- never a second, independent reopen.
      if (cancelClassified.reqObj.request_id !== requestId) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'root-source cancel does not correlate to this request');
      }
      cancelRef = path.posix.join('transactions', requestId, 'cancel.json');
      cancelDigest = cancelClassified.digest;
    }

    return {
      terminalState,
      requestRef: path.posix.join('transactions', requestId, 'request.json'), requestDigest: requestRec.digest,
      resultRef, resultDigest,
      acceptedResultRef, acceptedResultDigest,
      ackRef, ackDigest,
      cancelRef, cancelDigest,
    };
  }

  function validateRootConsultCompletionArtifacts(c, completionRec) {
    const completion = completionRec.obj;
    const requestPath = canonicalRequestPathForRootIntent(c);
    const requestRec = readCanonicalRequestRecord(requestPath, c.intent.request_id, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'completed root request is absent',
    });
    if (requestRec.digest !== completion.request_digest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion request digest mismatch');
    }
    const txnDir = path.dirname(requestPath);
    const expectedResultPath = resultPathFor(txnDir, c.intent.initial_attempt_id);
    const expectedResultRef = path.posix.join('transactions', c.intent.request_id, 'results', c.intent.initial_attempt_id + '.json');
    if (completion.result_ref !== expectedResultRef) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion result ref is not canonical');
    }
    const resultRec = validateResultV2(expectedResultPath, c.coordRoot);
    if (resultRec.digest !== completion.result_digest || resultRec.obj.status !== 'ANSWERED') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion result is not the accepted answer');
    }
    const acceptedPath = acceptedResultPathFor(txnDir);
    const acceptedRef = path.posix.join('transactions', c.intent.request_id, 'accepted-result.json');
    if (completion.accepted_result_ref !== acceptedRef) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion accepted-result ref is not canonical');
    }
    const acceptedRec = readClosedRecord(acceptedPath, ACCEPTED_RESULT_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'root completion accepted-result is absent',
    });
    assertAcceptedResultCorrelates(acceptedRec.obj, txnDir, requestRec.obj, c.coordRoot);
    if (acceptedRec.digest !== completion.accepted_result_digest) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion accepted-result digest mismatch');
    }
    const ackPath = ackPathFor(txnDir);
    const ackRef = path.posix.join('transactions', c.intent.request_id, 'ack.json');
    if (completion.ack_ref !== ackRef) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion ack ref is not canonical');
    }
    const ackRec = readClosedRecord(ackPath, ACK_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'root completion ack is absent',
    });
    if (
      ackRec.digest !== completion.ack_digest || ackRec.obj.disposition !== 'accepted'
      || ackRec.obj.in_reply_to_attempt_id !== resultRec.obj.attempt_id
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'root completion ack does not correlate');
    return {
      requestPath, requestDigest: requestRec.digest,
      resultPath: expectedResultPath, resultDigest: resultRec.digest,
      acceptedPath, acceptedDigest: acceptedRec.digest,
      ackPath, ackDigest: ackRec.digest,
      completionPath: completionRec.path, completionDigest: completionRec.digest,
      item: {
        ok: true,
        ready: true,
        status: 'ANSWERED',
        content: resultRec.obj.content,
        resultKind: resultRec.obj.result_kind,
        acceptedPath,
        acceptedDigest: acceptedRec.digest,
        resultPath: expectedResultPath,
        resultDigest: resultRec.digest,
        requestPath,
        requestDigest: requestRec.digest,
        ackPath,
        ackDigest: ackRec.digest,
        dependency: {
          request_id: requestRec.obj.request_id,
          accepted_result_digest: acceptedRec.digest,
          result_digest: resultRec.digest,
          from_role: resultRec.obj.from_role,
        },
      },
    };
  }

  function readExistingRootConsultCompletion(c) {
    const completionPath = c.rll.rootConsultCompletionPathFor(c.scope.projectRoot, c.intentId);
    const rec = readLifecycleRecordRequired(
      c.rll, completionPath, c.rll.validateRootConsultCompletionRecord,
      {
        intent_id: c.intentId, request_id: c.intent.request_id,
        requester_actor_instance_id: c.scope.actorInstanceId,
      }, 'root-consult completion',
    );
    if (!rec) return null;
    return Object.assign({ rec }, validateRootConsultCompletionArtifacts(c, rec));
  }

  /** Crash-resumable reserved -> request -> published -> required dispatch WAL. */

  return {
    rootConsultIntentContext,
    requestInputForRootIntent,
    assertBuiltRootRequestMatchesIntent,
    rootConsultOperationResult,
    canonicalRequestPathForRootIntent,
    readRootConsultTerminalStatus,
    readRootSourceTerminalArtifacts,
    readExistingRootConsultCompletion
  };
}

module.exports = { createRootStatusModule };
