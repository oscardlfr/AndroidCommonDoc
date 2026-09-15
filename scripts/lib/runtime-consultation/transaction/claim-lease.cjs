'use strict';

// Extracted from runtime-consultation.cjs. This focused factory has no
// upward facade import; every authority, clock and durability seam is injected.
function createClaimLeaseTransaction(deps) {
  const {
    ACCEPTED_RESULT_V1_FIELDS,
    ACTIVE_LEASE_V1_FIELDS,
    CLAIM_V1_FIELDS,
    CliError,
    DURABLE_ABSENT,
    DURABLE_PENDING,
    acceptedResultPathFor,
    accreditCanonicalRequest,
    activeLeasePathFor,
    assertAcceptedResultCorrelates,
    assertArtifactMatchesReceipt,
    assertClosedShape,
    assertLockedScopeIdentity,
    assertRequestIdentityMatches,
    cancelPathFor,
    canonicalJSONStringify,
    claimPathFor,
    classifyDurableRead,
    computeWorktreeId,
    isHexId,
    isPoisoned,
    isoPlusSeconds,
    isoToMs,
    markPoisoned,
    nowIso,
    path,
    publishNoClobber,
    publishReplace,
    readCanonicalCancelRecordOptional,
    readClosedRecord,
    readClosedRecordOptional,
    readJsonDurableOptional,
    readRequestForTxnOrCorrelationInvalid,
    requireFlags,
    resolveAbsolute,
    resolveActivationForRequestPath,
    resolveAuthoritativeAttempt,
    resultPathFor,
    testM7Rendezvous,
    testRendezvous,
    validateResultV2,
    withLock,
  } = deps;

  function minIso(a, b) {
    return isoToMs(a) <= isoToMs(b) ? a : b;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // `claim` (PLAN.md ~L764) -- win claim/v1, then publish the initial active-lease
  // ─────────────────────────────────────────────────────────────────────────────

  function cmdClaim(flags, grantContext) {
    requireFlags(flags, ['coordination-root', 'request', 'role']);
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    // Codex NO-GO round 17 (P0): this preflight used to be
    // readRequestForTxnOrCorrelationInvalid(txnDir) (no coordRoot confinement/
    // geometry check, and no in-lock identity re-check against it at all) --
    // accreditCanonicalRequest's own doc comment already named claim as sharing
    // this exact asymmetry with the pre-round-10/11 cmdCancel/cmdAcceptResult,
    // deliberately left unfixed until now. A request.json substitution that
    // preserves initial_attempt_id/initial_lease_epoch (so auth/auth2 still
    // match) but changes another field -- expiry, target_role_profile_digest --
    // would previously go undetected: the claim's own target_role_profile_digest
    // is baked in from this pre-lock read, and leaseObj's own lease_expiry is
    // derived from the in-lock re-read, with nothing ever proving the two reads
    // saw the identical, unmutated file. Aligned here with cmdCancel/
    // cmdAcceptResult/cmdTakeover's own established pattern: preflight, then
    // in-lock re-read + assertRequestIdentityMatches before trusting any field.
    const preflight = accreditCanonicalRequest(coordRoot, requestPath);
    const reqObj = preflight.obj;
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
    if (
      !grantContext
      || typeof grantContext.actorInstanceId !== 'string'
      || !isHexId(grantContext.actorInstanceId)
      || grantContext.role !== flags.role
      || reqObj.target_role !== flags.role
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim target identity does not match its target grant/capability');
    const activation = resolveActivationForRequestPath(requestPath);
    if (
      !activation.ok || !activation.activation
      || activation.requestId !== reqObj.request_id
      || activation.attemptId !== auth.attemptId
      || activation.leaseEpoch !== auth.leaseEpoch
      || activation.targetRole !== reqObj.target_role
      || activation.activation.target_role_profile_digest !== reqObj.target_role_profile_digest
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim does not match the current activation');
    const claimDriver = activation.activation.selected_driver;
    if (
      grantContext.driver !== undefined
      && grantContext.driver !== claimDriver
    ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim capability driver does not match activation');
    const workerSessionId = grantContext.workerSessionId !== undefined
      ? grantContext.workerSessionId
      : (flags['worker-session'] || null);
    testRendezvous(txnDir, 'claim-preflight-pre-election');

    // claim/v1 remains the no-clobber ELECTION, outside .lock (PLAN-frozen first-writer-
    // wins semantics -- the lock is not needed to WIN the claim, only to safely publish
    // what follows it).
    const claimObj = {
      schema: 'coordination/claim/v1',
      request_id: reqObj.request_id,
      attempt_id: auth.attemptId,
      lease_epoch: auth.leaseEpoch,
      claimant_role: flags.role,
      claimant_worktree_id: computeWorktreeId(coordRoot),
      claimant_instance_id: grantContext.actorInstanceId,
      worker_session_id: workerSessionId,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      driver: claimDriver,
      created_at: nowIso(),
    };
    const claimPath = claimPathFor(txnDir, auth.attemptId);
    const claimBytes = Buffer.from(canonicalJSONStringify(claimObj), 'utf8');
    // Codex HARD NO-GO (round 17 -> 18 -> 19): the election publish below is a
    // no-clobber, first-writer-wins WRITE -- once it durably lands, a
    // SUBSEQUENT, legitimate claimant racing against the CURRENT (possibly
    // different) request.json can never overwrite it; they only ever observe
    // EEXIST/AUTHORITY_INVALID, regardless of whose data was actually correct.
    // Round 18 re-accredited request.json immediately before CALLING
    // publishNoClobber, and claimed that closed the window "to the tightest
    // achievable" -- Codex HARD NO-GO (round 19): it did not. publishNoClobber's
    // OWN internal sequence (mkdir, temp create/harden/write/fsync/fstat/close)
    // still ran entirely unrevalidated between that check and the actual
    // linkSync election, and fsync in particular is not instantaneous.
    // `revalidateBeforeLink` (see publishNoClobber's own doc comment) runs this
    // SAME check as the LAST statement before linkSync itself, closing that
    // remaining window too -- down to the gap between the callback returning
    // and linkSync executing, the tightest achievable without a hypothetical
    // atomic compare-then-link primitive.
    const claimReceipt = publishNoClobber(claimPath, claimBytes, {
      raceDetailCode: 'AUTHORITY_INVALID',
      revalidateBeforeLink: () => {
        testRendezvous(txnDir, 'claim-pre-link-revalidate');
        const freshAccredited = accreditCanonicalRequest(coordRoot, requestPath);
        assertRequestIdentityMatches(preflight, freshAccredited, requestPath);
        // M7 section 8.5: claim gains the SAME final cancel/terminal absence
        // read already applied by publish-result (cmdPublishResult, below),
        // at its own last existing no-clobber write boundary -- claim stays
        // outside the transaction lock exactly as before; this
        // revalidateBeforeLink callback IS the admission point.
        const freshExistingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
        if (freshExistingAccepted !== null) {
          assertAcceptedResultCorrelates(freshExistingAccepted, txnDir, freshAccredited.obj, coordRoot);
          throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
        }
        if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
          throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
        }
        // M7 CORRECTION C3 (Codex final ruling): the AUTHORITATIVE result
        // (results/<attempt>.json) is a SEPARATE terminal from
        // accepted-result.json (a downstream, requester-side artifact, never a
        // substitute for it) -- resolved fresh from the just-reaccredited
        // request, checked directly here at the admission point via the SAME
        // canonical fd-bound validateResultV2 pipeline every other
        // authoritative surface uses (never durability+shape alone). PENDING
        // fails closed DURABILITY_UNPROVEN before ever attempting validation. A
        // malformed/non-correlating durable record (validateResultV2's own
        // CORRELATION_INVALID) is DURABILITY_UNPROVEN too -- never treated as
        // "no terminal" and never conflated with a genuinely valid, denying
        // terminal. Only a result that VALIDATES cleanly denies at this frozen
        // boundary (AUTHORITY_INVALID).
        const freshAuth = resolveAuthoritativeAttempt(freshAccredited.obj, txnDir);
        const freshResultPath = resultPathFor(txnDir, freshAuth.attemptId);
        const freshResultState = classifyDurableRead(freshResultPath, { parse: true });
        if (freshResultState.state === DURABLE_PENDING) {
          throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result is still in the nlink==2 in-flight window");
        }
        if (freshResultState.state !== DURABLE_ABSENT) {
          try {
            validateResultV2(freshResultPath, coordRoot);
          } catch (err) {
            if (err instanceof CliError && err.detailCode === 'CORRELATION_INVALID') {
              throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result exists but does not correlate to its own request");
            }
            throw err;
          }
          throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an authoritative result for the current attempt');
        }
        testM7Rendezvous('claim-after-admission-before-link', coordRoot);
      },
    });

    // Section 4: the initial active-lease publish moves INSIDE the transition lock -- a
    // takeover racing between the claim election above and lock acquisition must be
    // re-checked under the SAME durable lock a heartbeat/takeover itself uses, never
    // assumed still current just because we won the election.
    testRendezvous(txnDir, 'claim-pre-lock');
    return withLock(txnDir, coordRoot, (lockToken) => {
      // Codex NO-GO round 16: a fresh scope check as the FIRST thing inside
      // this callback -- withLock's own pre-fn check happens once, before fn
      // starts; every read fn itself performs afterward (reqObj2 below,
      // claimRec further down) had no check of its own closer to it.
      assertLockedScopeIdentity(lockToken);
      // Re-read/revalidate the request and CURRENT attempt/epoch UNDER the lock -- a
      // takeover could have committed between the election above and lock acquisition.
      // Codex NO-GO round 17 (P0): re-accredit the FULL request identity (not
      // just the narrower attempt/epoch projection resolveAuthoritativeAttempt
      // derives from it) and reject any divergence from the preflight -- see
      // this function's own preflight comment above.
      const inLock = accreditCanonicalRequest(coordRoot, requestPath);
      assertRequestIdentityMatches(preflight, inLock, requestPath);
      const reqObj2 = inLock.obj;
      const auth2 = resolveAuthoritativeAttempt(reqObj2, txnDir);
      if (auth2.attemptId !== auth.attemptId || auth2.leaseEpoch !== auth.leaseEpoch) {
        // A takeover committed before lock acquisition: our claim was for the NOW-
        // superseded attempt. Reject -- never publish an initial lease for it.
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a takeover superseded this attempt before the initial lease could be published');
      }
      // Re-read the exact canonical claim just published, fd-bound-durable + closed-shape,
      // under the lock -- the lease's claim_digest is recomputed from THESE accredited
      // bytes, never the in-memory bytes from before the lock (DUR-J item 6 discipline,
      // extended across the lock boundary).
      const claimRec = readClosedRecord(claimPath, CLAIM_V1_FIELDS, {
        absentDetail: 'CORRELATION_INVALID',
        absentMessage: 'the just-published claim does not resolve',
      });
      if (claimRec.obj.attempt_id !== auth2.attemptId || claimRec.obj.lease_epoch !== auth2.leaseEpoch) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim attempt/epoch is not the current authoritative pair');
      }
      // Codex NO-GO round 16 (P0): the checks above prove SOME valid claim for
      // the current attempt/epoch resolves at claimPath -- never that it is
      // the EXACT bytes THIS invocation's own election published (a
      // substituted-but-still-attempt/epoch-matching claim, e.g. a different
      // claimant_role/claimant_instance_id/driver, would pass them). Reuse the
      // SAME fd-bound comparator every other hardened write in this file
      // trusts, against the receipt THIS invocation's own election publish
      // returned.
      assertArtifactMatchesReceipt(claimPath, claimReceipt, claimBytes);

      const now = nowIso();
      const leaseObj = {
        schema: 'coordination/active-lease/v1',
        attempt_id: auth2.attemptId,
        lease_epoch: auth2.leaseEpoch,
        holder_role: flags.role,
        claimant_instance_id: claimRec.obj.claimant_instance_id,
        worker_session_id: claimRec.obj.worker_session_id,
        claim_digest: claimRec.digest,
        ttl_seconds: 300,
        heartbeat_interval_seconds: 60,
        last_heartbeat_at: now,
        lease_expiry: minIso(isoPlusSeconds(now, 300), reqObj2.expiry),
        created_at: now,
      };
      const leasePath = activeLeasePathFor(txnDir, auth2.attemptId);
      const leaseBytes = Buffer.from(canonicalJSONStringify(leaseObj), 'utf8');
      // Codex NO-GO round 15 ("los cinco callers del lock"): withLock's own
      // entry/exit checks bracket this ENTIRE callback, but cannot catch a
      // txnDir/.lock swap that happens THEN GETS SWAPPED BACK before withLock's
      // own post-fn check runs (empirically confirmed this session via
      // RCC-claim-withlock-systemic-txndir-swap-detected: the write still lands
      // in a swapped substitute even with that systemic check active). A fresh
      // scope check immediately before AND after this specific write shrinks
      // that window to the minimum, mirroring cmdCancel/cmdAcceptResult/
      // cmdTakeover's own established pattern.
      assertLockedScopeIdentity(lockToken);
      const leaseReceipt = publishNoClobber(leasePath, leaseBytes, { allowIdenticalIdempotent: true });
      testRendezvous(txnDir, 'claim-post-lease-publish-pre-recheck');
      try {
        assertLockedScopeIdentity(lockToken);
        // Codex NO-GO round 17 (P0): mirrors cmdTakeover's own post-publish
        // request-identity recheck -- proves request.json is STILL the exact
        // preflight bytes at the moment this invocation is about to report
        // SUCCESS, not merely at lock entry several reads/writes earlier.
        assertRequestIdentityMatches(preflight, accreditCanonicalRequest(coordRoot, requestPath), requestPath);
        assertArtifactMatchesReceipt(leasePath, leaseReceipt, leaseBytes);
      } catch (err) {
        throw isPoisoned(err) ? err : markPoisoned(err);
      }

      return { request_id: reqObj2.request_id, artifact_ref: claimPath };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // `lease-heartbeat` (PLAN.md ~L765) -- durable current-attempt lease refresh
  // ─────────────────────────────────────────────────────────────────────────────

  function cmdLeaseHeartbeat(flags) {
    requireFlags(flags, ['coordination-root', 'request', 'claim']);
    // Outside the lock: parse argv and derive canonical paths ONLY (Section 4). Every
    // durable read, the authority resolution, and the expiry decision happen INSIDE the
    // one withLock below -- a heartbeat is a REFRESH transaction, not a lock-free lookup.
    // Codex NO-GO round 15: coordRoot was previously required by requireFlags
    // above but never actually resolved/used anywhere in this function -- now
    // threaded into withLock/acquireLock for the ancestor-confinement check.
    const coordRoot = resolveAbsolute(flags['coordination-root']);
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    const claimPath = resolveAbsolute(flags.claim);

    testRendezvous(txnDir, 'heartbeat-pre-lock');
    return withLock(txnDir, coordRoot, (lockToken) => {
      // Codex NO-GO round 16: a fresh scope check as the FIRST thing inside
      // this callback -- withLock's own pre-fn check happens once, before fn
      // starts; every read below (reqObj, claimRec, existingRec) had no check
      // of its own closer to it.
      assertLockedScopeIdentity(lockToken);
      const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
      const auth = resolveAuthoritativeAttempt(reqObj, txnDir);

      // DUR-J + Section 4: fd-bound durable read, closed-shape enforced, under the lock,
      // from wherever the caller points.
      const claimRec = readClosedRecord(claimPath, CLAIM_V1_FIELDS, {
        absentDetail: 'CORRELATION_INVALID',
        absentMessage: 'claim file does not resolve',
      });
      // Self-consistency/confinement: the claim must be stored at ITS OWN canonical path
      // for the attempt it names -- never a claim for attempt X read back from some other,
      // non-canonical location (PATH-07 confinement discipline).
      if (path.resolve(claimPath) !== path.resolve(claimPathFor(txnDir, claimRec.obj.attempt_id))) {
        throw new CliError('INVALID', 'SECURITY_INVALID', '--claim is not stored at its own canonical path for its attempt_id');
      }
      // AUTHORITY: the claim's attempt/epoch must be the CURRENT authoritative pair -- a
      // self-consistent claim for a NOW-superseded attempt is an authority problem, not a
      // correlation/path problem.
      if (claimRec.obj.attempt_id !== auth.attemptId || claimRec.obj.lease_epoch !== auth.leaseEpoch) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim is not the current authoritative attempt/epoch');
      }

      // Section 4: heartbeat REQUIRES an existing lease -- it must never create a missing
      // initial lease (that is solely cmdClaim's job, published under ITS OWN lock).
      // immutablePath:false is the mutable-lease exception (DUR-J item 3), valid only
      // because the authentic lockToken for this txnDir is threaded through (item 6
      // reentrancy -- no second acquire).
      const leasePath = activeLeasePathFor(txnDir, auth.attemptId);
      const existingRec = readClosedRecordOptional(leasePath, ACTIVE_LEASE_V1_FIELDS, { immutablePath: false, lockToken: lockToken });
      if (existingRec === null) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'no existing active-lease to refresh for the current attempt');
      }
      const existing = existingRec.obj;

      // Never revive a superseded or foreign lease: the existing lease must itself match
      // the current attempt/epoch AND the presenting claim's own identity fields.
      if (
        existing.attempt_id !== auth.attemptId
        || existing.lease_epoch !== auth.leaseEpoch
        || existing.holder_role !== claimRec.obj.claimant_role
        || existing.claimant_instance_id !== claimRec.obj.claimant_instance_id
        || (existing.worker_session_id || null) !== (claimRec.obj.worker_session_id || null)
        || existing.claim_digest !== claimRec.digest
      ) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'existing active-lease does not match the current attempt/claimant -- refusing to refresh a stale or foreign lease');
      }

      // Section 4: now < lease_expiry AND now < request expiry, STRICT -- now==lease_expiry
      // is already expired. Never revive an expired lease.
      const now = nowIso();
      const nowMs = isoToMs(now);
      if (!(nowMs < isoToMs(existing.lease_expiry)) || !(nowMs < isoToMs(reqObj.expiry))) {
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'active-lease or request has already expired; heartbeat rejected');
      }

      const merged = Object.assign({}, existing, {
        last_heartbeat_at: now,
        lease_expiry: minIso(isoPlusSeconds(now, existing.ttl_seconds), reqObj.expiry),
      });
      // Codex NO-GO round 15 ("los cinco callers del lock"): a fresh scope check
      // immediately before this write, mirroring cmdClaim/cmdCancel/
      // cmdAcceptResult/cmdTakeover's own established pattern.
      //
      // Codex NO-GO round 16 (P0): round 15's own justification for skipping a
      // byte-exact check here ("a legitimate concurrent heartbeat is expected
      // to change its content") was WRONG -- only ONE process can ever hold
      // this lock at a time; a second heartbeat call BLOCKS in acquireLock's
      // own mkdir-wait loop until this one releases, so nothing legitimate can
      // race THIS invocation's own write while it holds the lock. A byte-exact
      // receipt check is exactly as meaningful here as for any other hardened
      // write in this file.
      assertLockedScopeIdentity(lockToken);
      // M7 section 8.5: lease-heartbeat gains the SAME final cancel/terminal
      // absence read already applied by publish-result (cmdPublishResult),
      // performed here under this function's own existing lock -- a terminal
      // already durable before this read blocks the effect, and no operation
      // admitted after cancellation can mutate the target.
      const heartbeatExistingAccepted = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
      if (heartbeatExistingAccepted !== null) {
        assertAcceptedResultCorrelates(heartbeatExistingAccepted, txnDir, reqObj, coordRoot);
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
      }
      if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
        throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
      }
      const leaseBytes = Buffer.from(canonicalJSONStringify(merged), 'utf8');
      testM7Rendezvous('heartbeat-after-admission-before-write', coordRoot);
      // M7 CORRECTION C1/C3 (Codex final ruling, two-boundary linearization):
      // this check is heartbeat's own LP2 -- it must run AFTER the rendezvous
      // pause above, not before, so it can OBSERVE an authoritative result
      // landing in the exact LP1 (general authority admission, already
      // resolved earlier in the call chain, before this function's own body
      // even started)-to-LP2 window the pause simulates ("section 8.5 LP2
      // observes the result"; a terminal ordered genuinely after LP2 releases
      // is never retroactively checked and is allowed to complete, per M7's
      // general "already-admitted may complete bounded" positive-control
      // semantics). The AUTHORITATIVE result is a SEPARATE terminal from
      // accepted-result.json -- checked via the SAME canonical fd-bound
      // validateResultV2 pipeline claim's own revalidateBeforeLink admission
      // point uses (see its matching comment for the full PENDING/
      // CORRELATION_INVALID mapping rationale). A terminal that VALIDATES
      // cleanly denies AUTHORITY_INVALID and leaves the lease bytes unwritten;
      // malformed/pending is DURABILITY_UNPROVEN.
      const heartbeatResultPath = resultPathFor(txnDir, auth.attemptId);
      const heartbeatResultState = classifyDurableRead(heartbeatResultPath, { parse: true });
      if (heartbeatResultState.state === DURABLE_PENDING) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result is still in the nlink==2 in-flight window");
      }
      if (heartbeatResultState.state !== DURABLE_ABSENT) {
        try {
          validateResultV2(heartbeatResultPath, coordRoot);
        } catch (err) {
          if (err instanceof CliError && err.detailCode === 'CORRELATION_INVALID') {
            throw new CliError('INVALID', 'DURABILITY_UNPROVEN', "the current attempt's authoritative result exists but does not correlate to its own request");
          }
          throw err;
        }
        throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an authoritative result for the current attempt');
      }
      const leaseReceipt = publishReplace(leasePath, leaseBytes);
      testRendezvous(txnDir, 'heartbeat-post-publish-pre-recheck');
      try {
        assertLockedScopeIdentity(lockToken);
        assertArtifactMatchesReceipt(leasePath, leaseReceipt, leaseBytes);
      } catch (err) {
        throw isPoisoned(err) ? err : markPoisoned(err);
      }
      return { request_id: reqObj.request_id, artifact_ref: leasePath };
    });
  }

  return { minIso, cmdClaim, cmdLeaseHeartbeat };
}

module.exports = { createClaimLeaseTransaction };
