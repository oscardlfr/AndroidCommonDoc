'use strict';
// Pure verdict-request/v1 + verdict/v1 schema and binding logic (PLAN 3.2-3.5, 3.7).
const { createStructuralValidators } = require('./runtime-role-lifecycle/structural-validators.cjs');
const sv = createStructuralValidators({});
const ROLES = Object.freeze(['arch-platform', 'arch-testing', 'arch-integration']);
const PHASES = Object.freeze(['prep', 'verify-final']);
const DECISIONS = Object.freeze(['approve', 'escalate']);
const REASON_CODES = Object.freeze([
  'scope-conflict', 'evidence-insufficient', 'cross-architect-disagreement',
  'policy-violation', 'plan-defect', 'other',
]);
const EVIDENCE_KINDS = Object.freeze(['opaque-file', 'json-record']);
const WAVE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEAD_RE = /^[0-9a-f]{40}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const REQUEST_ID_RE = /^[0-9a-f]{32}$/;
const CREATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REQUEST_KEYS = ['created_at', 'head', 'phase', 'plan_sha256', 'request_id', 'role', 'schema', 'subject', 'wave_slug'].sort();
const SUBJECT_KEYS = ['kind', 'path', 'sha256'].sort();
const SUBJECT_KIND_FOR_PHASE = { prep: 'plan', 'verify-final': 'source-manifest' };
const VERDICT_BASE_KEYS = ['created_at', 'decision', 'evidence', 'head', 'in_reply_to', 'phase', 'plan_sha256', 'rationale', 'request_ref', 'role', 'schema', 'supersedes', 'wave_slug'].sort();
const VERDICT_ESCALATE_KEYS = VERDICT_BASE_KEYS.concat(['reason_code']).sort();
const REQUEST_REF_KEYS = ['path', 'sha256'].sort();
const SUPERSEDES_KEYS = ['sha256'];
const OPAQUE_FILE_KEYS = ['kind', 'path', 'sha256'].sort();
const JSON_RECORD_KEYS = ['expected_schema', 'kind', 'path', 'sha256'].sort();
function fail(reason) { return { ok: false, reason }; }
const OK = Object.freeze({ ok: true });
function isPlainObject(v) { return Boolean(v) && typeof v === 'object' && !Array.isArray(v); }
function isValidCreatedAt(value) {
  if (!CREATED_AT_RE.test(value || '')) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().replace('.000Z', 'Z') === value;
}
function isSafeRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.startsWith('/')
    && !/^[A-Za-z]:/.test(value) && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}
