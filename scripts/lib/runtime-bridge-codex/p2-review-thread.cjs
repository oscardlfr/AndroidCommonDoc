'use strict';

// Acquires/releases the retained P2 review worker's bootstrap thread, and reads back the correlated PREP reservation for a review request.

function createP2ReviewThread({
  BOOTSTRAP_ARCHIVE_TIMEOUT_MS,
  SUPERVISOR_BASE_INSTRUCTIONS,
  closeTurnReadProjection,
  replaceOwnedWorkerPresence,
  rll,
}) {
async function acquireP2ReviewThread(worker, existingReview, deadlineMs) {
  if (existingReview !== null && worker.threadId !== null) {
    if (worker.threadId !== existingReview.thread_id) {
      throw new Error('p2-review-worker-thread-mismatch');
    }
    const retainedPresence = replaceOwnedWorkerPresence(
      worker.repoDescriptor, worker, worker.threadId,
    );
    if (!retainedPresence.ok) throw new Error('p2-review-presence-failed');
    return worker.threadId;
  }
  if (worker.threadId !== null) throw new Error('p2-review-worker-not-idle');
  let opened;
  if (existingReview === null) {
    opened = await worker.connection.threadStart({
      role: worker.role,
      developerInstructions: worker.profileBytes,
      baseInstructions: SUPERVISOR_BASE_INSTRUCTIONS,
      cwd: worker.cwd,
    }, { backendDeadlineMs: deadlineMs });
    if (!opened || opened.ok !== true || typeof opened.threadId !== 'string' || opened.threadId.length === 0) {
      throw new Error('p2-review-thread-start-failed');
    }
  } else {
    if (existingReview.decision !== 'APPROVED_PREP') throw new Error('p2-review-resume-decision-invalid');
    opened = await worker.connection.threadResume({
      threadId: existingReview.thread_id,
      developerInstructions: worker.profileBytes,
      baseInstructions: SUPERVISOR_BASE_INSTRUCTIONS,
      cwd: worker.cwd,
    }, { backendDeadlineMs: deadlineMs });
    if (
      !opened || opened.ok !== true
      || opened.threadId !== existingReview.thread_id
    ) throw new Error('p2-review-thread-resume-failed');
  }
  worker.threadId = opened.threadId;
  const activePresence = replaceOwnedWorkerPresence(
    worker.repoDescriptor, worker, worker.threadId,
  );
  if (!activePresence.ok) throw new Error('p2-review-presence-failed');
  return opened.threadId;
}

async function releaseP2ReviewThread(worker, deadlineMs) {
  if (worker.threadId === null) return { ok: true };
  const ownedThreadId = worker.threadId;
  const cleanupDeadlineMs = Math.max(
    Number.isFinite(deadlineMs) ? deadlineMs : 0,
    Date.now() + BOOTSTRAP_ARCHIVE_TIMEOUT_MS,
  );
  const archived = await worker.connection.threadArchive(
    ownedThreadId, { backendDeadlineMs: cleanupDeadlineMs },
  );
  if (!archived || archived.ok !== true) {
    return { ok: false, reason: 'p2-review-thread-archive-failed' };
  }
  const projectionClosed = closeTurnReadProjection(worker);
  const idlePresence = replaceOwnedWorkerPresence(worker.repoDescriptor, worker, null);
  if (!idlePresence.ok) {
    return { ok: false, reason: 'p2-review-idle-presence-failed:' + (idlePresence.reason || 'unknown') };
  }
  if (!projectionClosed.ok) {
    return { ok: false, reason: 'p2-review-projection-close-failed:' + (projectionClosed.reason || 'unknown') };
  }
  return { ok: true };
}

function readCorrelatedP2PrepReservation(worker, intent, completionDigest, reviewRecord) {
  const intentPath = rll.prepPublicationIntentPathFor(
    worker.projectRoot, worker.waveSlug, worker.role,
  );
  const read = rll.readRegistryRecord(intentPath);
  if (!read.ok) throw new Error('p2-prep-existing-read-failed:' + (read.reason || 'unknown'));
  if (read.absent) return { absent: true, reservation: null };
  const raw = read.obj;
  const valid = rll.validatePrepPublicationIntentRecord(raw, {
    role: worker.role,
    wave_slug: worker.waveSlug,
    head: intent.subject_head,
    plan_sha256: worker.planDigest,
    binding_id: intent.main_binding_id,
    requester_actor_instance_id: worker.workerSessionId,
    session_generation_id: worker.sessionGenerationId,
    cp_intent_id: intent.intent_id,
    cp_completion_digest: completionDigest,
    subject_scope_digest: intent.subject_scope_digest,
    publication_nonce: raw && typeof raw === 'object' ? raw.publication_nonce : undefined,
  });
  if (!valid.ok) throw new Error('p2-prep-existing-invalid:' + (valid.reason || 'unknown'));
  if (valid.record.review_decision !== reviewRecord.decision) {
    throw new Error('p2-prep-existing-review-decision-mismatch');
  }
  return {
    absent: false,
    reservation: { ok: true, intent: valid.record, intentPath },
  };
}

  return Object.freeze({
    acquireP2ReviewThread,
    readCorrelatedP2PrepReservation,
    releaseP2ReviewThread,
  });
}

module.exports = Object.freeze({ createP2ReviewThread });
