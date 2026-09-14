'use strict';

// WP3 item C2: single canonical RuntimeTurnEnvelope/v1 local schema plus its Codex structured-turn transport projection/unwrap.

function createRuntimeTurnEnvelopeSchema({
  RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS,
  RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES,
  RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES,
  RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES,
  RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN,
  expectedTurnEnvelopeBranchCount,
  hasExactKeys,
  patternGapExecutionAllowed,
  requiredConsultQuestionFor,
  requiredGapLibraryIdFor,
  requiredTurnKind,
  validatePatternGap,
}) {

/**
 * Builds the canonical local RuntimeTurnEnvelope/v1 JSON Schema authority
 * (PLAN.md Fourteenth correction). It is the source from which the Codex
 * transport projection is derived and is independently mirrored by the
 * local response validator below; it is not sent directly as outputSchema.
 * When
 * `allowedChildRoles` is empty (leaf role or exhausted consult budget), the
 * entire consult `oneOf` branch is omitted (~L1018 "for a leaf or exhausted
 * intent budget, omit the entire consult oneOf branch").
 * @param {string} expectedResultKind
 * @param {string[]} allowedChildRoles
 */
function runtimeTurnEnvelopeSchema(expectedResultKind, allowedChildRoles, executionContext) {
  const terminalBranch = {
    type: 'object',
    additionalProperties: false,
    required: ['schema', 'kind', 'result'],
    properties: {
      schema: { enum: ['coordination/runtime-turn-envelope/v1'] },
      kind: { enum: ['terminal-result'] },
      result: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['schema', 'status', 'result_kind', 'content'],
            properties: {
              schema: { enum: ['coordination/result-envelope/v1'] },
              status: { enum: ['ANSWERED'] },
              result_kind: { enum: [expectedResultKind] },
              content: { type: 'string', minLength: 1, maxLength: RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['schema', 'status', 'result_kind', 'reason'],
            properties: {
              schema: { enum: ['coordination/result-envelope/v1'] },
              status: { enum: ['BLOCKED'] },
              result_kind: { enum: ['BLOCKED'] },
              reason: { enum: RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS.slice() },
            },
          },
        ],
      },
    },
  };
  // M6/M7 terminal functional closure, point D: `turnKindLock` (null unless
  // an authorized caller sets it) is the sole host-derived gate over which
  // branches are even constructible -- never a prompt instruction. `null`
  // preserves the exact pre-existing branch set (terminal always available;
  // consult/gap available per allowedChildRoles/patternGapExecutionAllowed).
  const lock = requiredTurnKind(executionContext);
  const branches = [];
  if (lock === null || lock === 'terminal-only') {
    branches.push(terminalBranch);
  }
  if ((lock === null || lock === 'consult-only') && Array.isArray(allowedChildRoles) && allowedChildRoles.length > 0) {
    const requiredQuestion = requiredConsultQuestionFor(executionContext);
    const consultBranch = {
    type: 'object',
    additionalProperties: false,
    required: ['schema', 'kind', 'consult'],
    properties: {
      schema: { enum: ['coordination/runtime-turn-envelope/v1'] },
      kind: { enum: ['consult-intent'] },
      consult: {
        type: 'object',
        additionalProperties: false,
        required: ['target_role', 'question', 'expected_result_kind'],
        properties: {
          target_role: { enum: allowedChildRoles.slice() },
          // Point D(c): under a forced consult, question is pinned via enum
          // to the byte-exact required question (never freeform), so the
          // consulted question can never diverge from what the parent itself
          // received -- including any embedded APPROVED_CONTEXT7_LIBRARY_ID line.
          question: requiredQuestion !== null
            ? { enum: [requiredQuestion] }
            : { type: 'string', minLength: 1, maxLength: RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES },
          expected_result_kind: { type: 'string', pattern: '^[A-Z][A-Z0-9_-]{0,63}$' },
        },
      },
    },
    };
    branches.push(consultBranch);
  }
  if ((lock === null || lock === 'gap-only') && patternGapExecutionAllowed(executionContext)) {
    const requiredLibraryId = requiredGapLibraryIdFor(executionContext);
    branches.push({
      type: 'object',
      additionalProperties: false,
      required: ['schema', 'kind', 'gap'],
      properties: {
        schema: { enum: ['coordination/runtime-turn-envelope/v1'] },
        kind: { enum: ['pattern-gap'] },
        gap: {
          type: 'object',
          additionalProperties: false,
          required: ['provider', 'library_name', 'library_id', 'query'],
          properties: {
            provider: { enum: ['context7'] },
            library_name: { type: 'string', minLength: 1, maxLength: RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES },
            // Point D(e)/E: when an approved library id is already known,
            // library_id is pinned via enum to that exact id (excluding
            // null), so a search-branch gap can never be produced -- a hard
            // zero-search guarantee, not a hopeful prompt hint.
            library_id: requiredLibraryId !== null
              ? { enum: [requiredLibraryId] }
              : {
                anyOf: [
                  { type: 'null' },
                  { type: 'string', pattern: '^\\/[A-Za-z0-9._~-]+\\/[A-Za-z0-9._~-]+(?:\\/[A-Za-z0-9._~-]+)?$' },
                ],
              },
            query: { type: 'string', minLength: 1, maxLength: RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES },
          },
        },
      },
    });
  }
  if (branches.length === 0) throw new Error('runtime-turn-envelope-no-branches-available');
  return { oneOf: branches };
}

