'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: root-consult-review
// and P5 mixed-review-verdict closed-shape validators, the mixed-review
// readback receipt builder, and its live read seam. Depends one-way on
// root-consult-records.cjs and p2-subject-bundle.cjs (injected).
// retainedSupervisorBridgeApi and mixedReviewSubjectPathFor/
// mixedReviewVerdictPathFor are injected (defined in the not-yet-extracted
// ensure zone and prep-publication-records.cjs respectively -- forward
// references, never a require() cycle). Never requires the facade or a
// sibling module.

function createMixedReviewRecords({
  Buffer, isHexCsprng32, isHexDigest64, isCanonicalIsoUtc, isSafeP2SubjectPath, hasExactKeys,
  sha256String, canonicalJSONStringify, validateRootConsultIntentRecord, readRootConsultIntent,
  path, discoverPlan, computeWorktreeId, readRegistryRecord, mixedReviewSubjectPathFor,
  mixedReviewVerdictPathFor, readRoleBindingState, roleProfileDigestFor, retainedSupervisorBridgeApi,
  nowIsoForRegistry,
}) {
// ── R131 P2 GREEN-A2a: generic closed-shape PREP-binding record validators ──
// Pure, side-effect-free validators for the three P2 PREP-binding record
// schemas (root-consult review, PREP publication intent, PREP publication
// receipt). Each is a closed-shape check ONLY -- reservation, PREP grammar,
// completion and conflict transitions are separate, later seams.

const ROOT_CONSULT_REVIEW_SCHEMA = 'runtime/root-consult-review/v1';
const ROOT_CONSULT_REVIEW_KEYS = Object.freeze([
  'schema', 'intent_id', 'binding_id', 'requester_actor_instance_id',
  'session_generation_id', 'thread_id', 'resume_request_id',
  'cp_completion_digest', 'subject_bundle_ref', 'subject_scope_digest',
  'decision', 'reviewed_at',
]);
const ROOT_CONSULT_REVIEW_DECISIONS = Object.freeze(['APPROVED_PREP', 'REJECTED', 'INCONCLUSIVE']);
const ROOT_CONSULT_REVIEW_CORRELATED_FIELDS = Object.freeze([
  'intent_id', 'binding_id', 'requester_actor_instance_id', 'session_generation_id',
  'thread_id', 'resume_request_id', 'cp_completion_digest', 'subject_bundle_ref',
  'subject_scope_digest',
]);

/**
 * Pure closed-shape validator for a `runtime/root-consult-review/v1` record
 * (P2-RCR-01..04). `expected` carries the caller-owned binding fields this
 * review must correlate to byte-for-byte.
 * @param {unknown} record
 * @param {object} expected
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function validateRootConsultReviewRecord(record, expected) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'root-consult-review-not-an-object' };
  }
  const keys = Object.keys(record);
  if (!ROOT_CONSULT_REVIEW_KEYS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    return { ok: false, reason: 'root-consult-review-missing-key' };
  }
  if (keys.length !== ROOT_CONSULT_REVIEW_KEYS.length) {
    return { ok: false, reason: 'root-consult-review-unexpected-key' };
  }
  if (record.schema !== ROOT_CONSULT_REVIEW_SCHEMA) return { ok: false, reason: 'root-consult-review-schema-mismatch' };
  if (!isHexCsprng32(record.intent_id)) return { ok: false, reason: 'root-consult-review-intent-id-invalid' };
  if (!isHexCsprng32(record.binding_id)) return { ok: false, reason: 'root-consult-review-binding-id-invalid' };
  if (!isHexCsprng32(record.requester_actor_instance_id)) return { ok: false, reason: 'root-consult-review-requester-actor-instance-id-invalid' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'root-consult-review-session-generation-id-invalid' };
  if (typeof record.thread_id !== 'string' || record.thread_id.length === 0 || Buffer.byteLength(record.thread_id, 'utf8') > 4096) {
    return { ok: false, reason: 'root-consult-review-thread-id-invalid' };
  }
  if (!isHexCsprng32(record.resume_request_id)) return { ok: false, reason: 'root-consult-review-resume-request-id-invalid' };
  if (record.resume_request_id === record.thread_id) return { ok: false, reason: 'root-consult-review-resume-request-id-thread-id-replay' };
  if (!isHexDigest64(record.cp_completion_digest)) return { ok: false, reason: 'root-consult-review-cp-completion-digest-invalid' };
  if (typeof record.subject_bundle_ref !== 'string' || !isSafeP2SubjectPath(record.subject_bundle_ref) || !/(?:^|\/)subject-bundles\/[0-9a-f]{64}\/manifest\.json$/.test(record.subject_bundle_ref)) {
    return { ok: false, reason: 'root-consult-review-subject-bundle-ref-invalid' };
  }
  if (!isHexDigest64(record.subject_scope_digest)) return { ok: false, reason: 'root-consult-review-subject-scope-digest-invalid' };
  if (!ROOT_CONSULT_REVIEW_DECISIONS.includes(record.decision)) return { ok: false, reason: 'root-consult-review-decision-invalid' };
  if (!isCanonicalIsoUtc(record.reviewed_at)) return { ok: false, reason: 'root-consult-review-reviewed-at-invalid' };

  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, reason: 'root-consult-review-expected-not-an-object' };
  }
  for (const field of ROOT_CONSULT_REVIEW_CORRELATED_FIELDS) {
    if (record[field] !== expected[field]) return { ok: false, reason: 'root-consult-review-' + field.replace(/_/g, '-') + '-mismatch' };
  }

  return { ok: true, record };
}

const MIXED_REVIEW_VERDICT_SCHEMA = 'runtime/mixed-review-verdict/v1';
const MIXED_REVIEW_VERDICT_KEYS = Object.freeze([
  'schema', 'intent_id', 'binding_id', 'requester_actor_instance_id',
  'session_generation_id', 'thread_id', 'resume_request_id',
  'reviewed_head', 'reviewed_subject_digest', 'subject_bundle_ref',
  'subject_scope_digest', 'decision', 'reviewed_at',
]);
const MIXED_REVIEW_VERDICT_DECISIONS = Object.freeze(['GO', 'NO_GO', 'INCONCLUSIVE']);
const MIXED_REVIEW_VERDICT_CORRELATED_FIELDS = Object.freeze([
  'intent_id', 'binding_id', 'requester_actor_instance_id', 'session_generation_id',
  'thread_id', 'resume_request_id', 'reviewed_head', 'reviewed_subject_digest',
  'subject_bundle_ref', 'subject_scope_digest',
]);

/**
 * P5 U2: pure closed-shape validator for a runtime/mixed-review-verdict/v1
 * record. expected carries the caller-owned binding fields this verdict must
 * correlate to byte-for-byte. Exact port of validateRootConsultReviewRecord's
 * rigor/order/shape: drops cp_completion_digest (no prior context-provider
 * consultation to correlate against in this flow) and adds reviewed_head
 * (40 lowercase hex)/reviewed_subject_digest (isHexDigest64) in its place.
 * @param {unknown} record
 * @param {object} expected
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function validateMixedReviewVerdictRecord(record, expected) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'mixed-review-verdict-not-an-object' };
  }
  const keys = Object.keys(record);
  if (!MIXED_REVIEW_VERDICT_KEYS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    return { ok: false, reason: 'mixed-review-verdict-missing-key' };
  }
  if (keys.length !== MIXED_REVIEW_VERDICT_KEYS.length) {
    return { ok: false, reason: 'mixed-review-verdict-unexpected-key' };
  }
  if (record.schema !== MIXED_REVIEW_VERDICT_SCHEMA) return { ok: false, reason: 'mixed-review-verdict-schema-mismatch' };
  if (!isHexCsprng32(record.intent_id)) return { ok: false, reason: 'mixed-review-verdict-intent-id-invalid' };
  if (!isHexCsprng32(record.binding_id)) return { ok: false, reason: 'mixed-review-verdict-binding-id-invalid' };
  if (!isHexCsprng32(record.requester_actor_instance_id)) return { ok: false, reason: 'mixed-review-verdict-requester-actor-instance-id-invalid' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'mixed-review-verdict-session-generation-id-invalid' };
  if (typeof record.thread_id !== 'string' || record.thread_id.length === 0 || Buffer.byteLength(record.thread_id, 'utf8') > 4096) {
    return { ok: false, reason: 'mixed-review-verdict-thread-id-invalid' };
  }
  if (!isHexCsprng32(record.resume_request_id)) return { ok: false, reason: 'mixed-review-verdict-resume-request-id-invalid' };
  if (record.resume_request_id === record.thread_id) return { ok: false, reason: 'mixed-review-verdict-resume-request-id-thread-id-replay' };
  if (typeof record.reviewed_head !== 'string' || !/^[0-9a-f]{40}$/.test(record.reviewed_head)) {
    return { ok: false, reason: 'mixed-review-verdict-reviewed-head-invalid' };
  }
  if (!isHexDigest64(record.reviewed_subject_digest)) return { ok: false, reason: 'mixed-review-verdict-reviewed-subject-digest-invalid' };
  if (typeof record.subject_bundle_ref !== 'string' || !isSafeP2SubjectPath(record.subject_bundle_ref) || !/(?:^|\/)subject-bundles\/[0-9a-f]{64}\/manifest\.json$/.test(record.subject_bundle_ref)) {
    return { ok: false, reason: 'mixed-review-verdict-subject-bundle-ref-invalid' };
  }
  if (!isHexDigest64(record.subject_scope_digest)) return { ok: false, reason: 'mixed-review-verdict-subject-scope-digest-invalid' };
  if (!MIXED_REVIEW_VERDICT_DECISIONS.includes(record.decision)) return { ok: false, reason: 'mixed-review-verdict-decision-invalid' };
  if (!isCanonicalIsoUtc(record.reviewed_at)) return { ok: false, reason: 'mixed-review-verdict-reviewed-at-invalid' };

  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, reason: 'mixed-review-verdict-expected-not-an-object' };
  }
  for (const field of MIXED_REVIEW_VERDICT_CORRELATED_FIELDS) {
    if (record[field] !== expected[field]) return { ok: false, reason: 'mixed-review-verdict-' + field.replace(/_/g, '-') + '-mismatch' };
  }

  return { ok: true, record };
}

const MIXED_REVIEW_READBACK_SCHEMA = 'runtime/mixed-review-readback/v1';
const MIXED_REVIEW_READBACK_KEYS = Object.freeze([
  'schema', 'request_digest', 'verdict_digest', 'subject_digest',
  'requester_actor_digest', 'reviewer_actor_digest', 'outcome',
  'checked_at', 'validation_passed',
].sort());

/**
 * Build the non-authoritative P5 audit receipt only after independently
 * derived request, subject, requester and reviewer records validate the
 * verdict. No expected field is copied from the verdict under review.
 */
function buildMixedReviewReadbackReceipt(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'mixed-review-readback-input-invalid' };
  }
  const { intent, subject, requesterBinding, reviewerWorker, verdict, checkedAt } = input;
  const intentValid = validateRootConsultIntentRecord(intent);
  if (!intentValid.ok || intent.expected_result_kind !== 'P5_MIXED_REVIEW_VERDICT') {
    return { ok: false, reason: 'mixed-review-readback-intent-invalid' };
  }
  if (!subject || !hasExactKeys(subject, ['digest', 'schema', 'text'])
      || subject.schema !== 'runtime/mixed-review-subject/v1'
      || typeof subject.text !== 'string' || sha256String(subject.text) !== subject.digest) {
    return { ok: false, reason: 'mixed-review-readback-subject-invalid' };
  }
  if (!requesterBinding || typeof requesterBinding !== 'object'
      || requesterBinding.binding_id !== intent.requester_binding_id
      || requesterBinding.role !== intent.requester_role
      || requesterBinding.driver !== 'claude-sendmessage'
      || requesterBinding.worktree_id !== intent.worktree_id
      || requesterBinding.plan_digest !== intent.plan_digest
      || requesterBinding.session_generation_id !== intent.session_generation_id) {
    return { ok: false, reason: 'mixed-review-readback-requester-invalid' };
  }
  if (!reviewerWorker || typeof reviewerWorker !== 'object'
      || reviewerWorker.role !== intent.target_role
      || reviewerWorker.worktreeId !== intent.worktree_id
      || reviewerWorker.planDigest !== intent.plan_digest
      || reviewerWorker.sessionGenerationId !== intent.session_generation_id
      || !isHexCsprng32(reviewerWorker.bindingId)
      || !isHexCsprng32(reviewerWorker.workerSessionId)
      || typeof reviewerWorker.threadId !== 'string' || reviewerWorker.threadId.length === 0) {
    return { ok: false, reason: 'mixed-review-readback-reviewer-invalid' };
  }
  const expected = {
    intent_id: intent.intent_id,
    binding_id: intent.main_binding_id,
    requester_actor_instance_id: intent.requester_actor_instance_id,
    session_generation_id: intent.session_generation_id,
    thread_id: reviewerWorker.threadId,
    resume_request_id: intent.request_id,
    reviewed_head: intent.subject_head,
    reviewed_subject_digest: subject.digest,
    subject_bundle_ref: intent.subject_bundle_ref,
    subject_scope_digest: intent.subject_scope_digest,
  };
  const verdictValid = validateMixedReviewVerdictRecord(verdict, expected);
  if (!verdictValid.ok) return { ok: false, reason: verdictValid.reason };
  if (!isCanonicalIsoUtc(checkedAt)) return { ok: false, reason: 'mixed-review-readback-checked-at-invalid' };
  const reviewerIdentity = {
    action_id: reviewerWorker.actionId,
    binding_id: reviewerWorker.bindingId,
    role: reviewerWorker.role,
    session_generation_id: reviewerWorker.sessionGenerationId,
    supervisor_instance_id: reviewerWorker.supervisorInstanceId,
    thread_id: reviewerWorker.threadId,
    worker_session_id: reviewerWorker.workerSessionId,
    worktree_id: reviewerWorker.worktreeId,
  };
  const record = {
    schema: MIXED_REVIEW_READBACK_SCHEMA,
    request_digest: sha256String(canonicalJSONStringify(intentValid.record)),
    verdict_digest: sha256String(canonicalJSONStringify(verdictValid.record)),
    subject_digest: subject.digest,
    requester_actor_digest: sha256String(canonicalJSONStringify(requesterBinding)),
    reviewer_actor_digest: sha256String(canonicalJSONStringify(reviewerIdentity)),
    outcome: verdictValid.record.decision,
    checked_at: checkedAt,
    validation_passed: true,
  };
  if (!hasExactKeys(record, MIXED_REVIEW_READBACK_KEYS)) {
    return { ok: false, reason: 'mixed-review-readback-shape-invalid' };
  }
  return { ok: true, record, verdict: verdictValid.record };
}

