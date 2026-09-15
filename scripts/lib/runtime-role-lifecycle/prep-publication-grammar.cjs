'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the fixed 9-line
// PREP-publication verdict grammar parser (P2 GREEN-A2c) plus the
// completion/conflict transition seams (P2 GREEN-A2d). Never requires the
// facade or a sibling module.

function createPrepPublicationGrammar({
isCanonicalIsoUtc, hasExactKeys, canonicalJSONStringify, sha256Buffer, registryRepoDir,
  readRegistryRecord, writeRegistryRecordReplace, path, crypto, isHexDigest64, isSafeP2SubjectPath,
  nowIsoForRegistry, PREP_PUBLICATION_INTENT_CORRELATED_FIELDS,
  PREP_PUBLICATION_INTENT_STATES, PREP_PUBLICATION_INTENT_KEYS, PREP_PUBLICATION_RECEIPT_SCHEMA,
  PREP_PUBLICATION_RECEIPT_KEYS, validatePrepPublicationIntentRecord, validatePrepPublicationReceiptRecord,
  prepPublicationIntentPathFor, prepPublicationReceiptPathFor,
}) {
// ── R131 P2 GREEN-A2c: exact PREP-publication verdict grammar parser ───────
// Pure parser/validator for the fixed 9-line PREP verdict grammar (PPG-01..
// 09). No fs/child_process/network/writes/authority/state transition/child
// spawn/bridge/live P3 anywhere in this seam -- `intent` is correlation
// input only, never an authority source. completePrepPublicationIntent/
// conflictPrepPublicationIntent (PPC-01/02) are OUT OF SCOPE here.

const PREP_PUBLICATION_GRAMMAR_ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const PREP_PUBLICATION_GRAMMAR_WAVE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PREP_PUBLICATION_GRAMMAR_HEAD_RE = /^[0-9a-f]{40}$/;
const PREP_PUBLICATION_GRAMMAR_PLAN_SHA256_RE = /^[0-9a-f]{64}$/;
const PREP_PUBLICATION_GRAMMAR_NONCE_RE = /^[0-9a-f]{32}$/;
const PREP_PUBLICATION_GRAMMAR_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PREP_PUBLICATION_TIMESTAMP_WINDOW_MS = 300000;

/**
 * Pure exact-grammar parser/validator for a PREP-publication verdict's raw
 * bytes (PPG-01..09). `bytes` is the RAW verdict Buffer (never pre-decoded);
 * `intent` is a read-only correlation record, never mutated and never an
 * authority source -- this performs zero MainOrchestratorBinding/
 * SessionGeneration/repo/worktree/roster/fs/state resolution. `Date.now()`
 * is the sole time source (no third argument).
 * @param {Buffer} bytes
 * @param {object} intent
 * @returns {{ok:true,fields:{role:string,wave_slug:string,phase:string,timestamp:string,status:string,head:string,plan_sha256:string,publication_nonce:string}}|{ok:false,reason:string}}
 */
function validatePrepPublicationGrammar(bytes, intent) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) {
    return { ok: false, reason: 'invalid_intent_shape:intent' };
  }
  if (!PREP_PUBLICATION_GRAMMAR_ROLES.includes(intent.role)) {
    return { ok: false, reason: 'invalid_intent_shape:role' };
  }
  if (typeof intent.wave_slug !== 'string' || intent.wave_slug.length === 0
      || !PREP_PUBLICATION_GRAMMAR_WAVE_SLUG_RE.test(intent.wave_slug)) {
    return { ok: false, reason: 'invalid_intent_shape:wave_slug' };
  }
  if (typeof intent.head !== 'string' || !PREP_PUBLICATION_GRAMMAR_HEAD_RE.test(intent.head)) {
    return { ok: false, reason: 'invalid_intent_shape:head' };
  }
  if (typeof intent.plan_sha256 !== 'string' || !PREP_PUBLICATION_GRAMMAR_PLAN_SHA256_RE.test(intent.plan_sha256)) {
    return { ok: false, reason: 'invalid_intent_shape:plan_sha256' };
  }
  if (typeof intent.publication_nonce !== 'string' || !PREP_PUBLICATION_GRAMMAR_NONCE_RE.test(intent.publication_nonce)) {
    return { ok: false, reason: 'invalid_intent_shape:publication_nonce' };
  }

  if (!Buffer.isBuffer(bytes)) return { ok: false, reason: 'invalid_buffer' };
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x0d || b === 0x00) return { ok: false, reason: 'cr_or_nul_byte' };
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (err) {
    return { ok: false, reason: 'invalid_utf8' };
  }

  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
    return { ok: false, reason: 'missing_final_newline' };
  }
  const lines = text.split('\n');
  if (lines.length !== 10) return { ok: false, reason: 'line_count' };
  const [l1, l2, l3, l4, l5, l6, l7, l8, l9, l10] = lines;

  if (l2 !== '') return { ok: false, reason: 'field_mismatch:l2' };
  if (l9 !== '') return { ok: false, reason: 'field_mismatch:l9' };
  if (l10 !== '') return { ok: false, reason: 'field_mismatch:l10' };

  const l1Prefix = '# ';
  const l1Suffix = ' verdict — wave-' + intent.wave_slug;
  if (!l1.startsWith(l1Prefix) || !l1.endsWith(l1Suffix)
      || l1.length < l1Prefix.length + l1Suffix.length) {
    return { ok: false, reason: 'field_mismatch:l1' };
  }
  const role = l1.slice(l1Prefix.length, l1.length - l1Suffix.length);
  if (role !== intent.role) return { ok: false, reason: 'field_mismatch:role' };
  const waveSlug = intent.wave_slug;

  if (l3 !== '**Phase**: PREP') return { ok: false, reason: 'field_mismatch:l3' };
  const phase = 'PREP';

  const l4Prefix = '**Timestamp**: ';
  if (!l4.startsWith(l4Prefix)) return { ok: false, reason: 'timestamp_format' };
  const timestamp = l4.slice(l4Prefix.length);
  if (!PREP_PUBLICATION_GRAMMAR_TIMESTAMP_RE.test(timestamp)) return { ok: false, reason: 'timestamp_format' };
  const parsedMs = Date.parse(timestamp);
  if (Number.isNaN(parsedMs)) return { ok: false, reason: 'timestamp_format' };
  if (new Date(parsedMs).toISOString().replace(/\.\d{3}Z$/, 'Z') !== timestamp) {
    return { ok: false, reason: 'timestamp_format' };
  }
  const now = Date.now();
  if (!(now - PREP_PUBLICATION_TIMESTAMP_WINDOW_MS <= parsedMs && parsedMs <= now)) {
    return { ok: false, reason: 'timestamp_out_of_window' };
  }

  if (l5 !== '**Status**: APPROVED-PREP') return { ok: false, reason: 'field_mismatch:l5' };
  const status = 'APPROVED-PREP';

  const l6Prefix = '**PREP-HEAD**: ';
  if (!l6.startsWith(l6Prefix)) return { ok: false, reason: 'field_mismatch:l6' };
  const head = l6.slice(l6Prefix.length);
  if (head !== intent.head) return { ok: false, reason: 'field_mismatch:head' };

  const l7Prefix = '**PLAN_SHA256**: ';
  if (!l7.startsWith(l7Prefix)) return { ok: false, reason: 'field_mismatch:l7' };
  const planSha256 = l7.slice(l7Prefix.length);
  if (planSha256 !== intent.plan_sha256) return { ok: false, reason: 'field_mismatch:plan_sha256' };

  const l8Prefix = '**PUBLICATION-NONCE**: ';
  if (!l8.startsWith(l8Prefix)) return { ok: false, reason: 'field_mismatch:l8' };
  const publicationNonce = l8.slice(l8Prefix.length);
  if (publicationNonce !== intent.publication_nonce) return { ok: false, reason: 'nonce_mismatch' };

  return {
    ok: true,
    fields: {
      role, wave_slug: waveSlug, phase, timestamp, status, head,
      plan_sha256: planSha256, publication_nonce: publicationNonce,
    },
  };
}

