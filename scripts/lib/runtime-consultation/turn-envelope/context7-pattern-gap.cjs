'use strict';

// Context7 directive parsing and pattern-gap turn-kind/branch-count requirement derivation.

function createContext7PatternGap({
  CliError,
}) {
// ─────────────────────────────────────────────────────────────────────────────
// WP3 item C2 (R7 stabilization): RuntimeTurnEnvelope/v1 -- single canonical
// source (PLAN.md ~L932: "runtimeTurnEnvelopeSchema(...) in
// runtime-consultation.cjs remains the single canonical local schema used by
// the local validator. Codex turn/start receives only the mechanically
// derived transport projection defined below; the canonical object is never
// sent directly because the pinned backend rejects its root `oneOf`.
// Previously kept local to
// runtime-bridge-codex.cjs as a deliberate, disclosed scope-boundary decision
// (that file's own C2 history/evidence record); hoisted here per PLAN's own
// literal naming -- runtime-bridge-codex.cjs now imports this surface under
// its existing public export name instead of maintaining a second copy.
// ─────────────────────────────────────────────────────────────────────────────

const RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS = Object.freeze([
  'CONTENT_TOO_LARGE', 'INSUFFICIENT_CONTEXT', 'UNSUPPORTED_REQUEST', 'CONSULTATION_FAILED', 'POLICY_DENIED',
]);
const RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/;
const RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES = 65536;
const RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES = 8192;
const RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES = 256;
const CONTEXT7_LIBRARY_ID_RE = /^\/[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)?$/;

function isCanonicalContext7LibraryId(value) {
  return typeof value === 'string' && value.length <= 512 && CONTEXT7_LIBRARY_ID_RE.test(value);
}

const APPROVED_CONTEXT7_DIRECTIVE_MARKER = 'APPROVED_CONTEXT7_LIBRARY_ID';
const APPROVED_CONTEXT7_DIRECTIVE_LINE_RE = /^APPROVED_CONTEXT7_LIBRARY_ID: (.+)$/;

/**
 * M6/M7 terminal functional closure, point A: the single request-scoped
 * Context7 evidence decision for a root-source root. The exact line
 * `APPROVED_CONTEXT7_LIBRARY_ID: /owner/repo[/version]` contained in a
 * request's own `question` bytes IS the decision -- bound to that request's
 * own digest, never a new schema field/CLI flag/routing mapping/durable
 * record. Absence of the marker anywhere in the text means no directive
 * (caller policy: none). Any other shape referencing the marker --
 * duplicated, or present but not exactly the canonical single line -- fails
 * closed (thrown), never silently downgraded to "no directive".
 * @param {string} questionText
 * @returns {{present:false,libraryId:null}|{present:true,libraryId:string}}
 */
function parseApprovedContext7Directive(questionText) {
  if (typeof questionText !== 'string') {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'directive question text is invalid');
  }
  const candidateLines = questionText.split('\n').filter((line) => line.includes(APPROVED_CONTEXT7_DIRECTIVE_MARKER));
  if (candidateLines.length === 0) return { present: false, libraryId: null };
  if (candidateLines.length > 1) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'APPROVED_CONTEXT7_LIBRARY_ID directive is duplicated');
  }
  const match = APPROVED_CONTEXT7_DIRECTIVE_LINE_RE.exec(candidateLines[0]);
  if (!match || !isCanonicalContext7LibraryId(match[1])) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'APPROVED_CONTEXT7_LIBRARY_ID directive is malformed or not canonical');
  }
  return { present: true, libraryId: match[1] };
}

const PREFERRED_CONTEXT7_DIRECTIVE_MARKER = 'PREFERRED_CONTEXT7_LIBRARY_ID';
const PREFERRED_CONTEXT7_DIRECTIVE_LINE_RE = /^PREFERRED_CONTEXT7_LIBRARY_ID: (.+)$/;

/**
 * WAVE1-FUNCTIONAL-CLOSEOUT-REALISTIC-20260822: the `context7-preferred`
 * counterpart to parseApprovedContext7Directive above -- identical grammar
 * and identical fail-closed-on-duplicate/malformed rules, distinguished only
 * by its own marker so a request's question can never be ambiguous between
 * "required" and "preferred" evidence authority (resolveRootEvidenceAuthority
 * rejects a question carrying both).
 * @param {string} questionText
 * @returns {{present:false,libraryId:null}|{present:true,libraryId:string}}
 */
function parsePreferredContext7Directive(questionText) {
  if (typeof questionText !== 'string') {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'directive question text is invalid');
  }
  const candidateLines = questionText.split('\n').filter((line) => line.includes(PREFERRED_CONTEXT7_DIRECTIVE_MARKER));
  if (candidateLines.length === 0) return { present: false, libraryId: null };
  if (candidateLines.length > 1) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'PREFERRED_CONTEXT7_LIBRARY_ID directive is duplicated');
  }
  const match = PREFERRED_CONTEXT7_DIRECTIVE_LINE_RE.exec(candidateLines[0]);
  if (!match || !isCanonicalContext7LibraryId(match[1])) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'PREFERRED_CONTEXT7_LIBRARY_ID directive is malformed or not canonical');
  }
  return { present: true, libraryId: match[1] };
}

function patternGapExecutionAllowed(executionContext) {
  return !!(
    executionContext && typeof executionContext === 'object' && !Array.isArray(executionContext)
    && executionContext.executingRole === 'context-provider'
    && executionContext.patternGapAllowed === true
  );
}

