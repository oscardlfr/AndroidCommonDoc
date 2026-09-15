'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: PREP-publication
// intent/receipt closed-shape validators, their path builders (plus the two
// sibling root-consult-review/mixed-review path helpers that live in this
// same original section), and the pure predecessor-role lookup. Never
// requires the facade or a sibling module.

function createPrepPublicationRecords({
  path, registryRepoDir, isHexCsprng32, isHexDigest64, isCanonicalIsoUtc,
  P2_SUBJECT_BUNDLE_SEED_ROLES, isSafeP2SubjectPath,
}) {
const PREP_PUBLICATION_INTENT_SCHEMA = 'runtime/prep-publication-intent/v1';
const PREP_PUBLICATION_INTENT_KEYS = Object.freeze([
  'schema', 'intent_id', 'role', 'wave_slug', 'head', 'plan_sha256', 'binding_id',
  'requester_actor_instance_id', 'session_generation_id', 'cp_intent_id',
  'cp_completion_digest', 'subject_scope_digest', 'review_decision',
  'publication_nonce', 'state', 'reserved_at', 'state_updated_at', 'expiry',
]);
const PREP_PUBLICATION_INTENT_STATES = Object.freeze([
  'RESERVED', 'PUBLISHED_PENDING_RECEIPT', 'COMPLETED', 'CONFLICTED', 'EXPIRED',
]);
const PREP_PUBLICATION_INTENT_CORRELATED_FIELDS = Object.freeze([
  'role', 'wave_slug', 'head', 'plan_sha256', 'binding_id',
  'requester_actor_instance_id', 'session_generation_id', 'cp_intent_id',
  'cp_completion_digest', 'subject_scope_digest', 'publication_nonce',
]);

/**
 * Pure closed-shape validator for a `runtime/prep-publication-intent/v1`
 * record (P2-PPI-01..04). Only a RESERVED intent may carry
 * `review_decision: 'APPROVED_PREP'`-gated chronology; caps/enum/correlation
 * checks are closed and each hostile shape fails with a distinct reason.
 * @param {unknown} record
 * @param {object} expected
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function validatePrepPublicationIntentRecord(record, expected) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'prep-publication-intent-not-an-object' };
  }
  const keys = Object.keys(record);
  if (!PREP_PUBLICATION_INTENT_KEYS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    return { ok: false, reason: 'prep-publication-intent-missing-key' };
  }
  if (keys.length !== PREP_PUBLICATION_INTENT_KEYS.length) {
    return { ok: false, reason: 'prep-publication-intent-unexpected-key' };
  }
  if (record.schema !== PREP_PUBLICATION_INTENT_SCHEMA) return { ok: false, reason: 'prep-publication-intent-schema-mismatch' };
  if (!isHexCsprng32(record.intent_id)) return { ok: false, reason: 'prep-publication-intent-intent-id-invalid' };
  if (!P2_SUBJECT_BUNDLE_SEED_ROLES.includes(record.role)) return { ok: false, reason: 'prep-publication-intent-role-invalid' };
  if (typeof record.wave_slug !== 'string' || record.wave_slug.length === 0) return { ok: false, reason: 'prep-publication-intent-wave-slug-invalid' };
  if (typeof record.head !== 'string' || !/^[0-9a-f]{40}$/.test(record.head)) return { ok: false, reason: 'prep-publication-intent-head-invalid' };
  if (!isHexDigest64(record.plan_sha256)) return { ok: false, reason: 'prep-publication-intent-plan-sha256-invalid' };
  if (!isHexCsprng32(record.binding_id)) return { ok: false, reason: 'prep-publication-intent-binding-id-invalid' };
  if (!isHexCsprng32(record.requester_actor_instance_id)) return { ok: false, reason: 'prep-publication-intent-requester-actor-instance-id-invalid' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'prep-publication-intent-session-generation-id-invalid' };
  if (!isHexCsprng32(record.cp_intent_id)) return { ok: false, reason: 'prep-publication-intent-cp-intent-id-invalid' };
  if (!isHexDigest64(record.cp_completion_digest)) return { ok: false, reason: 'prep-publication-intent-cp-completion-digest-invalid' };
  if (!isHexDigest64(record.subject_scope_digest)) return { ok: false, reason: 'prep-publication-intent-subject-scope-digest-invalid' };
  if (record.review_decision === 'REJECTED') return { ok: false, reason: 'prep-publication-intent-review-decision-rejected' };
  if (record.review_decision === 'INCONCLUSIVE') return { ok: false, reason: 'prep-publication-intent-review-decision-inconclusive' };
  if (record.review_decision !== 'APPROVED_PREP') return { ok: false, reason: 'prep-publication-intent-review-decision-invalid' };
  if (!isHexCsprng32(record.publication_nonce)) return { ok: false, reason: 'prep-publication-intent-publication-nonce-invalid' };
  if (!PREP_PUBLICATION_INTENT_STATES.includes(record.state)) return { ok: false, reason: 'prep-publication-intent-state-invalid' };
  if (!isCanonicalIsoUtc(record.reserved_at)) return { ok: false, reason: 'prep-publication-intent-reserved-at-invalid' };
  if (!isCanonicalIsoUtc(record.state_updated_at)) return { ok: false, reason: 'prep-publication-intent-state-updated-at-invalid' };
  if (!isCanonicalIsoUtc(record.expiry)) return { ok: false, reason: 'prep-publication-intent-expiry-invalid' };
  if (Date.parse(record.state_updated_at) < Date.parse(record.reserved_at)) {
    return { ok: false, reason: 'prep-publication-intent-state-updated-at-before-reserved-at' };
  }
  if (Date.parse(record.expiry) <= Date.parse(record.state_updated_at)) {
    return { ok: false, reason: 'prep-publication-intent-expiry-not-after-state-updated-at' };
  }

  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, reason: 'prep-publication-intent-expected-not-an-object' };
  }
  for (const field of PREP_PUBLICATION_INTENT_CORRELATED_FIELDS) {
    if (record[field] !== expected[field]) return { ok: false, reason: 'prep-publication-intent-' + field.replace(/_/g, '-') + '-mismatch' };
  }

  return { ok: true, record };
}

const PREP_PUBLICATION_RECEIPT_SCHEMA = 'runtime/prep-publication-receipt/v1';
const PREP_PUBLICATION_RECEIPT_KEYS = Object.freeze([
  'schema', 'receipt_id', 'intent_id', 'role', 'wave_slug', 'head', 'plan_sha256',
  'binding_id', 'requester_actor_instance_id', 'session_generation_id',
  'cp_intent_id', 'cp_completion_digest', 'subject_scope_digest', 'review_decision',
  'publication_nonce', 'verdict_ref', 'verdict_full_sha256', 'published_at',
]);
const PREP_PUBLICATION_RECEIPT_CORRELATED_FIELDS = Object.freeze([
  'intent_id', 'role', 'wave_slug', 'head', 'plan_sha256', 'binding_id',
  'requester_actor_instance_id', 'session_generation_id', 'cp_intent_id',
  'cp_completion_digest', 'subject_scope_digest', 'review_decision',
  'publication_nonce', 'verdict_ref', 'verdict_full_sha256',
]);

/**
 * Pure closed-shape validator for a `runtime/prep-publication-receipt/v1`
 * record (P2-PPI-05/06). `verdict_ref` must be a safe relative `.md` path
 * (same predicate family as the review's subject_bundle_ref).
 * @param {unknown} record
 * @param {object} expected
 * @returns {{ok:true,record:object}|{ok:false,reason:string}}
 */
function validatePrepPublicationReceiptRecord(record, expected) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: 'prep-publication-receipt-not-an-object' };
  }
  const keys = Object.keys(record);
  if (!PREP_PUBLICATION_RECEIPT_KEYS.every((k) => Object.prototype.hasOwnProperty.call(record, k))) {
    return { ok: false, reason: 'prep-publication-receipt-missing-key' };
  }
  if (keys.length !== PREP_PUBLICATION_RECEIPT_KEYS.length) {
    return { ok: false, reason: 'prep-publication-receipt-unexpected-key' };
  }
  if (record.schema !== PREP_PUBLICATION_RECEIPT_SCHEMA) return { ok: false, reason: 'prep-publication-receipt-schema-mismatch' };
  if (!isHexCsprng32(record.receipt_id)) return { ok: false, reason: 'prep-publication-receipt-receipt-id-invalid' };
  if (!isHexCsprng32(record.intent_id)) return { ok: false, reason: 'prep-publication-receipt-intent-id-invalid' };
  if (!P2_SUBJECT_BUNDLE_SEED_ROLES.includes(record.role)) return { ok: false, reason: 'prep-publication-receipt-role-invalid' };
  if (typeof record.wave_slug !== 'string' || record.wave_slug.length === 0) return { ok: false, reason: 'prep-publication-receipt-wave-slug-invalid' };
  if (typeof record.head !== 'string' || !/^[0-9a-f]{40}$/.test(record.head)) return { ok: false, reason: 'prep-publication-receipt-head-invalid' };
  if (!isHexDigest64(record.plan_sha256)) return { ok: false, reason: 'prep-publication-receipt-plan-sha256-invalid' };
  if (!isHexCsprng32(record.binding_id)) return { ok: false, reason: 'prep-publication-receipt-binding-id-invalid' };
  if (!isHexCsprng32(record.requester_actor_instance_id)) return { ok: false, reason: 'prep-publication-receipt-requester-actor-instance-id-invalid' };
  if (!isHexCsprng32(record.session_generation_id)) return { ok: false, reason: 'prep-publication-receipt-session-generation-id-invalid' };
  if (!isHexCsprng32(record.cp_intent_id)) return { ok: false, reason: 'prep-publication-receipt-cp-intent-id-invalid' };
  if (!isHexDigest64(record.cp_completion_digest)) return { ok: false, reason: 'prep-publication-receipt-cp-completion-digest-invalid' };
  if (!isHexDigest64(record.subject_scope_digest)) return { ok: false, reason: 'prep-publication-receipt-subject-scope-digest-invalid' };
  if (record.review_decision !== 'APPROVED_PREP') return { ok: false, reason: 'prep-publication-receipt-review-decision-not-approved' };
  if (!isHexCsprng32(record.publication_nonce)) return { ok: false, reason: 'prep-publication-receipt-publication-nonce-invalid' };
  if (typeof record.verdict_ref !== 'string' || !record.verdict_ref.endsWith('.md') || !isSafeP2SubjectPath(record.verdict_ref)) {
    return { ok: false, reason: 'prep-publication-receipt-verdict-ref-invalid' };
  }
  if (!isHexDigest64(record.verdict_full_sha256)) return { ok: false, reason: 'prep-publication-receipt-verdict-full-sha256-invalid' };
  if (!isCanonicalIsoUtc(record.published_at)) return { ok: false, reason: 'prep-publication-receipt-published-at-invalid' };

  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, reason: 'prep-publication-receipt-expected-not-an-object' };
  }
  for (const field of PREP_PUBLICATION_RECEIPT_CORRELATED_FIELDS) {
    if (record[field] !== expected[field]) return { ok: false, reason: 'prep-publication-receipt-' + field.replace(/_/g, '-') + '-mismatch' };
  }

  return { ok: true, record };
}