// ── R131 P2 GREEN-A2d: completion/conflict transition seams ────────────────
// Pure state-transition seams for a `runtime/prep-publication-intent/v1`
// record: no fs/network/child_process/authority resolution anywhere here.
// `intent` is read-only correlation/state input, never mutated -- every
// output is a freshly-built object literal.

const PREP_PUBLICATION_PARSED_GRAMMAR_FIELDS = Object.freeze([
  'role', 'wave_slug', 'phase', 'timestamp', 'status', 'head', 'plan_sha256', 'publication_nonce',
]);

/**
 * Builds the `PREP_PUBLICATION_INTENT_CORRELATED_FIELDS` expectation snapshot
 * from `intent`'s own fields, used to closed-shape validate `intent` against
 * itself before any transition (never circularly against its own output).
 * @param {object} intent
 * @returns {object}
 */
function prepPublicationIntentExpectedFromSelf(intent) {
  const expected = {};
  for (const field of PREP_PUBLICATION_INTENT_CORRELATED_FIELDS) {
    expected[field] = intent[field];
  }
  return expected;
}

/**
 * Transitions a RESERVED/PUBLISHED_PENDING_RECEIPT
 * `runtime/prep-publication-intent/v1` record to COMPLETED and mints its
 * `runtime/prep-publication-receipt/v1` companion, after validating `intent`
 * against itself (closed-shape, pre-transition) and `parsed` (the exact
 * 8-field grammar success payload) against `intent`'s own correlated fields.
 * Pure: no fs/network/child_process/authority resolution; `intent` is never
 * mutated -- `newIntent`/`receipt` are the only new objects, both built from
 * `intent`'s validated fields plus the verdict reference/digest arguments.
 * @param {object} intent
 * @param {object} parsed
 * @param {string} verdictRef
 * @param {string} verdictFullSha256
 * @returns {{ok:true,intent:object,receipt:object}|{ok:false,reason:string}}
 */