/**
 * Builds the Codex Structured Outputs transport projection for the canonical
 * RuntimeTurnEnvelope/v1 schema.  The canonical schema above remains the
 * local authority; this function changes only the two union keywords the
 * pinned Codex backend cannot accept and wraps the candidate under the one
 * exact transport key `envelope`.
 *
 * `purpose === 'bootstrap-ready'` deliberately uses a narrower schema whose
 * accepted set is exactly ANSWERED/role-bootstrap/READY.  It is not derived
 * by widening or post-processing the normal schema.
 *
 * Any unexpected canonical-schema shape throws before a wire write.  That
 * makes canonical drift a fail-closed projection error rather than an excuse
 * to send a relaxed or caller-provided schema.
 *
 * @param {string} expectedResultKind
 * @param {string[]} allowedChildRoles
 * @param {'normal'|'bootstrap-ready'} [purpose]
 * @returns {object}
 */
function codexStructuredRuntimeTurnEnvelopeSchema(expectedResultKind, allowedChildRoles, purpose, executionContext) {
  const selectedPurpose = purpose === undefined ? 'normal' : purpose;
  if (selectedPurpose !== 'normal' && selectedPurpose !== 'bootstrap-ready') {
    throw new Error('codex-turn-envelope-purpose-invalid');
  }
  if (selectedPurpose === 'bootstrap-ready') {
    if (expectedResultKind !== 'role-bootstrap' || !Array.isArray(allowedChildRoles) || allowedChildRoles.length !== 0) {
      throw new Error('codex-bootstrap-schema-scope-invalid');
    }
    return {
      type: 'object',
      additionalProperties: false,
      required: ['envelope'],
      properties: {
        envelope: {
          type: 'object',
          additionalProperties: false,
          required: ['schema', 'kind', 'result'],
          properties: {
            schema: { enum: ['coordination/runtime-turn-envelope/v1'] },
            kind: { enum: ['terminal-result'] },
            result: {
              type: 'object',
              additionalProperties: false,
              required: ['schema', 'status', 'result_kind', 'content'],
              properties: {
                schema: { enum: ['coordination/result-envelope/v1'] },
                status: { enum: ['ANSWERED'] },
                result_kind: { enum: ['role-bootstrap'] },
                content: { enum: ['READY'] },
              },
            },
          },
        },
      },
    };
  }

  const canonical = runtimeTurnEnvelopeSchema(expectedResultKind, allowedChildRoles, executionContext);
  if (!hasExactKeys(canonical, ['oneOf']) || !Array.isArray(canonical.oneOf)) {
    throw new Error('canonical-turn-envelope-root-drift');
  }
  // M6/M7 terminal functional closure, point D: expectedTurnEnvelopeBranchCount
  // is the SAME formula runtimeTurnEnvelopeSchema itself used to decide which
  // branches to build (turnKindLock-aware), so this drift check can never
  // silently diverge from the canonical builder. Branches are looked up by
  // their own `kind` enum value rather than a fixed array position: under a
  // lock, terminal-result may legitimately be ABSENT (position 0 is no
  // longer always the terminal branch).
  const expectedBranchCount = expectedTurnEnvelopeBranchCount(allowedChildRoles, executionContext);
  if (canonical.oneOf.length !== expectedBranchCount || canonical.oneOf.length === 0) {
    throw new Error('canonical-turn-envelope-branch-count-drift');
  }
  const branches = JSON.parse(JSON.stringify(canonical.oneOf));
  const branchKind = (branch) => {
    const kindEnum = branch && branch.properties && branch.properties.kind && branch.properties.kind.enum;
    return Array.isArray(kindEnum) && kindEnum.length === 1 ? kindEnum[0] : null;
  };
  const seenKinds = new Set();
  for (const branch of branches) {
    const kind = branchKind(branch);
    if (kind === null || seenKinds.has(kind)) throw new Error('canonical-turn-envelope-branch-kind-drift');
    seenKinds.add(kind);
    if (kind === 'terminal-result') {
      const resultUnion = branch.properties.result;
      if (
        !resultUnion || !hasExactKeys(resultUnion, ['oneOf'])
        || !Array.isArray(resultUnion.oneOf) || resultUnion.oneOf.length !== 2
      ) {
        throw new Error('canonical-turn-envelope-terminal-union-drift');
      }
      resultUnion.anyOf = resultUnion.oneOf;
      delete resultUnion.oneOf;
    } else if (kind === 'consult-intent') {
      // Sequence 34 (WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822): a
      // Codex Structured Outputs transport limitation, not a canonical-
      // schema or authority change. The pinned Codex backend rejects any
      // JSON Schema enum/const string literal containing a control
      // character (observed live: sequence 33's real mint-8 multiline
      // required question -- invalid_json_schema, "\n is not allowed in
      // string literals for structured outputs (strict=true)"). The
      // canonical local schema/validator above and
      // validateRuntimeTurnEnvelope's own byte-exact
      // consult-question-not-byte-identical-to-required check are both
      // completely unchanged: this only swaps the WIRE shape of an
      // already-pinned question, from the exact enum literal to the
      // existing bounded free-string shape, when (and only when) that
      // exact literal is itself unrepresentable to the backend. A safe
      // single-line required question is left exactly enum-pinned, so
      // this narrows nothing for the common case.
      const consultProps = branch.properties && branch.properties.consult && branch.properties.consult.properties;
      if (
        !consultProps || !hasExactKeys(branch.properties.consult, ['additionalProperties', 'properties', 'required', 'type'])
        || !hasExactKeys(consultProps, ['expected_result_kind', 'question', 'target_role'])
      ) {
        throw new Error('canonical-turn-envelope-consult-branch-drift');
      }
      const questionSchema = consultProps.question;
      if (questionSchema && hasExactKeys(questionSchema, ['enum'])) {
        if (!Array.isArray(questionSchema.enum) || questionSchema.enum.length !== 1 || typeof questionSchema.enum[0] !== 'string') {
          throw new Error('canonical-turn-envelope-consult-question-enum-drift');
        }
        if (/[\r\n]/.test(questionSchema.enum[0])) {
          consultProps.question = { type: 'string', minLength: 1, maxLength: RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES };
        }
      } else if (!questionSchema || !hasExactKeys(questionSchema, ['maxLength', 'minLength', 'type'])) {
        throw new Error('canonical-turn-envelope-consult-question-shape-drift');
      }
    } else if (kind !== 'pattern-gap') {
      throw new Error('canonical-turn-envelope-branch-kind-drift');
    }
  }
  const projected = {
    type: 'object',
    additionalProperties: false,
    required: ['envelope'],
    properties: { envelope: { anyOf: branches } },
  };
  const containsOneOf = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(value, 'oneOf')) return true;
    if (Array.isArray(value)) return value.some(containsOneOf);
    return Object.values(value).some(containsOneOf);
  };
  if (containsOneOf(projected)) throw new Error('codex-turn-envelope-oneof-remains');
  return projected;
}

