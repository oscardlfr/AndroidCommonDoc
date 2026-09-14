'use strict';

// `publish-result` command controller: native --content/--blocked-reason XOR forms, authority fields derived from request+claim.

function createPublishResultCommand({
  ACCEPTED_RESULT_V1_FIELDS,
  CLAIM_V1_FIELDS,
  CliError,
  RESULT_V2_FIELDS,
  acceptedResultPathFor,
  assertAcceptedResultCorrelates,
  assertArtifactMatchesReceipt,
  assertClosedShape,
  assertLockedScopeIdentity,
  assertResultContentXor,
  cancelPathFor,
  canonicalJSONStringify,
  claimPathFor,
  computeSubjectHead,
  computeWorktreeId,
  decodeBase64Url,
  isPoisoned,
  markPoisoned,
  nowIso,
  path,
  planRootFromArtifact,
  publishNoClobber,
  readCanonicalCancelRecordOptional,
  readCanonicalRequestRecord,
  readClosedRecord,
  readJsonDurableOptional,
  requireFlags,
  resolveAbsolute,
  resolveAuthoritativeAttempt,
  resultPathFor,
  testRendezvous,
  validatePatternEvidenceForResult,
  withLock,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// `publish-result` (PLAN.md ~L767, ~L1129-1136) -- the two native-target XOR
// forms (--content / --blocked-reason); core derives all authority fields from
// request+claim. (Real Codex-bridge result publication is WP3.)
// ─────────────────────────────────────────────────────────────────────────────

const NATIVE_CONTENT_MAX_B64URL_CHARS = 16384;
const NATIVE_CONTENT_MAX_DECODED_BYTES = 12288;
const BLOCKED_REASON_ENUM = [
  'CONTENT_TOO_LARGE', 'INSUFFICIENT_CONTEXT', 'UNSUPPORTED_REQUEST', 'CONSULTATION_FAILED', 'POLICY_DENIED',
];

function cmdPublishResult(flags, grantContext) {
  requireFlags(flags, ['coordination-root', 'request', 'claim']);
  const hasContent = 'content' in flags;
  const hasBlockedReason = 'blocked-reason' in flags;
  if (hasContent === hasBlockedReason) {
    throw new CliError(
      'USAGE_ERROR',
      hasContent ? 'INVALID_ARGUMENT' : 'MISSING_ARGUMENT',
      'exactly one of --content/--blocked-reason is required',
    );
  }

  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const claimPath = resolveAbsolute(flags.claim);

  // Section 4: decode the BOUNDED caller content/reason outside the lock -- pure
  // caller-input validation, no durable read depends on it.
  let status;
  let content;
  let reason;
  if (hasContent) {
    if (flags.content.length > NATIVE_CONTENT_MAX_B64URL_CHARS) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', '--content exceeds the 16384-character native base64url ceiling');
    }
    const decoded = decodeBase64Url(flags.content);
    if (decoded.length > NATIVE_CONTENT_MAX_DECODED_BYTES) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', '--content decoded payload exceeds the 12288-byte native ceiling');
    }
    status = 'ANSWERED';
    content = decoded.toString('utf8');
    reason = null;
  } else {
    if (!BLOCKED_REASON_ENUM.includes(flags['blocked-reason'])) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --blocked-reason: ' + flags['blocked-reason']);
    }
    status = 'BLOCKED';
    reason = flags['blocked-reason'];
  }

  testRendezvous(txnDir, 'publish-result-pre-lock');
  return withLock(txnDir, coordRoot, (lockToken) => {
    // Codex NO-GO round 16: a fresh scope check as the FIRST thing inside
    // this callback -- withLock's own pre-fn check happens once, before fn
    // starts; every read fn itself performs afterward (reqRec, claimRec
    // below, and every authority field resultObj is built from) had no
    // check of its own closer to it.
    assertLockedScopeIdentity(lockToken);
    // Section 4: re-read/revalidate the request and CURRENT authority INSIDE the lock
    // -- a takeover racing before lock acquisition must be observed here, never
    // trusted from a pre-lock snapshot. Codex NO-GO round 3 (blocker 1): routed
    // through readCanonicalRequestRecord -- the request's OWN embedded request_id
    // must equal `path.basename(txnDir)`.
    const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'referenced request.json does not resolve',
    });
    const reqObj = reqRec.obj;
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);

    // Codex NO-GO round 16 (P0): PLAN.md ~L443 makes "absence of committed
    // takeover/cancel/accept" part of candidate publication's OWN mandatory
    // contract, not an optional hardening pass -- this was missing entirely.
    // Absence of a committed takeover is already structurally enforced above
    // (resolveAuthoritativeAttempt itself resolves to the POST-takeover
    // attempt/epoch; a claim for the superseded attempt already fails the
    // attempt/epoch check just below). accepted-result.json/cancel.json are
    // NOT otherwise checked anywhere in this function -- mirrors cmdCancel's/
    // cmdAcceptResult's own already-established terminal-exclusion pattern.
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
    if (readCanonicalCancelRecordOptional(cancelPathFor(txnDir), coordRoot) !== null) {
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }

    // The canonical claim for the CURRENT authoritative attempt: self-consistency
    // (own canonical path for its own attempt_id) then authority (current
    // attempt/epoch) -- mirrors cmdLeaseHeartbeat's discipline exactly.
    const claimRec = readClosedRecord(claimPath, CLAIM_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'claim file does not resolve',
    });
    if (path.resolve(claimPath) !== path.resolve(claimPathFor(txnDir, claimRec.obj.attempt_id))) {
      throw new CliError('INVALID', 'SECURITY_INVALID', '--claim is not stored at its own canonical path for its attempt_id');
    }
    if (claimRec.obj.attempt_id !== auth.attemptId || claimRec.obj.lease_epoch !== auth.leaseEpoch) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim is not the current authoritative attempt/epoch');
    }

    // Section 4: every authority field and digest below is constructed from THESE
    // inside-lock records -- never the pre-lock decode above (which carries no
    // authority fields) nor any snapshot taken before this point.
    const now = nowIso();
    const resultObj = {
      schema: 'coordination/result/v2',
      in_reply_to: reqObj.request_id,
      request_digest: reqRec.digest,
      plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id,
      wave_slug: reqObj.wave_slug,
      protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      root_request_id: reqObj.root_request_id,
      parent_request_id: reqObj.parent_request_id,
      depth: reqObj.depth,
      attempt_id: auth.attemptId,
      lease_epoch: auth.leaseEpoch,
      driver: claimRec.obj.driver,
      claimant_instance_id: claimRec.obj.claimant_instance_id,
      worker_session_id: claimRec.obj.worker_session_id || null,
      claim_digest: claimRec.digest,
      target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      from_role: reqObj.target_role,
      to_role: reqObj.source_role,
      result_kind: status === 'BLOCKED' ? 'BLOCKED' : reqObj.expected_result_kind,
      status,
      reason,
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id,
      subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest,
      consultation_dependencies: (
        grantContext && grantContext.hostBridge === true
        && Array.isArray(grantContext.consultationDependencies)
      ) ? grantContext.consultationDependencies.map((dep) => Object.assign({}, dep)) : [],
      // Host-derived only.  CLI/model input has no flag/field capable of
      // supplying this dependency; the retained bridge passes it separately
      // after publishing and validating pattern-evidence/v1.
      pattern_evidence_dependency: (
        grantContext && grantContext.hostBridge === true
        && grantContext.patternEvidenceDependency !== undefined
      ) ? (grantContext.patternEvidenceDependency === null
        ? null : Object.assign({}, grantContext.patternEvidenceDependency)) : null,
      producer_worktree_id: computeWorktreeId(coordRoot),
      producer_head: computeSubjectHead(coordRoot),
      created_at: now,
    };
    if (status === 'ANSWERED') resultObj.content = content;

    // Fail closed on any internal inconsistency rather than publishing a record
    // `validate --kind result-v2` would later reject (mirrors cmdPublishRequest's
    // own "fail closed" convention).
    assertClosedShape(resultObj, RESULT_V2_FIELDS);
    assertResultContentXor(resultObj);
    validatePatternEvidenceForResult(resultObj.pattern_evidence_dependency, resultObj, reqRec, txnDir, planRootFromArtifact(coordRoot, requestPath));

    // Section 4: publish only after the final inside-lock authority check above --
    // a takeover that won before lock acquisition was already rejected there, so
    // this publish is never reached for a superseded attempt.
    const resultPath = resultPathFor(txnDir, auth.attemptId);
    const resultBytes = Buffer.from(canonicalJSONStringify(resultObj), 'utf8');
    // Codex NO-GO round 15 ("los cinco callers del lock"): a fresh scope check
    // immediately before this write, mirroring every other hardened caller in
    // this file.
    //
    // Codex NO-GO round 16: PLAN.md ~L704's own frozen rule -- "same-digest
    // duplicate candidates are idempotent" -- is REUSED here via
    // publishNoClobber's own existing, already-proven allowIdenticalIdempotent
    // mechanism (fd-bound, byte-for-byte, never a field-excluding
    // reconstruction of "logical" identity) rather than any new invention;
    // R10's own canonicalRetryComparisonDigest (excluding created_at) is
    // retracted -- see CONFLICT-DESIGN-R11.md. A genuinely DIFFERENT
    // candidate for the same (attempt_id, lease_epoch) remains AUTHORITY_INVALID,
    // unchanged from today's real behavior -- publish-result holds only
    // TARGET authority (PLAN.md ~L580-592), so it must never itself write
    // cancel.json/conflict/*.json (REQUESTER-only artifacts); see R11 for why
    // no CONFLICT/RESULT_CONFLICT reporting belongs here either.
    assertLockedScopeIdentity(lockToken);
    const resultReceipt = publishNoClobber(resultPath, resultBytes, { allowIdenticalIdempotent: true, raceDetailCode: 'AUTHORITY_INVALID' });
    // publishNoClobber succeeded OUTRIGHT (no EEXIST) -- SUCCESS-path scope+
    // receipt re-verification, mirroring cmdClaim/cmdCancel/cmdAcceptResult/
    // cmdTakeover's own established pattern. A thrown EEXIST/race-loss above
    // never reaches this point at all -- unchanged, pre-existing behavior.
    testRendezvous(txnDir, 'publish-result-post-publish-pre-recheck');
    try {
      assertLockedScopeIdentity(lockToken);
      assertArtifactMatchesReceipt(resultPath, resultReceipt, resultBytes);
    } catch (err) {
      throw isPoisoned(err) ? err : markPoisoned(err);
    }
    return { request_id: reqObj.request_id, artifact_ref: resultPath };
  });
}

  return Object.freeze({
    BLOCKED_REASON_ENUM,
    NATIVE_CONTENT_MAX_B64URL_CHARS,
    NATIVE_CONTENT_MAX_DECODED_BYTES,
    cmdPublishResult,
  });
}

module.exports = { createPublishResultCommand };
