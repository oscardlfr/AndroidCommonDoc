'use strict';

// Loads a completed root P2 review's durable context (request/result/accepted/ack refs resolved+read), and reads back a validated review payload.

function createP2ReviewContext({
  CANONICAL_ROLES,
  RETAINED_WORKER_HEARTBEAT_INTERVAL_MS,
  TURN_READ_PROJECTION_ENTRY_CAP,
  TURN_READ_PROJECTION_FILE_CAP,
  asyncSleep,
  canonicalJSONStringify,
  computeCoordinationRootId,
  fs,
  gitRevParse,
  hasExactKeys,
  isSafeProjectionRelativePath,
  isTestCapability,
  path,
  readFdBoundProjectionSource,
  replaceOwnedWorkerPresence,
  rll,
  sha256String,
}) {
/**
 * Resolves a durable root-consult record's own relative `*_ref` field (e.g.
 * `published.request_ref`, `completion.result_ref`) to an absolute path that
 * is provably confined beneath the real coordination root, mirroring the
 * existing fd-bound projection readers' own confinement discipline rather
 * than trusting the ref string directly.
 * @param {string} coordinationRootReal
 * @param {string} ref
 * @returns {string}
 */
function resolveP2ReviewCoordinationRef(coordinationRootReal, ref) {
  if (typeof ref !== 'string' || ref.length === 0) throw new Error('p2-review-ref-invalid');
  const resolved = path.resolve(coordinationRootReal, ref);
  const rel = path.relative(coordinationRootReal, resolved);
  if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error('p2-review-ref-unconfined');
  }
  return resolved;
}
function loadP2CompletedRootReviewContext(worker, rootIntent, coordinationRootReal, completedItem) {
  if (worker.role === 'context-provider') throw new Error('p2-review-worker-role-invalid');
  if (
    !rootIntent || typeof rootIntent !== 'object'
    || typeof rootIntent.intentId !== 'string' || !/^[a-f0-9]{32}$/.test(rootIntent.intentId)
    || typeof rootIntent.intentPath !== 'string' || rootIntent.intentPath.length === 0
    || typeof rootIntent.createdAt !== 'string' || rootIntent.createdAt.length === 0
    || rootIntent.intentPath !== rll.rootConsultIntentPathFor(worker.repoDescriptor, rootIntent.intentId)
  ) throw new Error('p2-review-root-ref-invalid');

  const intentRead = rll.readRootConsultIntent(worker.repoDescriptor, rootIntent.intentId);
  if (!intentRead.ok || intentRead.absent) throw new Error('p2-review-intent-absent');
  const intent = intentRead.intent;
  if (intent.created_at !== rootIntent.createdAt) throw new Error('p2-review-root-ref-invalid');
  if (intent.expected_result_kind !== 'P2_SOURCE_EVIDENCE') return { eligible: false };

  const mainAuthority = rll.findLiveMainOrchestratorBindingForScope(
    worker.repoDescriptor, worker.worktreeId, worker.planDigest,
  );
  if (
    !mainAuthority || mainAuthority.ok !== true || !mainAuthority.binding || !mainAuthority.generation
    || intent.main_binding_id !== mainAuthority.binding.binding_id
    || intent.main_actor_instance_id !== mainAuthority.binding.actor_instance_id
    || intent.session_generation_id !== mainAuthority.generation.generationId
  ) throw new Error('p2-review-main-authority-invalid');

  let currentHead;
  try { currentHead = gitRevParse(worker.projectRoot, ['rev-parse', 'HEAD']); }
  catch (err) { throw new Error('p2-review-intent-scope-invalid'); }
  if (
    intent.requester_role !== worker.role
    || intent.requester_actor_instance_id !== worker.workerSessionId
    || intent.requester_binding_id !== worker.bindingId
    || intent.session_generation_id !== worker.sessionGenerationId
    || intent.repo_id !== worker.repoId
    || intent.worktree_id !== worker.worktreeId
    || intent.plan_digest !== worker.planDigest
    || intent.coordination_root_id !== computeCoordinationRootId(coordinationRootReal)
    || intent.target_role !== 'context-provider'
    || intent.evidence_policy !== 'none'
    || intent.subject_repo_id !== worker.repoId
    || intent.subject_worktree_id !== worker.worktreeId
    || intent.subject_head !== currentHead
  ) throw new Error('p2-review-intent-scope-invalid');

  const canonicalPlanRoot = path.join(
    coordinationRootReal, worker.repoId, worker.waveSlug, worker.planDigest,
  );
  try {
    const subjectBundlePath = resolveP2ReviewCoordinationRef(
      coordinationRootReal, intent.subject_bundle_ref,
    );
    const expectedSubjectBundlePath = path.join(
      canonicalPlanRoot, 'subject-bundles', intent.subject_scope_digest, 'manifest.json',
    );
    if (subjectBundlePath !== expectedSubjectBundlePath) throw new Error('subject-bundle-path-mismatch');
    const subjectBundleSnapshot = readFdBoundProjectionSource(
      subjectBundlePath, TURN_READ_PROJECTION_FILE_CAP,
    );
    if (subjectBundleSnapshot.digest !== intent.subject_scope_digest) throw new Error('subject-bundle-digest-mismatch');
    const subjectBundleText = subjectBundleSnapshot.bytes.toString('utf8');
    const subjectBundle = JSON.parse(subjectBundleText);
    if (
      canonicalJSONStringify(subjectBundle) !== subjectBundleText
      || !hasExactKeys(subjectBundle, ['entries', 'schema'])
      || subjectBundle.schema !== 'coordination/subject-bundle-manifest/v1'
      || !Array.isArray(subjectBundle.entries)
      || subjectBundle.entries.length < 1
      || subjectBundle.entries.length > TURN_READ_PROJECTION_ENTRY_CAP
    ) throw new Error('subject-bundle-shape-invalid');
    let previousPath = null;
    for (const entry of subjectBundle.entries) {
      if (
        !entry || typeof entry !== 'object' || Array.isArray(entry)
        || !hasExactKeys(entry, ['digest', 'path', 'size'])
        || !isSafeProjectionRelativePath(entry.path)
        || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > TURN_READ_PROJECTION_FILE_CAP
        || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest)
        || (previousPath !== null && entry.path <= previousPath)
      ) throw new Error('subject-bundle-entry-invalid');
      previousPath = entry.path;
    }
  } catch (err) {
    throw new Error('p2-review-subject-bundle-invalid');
  }

  const publishedRead = rll.readRegistryRecord(
    rll.rootConsultPublishedPathFor(worker.repoDescriptor, rootIntent.intentId),
  );
  if (!publishedRead.ok || publishedRead.absent) throw new Error('p2-review-published-absent');
  const publishedValid = rll.validateRootConsultPublishedRecord(publishedRead.obj, {
    intent_id: rootIntent.intentId, request_id: intent.request_id,
  });
  if (!publishedValid.ok) throw new Error('p2-review-published-invalid');
  const published = publishedValid.record;

  const completionRead = rll.readRegistryRecord(
    rll.rootConsultCompletionPathFor(worker.repoDescriptor, rootIntent.intentId),
  );
  if (!completionRead.ok || completionRead.absent) throw new Error('p2-review-completion-absent');
  const completionValid = rll.validateRootConsultCompletionRecord(completionRead.obj, {
    intent_id: rootIntent.intentId,
    request_id: intent.request_id,
    requester_actor_instance_id: worker.workerSessionId,
  });
  if (!completionValid.ok) throw new Error('p2-review-completion-invalid');
  const completion = completionValid.record;

  const requestPath = resolveP2ReviewCoordinationRef(canonicalPlanRoot, published.request_ref);
  const resultPath = resolveP2ReviewCoordinationRef(canonicalPlanRoot, completion.result_ref);
  const acceptedPath = resolveP2ReviewCoordinationRef(canonicalPlanRoot, completion.accepted_result_ref);
  const ackPath = resolveP2ReviewCoordinationRef(canonicalPlanRoot, completion.ack_ref);
  const observed = completedItem;
  if (
    !observed || observed.ok !== true || observed.ready !== true || observed.status !== 'ANSWERED'
    || observed.requestPath !== requestPath || observed.requestDigest !== completion.request_digest
    || observed.resultPath !== resultPath || observed.resultDigest !== completion.result_digest
    || observed.acceptedPath !== acceptedPath || observed.acceptedDigest !== completion.accepted_result_digest
    || observed.ackPath !== ackPath || observed.ackDigest !== completion.ack_digest
  ) throw new Error('p2-review-observed-mismatch');

  const completionDigest = sha256String(canonicalJSONStringify(completion));
  return {
    eligible: true,
    rootIntent,
    intent,
    published,
    completion,
    canonicalPlanRoot,
    requestPath,
    resultPath,
    acceptedPath,
    ackPath,
    observed,
    completionDigest,
  };
}