function serializeRecord(obj) {
  return Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function skipJsonValue(text, i) {
  const len = text.length;
  let depth = 0;
  for (; i < len; i += 1) {
    const c = text[i];
    if (c === '"') {
      i += 1;
      while (i < len && text[i] !== '"') { if (text[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '{' || c === '[') { depth += 1; continue; }
    if (c === '}' || c === ']') {
      if (depth === 0) return i;
      depth -= 1; continue;
    }
    if (c === ',' && depth === 0) return i;
  }
  return i;
}

function findTopLevelKeys(text) {
  let i = 0;
  const len = text.length;
  const skipWs = () => { while (i < len && /\s/.test(text[i])) i += 1; };
  skipWs();
  if (text[i] !== '{') return null;
  i += 1;
  skipWs();
  const keys = [];
  if (text[i] === '}') return keys;
  for (;;) {
    skipWs();
    if (text[i] !== '"') return null;
    let raw = '"';
    i += 1;
    while (i < len && text[i] !== '"') { raw += text[i]; if (text[i] === '\\') { i += 1; raw += text[i]; } i += 1; }
    raw += '"';
    i += 1;
    let key;
    try { key = JSON.parse(raw); } catch { return null; }
    keys.push(key);
    skipWs();
    if (text[i] !== ':') return null;
    i = skipJsonValue(text, i + 1);
    skipWs();
    if (text[i] === ',') { i += 1; continue; }
    if (text[i] === '}') break;
    return null;
  }
  return keys;
}

function decodeRecord(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.includes(0x00) || bytes.includes(0x0d)) return fail('invalid-encoding');
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a || (bytes.length > 1 && bytes[bytes.length - 2] === 0x0a)) return fail('invalid-final-newline');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('invalid-utf8'); }
  const topKeys = findTopLevelKeys(text);
  if (topKeys) {
    const seen = new Set();
    for (const k of topKeys) {
      if (seen.has(k)) return fail('duplicate-key');
      seen.add(k);
    }
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return fail('invalid-json: ' + err.message);
  }
  if (!isPlainObject(value)) return fail('not-an-object');
  return { ok: true, value };
}

function validateSubjectShape(subject, phase) {
  if (!isPlainObject(subject)) return fail('bad-subject');
  if (!sv.hasExactKeys(subject, SUBJECT_KEYS)) return fail('bad-subject');
  if (subject.kind !== 'plan' && subject.kind !== 'source-manifest') return fail('bad-subject-kind');
  if (SUBJECT_KIND_FOR_PHASE[phase] !== subject.kind) return fail('subject-kind-phase-mismatch');
  if (!SHA256_RE.test(subject.sha256)) return fail('bad-subject-sha256');
  if (!isSafeRelativePath(subject.path)) return fail('bad-subject-path');
  return OK;
}

function validateRequestShape(value) {
  if (!isPlainObject(value)) return fail('not-an-object');
  if (!sv.hasExactKeys(value, REQUEST_KEYS)) return fail('unknown-or-missing-key');
  if (value.schema !== 'verdict-request/v1') return fail('bad-schema');
  if (!REQUEST_ID_RE.test(value.request_id)) return fail('bad-request-id');
  if (!ROLES.includes(value.role)) return fail('bad-role');
  if (!PHASES.includes(value.phase)) return fail('bad-phase');
  if (!WAVE_SLUG_RE.test(value.wave_slug)) return fail('bad-wave-slug');
  if (!SHA256_RE.test(value.plan_sha256)) return fail('bad-plan-sha256');
  if (!HEAD_RE.test(value.head)) return fail('bad-head');
  if (!isValidCreatedAt(value.created_at)) return fail('bad-created-at');
  const subjResult = validateSubjectShape(value.subject, value.phase);
  if (!subjResult.ok) return subjResult;
  return OK;
}

function validateRequestRefShape(ref) {
  if (!isPlainObject(ref)) return fail('bad-request-ref');
  if (!sv.hasExactKeys(ref, REQUEST_REF_KEYS)) return fail('bad-request-ref');
  if (!isSafeRelativePath(ref.path)) return fail('bad-request-ref-path');
  if (!SHA256_RE.test(ref.sha256)) return fail('bad-request-ref-sha256');
  return OK;
}

function validateSupersedesShape(supersedes) {
  if (!isPlainObject(supersedes) || !sv.hasExactKeys(supersedes, SUPERSEDES_KEYS)) return fail('bad-supersedes');
  if (!SHA256_RE.test(supersedes.sha256)) return fail('bad-supersedes-sha256');
  return OK;
}

function validateEvidenceEntryShape(entry) {
  if (!isPlainObject(entry)) return fail('bad-evidence-entry');
  if (!EVIDENCE_KINDS.includes(entry.kind)) return fail('bad-evidence-kind');
  const expectedKeys = entry.kind === 'json-record' ? JSON_RECORD_KEYS : OPAQUE_FILE_KEYS;
  if (!sv.hasExactKeys(entry, expectedKeys)) return fail('bad-evidence-keys');
  if (!isSafeRelativePath(entry.path)) return fail('bad-evidence-path');
  if (!SHA256_RE.test(entry.sha256)) return fail('bad-evidence-sha256');
  if (entry.kind === 'json-record' && (typeof entry.expected_schema !== 'string' || entry.expected_schema.length === 0)) return fail('bad-expected-schema');
  return OK;
}

function validateVerdictShape(value) {
  if (!isPlainObject(value)) return fail('not-an-object');
  const decision = value.decision;
  if (decision !== 'approve' && decision !== 'escalate') return fail('bad-decision');
  const expectedKeys = decision === 'escalate' ? VERDICT_ESCALATE_KEYS : VERDICT_BASE_KEYS;
  if (!sv.hasExactKeys(value, expectedKeys)) return fail('unknown-or-missing-key');
  if (value.schema !== 'verdict/v1') return fail('bad-schema');
  if (!ROLES.includes(value.role)) return fail('bad-role');
  if (!WAVE_SLUG_RE.test(value.wave_slug)) return fail('bad-wave-slug');
  if (!PHASES.includes(value.phase)) return fail('bad-phase');
  if (decision === 'escalate' && !REASON_CODES.includes(value.reason_code)) return fail('bad-reason-code');
  const rationaleBytes = typeof value.rationale === 'string' ? Buffer.byteLength(value.rationale, 'utf8') : -1;
  if (rationaleBytes < 1 || rationaleBytes > 8192) return fail('bad-rationale-length');
  if (!Array.isArray(value.evidence) || value.evidence.length > 64) return fail('bad-evidence-length');
  for (const entry of value.evidence) {
    const evResult = validateEvidenceEntryShape(entry);
    if (!evResult.ok) return evResult;
  }
  if (value.phase === 'verify-final' && decision === 'approve' && value.evidence.length === 0) return fail('verify-final-approve-requires-evidence');
  if (!HEAD_RE.test(value.head)) return fail('bad-head');
  if (!SHA256_RE.test(value.plan_sha256)) return fail('bad-plan-sha256');
  if (!REQUEST_ID_RE.test(value.in_reply_to)) return fail('bad-in-reply-to');
  const refResult = validateRequestRefShape(value.request_ref);
  if (!refResult.ok) return refResult;
  if (!isValidCreatedAt(value.created_at)) return fail('bad-created-at');
  if (value.supersedes !== null) {
    const supResult = validateSupersedesShape(value.supersedes);
    if (!supResult.ok) return supResult;
  }
  return OK;
}

function crossCheckBinding({ request, verdict, expect }) {
  const roleBound = request.role === verdict.role && verdict.role === expect.role;
  const chronological = Date.parse(verdict.created_at) >= Date.parse(request.created_at);
  const requestBound = verdict.in_reply_to === request.request_id
    && request.wave_slug === verdict.wave_slug && verdict.wave_slug === expect.waveSlug
    && request.phase === verdict.phase && verdict.phase === expect.phase && chronological;
  const planBound = request.plan_sha256 === verdict.plan_sha256 && verdict.plan_sha256 === expect.planSha256;
  const sameHead = request.head === verdict.head;
  const headBound = verdict.phase === 'prep'
    ? (expect.headIsAncestor === true && sameHead)
    : (verdict.head === expect.head && sameHead);
  return { roleBound, requestBound, headBound, planBound };
}

const BOUND_FIELD_NAMES = ['exists', 'wellFormed', 'roleBound', 'requestBound', 'headBound', 'planBound', 'evidenceValid'];

function composeResult(input) {
  const bindings = {
    exists: input.exists === true,
    wellFormed: input.wellFormed === true,
    roleBound: input.roleBound === true,
    requestBound: input.requestBound === true,
    headBound: input.headBound === true,
    planBound: input.planBound === true,
    evidenceValid: input.evidenceValid !== false,
  };
  const decisionAuthorized = bindings.wellFormed && input.decision === 'approve';
  let reason = null;
  for (const name of BOUND_FIELD_NAMES) {
    if (!bindings[name]) { reason = name; break; }
  }
  if (reason === null && !decisionAuthorized) reason = 'decisionAuthorized';
  const authorizes = BOUND_FIELD_NAMES.every((name) => bindings[name]) && decisionAuthorized;
  return Object.assign({}, bindings, {
    decisionAuthorized, authorizes, reason: authorizes ? null : reason,
  });
}

function verdictsShareReplayedRequest(oldVerdict, newVerdict) {
  return oldVerdict.in_reply_to === newVerdict.in_reply_to;
}

module.exports = {
  ROLES, PHASES, DECISIONS, REASON_CODES, EVIDENCE_KINDS,
  serializeRecord, decodeRecord,
  isSafeRelativePath,
  validateRequestShape, validateVerdictShape, validateEvidenceEntryShape,
  crossCheckBinding, composeResult, verdictsShareReplayedRequest,
};