// ── R131 P2 GREEN-A2b: reservation seam (reservePrepPublicationIntent) ──────
// Pure reservation seam: mints/publishes a `runtime/prep-publication-intent/v1`
// record (state RESERVED) after fresh worker/RoleActorBinding authority +
// durable root-chain + predecessor revalidation. NO grammar/completion/
// conflict/bridge-child/P3 here (proposal-final.json scope_boundary). The
// positive RESERVED mint is proven only by RED-C/live
// (APP-LIVE-PREP-01..08/APP-LIVE-PREP-GENUINE-01); PPI-07 here proves only
// fail-closed zero-mutation on a hand-seeded/no-live-authority fixture.

/**
 * WAL path for a role's PREP-publication intent -- fixed at one per
 * (waveSlug, role) forever (publishNoClobber below is the sole mutation).
 * @param {string} projectRootOrRepoDescriptor
 * @param {string} waveSlug
 * @param {string} role
 * @returns {string}
 */
function prepPublicationIntentPathFor(projectRootOrRepoDescriptor, waveSlug, role) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'prep-publications', waveSlug, role + '.intent.json');
}

/**
 * WAL path for a role's PREP-publication receipt (published later, out of
 * this unit's scope; only read here for predecessor-completion proof).
 * @param {string} projectRootOrRepoDescriptor
 * @param {string} waveSlug
 * @param {string} role
 * @returns {string}
 */