async function waitForP2TestTimingGate(worker, deadlineMs) {
  const gatePath = process.env.APP_LIVE_PREP_TIMING_GATE_PATH;
  const gateRole = process.env.APP_LIVE_PREP_TIMING_GATE_ROLE;
  if (gatePath === undefined && gateRole === undefined) return;
  if (!isTestCapability()) return;
  if (
    typeof gatePath !== 'string' || gatePath.length === 0
    || typeof gateRole !== 'string' || !CANONICAL_ROLES.includes(gateRole)
  ) throw new Error('p2-test-timing-gate-config-invalid');
  if (gateRole !== worker.role) return;
  if (!path.isAbsolute(gatePath)) throw new Error('p2-test-timing-gate-path-invalid');
  let parentReal;
  try {
    parentReal = fs.realpathSync(path.dirname(gatePath));
  } catch (err) {
    throw new Error('p2-test-timing-gate-parent-invalid');
  }
  const parentRelative = path.relative(worker.projectRoot, parentReal);
  if (
    parentRelative === '..' || parentRelative.startsWith('..' + path.sep)
    || path.isAbsolute(parentRelative)
  ) throw new Error('p2-test-timing-gate-path-unconfined');
  const leafName = path.basename(gatePath);
  if (leafName.length === 0) throw new Error('p2-test-timing-gate-path-invalid');
  const resolvedGatePath = path.join(parentReal, leafName);
  const waitDeadlineMs = Math.min(deadlineMs, Date.now() + 15000);
  let lastPresenceMs = 0;
  while (Date.now() < waitDeadlineMs) {
    try {
      const st = fs.lstatSync(resolvedGatePath);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error('p2-test-timing-gate-leaf-invalid');
      }
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
        throw new Error('p2-test-timing-gate-owner-invalid');
      }
      return;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    const nowMs = Date.now();
    if (nowMs - lastPresenceMs >= RETAINED_WORKER_HEARTBEAT_INTERVAL_MS) {
      const heartbeat = replaceOwnedWorkerPresence(
        worker.repoDescriptor, worker, worker.threadId,
      );
      if (!heartbeat.ok) {
        throw new Error('p2-test-timing-gate-presence-failed:' + (heartbeat.reason || 'unknown'));
      }
      lastPresenceMs = nowMs;
    }
    await asyncSleep(25);
  }
  throw new Error('p2-test-timing-gate-timeout');
}

