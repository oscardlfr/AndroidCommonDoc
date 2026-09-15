'use strict';

function createResultsProtocol(deps) {
  const {
    path,
    CliError,
    readDurableRecord,
    readJsonDurable,
    readClosedRecord,
    requestPathFor,
    resultPathFor,
    acceptedResultPathFor,
    ackPathFor,
    planRootFromArtifact,
    readCanonicalRequestRecord,
    resolveContentRefOrThrow,
    resolveAuthoritativeAttempt,
    validatePatternEvidenceForResult,
    resolveRootEvidenceAuthority,
    hasExactKeys,
    assertClosedShape,
    assertResultContentXor,
    isHexId,
    isHex64,
    isNonEmptyString,
    isNonNegativeInteger,
    isIsoTimestamp,
    isEnum,
    orNull,
    isPatternEvidenceDependencyShape,
  } = deps;

// Candidate result `result/v2` (record #6) -- field table PLAN.md ~L410-435
// ─────────────────────────────────────────────────────────────────────────────

const RESULT_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/result/v2' },
  in_reply_to: { check: isHexId },
  request_digest: { check: isHex64 },
  plan_digest: { check: isHex64 },
  repo_id: { check: isNonEmptyString },
  wave_slug: { check: isNonEmptyString },
  protocol_profile: { check: isNonEmptyString },
  max_depth: { check: isNonNegativeInteger },
  routing_policy_version: { check: isNonEmptyString },
  routing_policy_digest: { check: isHex64 },
  root_request_id: { check: isHexId },
  parent_request_id: { check: orNull(isHexId) },
  depth: { check: isNonNegativeInteger },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  driver: { check: isNonEmptyString },
  claimant_instance_id: { check: isNonEmptyString },
  worker_session_id: { required: false, check: orNull(isNonEmptyString) },
  claim_digest: { check: isHex64 },
  target_role_profile_version: { check: isNonEmptyString },
  target_role_profile_digest: { check: isHex64 },
  from_role: { check: isNonEmptyString },
  to_role: { check: isNonEmptyString },
  result_kind: { check: isNonEmptyString },
  status: { check: isEnum(['ANSWERED', 'BLOCKED']) },
  reason: { check: (v) => v === null || isNonEmptyString(v) },
  content: { required: false, check: () => true },
  content_ref: { required: false, check: () => true },
  subject_repo_id: { check: isNonEmptyString },
  subject_worktree_id: { check: isNonEmptyString },
  subject_head: { check: isNonEmptyString },
  subject_scope_digest: { check: isNonEmptyString },
  consultation_dependencies: { check: (v) => Array.isArray(v) },
  pattern_evidence_dependency: {
    check: (v) => v === null || isPatternEvidenceDependencyShape(v),
  },
  producer_worktree_id: { check: isNonEmptyString },
  producer_head: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};


/**
 * Fields the result/v2 record must mirror verbatim from its request/v2 (PLAN.md
 * ~L417-430): plan/repo/wave/protocol/max_depth identity, the exact observed subject
 * snapshot, and the immutable routing policy identity. A result carrying a mismatched
 * subject/plan/routing snapshot -- even with an otherwise-correct `request_digest` --
 * must never be accepted (Subject-vs-Producer Model, PLAN.md ~L657: "A result for
 * subject A is never reused for subject B").
 */
const RESULT_MIRRORED_REQUEST_FIELDS = [
  'plan_digest', 'repo_id', 'wave_slug', 'protocol_profile', 'max_depth',
  'subject_repo_id', 'subject_worktree_id', 'subject_head', 'subject_scope_digest',
  'routing_policy_version', 'routing_policy_digest',
];

/** Throws CORRELATION_INVALID on the first mirrored field that diverges from the request. */
function assertResultMirrorsRequest(obj, reqObj) {
  for (const field of RESULT_MIRRORED_REQUEST_FIELDS) {
    if (obj[field] !== reqObj[field]) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'result.' + field + ' does not match request.' + field);
    }
  }
}

