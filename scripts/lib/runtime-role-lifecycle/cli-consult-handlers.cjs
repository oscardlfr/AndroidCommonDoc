'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the consult-root,
// mixed-review-request, and consult-root-status CLI subcommand handlers.
// Never requires the facade or a sibling module.

function createCliConsultHandlers({
path, fs, crypto, Buffer, canonicalJSONStringify, sha256String, gitRevParse, publishNoClobber,
  currentClockMsForRegistry, isoToMsForRegistry, nowIsoForRegistry, registryRepoDir,
  SUBCOMMAND_SPEC, parseSubcommandArgv, RC, usageError, invalidError, unavailableError, emitAndExit, makeResult, makeOperation,
  reportRetainedPairRejection, decodeRootConsultIntent, decodeMixedReviewIntent,
  s16ResolveMainContext, s16ResolveRetainedPair, s16ResolveMixedReviewPair, s16MaterializeArchitectSubjectBundle,
  s16ConsultationApi, s16ReadOptionalValidated,
  computeCoordinationRootIdFromPath, ROOT_CONSULT_INTENT_SCHEMA, validateRootConsultIntentRecord,
  rootConsultIntentPathFor, rootConsultReservationPathFor, rootConsultPublishedPathFor, rootConsultCompletionPathFor,
  validateRootConsultReservationRecord, validateRootConsultPublishedRecord, validateRootConsultCompletionRecord,
  readRootConsultIntent, mixedReviewSubjectPathFor, MIXED_REVIEW_SUBJECT_MAX_BYTES,
}) {

function handleConsultRoot(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['consult-root']);
  if (!parsed.ok || !path.isAbsolute(parsed.values['--project-root'])) { usageError('consult-root'); return; }
  const projectRoot = parsed.values['--project-root'];
  const encodedIntent = parsed.values['--intent'];
  const decoded = decodeRootConsultIntent(encodedIntent);
  if (!decoded.ok) { invalidError('consult-root', 'POLICY_INVALID'); return; }
  const intentInput = decoded.intent;
  const context = s16ResolveMainContext(
    projectRoot, parsed.values['--lifecycle-binding'], sha256String('consult-root:' + encodedIntent),
    intentInput.requester_role, 'consult-root', null, true,
  );
  if (!context.ok) { invalidError('consult-root', 'IDENTITY_MISMATCH'); return; }

  // Every authority/liveness/topology prerequisite is revalidated before the
  // first canonical artifact or host-registry byte is materialized.
  const retained = s16ResolveRetainedPair(projectRoot, context, intentInput.requester_role, intentInput.target_role);
  if (!retained.ok) {
    reportRetainedPairRejection('consult-root', retained);
    unavailableError('consult-root', 'CAPABILITY_UNAVAILABLE');
    return;
  }
  const artifacts = s16MaterializeArchitectSubjectBundle(projectRoot, context, intentInput.requester_role);
  if (!artifacts.ok) { invalidError('consult-root', 'DURABILITY_UNPROVEN'); return; }

  const api = s16ConsultationApi();
  const nowStr = nowIsoForRegistry();
  // §16a: the intent's own activation lifetime is <=30s, independent of the
  // (up to 3600s) request_expiry. This governs ONLY whether the source's WAL
  // may still RESERVE the intent (rootConsultIntentContext in
  // runtime-consultation.cjs); once reserved, continued work is bound to
  // request_expiry instead and is never re-blocked by this window. NO-GO
  // Correction A -- a prior fix here widened this to 300s, which both
  // violates the frozen <=30s cap and is unnecessary once the reservation-
  // vs-request_expiry state machine is correct.
  const activationExpiryMs = Math.min(currentClockMsForRegistry() + 30 * 1000, isoToMsForRegistry(context.requestExpiry));
  const intentId = crypto.randomBytes(16).toString('hex');
  const requestId = crypto.randomBytes(16).toString('hex');
  const record = {
    schema: ROOT_CONSULT_INTENT_SCHEMA,
    intent_id: intentId,
    main_binding_id: context.binding.binding_id,
    main_actor_instance_id: context.binding.actor_instance_id,
    session_generation_id: context.generation.generationId,
    repo_id: context.repoId,
    worktree_id: context.worktreeId,
    plan_digest: context.plan.planDigest,
    coordination_root_id: computeCoordinationRootIdFromPath(context.coordRoot),
    requester_role: intentInput.requester_role,
    requester_binding_id: retained.source.bindingId,
    requester_actor_instance_id: retained.source.workerSessionId,
    target_role: intentInput.target_role,
    target_role_profile_version: '1.0.0',
    target_role_profile_digest: typeof api.targetRoleProfileDigestFor === 'function'
      ? api.targetRoleProfileDigestFor(intentInput.target_role)
      : sha256String('runtime-consultation/wp1-target-role-profile:' + intentInput.target_role),
    question: intentInput.question,
    expected_result_kind: intentInput.expected_result_kind,
    evidence_policy: intentInput.evidence_policy,
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: artifacts.routingDigest,
    subject_repo_id: context.repoId,
    subject_worktree_id: context.worktreeId,
    subject_head: gitRevParse(projectRoot, ['rev-parse', 'HEAD']),
    subject_bundle_ref: artifacts.subjectBundleRef,
    subject_scope_digest: artifacts.subjectScopeDigest,
    request_id: requestId,
    initial_attempt_id: crypto.randomBytes(16).toString('hex'),
    request_created_at: nowStr,
    request_expiry: context.requestExpiry,
    created_at: nowStr,
    expiry: new Date(activationExpiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const valid = validateRootConsultIntentRecord(record, { intent_id: intentId });
  if (!valid.ok) { invalidError('consult-root', 'INTERNAL_ERROR'); return; }
  try {
    publishNoClobber(rootConsultIntentPathFor(projectRoot, intentId), Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) { invalidError('consult-root', 'DURABILITY_UNPROVEN'); return; }
  emitAndExit(makeResult(
    'consult-root', RC.OK, 'WAITING', 'NONE', [], [],
    makeOperation('root-consult', intentId, 'WAITING', { request_id: requestId }),
  ));
}

/**
 * P5 U2 live-wiring: `mixed-review-request` CLI subcommand. Structurally
 * mirrors handleConsultRoot exactly, with two differences: s16ResolveMixedReviewPair
 * instead of s16ResolveRetainedPair (Claude-native requester, retained-Codex
 * target), and the reviewed subject text is read from --subject-text-file
 * and durably published as its own blob BEFORE the intent (never reused
 * from subject_bundle_ref, which stays the always-empty P2-outside sentinel
 * here exactly as it already is for plain P5 U2 turns).
 * @param {string[]} rawArgv
 */
function handleMixedReviewRequest(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['mixed-review-request']);
  if (!parsed.ok || !path.isAbsolute(parsed.values['--project-root'])) { usageError('mixed-review-request'); return; }
  const projectRoot = parsed.values['--project-root'];
  const encodedIntent = parsed.values['--intent'];
  const decoded = decodeMixedReviewIntent(encodedIntent);
  if (!decoded.ok) { invalidError('mixed-review-request', 'POLICY_INVALID'); return; }
  const intentInput = decoded.intent;

  const subjectTextFile = parsed.values['--subject-text-file'];
  if (!path.isAbsolute(subjectTextFile)) { usageError('mixed-review-request'); return; }
  let subjectText;
  let subjectFd;
  try {
    subjectFd = fs.openSync(subjectTextFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(subjectFd);
    if (!st.isFile() || st.size === 0 || st.size > MIXED_REVIEW_SUBJECT_MAX_BYTES) {
      invalidError('mixed-review-request', 'POLICY_INVALID'); return;
    }
    const buf = fs.readFileSync(subjectFd);
    subjectText = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (err) {
    invalidError('mixed-review-request', 'POLICY_INVALID'); return;
  } finally {
    if (subjectFd !== undefined) { try { fs.closeSync(subjectFd); } catch (err) { /* best-effort close */ } }
  }

  const context = s16ResolveMainContext(
    projectRoot, parsed.values['--lifecycle-binding'], sha256String('mixed-review-request:' + encodedIntent),
    intentInput.requester_role, 'mixed-review-request', null, true,
  );
  if (!context.ok) { invalidError('mixed-review-request', 'IDENTITY_MISMATCH'); return; }

  // Every authority/liveness/topology prerequisite is revalidated before the
  // first canonical artifact or host-registry byte is materialized (mirrors
  // handleConsultRoot's own comment/ordering exactly).
  const retained = s16ResolveMixedReviewPair(projectRoot, context, intentInput.requester_role, intentInput.target_role);
  if (!retained.ok) {
    reportRetainedPairRejection('mixed-review-request', retained);
    unavailableError('mixed-review-request', 'CAPABILITY_UNAVAILABLE');
    return;
  }
  const artifacts = s16MaterializeArchitectSubjectBundle(projectRoot, context, intentInput.requester_role);
  if (!artifacts.ok) { invalidError('mixed-review-request', 'DURABILITY_UNPROVEN'); return; }

  const intentId = crypto.randomBytes(16).toString('hex');
  const digest = sha256String(subjectText);
  try {
    publishNoClobber(
      mixedReviewSubjectPathFor(projectRoot, intentId),
      Buffer.from(canonicalJSONStringify({ schema: 'runtime/mixed-review-subject/v1', text: subjectText, digest }), 'utf8'), {},
    );
  } catch (err) { invalidError('mixed-review-request', 'DURABILITY_UNPROVEN'); return; }

  const api = s16ConsultationApi();
  const nowStr = nowIsoForRegistry();
  const activationExpiryMs = Math.min(currentClockMsForRegistry() + 30 * 1000, isoToMsForRegistry(context.requestExpiry));
  const requestId = crypto.randomBytes(16).toString('hex');
  const record = {
    schema: ROOT_CONSULT_INTENT_SCHEMA,
    intent_id: intentId,
    main_binding_id: context.binding.binding_id,
    main_actor_instance_id: context.binding.actor_instance_id,
    session_generation_id: context.generation.generationId,
    repo_id: context.repoId,
    worktree_id: context.worktreeId,
    plan_digest: context.plan.planDigest,
    coordination_root_id: computeCoordinationRootIdFromPath(context.coordRoot),
    requester_role: intentInput.requester_role,
    requester_binding_id: retained.requesterBindingId,
    requester_actor_instance_id: retained.requesterActorInstanceId,
    target_role: intentInput.target_role,
    target_role_profile_version: '1.0.0',
    target_role_profile_digest: typeof api.targetRoleProfileDigestFor === 'function'
      ? api.targetRoleProfileDigestFor(intentInput.target_role)
      : sha256String('runtime-consultation/wp1-target-role-profile:' + intentInput.target_role),
    question: intentInput.question,
    expected_result_kind: 'P5_MIXED_REVIEW_VERDICT',
    evidence_policy: 'none',
    routing_policy_version: 'runtime-routing/v1',
    routing_policy_digest: artifacts.routingDigest,
    subject_repo_id: context.repoId,
    subject_worktree_id: context.worktreeId,
    subject_head: intentInput.reviewed_head,
    subject_bundle_ref: artifacts.subjectBundleRef,
    subject_scope_digest: artifacts.subjectScopeDigest,
    request_id: requestId,
    initial_attempt_id: crypto.randomBytes(16).toString('hex'),
    request_created_at: nowStr,
    request_expiry: context.requestExpiry,
    created_at: nowStr,
    expiry: new Date(activationExpiryMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const valid = validateRootConsultIntentRecord(record, { intent_id: intentId });
  if (!valid.ok) { invalidError('mixed-review-request', 'INTERNAL_ERROR'); return; }
  try {
    publishNoClobber(rootConsultIntentPathFor(projectRoot, intentId), Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) { invalidError('mixed-review-request', 'DURABILITY_UNPROVEN'); return; }
  emitAndExit(makeResult(
    'mixed-review-request', RC.OK, 'WAITING', 'NONE', [], [],
    makeOperation('mixed-review-request', intentId, 'WAITING', { request_id: requestId }),
  ));
}

function handleConsultRootStatus(rawArgv) {
  const parsed = parseSubcommandArgv(rawArgv, SUBCOMMAND_SPEC['consult-root-status']);
  if (!parsed.ok || !path.isAbsolute(parsed.values['--project-root'])) { usageError('consult-root-status'); return; }
  const projectRoot = parsed.values['--project-root'];
  const intentId = parsed.values['--intent-id'];
  const intentRead = readRootConsultIntent(projectRoot, intentId);
  if (!intentRead.ok || intentRead.absent) { invalidError('consult-root-status', 'IDENTITY_MISMATCH'); return; }
  const intent = intentRead.intent;
  const context = s16ResolveMainContext(
    projectRoot, parsed.values['--lifecycle-binding'], sha256String('consult-root-status:' + intentId),
    intent.requester_role, 'consult-root-status', null, false,
  );
  if (!context.ok || context.binding.binding_id !== intent.main_binding_id
      || context.binding.actor_instance_id !== intent.main_actor_instance_id
      || context.generation.generationId !== intent.session_generation_id) {
    invalidError('consult-root-status', 'IDENTITY_MISMATCH'); return;
  }
  const intentDigest = sha256String(canonicalJSONStringify(intent));
  const reservation = s16ReadOptionalValidated(
    rootConsultReservationPathFor(projectRoot, intentId), validateRootConsultReservationRecord,
    { intent_id: intentId, intent_digest: intentDigest, request_id: intent.request_id, requester_actor_instance_id: intent.requester_actor_instance_id },
  );
  const published = s16ReadOptionalValidated(
    rootConsultPublishedPathFor(projectRoot, intentId), validateRootConsultPublishedRecord,
    { intent_id: intentId, intent_digest: intentDigest, request_id: intent.request_id },
  );
  const completion = s16ReadOptionalValidated(
    rootConsultCompletionPathFor(projectRoot, intentId), validateRootConsultCompletionRecord,
    { intent_id: intentId, request_id: intent.request_id, requester_actor_instance_id: intent.requester_actor_instance_id },
  );
  if (!reservation.ok || !published.ok || !completion.ok
      || (!published.absent && reservation.absent) || (!completion.absent && published.absent)
      || (!published.absent && published.record.reservation_digest !== reservation.digest)
      || (!completion.absent && completion.record.request_digest !== published.record.request_digest)) {
    emitAndExit(makeResult('consult-root-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-consult', intentId, 'BLOCKED', { request_id: intent.request_id })));
    return;
  }
  if (!completion.absent) {
    const c = completion.record;
    emitAndExit(makeResult('consult-root-status', RC.OK, 'READY', 'NONE', [], [], makeOperation('root-consult', intentId, 'READY', {
      request_id: c.request_id, request_ref: published.record.request_ref, request_digest: c.request_digest,
      result_ref: c.result_ref, result_digest: c.result_digest,
      accepted_result_ref: c.accepted_result_ref, accepted_result_digest: c.accepted_result_digest,
      ack_ref: c.ack_ref, ack_digest: c.ack_digest,
    })));
    return;
  }
  const terminalApi = s16ConsultationApi();
  if (!terminalApi || typeof terminalApi.readRootConsultTerminalStatus !== 'function') {
    emitAndExit(makeResult('consult-root-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-consult', intentId, 'BLOCKED', { request_id: intent.request_id })));
    return;
  }
  const terminal = terminalApi.readRootConsultTerminalStatus(projectRoot, intent);
  if (!terminal || terminal.ok !== true) {
    emitAndExit(makeResult('consult-root-status', RC.OK, 'BLOCKED', 'DURABILITY_UNPROVEN', [], [], makeOperation('root-consult', intentId, 'BLOCKED', { request_id: intent.request_id })));
    return;
  }
  if (terminal.state === 'BLOCKED') {
    emitAndExit(makeResult('consult-root-status', RC.OK, 'BLOCKED', 'NONE', [], [], makeOperation('root-consult', intentId, 'BLOCKED', {
      request_id: intent.request_id,
      request_ref: terminal.request_ref, request_digest: terminal.request_digest,
      result_ref: terminal.result_ref, result_digest: terminal.result_digest,
      ack_ref: terminal.ack_ref, ack_digest: terminal.ack_digest,
    })));
    return;
  }
  const retained = s16ResolveRetainedPair(projectRoot, context, intent.requester_role, intent.target_role);
  // NO-GO Correction A: intent.expiry (<=30s) gates ONLY the pre-reservation
  // activation step -- once reservation exists, this status read must not
  // itself report BLOCKED merely because more than 30s has elapsed (the
  // retained worker's own hostBridgeAdvanceRootConsult/
  // hostBridgeObserveAndCompleteRootConsult keep working past that window
  // once reserved, bound by request_expiry instead; see
  // rootConsultIntentContext in runtime-consultation.cjs for the mirrored
  // gate). Checking `published.absent` here would still wrongly re-apply
  // the 30s window to an intent that reserved in time but has not yet
  // published (a real, if narrow, WAL-recovery window).
  if (!retained.ok || retained.source.workerSessionId !== intent.requester_actor_instance_id
      || retained.source.bindingId !== intent.requester_binding_id
      || (reservation.absent && currentClockMsForRegistry() >= isoToMsForRegistry(intent.expiry))) {
    emitAndExit(makeResult('consult-root-status', RC.OK, 'BLOCKED', 'NONE', [], [], makeOperation('root-consult', intentId, 'BLOCKED', { request_id: intent.request_id })));
    return;
  }
  emitAndExit(makeResult('consult-root-status', RC.OK, 'WAITING', 'NONE', [], [], makeOperation('root-consult', intentId, 'WAITING', {
    request_id: intent.request_id,
    request_ref: published.absent ? null : published.record.request_ref,
    request_digest: published.absent ? null : published.record.request_digest,
  })));
}

  return Object.freeze({
handleConsultRoot, handleMixedReviewRequest, handleConsultRootStatus,
  });
}

module.exports = { createCliConsultHandlers };