function readValidatedP2Review(worker, rootIntent, intent, completionDigest) {
  const reviewRead = rll.readRegistryRecord(
    rll.rootConsultReviewPathFor(worker.repoDescriptor, rootIntent.intentId),
  );
  if (!reviewRead.ok) throw new Error('p2-review-existing-read-failed');
  if (reviewRead.absent) return { absent: true, record: null };
  const raw = reviewRead.obj;
  const valid = rll.validateRootConsultReviewRecord(raw, {
    intent_id: rootIntent.intentId,
    binding_id: intent.main_binding_id,
    requester_actor_instance_id: worker.workerSessionId,
    session_generation_id: worker.sessionGenerationId,
    thread_id: raw && typeof raw === 'object' ? raw.thread_id : undefined,
    resume_request_id: raw && typeof raw === 'object' ? raw.resume_request_id : undefined,
    cp_completion_digest: completionDigest,
    subject_bundle_ref: intent.subject_bundle_ref,
    subject_scope_digest: intent.subject_scope_digest,
  });
  if (!valid.ok) throw new Error('p2-review-existing-invalid');
  return { absent: false, record: valid.record };
}

  return Object.freeze({
    loadP2CompletedRootReviewContext,
    readValidatedP2Review,
    resolveP2ReviewCoordinationRef,
    waitForP2TestTimingGate,
  });
}

module.exports = Object.freeze({ createP2ReviewContext });
