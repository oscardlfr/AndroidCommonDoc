'use strict';

function createLifecycleArgv(deps) {
  const { Buffer, CANONICAL_ROLES, FORBIDDEN_FLAGS, hasExactKeys } = deps;

const SUBCOMMAND_SPEC = Object.freeze({
  probe: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      // Point 1.1 (R4): PLAN.md ~L150 -- "every lifecycle command requires"
      // a grant; the pre-CP bootstrap profile explicitly admits probe.
      // Optional at the ARGV-PARSE level (hook-injected, absence enforced
      // by the handler, same convention as ensure/notify/rotate/stop-owned).
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  ensure: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: true },
      // resume-work reuses ensure's one authenticated, multi-role
      // transaction but binds it to one immutable checkpoint. The flag is
      // code-owned by runtime-collaboration-entrypoints, never accepted as
      // actor/session identity.
      '--resume-checkpoint': { required: false, repeatable: false },
      // WP3: optional -- hook-injected in production (context-provider-gate.js,
      // real wiring is WP4); its ABSENCE is the normal ephemeral-fallback path
      // this file already implemented in WP1, unchanged. Its VALUE, when
      // present, must resolve to a real grant or the call is rejected.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  notify: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: false },
      '--artifact': { required: true, repeatable: false },
      '--kind': { required: true, repeatable: false },
      // WP3: optional -- top-level-orchestration-injected in production
      // (context-provider-gate.js, real wiring is WP4). See the `ensure`
      // entry above for the same rationale; unlike `ensure`, `notify` has no
      // ephemeral fallback, so its absence is always rejected.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'action-failed': {
    flags: {
      '--action': { required: true, repeatable: false },
      '--reason': { required: true, repeatable: false },
      // Point 1.1 (R4): see the `probe` entry above for the same rationale.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  ready: {
    flags: {
      '--action': { required: true, repeatable: false },
      // WP3: optional -- target-injected in production (runtime-consultation-
      // target-gate.js, real wiring is WP4). See the `ensure` entry above for
      // the same rationale.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'wait-ready': {
    flags: {
      '--action': { required: true, repeatable: false },
      '--timeout': { required: true, repeatable: false },
      // Point 1.1 (R4): see the `probe` entry above for the same rationale.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  status: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: false, repeatable: false },
      // Point 1.1 (R4): see the `probe` entry above for the same rationale.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  rotate: {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: false },
      // WP3: optional -- see the `notify` entry above for the same rationale.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'stop-owned': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--role': { required: true, repeatable: false },
      '--reason': { required: true, repeatable: false },
      // WP3: optional -- see the `notify` entry above for the same rationale.
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'consult-root': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--intent': { required: true, repeatable: false },
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'mixed-review-request': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--intent': { required: true, repeatable: false },
      '--subject-text-file': { required: true, repeatable: false },
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'consult-root-status': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--intent-id': { required: true, repeatable: false },
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'root-source': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--intent': { required: true, repeatable: false },
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
  'root-source-status': {
    flags: {
      '--project-root': { required: true, repeatable: false },
      '--action': { required: true, repeatable: false },
      '--lifecycle-binding': { required: false, repeatable: false },
    },
  },
});

/**
 * Parses `rawArgv` (argv after the subcommand token) against one `SUBCOMMAND_SPEC`
 * entry. Rejects: a forbidden flag anywhere, an unrecognized flag, a non-repeatable
 * flag supplied more than once, a flag missing its value token, a stray non-flag
 * token, or a missing required flag.
 * @param {string[]} rawArgv
 * @param {{flags:object}} spec - one SUBCOMMAND_SPEC entry.
 * @returns {{ok:true,values:object}|{ok:false}}
 */
function parseSubcommandArgv(rawArgv, spec) {
  const values = {};
  let i = 0;
  while (i < rawArgv.length) {
    const token = rawArgv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) return { ok: false };
    if (FORBIDDEN_FLAGS.includes(token)) return { ok: false };
    const flagSpec = spec.flags[token];
    if (!flagSpec) return { ok: false };
    if (i + 1 >= rawArgv.length) return { ok: false };
    const value = rawArgv[i + 1];
    if (flagSpec.repeatable) {
      if (!values[token]) values[token] = [];
      values[token].push(value);
    } else {
      if (Object.prototype.hasOwnProperty.call(values, token)) return { ok: false };
      values[token] = value;
    }
    i += 2;
  }
  const requiredMissing = Object.keys(spec.flags).some((flag) => {
    const flagSpec = spec.flags[flag];
    if (!flagSpec.required) return false;
    if (flagSpec.repeatable) return !values[flag] || values[flag].length === 0;
    return !Object.prototype.hasOwnProperty.call(values, flag);
  });
  if (requiredMissing) return { ok: false };
  return { ok: true, values };
}

// ── Sixteenth closed lifecycle intents and operation telemetry ────────────────

const RESULT_KIND_RE = /^[A-Z][A-Z0-9_-]{0,63}$/;
const ROOT_CONSULT_INTENT_INPUT_KEYS = Object.freeze([
  'evidence_policy', 'expected_result_kind', 'question', 'requester_role', 'target_role',
].sort());
const ROOT_SOURCE_INTENT_INPUT_KEYS = Object.freeze([
  'expected_result_kind', 'question', 'reporting_architect', 'source_role',
].sort());
const MIXED_REVIEW_INTENT_INPUT_KEYS = Object.freeze([
  'question', 'requester_role', 'reviewed_head', 'target_role',
].sort());

/**
 * P5 U2 live-wiring: decodes+validates a mixed-review-request --intent
 * payload. Mirrors decodeRootConsultIntent's own closed-shape decode
 * pattern; evidence_policy/expected_result_kind are NOT input fields here
 * (both are fixed by handleMixedReviewRequest itself: 'none' and
 * 'P5_MIXED_REVIEW_VERDICT'), and reviewed_head replaces them. The
 * requester!==target check is defense-in-depth here (the authoritative
 * reject lives in s16ResolveMixedReviewPair, checked first there too) --
 * rejecting the self-review shape as early as possible, before any
 * resolution/materialization work, never relying on a single check alone.
 * @param {string} encoded
 * @returns {{ok:true,intent:object}|{ok:false,reason:string}}
 */
function decodeMixedReviewIntent(encoded) {
  const decoded = decodeBase64urlClosedJson(encoded, MIXED_REVIEW_INTENT_INPUT_KEYS);
  if (!decoded.ok) return decoded;
  const i = decoded.intent;
  if (
    !['arch-platform', 'arch-testing', 'arch-integration'].includes(i.requester_role)
    || !CANONICAL_ROLES.includes(i.target_role)
    || i.requester_role === i.target_role
    || typeof i.question !== 'string' || i.question.length === 0 || Buffer.byteLength(i.question, 'utf8') > 8192
    || typeof i.reviewed_head !== 'string' || !/^[0-9a-f]{40}$/.test(i.reviewed_head)
  ) return { ok: false, reason: 'mixed-review-intent-invalid' };
  return decoded;
}

// M7 GREEN section 4.7: cancel_ref/cancel_digest are genuinely separate
// fields from ack_ref/ack_digest -- a CANCELLED operation must never reuse
// the ack pair for its own cancel.json ref/digest.
const OPERATION_KEYS = Object.freeze([
  'accepted_result_digest', 'accepted_result_ref', 'ack_digest', 'ack_ref',
  'cancel_digest', 'cancel_ref', 'kind',
  'operation_id', 'request_digest', 'request_id', 'request_ref', 'result_digest',
  'result_ref', 'state',
].sort());

function decodeBase64urlClosedJson(encoded, expectedKeys) {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return { ok: false, reason: 'intent-encoding-invalid' };
  }
  let bytes;
  let obj;
  try {
    bytes = Buffer.from(encoded, 'base64url');
    if (bytes.length === 0 || bytes.length > 12288 || bytes.toString('base64url') !== encoded) return { ok: false, reason: 'intent-encoding-noncanonical' };
    obj = JSON.parse(bytes.toString('utf8'));
  } catch (err) { return { ok: false, reason: 'intent-json-invalid' }; }
  if (!obj || !hasExactKeys(obj, expectedKeys)) return { ok: false, reason: 'intent-key-set-invalid' };
  return { ok: true, intent: obj };
}

function decodeRootConsultIntent(encoded) {
  const decoded = decodeBase64urlClosedJson(encoded, ROOT_CONSULT_INTENT_INPUT_KEYS);
  if (!decoded.ok) return decoded;
  const i = decoded.intent;
  if (!['arch-platform', 'arch-testing', 'arch-integration'].includes(i.requester_role)
      || !CANONICAL_ROLES.includes(i.target_role)
      || typeof i.question !== 'string' || i.question.length === 0 || Buffer.byteLength(i.question, 'utf8') > 8192
      || !RESULT_KIND_RE.test(i.expected_result_kind)
      || !['none', 'context7-required', 'context7-preferred'].includes(i.evidence_policy)
      || (['context7-required', 'context7-preferred'].includes(i.evidence_policy) && i.target_role !== 'context-provider')
      || (i.target_role === 'context-provider' && !['arch-platform', 'arch-testing', 'arch-integration'].includes(i.requester_role))) {
    return { ok: false, reason: 'root-consult-intent-invalid' };
  }
  return decoded;
}

function decodeRootSourceIntent(encoded) {
  const decoded = decodeBase64urlClosedJson(encoded, ROOT_SOURCE_INTENT_INPUT_KEYS);
  if (!decoded.ok) return decoded;
  const i = decoded.intent;
  if (i.source_role !== 'toolkit-specialist' || i.reporting_architect !== 'arch-platform'
      || typeof i.question !== 'string' || i.question.length === 0 || Buffer.byteLength(i.question, 'utf8') > 8192
      || !RESULT_KIND_RE.test(i.expected_result_kind)) return { ok: false, reason: 'root-source-intent-invalid' };
  return decoded;
}

  return Object.freeze({ SUBCOMMAND_SPEC, parseSubcommandArgv, RESULT_KIND_RE, ROOT_CONSULT_INTENT_INPUT_KEYS, ROOT_SOURCE_INTENT_INPUT_KEYS, MIXED_REVIEW_INTENT_INPUT_KEYS, decodeMixedReviewIntent, OPERATION_KEYS, decodeBase64urlClosedJson, decodeRootConsultIntent, decodeRootSourceIntent });
}

module.exports = { createLifecycleArgv };