/**
 * Exact-key unwrap of the Codex transport DTO followed by the unchanged
 * canonical local validator.  No bare-envelope compatibility path,
 * coercion, normalization, or defaulting exists here.
 *
 * @returns {{ok:true,envelope:object}|{ok:false,reason:string}}
 */
function unwrapAndValidateCodexStructuredRuntimeTurnEnvelope(value, expectedResultKind, allowedChildRoles, purpose, executionContext) {
  const selectedPurpose = purpose === undefined ? 'normal' : purpose;
  if (selectedPurpose !== 'normal' && selectedPurpose !== 'bootstrap-ready') {
    return { ok: false, reason: 'transport-purpose-invalid' };
  }
  if (!hasExactKeys(value, ['envelope'])) return { ok: false, reason: 'transport-wrapper-extra-or-missing-key' };
  const candidate = value.envelope;
  const local = validateRuntimeTurnEnvelope(candidate, expectedResultKind, allowedChildRoles, executionContext);
  if (!local.ok) return { ok: false, reason: 'canonical-envelope-invalid:' + local.reason };
  if (
    selectedPurpose === 'bootstrap-ready'
    && (expectedResultKind !== 'role-bootstrap'
      || !Array.isArray(allowedChildRoles) || allowedChildRoles.length !== 0)
  ) {
    return { ok: false, reason: 'bootstrap-ready-scope-invalid' };
  }
  return { ok: true, envelope: candidate };
}

