'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: root-consult
// intent/reservation/published/completion records -- PLAN.md §16a's
// closed schemas, path builders, closed-shape validators, and the
// read/list/find seams over them. mixedReviewVerdictPathFor is injected
// (defined in mixed-review-records.cjs, read further down in the original
// facade -- forward reference, never a require() cycle). Never requires the
// facade or a sibling module.

function createRootConsultRecords({
  path, fs, registryRepoDir, readRegistryRecord, hasExactKeys, isHexCsprng32,
  isHexDigest64, isHexActionId, isCanonicalIsoUtc, isoToMsForRegistry, CANONICAL_ROLES,
  Buffer, RESULT_KIND_RE, mixedReviewVerdictPathFor, validateExpectedRecordFields,
}) {
const ROOT_CONSULT_INTENT_SCHEMA = 'runtime/root-consult-intent/v1';
const ROOT_CONSULT_INTENT_KEYS = Object.freeze([
  'coordination_root_id', 'created_at', 'evidence_policy', 'expiry', 'expected_result_kind',
  'initial_attempt_id', 'intent_id', 'main_actor_instance_id', 'main_binding_id',
  'plan_digest', 'question', 'repo_id', 'request_created_at', 'request_expiry',
  'request_id', 'requester_actor_instance_id', 'requester_binding_id', 'requester_role',
  'routing_policy_digest', 'routing_policy_version', 'schema', 'session_generation_id',
  'subject_bundle_ref', 'subject_head', 'subject_repo_id', 'subject_scope_digest',
  'subject_worktree_id', 'target_role', 'target_role_profile_digest',
  'target_role_profile_version', 'worktree_id',
].sort());
const ROOT_CONSULT_RESERVATION_SCHEMA = 'runtime/root-consult-reservation/v1';
const ROOT_CONSULT_RESERVATION_KEYS = Object.freeze([
  'expiry', 'intent_digest', 'intent_id', 'request_digest', 'request_id',
  'requester_actor_instance_id', 'reserved_at', 'schema',
].sort());
const ROOT_CONSULT_PUBLISHED_SCHEMA = 'runtime/root-consult-published/v1';
const ROOT_CONSULT_PUBLISHED_KEYS = Object.freeze([
  'intent_digest', 'intent_id', 'published_at', 'request_digest', 'request_id',
  'request_ref', 'reservation_digest', 'schema',
].sort());
const ROOT_CONSULT_COMPLETION_SCHEMA = 'runtime/root-consult-completion/v1';
const ROOT_CONSULT_COMPLETION_KEYS = Object.freeze([
  'accepted_result_digest', 'accepted_result_ref', 'ack_digest', 'ack_ref', 'created_at',
  'intent_id', 'request_digest', 'request_id', 'requester_actor_instance_id',
  'result_digest', 'result_ref', 'schema',
].sort());
const ROOT_CONSULT_SCAN_CAP = 1024;

function rootConsultIntentPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents', intentId + '.json');
}
function rootConsultReservationPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents', intentId + '.reserved.json');
}
function rootConsultPublishedPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents', intentId + '.published.json');
}
function rootConsultCompletionPathFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents', intentId + '.completion.json');
}
function rootConsultLockDirFor(projectRootOrRepoDescriptor, intentId) {
  return path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-locks', intentId + '.lock');
}

