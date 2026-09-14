'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createAcceptCleanupTransaction(deps) {
  const {
    ACCEPTED_RESULT_V1_FIELDS,
    CliError,
    acceptedResultPathFor,
    accreditCanonicalRequest,
    assertAcceptedResultCorrelates,
    assertArtifactMatchesReceipt,
    assertClosedShape,
    assertLockedScopeIdentity,
    assertRequestIdentityMatches,
    cancelPathFor,
    canonicalJSONStringify,
    computeSubjectHead,
    isPoisoned,
    listResultFiles,
    markPoisoned,
    nowIso,
    path,
    publishNoClobber,
    readCanonicalCancelRecordOptional,
    readCanonicalRequestRecord,
    readJsonDurableOptional,
    reconcileTempArtifacts,
    requireFlags,
    resolveAbsolute,
    testRendezvous,
    validateResultV2,
    withLock,
  } = deps;


  // ─────────────────────────────────────────────────────────────────────────────
  // `accept-result` (PLAN.md ~L769) -- under lock, requester-only accepted-result.json
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * M6+M7 requester-authority closure (Group C): the actor holding the
   * consumed requester grant must be the SAME actor that originally published
   * this transaction's request.json -- checked independently at each mutation
   * boundary (never trusted from a single earlier read), mirroring this file's
   * own established re-verify-under-lock/re-verify-before-publish TOCTOU
   * discipline for request identity elsewhere.
   */
  function assertRequesterActorMatchesRequest(grantContext, reqObj) {
    if (!grantContext || typeof grantContext.actorInstanceId !== 'string' || grantContext.actorInstanceId.length === 0) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'requires an authenticated requester grant/binding');
    }
    if (grantContext.actorInstanceId !== reqObj.requester_instance_id) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'requester grant does not match the actor that published this request');
    }
  }

  function cmdAcceptResult(flags, grantContext) {
    requireFlags(flags, ['coordination-root', 'request']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    // Codex NO-GO round 8/9: confinement, canonical filename, exact geometry,
    // full validateConsultV2 pipeline. Codex NO-GO round 10 (same empirically-
    // reproduced TOCTOU as cmdCancel): accrediting ONLY before the lock lets a
    // request.json swap during the lock-acquisition wait go unnoticed.
    //
    // Codex NO-GO round 11 P0(1) (same empirically-reproduced mkdir-before-
    // validate gap as cmdCancel): a preliminary accreditation runs here, before
    // the lock, so acquireLock's own recursive mkdir never runs for an
    // invalid/out-of-root --request in the first place.
    //
    // Codex NO-GO round 12 (same bug as cmdCancel -- see its own matching
    // comment for the full reproduction): round 11 discarded this preflight and
    // let the fresh in-lock read be trusted outright, silently ADOPTING a
    // mid-wait mutation instead of rejecting it. request.json is IMMUTABLE
    // (PLAN.md ~L813) -- this preflight's result is now KEPT as the frozen
    // baseline every later read (digest AND fd-bound dev/ino) must match, or
    // this STOPs, never adopts.
    const preflight = accreditCanonicalRequest(coordRoot, requestPath);
    const txnDir = path.dirname(requestPath);
    return withLock(txnDir, coordRoot, (lockToken) => {
      // Codex NO-GO round 11: moved from before withLock -- see cmdCancel's
      // matching comment for why firing here (genuinely inside the lock) is the
      // only placement that unambiguously proves what this rendezvous claims to.
      testRendezvous(txnDir, 'accept-result-in-lock-pre-read');
      // Codex NO-GO round 12: assertLockedScopeIdentity supersedes round 11's
      // txnDir-only check -- txnDir AND .lock must BOTH still be the exact
      // directories this token was minted for.
      assertLockedScopeIdentity(lockToken);
      const reqRec = accreditCanonicalRequest(coordRoot, requestPath);
      assertRequestIdentityMatches(preflight, reqRec, requestPath);
      const reqObj = reqRec.obj;
      // M6+M7 requester-authority closure (Group C): before any mutation, the
      // authenticated grant's own actor must be the same actor that opened
      // this transaction.
      assertRequesterActorMatchesRequest(grantContext, reqObj);
      // DUR-J: terminal mutual exclusion reads each terminal fd-bound-durable -- a durable
      // accepted-result/cancel blocks as before; a genuinely absent one lets accept
      // proceed; an nlink==2 / symlink / malformed terminal STOPs rather than being
      // counted by mere existsSync presence.
      //
      // HARD NO-GO (post round 17, corrected round 19): see cmdCancel's
      // matching call for the full rationale -- this now uses the SAME full
      // correlator (assertAcceptedResultCorrelates), not the reversed,
      // narrower assertAcceptedResultTiedToTransaction.
      const existingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
      if (existingAccepted !== null) {
        assertAcceptedResultCorrelates(existingAccepted, txnDir, reqObj, coordRoot);
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
      }
      // Codex NO-GO round 8: single choke point -- see readCanonicalCancelRecordOptional's
      // own doc comment (the CANCEL-AUDIT-01 source-audit test enforces this mechanically).
      const existingCancel = readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot);
      if (existingCancel !== null) {
        // CLI-RESULT-07: a terminal cancelled outcome maps to the frozen CANCELLED/rc6
        // status (PLAN.md ~L781: "rc6-> the observed terminal BLOCKED|CANCELLED|CONFLICT"),
        // not INVALID/rc3 -- detail_code stays TRANSACTION_CANCELLED.
        throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
      }
      const entries = listResultFiles(txnDir);
      if (entries.length === 0) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'no candidate result exists yet');
      }
      const candidatePath = path.join(txnDir, 'results', entries[0]);
      // Full shape/correlation/authority/durability pipeline -- propagates the exact
      // detail_code a direct `validate --kind result-v2` would produce (RESULT-TO-02
      // pins AUTHORITY_INVALID here specifically for a superseded-attempt candidate).
      const { obj: resultObj, digest: resultDigest } = validateResultV2(candidatePath, coordRoot);

      // SC-10 (PLAN.md ~L647/~L1711): the full subject_scope_digest re-scan (fresh
      // git-scope-scan of tracked/modified/untracked/deleted/renamed entries) is
      // WP2/WP3 -- not built here. This WP1-realizable subset recomputes and compares
      // subject_head only, catching the case where the subject worktree has moved to a
      // new commit between request and accept.
      const currentSubjectHead = computeSubjectHead(coordRoot);
      if (currentSubjectHead !== reqObj.subject_head) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'subject HEAD changed between request and accept');
      }

      if (resultObj.status !== 'ANSWERED') {
        // Finding #1 (arch-platform-wp2-cli-mapping-cross-verify.md): a protocol-valid
        // BLOCKED candidate is a terminal state (PLAN.md ~L781 rc6 rule), the same
        // latent gap as Q1's CANCELLED case in this same function -- not INVALID/rc3.
        // detail_code stays RESULT_BLOCKED.
        throw new CliError('BLOCKED', 'RESULT_BLOCKED', 'candidate result is not ANSWERED (never accepted as an answer)');
      }

      const acceptedObj = {
        schema: 'coordination/accepted-result/v1',
        request_digest: reqRec.digest,
        candidate_result_path: 'results/' + path.basename(candidatePath),
        result_digest: resultDigest,
        accepted_attempt_id: resultObj.attempt_id,
        accepted_lease_epoch: resultObj.lease_epoch,
        routing_policy_digest: reqObj.routing_policy_digest,
        requester_instance_id: grantContext.actorInstanceId,
        accepted_at: nowIso(),
        schema_version: 1,
      };
      const acceptedPath = acceptedResultPathFor(txnDir);
      const acceptedBytes = Buffer.from(canonicalJSONStringify(acceptedObj), 'utf8');
      // Codex NO-GO round 11 P0(2)/round 12: re-verify immediately before
      // publish too -- the reads above and this write are not atomic with each
      // other.
      assertLockedScopeIdentity(lockToken);
      // M6+M7 requester-authority closure (Group C): re-verified again at this
      // exact transaction-authority (write) boundary -- never solely relying
      // on the earlier check.
      assertRequesterActorMatchesRequest(grantContext, reqObj);
      // A double-accept no-clobber race lost here is a RACE (another accept won
      // first), not a cancellation -- matches cmdClaim's own claim-race labeling
      // (AUTHORITY_INVALID), not the unrelated TRANSACTION_CANCELLED detail code.
      const acceptedReceipt = publishNoClobber(acceptedPath, acceptedBytes, { raceDetailCode: 'AUTHORITY_INVALID' });
      // Codex NO-GO round 12: re-verify ONE more time immediately after --
      // publishNoClobber's own multi-step sequence takes real time, during
      // which the same class of swap could still happen. A mismatch here means
      // we can no longer trust what was actually written or where -- POISON
      // rather than release into an unproven state.
      testRendezvous(txnDir, 'accept-result-post-publish-pre-recheck');
      try {
        assertLockedScopeIdentity(lockToken);
        const postReqRec = accreditCanonicalRequest(coordRoot, requestPath);
        assertRequestIdentityMatches(preflight, postReqRec, requestPath);
        // Codex NO-GO round 15: round 13/14's own checks (assertAcceptedResultCorrelates
        // plus a reserialize-then-hash digest compare) proved the re-read record
        // correlates and canonicalizes to the same VALUE -- never that the on-disk
        // bytes or inode are what this invocation actually published. Reuse the
        // SAME fd-bound comparator publishNoClobber trusts for its own
        // revalidation, against the receipt IT returned at publish time.
        assertArtifactMatchesReceipt(acceptedPath, acceptedReceipt, acceptedBytes);
      } catch (err) {
        throw isPoisoned(err) ? err : markPoisoned(err);
      }
      return { request_id: reqObj.request_id, artifact_ref: acceptedPath };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // `cleanup` (PLAN.md ~L774) -- remove only eligible non-terminal scratch
  // ─────────────────────────────────────────────────────────────────────────────

  function cmdCleanup(flags) {
    requireFlags(flags, ['coordination-root', 'request']);
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    // Reconciles leftover no-clobber/refresh temp siblings only -- terminal records
    // (accepted-result.json, cancel.json, ack.json, takeover.json) and any current
    // candidate never match the temp naming pattern, so they are never at risk
    // (`TERMINAL-NO-DELETE-01`).
    //
    // Codex P1-3: reconcileTempArtifacts now returns an explicit {ok, results} outcome
    // per subdirectory -- ambiguity, drift, or a failed recovery step in ANY of them
    // means this cleanup pass could NOT fully account for the directory, and must
    // propagate DURABILITY_UNPROVEN rather than always reporting SUCCESS regardless of
    // what reconciliation actually found.
    let anyReconcileFailure = false;
    for (const sub of ['results', 'claims', 'active-leases', 'delivery']) {
      const outcome = reconcileTempArtifacts(path.join(txnDir, sub));
      if (!outcome.ok) anyReconcileFailure = true;
    }
    if (anyReconcileFailure) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'cleanup could not accredit every no-clobber temp sibling as genuinely not-ours or safely reconciled (a genuine stray/crash-cut pair identified but not auto-deleted, ambiguity, drift, or an anomalous I/O error)');
    }
    // DUR-J: the request_id here is a DISPLAY value for cleanup's response envelope, not
    // an authority decision -- the reconcile work above already ran and this can never
    // change that outcome. Codex NO-GO round 4: previously read via `readJsonDurableOptional`
    // (durability + parse only) -- a request.json stored at THIS transaction's own path
    // but internally embedding a DIFFERENT request_id (the same confused-deputy shape as
    // the round-3 blocker 1 finding) would have been echoed back verbatim, a non-
    // authoritative id in cleanup's own response. Reuses the SAME canonical
    // durability+shape+identity validation every other authoritative reader uses; on ANY
    // failure (absent, non-durable, or malformed) the response simply omits the id (`null`)
    // rather than displaying an unearned one -- reconciliation semantics above are
    // completely unaffected either way.
    //
    // M6+M7 requester-authority closure (Group B): the exact confused-deputy shape this
    // comment originally targeted (a request.json whose content contradicts its own
    // canonical path) can no longer reach this code at all in practice -- cleanup is a
    // transactional requester operation under PLAN §15b's own accreditation requirement
    // like every other transactional command, so grant-scope resolution
    // (resolveRequesterGrantScope -> accreditCanonicalRequest, which independently runs
    // this SAME readCanonicalRequestRecord content/path identity check) now rejects that
    // exact request.json with SECURITY_INVALID before cmdCleanup's own handler --
    // including this display-fallback -- is ever invoked. The identity check right below
    // is kept as genuine defense-in-depth, never assumed redundant/removed just because
    // an earlier gate now also catches this one shape; it remains the live, load-bearing
    // check for the OTHER, still-reachable untrustworthy-but-not-confused-deputy failure
    // modes this fallback was always meant to cover (absent, non-durable, malformed).
    let requestId = null;
    try {
      const rec = readCanonicalRequestRecord(requestPath, path.basename(txnDir), {});
      requestId = rec.obj.request_id;
    } catch (err) { /* best effort -- display only */ }
    return { request_id: requestId, artifact_ref: txnDir };
  }

  return { cmdAcceptResult, cmdCleanup };
}

module.exports = { createAcceptCleanupTransaction };
