'use strict';

// Generic runtime-consultation primitives. This leaf module depends only on
// Node built-ins and never imports either higher-level runtime facade.

const crypto = require('crypto');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// Frozen enums (PLAN.md ~L779-781)
// ─────────────────────────────────────────────────────────────────────────────

const CLI_RESULT_SCHEMA = 'coordination/cli-result/v1';

const RC_FOR_STATUS = Object.freeze({
  SUCCESS: 0,
  USAGE_ERROR: 2,
  INVALID: 3,
  UNAVAILABLE: 4,
  TIMEOUT: 5,
  BLOCKED: 6,
  CANCELLED: 6,
  CONFLICT: 6,
  INTERNAL: 7,
});

const DETAIL_CODES = new Set([
  'NONE', 'UNKNOWN_COMMAND', 'MISSING_ARGUMENT', 'DUPLICATE_ARGUMENT',
  'INVALID_ARGUMENT', 'SCHEMA_INVALID', 'CORRELATION_INVALID', 'AUTHORITY_INVALID',
  'SECURITY_INVALID', 'DRIVER_UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESULT_BLOCKED',
  'TRANSACTION_CANCELLED', 'RESULT_CONFLICT', 'DURABILITY_UNPROVEN', 'INTERNAL_ERROR',
  // M67 await-result liveness awareness: a dead/unclaimed worker or an expired
  // request must be reported promptly (see assessAwaitResultLiveness), never
  // laundered as a generic DEADLINE_EXCEEDED after the full --timeout elapses.
  'WORKER_LEASE_EXPIRED', 'WORKER_LEASE_MISSING', 'WORKER_NOT_CLAIMED', 'REQUEST_EXPIRED',
]);

/**
 * Closed activation-driver enum (PLAN.md ~L330, cross-referenced against the
 * Activation Drivers table ~L841-848 and record-delivery's own driver argv,
 * ~L763). Shared by `activation/v1` validation, `dispatch`'s driver selection,
 * and `record-delivery`'s compatibility-table enforcement -- ONE literal list,
 * not three independently-typed copies.
 */
const DRIVER_ENUM = Object.freeze([
  'claude-sendmessage', 'claude-agent', 'codex-app-server', 'codex-mcp', 'runtime-spawn', 'noop',
]);

/**
 * Structured CLI-level error. Every command handler throws this to signal a
 * non-SUCCESS terminal outcome; the top-level dispatcher converts it into the
 * frozen `coordination/cli-result/v1` envelope.
 */