// validateExpectedRecordFields is injected (shared with the facade's own
// rootSourceContract composition -- see the factory's own param comment).
function validateRootConsultIntentRecord(record, expected) {
  if (!record || !hasExactKeys(record, ROOT_CONSULT_INTENT_KEYS) || record.schema !== ROOT_CONSULT_INTENT_SCHEMA) return { ok: false, reason: 'root-consult-intent-shape-invalid' };
  if (!isHexCsprng32(record.intent_id) || !isHexCsprng32(record.main_binding_id) || !isHexCsprng32(record.main_actor_instance_id)
      || !isHexCsprng32(record.session_generation_id) || !isHexDigest64(record.repo_id) || !isHexDigest64(record.worktree_id)
      || !isHexDigest64(record.plan_digest) || !isHexDigest64(record.coordination_root_id)
      || !['arch-platform', 'arch-testing', 'arch-integration'].includes(record.requester_role)
      || !isHexCsprng32(record.requester_binding_id) || typeof record.requester_actor_instance_id !== 'string' || record.requester_actor_instance_id.length === 0
      || !CANONICAL_ROLES.includes(record.target_role) || record.target_role_profile_version !== '1.0.0'
      || !isHexDigest64(record.target_role_profile_digest) || typeof record.question !== 'string' || record.question.length === 0
      || Buffer.byteLength(record.question, 'utf8') > 8192 || !RESULT_KIND_RE.test(record.expected_result_kind)
      || !['none', 'context7-required', 'context7-preferred'].includes(record.evidence_policy) || !isHexDigest64(record.routing_policy_digest)
      || record.routing_policy_version !== 'runtime-routing/v1' || !isHexDigest64(record.subject_repo_id)
      || !isHexDigest64(record.subject_worktree_id) || typeof record.subject_head !== 'string' || record.subject_head.length === 0
      || typeof record.subject_bundle_ref !== 'string' || record.subject_bundle_ref.length === 0 || !isHexDigest64(record.subject_scope_digest)
      || !isHexActionId(record.request_id) || !isHexActionId(record.initial_attempt_id)
      || !isCanonicalIsoUtc(record.request_created_at) || !isCanonicalIsoUtc(record.request_expiry)
      || !isCanonicalIsoUtc(record.created_at) || !isCanonicalIsoUtc(record.expiry)
      || !validateExpectedRecordFields(record, expected)) return { ok: false, reason: 'root-consult-intent-shape-invalid' };
  const createdAtMs = isoToMsForRegistry(record.created_at);
  const expiryMs = isoToMsForRegistry(record.expiry);
  const requestExpiryMs = isoToMsForRegistry(record.request_expiry);
  // NO-GO Correction A (PLAN.md §16a): activation lifetime is <=30s AND
  // independently <=request_expiry -- both bounds enforced here so a
  // corrupt/malicious record can never widen the activation window past
  // either cap, regardless of what handleConsultRoot itself constructs.
  if (createdAtMs > expiryMs
      || isoToMsForRegistry(record.request_created_at) > requestExpiryMs
      || expiryMs > createdAtMs + 30000
      || expiryMs > requestExpiryMs) return { ok: false, reason: 'root-consult-intent-time-invalid' };
  return { ok: true, record };
}
function validateRootConsultReservationRecord(record, expected) {
  if (!record || !hasExactKeys(record, ROOT_CONSULT_RESERVATION_KEYS) || record.schema !== ROOT_CONSULT_RESERVATION_SCHEMA
      || !isHexCsprng32(record.intent_id) || !isHexDigest64(record.intent_digest) || !isHexActionId(record.request_id)
      || !isHexDigest64(record.request_digest) || typeof record.requester_actor_instance_id !== 'string' || record.requester_actor_instance_id.length === 0
      || !isCanonicalIsoUtc(record.reserved_at) || !isCanonicalIsoUtc(record.expiry) || !validateExpectedRecordFields(record, expected)) return { ok: false, reason: 'root-consult-reservation-shape-invalid' };
  return { ok: true, record };
}
function validateRootConsultPublishedRecord(record, expected) {
  if (!record || !hasExactKeys(record, ROOT_CONSULT_PUBLISHED_KEYS) || record.schema !== ROOT_CONSULT_PUBLISHED_SCHEMA
      || !isHexCsprng32(record.intent_id) || !isHexDigest64(record.intent_digest) || !isHexDigest64(record.reservation_digest)
      || !isHexActionId(record.request_id) || typeof record.request_ref !== 'string' || record.request_ref.length === 0
      || !isHexDigest64(record.request_digest) || !isCanonicalIsoUtc(record.published_at)
      || !validateExpectedRecordFields(record, expected)) return { ok: false, reason: 'root-consult-published-shape-invalid' };
  return { ok: true, record };
}
function validateRootConsultCompletionRecord(record, expected) {
  if (!record || !hasExactKeys(record, ROOT_CONSULT_COMPLETION_KEYS) || record.schema !== ROOT_CONSULT_COMPLETION_SCHEMA
      || !isHexCsprng32(record.intent_id) || !isHexActionId(record.request_id) || !isHexDigest64(record.request_digest)
      || typeof record.result_ref !== 'string' || record.result_ref.length === 0 || !isHexDigest64(record.result_digest)
      || typeof record.accepted_result_ref !== 'string' || record.accepted_result_ref.length === 0 || !isHexDigest64(record.accepted_result_digest)
      || typeof record.ack_ref !== 'string' || record.ack_ref.length === 0 || !isHexDigest64(record.ack_digest)
      || typeof record.requester_actor_instance_id !== 'string' || record.requester_actor_instance_id.length === 0
      || !isCanonicalIsoUtc(record.created_at) || !validateExpectedRecordFields(record, expected)) return { ok: false, reason: 'root-consult-completion-shape-invalid' };
  return { ok: true, record };
}