function prepPublicationReceiptPathFor(projectRootOrRepoDescriptor, waveSlug, role) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'prep-publications', waveSlug, role + '.receipt.json');
}

/**
 * NEW sibling path helper (the ONLY new path helper this unit adds): the
 * durable root-consult-review record for a given root-consult intent id.
 * @param {string} projectRootOrRepoDescriptor
 * @param {string} intentId
 * @returns {string}
 */
function rootConsultReviewPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents', intentId + '.review.json');
}

/**
 * P5 U2 sibling path helper: mirrors rootConsultReviewPathFor's directory
 * convention exactly -- only the leaf subdirectory literal changes.
 * @param {string} projectRootOrRepoDescriptor
 * @param {string} intentId
 * @returns {string}
 */
function mixedReviewVerdictPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'mixed-review-verdicts', intentId + '.review.json');
}

/**
 * P5 U2 live-wiring sibling path helper: durable blob storage for the raw
 * reviewed subject text, published BEFORE its owning intent so the intent's
 * own subject_head always has a real, already-durable text body behind it.
 * Deliberately its own dedicated leaf (not a reuse of subject_bundle_ref/
 * s16MaterializeArchitectSubjectBundle -- already established those don't
 * fit this use case). Keyed by intentId (not a bare content digest): the
 * closed runtime/root-consult-intent/v1 schema has no field to carry a
 * subject-text digest forward for a later reader to look the blob up by,
 * so intentId -- which both the publisher (handleMixedReviewRequest) and
 * the later reader (collectPendingMixedReviewRequest, working from an
 * already-read intent record) always have -- is the retrievable key. The
 * blob's own content still carries digest=sha256String(text) alongside the
 * text itself, which becomes reviewed_subject_digest verbatim once the
 * verdict record is built -- self-verified on every read.
 * @param {string} projectRootOrRepoDescriptor
 * @param {string} intentId
 * @returns {string}
 */
function mixedReviewSubjectPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'mixed-review-subjects', intentId + '.json');
}

/**
 * Pure predecessor-role lookup for the PREP-publication sequencing chain:
 * arch-platform has no predecessor; arch-testing requires arch-platform
 * COMPLETED; arch-integration requires arch-testing COMPLETED.
 * @param {string} role
 * @returns {string|null}
 */
function prepPublicationPredecessorRole(role) {
  if (role === 'arch-testing') return 'arch-platform';
  if (role === 'arch-integration') return 'arch-testing';
  return null;
}

  return Object.freeze({
    PREP_PUBLICATION_INTENT_SCHEMA, PREP_PUBLICATION_INTENT_KEYS, PREP_PUBLICATION_INTENT_STATES,
    PREP_PUBLICATION_INTENT_CORRELATED_FIELDS, validatePrepPublicationIntentRecord,
    PREP_PUBLICATION_RECEIPT_SCHEMA, PREP_PUBLICATION_RECEIPT_KEYS,
    PREP_PUBLICATION_RECEIPT_CORRELATED_FIELDS, validatePrepPublicationReceiptRecord,
    prepPublicationIntentPathFor, prepPublicationReceiptPathFor, rootConsultReviewPathFor,
    mixedReviewVerdictPathFor, mixedReviewSubjectPathFor, prepPublicationPredecessorRole,
  });
}

module.exports = { createPrepPublicationRecords };
