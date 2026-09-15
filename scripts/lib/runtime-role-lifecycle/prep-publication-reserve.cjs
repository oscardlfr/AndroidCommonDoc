'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the fake-host-executor
// dispatch table plus the PREP-publication reservation seam (P2 GREEN-A2b) --
// predecessor-completion revalidation and the reservePrepPublicationIntent
// mint gate. Never requires the facade or a sibling module.

function createPrepPublicationReserve({
path, registryRepoDir, readRegistryRecord, publishNoClobber, canonicalJSONStringify, sha256String,
  sha256Buffer, gitRevParse, classifyDurableRead, DURABLE_PRESENT, isSafeP2SubjectPath, isHexCsprng32,
  currentClockMsForRegistry, isoToMsForRegistry, nowIsoForRegistry, futureIsoForRegistry, fs, crypto,
  discoverPlan, computeRepoId, computeWorktreeId, resolvePolicyPair, retainedSupervisorBridgeApi,
  roleProfileDigestFor, readRoleBindingState, validateRootConsultIntentRecord,
  validateRootConsultCompletionRecord, validateRootConsultReviewRecord, validatePrepPublicationIntentRecord,
  validatePrepPublicationReceiptRecord, PREP_PUBLICATION_INTENT_SCHEMA, P2_SUBJECT_BUNDLE_SEED_ROLES,
  rootConsultIntentPathFor, rootConsultCompletionPathFor, rootConsultReviewPathFor,
  prepPublicationIntentPathFor, prepPublicationReceiptPathFor, prepPublicationPredecessorRole,
  findLiveMainOrchestratorBindingForScope, mintSupervisorExecutionClaim, registerTeamEnsureSuccess,
  actionPathFor,
}) {


// ─────────────────────────────────────────────────────────────────────────────
// WP3: Role-binding state machine (closed graph, user-specified):
//   ABSENT -> STARTING -> READY -> WAITING -> BUSY -> WAITING
//   STARTING -> UNAVAILABLE
//   READY|WAITING|BUSY -> DEAD -> REHYDRATING -> READY
//   READY|WAITING -> ROTATING -> REHYDRATING -> READY
//   (ambiguous owner) -> QUARANTINED  [terminal for this binding -- caller selects
//     fallback (a DIFFERENT role-binding key/driver) or STOPs; never reused]
//   READY|WAITING -> STOPPING -> STOPPED  [terminal]
// M6 GROUP B addition: READY -> UNAVAILABLE. `terminalizeSupervisorStartAction`
// (session-run's own shutdown/expiry path AND `action-failed`'s supervisor-
// start branch) must be able to tear a role back down even after it has
// ALREADY reached READY -- a supervisor-start batch's own atomic promotion
// (transitionSupervisorBatchToReady) can complete before an owning process's
// shutdown/expiry is observed, and the SAME "deadline"/action-failed
// failure_reason vocabulary UNAVAILABLE already carries for a STARTING role
// applies identically here (retryable within the same session generation,
// per UNAVAILABLE's own pre-existing point 3.1 edge back to STARTING) --
// never DEAD/ROTATING/STOPPING, which each carry a DIFFERENT meaning
// (a live, running peer instructed to restart or stop cooperatively, not a
// batch/process that never got the chance to finish or was cut short).
// A role-binding record is scoped by {worktree_id, plan_digest, profile_digest,
// session_generation_id, role} (the exact PLAN-specified binding key) -- a
// restart mints a NEW session_generation_id, which by construction addresses a
// disjoint registry path, so old-generation bindings are never read/reused by a
// fresh session (structural restart invalidation, not a scan-and-invalidate pass).
// ─────────────────────────────────────────────────────────────────────────────

function fakeHostExecutorExecute(projectRoot, actionId, outcome, mainBindingId) {
  const actionRead = readRegistryRecord(actionPathFor(projectRoot, actionId));
  if (!actionRead.ok || actionRead.absent) return { ok: false, reason: 'action-absent' };
  const action = actionRead.obj;
  const repoDescriptor = { repoId: action.repo_id };
  if (outcome === 'executed' && action.kind === 'supervisor-start') {
    const pair = resolvePolicyPair(projectRoot);
    if (!pair.ok) return { ok: false, reason: 'policy-invalid' };
    const claimResult = mintSupervisorExecutionClaim(repoDescriptor, action, mainBindingId, pair.policy.ready_timeout_seconds);
    if (!claimResult.ok) return { ok: false, reason: claimResult.reason };
    return { ok: true, action, outcome, executionClaim: claimResult.record };
  }
  if (outcome === 'executed' && action.kind === 'team-ensure') {
    const registerResult = registerTeamEnsureSuccess(repoDescriptor, action.session_generation_id, action.worktree_id, action.plan_digest, action.action_id);
    if (!registerResult.ok) return { ok: false, reason: registerResult.reason };
    return { ok: true, action, outcome };
  }
  return { ok: true, action, outcome };
}

// ── Generic argv parsing (Frozen CLI ABI -- exact production argv, PLAN.md ~L138-150) ─

/**
 * Per-subcommand argv spec: each flag maps to `{required, repeatable}`. Every flag
 * consumes exactly the next token as its value. `FORBIDDEN_FLAGS` and unrecognized
 * flags are rejected uniformly ahead of this table (PLAN.md ~L150: production argv
 * never accepts a caller-supplied session generation, binding/teammate/agent ID,
 * PID, team name, policy/registry/bootstrap path, prompt, or runtime handle).
 */

/**
 * Revalidates that `role`'s predecessor (if any) has already COMPLETED its
 * own PREP publication, proven via ITS OWN durable intent+receipt records
 * (never caller-supplied), including fd-bound verdict-byte proof via
 * classifyDurableRead and a fresh HEAD/PLAN cross-check. Pure read-only
 * gate: never mutates the registry.
 * @param {string} projectRoot
 * @param {string} waveSlug
 * @param {string} role
 * @param {string} currentHead
 * @param {string} currentPlanDigest
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function prepPublicationPredecessorQualifies(projectRoot, waveSlug, role, currentHead, currentPlanDigest) {
  const predecessorRole = prepPublicationPredecessorRole(role);
  if (predecessorRole === null) return { ok: true };

  const predIntentRead = readRegistryRecord(prepPublicationIntentPathFor(projectRoot, waveSlug, predecessorRole));
  if (!predIntentRead.ok) return { ok: false, reason: predIntentRead.reason };
  if (predIntentRead.absent) return { ok: false, reason: 'predecessor-not-completed' };
  const predIntent = predIntentRead.obj;
  const predIntentExpected = {
    role: predIntent.role,
    wave_slug: predIntent.wave_slug,
    head: predIntent.head,
    plan_sha256: predIntent.plan_sha256,
    binding_id: predIntent.binding_id,
    requester_actor_instance_id: predIntent.requester_actor_instance_id,
    session_generation_id: predIntent.session_generation_id,
    cp_intent_id: predIntent.cp_intent_id,
    cp_completion_digest: predIntent.cp_completion_digest,
    subject_scope_digest: predIntent.subject_scope_digest,
    publication_nonce: predIntent.publication_nonce,
  };
  const predIntentValid = validatePrepPublicationIntentRecord(predIntent, predIntentExpected);
  if (!predIntentValid.ok) return predIntentValid;
  if (predIntent.role !== predecessorRole) return { ok: false, reason: 'predecessor-role-mismatch' };
  if (predIntent.wave_slug !== waveSlug) return { ok: false, reason: 'predecessor-wave-slug-mismatch' };
  if (predIntent.state !== 'COMPLETED') return { ok: false, reason: 'predecessor-not-completed' };

  const predReceiptRead = readRegistryRecord(prepPublicationReceiptPathFor(projectRoot, waveSlug, predecessorRole));
  if (!predReceiptRead.ok) return { ok: false, reason: predReceiptRead.reason };
  if (predReceiptRead.absent) return { ok: false, reason: 'predecessor-not-completed' };
  const predReceipt = predReceiptRead.obj;
  const predReceiptExpected = {
    intent_id: predIntent.intent_id,
    role: predIntent.role,
    wave_slug: predIntent.wave_slug,
    head: predIntent.head,
    plan_sha256: predIntent.plan_sha256,
    binding_id: predIntent.binding_id,
    requester_actor_instance_id: predIntent.requester_actor_instance_id,
    session_generation_id: predIntent.session_generation_id,
    cp_intent_id: predIntent.cp_intent_id,
    cp_completion_digest: predIntent.cp_completion_digest,
    subject_scope_digest: predIntent.subject_scope_digest,
    review_decision: predIntent.review_decision,
    publication_nonce: predIntent.publication_nonce,
    verdict_ref: predReceipt && typeof predReceipt === 'object' ? predReceipt.verdict_ref : undefined,
    verdict_full_sha256: predReceipt && typeof predReceipt === 'object' ? predReceipt.verdict_full_sha256 : undefined,
  };
  const predReceiptValid = validatePrepPublicationReceiptRecord(predReceipt, predReceiptExpected);
  if (!predReceiptValid.ok) return predReceiptValid;

  if (!isSafeP2SubjectPath(predReceipt.verdict_ref)) return { ok: false, reason: 'predecessor-verdict-ref-invalid' };
  const target = path.join(projectRoot, predReceipt.verdict_ref);
  let projectRootReal;
  let targetReal;
  try {
    projectRootReal = fs.realpathSync(projectRoot);
    targetReal = fs.realpathSync(target);
  } catch (err) {
    return { ok: false, reason: 'predecessor-verdict-realpath-failed' };
  }
  if (targetReal !== projectRootReal && !targetReal.startsWith(projectRootReal + path.sep)) {
    return { ok: false, reason: 'predecessor-verdict-escapes-project-root' };
  }
  let classified;
  try {
    classified = classifyDurableRead(target, { parse: false });
  } catch (err) {
    return { ok: false, reason: 'predecessor-verdict-classify-failed' };
  }
  if (!classified || classified.state !== DURABLE_PRESENT) return { ok: false, reason: 'predecessor-verdict-not-durable-present' };
  if (sha256Buffer(classified.bytes) !== predReceipt.verdict_full_sha256) {
    return { ok: false, reason: 'predecessor-verdict-bytes-mismatch' };
  }

  if (predReceipt.head !== currentHead) return { ok: false, reason: 'predecessor-receipt-head-stale' };
  if (predReceipt.plan_sha256 !== currentPlanDigest) return { ok: false, reason: 'predecessor-receipt-plan-stale' };

  return { ok: true };
}

/**
 * The GREEN-A2b reservation seam. Mints/publishes a
 * `runtime/prep-publication-intent/v1` record (state RESERVED) after fresh
 * worker/RoleActorBinding authority, durable root-consult intent/completion/
 * review revalidation, and (for arch-testing/arch-integration) predecessor
 * qualification. `completion`/`review`/`projection` are EXPECTED snapshots
 * ONLY -- durable truth is always re-read from disk via readRegistryRecord;
 * no caller-supplied value is ever trusted as authority. No caller-identity
 * argument exists anywhere: actor/binding/session/thread are all resolved
 * fresh from the retained live worker + a freshly-validated RoleActorBinding.
 * publishNoClobber is the sole mutation, unreachable unless every gate above
 * it passes -- PPI-07's bare fixture (no retained worker, no durable
 * root-chain records) fails at the live-authority gate before any write.
 * @param {string} projectRoot
 * @param {string} waveSlug
 * @param {string} role
 * @param {object} completion - EXPECTED snapshot of runtime/root-consult-completion/v1
 * @param {object} review - EXPECTED snapshot of runtime/root-consult-review/v1
 * @param {{subjectBundleRef:string,subjectScopeDigest:string}} projection
 * @returns {{ok:true,intent:object,intentPath:string}|{ok:false,reason:string}}
 */
function reservePrepPublicationIntent(projectRoot, waveSlug, role, completion, review, projection) {
  if (typeof projectRoot !== 'string' || !path.isAbsolute(projectRoot)) return { ok: false, reason: 'reserve-prep-project-root-invalid' };
  if (typeof waveSlug !== 'string' || waveSlug.length === 0) return { ok: false, reason: 'reserve-prep-wave-slug-invalid' };
  if (!P2_SUBJECT_BUNDLE_SEED_ROLES.includes(role)) return { ok: false, reason: 'reserve-prep-role-invalid' };
  if (completion === null || typeof completion !== 'object' || Array.isArray(completion)) return { ok: false, reason: 'reserve-prep-completion-invalid' };
  if (review === null || typeof review !== 'object' || Array.isArray(review)) return { ok: false, reason: 'reserve-prep-review-invalid' };
  if (projection === null || typeof projection !== 'object' || Array.isArray(projection)) return { ok: false, reason: 'reserve-prep-projection-invalid' };

  // Gate 2: current repo/worktree/HEAD/PLAN resolved once.
  const plan = discoverPlan(projectRoot);
  if (!plan.ok) return { ok: false, reason: 'reserve-prep-plan-invalid' };
  const canonicalWaveSlug = path.basename(path.dirname(plan.planPath)).replace(/^wave-/, '');
  if (waveSlug !== canonicalWaveSlug) return { ok: false, reason: 'wave-slug-mismatch' };
  const repoId = computeRepoId(projectRoot);
  const worktreeId = computeWorktreeId(projectRoot);
  const head = gitRevParse(projectRoot, ['rev-parse', 'HEAD']);

  // Gate 3: retained worker + a fresh runtime/role-binding/v1 read.
  // MainOrchestratorBinding alone is never authority here -- the trusted
  // identity is this per-role retained worker cross-checked against a
  // freshly-read runtime/role-binding/v1 record (execution authority for
  // this whole seam; there is no RoleActorBinding record in this retained
  // app-server flow).
  let bridge;
  try { bridge = retainedSupervisorBridgeApi(); } catch (err) { return { ok: false, reason: 'retained-bridge-unavailable' }; }
  if (!bridge || typeof bridge.resolveLiveCodexAppServerWorker !== 'function') return { ok: false, reason: 'retained-bridge-unavailable' };
  const workerResult = bridge.resolveLiveCodexAppServerWorker(projectRoot, role, roleProfileDigestFor(role));
  if (!workerResult || !workerResult.ok || !workerResult.available) return { ok: false, reason: 'no-live-retained-worker' };
  const worker = workerResult.worker;
  if (!worker || worker.repoId !== repoId || worker.worktreeId !== worktreeId || worker.planDigest !== plan.planDigest
      || !isHexCsprng32(worker.bindingId)
      || typeof worker.threadId !== 'string' || worker.threadId.length === 0
      || Buffer.byteLength(worker.threadId, 'utf8') > 4096
      || !isHexCsprng32(worker.workerSessionId)) {
    return { ok: false, reason: 'no-live-retained-worker' };
  }
  // A fresh runtime/role-binding/v1 read is the required fresh-authority
  // proof -- the SAME canonical record resolveLiveCodexAppServerWorker
  // itself just validated as READY with driver codex-app-server to produce
  // worker.bindingId, re-read here and re-checked for state/driver/binding-id
  // agreement before it is trusted. The TRUSTED subject identity is
  // worker.workerSessionId (NOT any role-binding field): this is the SAME
  // actor-domain value handleConsultRoot writes into
  // requester_actor_instance_id on the durable root-consult intent (via
  // retained.source.workerSessionId), so only workerSessionId correlates
  // with the existing durable chain.
  const bindingResult = readRoleBindingState(
    projectRoot, worktreeId, plan.planDigest, roleProfileDigestFor(role), worker.sessionGenerationId, role,
  );
  if (!bindingResult.ok) return { ok: false, reason: bindingResult.reason || 'role-binding-invalid' };
  if (bindingResult.state !== 'READY' || !bindingResult.record || bindingResult.record.driver !== 'codex-app-server') {
    return { ok: false, reason: 'role-binding-not-ready' };
  }
  if (bindingResult.record.binding_id !== worker.bindingId) return { ok: false, reason: 'role-binding-id-mismatch' };

  // Trusted triple -- these, and ONLY these, are what every durable record
  // below is checked against; never substituted from any argument payload.
  const trustedBindingId = worker.bindingId;
  const trustedActorInstanceId = worker.workerSessionId;
  const trustedSessionGenerationId = worker.sessionGenerationId;
  const trustedThreadId = worker.threadId;

  // Gate 4: durable root intent/completion/review via readRegistryRecord +
  // all correlation/digest/decision checks.
  if (review === null || typeof review !== 'object' || typeof review.intent_id !== 'string') {
    return { ok: false, reason: 'reserve-prep-review-invalid' };
  }
  const durableIntentRead = readRegistryRecord(rootConsultIntentPathFor(projectRoot, review.intent_id));
  if (!durableIntentRead.ok) return { ok: false, reason: durableIntentRead.reason };
  if (durableIntentRead.absent) return { ok: false, reason: 'root-consult-intent-absent' };
  const durableIntent = durableIntentRead.obj;
  const durableIntentValid = validateRootConsultIntentRecord(durableIntent, { intent_id: review.intent_id });
  if (!durableIntentValid.ok) return durableIntentValid;
  if (durableIntent.requester_role !== role) return { ok: false, reason: 'root-consult-intent-requester-role-mismatch' };
  if (durableIntent.requester_binding_id !== trustedBindingId) return { ok: false, reason: 'root-consult-intent-requester-binding-id-mismatch' };
  if (durableIntent.requester_actor_instance_id !== trustedActorInstanceId) return { ok: false, reason: 'root-consult-intent-requester-actor-instance-id-mismatch' };
  if (durableIntent.session_generation_id !== trustedSessionGenerationId) return { ok: false, reason: 'root-consult-intent-session-generation-id-mismatch' };
  if (durableIntent.repo_id !== repoId) return { ok: false, reason: 'root-consult-intent-repo-id-mismatch' };
  if (durableIntent.worktree_id !== worktreeId) return { ok: false, reason: 'root-consult-intent-worktree-id-mismatch' };
  if (durableIntent.plan_digest !== plan.planDigest) return { ok: false, reason: 'root-consult-intent-plan-digest-mismatch' };
  if (durableIntent.subject_repo_id !== repoId) return { ok: false, reason: 'root-consult-intent-subject-repo-id-mismatch' };
  if (durableIntent.subject_worktree_id !== worktreeId) return { ok: false, reason: 'root-consult-intent-subject-worktree-id-mismatch' };
  if (durableIntent.subject_head !== head) return { ok: false, reason: 'root-consult-intent-subject-head-mismatch' };

  // Gate 4b: fresh Main-correlated PUBLICATION binding, joined against
  // durableIntent's OWN recorded main_binding_id/main_actor_instance_id --
  // NEVER the role-worker's trustedBindingId. The retained role worker (and
  // its RoleActorBinding, validated above) remains sole EXECUTION authority
  // for this whole seam; this join only re-proves that the SAME live Main
  // orchestrator correlated on the durable root-consult intent is still
  // live now, so the durable review/PREP/receipt chain can be stamped with
  // a binding id that actually correlates with Main, not with the worker.
  const mainFindResult = findLiveMainOrchestratorBindingForScope(projectRoot, worktreeId, plan.planDigest);
  if (
    !mainFindResult.ok || !mainFindResult.binding || !mainFindResult.generation
    || mainFindResult.binding.binding_id !== durableIntent.main_binding_id
    || mainFindResult.binding.actor_instance_id !== durableIntent.main_actor_instance_id
    || mainFindResult.generation.generationId !== trustedSessionGenerationId
  ) {
    return { ok: false, reason: 'main-binding-mismatch' };
  }
  // Trusted publication-domain id -- distinct from trustedBindingId (role-
  // worker execution authority) above; used ONLY for the binding_id field
  // stamped into the durable review-expectation/PREP-intent/self-validation
  // below, never as a substitute for role-worker/RoleActorBinding checks.
  const trustedPublicationBindingId = mainFindResult.binding.binding_id;

  const durableCompletionRead = readRegistryRecord(rootConsultCompletionPathFor(projectRoot, review.intent_id));
  if (!durableCompletionRead.ok) return { ok: false, reason: durableCompletionRead.reason };
  if (durableCompletionRead.absent) return { ok: false, reason: 'root-consult-completion-absent' };
  const durableCompletion = durableCompletionRead.obj;
  const durableCompletionValid = validateRootConsultCompletionRecord(durableCompletion, {
    intent_id: review.intent_id, request_id: durableIntent.request_id, requester_actor_instance_id: trustedActorInstanceId,
  });
  if (!durableCompletionValid.ok) return durableCompletionValid;
  if (canonicalJSONStringify(durableCompletion) !== canonicalJSONStringify(completion)) {
    return { ok: false, reason: 'root-consult-completion-snapshot-mismatch' };
  }

  const durableReviewRead = readRegistryRecord(rootConsultReviewPathFor(projectRoot, review.intent_id));
  if (!durableReviewRead.ok) return { ok: false, reason: durableReviewRead.reason };
  if (durableReviewRead.absent) return { ok: false, reason: 'root-consult-review-absent' };
  const durableReview = durableReviewRead.obj;
  if (canonicalJSONStringify(durableReview) !== canonicalJSONStringify(review)) {
    return { ok: false, reason: 'root-consult-review-snapshot-mismatch' };
  }
  const completionDigest = sha256String(canonicalJSONStringify(durableCompletion));
  if (durableReview && durableReview.cp_completion_digest !== completionDigest) {
    return { ok: false, reason: 'root-consult-review-cp-completion-digest-mismatch' };
  }
  const durableReviewValid = validateRootConsultReviewRecord(durableReview, {
    intent_id: durableIntent.intent_id,
    binding_id: trustedPublicationBindingId,
    requester_actor_instance_id: trustedActorInstanceId,
    session_generation_id: trustedSessionGenerationId,
    thread_id: trustedThreadId,
    resume_request_id: durableReview && typeof durableReview === 'object' ? durableReview.resume_request_id : undefined,
    subject_bundle_ref: durableIntent.subject_bundle_ref,
    subject_scope_digest: durableIntent.subject_scope_digest,
    cp_completion_digest: completionDigest,
  });
  if (!durableReviewValid.ok) return durableReviewValid;
  if (durableReview.decision !== 'APPROVED_PREP') return { ok: false, reason: 'root-consult-review-decision-not-approved' };

  if (projection.subjectBundleRef !== durableIntent.subject_bundle_ref) return { ok: false, reason: 'reserve-prep-projection-subject-bundle-ref-mismatch' };
  if (projection.subjectScopeDigest !== durableIntent.subject_scope_digest) return { ok: false, reason: 'reserve-prep-projection-subject-scope-digest-mismatch' };

  // Gate 5: predecessor qualification for arch-testing/arch-integration.
  const predecessorQualifies = prepPublicationPredecessorQualifies(projectRoot, waveSlug, role, head, plan.planDigest);
  if (!predecessorQualifies.ok) return predecessorQualifies;

  // Gate 6: mint intent_id + publication_nonce, build record, self-validate.
  const nowIso = nowIsoForRegistry();
  const intentId = crypto.randomBytes(16).toString('hex');
  const publicationNonce = crypto.randomBytes(16).toString('hex');
  const record = {
    schema: PREP_PUBLICATION_INTENT_SCHEMA,
    intent_id: intentId,
    role,
    wave_slug: waveSlug,
    head,
    plan_sha256: plan.planDigest,
    binding_id: trustedPublicationBindingId,
    requester_actor_instance_id: trustedActorInstanceId,
    session_generation_id: trustedSessionGenerationId,
    cp_intent_id: durableIntent.intent_id,
    cp_completion_digest: completionDigest,
    subject_scope_digest: durableIntent.subject_scope_digest,
    review_decision: durableReview.decision,
    publication_nonce: publicationNonce,
    state: 'RESERVED',
    reserved_at: nowIso,
    state_updated_at: nowIso,
    expiry: futureIsoForRegistry(600),
  };
  const selfValid = validatePrepPublicationIntentRecord(record, {
    role, wave_slug: waveSlug, head, plan_sha256: plan.planDigest,
    binding_id: trustedPublicationBindingId, requester_actor_instance_id: trustedActorInstanceId,
    session_generation_id: trustedSessionGenerationId, cp_intent_id: durableIntent.intent_id,
    cp_completion_digest: completionDigest, subject_scope_digest: durableIntent.subject_scope_digest,
    publication_nonce: publicationNonce,
  });
  if (!selfValid.ok) return selfValid;

  // Gate 7: publishNoClobber -- sole mutation, unreachable unless 1-6 pass.
  const intentPath = prepPublicationIntentPathFor(projectRoot, waveSlug, role);
  try {
    publishNoClobber(intentPath, Buffer.from(canonicalJSONStringify(record), 'utf8'), {});
  } catch (err) {
    return { ok: false, reason: 'reserve-prep-publish-failed' };
  }
  return { ok: true, intent: record, intentPath };
}

  return Object.freeze({
fakeHostExecutorExecute, prepPublicationPredecessorQualifies, reservePrepPublicationIntent,
  });
}

module.exports = { createPrepPublicationReserve };