/**
 * Independent local validator for a parsed `RuntimeTurnEnvelope/v1` value
 * (PLAN.md ~L997-1074) -- hand-checks the exact closed shapes (this
 * codebase's established idiom; see `hasExactKeys` precedent in the sibling
 * modules) rather than a generic JSON-Schema evaluator, and applies host
 * UTF-8 byte caps IN ADDITION to the JSON-Schema's own character-length
 * ceilings (PLAN.md ~L932: "JSON Schema character limits are backed by host
 * UTF-8 byte checks"). Host additionally requires `answered result_kind ==
 * request.expected_result_kind` (~L1074) -- enforced here, not deferred to a
 * caller.
 * @param {*} value
 * @param {string} expectedResultKind
 * @param {string[]} allowedChildRoles
 * @returns {{ok:true}|{ok:false,reason:string}}
 */
function validateRuntimeTurnEnvelope(value, expectedResultKind, allowedChildRoles, executionContext) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'not-an-object' };
  if (value.schema !== 'coordination/runtime-turn-envelope/v1') return { ok: false, reason: 'wrong-envelope-schema' };
  // Point D: turnKindLock is re-checked here too (not only inside the
  // Codex-facing schema) so a LOCALLY constructed envelope (never routed
  // through the Codex structured-output projection) is held to the exact
  // same host-derived turn-kind authority.
  const lock = requiredTurnKind(executionContext);
  if (value.kind === 'terminal-result') {
    if (lock === 'consult-only' || lock === 'gap-only') return { ok: false, reason: 'terminal-result-forbidden-by-turn-kind-lock' };
    if (!hasExactKeys(value, ['kind', 'result', 'schema'])) return { ok: false, reason: 'terminal-envelope-extra-or-missing-key' };
    const r = value.result;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, reason: 'result-not-an-object' };
    if (r.schema !== 'coordination/result-envelope/v1') return { ok: false, reason: 'wrong-result-schema' };
    if (r.status === 'ANSWERED') {
      if (!hasExactKeys(r, ['content', 'result_kind', 'schema', 'status'])) return { ok: false, reason: 'answered-extra-or-missing-key' };
      if (r.result_kind !== expectedResultKind) return { ok: false, reason: 'answered-result-kind-mismatch' };
      if (typeof r.content !== 'string' || r.content.length === 0) return { ok: false, reason: 'answered-content-empty' };
      if (Buffer.byteLength(r.content, 'utf8') > RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES) return { ok: false, reason: 'answered-content-too-large' };
      return { ok: true };
    }
    if (r.status === 'BLOCKED') {
      if (!hasExactKeys(r, ['reason', 'result_kind', 'schema', 'status'])) return { ok: false, reason: 'blocked-extra-or-missing-key' };
      if (r.result_kind !== 'BLOCKED') return { ok: false, reason: 'blocked-result-kind-not-blocked' };
      if (!RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS.includes(r.reason)) return { ok: false, reason: 'blocked-reason-not-enum' };
      return { ok: true };
    }
    return { ok: false, reason: 'result-status-not-answered-or-blocked' };
  }
  if (value.kind === 'consult-intent') {
    if (lock === 'gap-only' || lock === 'terminal-only') return { ok: false, reason: 'consult-intent-forbidden-by-turn-kind-lock' };
    if (!Array.isArray(allowedChildRoles) || allowedChildRoles.length === 0) return { ok: false, reason: 'consult-intent-forbidden-leaf-or-exhausted-budget' };
    if (!hasExactKeys(value, ['consult', 'kind', 'schema'])) return { ok: false, reason: 'consult-envelope-extra-or-missing-key' };
    const c = value.consult;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, reason: 'consult-not-an-object' };
    if (!hasExactKeys(c, ['expected_result_kind', 'question', 'target_role'])) return { ok: false, reason: 'consult-extra-or-missing-key' };
    if (!allowedChildRoles.includes(c.target_role)) return { ok: false, reason: 'consult-target-role-not-allowed' };
    if (typeof c.question !== 'string' || c.question.length === 0 || Buffer.byteLength(c.question, 'utf8') > RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES) return { ok: false, reason: 'consult-question-invalid' };
    const requiredQuestion = requiredConsultQuestionFor(executionContext);
    if (requiredQuestion !== null && c.question !== requiredQuestion) return { ok: false, reason: 'consult-question-not-byte-identical-to-required' };
    if (typeof c.expected_result_kind !== 'string' || !RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN.test(c.expected_result_kind)) return { ok: false, reason: 'consult-expected-result-kind-invalid' };
    return { ok: true };
  }
  if (value.kind === 'pattern-gap') {
    if (lock === 'consult-only' || lock === 'terminal-only') return { ok: false, reason: 'pattern-gap-forbidden-by-turn-kind-lock' };
    if (!patternGapExecutionAllowed(executionContext)) {
      return { ok: false, reason: 'pattern-gap-forbidden-for-execution-context' };
    }
    if (!hasExactKeys(value, ['gap', 'kind', 'schema'])) return { ok: false, reason: 'pattern-gap-envelope-extra-or-missing-key' };
    const gapResult = validatePatternGap(value.gap);
    if (!gapResult.ok) return gapResult;
    const requiredLibraryId = requiredGapLibraryIdFor(executionContext);
    if (requiredLibraryId !== null && value.gap.library_id !== requiredLibraryId) {
      return { ok: false, reason: 'pattern-gap-library-id-not-approved' };
    }
    return { ok: true };
  }
  return { ok: false, reason: 'unknown-envelope-kind' };
}

  return Object.freeze({
    codexStructuredRuntimeTurnEnvelopeSchema,
    runtimeTurnEnvelopeSchema,
    unwrapAndValidateCodexStructuredRuntimeTurnEnvelope,
    validateRuntimeTurnEnvelope,
  });
}

module.exports = { createRuntimeTurnEnvelopeSchema };