/** Read and validate the complete live P5 receipt input without mutation. */
function readMixedReviewReadback(projectRoot, intentId) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot) || !isHexCsprng32(intentId)) {
    return { ok: false, reason: 'mixed-review-readback-scope-invalid' };
  }
  const plan = discoverPlan(projectRoot);
  const intentRead = readRootConsultIntent(projectRoot, intentId);
  if (!plan.ok || !intentRead.ok || intentRead.absent) {
    return { ok: false, reason: 'mixed-review-readback-intent-unavailable' };
  }
  const intent = intentRead.intent;
  if (intent.plan_digest !== plan.planDigest || intent.worktree_id !== computeWorktreeId(projectRoot)) {
    return { ok: false, reason: 'mixed-review-readback-scope-mismatch' };
  }
  const subjectRead = readRegistryRecord(mixedReviewSubjectPathFor(projectRoot, intentId));
  const verdictRead = readRegistryRecord(mixedReviewVerdictPathFor(projectRoot, intentId));
  if (!subjectRead.ok || subjectRead.absent || !verdictRead.ok || verdictRead.absent) {
    return { ok: false, reason: 'mixed-review-readback-artifact-unavailable' };
  }
  const requester = readRoleBindingState(
    projectRoot, intent.worktree_id, intent.plan_digest,
    roleProfileDigestFor(intent.requester_role), intent.session_generation_id,
    intent.requester_role,
  );
  if (!requester.ok || !requester.record || !['READY', 'WAITING', 'BUSY'].includes(requester.state)) {
    return { ok: false, reason: 'mixed-review-readback-requester-unavailable' };
  }
  let bridge;
  try { bridge = retainedSupervisorBridgeApi(); }
  catch (err) { return { ok: false, reason: 'mixed-review-readback-reviewer-unavailable' }; }
  const reviewer = bridge.resolveLiveCodexAppServerWorker(
    projectRoot, intent.target_role, roleProfileDigestFor(intent.target_role),
  );
  if (!reviewer || !reviewer.ok || !reviewer.available) {
    return { ok: false, reason: 'mixed-review-readback-reviewer-unavailable' };
  }
  return buildMixedReviewReadbackReceipt({
    intent,
    subject: subjectRead.obj,
    requesterBinding: requester.record,
    reviewerWorker: reviewer.worker,
    verdict: verdictRead.obj,
    checkedAt: nowIsoForRegistry(),
  });
}

  return Object.freeze({
    ROOT_CONSULT_REVIEW_SCHEMA, ROOT_CONSULT_REVIEW_KEYS, ROOT_CONSULT_REVIEW_DECISIONS,
    ROOT_CONSULT_REVIEW_CORRELATED_FIELDS, validateRootConsultReviewRecord,
    MIXED_REVIEW_VERDICT_SCHEMA, MIXED_REVIEW_VERDICT_KEYS, MIXED_REVIEW_VERDICT_DECISIONS,
    MIXED_REVIEW_VERDICT_CORRELATED_FIELDS, validateMixedReviewVerdictRecord,
    MIXED_REVIEW_READBACK_SCHEMA, MIXED_REVIEW_READBACK_KEYS, buildMixedReviewReadbackReceipt,
    readMixedReviewReadback,
  });
}

module.exports = { createMixedReviewRecords };