class CliError extends Error {
  constructor(status, detailCode, message, extra) {
    super(message || detailCode || status);
    this.status = status;
    this.detailCode = DETAIL_CODES.has(detailCode) ? detailCode : 'INTERNAL_ERROR';
    this.extra = extra || {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic byte-precise helpers (Identity & Digests, PLAN.md ~L642-653)
// ─────────────────────────────────────────────────────────────────────────────

/** Byte-exact canonical JSON: sorted object keys, `,`/`:` separators, no incidental whitespace. */
function canonicalJSONStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key]);
    return out;
  }
  return value;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256String(str) {
  return sha256Buffer(Buffer.from(str, 'utf8'));
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

/**
 * Fixed-ids test-mode state (WP2 fake-clock/fixed-ids seam). `FIXED_IDS_ACTIVE`
 * is set once per process in main(), immediately after parseFlags succeeds.
 * `fixedIdCounter` is a fresh per-process monotonic counter -- Node processes
 * share no memory, so a separate CLI invocation always starts back at 0.
 */
let FIXED_IDS_ACTIVE = false;
let fixedIdCounter = 0;

/**
 * Core-generated identifier: >=128 bits via crypto.randomBytes, lowercase hex.
 * Under the active fixed-ids test mode, returns a deterministic 32-char
 * zero-padded hex counter instead -- schema-compatible with the existing
 * HEX_ID_RE/isHexId UNCHANGED (Option Y: a hex-conformant fixed id, adopted
 * over a non-hex `fixed-id-NNNN` shape + isHexId/assertHexId relaxation,
 * because the relaxation would create a cross-process isHexId-coherence
 * hazard in readTakeoverIfValid -- see
 * .planning/wave-portable-runtime-messaging-adapters/arch-testing-fixed-seam-cross-verify.md
 * Finding C). `opts.raw === true` ALWAYS uses real crypto randomness
 * regardless of fixed-ids mode -- reserved for publishNoClobber's/
 * publishReplace's own internal temp-file-name nonces, which must never
 * consume or be visible in the deterministic schema-id counter sequence.
 */
function genId(opts) {
  const raw = Boolean(opts && opts.raw);
  if (!raw && FIXED_IDS_ACTIVE) {
    const hex = fixedIdCounter.toString(16).padStart(32, '0');
    fixedIdCounter += 1;
    return hex;
  }
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Core-generated 128-bit identifier (32 lowercase-hex chars). Record #12's
 * `stop_id` is explicitly 128-bit (PLAN.md ~L511), distinct from the 256-bit
 * ids `genId()` produces for request/attempt/instance identifiers elsewhere.
 */
function genId128() {
  return crypto.randomBytes(16).toString('hex');
}

const FIXED_CLOCK_DEFAULT_BASE_ISO = '2025-01-01T00:00:00.000Z';

let FIXED_CLOCK_ACTIVE = false;
let FIXED_CLOCK_BASE_MS = null;
let FIXED_CLOCK_ADVANCE_MS = 0;

/**
 * Resolves the fixed-clock activation state ONCE per process, in main(),
 * immediately after parseFlags succeeds -- mirrors FIXED_IDS_ACTIVE's
 * activation point exactly. RUNTIME_CONSULTATION_FAKE_CLOCK/
 * RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS are consulted ONLY when
 * --fixed-clock is ALSO active for this invocation -- they refine/override
 * WITHIN fixed-clock mode, they do not independently activate it.
 */
function resolveFixedClockState(flags) {
  FIXED_CLOCK_ACTIVE = isTestCapability() && Boolean(flags['fixed-clock']);
  if (!FIXED_CLOCK_ACTIVE) return;
  const overrideEnv = process.env.RUNTIME_CONSULTATION_FAKE_CLOCK;
  const baseIso = (typeof overrideEnv === 'string' && overrideEnv.length > 0) ? overrideEnv : FIXED_CLOCK_DEFAULT_BASE_ISO;
  FIXED_CLOCK_BASE_MS = isoToMs(baseIso);
  const advanceEnv = process.env.RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS;
  let advance = (typeof advanceEnv === 'string' && advanceEnv.length > 0) ? Number.parseInt(advanceEnv, 10) : 0;
  if (!Number.isFinite(advance) || advance < 0) advance = 0;
  FIXED_CLOCK_ADVANCE_MS = advance;
}

/**
 * Single gated clock-read source of truth -- used by BOTH nowIso() (schema
 * timestamp minting) and cmdAwaitResult's deadline arithmetic (W06). This is
 * the ONE place a wall-clock value is read for schema/deadline purposes in
 * the entire file (acquireLock's Date.now() is a deliberate exception -- W11
 * multiprocess mutex, always real regardless of test/production).
 */
function currentClockMs() {
  return FIXED_CLOCK_ACTIVE ? (FIXED_CLOCK_BASE_MS + FIXED_CLOCK_ADVANCE_MS) : Date.now();
}

/** ISO-8601 UTC with a trailing 'Z' and no sub-second component. */
function nowIso() {
  return new Date(currentClockMs()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoPlusSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isoToMs(iso) {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid ISO-8601 timestamp: ' + iso);
  return ms;
}

/**
 * The one harness-created test capability gate (PLAN.md ~L752-753, ~L796). `--fixed-ids`,
 * `--fixed-clock`, and any closed test-only fixture flag are legal ONLY when both
 * `NODE_ENV=test` and a non-empty `RUNTIME_CONSULTATION_TEST_CAPABILITY` are present.
 * The exact capability VALUE is harness-owned/opaque to this core -- only presence
 * plus the NODE_ENV=test gate are checked (no pre-shared secret is specified by the
 * frozen PLAN ranges this file was built against).
 */
function isTestCapability() {
  return (
    process.env.NODE_ENV === 'test'
    && typeof process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY === 'string'
    && process.env.RUNTIME_CONSULTATION_TEST_CAPABILITY.length > 0
  );
}

function decodeBase64Url(str) {
  try {
    return Buffer.from(str, 'base64url');
  } catch (err) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'malformed base64url: ' + err.message);
  }
}

function encodeBase64Url(buf) {
  return Buffer.from(buf).toString('base64url');
}

// ─────────────────────────────────────────────────────────────────────────────
// Narrow accessors for the process-scoped CLI test state above. A production
// CLI invocation is one process; keeping this deterministic seam process-local
// prevents state from leaking across invocations. These accessors are consumed
// only by facade internals and do not expand the facade's public ABI.
// ─────────────────────────────────────────────────────────────────────────────

/** Activates fixed identifiers after argv and the private test capability validate. */
function activateFixedIds(flags) {
  FIXED_IDS_ACTIVE = isTestCapability() && Boolean(flags['fixed-ids']);
}

function isFixedIdsActive() {
  return FIXED_IDS_ACTIVE;
}

function isFixedClockActive() {
  return FIXED_CLOCK_ACTIVE;
}

function getFixedClockBaseMs() {
  return FIXED_CLOCK_BASE_MS;
}

module.exports = {
  CLI_RESULT_SCHEMA, RC_FOR_STATUS, DRIVER_ENUM, CliError,
  canonicalJSONStringify, sortKeysDeep, sha256Buffer, sha256String, sha256File,
  genId, genId128,
  resolveFixedClockState, currentClockMs, nowIso, isoPlusSeconds, isoToMs,
  isTestCapability, decodeBase64Url, encodeBase64Url,
  activateFixedIds, isFixedIdsActive, isFixedClockActive, getFixedClockBaseMs,
};