const TURN_KIND_LOCK_ENUM = Object.freeze(['consult-only', 'gap-only', 'terminal-only']);

/**
 * M6/M7 terminal functional closure, point D: deterministic turn-kind
 * control. `executionContext.turnKindLock`, when one of the closed enum
 * values below, is the SOLE host-derived authority over which
 * RuntimeTurnEnvelope `kind` branch a turn may produce -- never a prompt
 * instruction. `null`/absent preserves the pre-existing unrestricted
 * behavior (terminal always available; consult/gap available per
 * allowedChildRoles/patternGapExecutionAllowed exactly as before).
 */
function requiredTurnKind(executionContext) {
  if (!executionContext || typeof executionContext !== 'object' || Array.isArray(executionContext)) return null;
  const lock = executionContext.turnKindLock;
  return TURN_KIND_LOCK_ENUM.includes(lock) ? lock : null;
}

/** Point D: byte-exact consult.question the reporting architect's forced consult-intent must carry. */
function requiredConsultQuestionFor(executionContext) {
  if (!executionContext || typeof executionContext !== 'object' || Array.isArray(executionContext)) return null;
  const value = executionContext.requiredConsultQuestion;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Point D/E: exact approved Context7 library_id the context-provider's forced pattern-gap must carry. */
function requiredGapLibraryIdFor(executionContext) {
  if (!executionContext || typeof executionContext !== 'object' || Array.isArray(executionContext)) return null;
  const value = executionContext.requiredGapLibraryId;
  return isCanonicalContext7LibraryId(value) ? value : null;
}

/**
 * Single source of truth for how many `oneOf` branches
 * runtimeTurnEnvelopeSchema builds for a given (allowedChildRoles,
 * executionContext) pair -- reused unchanged as the Codex-projection drift
 * detector in codexStructuredRuntimeTurnEnvelopeSchema so the two functions
 * can never silently disagree.
 */
function expectedTurnEnvelopeBranchCount(allowedChildRoles, executionContext) {
  const lock = requiredTurnKind(executionContext);
  let count = 0;
  if (lock === null || lock === 'terminal-only') count += 1;
  if ((lock === null || lock === 'consult-only') && Array.isArray(allowedChildRoles) && allowedChildRoles.length > 0) count += 1;
  if ((lock === null || lock === 'gap-only') && patternGapExecutionAllowed(executionContext)) count += 1;
  return count;
}

function validatePatternGap(gap) {
  if (!hasExactKeys(gap, ['library_id', 'library_name', 'provider', 'query'])) {
    return { ok: false, reason: 'pattern-gap-extra-or-missing-key' };
  }
  if (gap.provider !== 'context7') return { ok: false, reason: 'pattern-gap-provider-invalid' };
  if (
    typeof gap.library_name !== 'string' || gap.library_name.length === 0
    || Buffer.byteLength(gap.library_name, 'utf8') > RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES
  ) return { ok: false, reason: 'pattern-gap-library-name-invalid' };
  if (gap.library_id !== null && !isCanonicalContext7LibraryId(gap.library_id)) {
    return { ok: false, reason: 'pattern-gap-library-id-invalid' };
  }
  if (
    typeof gap.query !== 'string' || gap.query.length === 0
    || Buffer.byteLength(gap.query, 'utf8') > RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES
  ) return { ok: false, reason: 'pattern-gap-query-invalid' };
  return { ok: true };
}

// Local, logic-identical copy of runtime-role-lifecycle.cjs's own
// `hasExactKeys` -- deliberately NOT imported from there: that module itself
// `require()`s this one (rll -> rc), so an rc -> rll import would be a
// circular require. This is a tiny, generic array-comparison utility, not
// business logic, so a small duplication here is safer than a cycle.
function hasExactKeys(obj, sortedExpectedKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const actual = Object.keys(obj).sort();
  if (actual.length !== sortedExpectedKeys.length) return false;
  return actual.every((k, i) => k === sortedExpectedKeys[i]);
}

  return Object.freeze({
    APPROVED_CONTEXT7_DIRECTIVE_LINE_RE,
    APPROVED_CONTEXT7_DIRECTIVE_MARKER,
    CONTEXT7_LIBRARY_ID_RE,
    PREFERRED_CONTEXT7_DIRECTIVE_LINE_RE,
    PREFERRED_CONTEXT7_DIRECTIVE_MARKER,
    RUNTIME_TURN_ENVELOPE_BLOCKED_REASONS,
    RUNTIME_TURN_ENVELOPE_MAX_CONTENT_BYTES,
    RUNTIME_TURN_ENVELOPE_MAX_LIBRARY_NAME_BYTES,
    RUNTIME_TURN_ENVELOPE_MAX_QUESTION_BYTES,
    RUNTIME_TURN_ENVELOPE_RESULT_KIND_PATTERN,
    TURN_KIND_LOCK_ENUM,
    expectedTurnEnvelopeBranchCount,
    hasExactKeys,
    isCanonicalContext7LibraryId,
    parseApprovedContext7Directive,
    parsePreferredContext7Directive,
    patternGapExecutionAllowed,
    requiredConsultQuestionFor,
    requiredGapLibraryIdFor,
    requiredTurnKind,
    validatePatternGap,
  });
}

module.exports = { createContext7PatternGap };
