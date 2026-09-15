'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createCancelAckTransaction(deps) {
  const {
    ACCEPTED_RESULT_V1_FIELDS,
    ACK_V1_FIELDS,
    CANCEL_REASON_ENUM,
    CliError,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    DURABLE_PRESENT,
    RESULT_V2_FIELDS,
    acceptedResultPathFor,
    accreditCanonicalRequest,
    ackPathFor,
    assertAcceptedResultCorrelates,
    assertArtifactMatchesReceipt,
    assertClosedShape,
    assertLockedScopeIdentity,
    assertRequestIdentityMatches,
    cancelPathFor,
    canonicalJSONStringify,
    classifyDurableRead,
    isPoisoned,
    isoToMs,
    listResultFiles,
    markPoisoned,
    nowIso,
    path,
    publishNoClobber,
    readCanonicalCancelRecordOptional,
    readJsonDurableOptional,
    readRequestForTxnOrCorrelationInvalid,
    requireFlags,
    resolveAbsolute,
    resolveAuthoritativeAttempt,
    resultPathFor,
    testRendezvous,
    withLock,
    writeConflictDiagnosticIfApplicable,
  } = deps;

  function cmdCancel(flags) {
    requireFlags(flags, ['coordination-root', 'request', 'reason']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    if (!CANCEL_REASON_ENUM.includes(flags.reason)) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --reason: ' + flags.reason);
    }
    // Codex NO-GO round 6/8/9: `--coordination-root`/`--request` confinement,
    // canonical filename, exact geometry, and full validateConsultV2 pipeline.
    // Codex NO-GO round 10 (empirically reproduced): accrediting ONLY before
    // acquiring the lock is a genuine TOCTOU -- block .lock, start cancel (it
    // accredits request A, then blocks in acquireLock's poll), swap
    // request.json to an equally-valid request B, release the lock: cancel
    // returns SUCCESS using stale A, and the cancel.json it wrote is
    // immediately rejected by any reader checking it against the now-current B.
    //
    // Codex NO-GO round 11 P0(1) (empirically reproduced): removing the
    // pre-lock accreditation entirely traded the TOCTOU for a WORSE bug --
    // acquireLock's own fs.mkdirSync(txnDir, {recursive:true}) unconditionally
    // creates the ENTIRE directory tree for whatever `--request` names, BEFORE
    // any confinement/geometry check ever runs. An out-of-root/garbage
    // `--request` was reproduced returning SECURITY_INVALID correctly, while
    // still leaving a created, 0755 directory tree behind on disk -- fail-CLOSED
    // in status, but not in effect.
    //
    // Codex NO-GO round 12 (both empirically reproduced): round 11's fix
    // discarded this preflight's result and let the FRESH, in-lock read simply
    // be trusted -- silently ADOPTING a mid-wait request.json mutation instead
    // of detecting and rejecting it. request.json is IMMUTABLE (PLAN.md ~L813);
    // a legitimate authority change requires takeover.json, never a rewrite of
    // this path -- exactly the principle round 11 already applied to
    // cmdAwaitResult but never carried over here. This preflight's result is
    // now KEPT as the frozen baseline: the in-lock read below must match it
    // (digest AND fd-bound dev/ino -- a byte-identical replacement changes
    // neither digest nor content, only the underlying file) or this STOPs,
    // never adopts.
    const preflight = accreditCanonicalRequest(coordRoot, requestPath);
    const txnDir = path.dirname(requestPath);
    return withLock(txnDir, coordRoot, (lockToken) => {
      // Codex NO-GO round 11: moved from before withLock to here -- a rendezvous
      // firing before withLock only proves a swap happened before the lock was
      // even entered, not that the read below genuinely happens while holding
      // it. Firing here (after acquireLock has already returned) makes that
      // unambiguous.
      testRendezvous(txnDir, 'cancel-in-lock-pre-read');
      // Codex NO-GO round 12: assertLockedScopeIdentity supersedes round 11's
      // txnDir-only check -- txnDir AND .lock must BOTH still be the exact
      // directories this token was minted for.
      assertLockedScopeIdentity(lockToken);
      const inLock = accreditCanonicalRequest(coordRoot, requestPath);
      assertRequestIdentityMatches(preflight, inLock, requestPath);
      const reqObj = inLock.obj;
      // Terminal mutual exclusion (PLAN.md ~L474/~L690): accepted-result.json and
      // cancel.json are mutually exclusive terminal records. `cmdAcceptResult` already
      // rejects when a cancel exists (symmetric check); this is the other half.
      // DUR-J: each terminal is read fd-bound-durable -- a durable one blocks as before;
      // a genuinely absent one lets the cancel proceed; an nlink==2 / symlink / malformed
      // terminal STOPs (readJsonDurableOptional throws) rather than being counted by mere
      // existsSync presence.
      //
      // HARD NO-GO (post round 17, corrected round 19): shape+durability alone
      // previously let a planted/foreign schema-valid accepted-result.json
      // permanently block this transaction. Round 18's fix used a narrower,
      // request-digest-only correlator, reasoning the fuller
      // assertAcceptedResultCorrelates would incorrectly reject a legitimate
      // cross-attempt terminal accept -- round 19 found that scenario cannot
      // occur under PLAN's own transition table (see
      // assertAcceptedResultCorrelates's own doc comment, and the removed
      // function's former doc comment left in place above as history), so this
      // now calls the SAME full correlator every other authoritative surface
      // uses.
      const existingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
      if (existingAccepted !== null) {
        assertAcceptedResultCorrelates(existingAccepted, txnDir, reqObj, coordRoot);
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
      }
      // Codex NO-GO round 8: single choke point -- see readCanonicalCancelRecordOptional's
      // own doc comment (the CANCEL-AUDIT-01 source-audit test enforces this mechanically).
      const existing = readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot);
      if (existing !== null) {
        // A second cancel (matching or different --reason) observes the SAME
        // terminal CANCELLED disposition as accept-result-after-cancel (PLAN.md
        // ~L781 rc6 rule) -- not RESULT_CONFLICT (reserved for differing RESULT
        // candidates, record #10 ~L476-484), and not a generic AUTHORITY_INVALID.
        throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
      }
      // Codex NO-GO round 6 (PLAN.md record #9, ~L480: "requester instance id,
      // or timeout-authority"): a fresh, unconnected genId() was neither -- it
      // matched no real identity at all. 'expired' is the one system/deadline-
      // driven reason with no live requester decision behind it; every other
      // reason is a requester-initiated action and must carry the ACTUAL
      // requester's own identity from the request it is cancelling, mirrored by
      // accreditCancelRecord's own read-side check.
      //
      // Codex NO-GO round 8: the bare `--reason expired` VALUE is a caller
      // claim, never proof -- a caller could declare `expired` for a request
      // whose deadline never passed. `cancelled_at` (the timestamp this write
      // is ABOUT to stamp) must itself be at or after the request's own
      // `expiry` before `timeout-authority` is accepted, mirroring exactly the
      // read-side re-proof `accreditCancelRecord` now performs on any EXISTING
      // cancel.json (same comparison, same fields, so a genuine expiry at
      // write time always survives a later re-read). `cancelledAt` is stamped
      // via `nowIso()`/`currentClockMs()` -- unlike a planted artifact, this
      // writer cannot itself claim an implausible future value.
      //
      // Codex NO-GO round 9 (PENDING_WP4): `cancelled_by` here is CORRELATION
      // (an identity already recorded in the request), never CRYPTOGRAPHIC or
      // GRANT-BASED AUTHORITY that this CALLER is entitled to invoke `cancel` at
      // all -- see `accreditCancelRecord`'s own matching doc comment for the
      // PLAN.md `role-command-grant/v1` (~L580-592) reference and why that
      // remains unimplemented and unclaimed here.
      const cancelledAt = nowIso();
      if (flags.reason === 'expired' && isoToMs(cancelledAt) < isoToMs(reqObj.expiry)) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', "--reason expired requires the request's own expiry to have genuinely passed");
      }
      const cancelledBy = flags.reason === 'expired' ? 'timeout-authority' : reqObj.requester_instance_id;
      const cancelObj = {
        schema: 'coordination/cancel/v1',
        request_id: reqObj.request_id,
        reason: flags.reason,
        cancelled_at: cancelledAt,
        cancelled_by: cancelledBy,
      };
      const cancelPath = cancelPathFor(txnDir);
      const cancelBytes = Buffer.from(canonicalJSONStringify(cancelObj), 'utf8');
      // Codex NO-GO round 11 P0(2)/round 12: re-verify immediately before
      // publish too -- the read above and this write are not atomic with each
      // other; closing the window at only one of the two ends would leave the
      // other exposed.
      assertLockedScopeIdentity(lockToken);
      const cancelReceipt = publishNoClobber(cancelPath, cancelBytes, { raceDetailCode: 'AUTHORITY_INVALID' });
      // Codex NO-GO round 12: a single pre-publish lstat does not cover the
      // write itself -- publishNoClobber's own temp-write/fsync/link/unlink
      // sequence takes real time, during which the SAME class of swap could
      // still happen. Re-verify ONE more time immediately after; if identity
      // was lost DURING the publish, we can no longer trust what was actually
      // written or where -- POISON (retain the lock) rather than release into
      // an unproven state, exactly the same principle DUR-J already applies to
      // a POST_RENAME_UNPROVEN publishReplace failure.
      testRendezvous(txnDir, 'cancel-post-publish-pre-recheck');
      try {
        assertLockedScopeIdentity(lockToken);
        assertRequestIdentityMatches(preflight, accreditCanonicalRequest(coordRoot, requestPath), requestPath);
        // Codex NO-GO round 15: round 14's own "byte-exact" check parsed
        // cancelPath, re-serialized the PARSED object, and compared digests --
        // proving only that the re-read VALUES canonicalize the same way, never
        // that the on-disk bytes or inode are what this invocation actually
        // published (a same-value-different-whitespace file, or a brand-new
        // byte-identical file at a DIFFERENT inode, both would have passed).
        // Reuse the SAME fd-bound comparator publishNoClobber trusts for its
        // own revalidation, against the receipt IT returned at publish time --
        // real bytes, real identity, no reconstruction step.
        assertArtifactMatchesReceipt(cancelPath, cancelReceipt, cancelBytes);
        // Codex NO-GO round 13: moved inside this same protected region, with
        // its OWN fresh scope re-check immediately before it -- being inside
        // the same try block does not make it atomic with the checks above;
        // a swap could still happen in the narrow window between the last
        // accreditation and this specific write.
        if (flags.reason === 'conflict') {
          assertLockedScopeIdentity(lockToken);
          writeConflictDiagnosticIfApplicable(txnDir);
        }
      } catch (err) {
        throw isPoisoned(err) ? err : markPoisoned(err);
      }
      return { request_id: reqObj.request_id, artifact_ref: cancelPath };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // `transaction-ack` (PLAN.md ~L770) -- publish exact immutable ack.json
  // ─────────────────────────────────────────────────────────────────────────────

  function findResultWithStatus(txnDir, status) {
    const resultsDir = path.join(txnDir, 'results');
    let sawPending = false;
    for (const entry of listResultFiles(txnDir)) {
      const candidatePath = path.join(resultsDir, entry);
      // DUR-J (Gap 1) + Section 8: classify each candidate EXPLICITLY. A durable,
      // shape-valid PRESENT result whose status matches is returned immediately. A
      // PRESENT non-match keeps scanning. ANY INVALID candidate -- symlink, wrong
      // owner/mode, oversize, malformed JSON, wrong RESULT_V2 shape, identity drift,
      // path rebound -- THROWS (STOP), never silently skipped. A PENDING candidate
      // (the recognized nlink==2 in-flight window) is NOT treated as absent: it is a
      // relevant candidate that could become ANY status once durable, so if the scan
      // finishes with no matching PRESENT while a PENDING was seen, we CANNOT
      // truthfully answer "no <status> result exists" -- fail closed with
      // DURABILITY_UNPROVEN. An ABSENT entry here was JUST enumerated by
      // listResultFiles above -- a subsequent ENOENT is a genuine vanish-between-
      // list-and-read, never a harmless "wasn't there" (Section 8).
      const r = classifyDurableRead(candidatePath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
      if (r.state === DURABLE_ABSENT) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'result candidate was enumerated then vanished before it could be read: ' + candidatePath);
      }
      if (r.state === DURABLE_PENDING) { sawPending = true; continue; }
      if (r.obj.status === status) return candidatePath;
    }
    if (sawPending) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'a result candidate is still in the nlink==2 in-flight window; cannot prove no ' + status + ' result exists yet');
    }
    return null;
  }

  function cmdTransactionAck(flags) {
    requireFlags(flags, ['coordination-root', 'request', 'disposition']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
    const disposition = flags.disposition;
    if (!['accepted', 'blocked'].includes(disposition)) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --disposition: ' + disposition);
    }
    if (disposition === 'blocked') {
      // Section 8: the BLOCKED disposition must acknowledge the CURRENT authoritative
      // attempt's OWN canonical result -- never any shape-valid BLOCKED result that
      // happens to exist from a superseded attempt (findResultWithStatus's free scan
      // is deliberately NOT used here).
      const canonicalResultPath = resultPathFor(txnDir, auth.attemptId);
      const r = classifyDurableRead(canonicalResultPath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
      if (r.state === DURABLE_PENDING) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'the current attempt\'s result is still in the nlink==2 in-flight window');
      }
      if (r.state !== DURABLE_PRESENT || r.obj.status !== 'BLOCKED') {
        throw new CliError('INVALID', 'RESULT_BLOCKED', 'no BLOCKED result exists for the current authoritative attempt to acknowledge');
      }
    }
    // DUR-J: the ack-accepted requirement reads the accepted-result fd-bound-durable --
    // a genuinely absent one stays CORRELATION_INVALID; an nlink==2 / symlink / foreign /
    // malformed accepted-result STOPs rather than being counted "present" by existsSync.
    // AUTH-06/07 correction (surface 2 of 2 -- await-result's DURABLE_PRESENT branch was
    // surface 1): shape+durability alone is not authority. A fabricated-but-shape-valid
    // accepted-result.json must not let a caller mint a legitimate-looking, durably
    // published ack.json. Full correlation re-check BEFORE acknowledging, reusing the
    // exact same validator await-result already requires -- one authority contract,
    // enforced identically at every surface that treats accepted-result as authoritative.
    if (disposition === 'accepted') {
      const acceptedObj = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
      if (acceptedObj === null) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'no accepted-result.json exists to acknowledge');
      }
      assertAcceptedResultCorrelates(acceptedObj, txnDir, reqObj, coordRoot);
    }
    const ackObj = {
      schema: 'coordination/ack/v1',
      disposition,
      in_reply_to_attempt_id: auth.attemptId,
      acked_at: nowIso(),
    };
    const ackPath = ackPathFor(txnDir);
    // A duplicate/racing transaction-ack for the SAME semantic decision
    // (disposition + attempt correlation) must succeed, never collide on
    // acked_at (which legitimately differs call to call) -- but any OTHER
    // attempt/disposition for an already-acked transaction still fails
    // closed. Checked both before publishing (the plain duplicate-call case)
    // and after a lost publishNoClobber race (another writer won first); no
    // other publishNoClobber failure is ever treated as success.
    const ackSemanticsMatch = (existing) => Boolean(
      existing && existing.schema === 'coordination/ack/v1'
      && existing.disposition === disposition
      && existing.in_reply_to_attempt_id === auth.attemptId,
    );
    const existingAck = readJsonDurableOptional(ackPath, { shape: (o) => assertClosedShape(o, ACK_V1_FIELDS) });
    if (existingAck !== null) {
      if (!ackSemanticsMatch(existingAck)) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a durable ack already exists for this transaction with a different disposition or attempt');
      }
      return { request_id: reqObj.request_id, artifact_ref: ackPath };
    }
    try {
      publishNoClobber(ackPath, Buffer.from(canonicalJSONStringify(ackObj), 'utf8'), { allowIdenticalIdempotent: true });
    } catch (err) {
      // Only publishNoClobber's genuine EEXIST/race-loss classification may be
      // recovered semantically.  Durability, security, I/O, and every other
      // failure remain failures even if an equal ack happens to be observable.
      if (!(err instanceof CliError) || err.status !== 'INVALID' || err.detailCode !== 'AUTHORITY_INVALID') {
        throw err;
      }
      const raced = readJsonDurableOptional(ackPath, { shape: (o) => assertClosedShape(o, ACK_V1_FIELDS) });
      if (raced !== null && ackSemanticsMatch(raced)) {
        return { request_id: reqObj.request_id, artifact_ref: ackPath };
      }
      throw err;
    }
    return { request_id: reqObj.request_id, artifact_ref: ackPath };
  }

  return { findResultWithStatus, cmdCancel, cmdTransactionAck };
}

module.exports = { createCancelAckTransaction };