function completePrepPublicationIntent(intent, parsed, verdictRef, verdictFullSha256) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) {
    return { ok: false, reason: 'complete-prep-intent-invalid' };
  }
  if (intent.state !== 'RESERVED' && intent.state !== 'PUBLISHED_PENDING_RECEIPT') {
    return { ok: false, reason: 'complete-prep-intent-not-completable' };
  }
  const expectedIntent = prepPublicationIntentExpectedFromSelf(intent);
  const intentSelfValid = validatePrepPublicationIntentRecord(intent, expectedIntent);
  if (!intentSelfValid.ok) return intentSelfValid;

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'complete-prep-parsed-invalid' };
  }
  const parsedKeys = Object.keys(parsed).slice().sort();
  const expectedParsedKeys = PREP_PUBLICATION_PARSED_GRAMMAR_FIELDS.slice().sort();
  if (parsedKeys.length !== expectedParsedKeys.length
      || !parsedKeys.every((k, i) => k === expectedParsedKeys[i])) {
    return { ok: false, reason: 'complete-prep-parsed-unexpected-key' };
  }
  if (parsed.phase !== 'PREP') return { ok: false, reason: 'complete-prep-parsed-phase-mismatch' };
  if (parsed.status !== 'APPROVED-PREP') return { ok: false, reason: 'complete-prep-parsed-status-mismatch' };
  if (parsed.role !== intent.role) return { ok: false, reason: 'complete-prep-parsed-role-mismatch' };
  if (parsed.wave_slug !== intent.wave_slug) return { ok: false, reason: 'complete-prep-parsed-wave_slug-mismatch' };
  if (parsed.head !== intent.head) return { ok: false, reason: 'complete-prep-parsed-head-mismatch' };
  if (parsed.plan_sha256 !== intent.plan_sha256) return { ok: false, reason: 'complete-prep-parsed-plan_sha256-mismatch' };
  if (parsed.publication_nonce !== intent.publication_nonce) return { ok: false, reason: 'complete-prep-parsed-publication_nonce-mismatch' };
  if (!isCanonicalIsoUtc(parsed.timestamp)) return { ok: false, reason: 'complete-prep-parsed-timestamp-invalid' };

  if (typeof verdictRef !== 'string' || !verdictRef.endsWith('.md') || !isSafeP2SubjectPath(verdictRef)) {
    return { ok: false, reason: 'complete-prep-verdict-ref-invalid' };
  }
  if (!isHexDigest64(verdictFullSha256)) return { ok: false, reason: 'complete-prep-verdict-full-sha256-invalid' };

  const now = nowIsoForRegistry();
  const nowMs = Date.parse(now);
  if (!(Date.parse(intent.reserved_at) <= nowMs && nowMs < Date.parse(intent.expiry))) {
    return { ok: false, reason: 'complete-prep-intent-expired' };
  }

  const newIntent = { ...intent, state: 'COMPLETED', state_updated_at: now };
  const receipt = {
    schema: PREP_PUBLICATION_RECEIPT_SCHEMA,
    receipt_id: crypto.randomBytes(16).toString('hex'),
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
    verdict_ref: verdictRef,
    verdict_full_sha256: verdictFullSha256,
    published_at: now,
  };
  const expectedReceipt = {
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
    verdict_ref: verdictRef,
    verdict_full_sha256: verdictFullSha256,
  };
  const receiptValid = validatePrepPublicationReceiptRecord(receipt, expectedReceipt);
  if (!receiptValid.ok) return receiptValid;

  const newIntentValid = validatePrepPublicationIntentRecord(newIntent, expectedIntent);
  if (!newIntentValid.ok) return newIntentValid;

  return { intent: newIntent, ok: true, receipt };
}