function readRootConsultIntent(projectRootOrRepoDescriptor, intentId) {
  if (!isHexCsprng32(intentId)) return { ok: false, reason: 'root-consult-intent-id-invalid' };
  const read = readRegistryRecord(rootConsultIntentPathFor(projectRootOrRepoDescriptor, intentId));
  if (!read.ok) return { ok: false, reason: read.reason };
  if (read.absent) return { ok: true, absent: true };
  const valid = validateRootConsultIntentRecord(read.obj, { intent_id: intentId });
  return valid.ok ? { ok: true, absent: false, intent: valid.record } : valid;
}

function listRootConsultIntentsForActor(projectRootOrRepoDescriptor, actorInstanceId) {
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return err && err.code === 'ENOENT' ? { ok: true, intents: [] } : { ok: false, reason: 'root-consult-intent-scan-failed' }; }
  if (entries.length > ROOT_CONSULT_SCAN_CAP * 4) return { ok: false, reason: 'root-consult-intent-scan-cap-exceeded' };
  const intents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const read = readRootConsultIntent(projectRootOrRepoDescriptor, entry.name.slice(0, -5));
    // readdir can observe the final filename while its durable no-clobber
    // publication is still settling. `pending` is an authenticated-reader
    // classification for that bounded race, not a corrupt record: defer it
    // to the next poll. Every other read failure remains fail-closed.
    if (!read.ok && read.reason === 'pending') continue;
    if (!read.ok) return read;
    if (!read.absent && read.intent.requester_actor_instance_id === actorInstanceId) intents.push(read.intent);
  }
  if (intents.length > ROOT_CONSULT_SCAN_CAP) return { ok: false, reason: 'root-consult-intent-scan-cap-exceeded' };
  return { ok: true, intents };
}

// P5 U2 live-wiring: matches runtime-bridge-codex.cjs's own
// MIXED_REVIEW_SUBJECT_MAX_BYTES exactly (that file is the authorized files[]
// entry for the turn-input side; this is the mirrored cap for the durable
// blob side, kept as a separate local constant since the two files cannot
// require() each other).
const MIXED_REVIEW_SUBJECT_MAX_BYTES = 65536;

/**
 * P5 U2 live-wiring: scans root-consult-intents/ for mixed-review intents
 * (expected_result_kind==='P5_MIXED_REVIEW_VERDICT') addressed to targetRole
 * that have no existing runtime/mixed-review-verdict/v1 record yet. Mirrors
 * listRootConsultIntentsForActor's own scan shape exactly, filtered by
 * target_role instead of requester_actor_instance_id, plus the additional
 * verdict-absence check this use case needs (no P2 analog for that half).
 * @param {string|{repoId:string}} projectRootOrRepoDescriptor
 * @param {string} targetRole
 * @returns {{ok:true,intents:object[]}|{ok:false,reason:string}}
 */
