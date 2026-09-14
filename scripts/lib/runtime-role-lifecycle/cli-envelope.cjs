'use strict';

// Extracted behaviorally from runtime-role-lifecycle.cjs: the frozen
// `coordination/lifecycle-cli-result/v1` envelope primitives (PLAN.md ~L152)
// -- schema/status/detail/rc enums, the envelope builder/emitter, the four
// named error emitters, and the hex-shape validators the CLI boundary uses
// throughout. Never requires the facade or a sibling module.

function createCliEnvelope({}) {
// ── Closed enums (coordination/lifecycle-cli-result/v1, PLAN.md ~L152) ─────────
const STATUS_ENUM = Object.freeze([
  'READY',
  'BLOCKED',
  'EPHEMERAL_AVAILABLE',
  'ACTION_REQUIRED',
  'WAITING',
  'UNAVAILABLE',
  'STOPPED',
  'INVALID',
]);

const DETAIL_ENUM = Object.freeze([
  'NONE',
  'CAPABILITY_UNAVAILABLE',
  'NATIVE_TOOL_ERROR',
  'ACTION_EXPIRED',
  'ACTION_REPLAY',
  'IDENTITY_MISMATCH',
  'AMBIGUOUS_OWNER',
  'READY_TIMEOUT',
  'POLICY_INVALID',
  'DURABILITY_UNPROVEN',
  'INTERNAL_ERROR',
]);

const RC = Object.freeze({
  OK: 0,
  USAGE: 2,
  INVALID: 3,
  UNAVAILABLE: 4,
  WAIT_TIMEOUT: 5,
  INTERNAL: 7,
});

const HEX_ACTION_RE = /^[0-9a-f]{32,}$/;
// R4 round 3 (block 2d): a SEPARATE, exact-64 contract for genuine SHA-256
// digest fields (worktree_id, plan_digest, coordination_root_id -- all
// `sha256String(...)`-derived, per PLAN.md ~L289 and computeWorktreeId/
// discoverPlan) -- these were previously validated via the SAME
// `isHexActionId` ("32 or more") the frozen `--action <32+-hex>` argv
// contract (PLAN.md ~L143-145) requires for generated/action ids, silently
// tolerating any wrong-length garbage 32+ hex chars long as long as it was
// hex-shaped. `isHexActionId` itself is intentionally left UNCHANGED --
// narrowing it to exactly 32 would violate the FROZEN argv contract, which
// deliberately admits "32 or more" at the CLI boundary. Digests were never
// part of that argv contract at all, so tightening THEM to exactly 64 is
// unconstrained by it.
const HEX_DIGEST_64_RE = /^[0-9a-f]{64}$/;

function isHexDigest64(value) {
  return typeof value === 'string' && HEX_DIGEST_64_RE.test(value);
}

// R4 round 3 (round 4 correction): a THIRD, exact-32 contract for genuine
// CSPRNG-minted identity fields (binding_id, actor_instance_id,
// session_generation_id, grant_id -- all `crypto.randomBytes(16).toString
// ('hex')`, 128 bits, per resolveSessionGeneration/createMainOrchestrator
// Binding/createRoleActorBinding/mintLifecycleCommandGrant). These are
// INTERNAL registry fields, never directly caller-argv-supplied (unlike
// `--action <32+-hex>`, PLAN.md ~L143-145), so tightening them to exactly
// 32 is unconstrained by the frozen argv contract -- distinct from BOTH
// `isHexActionId` (32-or-more, argv-facing, intentionally unchanged) and
// `isHexDigest64` (exactly 64, sha256 digests). An action-id-shaped field
// (pending_action_id, team_ensure_action_id, grant.action_id) stays on
// `isHexActionId` even though `generateActionId()` also mints exactly 32 --
// those fields are eventually compared against a caller-supplied
// `--action` value and must stay consistent with ITS looser contract.
const HEX_CSPRNG_32_RE = /^[0-9a-f]{32}$/;

function isHexCsprng32(value) {
  return typeof value === 'string' && HEX_CSPRNG_32_RE.test(value);
}

/**
 * Builds one recursively closed `coordination/lifecycle-cli-result/v1` object in the
 * exact key order `{schema,command,ok,status,code,detail_code,bindings,actions}`.
 * @param {string} command - the recognized subcommand name, or '' if unrecognized/absent.
 * @param {number} code - process exit code (0|2|3|4|5|7).
 * @param {string} status - one of STATUS_ENUM.
 * @param {string} detailCode - one of DETAIL_ENUM.
 * @param {Array<object>} [bindings] - always [] in this WP1 skeleton.
 * @param {Array<object>} [actions] - always [] in this WP1 skeleton.
 * @returns {object} the closed envelope object.
 */
function makeResult(command, code, status, detailCode, bindings, actions, operation) {
  return {
    schema: 'coordination/lifecycle-cli-result/v1',
    command: command || '',
    ok: code === 0,
    status,
    code,
    detail_code: detailCode,
    bindings: bindings || [],
    actions: actions || [],
    operation: operation === undefined ? null : operation,
  };
}

/**
 * Prints the closed envelope as exactly one JSON line on stdout and exits with the
 * matching process code. Never throws; this is the single exit path for every
 * subcommand so stdout is always valid JSON even on internal failure.
 * @param {object} result - a makeResult()-shaped envelope.
 * @returns {never}
 */
function emitAndExit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.code);
}