/**
 * Transitions a RESERVED/PUBLISHED_PENDING_RECEIPT
 * `runtime/prep-publication-intent/v1` record to CONFLICTED. `reason` is the
 * trigger only -- the schema has no conflict-reason field, so it is never
 * stored. Pure: no fs/network/child_process/authority resolution; `intent`
 * is never mutated -- `newIntent` is the sole new object.
 * @param {object} intent
 * @param {string} reason
 * @returns {{ok:true,intent:object}|{ok:false,reason:string}}
 */
function conflictPrepPublicationIntent(intent, reason) {
  if (intent === null || typeof intent !== 'object' || Array.isArray(intent)) {
    return { ok: false, reason: 'conflict-prep-intent-invalid' };
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    return { ok: false, reason: 'conflict-prep-reason-invalid' };
  }
  const expectedIntent = prepPublicationIntentExpectedFromSelf(intent);
  const intentSelfValid = validatePrepPublicationIntentRecord(intent, expectedIntent);
  if (!intentSelfValid.ok) return intentSelfValid;

  if (intent.state !== 'RESERVED' && intent.state !== 'PUBLISHED_PENDING_RECEIPT') {
    return { ok: false, reason: 'conflict-prep-intent-not-conflictable' };
  }

  const now = nowIsoForRegistry();
  const nowMs = Date.parse(now);
  if (!(Date.parse(intent.reserved_at) <= nowMs && nowMs < Date.parse(intent.expiry))) {
    return { ok: false, reason: 'conflict-prep-intent-expired' };
  }

  const newIntent = { ...intent, state: 'CONFLICTED', state_updated_at: now };
  const newIntentValid = validatePrepPublicationIntentRecord(newIntent, expectedIntent);
  if (!newIntentValid.ok) return newIntentValid;

  return { intent: newIntent, ok: true };
}

  return Object.freeze({
validatePrepPublicationGrammar, prepPublicationIntentExpectedFromSelf,
    completePrepPublicationIntent, conflictPrepPublicationIntent,
  });
}

module.exports = { createPrepPublicationGrammar };