/**
 * Full `validate --kind result-v2` pipeline: shape -> content XOR -> durability ->
 * correlation (in_reply_to/digest/roles/root-parent-depth/result_kind/mirrored
 * plan+subject+routing fields, PLAN.md ~L417-430) -> content_ref resolution ->
 * Attempt Authority fencing (PLAN.md ~L700-704). Also used internally by
 * `accept-result`/`takeover` to evaluate an existing candidate.
 */
function validateResultV2(artifactPath, coordRoot) {
  const rec = readDurableRecord(artifactPath);
  const obj = rec.obj;
  assertClosedShape(obj, RESULT_V2_FIELDS);
  assertResultContentXor(obj);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.

  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const txnDir = path.dirname(path.dirname(artifactPath));
  const requestId = path.basename(txnDir);
  const attemptFromFilename = path.basename(artifactPath, '.json');

  if (obj.attempt_id !== attemptFromFilename) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'attempt_id does not match results/<attempt_id>.json filename');
  }
  if (obj.in_reply_to !== requestId) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'in_reply_to does not match containing transaction');
  }

  // DUR-J: read request.json ONCE, fd-bound-durable, and derive BOTH the bytes (for the
  // request_digest comparison) and the parsed reqObj (for the mirror check) from it --
  // no second by-path read, no TOCTOU between the digested bytes and the parsed object.
  // Codex NO-GO round 2 (blocker 3): closed-shape CONSULT_V2_FIELDS is enforced. Round
  // 3 (blocker 1): routed through readCanonicalRequestRecord -- the request's OWN
  // embedded request_id must equal `requestId` (this transaction's own name, already
  // proven above via `obj.in_reply_to !== requestId`), not merely a digest match over
  // whatever bytes happen to live at request.json.
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), requestId, {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  });
  const reqObj = reqRec.obj;
  if (reqRec.digest !== obj.request_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'request_digest does not match request.json bytes');
  }
  assertResultMirrorsRequest(obj, reqObj);
  if (obj.from_role !== reqObj.target_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'from_role != request.target_role');
  }
  if (obj.to_role !== reqObj.source_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'to_role != request.source_role');
  }
  if (obj.root_request_id !== reqObj.root_request_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root_request_id mismatch vs request');
  }
  if (obj.parent_request_id !== reqObj.parent_request_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id mismatch vs request');
  }
  if (obj.depth !== reqObj.depth) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth mismatch vs request');
  }
  const blockedKindOk = obj.status === 'BLOCKED' && obj.result_kind === 'BLOCKED';
  if (obj.result_kind !== reqObj.expected_result_kind && !blockedKindOk) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'result_kind does not match request.expected_result_kind');
  }
  if (obj.content_ref) {
    resolveContentRefOrThrow(planRoot, obj.content_ref);
  }

  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (obj.attempt_id !== auth.attemptId || obj.lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'result attempt/epoch is not the current authoritative pair');
  }

  validatePatternEvidenceForResult(obj.pattern_evidence_dependency, obj, reqRec, txnDir, planRoot);
  const evidenceAuthority = resolveRootEvidenceAuthority(reqObj, reqRec.digest, coordRoot);
  const evidencePolicy = evidenceAuthority.policy;
  if (
    obj.status === 'ANSWERED' && obj.from_role === 'context-provider'
    && evidencePolicy === 'context7-required'
    && obj.pattern_evidence_dependency === null
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required root result has no pattern evidence dependency');
  if (
    obj.status === 'ANSWERED' && obj.from_role === 'context-provider'
    && (evidencePolicy === 'context7-required' || evidencePolicy === 'context7-preferred') && evidenceAuthority.libraryId !== null
    && obj.pattern_evidence_dependency !== null
    && obj.pattern_evidence_dependency.library_id !== evidenceAuthority.libraryId
  ) throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context-provider pattern evidence library_id does not match the approved directive');

  // M6/M7 terminal functional closure, point F: every reopen of a
  // result/v2 re-validates its consultation_dependencies through the same
  // canonical validator publish-time used -- never a lighter shape-only
  // re-check.
  validateConsultationDependencySet(obj.consultation_dependencies, reqObj, planRoot, coordRoot, evidenceAuthority);

  return { obj, bytes: rec.bytes, digest: rec.digest, reqObj, txnDir, planRoot, requestId };
}

