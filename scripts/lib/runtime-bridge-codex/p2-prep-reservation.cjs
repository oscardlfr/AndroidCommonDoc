'use strict';

// Finalizes a reserved P2 PREP publication: runs+reads the verdict, validates the landed receipt against its expected intent, and publishes the completed intent record.

function createP2PrepReservation({
  canonicalJSONStringify,
  path,
  publishBridgeRegistryRecord,
  rll,
  runAndReadPrepVerdict,
  runP2TestPreVerdictBarrier,
}) {
function p2PrepIntentExpected(intent) {
  return {
    role: intent.role,
    wave_slug: intent.wave_slug,
    head: intent.head,
    plan_sha256: intent.plan_sha256,
    binding_id: intent.binding_id,
    requester_actor_instance_id: intent.requester_actor_instance_id,
    session_generation_id: intent.session_generation_id,
    cp_intent_id: intent.cp_intent_id,
    cp_completion_digest: intent.cp_completion_digest,
    subject_scope_digest: intent.subject_scope_digest,
    publication_nonce: intent.publication_nonce,
  };
}

function p2PrepReceiptExpected(intent, verdict) {
  return {
    intent_id: intent.intent_id,
    role: intent.role,
    wave_slug: intent.wave_slug,
    head: intent.head,
    plan_sha256: intent.plan_sha256,
    binding_id: intent.binding_id,
    requester_actor_instance_id: intent.requester_actor_instance_id,
    session_generation_id: intent.session_generation_id,
    cp_intent_id: intent.cp_intent_id,
    cp_completion_digest: intent.cp_completion_digest,
    subject_scope_digest: intent.subject_scope_digest,
    review_decision: intent.review_decision,
    publication_nonce: intent.publication_nonce,
    verdict_ref: verdict.verdictRef,
    verdict_full_sha256: verdict.digest,
  };
}

function readPrepReceiptSnapshot(worker, intent) {
  const receiptPath = rll.prepPublicationReceiptPathFor(
    worker.projectRoot, intent.wave_slug, intent.role,
  );
  const read = rll.readRegistryRecord(receiptPath);
  if (!read.ok) throw new Error('p2-prep-receipt-read-failed:' + (read.reason || 'unknown'));
  return {
    receiptPath,
    absent: read.absent === true,
    receipt: read.absent === true ? null : read.obj,
  };
}

function validateLandedPrepReceipt(intent, receipt, verdict) {
  const valid = rll.validatePrepPublicationReceiptRecord(
    receipt, p2PrepReceiptExpected(intent, verdict),
  );
  if (!valid.ok) throw new Error('p2-prep-landed-receipt-invalid:' + (valid.reason || 'unknown'));
  const reservedAtMs = Date.parse(intent.reserved_at);
  const publishedAtMs = Date.parse(receipt.published_at);
  const expiryMs = Date.parse(intent.expiry);
  if (!(reservedAtMs <= publishedAtMs && publishedAtMs < expiryMs)) {
    throw new Error('p2-prep-landed-receipt-chronology-invalid');
  }
  return valid.record;
}

function completedPrepIntentFromLandedReceipt(intent, receipt) {
  const completedIntent = {
    ...intent,
    state: 'COMPLETED',
    state_updated_at: receipt.published_at,
  };
  const valid = rll.validatePrepPublicationIntentRecord(
    completedIntent, p2PrepIntentExpected(intent),
  );
  if (!valid.ok) throw new Error('p2-prep-landed-completion-invalid:' + (valid.reason || 'unknown'));
  return valid.record;
}

function finalizeReservedPrepPublication(worker, reservation) {
  if (!reservation || reservation.ok !== true || !reservation.intent
      || typeof reservation.intentPath !== 'string') {
    throw new Error('p2-prep-reservation-invalid');
  }
  const intent = reservation.intent;
  const canonicalIntentPath = rll.prepPublicationIntentPathFor(
    worker.projectRoot, intent.wave_slug, intent.role,
  );
  if (path.resolve(reservation.intentPath) !== path.resolve(canonicalIntentPath)) {
    throw new Error('p2-prep-intent-path-mismatch');
  }
  const intentValid = rll.validatePrepPublicationIntentRecord(
    intent, p2PrepIntentExpected(intent),
  );
  if (!intentValid.ok) throw new Error('p2-prep-intent-invalid:' + (intentValid.reason || 'unknown'));

  let receiptSnapshot = readPrepReceiptSnapshot(worker, intent);
  if (intent.state === 'CONFLICTED') {
    if (!receiptSnapshot.absent) throw new Error('p2-prep-conflicted-receipt-present');
    return { ok: false, state: 'CONFLICTED', intent };
  }
  if (intent.state === 'RESERVED' && !receiptSnapshot.absent) {
    throw new Error('p2-prep-reserved-receipt-present');
  }
  if (intent.state === 'COMPLETED' && receiptSnapshot.absent) {
    throw new Error('p2-prep-completed-receipt-absent');
  }
  if (!['RESERVED', 'PUBLISHED_PENDING_RECEIPT', 'COMPLETED'].includes(intent.state)) {
    throw new Error('p2-prep-intent-state-not-settleable');
  }

  if (intent.state === 'RESERVED') runP2TestPreVerdictBarrier(worker.role);
  const verdict = runAndReadPrepVerdict(
    worker, intent, { allowSpawn: intent.state === 'RESERVED' },
  );
  const landedVerdictBound = !receiptSnapshot.absent
    && typeof verdict.verdictRef === 'string'
    && typeof verdict.digest === 'string'
    && /^[0-9a-f]{64}$/.test(verdict.digest);
  if (!verdict.ok && !landedVerdictBound) {
    if (intent.state === 'COMPLETED') {
      throw new Error('p2-prep-terminal-verdict-invalid:' + (verdict.reason || 'unknown'));
    }
    const conflicted = rll.conflictPrepPublicationIntent(intent, verdict.reason || 'verdict-invalid');
    if (!conflicted.ok) throw new Error('p2-prep-conflict-invalid:' + (conflicted.reason || 'unknown'));
    const conflictWrite = rll.writeRegistryRecordReplace(
      reservation.intentPath, Buffer.from(canonicalJSONStringify(conflicted.intent), 'utf8'),
    );
    if (!conflictWrite.ok) throw new Error('p2-prep-conflict-write-failed:' + (conflictWrite.reason || 'unknown'));
    return { ok: false, state: 'CONFLICTED', reason: verdict.reason || 'verdict-invalid', intent: conflicted.intent };
  }

  if (intent.state === 'COMPLETED') {
    const landedReceipt = validateLandedPrepReceipt(intent, receiptSnapshot.receipt, verdict);
    const completedIntent = completedPrepIntentFromLandedReceipt(intent, landedReceipt);
    if (canonicalJSONStringify(completedIntent) !== canonicalJSONStringify(intent)) {
      throw new Error('p2-prep-completed-intent-receipt-mismatch');
    }
    return {
      ok: true,
      state: 'COMPLETED',
      intent,
      receipt: landedReceipt,
      verdictRef: verdict.verdictRef,
      verdictDigest: verdict.digest,
    };
  }

  let settlementIntent = intent;
  if (receiptSnapshot.absent) {
    const candidate = rll.completePrepPublicationIntent(
      intent, verdict.grammar.fields, verdict.verdictRef, verdict.digest,
    );
    if (!candidate.ok) throw new Error('p2-prep-completion-invalid:' + (candidate.reason || 'unknown'));

    if (intent.state === 'RESERVED') {
      const pendingIntent = {
        ...intent,
        state: 'PUBLISHED_PENDING_RECEIPT',
        state_updated_at: candidate.receipt.published_at,
      };
      const pendingValid = rll.validatePrepPublicationIntentRecord(
        pendingIntent, p2PrepIntentExpected(intent),
      );
      if (!pendingValid.ok) throw new Error('p2-prep-pending-invalid:' + (pendingValid.reason || 'unknown'));
      const pendingWrite = rll.writeRegistryRecordReplace(
        reservation.intentPath, Buffer.from(canonicalJSONStringify(pendingValid.record), 'utf8'),
      );
      if (!pendingWrite.ok) throw new Error('p2-prep-pending-write-failed:' + (pendingWrite.reason || 'unknown'));
      settlementIntent = pendingValid.record;
    }

    try {
      publishBridgeRegistryRecord(
        receiptSnapshot.receiptPath,
        Buffer.from(canonicalJSONStringify(candidate.receipt), 'utf8'),
        {},
      );
    } catch (err) {
      const raced = readPrepReceiptSnapshot(worker, settlementIntent);
      if (raced.absent) throw new Error('p2-prep-receipt-publish-failed');
    }
    receiptSnapshot = readPrepReceiptSnapshot(worker, settlementIntent);
    if (receiptSnapshot.absent) throw new Error('p2-prep-receipt-not-landed');
  }

  const landedReceipt = validateLandedPrepReceipt(
    settlementIntent, receiptSnapshot.receipt, verdict,
  );
  if (Date.parse(landedReceipt.published_at) < Date.parse(settlementIntent.state_updated_at)) {
    throw new Error('p2-prep-landed-receipt-before-pending');
  }
  const completedIntent = completedPrepIntentFromLandedReceipt(
    settlementIntent, landedReceipt,
  );
  const completedWrite = rll.writeRegistryRecordReplace(
    reservation.intentPath, Buffer.from(canonicalJSONStringify(completedIntent), 'utf8'),
  );
  if (!completedWrite.ok) throw new Error('p2-prep-completed-write-failed:' + (completedWrite.reason || 'unknown'));

  return {
    ok: true,
    state: 'COMPLETED',
    intent: completedIntent,
    receipt: landedReceipt,
    verdictRef: verdict.verdictRef,
    verdictDigest: verdict.digest,
  };
}

  return Object.freeze({
    completedPrepIntentFromLandedReceipt,
    finalizeReservedPrepPublication,
    p2PrepIntentExpected,
    p2PrepReceiptExpected,
    readPrepReceiptSnapshot,
    validateLandedPrepReceipt,
  });
}

module.exports = Object.freeze({ createP2PrepReservation });