function listPendingMixedReviewIntentsForRole(projectRootOrRepoDescriptor, targetRole) {
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { return err && err.code === 'ENOENT' ? { ok: true, intents: [] } : { ok: false, reason: 'root-consult-intent-scan-failed' }; }
  if (entries.length > ROOT_CONSULT_SCAN_CAP * 4) return { ok: false, reason: 'root-consult-intent-scan-cap-exceeded' };
  const intents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const read = readRootConsultIntent(projectRootOrRepoDescriptor, entry.name.slice(0, -5));
    // publishNoClobber exposes the final directory entry before every reader
    // can necessarily observe its complete durable payload. A poll may defer
    // that one entry to its next pass; corruption and every other read error
    // remain fail-closed.
    if (!read.ok && read.reason === 'pending') continue;
    if (!read.ok) return read;
    if (read.absent) continue;
    if (read.intent.target_role !== targetRole || read.intent.expected_result_kind !== 'P5_MIXED_REVIEW_VERDICT') continue;
    const verdictRead = readRegistryRecord(mixedReviewVerdictPathFor(projectRootOrRepoDescriptor, read.intent.intent_id));
    if (!verdictRead.ok) return { ok: false, reason: verdictRead.reason };
    if (!verdictRead.absent) continue;
    intents.push(read.intent);
  }
  if (intents.length > ROOT_CONSULT_SCAN_CAP) return { ok: false, reason: 'root-consult-intent-scan-cap-exceeded' };
  return { ok: true, intents };
}

function findRootConsultIntentByRequestId(projectRootOrRepoDescriptor, requestId) {
  // S16-ROOT-SOURCE-E2E finding, refined: request_id is NOT one fixed
  // length. handleConsultRoot's own preallocated request_id is
  // crypto.randomBytes(16) (128-bit/32-hex, PLAN.md §16a "preallocated
  // request_id|initial_attempt_id|created_at|expiry" -- the exact bytes the
  // eventual canonical request.json publishes under), while cmdPublishRequest's
  // genId() (every ordinary/root-source-originated request) is 256-bit/64-hex
  // -- runtime-consultation.cjs's own genId128 doc comment spells the
  // distinction out. This function's caller (findCorrelatedRootConsultIntent,
  // via rootConsultEvidencePolicyForRequest) runs for EVERY result regardless
  // of origin, so it must accept EITHER length -- never isHexCsprng32's fixed
  // 32 (which live-crashed a retained worker, APP_SERVER_POLL_FAILED, the
  // moment it evaluated pattern-evidence policy for an ordinary 64-hex
  // request) nor a fixed 64 (which would just as surely reject a genuine
  // root-consult-originated 32-hex one). isHexActionId's open-ended 32+
  // shape is the one already-established check with no upper bound.
  if (!isHexActionId(requestId)) return { ok: false, reason: 'root-consult-request-id-invalid' };
  const dir = path.join(registryRepoDir(projectRootOrRepoDescriptor), 'root-consult-intents');
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { return err && err.code === 'ENOENT' ? { ok: true, absent: true } : { ok: false, reason: 'root-consult-intent-scan-failed' }; }
  if (entries.length > ROOT_CONSULT_SCAN_CAP * 4) return { ok: false, reason: 'root-consult-intent-scan-cap-exceeded' };
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[0-9a-f]{32}\.json$/.test(entry.name)) continue;
    const read = readRootConsultIntent(projectRootOrRepoDescriptor, entry.name.slice(0, -5));
    if (!read.ok) return read;
    if (!read.absent && read.intent.request_id === requestId) matches.push(read.intent);
  }
  if (matches.length === 0) return { ok: true, absent: true };
  if (matches.length > 1) return { ok: false, reason: 'root-consult-request-id-ambiguous' };
  return { ok: true, absent: false, intent: matches[0] };
}

  return Object.freeze({
    ROOT_CONSULT_INTENT_SCHEMA, ROOT_CONSULT_INTENT_KEYS, ROOT_CONSULT_RESERVATION_SCHEMA,
    ROOT_CONSULT_RESERVATION_KEYS, ROOT_CONSULT_PUBLISHED_SCHEMA, ROOT_CONSULT_PUBLISHED_KEYS,
    ROOT_CONSULT_COMPLETION_SCHEMA, ROOT_CONSULT_COMPLETION_KEYS, ROOT_CONSULT_SCAN_CAP,
    MIXED_REVIEW_SUBJECT_MAX_BYTES,
    rootConsultIntentPathFor, rootConsultReservationPathFor, rootConsultPublishedPathFor,
    rootConsultCompletionPathFor, rootConsultLockDirFor, validateRootConsultIntentRecord,
    validateRootConsultReservationRecord, validateRootConsultPublishedRecord,
    validateRootConsultCompletionRecord, readRootConsultIntent, listRootConsultIntentsForActor,
    listPendingMixedReviewIntentsForRole, findRootConsultIntentByRequestId,
  });
}

module.exports = { createRootConsultRecords };