// ─────────────────────────────────────────────────────────────────────────────
// `accepted-result` (record #7) -- field table PLAN.md ~L437-451
// ─────────────────────────────────────────────────────────────────────────────

const ACCEPTED_RESULT_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/accepted-result/v1' },
  request_digest: { check: isHex64 },
  candidate_result_path: { check: isNonEmptyString },
  result_digest: { check: isHex64 },
  accepted_attempt_id: { check: isHexId },
  accepted_lease_epoch: { check: isNonNegativeInteger },
  routing_policy_digest: { check: isHex64 },
  requester_instance_id: { check: isNonEmptyString },
  accepted_at: { check: isIsoTimestamp },
  schema_version: { check: (v) => v === 1 },
};

function validateAcceptedResultV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACCEPTED_RESULT_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

/**
 * AUTH-06/07 correction: shape validity alone (above) proves the JSON is well-formed
 * and durable, never that it CORRELATES to this specific transaction (PLAN.md ~L710:
 * "only a validated correlated artifact completes"). This re-derives the exact same
 * correlation chain `cmdAcceptResult` itself established at write-time and re-checks
 * every claim against reality:
 *   - `request_digest` must equal the REAL request.json bytes on disk right now.
 *   - `routing_policy_digest` must equal the REAL request's own field.
 *   - `accepted_attempt_id`/`accepted_lease_epoch` must equal the CURRENT authoritative
 *     attempt/epoch (`resolveAuthoritativeAttempt`) -- not merely well-shaped hex/ints.
 *   - `candidate_result_path` is NEVER opened as attacker-supplied I/O: the real
 *     candidate is always re-located canonically via `resultPathFor(txnDir,
 *     accepted_attempt_id)` (the same helper `cmdAcceptResult` used to construct this
 *     field originally); the caller-supplied string is only ever STRING-COMPARED
 *     against that canonical form, never joined/opened directly.
 *   - `result_digest` must equal the real, independently-revalidated (`validateResultV2`)
 *     candidate result's own digest.
 * Throws AUTHORITY_INVALID on any mismatch; a caller that reaches this function already
 * knows the accepted-result artifact is shape-valid and durable (DUR-J's job) -- this is
 * strictly the AUTH-area authority/correlation layer DUR-J deliberately left to AUTH-06/07.
 */
function assertAcceptedResultCorrelates(acceptedObj, txnDir, reqObj, coordRoot) {
  // fd-bound re-read (DUR-J item 6 / AUDIT-sha256File: sha256File itself is
  // planPath-only -- every coordination-record digest must come from its own
  // accredited fd-bound read, never a second raw by-path hash).
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  });
  if (acceptedObj.request_digest !== reqRec.digest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result request_digest does not match the real request.json bytes');
  }
  if (acceptedObj.routing_policy_digest !== reqObj.routing_policy_digest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result routing_policy_digest does not match the real request');
  }
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (acceptedObj.accepted_attempt_id !== auth.attemptId || acceptedObj.accepted_lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result accepted_attempt_id/accepted_lease_epoch is not the current authoritative pair');
  }
  const expectedCandidatePath = resultPathFor(txnDir, acceptedObj.accepted_attempt_id);
  const expectedCandidateRelative = 'results/' + path.basename(expectedCandidatePath);
  if (acceptedObj.candidate_result_path !== expectedCandidateRelative) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result candidate_result_path is not the canonical path for its own accepted_attempt_id');
  }
  const { digest: candidateDigest } = validateResultV2(expectedCandidatePath, coordRoot);
  if (acceptedObj.result_digest !== candidateDigest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result result_digest does not match the real candidate result bytes');
  }
}