/**
 * Emits a usage-error envelope (rc2) and exits. `status`/`detail_code` are not
 * pinned by the frozen contract for usage errors (only `code===2`/`ok===false` are
 * certain -- see runtime-role-lifecycle.bats's own documented interpretive decision),
 * so this helper picks the closed-enum member that best communicates "bad input".
 * @param {string} command - recognized subcommand name, or ''.
 * @returns {never}
 */
function usageError(command) {
  emitAndExit(makeResult(command, RC.USAGE, 'INVALID', 'NONE', [], []));
}

/**
 * Emits a semantic-invalid envelope (rc3) and exits.
 * @param {string} command - recognized subcommand name.
 * @param {string} [detailCode] - defaults to 'NONE'.
 * @returns {never}
 */
function invalidError(command, detailCode) {
  emitAndExit(makeResult(command, RC.INVALID, 'INVALID', detailCode || 'NONE', [], []));
}

/**
 * Writes why a retained requester/target pair could not be resolved to stderr, then leaves the
 * caller to emit its ordinary closed envelope. The envelope's schema is frozen and its detail_code
 * vocabulary is closed, so the specific reason has nowhere to live inside it -- and without it a
 * live rejection reports only CAPABILITY_UNAVAILABLE, which is true of a self-review, a requester
 * that is not Claude-native, an invalid target topology, an unavailable bridge or resolver, an
 * unavailable retained worker and an owner mismatch alike. stderr is not part of the ABI: stdout
 * stays byte-identical, and the operator gets the one fact that distinguishes seven fixes.
 * @param {string} command
 * @param {{reason?:string}} pair
 * @returns {void}
 */
function reportRetainedPairRejection(command, pair) {
  const reason = pair && typeof pair.reason === 'string' && pair.reason.length > 0
    ? pair.reason
    : 'no-reason-reported';
  try {
    process.stderr.write('[' + command + '] retained pair unresolved: ' + reason + '\n');
  } catch (err) { /* diagnostics must never change an outcome */ }
}

/**
 * Emits an unavailable envelope (rc4) and exits.
 * @param {string} command - recognized subcommand name.
 * @param {string} [detailCode] - defaults to 'CAPABILITY_UNAVAILABLE'.
 * @returns {never}
 */
function unavailableError(command, detailCode) {
  emitAndExit(makeResult(command, RC.UNAVAILABLE, 'UNAVAILABLE', detailCode || 'CAPABILITY_UNAVAILABLE', [], []));
}

/**
 * True if `value` is a well-formed lowercase 32+-character hex action id
 * (Frozen CLI ABI `--action <32+-hex>`, PLAN.md ~L143-145).
 * @param {string} value
 * @returns {boolean}
 */
function isHexActionId(value) {
  return typeof value === 'string' && HEX_ACTION_RE.test(value);
}

/**
 * True if `value` parses as a base-10 integer string within [min,max] inclusive,
 * with no extra characters (no leading '+', whitespace, decimal point, etc.).
 * @param {string} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
function isIntInRange(value, min, max) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

  return Object.freeze({
    STATUS_ENUM, DETAIL_ENUM, RC, makeResult, emitAndExit, usageError, invalidError,
    reportRetainedPairRejection, unavailableError, isHexDigest64, isHexCsprng32, isHexActionId,
    isIntInRange,
  });
}

module.exports = { createCliEnvelope };
