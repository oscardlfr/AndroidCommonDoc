'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createTakeoverTransaction(deps) {
  const {
    ACTIVE_LEASE_V1_FIELDS,
    CLAIM_V1_FIELDS,
    CliError,
    DELIVERY_V1_FIELDS,
    RESULT_V2_FIELDS,
    accreditCanonicalRequest,
    activeLeasePathFor,
    assertArtifactMatchesReceipt,
    assertClosedShape,
    assertLockedScopeIdentity,
    assertRequestIdentityMatches,
    canonicalJSONStringify,
    claimPathFor,
    deliveryPathFor,
    genId,
    isPoisoned,
    isoPlusSeconds,
    isoToMs,
    markPoisoned,
    minIso,
    nowIso,
    path,
    publishNoClobber,
    readClosedRecordOptional,
    readJsonDurableOptional,
    requireFlags,
    resolveAbsolute,
    resultPathFor,
    takeoverPathFor,
    testRendezvous,
    withLock,
  } = deps;


  // ─────────────────────────────────────────────────────────────────────────────
  // `takeover` eligibility (PLAN.md ~L700-704, ~L821, Takeover Eligibility ~L765-833)
  // ─────────────────────────────────────────────────────────────────────────────

  const ACTIVATION_LIVENESS_WINDOW_S = 300;
  const REQUEST_EXPIRY_MARGIN_S = 60;
  const CLAIM_NO_LEASE_WINDOW_S = 10;

  function activationLivenessDeadline(reqObj) {
    return minIso(
      isoPlusSeconds(reqObj.created_at, ACTIVATION_LIVENESS_WINDOW_S),
      isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S),
    );
  }

  function currentValidResultExists(txnDir, auth) {
    const resultPath = resultPathFor(txnDir, auth.attemptId);
    // DUR-J: a genuinely absent result (null) is "no valid result"; an nlink==2 /
    // symlink / foreign-owner / malformed / wrong-RESULT_V2-shape result STOPs
    // (readJsonDurableOptional throws) rather than being silently counted as "no result"
    // -- a non-durable or malformed in-flight result must not silently unblock a takeover.
    const obj = readJsonDurableOptional(resultPath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
    return obj !== null && obj.status === 'ANSWERED';
  }

  function confirmedFailedDelivery(txnDir, attemptId, claimDigestOrNull) {
    // DUR-J + Section 4: a genuinely absent delivery (null) is "no confirmed failure"; an
    // nlink==2 / symlink / malformed / wrong-shape delivery STOPs rather than silently
    // establishing (or failing to establish) eligibility off a non-durable or unvalidated
    // record.
    const rec = readClosedRecordOptional(deliveryPathFor(txnDir, attemptId), DELIVERY_V1_FIELDS);
    if (rec === null) return false;
    const d = rec.obj;
    if (d.delivered !== false || d.outcome !== 'confirmed-failed-before-commit') return false;
    if (claimDigestOrNull !== null && d.claim_digest !== claimDigestOrNull) return false;
    return true;
  }

  /** Returns `{eligibilityKind, reason, deadline}` or throws CliError(INVALID, AUTHORITY_INVALID, ...). */
  function computeTakeoverEligibility(reqObj, txnDir, nowMs, lockToken) {
    // DUR-J: a durably-committed takeover blocks a second takeover; a genuinely absent
    // one (null) does not block; an nlink==2 / symlink / malformed takeover STOPs
    // (readJsonDurableOptional throws) rather than being coarsely counted as "present".
    if (readJsonDurableOptional(takeoverPathFor(txnDir)) !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a takeover has already committed for this request');
    }
    const initialAttempt = reqObj.initial_attempt_id;
    const auth = { attemptId: initialAttempt, leaseEpoch: reqObj.initial_lease_epoch };
    if (currentValidResultExists(txnDir, auth)) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a valid current result already exists; takeover is blocked');
    }

    // DUR-J + Section 4: fd-bound durable read + closed-shape enforcement -- a genuinely
    // absent claim (null) takes the no-claim branch; an nlink==2 / symlink / foreign-
    // owner / malformed / wrong-shape claim STOPs (never mis-read as absent). The digest
    // is taken from the exact durable bytes, not a second sha256File re-read.
    const claimPath = claimPathFor(txnDir, initialAttempt);
    const claimRec = readClosedRecordOptional(claimPath, CLAIM_V1_FIELDS);
    if (claimRec === null) {
      if (confirmedFailedDelivery(txnDir, initialAttempt, null)) {
        return { eligibilityKind: 'confirmed-failed-before-commit', reason: 'confirmed-failed-before-commit', deadline: null };
      }
      const deadline = activationLivenessDeadline(reqObj);
      if (nowMs >= isoToMs(deadline)) {
        return { eligibilityKind: 'activation-liveness-expired', reason: 'lease-expired', deadline };
      }
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'activation liveness has not yet expired');
    }

    const claimObj = claimRec.obj;
    const claimDigest = claimRec.digest;
    if (confirmedFailedDelivery(txnDir, initialAttempt, claimDigest)) {
      return { eligibilityKind: 'confirmed-failed-before-commit', reason: 'confirmed-failed-before-commit', deadline: null };
    }

    // DUR-J + Section 4: same fd-bound durable read + closed-shape enforcement for the
    // active-lease -- a genuinely absent lease (null) takes the no-lease branch; an
    // nlink==2 / symlink / malformed / wrong-shape lease STOPs, never mis-read as absent.
    const leasePath = activeLeasePathFor(txnDir, initialAttempt);
    // DUR-J item 6: the mutable-lease read is valid only under the authentic threaded token.
    const leaseRec = readClosedRecordOptional(leasePath, ACTIVE_LEASE_V1_FIELDS, { immutablePath: false, lockToken: lockToken });
    if (leaseRec === null) {
      const deadline = minIso(
        isoPlusSeconds(claimObj.created_at, CLAIM_NO_LEASE_WINDOW_S),
        minIso(activationLivenessDeadline(reqObj), isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S)),
      );
      if (nowMs >= isoToMs(deadline)) {
        return { eligibilityKind: 'claim-no-lease-expired', reason: 'lease-expired', deadline };
      }
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim-without-lease effective deadline has not yet passed');
    }
    const leaseObj = leaseRec.obj;

    if (nowMs >= isoToMs(leaseObj.lease_expiry)) {
      return { eligibilityKind: 'active-lease-expired', reason: 'lease-expired', deadline: leaseObj.lease_expiry };
    }
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'active-lease has not yet expired');
  }

  function cmdTakeover(flags) {
    requireFlags(flags, ['coordination-root', 'request']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    // Codex NO-GO round 15: this preflight used to be readRequestForTxnOrCorrelationInvalid(txnDir)
    // (no coordRoot confinement/geometry check at all) with NO in-lock re-read or
    // identity-match against it -- the SAME TOCTOU class cmdCancel/cmdAcceptResult
    // needed rounds 10-12 to close (accredit once before the lock, then TRUST a
    // fresh in-lock read unconditionally, silently adopting a mid-wait
    // request.json mutation instead of rejecting it). accreditCanonicalRequest's
    // own doc comment already named takeover as sharing this exact asymmetry,
    // deliberately left unfixed by that earlier round. Aligned here with
    // cmdCancel's own established pattern: preflight, then in-lock re-read +
    // assertRequestIdentityMatches before trusting any field.
    const preflight = accreditCanonicalRequest(coordRoot, requestPath);

    return withLock(txnDir, coordRoot, (lockToken) => {
      testRendezvous(txnDir, 'takeover-in-lock-pre-read');
      assertLockedScopeIdentity(lockToken);
      const inLock = accreditCanonicalRequest(coordRoot, requestPath);
      assertRequestIdentityMatches(preflight, inLock, requestPath);
      const reqObj = inLock.obj;
      // DUR-J item 6/Takeover: the lease read used for eligibility AND the takeover
      // transition below occur under the SAME durable exclusion -- the authentic lockToken
      // is threaded into computeTakeoverEligibility so its immutablePath:false lease read is
      // valid without a second acquire (which would deadlock).
      const eligibility = computeTakeoverEligibility(reqObj, txnDir, Date.now(), lockToken);
      const nowStr = nowIso();
      const takeoverObj = {
        schema: 'coordination/takeover/v1',
        request_id: reqObj.request_id,
        new_attempt_id: genId(),
        new_lease_epoch: reqObj.initial_lease_epoch + 1,
        superseded_attempt_id: reqObj.initial_attempt_id,
        reason: eligibility.reason,
        eligibility_kind: eligibility.eligibilityKind,
        eligibility_snapshot: { eligibility_kind: eligibility.eligibilityKind },
        eligibility_deadline: eligibility.deadline || null,
        eligibility_observed_at: nowStr,
        takeover_at: nowStr,
      };
      const takeoverPath = takeoverPathFor(txnDir);
      const takeoverBytes = Buffer.from(canonicalJSONStringify(takeoverObj), 'utf8');
      assertLockedScopeIdentity(lockToken);
      const takeoverReceipt = publishNoClobber(takeoverPath, takeoverBytes, { raceDetailCode: 'AUTHORITY_INVALID' });
      // Codex NO-GO round 15: takeover.json is a one-time immutable record (like
      // cancel.json/accepted-result.json) -- gets the SAME post-publish
      // discipline: fresh scope + request-identity re-check, plus a byte+identity
      // re-verification against the receipt publishNoClobber itself returned.
      testRendezvous(txnDir, 'takeover-post-publish-pre-recheck');
      try {
        assertLockedScopeIdentity(lockToken);
        assertRequestIdentityMatches(preflight, accreditCanonicalRequest(coordRoot, requestPath), requestPath);
        assertArtifactMatchesReceipt(takeoverPath, takeoverReceipt, takeoverBytes);
      } catch (err) {
        throw isPoisoned(err) ? err : markPoisoned(err);
      }
      return { request_id: reqObj.request_id, artifact_ref: takeoverPath };
    });
  }

  return { ACTIVATION_LIVENESS_WINDOW_S, REQUEST_EXPIRY_MARGIN_S, CLAIM_NO_LEASE_WINDOW_S, activationLivenessDeadline, cmdTakeover };
}

module.exports = { createTakeoverTransaction };