/**
 * HARD NO-GO (round 18, REVERSED round 19): a narrower, request-digest-only
 * correlator briefly lived here (assertAcceptedResultTiedToTransaction),
 * reasoning that assertAcceptedResultCorrelates's stricter
 * accepted_attempt_id/accepted_lease_epoch check was "the wrong fit" because
 * a legitimate accepted-result for a NOW-SUPERSEDED attempt could still make
 * the transaction terminal (PLAN.md ~L704's "terminal records are never
 * deleted" framing). That premise does not survive PLAN's own transition
 * table: `ACCEPTED` (~L698) has no outgoing transition -- takeover is only
 * ever legal from `PUBLISHED`/`CLAIMED` (~L696/~L700) -- and cmdAcceptResult
 * itself only ever durably constructs accepted-result.json after validating
 * the candidate against the CURRENT authoritative attempt/epoch under the
 * SAME lock a takeover uses. No PLAN-legal history ever produces a durable
 * accepted-result.json whose accepted_attempt_id later diverges from a
 * fresh resolveAuthoritativeAttempt() re-resolution -- there is no
 * legitimate cross-attempt case to protect. The round-18 test that motivated
 * the narrower check (a hand-planted accepted-result for a fabricated
 * `other_aid`, with no takeover.json ever making it authoritative) is not an
 * instance of that hypothetical case -- it is indistinguishable from a
 * forged artifact, and the narrower check let it (and any forgery copying
 * only the public, non-secret request_digest while fabricating attempt_id/
 * candidate_result_path/result_digest/routing_policy_digest) through as
 * ordinary "already accepted" rather than a rejected correlation.
 * cmdCancel/cmdAcceptResult/cmdPublishResult now call the SAME
 * assertAcceptedResultCorrelates every other authoritative surface
 * (cmdAwaitResult, cmdTransactionAck -- AUTH-06/07) already uses: one
 * authority contract, not two.
 */

// ─────────────────────────────────────────────────────────────────────────────
// `ack` (record #8) -- field table PLAN.md ~L453-462
// ─────────────────────────────────────────────────────────────────────────────

const ACK_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/ack/v1' },
  disposition: { check: isEnum(['accepted', 'blocked']) },
  in_reply_to_attempt_id: { check: isHexId },
  acked_at: { check: isIsoTimestamp },
};

function validateAckV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACK_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

const CONSULTATION_DEPENDENCY_KEYS = Object.freeze(
  ['accepted_result_digest', 'from_role', 'request_id', 'result_digest'].sort(),
);

/**
 * M6/M7 terminal functional closure, point F: the ONE canonical
 * consultation_dependencies validator, reused both immediately before a
 * terminal result publishes (hostBridgePublishTerminalResult) and every time
 * validateResultV2 reopens an already-published result. Structural/shape
 * checks (<=2 entries, exact key set) always run first; each entry is then
 * fully reopened -- child request, its accepted-result (which itself
 * re-derives and cross-checks the authoritative candidate result via
 * assertAcceptedResultCorrelates), and its ack -- never trusted from the
 * caller-supplied digests alone. Fails closed (throws) on any mismatch,
 * missing/foreign artifact, wrong from_role, duplicate dependency, or a
 * disposition other than 'accepted'.
 *
 * `evidenceAuthority` (optional; the same { policy, libraryId } resolveRootEvidenceAuthority
 * returns), when supplied and `policy === 'context7-required'` and
 * `reqObj.target_role !== 'context-provider'` (i.e. reqObj is the reporting
 * architect's own result, not the context-provider child's), additionally
 * enforces the architect-side half of point F: exactly one dependency,
 * sourced from context-provider, whose child question is byte-identical to
 * the parent's own required question (preserving any embedded
 * APPROVED_CONTEXT7_LIBRARY_ID line end to end).
 */
function validateConsultationDependencySet(dependencies, reqObj, planRoot, coordRoot, evidenceAuthority) {
  if (!Array.isArray(dependencies) || dependencies.length > 2) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'consultation dependency set is invalid');
  }
  const seenRequestIds = new Set();
  const childReqObjs = [];
  for (const dep of dependencies) {
    if (
      !dep || typeof dep !== 'object' || Array.isArray(dep) || !hasExactKeys(dep, CONSULTATION_DEPENDENCY_KEYS)
      || !isHexId(dep.request_id) || !isHex64(dep.accepted_result_digest) || !isHex64(dep.result_digest)
      || !isNonEmptyString(dep.from_role)
    ) throw new CliError('INVALID', 'SCHEMA_INVALID', 'consultation dependency shape invalid');
    if (seenRequestIds.has(dep.request_id)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency request_id is duplicated');
    }
    seenRequestIds.add(dep.request_id);

    const childRequestPath = requestPathFor(planRoot, dep.request_id);
    const childReqRec = readCanonicalRequestRecord(childRequestPath, dep.request_id, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'consultation dependency child request does not resolve',
    });
    const childReqObj = childReqRec.obj;
    if (
      childReqObj.parent_request_id !== reqObj.request_id || childReqObj.root_request_id !== reqObj.root_request_id
      || childReqObj.depth !== reqObj.depth + 1 || childReqObj.source_role !== reqObj.target_role
      || childReqObj.target_role !== dep.from_role
      || childReqObj.plan_digest !== reqObj.plan_digest || childReqObj.subject_scope_digest !== reqObj.subject_scope_digest
      || childReqObj.subject_repo_id !== reqObj.subject_repo_id || childReqObj.subject_worktree_id !== reqObj.subject_worktree_id
      || childReqObj.subject_head !== reqObj.subject_head
      || childReqObj.routing_policy_version !== reqObj.routing_policy_version
      || childReqObj.routing_policy_digest !== reqObj.routing_policy_digest
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency child request does not correlate to its parent');
    childReqObjs.push(childReqObj);

    const childTxnDir = path.dirname(childRequestPath);
    const childAcceptedPath = acceptedResultPathFor(childTxnDir);
    const childAcceptedRec = readClosedRecord(childAcceptedPath, ACCEPTED_RESULT_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'consultation dependency accepted-result does not resolve',
    });
    assertAcceptedResultCorrelates(childAcceptedRec.obj, childTxnDir, childReqObj, coordRoot);
    if (
      childAcceptedRec.digest !== dep.accepted_result_digest
      || childAcceptedRec.obj.result_digest !== dep.result_digest
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency accepted-result does not match its declared digests');

    const childAckPath = ackPathFor(childTxnDir);
    const childAckRec = readClosedRecord(childAckPath, ACK_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID', absentMessage: 'consultation dependency ack does not resolve',
    });
    if (
      childAckRec.obj.disposition !== 'accepted'
      || childAckRec.obj.in_reply_to_attempt_id !== childAcceptedRec.obj.accepted_attempt_id
    ) throw new CliError('INVALID', 'CORRELATION_INVALID', 'consultation dependency ack is not an accepted disposition for the current attempt');
  }
  if (
    evidenceAuthority && (evidenceAuthority.policy === 'context7-required' || evidenceAuthority.policy === 'context7-preferred')
    && reqObj.target_role !== 'context-provider'
  ) {
    if (dependencies.length !== 1 || dependencies[0].from_role !== 'context-provider') {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required architect result must have exactly one context-provider consultation dependency');
    }
    if (childReqObjs[0].question !== reqObj.question) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'context7-required child question does not preserve the required question');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

  return {
    RESULT_V2_FIELDS,
    RESULT_MIRRORED_REQUEST_FIELDS,
    assertResultMirrorsRequest,
    validateResultV2,
    ACCEPTED_RESULT_V1_FIELDS,
    validateAcceptedResultV1,
    assertAcceptedResultCorrelates,
    ACK_V1_FIELDS,
    validateAckV1,
    CONSULTATION_DEPENDENCY_KEYS,
    validateConsultationDependencySet,
  };
}

module.exports = { createResultsProtocol };
