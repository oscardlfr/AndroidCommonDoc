#!/usr/bin/env node
'use strict';

/**
 * Portable runtime-consultation core (Wave 1 -- portable-runtime-messaging-adapters, WP1).
 *
 * Frozen Production CLI ABI: `node runtime-consultation.cjs <subcommand> --flag value ...`.
 * Every subcommand prints exactly one `coordination/cli-result/v1` JSON object on stdout
 * plus a trailing newline, and exits with the frozen rc/status mapping. See PLAN.md
 * "Frozen Production CLI ABI" (~L750-796) for the complete contract this file implements.
 *
 * WP1 scope (this file, this pass): protocol/schema validation (`validate --kind ...`),
 * the atomic no-clobber publish primitive + transition lock, and the transaction state
 * machine (`claim`, `lease-heartbeat`, `takeover`, `accept-result`, `transaction-ack`,
 * `cancel`, `cleanup`, `await-result`, `publish-request`, `root-init`). Full driver
 * dispatch/bridge wiring is later WP2/WP3 work.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────────
// Frozen enums (PLAN.md ~L779-781)
// ─────────────────────────────────────────────────────────────────────────────

const CLI_RESULT_SCHEMA = 'coordination/cli-result/v1';

const RC_FOR_STATUS = {
  SUCCESS: 0,
  USAGE_ERROR: 2,
  INVALID: 3,
  UNAVAILABLE: 4,
  TIMEOUT: 5,
  BLOCKED: 6,
  CANCELLED: 6,
  CONFLICT: 6,
  INTERNAL: 7,
};

const DETAIL_CODES = new Set([
  'NONE', 'UNKNOWN_COMMAND', 'MISSING_ARGUMENT', 'DUPLICATE_ARGUMENT',
  'INVALID_ARGUMENT', 'SCHEMA_INVALID', 'CORRELATION_INVALID', 'AUTHORITY_INVALID',
  'SECURITY_INVALID', 'DRIVER_UNAVAILABLE', 'DEADLINE_EXCEEDED', 'RESULT_BLOCKED',
  'TRANSACTION_CANCELLED', 'RESULT_CONFLICT', 'DURABILITY_UNPROVEN', 'INTERNAL_ERROR',
]);

/**
 * Closed activation-driver enum (PLAN.md ~L330, cross-referenced against the
 * Activation Drivers table ~L841-848 and record-delivery's own driver argv,
 * ~L763). Shared by `activation/v1` validation, `dispatch`'s driver selection,
 * and `record-delivery`'s compatibility-table enforcement -- ONE literal list,
 * not three independently-typed copies.
 */
const DRIVER_ENUM = [
  'claude-sendmessage', 'claude-agent', 'codex-app-server', 'codex-mcp', 'runtime-spawn', 'noop',
];

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
// argv parsing (Frozen CLI ABI: long options only, order-independent, each once)
// ─────────────────────────────────────────────────────────────────────────────

const BOOLEAN_FLAGS = new Set(['fixed-ids', 'fixed-clock']);

/**
 * Per-command closed flag allowlist (Frozen CLI ABI, PLAN.md ~L750: "no WP2 naming
 * latitude" -- every flag name a subcommand accepts is exactly this list; anything
 * else is USAGE_ERROR/INVALID_ARGUMENT, RCC-argv-7). `fixed-ids`/`fixed-clock` are
 * closed test-capability-gated flags accepted UNIFORMLY across every command
 * (PLAN.md ~L752 gates them by NODE_ENV=test + the harness capability, not by
 * subcommand identity) -- confirmed empirically: `runtime-consultation-state.bats`
 * passes `--fixed-ids` to `claim` and other state-mutating commands, not only
 * `publish-request`, for deterministic-ID test fixtures.
 */
const COMMAND_FLAGS = {
  'root-init': ['coordination-root'],
  'root-validate': ['coordination-root'],
  validate: ['coordination-root', 'kind', 'artifact'],
  'publish-request': ['coordination-root', 'plan', 'subject-bundle', 'intent'],
  'publish-blob': ['coordination-root', 'plan', 'subject-bundle', 'entry'],
  dispatch: ['coordination-root', 'request'],
  'record-delivery': ['coordination-root', 'request', 'attempt', 'epoch', 'driver', 'outcome', 'commit-point'],
  claim: ['coordination-root', 'request', 'role', 'worker-session'],
  'lease-heartbeat': ['coordination-root', 'request', 'claim'],
  takeover: ['coordination-root', 'request'],
  'publish-result': ['coordination-root', 'request', 'claim', 'content', 'blocked-reason'],
  'await-result': ['coordination-root', 'request', 'timeout'],
  'accept-result': ['coordination-root', 'request'],
  'transaction-ack': ['coordination-root', 'request', 'disposition'],
  cancel: ['coordination-root', 'request', 'reason'],
  'worker-stop': ['coordination-root', 'role', 'worker-session', 'kind', 'request'],
  'worker-stop-ack': ['coordination-root', 'stop', 'disposition'],
  cleanup: ['coordination-root', 'request'],
};
for (const cmdName of Object.keys(COMMAND_FLAGS)) {
  COMMAND_FLAGS[cmdName] = COMMAND_FLAGS[cmdName].concat(['fixed-ids', 'fixed-clock']);
}

/**
 * Portable argv caps (Frozen CLI ABI, PLAN.md ~L754): each PATH token is at most
 * 2048 UTF-8 bytes, checked before decode/allocation. `--intent`/`--content` are
 * semantic payloads, not paths, and obey their OWN downstream caps instead
 * (question<=8192B, native content<=12288B) -- deliberately excluded here so a
 * legitimately large-but-in-spec question/content is never falsely rejected by
 * the path-token cap (RCC-caps-1).
 */
const PATH_FLAG_NAMES = new Set([
  'coordination-root', 'request', 'plan', 'artifact', 'claim', 'stop', 'subject-bundle', 'entry',
]);
const MAX_PATH_TOKEN_BYTES = 2048;

/** Parses `--flag value` pairs (plus known boolean flags) after the subcommand token. */
function parseFlags(argv, command) {
  const allowedFlags = COMMAND_FLAGS[command] || [];
  const out = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (typeof tok !== 'string' || !tok.startsWith('--')) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unexpected argument: ' + tok);
    }
    const name = tok.slice(2);
    if (!allowedFlags.includes(name)) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unrecognized flag for ' + command + ': --' + name);
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (Object.prototype.hasOwnProperty.call(out, name)) {
        throw new CliError('USAGE_ERROR', 'DUPLICATE_ARGUMENT', 'duplicate --' + name);
      }
      out[name] = true;
      i += 1;
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing value for --' + name);
    }
    if (PATH_FLAG_NAMES.has(name) && Buffer.byteLength(val, 'utf8') > MAX_PATH_TOKEN_BYTES) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', '--' + name + ' exceeds the 2048-byte path-token cap');
    }
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      throw new CliError('USAGE_ERROR', 'DUPLICATE_ARGUMENT', 'duplicate --' + name);
    }
    out[name] = val;
    i += 2;
  }
  if (('fixed-ids' in out || 'fixed-clock' in out) && !isTestCapability()) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', '--fixed-ids/--fixed-clock require the test capability');
  }
  // RUNTIME_CONSULTATION_ACL_PROBE shares the same test-capability gate as
  // --fixed-ids/--fixed-clock (PLAN.md ~L752) but is an env var, not an argv flag,
  // so it is checked unconditionally here rather than via the allowlist above
  // (RCC-determinism-4).
  if (process.env.RUNTIME_CONSULTATION_ACL_PROBE && !isTestCapability()) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'RUNTIME_CONSULTATION_ACL_PROBE requires the test capability');
  }
  return out;
}

function requireFlags(flags, names) {
  for (const name of names) {
    if (!(name in flags)) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing required --' + name);
    }
  }
}

function resolveAbsolute(p) {
  return path.resolve(p);
}

// ─────────────────────────────────────────────────────────────────────────────
// Identity & Digests (PLAN.md ~L642-653) -- repo/worktree identity via git
// ─────────────────────────────────────────────────────────────────────────────

function gitRevParse(cwd, args) {
  return execFileSync('git', ['-C', cwd].concat(args), { encoding: 'utf8' }).trim();
}

function realpathOrSelf(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    return p;
  }
}

/** `repo_id = sha256(realpath(git rev-parse --path-format=absolute --git-common-dir))`. */
function computeRepoId(cwd) {
  const commonDir = gitRevParse(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return sha256String(realpathOrSelf(commonDir));
}

/** `worktree_id = sha256(realpath(git rev-parse --show-toplevel))`. */
function computeWorktreeId(cwd) {
  const toplevel = gitRevParse(cwd, ['rev-parse', '--show-toplevel']);
  return sha256String(realpathOrSelf(toplevel));
}

function computeSubjectHead(cwd) {
  return gitRevParse(cwd, ['rev-parse', 'HEAD']);
}

function computeCoordRootId(coordRoot) {
  return sha256String(realpathOrSelf(coordRoot));
}

// ─────────────────────────────────────────────────────────────────────────────
// Namespace & Root Security -- path helpers (PLAN.md ~L602-628)
// ─────────────────────────────────────────────────────────────────────────────

function planRootPath(coordRoot, repoId, waveSlug, planDigest) {
  return path.join(coordRoot, repoId, waveSlug, planDigest);
}

/**
 * Recovers the plan-root directory from an arbitrary artifact path known to live
 * somewhere under `<coordination_root>/<repo_id>/<wave_slug>/<plan_digest>/...`,
 * without requiring the caller to separately pass repo_id/wave_slug/plan_digest.
 * `coordination_root/<repo_id>/<wave_slug>/<plan_digest>` is always exactly three
 * path segments below coordination_root, regardless of how deep the artifact
 * itself sits beneath the plan-root.
 */
function planRootFromArtifact(coordRoot, artifactPath) {
  const rel = path.relative(path.resolve(coordRoot), path.resolve(artifactPath));
  const segments = rel.split(path.sep).filter(Boolean);
  if (segments.length < 3) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact path is not confined under coordination_root');
  }
  return path.join(path.resolve(coordRoot), segments[0], segments[1], segments[2]);
}

/**
 * Confines an EXISTING coordination root to its own enclosing git worktree
 * (PLAN.md "Root/default: same-worktree uses <worktree>/.planning/coordination
 * ... If confinement cannot be proven, sibling mode fails closed", WP3
 * RCR-confine-*). Mirrors the precedented `publish-blob` staging-root pattern
 * (`gitRevParse(coordRoot, ['rev-parse', '--show-toplevel'])`): worktree
 * identity is derived FROM the root's own location, not the caller's
 * `process.cwd()` (test harnesses and future callers may invoke this CLI from
 * anywhere). `existingCoordRoot` must already exist -- `git -C` requires a
 * real directory -- so `cmdRootInit` calls this AFTER `mkdirSync` (and rolls
 * back the directory it just created on rejection), while `cmdRootValidate`
 * calls it after already confirming the path exists and is a real directory.
 */
function assertRootConfinedToWorktree(existingCoordRoot) {
  let worktreeToplevel;
  try {
    worktreeToplevel = gitRevParse(existingCoordRoot, ['rev-parse', '--show-toplevel']);
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is not inside any git worktree: ' + existingCoordRoot);
  }
  const realWorktree = path.resolve(realpathOrSelf(worktreeToplevel));
  const realCoordRoot = path.resolve(realpathOrSelf(existingCoordRoot));
  const rel = path.relative(realWorktree, realCoordRoot);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is not confined under its own worktree: ' + existingCoordRoot);
  }
}

function transactionsDir(planRoot) {
  return path.join(planRoot, 'transactions');
}

function transactionDir(planRoot, requestId) {
  return path.join(transactionsDir(planRoot), requestId);
}

function requestPathFor(planRoot, requestId) {
  return path.join(transactionDir(planRoot, requestId), 'request.json');
}

/** Record #2b `activation/v1` path (PLAN.md ~L318) -- written before claim (#3). */
function activationPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'activations', attemptId + '.json');
}

function claimPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'claims', attemptId + '.json');
}

function activeLeasePathFor(txnDir, attemptId) {
  return path.join(txnDir, 'active-leases', attemptId + '.json');
}

function resultPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'results', attemptId + '.json');
}

function deliveryPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'delivery', attemptId + '.json');
}

function activationIntentPathFor(txnDir, attemptId) {
  return path.join(txnDir, 'delivery', attemptId + '.intent.json');
}

function takeoverPathFor(txnDir) {
  return path.join(txnDir, 'takeover.json');
}

function acceptedResultPathFor(txnDir) {
  return path.join(txnDir, 'accepted-result.json');
}

function ackPathFor(txnDir) {
  return path.join(txnDir, 'ack.json');
}

function cancelPathFor(txnDir) {
  return path.join(txnDir, 'cancel.json');
}

function inboxPathFor(planRoot, role, requestId) {
  return path.join(planRoot, 'inbox', role, requestId + '.json');
}

function blobPathFor(planRoot, digest) {
  return path.join(planRoot, 'blobs', digest);
}

/**
 * Record #12 `stop/v2` path (PLAN.md ~L506): `workers/<target_role>/<worker_session_id>/stops/<stop_id>.json`.
 * Confirmed plan-root-relative by the frozen suite's own `_stop_path()` fixture
 * helper in `runtime-consultation-cli.bats`.
 */
function stopPathFor(base, role, workerSessionId, stopId) {
  return path.join(base, 'workers', role, workerSessionId, 'stops', stopId + '.json');
}

/** Sibling immutable acknowledgement: `.../stops/<stop_id>.ack.json` (PLAN.md ~L519). */
function stopAckPathFor(stopPath, stopId) {
  return path.join(path.dirname(stopPath), stopId + '.ack.json');
}

/** Safe-segment guard: rejects traversal/absolute/empty path segments used as filenames. */
function assertSafeSegment(segment, label) {
  if (
    typeof segment !== 'string'
    || segment.length === 0
    || segment.includes('/')
    || segment.includes('\\')
    || segment === '.'
    || segment === '..'
    || segment.includes('\0')
  ) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'unsafe path segment for ' + label);
  }
}

const HEX_ID_RE = /^[a-f0-9]{32,128}$/;

function assertHexId(value, label) {
  if (typeof value !== 'string' || !HEX_ID_RE.test(value)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', label + ' must be a lowercase-hex id');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Portable no-clobber primitive (PLAN.md ~L679-683) + directory durability barrier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WP1 durability fault-injection seam (correction pass, verified NO-GO DUR-01..03):
 * when active, forces the directory-fsync step below to fail deterministically
 * instead of relying on a platform/filesystem that happens to reject an O_RDONLY
 * directory descriptor. Gated ONLY under the harness test capability -- mirrors
 * resolveEffectivePlatform's/resolveFixedClockState's own isTestCapability()-gated
 * env-var overrides EXACTLY; production (no capability) never honors this env var,
 * by construction. WP1 durability correction pass 2: `fsyncDir` below is now
 * fail-closed -- this seam's injected failure surfaces as a proven `false` return
 * (DUR-01), never a swallowed fail-open success.
 */
function isDirFsyncFaultActive(barrierLabel) {
  if (!isTestCapability()) return false;
  const v = process.env.RUNTIME_CONSULTATION_FAULT_DIR_FSYNC;
  if (typeof v !== 'string' || v.length === 0) return false;
  // "1"/"all" fails EVERY directory barrier (backward-compat, DUR-01). Otherwise
  // the value names the single barrier to fail independently -- "barrier1",
  // "barrier2" (publishNoClobber), or "replace" (publishReplace) -- so a RED test
  // can prove each barrier's own fail-closed behavior in isolation.
  return v === '1' || v === 'all' || v === barrierLabel;
}

/**
 * Capability-gated seam (Section 0.1): force the PRIMARY post-fsync directory-fd
 * close to fail, independent of `isDirFsyncFaultActive` -- so a test can prove
 * `fsyncDir` fails closed on a genuine close failure even though the fsync itself
 * genuinely succeeded, without manufacturing an unrelated EBADF via a redundant
 * second close of an already-closed fd. Same barrierLabel matching convention as
 * the fsync seam ("1"/"all" -> every barrier; otherwise the one named barrier).
 */
function isDirCloseFaultActive(barrierLabel) {
  if (!isTestCapability()) return false;
  const v = process.env.RUNTIME_CONSULTATION_FAULT_DIR_CLOSE;
  if (typeof v !== 'string' || v.length === 0) return false;
  return v === '1' || v === 'all' || v === barrierLabel;
}

/** Non-schema-visible fault-injection counter (test/diagnostic use only). */
let dirFsyncFaultInjectedCount = 0;
let dirCloseFaultInjectedCount = 0;

/**
 * Diagnostic-only: the most recent throwable `fsyncDir` observed on either its
 * fsync or its primary-close step (whichever actually failed). NOT authoritative
 * -- `fsyncDir`'s boolean return remains the sole proof callers act on -- this
 * exists only so a caller's CliError message can name the real underlying cause
 * (Section 0.1: "preserve the most useful underlying cause for diagnostics").
 * Safe as module-scoped state: this file is entirely synchronous (Sync fs calls
 * throughout), so there is no concurrent `fsyncDir` call that could interleave.
 */
let lastFsyncDirError = null;

/** Capability-gated seam: force the post-barrier-1 temp unlink to fail (DUR-E). */
function isTempUnlinkFaultActive() {
  return (
    isTestCapability()
    && typeof process.env.RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK === 'string'
    && process.env.RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK.length > 0
  );
}

/**
 * Capability-gated seam (Section 0.2): force a no-clobber EEXIST LOSER's own
 * temp-cleanup unlink to fail -- distinct from `isTempUnlinkFaultActive`
 * (DUR-E), which targets the WINNER's post-barrier-1 cleanup unlink. A single
 * `publishNoClobber` call only ever reaches one of the two sites, so the two
 * seams never interact within one test.
 */
function isLoserUnlinkFaultActive() {
  return (
    isTestCapability()
    && typeof process.env.RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK === 'string'
    && process.env.RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK.length > 0
  );
}

/** Capability-gated seam: force publishReplace's PRE_RENAME temp file-fsync to fail (item 7). */
function isTempFsyncFaultActive() {
  return (
    isTestCapability()
    && typeof process.env.RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC === 'string'
    && process.env.RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC.length > 0
  );
}

/**
 * Capability-gated seam (Section 0.3): force EITHER step of the post-create
 * temp-hardening to fail, for both publishNoClobber's and publishReplace's temps --
 * `phase` is `'fchmod'` (the mode-forcing call itself) or `'fstat'` (the SEPARATE
 * proving fstat immediately after it; Codex NO-GO round 2, missing-evidence item 1 --
 * a single boolean env var could only ever exercise whichever step ran first, never
 * the fstat call in isolation with fchmod having genuinely succeeded).
 */
function isTempHardenFaultActive(phase) {
  return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN === phase;
}

/**
 * Capability-gated seam (Codex P1-1): deterministically simulate an attacker swapping
 * the no-clobber temp's content AFTER our own write+fsync+identity-capture but BEFORE
 * our `linkSync` -- proves the post-link revalidation's identity binding (dev/ino
 * captured from OUR OWN temp fd, not just a byte compare) rejects a target that got
 * hard-linked to a DIFFERENT (attacker-controlled) inode. `phase` is currently only
 * `'swap'`; a single env var carrying a phase selector mirrors
 * `isReplacePostRenameFaultActive`'s convention for closely-related seams in one function.
 */
function isNoclobberPrelinkFaultActive(phase) {
  return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PRELINK === phase;
}

/**
 * Capability-gated seam (Codex P1-1): deterministically mutate the JUST-PUBLISHED
 * target AFTER barrier 2 but BEFORE publishNoClobber's final fd-bound revalidation --
 * `'delete'` removes it entirely, `'hardlink'` adds a second link -- proving the
 * revalidation (not the barriers alone) is what gates the writer's own SUCCESS claim.
 */
function isNoclobberPrevalidateFaultActive(phase) {
  return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_NOCLOBBER_PREVALIDATE === phase;
}

/**
 * Capability-gated seam (Codex gap #4, round 1): force the VERY FIRST fstat of the
 * temp itself (proving it is a genuine owner-confined 0600 regular file) to fail --
 * the earliest possible fstat failure in the whole decision. `isReconcileUnlinkFault
 * Active`/`isReconcileRevalidateFaultActive`/`isReconcileFinalLstatFaultActive`
 * (targeting the temp-unlink and post-unlink revalidation steps) were REMOVED in the
 * Codex NO-GO round 2 (blocker 1) rewrite -- `reconcileOneNoClobberTemp` no longer
 * performs any destructive unlink, so those steps no longer exist to fault-inject.
 */
function isReconcileTempFstatFaultActive() {
  return (
    isTestCapability()
    && typeof process.env.RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT === 'string'
    && process.env.RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT.length > 0
  );
}

/** Capability-gated seam: force releaseLock's rmdir(.lock) to fail (item 8). */
function isLockRmdirFaultActive() {
  return (
    isTestCapability()
    && typeof process.env.RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR === 'string'
    && process.env.RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR.length > 0
  );
}

/**
 * Capability-gated seam: force a specific POST-RENAME step of publishReplace to throw so a
 * test can prove EVERY post-rename throwable (barrier | open | fstat1 | read | fstat2 |
 * lstat | close) is caught by the outer catch, poisons the lock, and retains .lock (item 3).
 */
function isReplacePostRenameFaultActive(step) {
  return isTestCapability() && process.env.RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME === step;
}

/**
 * Capability-gated seam: DETERMINISTICALLY mutate an artifact mid-read (between the first
 * fstat snapshot and the read/re-fstat) so a test can prove the durable reader's BigInt
 * snapshot comparison rejects a chmod drift, a same-inode rewrite (ctime/mtime), an added
 * hardlink, growth, or a path rebound -- rather than depending on a real TOCTOU race
 * (DUR-J item 5). Inert without the test capability + env var.
 */
function injectReadMutationFault(artifactPath) {
  if (!isTestCapability()) return;
  const kind = process.env.RUNTIME_CONSULTATION_FAULT_READ_MUTATE;
  if (!kind) return;
  try {
    if (kind === 'chmod') fs.chmodSync(artifactPath, 0o640);
    else if (kind === 'grow') fs.appendFileSync(artifactPath, 'X');
    else if (kind === 'hardlink') fs.linkSync(artifactPath, artifactPath + '.evil-hardlink');
    else if (kind === 'rewrite') fs.writeFileSync(artifactPath, fs.readFileSync(artifactPath)); // same inode+size, new ctime/mtime
    else if (kind === 'rebind') {
      const other = artifactPath + '.rebind-src';
      fs.writeFileSync(other, fs.readFileSync(artifactPath), { mode: 0o600 });
      fs.renameSync(other, artifactPath); // a DIFFERENT inode now occupies the path
    }
  } catch (e) { /* best-effort test seam */ }
}

/**
 * Opens+fsyncs+closes a directory fd -- the portable "flush directory barrier".
 * Fail-closed (WP1 durability correction pass 2, PLAN.md ~L679-683; Section 0.1
 * correction): returns `true` ONLY when the flush is actually PROVEN -- a real
 * `fs.fsyncSync` against the open directory fd completed without error AND the
 * PRIMARY `fs.closeSync` of that same fd also completed without error. A close
 * failure after a successful fsync is NOT swallowed: this function used to
 * close the fd only in a best-effort `finally` that never affected the return
 * value, so a real close failure was silently laundered into `true`. Returns
 * `false` on ANY failure to prove the barrier -- the platform/filesystem
 * rejecting the O_RDONLY directory descriptor, `fs.fsyncSync` throwing, the
 * primary `fs.closeSync` throwing, or either WP1 fault-injection seam
 * (`isDirFsyncFaultActive` / `isDirCloseFaultActive` above) firing. The
 * close-fault seam takes the PRIMARY close's place (never a redundant second
 * close of an already-closed fd, which would manufacture an unrelated EBADF)
 * -- when it fires, the fd is still closed for real via the `finally` cleanup
 * below, so no fd leaks even though the fault-injected error is what
 * determines `proven`. This function itself never throws for an ordinary
 * flush/close failure -- that decision belongs one level up, to each caller
 * (`publishNoClobber` fails closed on a `false` return; `publishReplace` does
 * not check it -- see its own comment, out of scope for this pass).
 */
function fsyncDir(dirPath, barrierLabel) {
  let fd;
  let proven = false;
  let primaryClosed = false;
  try {
    fd = fs.openSync(dirPath, 'r');
    if (isDirFsyncFaultActive(barrierLabel)) {
      dirFsyncFaultInjectedCount += 1;
      const injected = new Error('simulated directory-fsync failure (RUNTIME_CONSULTATION_FAULT_DIR_FSYNC)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.fsyncSync(fd);
    if (isDirCloseFaultActive(barrierLabel)) {
      dirCloseFaultInjectedCount += 1;
      const injected = new Error('simulated directory-close failure (RUNTIME_CONSULTATION_FAULT_DIR_CLOSE)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.closeSync(fd);
    primaryClosed = true;
    lastFsyncDirError = null;
    proven = true;
  } catch (err) {
    lastFsyncDirError = err;
    proven = false;
  } finally {
    if (fd !== undefined && !primaryClosed) {
      try { fs.closeSync(fd); } catch (err) { /* best-effort cleanup after an already-failed/faulted primary close */ }
    }
  }
  return proven;
}

/** Diagnostic-only suffix naming `fsyncDir`'s last observed cause (Section 0.1); '' if none. */
function fsyncDirCauseSuffix() {
  return lastFsyncDirError ? (' (' + (lastFsyncDirError.message || lastFsyncDirError.code) + ')') : '';
}

/** Writes an entire buffer via `fs.writeSync`, looping to cover any partial write. */
function writeAllSync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset);
    // A blocking write to a regular file advances by >=1 byte or throws. A 0-byte
    // return with bytes still pending can make no forward progress -- fail closed
    // (DUR-A) rather than spin forever on the durability write path.
    if (written <= 0) {
      throw new Error('writeSync made no progress (' + written + ' of ' + (buffer.length - offset) + ' pending bytes) on fd ' + fd);
    }
    offset += written;
  }
}

/**
 * Section 0.3: after an exclusive O_NOFOLLOW temp create, forces the fd to EXACT
 * owner-only 0600 regardless of the process umask -- `open()`'s mode argument is
 * itself subject to umask (an unusually restrictive umask can silently strip
 * owner bits, e.g. 0600 requested under umask 0277 lands as 0400), but
 * `fchmodSync` is not -- and proves it via `fstatSync` before any byte is
 * written. Shared by publishNoClobber's and publishReplace's temps. Throws
 * CliError(DURABILITY_UNPROVEN) on any fchmod/fstat failure, an unexpected
 * identity, or the WP1 fault-injection seam (`isTempHardenFaultActive`) firing
 * -- the caller is responsible for closing/unlinking the temp on this throw, as
 * it already does for every other pre-durability temp-setup failure.
 */
function hardenTempFdExact0600(fd, tempPath) {
  if (process.platform === 'win32') return; // POSIX-mode discipline only; Windows ACL confinement is PENDING_CI.
  try {
    if (isTempHardenFaultActive('fchmod')) {
      const injected = new Error('injected temp-harden fchmod failure (RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fchmod)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.fchmodSync(fd, 0o600);
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'temp fchmod to exact 0600 failed: ' + tempPath + ' (' + (err && err.message) + ')');
  }
  let st;
  try {
    if (isTempHardenFaultActive('fstat')) {
      const injected = new Error('injected temp-harden fstat failure (RUNTIME_CONSULTATION_FAULT_TEMP_HARDEN=fstat)');
      injected.code = 'EIO';
      throw injected;
    }
    st = fs.fstatSync(fd, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'temp fstat after fchmod failed: ' + tempPath + ' (' + (err && err.message) + ')');
  }
  if (!statIsRegularFile(st)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'temp is not a regular file after fchmod: ' + tempPath);
  }
  if ((st.mode & 0o777n) !== 0o600n) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'temp mode is not exact owner-only 0600 after fchmod: ' + tempPath);
  }
  if (typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'temp owner is not the current process after fchmod: ' + tempPath);
  }
}

/**
 * ONE canonical publish primitive (PLAN.md ~L679): owner-tagged same-dir temp ->
 * write+fsync temp -> linkSync(temp,target) first-writer-wins -> directory barrier 1
 * -> unlink temp -> directory barrier 2. Throws CliError(INVALID, AUTHORITY_INVALID)
 * on an EEXIST no-clobber race loss (some callers remap this to a more specific
 * detail_code). Idempotent-if-byte-identical for content-addressed targets when
 * `allowIdenticalIdempotent` is true -- but ONLY once the EXISTING target is
 * itself proven durable (nlink===1); an nlink!=1 target means some other
 * publisher's own barrier 1 (this same temp-link scheme) never completed, so
 * this call must not launder a SUCCESS on top of that unproven state either
 * (WP1 durability correction pass 2, DUR-05).
 *
 * Fail-closed on either directory-fsync barrier (WP1 durability correction
 * pass 2, PLAN.md ~L679: "Writer returns only after barrier 2"): if
 * `fsyncDir` cannot PROVE the flush, this throws CliError(INVALID,
 * DURABILITY_UNPROVEN, ...) instead of returning the target as SUCCESS
 * (DUR-01).
 */
function publishNoClobber(targetPath, bytes, opts) {
  const options = opts || {};
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + process.pid + '.' + genId({ raw: true }).slice(0, 16) + '.tmp-owner');
  // Exclusive/no-follow temp create (defense-in-depth, DUR-06): O_CREAT|O_EXCL
  // rejects a pre-planted file already sitting at this (random-nonce, so
  // practically unguessable) temp path instead of silently overwriting it;
  // O_NOFOLLOW rejects a pre-planted symlink at that exact path instead of
  // following it. Neither flag changes behavior for the overwhelmingly-common
  // case (temp path never previously existed) -- a fresh cryptographically-
  // random nonce every call -- so this open() succeeds exactly as the prior
  // plain writeFileSync did.
  const tempFd = fs.openSync(
    tempPath,
    fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  let tempIdentity;
  try {
    // Section 0.3: force exact 0600 via fchmod (never trust open()'s mode argument
    // alone, which is subject to the process umask) before any byte is written.
    hardenTempFdExact0600(tempFd, tempPath);
    writeAllSync(tempFd, buf);
    fs.fsyncSync(tempFd);
    // Codex P1-1: capture OUR OWN temp's identity (dev/ino) while its fd is still open
    // and trusted -- the post-link revalidation below binds the final target back to
    // THIS exact inode, so a temp swapped out from under us between this close and the
    // linkSync call cannot be laundered into a SUCCESS merely because linkSync itself
    // did not error.
    tempIdentity = fs.fstatSync(tempFd, { bigint: true });
  } finally {
    fs.closeSync(tempFd);
  }
  if (isNoclobberPrelinkFaultActive('swap')) {
    // Test-only (Codex P1-1 repro): simulate an attacker swapping the temp's content
    // between our own fsync+identity-capture and our linkSync below.
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort test setup */ }
    fs.writeFileSync(tempPath, Buffer.from('RUNTIME_CONSULTATION_TEST_ATTACKER_SWAP_CONTENT'), { mode: 0o600 });
  } else if (isNoclobberPrelinkFaultActive('swap-same-bytes')) {
    // Test-only (Codex NO-GO round 2, missing-evidence item 3): swap to a FRESH file
    // carrying the EXACT SAME bytes we just wrote (`buf`) -- a different inode, but
    // byte-identical content. Isolates that the post-link revalidation's identity
    // binding (dev/ino), not merely a byte comparison, is what rejects the foreign
    // inode: a byte-only check would see identical content and wrongly accept it.
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort test setup */ }
    fs.writeFileSync(tempPath, buf, { mode: 0o600 });
  }
  try {
    fs.linkSync(tempPath, targetPath);
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Loser cleanup (PLAN.md ~L679-683 binding: "losers clean temp + flush"), CHECKED,
      // strictly BEFORE any idempotent-success or race-loss classification (Section 0.2):
      // unlink our own owned temp, then flush the directory. Either step failing means we
      // cannot PROVE our temp is durably gone, so the call fails closed DURABILITY_UNPROVEN
      // -- never an idempotent SUCCESS (even against a byte-identical target) and never a
      // silent best-effort swallow that leaves a false completion claim.
      try {
        if (isLoserUnlinkFaultActive()) {
          const injected = new Error('injected loser-cleanup unlink failure (RUNTIME_CONSULTATION_FAULT_LOSER_UNLINK)');
          injected.code = 'EIO';
          throw injected;
        }
        fs.unlinkSync(tempPath);
      } catch (unlinkErr) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'no-clobber loser could not durably remove its own temp: ' + tempPath + ' (' + (unlinkErr && unlinkErr.message) + ')');
      }
      if (!fsyncDir(dir, 'loser-cleanup')) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'no-clobber loser temp cleanup could not be flushed durable for ' + dir + fsyncDirCauseSuffix());
      }
      if (options.allowIdenticalIdempotent) {
        // DUR-F (PLAN.md ~L679-683): the idempotent no-op must FD-BIND the existing
        // target and prove it is a genuine, owner-confined, durable REGULAR FILE --
        // never read it by path (which follows a symlink and would accept an
        // attacker-planted byte-identical file, or a hard link, as the durable
        // artifact). O_NOFOLLOW rejects a symlinked target at open; fstat proves
        // regular-file + owner + owner-only mode + nlink==1; the compare is
        // fd-bound and re-fstat'd for identity (no swap mid-read).
        let existingFd;
        try {
          existingFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        } catch (openErr) {
          if (openErr && openErr.code === 'ELOOP') {
            throw new CliError('INVALID', 'SECURITY_INVALID', 'idempotent target is a symlink (rejected at open): ' + targetPath);
          }
          throw openErr;
        }
        try {
          // DUR-J item 5: reuse the shared BigInt comparator to prove the existing target is
          // a genuine, owner-confined, EXACT-0600, nlink==1, identity-stable durable file
          // carrying EXACTLY our bytes (with a final re-lstat). Byte-identical + durable -> an
          // idempotent no-op success; a genuine durable target with DIFFERENT bytes is a
          // no-clobber race-loss (a different publisher won); nlink==2 / symlink / wrong-mode /
          // identity drift propagate as their own SECURITY/DURABILITY failure.
          try {
            assertDurableTargetMatches(existingFd, targetPath, buf);
          } catch (cmpErr) {
            if (cmpErr && cmpErr.byteMismatch) {
              throw new CliError('INVALID', options.raceDetailCode || 'AUTHORITY_INVALID', 'no-clobber race lost (existing durable target differs) for ' + targetPath);
            }
            throw cmpErr;
          }
          return targetPath;
        } finally {
          fs.closeSync(existingFd);
        }
      }
      throw new CliError('INVALID', options.raceDetailCode || 'AUTHORITY_INVALID', 'no-clobber race lost for ' + targetPath);
    }
    // Non-EEXIST linkSync failure: NOT the PLAN-bound loser-cleanup path above (an
    // arbitrary fs error, not a race loss) -- best-effort temp cleanup, as before.
    try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best effort */ }
    throw err;
  }
  // Barrier 1: target link durable while nlink==2. If NOT proven, the target
  // currently exists with nlink==2 (still hard-linked from tempPath) -- the
  // exact crash-cut state CC-02/CC-03 already model for an out-of-process
  // crash (a reader's assertDurable correctly rejects nlink==2 as
  // DURABILITY_UNPROVEN) -- fail closed: the writer itself must never claim
  // SUCCESS on an unproven durability barrier.
  if (!fsyncDir(dir, 'barrier1')) {
    // Fail closed and deliberately LEAVE the target at nlink==2 (the owner-tagged
    // temp stays hard-linked): barrier 1 was never proven, so unlinking the temp
    // here would drop the target to nlink==1 and break the PLAN.md ~L681 invariant
    // (nlink==1 IMPLIES barrier-1-durable) -- a reader's assertDurable or an
    // idempotent retry would then launder this unproven barrier as durable
    // (DUR-C). Codex NO-GO round 2 (blocker 1): the nlink==2 orphan is later
    // DETECTED and REPORTED by `reconcileTempArtifacts`/`cleanup` (`'unlink-unsafe'`,
    // DUR-H) -- it is NOT auto-completed/reconciled away; no portable primitive can
    // prove a path-based unlink targets the fd-accredited inode, so recovery
    // reports the orphan rather than resolving it.
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'directory-fsync barrier 1 not proven for ' + dir + fsyncDirCauseSuffix());
  }
  try {
    if (isTempUnlinkFaultActive()) {
      const injected = new Error('injected temp-unlink failure (RUNTIME_CONSULTATION_FAULT_TEMP_UNLINK)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.unlinkSync(tempPath);
  } catch (err) {
    // DUR-E: a failed post-barrier-1 temp unlink leaves the target hard-linked
    // (nlink==2) -- a reader/idempotent-retry rejects it -- so the writer must
    // fail closed rather than swallow the failure and return a non-durable
    // SUCCESS. Codex NO-GO round 2 (blocker 1): the nlink==2 orphan is later
    // DETECTED and REPORTED (never auto-completed) by `cleanup` (DUR-H).
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'temp cleanup unlink failed after barrier 1; target not durable: ' + tempPath);
  }
  // Barrier 2: cleanup durable. The target link is already fully present at
  // nlink==1 by this point regardless of this barrier's own outcome -- but
  // the writer's OWN contract (PLAN.md ~L679: "Writer returns only after
  // barrier 2") is stricter than what a reader can currently observe here, so
  // an unproven barrier 2 still fails the publish closed rather than
  // returning SUCCESS.
  if (!fsyncDir(dir, 'barrier2')) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'directory-fsync barrier 2 not proven for ' + dir + fsyncDirCauseSuffix());
  }
  // Codex P1-1: the writer's own SUCCESS claim must be PROVEN, not merely inferred from
  // the barriers having reported clean -- a temp swapped in before linkSync, a target
  // deleted after it, or a hardlink added after it would otherwise let this function
  // return SUCCESS over a target that is foreign, absent, or no longer nlink==1. This
  // final fd-bound revalidation re-opens the target NO_FOLLOW and binds it back to the
  // ORIGINAL temp's captured identity (dev/ino) via the shared comparator, re-proving
  // regular/owner/exact-0600/nlink==1/exact-bytes/stable-metadata. From this point the
  // durable link is ALREADY established (mirroring publishReplace's POST_RENAME_UNPROVEN
  // phase) -- ANY failure here POISONS so a caller holding the transition lock retains it
  // as a durable orphan for later reconciliation rather than silently releasing over a
  // compromised or vanished target.
  try {
    if (isNoclobberPrevalidateFaultActive('delete')) {
      // Test-only (Codex P1-1 repro): simulate an attacker deleting the just-published
      // target after barrier 2 but before this revalidation observes it.
      try { fs.unlinkSync(targetPath); } catch (e) { /* best-effort test setup */ }
    } else if (isNoclobberPrevalidateFaultActive('hardlink')) {
      // Test-only (Codex P1-1 repro): simulate an attacker adding a second hardlink to
      // the just-published target after barrier 2 but before this revalidation observes
      // it -- the shared comparator's nlink==1 check must reject it.
      try { fs.linkSync(targetPath, targetPath + '.attacker-hardlink-test-only'); } catch (e) { /* best-effort test setup */ }
    }
    let checkFd;
    try {
      checkFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      if (err && err.code === 'ELOOP') {
        throw new CliError('INVALID', 'SECURITY_INVALID', 'published target is a symlink (rejected at post-publish revalidation): ' + targetPath);
      }
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'published target vanished before post-publish revalidation: ' + targetPath + ' (' + (err && err.message) + ')');
    }
    try {
      assertDurableTargetMatches(checkFd, targetPath, buf, { dev: tempIdentity.dev, ino: tempIdentity.ino });
    } finally {
      try { fs.closeSync(checkFd); } catch (e) { /* best-effort cleanup */ }
    }
    return targetPath; // COMPLETE: publish credited durable + fully revalidated.
  } catch (err) {
    const poisoned = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'post-publish target not accredited durable (POST_LINK_UNPROVEN): ' + (err && err.message));
    poisoned.cause = err;
    throw markPoisoned(poisoned);
  }
}

/**
 * Durable replace (active-lease/presence heartbeat ONLY -- everything else uses
 * `publishNoClobber`): same-directory owner-tagged exclusive temp -> canonical
 * write+fsync -> atomic rename over target -> directory fsync.
 */
const S_IFMT = 0o170000n;
const S_IFREG = 0o100000n;
function statIsRegularFile(bigintStat) { return (bigintStat.mode & S_IFMT) === S_IFREG; }

/** Bounded fd read (position-explicit): reads at most `cap` bytes from position 0 -- never an
 *  uncapped readFileSync(fd) after a racy precheck (DUR-J item 5). */
function readAllFromFd(fd, cap) {
  const buf = Buffer.allocUnsafe(cap);
  let total = 0;
  while (total < cap) {
    const n = fs.readSync(fd, buf, total, cap - total, total);
    if (n === 0) break;
    total += n;
  }
  return buf.subarray(0, total);
}

/**
 * Shared fd-bound durable comparator (DUR-J item 5), reused by publishReplace's post-rename
 * revalidation AND the EEXIST idempotent path. Given an OPEN no-follow fd on `targetPath`,
 * proves it is a regular file, owner-confined, EXACT 0600 (POSIX), nlink==1, size-bounded,
 * carries EXACTLY `expectedBytes`, and that a BigInt stat snapshot (dev/ino/nlink/size/mode/
 * uid/gid/ctimeNs/mtimeNs) is unchanged across the read, with a final lstat re-proving ALL
 * of those invariants on the path (rejecting a same-inode rewrite, chmod drift, an added
 * hardlink, growth, or a path rebound). Throws CliError on any violation.
 *
 * Section 0.4: a byte/size mismatch is RECORDED, never thrown immediately -- fstat2 and the
 * final lstat still run regardless, so genuine metadata drift during the read is never masked
 * by an early return. Metadata drift wins over a race-loss classification: only once identity
 * and path are proven STABLE throughout (fstat2 + lstat both clean) is the recorded mismatch
 * finally surfaced, `byteMismatch`-tagged, for an idempotent caller to map to AUTHORITY/race-
 * loss. When size already mismatches, the byte-for-byte read/compare is skipped (the sizes
 * already prove content differs) but fstat2/lstat still run on the untouched fd/path.
 *
 * `expectedIdentity` (Codex P1-1, optional `{dev, ino}` BigInts): when provided, the FIRST
 * fstat's (dev, ino) must match exactly, or the call fails closed SECURITY_INVALID before any
 * other check -- binding the open fd back to a SPECIFIC previously-captured inode (e.g.
 * publishNoClobber's own just-written temp) rather than accepting any regular, owner-
 * confined, byte-matching file as sufficient proof. Omitted by both publishReplace's and the
 * EEXIST-loser's callers, which have no single inode of their own to bind against.
 */
function assertDurableTargetMatches(fd, targetPath, expectedBytes, expectedIdentity) {
  if (isReplacePostRenameFaultActive('fstat1')) throw new Error('injected fstat1 fault');
  const st = fs.fstatSync(fd, { bigint: true });
  if (!statIsRegularFile(st)) throw new CliError('INVALID', 'SECURITY_INVALID', 'target is not a regular file: ' + targetPath);
  const isPosix = process.platform !== 'win32';
  if (isPosix && typeof process.getuid === 'function' && st.uid !== BigInt(process.getuid())) throw new CliError('INVALID', 'SECURITY_INVALID', 'target is not owner-confined: ' + targetPath);
  if (isPosix && (st.mode & 0o777n) !== 0o600n) throw new CliError('INVALID', 'SECURITY_INVALID', 'target mode is not owner-only 0600: ' + targetPath);
  if (expectedIdentity && (st.dev !== expectedIdentity.dev || st.ino !== expectedIdentity.ino)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'target inode does not match the originally published temp (swap/tamper between write and link): ' + targetPath);
  }
  if (st.nlink !== 1n) throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target nlink!=1: ' + targetPath);

  let mismatchErr = null;
  if (st.size !== BigInt(expectedBytes.length)) {
    // A size difference IS a content difference (byte-mismatch); recorded, not thrown yet.
    mismatchErr = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target size does not match the payload: ' + targetPath);
    mismatchErr.byteMismatch = true;
  } else {
    if (isReplacePostRenameFaultActive('read')) throw new Error('injected read fault');
    const readback = readAllFromFd(fd, Number(st.size) + 1);
    if (Buffer.compare(readback, expectedBytes) !== 0) {
      // A genuine, durable target that simply carries DIFFERENT bytes is flagged distinctly so
      // an idempotent caller can map it to a no-clobber race-loss rather than a durability fault.
      mismatchErr = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target bytes do not match the payload: ' + targetPath);
      mismatchErr.byteMismatch = true;
    }
  }

  if (isReplacePostRenameFaultActive('fstat2')) throw new Error('injected fstat2 fault');
  const st2 = fs.fstatSync(fd, { bigint: true });
  if (st2.dev !== st.dev || st2.ino !== st.ino || st2.nlink !== st.nlink || st2.size !== st.size || st2.mode !== st.mode || st2.uid !== st.uid || st2.gid !== st.gid || st2.ctimeNs !== st.ctimeNs || st2.mtimeNs !== st.mtimeNs) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target identity changed during read (rewrite/chmod/hardlink/growth): ' + targetPath);
  }
  if (isReplacePostRenameFaultActive('lstat')) throw new Error('injected lstat fault');
  const lst = fs.lstatSync(targetPath, { bigint: true });
  // PRESENT requires the LAST snapshot still be a single-link (nlink==1) inode with ALL
  // invariants -- including ctimeNs/mtimeNs -- unchanged from the stable fstat snapshot.
  if (lst.dev !== st.dev || lst.ino !== st.ino || lst.nlink !== st.nlink || lst.size !== st.size || lst.mode !== st.mode || lst.uid !== st.uid || lst.gid !== st.gid || lst.ctimeNs !== st.ctimeNs || lst.mtimeNs !== st.mtimeNs) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'target path rebound or invariants changed after read: ' + targetPath);
  }

  // Identity/path proven STABLE throughout the read -- ONLY NOW may a genuine byte/size
  // mismatch be surfaced as a race-loss candidate.
  if (mismatchErr) throw mismatchErr;
}

function publishReplace(targetPath, bytes) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + process.pid + '.' + genId({ raw: true }).slice(0, 16) + '.refresh-tmp-owner');
  // DUR-G (PLAN.md ~L677): the refresh temp is created with the SAME owner-confined,
  // no-follow, exclusive discipline as publishNoClobber -- O_EXCL rejects a colliding
  // stray, O_NOFOLLOW rejects a planted symlink at the temp path, 0600 keeps it
  // owner-only -- then the canonical bytes are written through that one fd and the
  // FILE is fsync'd via the same fd (never re-opened by path, which would re-follow).
  let tempFd;
  try {
    tempFd = fs.openSync(tempPath, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh temp could not be created exclusively: ' + (err && err.message));
  }
  try {
    // Section 0.3: force exact 0600 via fchmod (never trust open()'s mode argument
    // alone, which is subject to the process umask) before any byte is written.
    hardenTempFdExact0600(tempFd, tempPath);
    writeAllSync(tempFd, bytes);
    if (isTempFsyncFaultActive()) {
      const injected = new Error('injected refresh temp fsync failure (RUNTIME_CONSULTATION_FAULT_TEMP_FSYNC)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.fsyncSync(tempFd);
  } catch (err) {
    try { fs.closeSync(tempFd); } catch (e) { /* already closed */ }
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort cleanup */ }
    // PRE_RENAME failure: the rename has NOT happened, the prior target is intact -> a
    // normal (non-poisoning) error, so the caller's lock is released. A CliError from
    // hardenTempFdExact0600 above is preserved verbatim (its own detail_code is more
    // specific than a generic wrap); any other fs-level error is wrapped as before.
    throw (err instanceof CliError) ? err : new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh temp write/fsync failed (PRE_RENAME, prior lease intact): ' + (err && err.message));
  }
  // The pre-rename temp CLOSE is part of PRE_RENAME: a failed close means the temp cannot
  // be trusted as fully committed, so we do NOT rename (the prior target stays intact).
  try {
    fs.closeSync(tempFd);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort PRE_RENAME cleanup */ }
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh temp close failed (PRE_RENAME, prior lease intact): ' + (err && err.message));
  }

  // DUR-J item 7 -- explicit progress states. The RENAME is the durability boundary. A
  // rename FAILURE leaves the prior target intact (PRE_RENAME) -> a NORMAL error, so the
  // caller's lock may be released and the prior lease remains valid.
  try {
    fs.renameSync(tempPath, targetPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) { /* best-effort PRE_RENAME cleanup */ }
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh rename failed (prior lease intact, PRE_RENAME): ' + (err && err.message));
  }

  // POST_RENAME_UNPROVEN: the new bytes are visible at the target (nlink==1) but NOT yet
  // proven durable, and a crash could revert to the prior lease. An OUTER catch turns ANY
  // throwable from here to COMPLETE -- the directory barrier, or any open/fstat/read/fstat/
  // lstat/close of the fd-bound revalidation, or an unexpected error -- into a POISONED
  // DURABILITY_UNPROVEN so withLock retains .lock as a durable orphan and later actors
  // timeout+STOP. The phase boundary is STRUCTURAL (this try region), never per-throw marking.
  try {
    if (isReplacePostRenameFaultActive('barrier') || !fsyncDir(dir, 'replace')) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'refresh directory barrier could not be flushed after rename: ' + targetPath + fsyncDirCauseSuffix());
    }
    // POST_DIR_FSYNC: revalidate the durable target with the shared fd-bound comparator (the
    // fstat1/read/fstat2/lstat fault seams live INSIDE the comparator, at the real steps).
    if (isReplacePostRenameFaultActive('open')) throw new Error('injected post-rename open fault');
    const checkFd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let revalErr = null;
    try {
      assertDurableTargetMatches(checkFd, targetPath, bytes);
    } catch (err) {
      revalErr = err;
    }
    // The post-rename CLOSE of the revalidation fd is a durability step, NOT silenced. The
    // 'close' seam takes the PRIMARY close's own place (Section 0.4: never a redundant SECOND
    // close of an already-closed fd, which would manufacture an unrelated EBADF instead of
    // proving a genuine primary-close failure) -- the real fd is still closed for real via the
    // `finally` cleanup below, so no fd leaks even when the fault fires. If both the
    // revalidation and the close fail, both are preserved (close as cause) but the primary
    // outcome is still a poisoned DURABILITY_UNPROVEN.
    let closeErr = null;
    let checkFdClosed = false;
    try {
      if (isReplacePostRenameFaultActive('close')) {
        const injected = new Error('injected post-rename close fault (RUNTIME_CONSULTATION_FAULT_REPLACE_POSTRENAME=close)');
        injected.code = 'EBADF';
        throw injected;
      }
      fs.closeSync(checkFd);
      checkFdClosed = true;
    } catch (err) {
      closeErr = err;
    } finally {
      if (!checkFdClosed) {
        try { fs.closeSync(checkFd); } catch (err) { /* best-effort cleanup after the primary close failed/was faulted */ }
      }
    }
    if (revalErr) {
      if (closeErr) revalErr.cause = closeErr;
      throw revalErr;
    }
    if (closeErr) throw closeErr;
    return targetPath; // COMPLETE: rename credited durable + fully revalidated.
  } catch (err) {
    // Residual: after the rename, the PRIMARY truth is that the newly-visible target was NOT
    // accredited durable -> ALWAYS a fresh poisoned DURABILITY_UNPROVEN, with the original
    // (possibly SECURITY_INVALID / SCHEMA_INVALID / an fs error) preserved only as cause.
    const poisoned = new CliError('INVALID', 'DURABILITY_UNPROVEN', 'post-rename target not accredited durable (POST_RENAME_UNPROVEN): ' + (err && err.message));
    poisoned.cause = err;
    throw markPoisoned(poisoned);
  }
}

/**
 * Durability check for a no-clobber-published record: a reader must never accept
 * the transient `nlink==2` window (an owner-tagged temp still hard-linked to the
 * target) as durable (PLAN.md ~L679-683, `NC-READ-01`/`CC-02`).
 */
function assertDurable(targetPath) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact not found: ' + targetPath);
  }
  if (!stat.isFile()) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact is not a regular file: ' + targetPath);
  }
  if (stat.nlink !== 1) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact nlink!=1, not yet durable: ' + targetPath);
  }
}

// Coordination records are small canonical JSON; a file larger than this is not a
// genuine record and is refused before it is ever read into memory (DUR-J size bound).
const DEFAULT_MAX_DURABLE_ARTIFACT_BYTES = 1024 * 1024;

// Codex gap #2 (PLAN.md ~L698 "scan hard cap 1024 entries / 256 kept candidates"): the
// SAME DoS-bound scan caps the coordination-artifact hook scanner already uses
// (`MAX_CONSULT_HARD_CAP`/`MAX_CONSULT_ENTRIES` in `.claude/hooks/coordination-
// artifact.js`) -- deliberately the SAME NUMBERS, not a cross-file import (a CLI and a
// hook are architecturally separate consumers of the same PLAN-frozen bound) -- reused
// here for `listResultFiles` and DUR-H recovery directory enumeration so an
// implausibly large directory fails closed rather than silently scanning or keeping an
// unbounded set.
const MAX_ENUM_HARD_CAP = 1024;    // total directory entries scanned before fail-closed abort
const MAX_ENUM_KEPT_ENTRIES = 256; // max matching candidates kept/processed after filtering

/**
 * Codex NO-GO round 2, blocker 4 / round 3, cleanup item 1: bounded top-K insert,
 * ascending-sorted by `key`, evicting the LARGEST once `capacity` is exceeded -- so
 * the retained set is always the `capacity` SMALLEST/FIRST-sorted keys seen so far.
 * FROZEN policy (round 3): this deliberately matches the pre-existing, already-
 * shipped `listResultFiles` contract (`entries.filter(...).sort().slice(0,
 * MAX_ENUM_KEPT_ENTRIES)` -- ascending sort, keep the FIRST N) and `ENUM-CAP-02`'s own
 * test title ("keeps only the first 256 sorted names"). Distinct from `.claude/hooks/
 * coordination-artifact.js`'s own `insertCandidate` (which evicts the SMALLEST,
 * retaining the LARGEST/"newest" N -- a deliberately DIFFERENT policy for that
 * scanner's own "newest-first" freshness need); this helper is patterned after that
 * one's bounded-insert SHAPE only, not its eviction direction. Generalized to carry an
 * optional `extra` payload alongside the sort key (DUR-H recovery needs the derived
 * target basename, not just the temp's own name). Small capacity (<=256) keeps the
 * O(capacity) shift-insert negligible.
 */
function insertBoundedCandidate(list, key, extra, capacity) {
  let i = list.length;
  list.push([key, extra]);
  while (i > 0 && list[i - 1][0] > list[i][0]) {
    const tmp = list[i - 1];
    list[i - 1] = list[i];
    list[i] = tmp;
    i -= 1;
  }
  if (list.length > capacity) list.pop();
}

// Explicit durable-read classification (DUR-J) -- there is NO fail-open fallback. A
// read of any no-clobber-/replace-published record resolves to EXACTLY one of:
//   ABSENT  -- ENOENT at the initial open ONLY (genuinely not there yet).
//   PENDING -- the ONE recognized in-flight window, nlink==2 (an owner-tagged temp
//              still hard-linked); meaningful only inside a bounded poll.
//   PRESENT -- a durable regular file, fd-bound, identity-stable, parsed + shape-valid.
// Everything else -- symlink, wrong owner/mode, oversize, nlink>2, malformed JSON,
// wrong shape, identity drift, path rebound, short read -- THROWS (STOP); it is NEVER
// downgraded to ABSENT nor silently skipped.
const DURABLE_ABSENT = 'ABSENT';
const DURABLE_PENDING = 'PENDING';
const DURABLE_PRESENT = 'PRESENT';

/**
 * DUR-J (PLAN.md ~L679-683): the ONE fd-bound durable classifier. EVERY authoritative
 * read of a no-clobber-/replace-published record funnels through here so no reader can
 * be fooled by the transient nlink==2 window, a symlink swap, an other-writable
 * (tamperable) artifact, an oversized file, malformed/wrong-shape content, or an inode
 * substitution mid-read. It is deliberately NOT `assertDurable(path)` + a separate
 * `readFileSync(path)`: that pair re-resolves the path twice, a TOCTOU gap.
 *
 * Sequence (all against ONE fd): open `O_RDONLY|O_NOFOLLOW` -> fstat -> regular file
 * -> owner-confined (uid) -> EXACT owner-only 0600 (POSIX; matches the write-side
 * discipline exactly -- 0644/0444/etc. are rejected SECURITY_INVALID, not merely "no
 * group/other write") -> nlink (==2 PENDING, >2 STOP) -> size bound -> read(fd) ->
 * re-fstat dev/ino/nlink/size stable -> [immutablePath] re-lstat the path still names
 * that inode -> [parse+shape] parse JSON and run the caller's closed-shape check.
 * `immutablePath` defaults TRUE -- every immutable no-clobber record is path-identity-
 * checked; the sole exception is the mutable active-lease/presence (caller passes
 * immutablePath:false), whose in-place replace is serialized by the transition lock
 * instead.
 */
function classifyDurableRead(artifactPath, policy) {
  policy = policy || {};
  const maxSize = policy.maxSize === undefined ? DEFAULT_MAX_DURABLE_ARTIFACT_BYTES : policy.maxSize;
  const immutablePath = policy.immutablePath === undefined ? true : policy.immutablePath;
  // DUR-J item 6: a MUTABLE read (immutablePath:false -- the active-lease/presence
  // exception, which forgoes the path-identity check because the record is replaced in
  // place) is trustworthy ONLY under an authentic transition-lock token for this same
  // txnDir. Without one an unlocked reader could observe a half-completed replace, so a
  // mutable read that is not proven to hold the lock is rejected outright.
  if (immutablePath === false && !isValidLockTokenFor(policy.lockToken, artifactPath)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a mutable (immutablePath:false) durable read requires an authentic transition-lock token for this txnDir: ' + artifactPath);
  }
  const isPosix = process.platform !== 'win32';
  let fd;
  try {
    fd = fs.openSync(artifactPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { state: DURABLE_ABSENT };
    if (err && err.code === 'ELOOP') {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is a symlink (rejected at open): ' + artifactPath);
    }
    throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact could not be opened no-follow: ' + artifactPath + ' (' + (err && err.code) + ')');
  }
  try {
    const st1 = fs.fstatSync(fd, { bigint: true });
    if (!statIsRegularFile(st1)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not a regular file: ' + artifactPath);
    }
    if (isPosix && typeof process.getuid === 'function' && st1.uid !== BigInt(process.getuid())) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact is not owner-confined: ' + artifactPath);
    }
    // EXACT owner-only 0600 for authoritative records (POSIX), matching the real writer;
    // 0644/0444/etc. are rejected. Windows ACL/SID confinement is PENDING_CI, not GREEN local.
    if (isPosix && (st1.mode & 0o777n) !== 0o600n) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'artifact mode is not owner-only 0600: ' + artifactPath);
    }
    if (st1.nlink === 2n) {
      // The single recognized in-flight window. A poll treats PENDING as "keep waiting";
      // every one-shot wrapper converts it to a DURABILITY_UNPROVEN STOP.
      return { state: DURABLE_PENDING };
    }
    if (st1.nlink !== 1n) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact nlink=' + st1.nlink + ' is not a recognized durable/in-flight state: ' + artifactPath);
    }
    if (st1.size > BigInt(maxSize)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact exceeds max durable size (' + st1.size + '>' + maxSize + '): ' + artifactPath);
    }
    injectReadMutationFault(artifactPath);
    const bytes = readAllFromFd(fd, Number(st1.size) + 1);
    if (BigInt(bytes.length) !== st1.size) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact read length (' + bytes.length + ') != size snapshot (' + st1.size + '): ' + artifactPath);
    }
    const st2 = fs.fstatSync(fd, { bigint: true });
    // Reject ANY drift across the read -- same-inode rewrite (ctime/mtime), chmod (mode),
    // added hardlink (nlink), growth (size), owner change. PRESENT requires the LAST snapshot
    // still be a single-link (nlink==1) inode identical to the first.
    if (st2.dev !== st1.dev || st2.ino !== st1.ino || st2.nlink !== st1.nlink || st2.size !== st1.size || st2.mode !== st1.mode || st2.uid !== st1.uid || st2.gid !== st1.gid || st2.ctimeNs !== st1.ctimeNs || st2.mtimeNs !== st1.mtimeNs) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact identity changed during read (rewrite/chmod/hardlink/growth): ' + artifactPath);
    }
    if (st2.nlink !== 1n) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact nlink!=1 in the final snapshot: ' + artifactPath);
    }
    if (immutablePath) {
      let lst;
      try {
        lst = fs.lstatSync(artifactPath, { bigint: true });
      } catch (err) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact path vanished after read: ' + artifactPath);
      }
      if (lst.dev !== st1.dev || lst.ino !== st1.ino || lst.nlink !== st1.nlink || lst.size !== st1.size || lst.mode !== st1.mode || lst.uid !== st1.uid || lst.gid !== st1.gid || lst.ctimeNs !== st1.ctimeNs || lst.mtimeNs !== st1.mtimeNs) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact path rebound or invariants changed after read: ' + artifactPath);
      }
    }
    let obj;
    if (policy.parse || policy.shape) {
      obj = parseJsonOrSchemaInvalid(bytes);
      if (policy.shape) policy.shape(obj, artifactPath);
    }
    return { state: DURABLE_PRESENT, bytes: bytes, obj: obj };
  } finally {
    try { fs.closeSync(fd); } catch (e) { /* already closed */ }
  }
}

/** One-shot STOP for the nlink==2 in-flight window (a caller with no wait budget). */
function pendingDurableStop(artifactPath) {
  return new CliError('INVALID', 'DURABILITY_UNPROVEN', 'artifact in the nlink==2 in-flight window, not yet durable: ' + artifactPath);
}
function absentDurableStop(artifactPath, policy) {
  const e = new CliError('INVALID', policy.absentDetail || 'SCHEMA_INVALID', policy.absentMessage || ('artifact not found: ' + artifactPath));
  e.durableAbsent = true;
  return e;
}

/** Required fd-bound durable read (bytes): throws on absent (absentDetail) or PENDING. */
function readDurableBytes(artifactPath, policy) {
  policy = policy || {};
  const r = classifyDurableRead(artifactPath, policy);
  if (r.state === DURABLE_ABSENT) throw absentDurableStop(artifactPath, policy);
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
  return r.bytes;
}

/** Optional fd-bound durable read (bytes): null IFF genuinely absent; PENDING STOPs. */
function readDurableBytesOptional(artifactPath, policy) {
  const r = classifyDurableRead(artifactPath, policy || {});
  if (r.state === DURABLE_ABSENT) return null;
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
  return r.bytes;
}

/** Required fd-bound durable JSON read (parsed + optional closed-shape check). */
function readJsonDurable(artifactPath, policy) {
  policy = Object.assign({ parse: true }, policy || {});
  const r = classifyDurableRead(artifactPath, policy);
  if (r.state === DURABLE_ABSENT) throw absentDurableStop(artifactPath, policy);
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
  return r.obj;
}

/** Optional fd-bound durable JSON read: null IFF genuinely absent; PENDING STOPs. */
function readJsonDurableOptional(artifactPath, policy) {
  policy = Object.assign({ parse: true }, policy || {});
  const r = classifyDurableRead(artifactPath, policy);
  if (r.state === DURABLE_ABSENT) return null;
  if (r.state === DURABLE_PENDING) throw pendingDurableStop(artifactPath);
  return r.obj;
}

/**
 * DUR-J item 6: required fd-bound durable read returning the ACCREDITED bytes + parsed obj +
 * content digest from ONE read, so no caller ever re-hashes a coordination record by path
 * (`sha256File` on a record is a TOCTOU + a second unaccredited read). Absence and PENDING
 * (nlink==2) STOP exactly like readDurableBytes.
 */
function readDurableRecord(artifactPath, policy) {
  const bytes = readDurableBytes(artifactPath, policy);
  return { bytes: bytes, obj: parseJsonOrSchemaInvalid(bytes), digest: sha256Buffer(bytes) };
}

/**
 * Section 4 (transactional boundaries): required fd-bound durable record read +
 * CLOSED-SHAPE enforcement in ONE call -- {obj, bytes, digest} from the same
 * accredited read, with `obj` proven to be a well-formed instance of `fieldDefs`
 * before any caller trusts its fields. A parsed-but-unvalidated record (durable,
 * but with a missing/wrong-typed/extra field) must never drive a transactional
 * decision or be woven into a NEW authoritative record's fields.
 */
function readClosedRecord(artifactPath, fieldDefs, policy) {
  const rec = readDurableRecord(artifactPath, policy);
  assertClosedShape(rec.obj, fieldDefs);
  return rec;
}

/** Optional variant of `readClosedRecord`: null IFF genuinely absent; PENDING/shape-invalid still STOP. */
function readClosedRecordOptional(artifactPath, fieldDefs, policy) {
  const bytes = readDurableBytesOptional(artifactPath, policy);
  if (bytes === null) return null;
  const obj = parseJsonOrSchemaInvalid(bytes);
  assertClosedShape(obj, fieldDefs);
  return { bytes: bytes, obj: obj, digest: sha256Buffer(bytes) };
}

// Section 7 (DUR-H recovery): the EXACT, closed grammar for a no-clobber owner-tagged
// temp -- `.{target-basename}.{pid}.{16-lowercase-hex}.tmp-owner`, byte-for-byte
// matching publishNoClobber's own construction. Deliberately excludes
// `.refresh-tmp-owner` (publishReplace's own, unrelated naming scheme): a mutable-
// lease refresh temp is NEVER a valid nlink==2 no-clobber recovery companion --
// publishReplace renames, it never hard-links.
const NOCLOBBER_TEMP_RE = /^\.(.+)\.(\d+)\.([0-9a-f]{16})\.tmp-owner$/;

// Codex P1-3/round-2 blocker 1: outcomes that mean "a plausibly-genuine temp of ours
// was found but could NOT be accredited as safely not-ours, and either was not
// destructively touched (a genuine stray/pair reported 'unlink-unsafe' -- no portable
// primitive can prove a path-based unlink targets the fd-accredited inode) or could
// not even be characterized ('ambiguous'/'drift'/'failed')" -- all four are
// indistinguishable at the CALLER's level (`cmdCleanup`): each means the directory
// could not be fully reconciled and must propagate as DURABILITY_UNPROVEN, never a
// silent SUCCESS.
// Codex NO-GO round 2, blocker 1: 'unlink-unsafe' (a genuinely-proven stray/crash-cut
// pair that reconcile deliberately does NOT delete) is a FAILURE from cmdCleanup's own
// perspective -- the target remains non-durable (nlink==2, reader-rejected) or the
// stray remains on disk, and cleanup could not complete its job, even though nothing
// is ambiguous/corrupted/malfunctioning about what was found.
const RECONCILE_FAILURE_STATUSES = new Set(['ambiguous', 'drift', 'failed', 'unlink-unsafe']);

/**
 * Reconciles leftover no-clobber temp siblings in one directory. Only entries
 * matching the EXACT production no-clobber temp grammar are ever touched; the
 * target basename is DERIVED from that name, never inferred by a generic inode
 * scan (Section 7: "expected.json" can never be paired with "malicious.json"
 * merely because the two happen to be inode-linked). Never touches non-temp
 * files (terminal records are never at risk -- `TERMINAL-NO-DELETE-01`).
 *
 * Codex P1-3: returns an EXPLICIT `{ok, results}` outcome rather than void -- `ok` is
 * false iff ANY matched temp resolved to `RECONCILE_FAILURE_STATUSES`, so `cmdCleanup`
 * can propagate ambiguity/drift/failure as DURABILITY_UNPROVEN instead of always
 * reporting SUCCESS regardless of what reconciliation actually found. A directory that
 * genuinely does not exist yet (ENOENT -- e.g. this transaction never had a `claims/`
 * or `delivery/` subdirectory) is NOT a failure; any OTHER enumeration error (EACCES,
 * ENOTDIR, ...) is, mirroring `listResultFiles`'s own ENOENT-vs-other-errors split.
 *
 * Codex gap #2 / NO-GO round 2 blocker 4: `MAX_ENUM_HARD_CAP`/`MAX_ENUM_KEPT_ENTRIES`
 * bound this scan the same way `listResultFiles` is bounded -- an implausibly large
 * directory, or more grammar-matching temp candidates than can be safely processed,
 * fails closed ('failed'/'ambiguous') rather than silently scanning or promoting only
 * a subset while claiming the directory was fully accounted for. The hard cap is
 * enforced via a TRUE streaming `opendirSync`/`readSync` cutoff (never materializing
 * more than `MAX_ENUM_HARD_CAP` dirents at once) -- the prior `readdirSync()` fully
 * materialized the directory into memory BEFORE checking its length, which bounded
 * downstream processing but not the scan/allocation itself.
 */
function reconcileTempArtifacts(dirPath) {
  let dirHandle;
  try {
    dirHandle = fs.opendirSync(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, results: [] };
    return { ok: false, results: [{ status: 'failed', reason: 'directory could not be enumerated: ' + (err && err.code) }] };
  }
  const matched = []; // ascending-sorted [tempName, targetBasename] pairs, bounded to MAX_ENUM_KEPT_ENTRIES
  let totalSeen = 0;
  let matchedCount = 0;
  let hardCapExceeded = false;
  try {
    let entry = dirHandle.readSync();
    while (entry !== null) {
      totalSeen += 1;
      if (totalSeen > MAX_ENUM_HARD_CAP) {
        hardCapExceeded = true;
        break; // abort without inspecting this or any further entry
      }
      const m = NOCLOBBER_TEMP_RE.exec(entry.name);
      if (m) {
        matchedCount += 1;
        insertBoundedCandidate(matched, entry.name, m[1], MAX_ENUM_KEPT_ENTRIES);
      }
      entry = dirHandle.readSync();
    }
  } catch (err) {
    return { ok: false, results: [{ status: 'failed', reason: 'directory enumeration failed mid-scan: ' + (err && err.code) }] };
  } finally {
    try { dirHandle.closeSync(); } catch (e) { /* best-effort close */ }
  }
  if (hardCapExceeded) {
    return { ok: false, results: [{ status: 'failed', reason: 'directory exceeds the max scanned-entry bound (>' + MAX_ENUM_HARD_CAP + ')' }] };
  }
  if (matchedCount > MAX_ENUM_KEPT_ENTRIES) {
    return { ok: false, results: [{ status: 'ambiguous', reason: 'directory has more matching temp candidates than the max kept bound (' + matchedCount + '>' + MAX_ENUM_KEPT_ENTRIES + ')' }] };
  }
  const results = matched.map(([entry, targetBasename]) => reconcileOneNoClobberTemp(dirPath, entry, targetBasename));
  const ok = results.every((r) => !RECONCILE_FAILURE_STATUSES.has(r.status));
  return { ok, results };
}

/**
 * DUR-H recovery for exactly one production-named no-clobber temp. Codex NO-GO round
 * 2 (blocker 1): this function performs NO destructive unlink at all, in EITHER the
 * nlink==1 (stray) or nlink==2 (crash-cut pair) case -- no portable primitive can
 * prove a path-based `unlinkSync` targets the SAME inode an earlier `fstatSync(tfd)`
 * accredited (an fd's fstat is invariant to what its path currently names, so it
 * cannot detect a path rebind; Codex proved even a path-based lstat immediately
 * before the unlink does not close that race). It instead proves as much as it
 * safely can -- temp genuineness, and for a pair, companion genuineness + byte
 * identity + mid-read stability -- and then STOPs, reporting what it found rather
 * than acting on it. The temp's own fd is kept open through the complete decision
 * (never re-resolved by path mid-decision).
 *
 * Codex P1-3/round-2/round-3: returns an EXPLICIT `{status, reason}` outcome instead
 * of a bare `return` (void) at every branch -- `status` is one of:
 *   'skip'          -- genuinely not ours (temp gone/symlink/wrong-owner/wrong-mode):
 *                       benign, no failure to report.
 *   'unlink-unsafe' -- a genuine nlink==1 stray, OR a genuine nlink==2 crash-cut pair
 *                       (companion proven, bytes matched, identity stable) -- fully
 *                       identified and durably confirmed, but deliberately NOT
 *                       auto-deleted/promoted (see this function's own reasoning
 *                       above). A FAILURE from `cmdCleanup`'s perspective: it could
 *                       not complete reconciliation, even though nothing is
 *                       ambiguous or malfunctioning about what it found.
 *   'ambiguous'     -- a plausibly-genuine temp whose companion does not resolve/
 *                       validate as the exact expected pair (Codex: "ambigüedad"),
 *                       or whose own nlink is >2 (not a recognized no-clobber state).
 *   'drift'         -- genuine temp+companion, but metadata/bytes changed mid-read
 *                       (Codex: "drift").
 *   'failed'        -- an anomalous I/O error (EACCES/EIO/...) on a temp/companion
 *                       that otherwise matches our exact grammar -- never folded into
 *                       a benign skip (Codex NO-GO round 2, blocker 2).
 */
/**
 * Codex NO-GO round 2, blocker 1: `reconcileOneNoClobberTemp` NEVER destructively
 * unlinks `tempPath` -- neither for a genuine nlink==1 stray nor to complete a genuine
 * nlink==2 crash-cut recovery. `fstatSync(tfd)` accredits the OPEN inode, but a
 * subsequent `unlinkSync(tempPath)` is inherently PATH-based (POSIX has no
 * `funlinkat`-style primitive, and Node's `fs` module exposes none either): nothing
 * proves `tempPath` still names that SAME inode at the moment the unlink executes.
 * Empirically reproduced: an attacker renames the accredited original away and plants
 * a substitute at the identical path between the last check and the unlink -- the
 * SUBSTITUTE gets deleted, not the accredited original, which is left moved/orphaned
 * elsewhere, while the stray-removal path still reported SUCCESS. Re-fstat-ing the
 * SAME already-open fd immediately before the unlink (this function's own PRIOR
 * attempt at closing this gap) does not help: an fd's fstat is invariant to what its
 * path currently names, so that check can structurally never detect a path rebind. A
 * path-based `lstat(tempPath)` immediately before the unlink narrows but does not
 * close the window either -- PLAN.md permits recovery to delete once it PROVES
 * durability; it does not require deletion. This function therefore proves as much as
 * it safely can (temp genuineness, companion genuineness, byte-identity, stability)
 * and then STOPs rather than performing an unlink no available primitive can bind to
 * the accredited inode.
 */
function reconcileOneNoClobberTemp(dirPath, tempName, targetBasename) {
  const tempPath = path.join(dirPath, tempName);
  const isPosix = process.platform !== 'win32';
  let tfd;
  try {
    tfd = fs.openSync(tempPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    // Codex NO-GO round 2, blocker 2: only a genuinely ABSENT temp (ENOENT) or a
    // symlink at the temp's own name (ELOOP -- O_NOFOLLOW rejected it; there is
    // nothing further this function COULD inspect or act on) is a benign skip. Any
    // OTHER open failure (EACCES, EIO, EMFILE, ...) is an anomaly on a path matching
    // our own production grammar and must propagate, never be folded into "not ours".
    if (err && err.code === 'ENOENT') return { status: 'skip', reason: 'temp gone' };
    if (err && err.code === 'ELOOP') return { status: 'skip', reason: 'temp path is a symlink (rejected at open, O_NOFOLLOW)' };
    return { status: 'failed', reason: 'temp open failed unexpectedly (' + (err && err.code) + ')' };
  }
  try {
    // 1. Prove the temp itself is a genuine owner-owned, EXACT owner-only 0600 REGULAR
    //    file. Wrong owner/mode is not ours -- leave it untouched (never auto-reclaim
    //    by age). nlink>2 (Codex blocker 2) is NOT a recognized no-clobber state for
    //    a temp that otherwise matches our exact naming grammar -- that is an anomaly,
    //    not a benign skip, and must propagate.
    let tst;
    try {
      if (isReconcileTempFstatFaultActive()) {
        const injected = new Error('injected reconcile temp-fstat failure (RUNTIME_CONSULTATION_FAULT_RECONCILE_TEMP_FSTAT)');
        injected.code = 'EIO';
        throw injected;
      }
      tst = fs.fstatSync(tfd, { bigint: true });
    } catch (err) {
      // Codex gap #4 (round 1): an fstat failing on an fd we JUST successfully opened
      // (proving the temp exists and is not a symlink) is an anomaly, not "genuinely
      // not ours" -- unlike a wrong-owner/wrong-mode temp (a definite skip), this
      // cannot be characterized as safe to ignore, so it is a FAILURE that must
      // propagate.
      return { status: 'failed', reason: 'temp fstat failed' };
    }
    if (!statIsRegularFile(tst)) return { status: 'skip', reason: 'temp is not a regular file' };
    if (tst.nlink > 2n) return { status: 'failed', reason: 'temp nlink>2 is not a recognized no-clobber state' };
    const ownerOk = !isPosix || typeof process.getuid !== 'function' || tst.uid === BigInt(process.getuid());
    const modeOk = !isPosix || (tst.mode & 0o777n) === 0o600n;
    if (!ownerOk || !modeOk) return { status: 'skip', reason: 'temp is not owner-confined exact-0600' };

    // Codex gap: a byte-size bound BEFORE any size-derived read/allocation below (mirrors
    // classifyDurableRead's own DEFAULT_MAX_DURABLE_ARTIFACT_BYTES bound) -- a temp
    // claiming an implausible size is ambiguous, never trusted enough to size an
    // allocation from.
    if (tst.size > BigInt(DEFAULT_MAX_DURABLE_ARTIFACT_BYTES)) {
      return { status: 'ambiguous', reason: 'temp exceeds max durable size' };
    }

    if (tst.nlink === 1n) {
      // A genuine stray (crash before linkSync, or after the target's unlink): not
      // hard-linked to anything, so it is not blocking any target's promotion. Report
      // it as PROVEN-but-not-removed -- see the function's own doc comment for why a
      // path-based unlink here can never be proven to target this accredited inode.
      return { status: 'unlink-unsafe', reason: 'genuine stray temp identified but not auto-removed (no fd-bound unlink primitive)' };
    }

    // 2. nlink === 2: DUR-H recovery. Open the EXACT same-directory target DERIVED from
    //    the temp's own encoded name -- never any other name, and never merely "some
    //    inode-linked file" (an inode match to a WRONGLY-named file is ambiguity/attack,
    //    not a companion).
    const targetPath = path.join(dirPath, targetBasename);
    let xfd;
    try {
      xfd = fs.openSync(targetPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    } catch (err) {
      return { status: 'ambiguous', reason: 'no companion at the derived target path (or it is a symlink)' };
    }
    try {
      let xst;
      try {
        xst = fs.fstatSync(xfd, { bigint: true });
      } catch (err) {
        return { status: 'ambiguous', reason: 'companion fstat failed' };
      }
      // Exact dev/ino relationship (the SAME inode the temp is linked to -- a genuinely
      // separate file that merely happens to share a name is rejected here), regular
      // file, owner, EXACT 0600, nlink==2 (its only two links are this temp and this
      // target -- a second link outside this directory would leave some OTHER file
      // owning the "real" companion role, so dev/ino already fails to match here).
      if (
        xst.dev !== tst.dev || xst.ino !== tst.ino
        || !statIsRegularFile(xst) || xst.nlink !== 2n
        || (isPosix && typeof process.getuid === 'function' && xst.uid !== BigInt(process.getuid()))
        || (isPosix && (xst.mode & 0o777n) !== 0o600n)
      ) {
        return { status: 'ambiguous', reason: 'derived target is not the temp\'s exact genuine companion' };
      }
      if (xst.size > BigInt(DEFAULT_MAX_DURABLE_ARTIFACT_BYTES)) {
        return { status: 'ambiguous', reason: 'companion exceeds max durable size' };
      }
      // Bounded identical bytes/digest between temp and target, both fd-bound from the
      // two already-open, already-identity-proven descriptors -- proves the content a
      // reader would see is exactly what a completed recovery would have promoted. The
      // fault seam mirrors classifyDurableRead's own mid-read mutation hook, positioned
      // BEFORE the read so a live drift (chmod/rewrite/hardlink/grow/rebind) is
      // reflected in the bytes read AND is still caught by the stability re-fstat
      // immediately below.
      injectReadMutationFault(targetPath);
      const tempBytes = readAllFromFd(tfd, Number(tst.size) + 1);
      const targetBytes = readAllFromFd(xfd, Number(xst.size) + 1);
      if (tst.size !== xst.size || Buffer.compare(tempBytes, targetBytes) !== 0) {
        return { status: 'ambiguous', reason: 'temp/target byte mismatch' }; // a temp encoding one target's name cannot be paired with different bytes
      }
      // Stability re-check: the target's identity must be UNCHANGED across the read
      // above (same discipline as classifyDurableRead's own st1-vs-st2 comparison) --
      // catches a drift whose byte-for-byte content still happened to compare equal
      // (e.g. a same-inode rewrite or an added hardlink).
      let xst1b;
      try {
        xst1b = fs.fstatSync(xfd, { bigint: true });
      } catch (err) {
        return { status: 'ambiguous', reason: 'companion re-fstat failed' };
      }
      if (
        xst1b.dev !== xst.dev || xst1b.ino !== xst.ino || xst1b.nlink !== xst.nlink
        || xst1b.size !== xst.size || xst1b.mode !== xst.mode || xst1b.uid !== xst.uid
        || xst1b.gid !== xst.gid || xst1b.ctimeNs !== xst.ctimeNs || xst1b.mtimeNs !== xst.mtimeNs
      ) {
        return { status: 'drift', reason: 'companion identity drifted mid-read' }; // never promoted on stale metadata
      }
      // The genuine crash-cut pair IS now durably confirmed (companion proven, bytes
      // matched, identity stable) -- but per this function's own doc comment, recovery
      // reports it rather than performing the unlink no available primitive can prove
      // targets this accredited inode.
      return { status: 'unlink-unsafe', reason: 'genuine crash-cut pair identified but not auto-completed (no fd-bound unlink primitive)' };
    } finally {
      try { fs.closeSync(xfd); } catch (e) { /* already closed */ }
    }
  } finally {
    try { fs.closeSync(tfd); } catch (e) { /* already closed */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transition lock (exclusive mkdir .lock/, bounded wait, never age-reclaimed)
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_MAX_WAIT_MS = 1200;
const LOCK_POLL_MS = 40;

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

const RENDEZVOUS_MAX_WAIT_MS = 5000;
const RENDEZVOUS_POLL_MS = 20;

/**
 * Section 4 (six deterministic interleavings): capability-gated rendezvous, NOT a
 * timing sleep. When `RUNTIME_CONSULTATION_TEST_RENDEZVOUS===name` under the test
 * capability, writes a durable "-ready" sentinel under `txnDir` then polls (bounded)
 * for a "-go" sentinel before returning -- letting a bats test deterministically run a
 * SECOND process's complete operation between two exact points inside THIS one (e.g.
 * "claim published, about to acquire the lock"), rather than guessing at a race with
 * sleeps. Throws if the "-go" sentinel never appears within the bound (a hung
 * rendezvous must fail loud, never hang the test suite). Inert (immediate no-op)
 * whenever the named rendezvous point is not the one under test.
 */
function testRendezvous(txnDir, name) {
  if (!isTestCapability()) return;
  if (process.env.RUNTIME_CONSULTATION_TEST_RENDEZVOUS !== name) return;
  const readyPath = path.join(txnDir, '.rendezvous-' + name + '-ready');
  const goPath = path.join(txnDir, '.rendezvous-' + name + '-go');
  fs.writeFileSync(readyPath, String(process.pid));
  const start = Date.now();
  while (!fs.existsSync(goPath)) {
    if (Date.now() - start >= RENDEZVOUS_MAX_WAIT_MS) {
      throw new Error('test rendezvous "' + name + '" timed out waiting for the -go sentinel');
    }
    sleepSync(RENDEZVOUS_POLL_MS);
  }
}

// An opaque, unforgeable transition-lock token. ONLY acquireLock mints one (a fresh
// object carrying this private brand + the bound txnDir); a forged plain object, or a
// token minted for a DIFFERENT txnDir, is rejected by isValidLockTokenFor.
// DUR-J item 2: a transition-lock token is an OPAQUE, frozen, empty object. ALL of its
// authority lives in this module-private WeakMap -- nothing is observable on the token, so
// it cannot be forged (a plain/cloned object is simply absent from the map), mutated
// (frozen, no metadata), or replayed after release (`active` flips false). The record binds
// the canonical txnDir/lockDir plus the .lock directory's dev/ino at acquisition, so a
// later use can prove the SAME directory still stands (a deleted+recreated .lock differs).
const lockRegistry = new WeakMap();

// DUR-J item 3: errors that POISON the lock (a publishReplace past the rename that could not
// be proven durable) are marked in a private WeakSet -- an unforgeable flag a caller cannot
// set on an arbitrary error to trick withLock into orphaning the lock.
const poisonedErrors = new WeakSet();
function markPoisoned(err) { poisonedErrors.add(err); return err; }
function isPoisoned(err) { return !!err && poisonedErrors.has(err); }

/** Canonical containment: `artifactPath` is `base` itself or strictly beneath it (no `..`, no sibling-prefix). */
function isPathWithin(base, artifactPath) {
  const rel = path.relative(base, path.resolve(artifactPath));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * True iff `token` is a LIVE, authentic transition-lock token authorizing a read of
 * `artifactPath` under its txnDir. Proves: registered (not a plain/cloned/mutated object),
 * still active (not released), `artifactPath` canonically contained in the token's txnDir,
 * AND the on-disk .lock is still the SAME directory (dev/ino) the token was minted for (a
 * deleted+recreated lock is rejected).
 */
function isValidLockTokenFor(token, artifactPath) {
  if (!token || typeof token !== 'object') return false;
  const rec = lockRegistry.get(token);
  if (!rec || rec.active !== true) return false;
  if (!isPathWithin(rec.canonicalTxnDir, artifactPath)) return false;
  let st;
  try {
    st = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
  } catch (err) {
    return false; // the .lock we hold is gone -> the token no longer proves exclusion.
  }
  return st.isDirectory() && st.dev === rec.lockDev && st.ino === rec.lockIno;
}

/**
 * Exclusive `mkdir` of `.lock/`; bounded wait; never age-reclaimed (an orphaned lock is
 * never unblocked by its age alone -- `LOCK-ORPHAN-01`). Times out with CliError(TIMEOUT)
 * rather than hanging or inferring staleness. DUR-J item 5: the lock is a DURABLE
 * in-progress signal -- ORDER is mkdir(.lock) -> fsync(txnDir); the parent barrier is
 * proven BEFORE a usable token is minted. If that barrier cannot be proven, the .lock is
 * LEFT in place as a durable/unproven orphan (a later actor times out + STOPs, never
 * silently reclaims it) and acquisition fails closed with DURABILITY_UNPROVEN.
 */
function acquireLock(txnDir) {
  const canonicalTxnDir = path.resolve(txnDir);
  const lockDir = path.join(canonicalTxnDir, '.lock');
  fs.mkdirSync(canonicalTxnDir, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start >= LOCK_MAX_WAIT_MS) {
        throw new CliError('TIMEOUT', 'DEADLINE_EXCEEDED', 'transition lock acquisition timed out: ' + lockDir);
      }
      sleepSync(LOCK_POLL_MS);
      continue;
    }
    // mkdir succeeded -> prove the acquisition barrier (mkdir precedes fsync by construction).
    if (!fsyncDir(canonicalTxnDir, 'lock-acquire')) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock acquisition barrier could not be proven durable; .lock retained as a durable orphan: ' + lockDir + fsyncDirCauseSuffix());
    }
    let st;
    try {
      st = fs.lstatSync(lockDir, { bigint: true });
    } catch (err) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory could not be stat-verified after acquisition: ' + lockDir);
    }
    if (!st.isDirectory()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'transition lock path is not a directory after acquisition: ' + lockDir);
    }
    const token = Object.freeze({});
    lockRegistry.set(token, {
      canonicalTxnDir: canonicalTxnDir,
      canonicalLockDir: lockDir,
      lockDev: st.dev, // BigInt
      lockIno: st.ino, // BigInt
      active: true,
    });
    return token;
  }
}

/**
 * DUR-J item 8: NOT best-effort, and runs ONLY on a COMPLETE operation. Order is
 * rmdir(.lock) -> fsync(txnDir). An rmdir failure retains the lock and STOPs. A
 * removal-barrier failure reports DURABILITY_UNPROVEN: a crash could resurrect the .lock,
 * but that only makes a later actor timeout + STOP -- never unsafe acceptance.
 */
function releaseLock(lockToken) {
  // AUTHENTICATE the token BEFORE any disk mutation: a plain / cloned / mutated / stale
  // (already-released) / wrong-txn / double-release token is rejected with NO filesystem
  // change -- a forged release can never remove a directory.
  const rec = (lockToken && typeof lockToken === 'object') ? lockRegistry.get(lockToken) : undefined;
  if (!rec || rec.active !== true) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'releaseLock called with a non-authentic or already-released transition-lock token (no filesystem change made)');
  }
  // Prove the .lock we hold is still the SAME directory before removing it -- never rmdir a
  // directory that was deleted+recreated (a different inode) under us.
  let st;
  try {
    st = fs.lstatSync(rec.canonicalLockDir, { bigint: true });
  } catch (err) {
    rec.active = false;
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory vanished before release: ' + rec.canonicalLockDir);
  }
  if (!st.isDirectory() || st.dev !== rec.lockDev || st.ino !== rec.lockIno) {
    rec.active = false;
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock directory identity changed before release: ' + rec.canonicalLockDir);
  }
  // Identity authenticated -> REVOKE the token NOW, BEFORE the effective removal. If rmdir
  // (or the barrier) then fails, the .lock is left orphan AND the token is already inactive,
  // so a stale-token replay is rejected rather than appearing to still hold a lock that is
  // (or is about to be) gone.
  rec.active = false;
  try {
    if (isLockRmdirFaultActive()) {
      const injected = new Error('injected lock rmdir failure (RUNTIME_CONSULTATION_FAULT_LOCK_RMDIR)');
      injected.code = 'EIO';
      throw injected;
    }
    fs.rmdirSync(rec.canonicalLockDir);
  } catch (err) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock release rmdir failed; lock retained (token revoked): ' + rec.canonicalLockDir);
  }
  if (!fsyncDir(rec.canonicalTxnDir, 'lock-release')) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'transition lock release barrier could not be proven durable: ' + rec.canonicalLockDir + fsyncDirCauseSuffix());
  }
}

/**
 * Runs `fn(lockToken)` under the durable transition lock. The token is threaded to inner
 * readers (item 6 reentrancy) so a lease read under the lock never re-acquires -> deadlock.
 * A COMPLETE run releases the lock durably (item 8). A CLEAN failure (validation/authority,
 * or a PRE_RENAME publishReplace error) releases the lock so the txn is not wedged, then
 * re-throws. A POISONED failure (`err.lockPoisoned` -- a publishReplace that reached
 * POST_RENAME_UNPROVEN) LEAVES the .lock as a durable orphan so every later actor times
 * out + STOPs and never accepts the half-replaced record (item 7).
 */
function withLock(txnDir, fn) {
  const lockToken = acquireLock(txnDir);
  let result;
  try {
    result = fn(lockToken);
  } catch (err) {
    if (isPoisoned(err)) throw err; // POST_RENAME_UNPROVEN etc. -> retain .lock as a durable orphan.
    // Clean failure: release the lock so the txn is not wedged. If release ALSO fails, its
    // DURABILITY_UNPROVEN is primary (a stuck/unproven lock is the more urgent fact) and the
    // original cause is preserved for diagnosis.
    try {
      releaseLock(lockToken);
    } catch (releaseErr) {
      releaseErr.cause = err;
      throw releaseErr;
    }
    throw err;
  }
  releaseLock(lockToken);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic closed-shape schema validation (additionalProperties:false everywhere)
// ─────────────────────────────────────────────────────────────────────────────

function readArtifactBytes(artifactPath) {
  try {
    return fs.readFileSync(artifactPath);
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'cannot read artifact: ' + artifactPath);
  }
}

function parseJsonOrSchemaInvalid(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact is not valid JSON');
  }
}

/**
 * Validates `obj` against a closed field-shape definition: every key in `obj`
 * must be a known field (additionalProperties:false), every field marked
 * `required !== false` must be present, and every present field must pass its
 * own `check(value, wholeObject)` predicate. Throws SCHEMA_INVALID otherwise.
 */
function assertClosedShape(obj, fieldDefs) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'artifact is not a JSON object');
  }
  const allowedKeys = Object.keys(fieldDefs);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'unknown field: ' + key);
    }
  }
  for (const key of allowedKeys) {
    const def = fieldDefs[key];
    const present = Object.prototype.hasOwnProperty.call(obj, key);
    if (!present) {
      if (def.required !== false) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'missing required field: ' + key);
      }
      continue;
    }
    if (def.check && !def.check(obj[key], obj)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid field: ' + key);
    }
  }
}

// ── Field-check predicate library ───────────────────────────────────────────

function isString(v) { return typeof v === 'string'; }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isInteger(v) { return Number.isInteger(v); }
function isNonNegativeInteger(v) { return Number.isInteger(v) && v >= 0; }
function isBoolean(v) { return typeof v === 'boolean'; }
function orNull(check) { return (v) => v === null || check(v); }
function isHex64(v) { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v); }
function isHexId(v) { return typeof v === 'string' && HEX_ID_RE.test(v); }
function isIsoTimestamp(v) { return typeof v === 'string' && !Number.isNaN(new Date(v).getTime()); }
function isEnum(values) { return (v) => values.includes(v); }
function utf8ByteLength(s) { return Buffer.byteLength(s, 'utf8'); }
function isPlainObject(v) { return typeof v === 'object' && v !== null && !Array.isArray(v); }

function isContentRefHandle(v) {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v).sort().join(',');
  if (keys !== 'blob,digest,size') return false;
  if (!isHex64(v.blob) || !isHex64(v.digest)) return false;
  if (!Number.isInteger(v.size) || v.size < 0 || v.size > 10485760) return false;
  return true;
}

/**
 * ANSWERED/BLOCKED result content is `content` (inline, <=64KiB) XOR `content_ref`
 * (content_ref-handle, <=10MiB) -- never both, never neither, never any other key
 * (PLAN.md ~L429). This helper is applied at the whole-object level (see
 * `RESULT_V2_FIELDS`'s `status` check) rather than per-field, since it is a
 * cross-field XOR rule.
 */
function assertResultContentXor(obj) {
  const hasContent = Object.prototype.hasOwnProperty.call(obj, 'content');
  const hasRef = Object.prototype.hasOwnProperty.call(obj, 'content_ref');
  if (obj.status === 'ANSWERED') {
    if (hasContent === hasRef) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'ANSWERED requires exactly one of content/content_ref');
    }
    if (hasContent && (typeof obj.content !== 'string' || obj.content.length === 0 || utf8ByteLength(obj.content) > 65536)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid inline content');
    }
    if (hasRef && !isContentRefHandle(obj.content_ref)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'invalid content_ref handle');
    }
    if (obj.reason !== null) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'ANSWERED requires reason:null');
    }
  } else if (obj.status === 'BLOCKED') {
    if (hasContent || hasRef) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'BLOCKED must not carry content/content_ref');
    }
    if (!isEnum(['CONTENT_TOO_LARGE', 'INSUFFICIENT_CONTEXT', 'UNSUPPORTED_REQUEST', 'CONSULTATION_FAILED', 'POLICY_DENIED'])(obj.reason)) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'BLOCKED requires a valid reason enum');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// content_ref resolution -- flat content-addressed blob store, fd-bound (PLAN.md ~L640)
// ─────────────────────────────────────────────────────────────────────────────

function resolveContentRefOrThrow(planRoot, handle) {
  const blobPath = blobPathFor(planRoot, handle.blob);
  let lst;
  try {
    lst = fs.lstatSync(blobPath);
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref blob not found: ' + handle.blob);
  }
  if (!lst.isFile()) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref blob is not a regular file');
  }
  let fd;
  try {
    fd = fs.openSync(blobPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref blob path is a symlink (rejected at open time)');
    }
    throw err;
  }
  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile() || fstat.nlink !== 1) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'content_ref blob durability unproven');
    }
    if (fstat.size !== handle.size || fstat.size > 10485760) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref size mismatch/overflow');
    }
    const bytes = fs.readFileSync(fd);
    const digest = sha256Buffer(bytes);
    if (digest !== handle.digest || digest !== handle.blob) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'content_ref digest mismatch');
    }
    const fstat2 = fs.fstatSync(fd);
    if (fstat2.dev !== fstat.dev || fstat2.ino !== fstat.ino || fstat2.size !== fstat.size) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'content_ref blob identity changed during read');
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role policy -- mediated-chain guard (PLAN.md ~L668, ~L671)
// ─────────────────────────────────────────────────────────────────────────────

function assertRolePolicy(sourceRole, targetRole) {
  if (targetRole === 'context-provider' && !String(sourceRole).startsWith('arch-')) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'direct specialist -> context-provider is rejected (mediated chain)');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `consult/v2` (record #1) -- field table PLAN.md ~L272-303
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Codex NO-GO round 5: PLAN.md ~L281/~L659 freezes `max_depth` at the fixed literal
 * `2` -- it is NOT a per-request configurable ceiling. The single source of truth
 * lives here; every site that either writes or compares against the frozen nesting
 * ceiling references this constant, never a bare literal `2`.
 */
const MAX_DEPTH_LIMIT = 2;

const CONSULT_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/consult/v2' },
  request_id: { check: isHexId },
  root_request_id: { check: isHexId },
  parent_request_id: { check: orNull(isHexId) },
  depth: { check: isNonNegativeInteger },
  // Codex NO-GO round 5: was `isNonNegativeInteger` -- accepted ANY non-negative
  // integer, so a durable, otherwise-canonical record with max_depth:0 (or any value
  // != the frozen 2) passed shape validation. Combined with `cmdPublishRequest`'s own
  // `parentObj.max_depth || 2` truthy-fallback bug (0 is falsy in JS), a parent
  // carrying max_depth:0 was silently treated as max_depth:2, letting a nested publish
  // that should have been rejected succeed and mutate disk. Reproduced empirically.
  // Fixed at the source: max_depth is no longer a free-form field at all, it MUST be
  // exactly the frozen ceiling.
  max_depth: { check: (v) => v === MAX_DEPTH_LIMIT },
  source_role: { check: isNonEmptyString },
  target_role: { check: isNonEmptyString },
  target_role_profile_version: { check: isNonEmptyString },
  target_role_profile_digest: { check: isHex64 },
  requester_worktree_id: { check: isNonEmptyString },
  requester_instance_id: { check: isNonEmptyString },
  repo_id: { check: isNonEmptyString },
  wave_slug: { check: isNonEmptyString },
  protocol_profile: { check: isNonEmptyString },
  coordination_root_id: { check: isNonEmptyString },
  plan_digest: { check: isHex64 },
  subject_repo_id: { check: isNonEmptyString },
  subject_worktree_id: { check: isNonEmptyString },
  subject_head: { check: isNonEmptyString },
  subject_scope_digest: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
  question: { check: (v) => isNonEmptyString(v) && utf8ByteLength(v) <= 8192 },
  content_ref: { required: false, check: isContentRefHandle },
  expected_result_kind: { check: isNonEmptyString },
  expiry: {
    check: (v, whole) => {
      if (!isIsoTimestamp(v)) return false;
      const delta = (isoToMs(v) - isoToMs(whole.created_at)) / 1000;
      return delta >= 120 && delta <= 3600;
    },
  },
  recovery_budget: { check: isNonNegativeInteger },
  routing_policy_version: { check: isNonEmptyString },
  routing_policy_digest: { check: isHex64 },
  initial_attempt_id: { check: isHexId },
  initial_lease_epoch: { check: isNonNegativeInteger },
};

/**
 * Codex NO-GO round 3, blocker 1: the SOLE canonical way to read an authoritative
 * request.json. `readClosedRecord(..., CONSULT_V2_FIELDS, ...)` alone proves
 * durability + fd-bound identity + closed shape, but proves NOTHING about whether the
 * record's OWN embedded `request_id` matches the identity its storage location
 * implies -- a request.json's PATH and its CONTENT can silently diverge (bytes copied
 * wholesale from a genuinely durable, correctly-shaped, DIFFERENT request planted at
 * `transactions/<A>/request.json` while internally still claiming `request_id: "B"`).
 * Empirically reproduced (Codex): a shape-valid, durable, digest-matching request B
 * planted at transaction A's own path made `validate --kind inbox-ref-v1` return
 * SUCCESS. This helper closes that gap with one extra check: `obj.request_id` MUST
 * equal the caller's `expectedRequestId` (mirroring `cmdLeaseHeartbeat`'s own
 * established claim/attempt_id self-consistency check, same SECURITY_INVALID
 * detail_code -- a content/location identity mismatch is a confinement violation, not
 * a mere correlation mismatch). MECHANICAL RULE: no other `readClosedRecord(...,
 * CONSULT_V2_FIELDS, ...)` call may exist anywhere in this file -- every authoritative
 * request.json read funnels through here.
 */
function readCanonicalRequestRecord(requestPath, expectedRequestId, policy) {
  const rec = readClosedRecord(requestPath, CONSULT_V2_FIELDS, policy);
  if (rec.obj.request_id !== expectedRequestId) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'request.json content does not match its own canonical identity: ' + requestPath);
  }
  return rec;
}

/** Full `validate --kind consult-v2` pipeline: shape -> durability -> graph -> role-policy -> content_ref. */
function validateConsultV2(artifactPath, coordRoot) {
  const expectedRequestId = path.basename(path.dirname(artifactPath));
  const obj = readCanonicalRequestRecord(artifactPath, expectedRequestId, {}).obj;
  // DUR-J item 4: durability + fd-bound identity are proven inside readCanonicalRequestRecord
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);

  if (obj.content_ref) {
    resolveContentRefOrThrow(planRoot, obj.content_ref);
  }

  validateRequestGraph(obj, planRoot);
  if (obj.depth > obj.max_depth) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth exceeds max_depth');
  }
  assertRolePolicy(obj.source_role, obj.target_role);
  return obj;
}

/**
 * Root/parent/depth validation table (PLAN.md ~L659-671): root shape, nesting, cycles,
 * cross-root.
 *
 * Codex NO-GO round 4: the walk now validates EVERY edge and EVERY node it traverses,
 * not just the immediate parent's depth relationship. Empirically reproduced: a
 * "root-shaped" (parent_request_id:null, depth:0) but internally self-contradictory
 * ancestor (root_request_id != request_id) was accepted as a valid chain terminus --
 * neither `cmdPublishRequest`'s single-hop parent lookup nor this walk ever re-checked
 * the TERMINAL node's own root invariants, since that check previously lived ONLY in
 * the `obj.parent_request_id === null` branch below (which fires when the artifact
 * BEING validated is itself a root -- never when a root is merely encountered partway
 * through an ancestor walk). Fixed: (1) `parent.depth + 1 === child.depth` is now
 * checked for EVERY edge via a rolling `childObj` cursor (previously gated to the
 * first hop only, `isImmediateParent`); (2) the moment a traversed ancestor's OWN
 * `parent_request_id` is null (it is the chain's terminus), that ancestor is REQUIRED
 * to satisfy the exact same `root_request_id===request_id`/`depth===0` invariants a
 * directly-validated root would -- never silently accepted merely because the walk
 * stops there.
 */
function validateRequestGraph(obj, planRoot) {
  if (obj.parent_request_id === null) {
    if (obj.root_request_id !== obj.request_id) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root request must have root_request_id==request_id');
    }
    if (obj.depth !== 0) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'root request must have depth==0');
    }
    return;
  }
  const visited = new Set([obj.request_id]);
  let curId = obj.parent_request_id;
  let childObj = obj; // the node whose depth we are about to verify against curId's own record
  let hops = 0;
  while (curId !== null) {
    if (visited.has(curId)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id cycle detected');
    }
    visited.add(curId);
    // DUR-J: fd-bound durable read of each ancestor request -- an unresolved ancestor
    // stays CORRELATION_INVALID; an nlink==2 / symlink / foreign-owner / malformed
    // ancestor STOPs, never read raw into the topology walk. Codex NO-GO round 2
    // (blocker 3): closed-shape CONSULT_V2_FIELDS is enforced. Round 3 (blocker 1):
    // routed through readCanonicalRequestRecord -- the ancestor's OWN embedded
    // request_id must equal `curId`, never merely parsed/shape-checked and trusted.
    const parentObj = readCanonicalRequestRecord(requestPathFor(planRoot, curId), curId, {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'parent_request_id does not resolve: ' + curId,
    }).obj;
    // Codex NO-GO round 4: every edge, not only the first hop.
    if (parentObj.depth + 1 !== childObj.depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth != parent.depth + 1');
    }
    if (parentObj.root_request_id !== obj.root_request_id) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'cross-root parent linkage');
    }
    if (parentObj.parent_request_id === null) {
      // Codex NO-GO round 4: this ancestor IS the chain's terminal root -- it must
      // satisfy the same local invariants a directly-validated root request would,
      // never accepted merely because the walk stops here.
      if (parentObj.root_request_id !== parentObj.request_id) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'terminal root must have root_request_id==request_id');
      }
      if (parentObj.depth !== 0) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'terminal root must have depth==0');
      }
    }
    childObj = parentObj;
    curId = parentObj.parent_request_id;
    hops += 1;
    if (hops > 4096) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent chain exceeds sane bound');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `inbox-ref/v1` (record #2) -- field table PLAN.md ~L305-316
// ─────────────────────────────────────────────────────────────────────────────

const INBOX_REF_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/inbox-ref/v1' },
  request_id: { check: isHexId },
  request_digest: { check: isHex64 },
  kind: { check: isEnum(['consult']) },
  target_role: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};

function validateInboxRefV1(artifactPath, coordRoot) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, INBOX_REF_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const reqPath = requestPathFor(planRoot, obj.request_id);
  // DUR-J: fd-bound-durable read; the same bytes drive the request_digest check and the
  // parsed reqObj -- no by-path readFileSync, no TOCTOU between the two. Codex NO-GO
  // round 2 (blocker 3): closed-shape CONSULT_V2_FIELDS is enforced. Round 3 (blocker
  // 1): routed through readCanonicalRequestRecord -- the referenced request's OWN
  // embedded request_id must equal `obj.request_id` (this inbox-ref's own field), not
  // merely a digest match over whatever bytes happen to live at the derived path
  // (bytes copied wholesale from a DIFFERENT, but genuinely valid/durable, request
  // would otherwise still correlate).
  const reqRec = readCanonicalRequestRecord(reqPath, obj.request_id, {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'inbox-ref request_id does not resolve to a request',
  });
  if (reqRec.digest !== obj.request_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref request_digest does not match request.json bytes');
  }
  const reqObj = reqRec.obj;
  if (reqObj.target_role !== obj.target_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref target_role does not match request.target_role');
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `activation` (record #2b) -- field table PLAN.md ~L318-336. Written first-
// writer-wins BEFORE claim (#3) and initial `inbox-ref/v1` exposure (Ordered
// Runtime Loop step 6).
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVATION_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/activation/v1' },
  version: { check: (v) => v === 1 },
  request_id: { check: isHexId },
  request_digest: { check: isHex64 },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  target_role_profile_digest: { check: isHex64 },
  routing_policy_version: { check: isNonEmptyString },
  routing_policy_digest: { check: isHex64 },
  selected_driver: { check: isEnum(DRIVER_ENUM) },
  native_target_binding_id: { check: orNull(isNonEmptyString) },
  native_spawn_action_id: { check: orNull(isNonEmptyString) },
  created_at: { check: isIsoTimestamp },
  activation_liveness_expiry: { check: isIsoTimestamp },
};

function validateActivationV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACTIVATION_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attempt Authority resolution (PLAN.md ~L700-704) -- shared by validate + state ops
// ─────────────────────────────────────────────────────────────────────────────

function readRequestForTxnOrCorrelationInvalid(txnDir) {
  // DUR-J: fd-bound durable read -- a genuinely absent request stays CORRELATION_INVALID;
  // an nlink==2 window / symlink / foreign-owner / malformed request now STOPs
  // (DURABILITY_UNPROVEN / SECURITY_INVALID / SCHEMA_INVALID), never read raw.
  // Codex P1-2: closed-shape (CONSULT_V2_FIELDS) is enforced HERE, the single choke
  // point every caller (claim, lease-heartbeat, takeover, cancel, record-delivery,
  // worker-stop, await-result, ...) shares. Round 3 (blocker 1): routed through
  // readCanonicalRequestRecord -- the request's OWN embedded request_id must equal
  // this transaction directory's own name (the canonical identity its storage
  // location implies), not merely be well-formed CONSULT_V2_FIELDS JSON.
  return readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  }).obj;
}

function readTakeoverIfValid(txnDir, reqObj) {
  const takeoverPath = takeoverPathFor(txnDir);
  // DUR-J: fd-bound durable read. A genuinely ABSENT takeover (ENOENT) returns null
  // -> the initial attempt is authoritative (the one legitimate fallback). The
  // nlink==2 in-flight window, a symlink swap, a foreign-owner/other-writable plant,
  // an oversize file, or malformed JSON is NEVER silently downgraded to "absent":
  // readJsonDurableOptional THROWS (DURABILITY_UNPROVEN / SECURITY_INVALID /
  // SCHEMA_INVALID) and that STOP propagates -- an in-flight/tampered takeover can no
  // longer masquerade as "no takeover" and let a superseded attempt keep authority.
  const to = readJsonDurableOptional(takeoverPath);
  if (to === null) return null;
  // AUTH-01/02/03 correction: a DURABLE takeover.json is no longer trusted on a
  // partial shape-only check. The full binding validator (shared with the explicit
  // `validate --kind takeover-v1` path) is called here and THROWS (STOP) on ANY
  // mismatch -- wrong shape, cross-request, wrong superseded attempt/epoch, or an
  // inconsistent reason/eligibility_kind pairing. PLAN.md ~L702 ("otherwise invalid
  // (STOP)") is now the ACTUAL behavior, not merely a DUR-J-deferred boundary note:
  // an invalid takeover can neither supersede the initial attempt NOR be silently
  // ignored as if it never existed.
  return validateTakeoverBinding(to, reqObj);
}

/**
 * Authoritative-attempt resolution, exact rule (PLAN.md ~L702): if a schema-valid
 * `takeover.json` exists for this transaction, its `new_attempt_id`/`new_lease_epoch`
 * are authoritative; otherwise the request's frozen `initial_attempt_id`/
 * `initial_lease_epoch` are authoritative.
 */
function resolveAuthoritativeAttempt(reqObj, txnDir) {
  const to = readTakeoverIfValid(txnDir, reqObj);
  if (to) {
    return { attemptId: to.new_attempt_id, leaseEpoch: to.new_lease_epoch, takeover: to };
  }
  return { attemptId: reqObj.initial_attempt_id, leaseEpoch: reqObj.initial_lease_epoch, takeover: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// `claim` (record #3) -- field table PLAN.md ~L338-354
// ─────────────────────────────────────────────────────────────────────────────

const CLAIM_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/claim/v1' },
  request_id: { check: isHexId },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  claimant_role: { check: isNonEmptyString },
  claimant_worktree_id: { check: isNonEmptyString },
  claimant_instance_id: { check: isNonEmptyString },
  worker_session_id: { required: false, check: orNull(isNonEmptyString) },
  target_role_profile_digest: { check: isHex64 },
  driver: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};

function validateClaimV1(artifactPath, coordRoot) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, CLAIM_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const txnDir = transactionDir(planRoot, obj.request_id);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (obj.attempt_id !== auth.attemptId || obj.lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim attempt/epoch is not the current authoritative pair');
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `active-lease` (record #4) -- field table PLAN.md ~L358-373
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVE_LEASE_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/active-lease/v1' },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  holder_role: { check: isNonEmptyString },
  claimant_instance_id: { check: isNonEmptyString },
  worker_session_id: { required: false, check: orNull(isNonEmptyString) },
  claim_digest: { check: isHex64 },
  ttl_seconds: { check: isNonNegativeInteger },
  heartbeat_interval_seconds: { check: isNonNegativeInteger },
  last_heartbeat_at: { check: isIsoTimestamp },
  lease_expiry: { check: isIsoTimestamp },
  created_at: { check: isIsoTimestamp },
};

/**
 * Section 4: active-lease is the ONE mutable record (replaced in place via
 * publishReplace, never no-clobber-published) -- reading it durably requires the
 * SAME transition lock a writer holds, exactly like cmdLeaseHeartbeat's own
 * immutablePath:false read. An orphaned or poisoned lock (a writer crashed or
 * hung mid-replace) must timeout+STOP here too: the visible bytes alone -- even
 * a clean nlink==1 regular file -- are never sufficient proof, since a writer
 * that reached POST_RENAME_UNPROVEN can leave EXACTLY that shape behind with
 * the lock still held as the honest "unproven" signal. This validator must
 * never read past that signal and accept the visible lease as durable.
 */
function validateActiveLeaseV1(artifactPath) {
  const txnDir = path.dirname(path.dirname(artifactPath));
  return withLock(txnDir, (lockToken) => {
    const rec = readClosedRecord(artifactPath, ACTIVE_LEASE_V1_FIELDS, { immutablePath: false, lockToken: lockToken });
    return rec.obj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// `activation-intent` WAL (record #5b) -- field table PLAN.md ~L394-408
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVATION_INTENT_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/activation-intent/v1' },
  request_digest: { check: isHex64 },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  driver: { check: isNonEmptyString },
  commit_point_pending: { check: (v) => v === true },
  created_at: { check: isIsoTimestamp },
};

function validateActivationIntentV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACTIVATION_INTENT_V1_FIELDS);
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `delivery` (record #5) -- field table PLAN.md ~L375-392 (shape-only, WP1 subset)
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/delivery/v1' },
  request_id: { check: isHexId },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  driver: { check: isNonEmptyString },
  claim_digest: { check: orNull(isHex64) },
  commit_point: { check: orNull(isNonEmptyString) },
  commit_point_at: { check: orNull(isIsoTimestamp) },
  created_at: { check: isIsoTimestamp },
  delivered: { check: isBoolean },
  outcome: { check: orNull(isEnum(['possibly-delivered', 'confirmed-failed-before-commit'])) },
  detail_code: { check: isEnum(['NONE', 'CONFIRMED_PRECOMMIT_FAILURE', 'AMBIGUOUS_BEFORE_COMMIT']) },
};

function validateDeliveryV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, DELIVERY_V1_FIELDS);
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate result `result/v2` (record #6) -- field table PLAN.md ~L410-435
// ─────────────────────────────────────────────────────────────────────────────

const RESULT_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/result/v2' },
  in_reply_to: { check: isHexId },
  request_digest: { check: isHex64 },
  plan_digest: { check: isHex64 },
  repo_id: { check: isNonEmptyString },
  wave_slug: { check: isNonEmptyString },
  protocol_profile: { check: isNonEmptyString },
  max_depth: { check: isNonNegativeInteger },
  routing_policy_version: { check: isNonEmptyString },
  routing_policy_digest: { check: isHex64 },
  root_request_id: { check: isHexId },
  parent_request_id: { check: orNull(isHexId) },
  depth: { check: isNonNegativeInteger },
  attempt_id: { check: isHexId },
  lease_epoch: { check: isNonNegativeInteger },
  driver: { check: isNonEmptyString },
  claimant_instance_id: { check: isNonEmptyString },
  worker_session_id: { required: false, check: orNull(isNonEmptyString) },
  claim_digest: { check: isHex64 },
  target_role_profile_version: { check: isNonEmptyString },
  target_role_profile_digest: { check: isHex64 },
  from_role: { check: isNonEmptyString },
  to_role: { check: isNonEmptyString },
  result_kind: { check: isNonEmptyString },
  status: { check: isEnum(['ANSWERED', 'BLOCKED']) },
  reason: { check: (v) => v === null || isNonEmptyString(v) },
  content: { required: false, check: () => true },
  content_ref: { required: false, check: () => true },
  subject_repo_id: { check: isNonEmptyString },
  subject_worktree_id: { check: isNonEmptyString },
  subject_head: { check: isNonEmptyString },
  subject_scope_digest: { check: isNonEmptyString },
  consultation_dependencies: { check: (v) => Array.isArray(v) },
  producer_worktree_id: { check: isNonEmptyString },
  producer_head: { check: isNonEmptyString },
  created_at: { check: isIsoTimestamp },
};

/**
 * Fields the result/v2 record must mirror verbatim from its request/v2 (PLAN.md
 * ~L417-430): plan/repo/wave/protocol/max_depth identity, the exact observed subject
 * snapshot, and the immutable routing policy identity. A result carrying a mismatched
 * subject/plan/routing snapshot -- even with an otherwise-correct `request_digest` --
 * must never be accepted (Subject-vs-Producer Model, PLAN.md ~L657: "A result for
 * subject A is never reused for subject B").
 */
const RESULT_MIRRORED_REQUEST_FIELDS = [
  'plan_digest', 'repo_id', 'wave_slug', 'protocol_profile', 'max_depth',
  'subject_repo_id', 'subject_worktree_id', 'subject_head', 'subject_scope_digest',
  'routing_policy_version', 'routing_policy_digest',
];

/** Throws CORRELATION_INVALID on the first mirrored field that diverges from the request. */
function assertResultMirrorsRequest(obj, reqObj) {
  for (const field of RESULT_MIRRORED_REQUEST_FIELDS) {
    if (obj[field] !== reqObj[field]) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'result.' + field + ' does not match request.' + field);
    }
  }
}

/**
 * Full `validate --kind result-v2` pipeline: shape -> content XOR -> durability ->
 * correlation (in_reply_to/digest/roles/root-parent-depth/result_kind/mirrored
 * plan+subject+routing fields, PLAN.md ~L417-430) -> content_ref resolution ->
 * Attempt Authority fencing (PLAN.md ~L700-704). Also used internally by
 * `accept-result`/`takeover` to evaluate an existing candidate.
 */
function validateResultV2(artifactPath, coordRoot) {
  const rec = readDurableRecord(artifactPath);
  const obj = rec.obj;
  assertClosedShape(obj, RESULT_V2_FIELDS);
  assertResultContentXor(obj);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.

  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const txnDir = path.dirname(path.dirname(artifactPath));
  const requestId = path.basename(txnDir);
  const attemptFromFilename = path.basename(artifactPath, '.json');

  if (obj.attempt_id !== attemptFromFilename) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'attempt_id does not match results/<attempt_id>.json filename');
  }
  if (obj.in_reply_to !== requestId) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'in_reply_to does not match containing transaction');
  }

  // DUR-J: read request.json ONCE, fd-bound-durable, and derive BOTH the bytes (for the
  // request_digest comparison) and the parsed reqObj (for the mirror check) from it --
  // no second by-path read, no TOCTOU between the digested bytes and the parsed object.
  // Codex NO-GO round 2 (blocker 3): closed-shape CONSULT_V2_FIELDS is enforced. Round
  // 3 (blocker 1): routed through readCanonicalRequestRecord -- the request's OWN
  // embedded request_id must equal `requestId` (this transaction's own name, already
  // proven above via `obj.in_reply_to !== requestId`), not merely a digest match over
  // whatever bytes happen to live at request.json.
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), requestId, {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  });
  const reqObj = reqRec.obj;
  if (reqRec.digest !== obj.request_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'request_digest does not match request.json bytes');
  }
  assertResultMirrorsRequest(obj, reqObj);
  if (obj.from_role !== reqObj.target_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'from_role != request.target_role');
  }
  if (obj.to_role !== reqObj.source_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'to_role != request.source_role');
  }
  if (obj.root_request_id !== reqObj.root_request_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'root_request_id mismatch vs request');
  }
  if (obj.parent_request_id !== reqObj.parent_request_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id mismatch vs request');
  }
  if (obj.depth !== reqObj.depth) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth mismatch vs request');
  }
  const blockedKindOk = obj.status === 'BLOCKED' && obj.result_kind === 'BLOCKED';
  if (obj.result_kind !== reqObj.expected_result_kind && !blockedKindOk) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'result_kind does not match request.expected_result_kind');
  }
  if (obj.content_ref) {
    resolveContentRefOrThrow(planRoot, obj.content_ref);
  }

  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (obj.attempt_id !== auth.attemptId || obj.lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'result attempt/epoch is not the current authoritative pair');
  }

  return { obj, bytes: rec.bytes, digest: rec.digest, reqObj, txnDir, planRoot, requestId };
}

// ─────────────────────────────────────────────────────────────────────────────
// `accepted-result` (record #7) -- field table PLAN.md ~L437-451
// ─────────────────────────────────────────────────────────────────────────────

const ACCEPTED_RESULT_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/accepted-result/v1' },
  request_digest: { check: isHex64 },
  candidate_result_path: { check: isNonEmptyString },
  result_digest: { check: isHex64 },
  accepted_attempt_id: { check: isHexId },
  accepted_lease_epoch: { check: isNonNegativeInteger },
  routing_policy_digest: { check: isHex64 },
  requester_instance_id: { check: isNonEmptyString },
  accepted_at: { check: isIsoTimestamp },
  schema_version: { check: (v) => v === 1 },
};

function validateAcceptedResultV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACCEPTED_RESULT_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

/**
 * AUTH-06/07 correction: shape validity alone (above) proves the JSON is well-formed
 * and durable, never that it CORRELATES to this specific transaction (PLAN.md ~L710:
 * "only a validated correlated artifact completes"). This re-derives the exact same
 * correlation chain `cmdAcceptResult` itself established at write-time and re-checks
 * every claim against reality:
 *   - `request_digest` must equal the REAL request.json bytes on disk right now.
 *   - `routing_policy_digest` must equal the REAL request's own field.
 *   - `accepted_attempt_id`/`accepted_lease_epoch` must equal the CURRENT authoritative
 *     attempt/epoch (`resolveAuthoritativeAttempt`) -- not merely well-shaped hex/ints.
 *   - `candidate_result_path` is NEVER opened as attacker-supplied I/O: the real
 *     candidate is always re-located canonically via `resultPathFor(txnDir,
 *     accepted_attempt_id)` (the same helper `cmdAcceptResult` used to construct this
 *     field originally); the caller-supplied string is only ever STRING-COMPARED
 *     against that canonical form, never joined/opened directly.
 *   - `result_digest` must equal the real, independently-revalidated (`validateResultV2`)
 *     candidate result's own digest.
 * Throws AUTHORITY_INVALID on any mismatch; a caller that reaches this function already
 * knows the accepted-result artifact is shape-valid and durable (DUR-J's job) -- this is
 * strictly the AUTH-area authority/correlation layer DUR-J deliberately left to AUTH-06/07.
 */
function assertAcceptedResultCorrelates(acceptedObj, txnDir, reqObj, coordRoot) {
  // fd-bound re-read (DUR-J item 6 / AUDIT-sha256File: sha256File itself is
  // planPath-only -- every coordination-record digest must come from its own
  // accredited fd-bound read, never a second raw by-path hash).
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
    absentDetail: 'CORRELATION_INVALID',
    absentMessage: 'referenced request.json does not resolve',
  });
  if (acceptedObj.request_digest !== reqRec.digest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result request_digest does not match the real request.json bytes');
  }
  if (acceptedObj.routing_policy_digest !== reqObj.routing_policy_digest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result routing_policy_digest does not match the real request');
  }
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (acceptedObj.accepted_attempt_id !== auth.attemptId || acceptedObj.accepted_lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result accepted_attempt_id/accepted_lease_epoch is not the current authoritative pair');
  }
  const expectedCandidatePath = resultPathFor(txnDir, acceptedObj.accepted_attempt_id);
  const expectedCandidateRelative = 'results/' + path.basename(expectedCandidatePath);
  if (acceptedObj.candidate_result_path !== expectedCandidateRelative) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result candidate_result_path is not the canonical path for its own accepted_attempt_id');
  }
  const { digest: candidateDigest } = validateResultV2(expectedCandidatePath, coordRoot);
  if (acceptedObj.result_digest !== candidateDigest) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'accepted-result result_digest does not match the real candidate result bytes');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `ack` (record #8) -- field table PLAN.md ~L453-462
// ─────────────────────────────────────────────────────────────────────────────

const ACK_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/ack/v1' },
  disposition: { check: isEnum(['accepted', 'blocked']) },
  in_reply_to_attempt_id: { check: isHexId },
  acked_at: { check: isIsoTimestamp },
};

function validateAckV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, ACK_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `cancel` (record #9, `cancel/v1`) -- field table PLAN.md ~L464-474
// ─────────────────────────────────────────────────────────────────────────────

const CANCEL_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/cancel/v1' },
  request_id: { check: isHexId },
  reason: { check: isEnum(['expired', 'explicit', 'invalid-takeover-exhaustion', 'conflict']) },
  cancelled_at: { check: isIsoTimestamp },
  cancelled_by: { check: isNonEmptyString },
};

function validateCancelV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, CANCEL_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `conflict` diagnostic (record #10, `conflict/v1`) -- field table PLAN.md ~L478-482
// ─────────────────────────────────────────────────────────────────────────────

const CONFLICT_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/conflict/v1' },
  attempt_id: { check: isHexId },
  other_attempt_id: { check: isHexId },
  detected_at: { check: isIsoTimestamp },
};

function validateConflictV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, CONFLICT_V1_FIELDS);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// `takeover` (record #11) -- field table PLAN.md ~L486-502
// ─────────────────────────────────────────────────────────────────────────────

const TAKEOVER_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/takeover/v1' },
  request_id: { check: isHexId },
  new_attempt_id: { check: isHexId },
  new_lease_epoch: { check: isNonNegativeInteger },
  superseded_attempt_id: { check: isHexId },
  reason: { check: isEnum(['lease-expired', 'confirmed-failed-before-commit']) },
  eligibility_kind: {
    check: isEnum(['activation-liveness-expired', 'claim-no-lease-expired', 'active-lease-expired', 'confirmed-failed-before-commit']),
  },
  eligibility_snapshot: { check: isPlainObject },
  eligibility_deadline: { check: orNull(isIsoTimestamp) },
  eligibility_observed_at: { check: isIsoTimestamp },
  takeover_at: { check: isIsoTimestamp },
};

/**
 * Full takeover binding validation (PLAN.md ~L700-712, WP3 AUTH-01/02/03
 * correction: "otherwise invalid (STOP)"). Shared by the explicit `validate
 * --kind takeover-v1` entry point (validateTakeoverV1 below) AND the implicit
 * authority-resolution trust path (readTakeoverIfValid) so neither can silently
 * drift from the other's rules -- a durable-but-invalid takeover.json is REJECTED
 * here, never downgraded to "no takeover" by either caller.
 *
 * Checks, in order: closed shape; request correlation; new_attempt_id differs
 * from superseded_attempt_id; epoch strictly increases from the request-frozen
 * baseline (SCHEMA_INVALID, pre-existing SCHEMA-TAKEOVER-01 contract, unchanged);
 * THEN the AUTH-03/04 binding layer this correction adds -- superseded_attempt_id
 * must be the request's OWN initial_attempt_id (not merely "a" prior attempt),
 * and new_lease_epoch must be EXACTLY initial_lease_epoch+1, never merely
 * "greater than" -- there is exactly one legitimate takeover per transaction
 * (computeTakeoverEligibility's own no-clobber existence check enforces this),
 * so no other epoch value is ever correct; finally reason/eligibility_kind must
 * be an internally consistent pairing (cmdTakeover itself never produces any
 * other combination).
 */
function validateTakeoverBinding(obj, reqObj) {
  assertClosedShape(obj, TAKEOVER_V1_FIELDS);
  if (obj.request_id !== reqObj.request_id) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'takeover request_id does not match this transaction');
  }
  if (obj.new_attempt_id === obj.superseded_attempt_id) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'new_attempt_id must differ from superseded_attempt_id');
  }
  if (!(obj.new_lease_epoch > reqObj.initial_lease_epoch)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'new_lease_epoch must be strictly greater than the superseded epoch');
  }
  if (obj.superseded_attempt_id !== reqObj.initial_attempt_id) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', "takeover superseded_attempt_id does not match the request's own initial_attempt_id");
  }
  if (obj.new_lease_epoch !== reqObj.initial_lease_epoch + 1) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'takeover new_lease_epoch is not exactly the one legitimate successor epoch');
  }
  const expectedReason = obj.eligibility_kind === 'confirmed-failed-before-commit' ? 'confirmed-failed-before-commit' : 'lease-expired';
  if (obj.reason !== expectedReason) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'takeover reason does not match its own eligibility_kind');
  }
  return obj;
}

function validateTakeoverV1(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  const txnDir = path.dirname(artifactPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  return validateTakeoverBinding(obj, reqObj);
}

// ─────────────────────────────────────────────────────────────────────────────
// `stop` (record #12, `stop/v2`) + `stop-ack/v1` -- field tables PLAN.md ~L506-519
// ─────────────────────────────────────────────────────────────────────────────

const HEX128_RE = /^[a-f0-9]{32}$/;

const STOP_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/stop/v2' },
  stop_id: { check: (v) => typeof v === 'string' && HEX128_RE.test(v) },
  kind: { check: isEnum(['transaction', 'session-shutdown']) },
  target_role: { check: isNonEmptyString },
  worker_session_id: { check: isNonEmptyString },
  request_id: { check: orNull(isHexId) },
  attempt_id: { check: orNull(isHexId) },
  lease_epoch: { check: orNull(isNonNegativeInteger) },
  expiry: { check: isIsoTimestamp },
  requested_at: { check: isIsoTimestamp },
};

/**
 * Whole-object cross-field rule (PLAN.md ~L515): request_id/attempt_id/lease_epoch
 * are all required (non-null) for `kind:"transaction"` and all null for
 * `kind:"session-shutdown"` -- epoch alone is never sufficient.
 */
function assertStopCorrelationTriple(obj) {
  const allNull = obj.request_id === null && obj.attempt_id === null && obj.lease_epoch === null;
  const allSet = obj.request_id !== null && obj.attempt_id !== null && obj.lease_epoch !== null;
  if (obj.kind === 'transaction' && !allSet) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'transaction stop requires request_id/attempt_id/lease_epoch all set');
  }
  if (obj.kind === 'session-shutdown' && !allNull) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'session-shutdown stop requires request_id/attempt_id/lease_epoch all null');
  }
}

function validateStopV2(artifactPath) {
  const obj = readJsonDurable(artifactPath);
  assertClosedShape(obj, STOP_V2_FIELDS);
  assertStopCorrelationTriple(obj);
  // DUR-J item 4: durability + fd-bound identity are proven inside readJsonDurable(artifactPath)
  // above; the old path-based `assertDurable` after a by-path read was a TOCTOU and is gone.
  return obj;
}

const STOP_ACK_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/stop-ack/v1' },
  stop_id: { check: (v) => typeof v === 'string' && HEX128_RE.test(v) },
  worker_session_id: { check: isNonEmptyString },
  disposition: { check: isEnum(['exact-transaction', 'stale', 'unrelated', 'session-shutdown']) },
  acked_at: { check: isIsoTimestamp },
};

// ─────────────────────────────────────────────────────────────────────────────
// Command dispatch registry -- populated incrementally as each cmd* is defined
// ─────────────────────────────────────────────────────────────────────────────

const COMMANDS = {};

// ─────────────────────────────────────────────────────────────────────────────
// `validate` -- full schema/path/authority validation, no mutation (PLAN.md ~L775)
// ─────────────────────────────────────────────────────────────────────────────

const VALIDATE_KIND_DISPATCH = {
  'consult-v2': (artifact, coordRoot) => validateConsultV2(artifact, coordRoot),
  'inbox-ref-v1': (artifact, coordRoot) => validateInboxRefV1(artifact, coordRoot),
  'result-v2': (artifact, coordRoot) => validateResultV2(artifact, coordRoot).obj,
  'claim-v1': (artifact, coordRoot) => validateClaimV1(artifact, coordRoot),
  'active-lease-v1': (artifact) => validateActiveLeaseV1(artifact),
  'activation-intent-v1': (artifact) => validateActivationIntentV1(artifact),
  'delivery-v1': (artifact) => validateDeliveryV1(artifact),
  'accepted-result-v1': (artifact) => validateAcceptedResultV1(artifact),
  'ack-v1': (artifact) => validateAckV1(artifact),
  'cancel-v1': (artifact) => validateCancelV1(artifact),
  'conflict-v1': (artifact) => validateConflictV1(artifact),
  'takeover-v1': (artifact) => validateTakeoverV1(artifact),
};

function cmdValidate(flags) {
  requireFlags(flags, ['coordination-root', 'kind', 'artifact']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const artifact = resolveAbsolute(flags.artifact);
  const validator = VALIDATE_KIND_DISPATCH[flags.kind];
  if (!validator) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unknown --kind: ' + flags.kind);
  }
  const obj = validator(artifact, coordRoot);
  return {
    request_id: (obj && (obj.request_id || obj.in_reply_to)) || null,
    artifact_ref: artifact,
  };
}
COMMANDS.validate = cmdValidate;

// ─────────────────────────────────────────────────────────────────────────────
// `root-init` / `root-validate` (PLAN.md ~L758-759)
// ─────────────────────────────────────────────────────────────────────────────

function cmdRootInit(flags) {
  requireFlags(flags, ['coordination-root']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  // RCR-confine-5: reject a pre-existing symlink at the leaf BEFORE any
  // mkdir/chmod. mkdirSync on an already-existing path is a no-op EVEN
  // THROUGH a symlink, so without this guard chmodSync(0700) below would
  // silently mutate whatever real directory the symlink points to.
  try {
    const lst = fs.lstatSync(coordRoot);
    if (lst.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root path is a pre-existing symlink (rejected before follow): ' + coordRoot);
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    // ENOENT (does not exist yet, the normal case) or any other lstat error:
    // fall through and let mkdirSync itself surface the real condition.
  }
  const preexisting = fs.existsSync(coordRoot);
  fs.mkdirSync(coordRoot, { recursive: true });
  try {
    fs.chmodSync(coordRoot, 0o700);
  } catch (err) { /* best effort -- Windows ACL init is a later WP */ }
  try {
    assertRootConfinedToWorktree(coordRoot);
  } catch (err) {
    // Fail-closed rollback: never leave a freshly-created, non-confined
    // directory behind outside the worktree (best effort -- a directory that
    // pre-existed before this call is left untouched either way).
    if (!preexisting) {
      try { fs.rmdirSync(coordRoot); } catch (cleanupErr) { /* best effort */ }
    }
    throw err;
  }
  return { artifact_ref: coordRoot };
}
COMMANDS['root-init'] = cmdRootInit;

function cmdRootValidate(flags) {
  requireFlags(flags, ['coordination-root']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  let stat;
  try {
    // lstat (not stat): the coordination root PATH ITSELF must not be a symlink
    // (RCR-confine-3) -- checked below before anything follows it.
    stat = fs.lstatSync(coordRoot, { bigint: true });
  } catch (err) {
    // A missing/wrong root path is bad input, not a transient unavailability --
    // matches this file's own consistent not-found convention (INVALID/
    // SCHEMA_INVALID, e.g. readArtifactBytes/assertDurable/resolveContentRefOrThrow)
    // rather than the lone UNAVAILABLE/NONE outlier this handler previously used.
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'coordination root does not exist: ' + coordRoot);
  }
  if (stat.isSymbolicLink()) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root path is a symlink (rejected before follow): ' + coordRoot);
  }
  if (!stat.isDirectory()) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'coordination root is not a directory: ' + coordRoot);
  }
  // resolveEffectivePlatform (not raw process.platform): honors
  // RUNTIME_CONSULTATION_FORCE_PLATFORM under the test capability (same seam
  // Gap#1's argv-cap check already uses) so the win32 ACL_PROBE branch below is
  // genuinely exercisable, not merely unverified dead code, on any host.
  const isPosix = resolveEffectivePlatform() !== 'win32';
  // Owner check mirrors assertDurableTargetMatches's own POSIX-identity
  // pattern (checked BEFORE mode, same order): a root owned by a different
  // principal can never be trusted as owner-confined regardless of its mode bits.
  if (isPosix && typeof process.getuid === 'function' && stat.uid !== BigInt(process.getuid())) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root is not owner-confined: ' + coordRoot);
  }
  if (isPosix && (stat.mode & 0o777n) !== 0o700n) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root mode is not owner-only 0700: ' + coordRoot);
  }
  // Windows ACL confinement (PLAN.md W09/W10a/W10b, ~L1504-1506) -- UNVERIFIED,
  // no pwsh/Windows execution is available in this environment; this wires ONLY
  // the RUNTIME_CONSULTATION_ACL_PROBE=unverifiable test seam (W10b: forces
  // 'indeterminate' -> sibling/shared-root mode DISABLED fail-closed, without
  // depending on the invoking principal's real filesystem permissions -- the
  // argv layer already gates this env var to the test capability). Full
  // icacls-based ACL/SID inspection (W09 baseline confinement, W10a world-SID
  // rejection) is NOT implemented here -- deliberately deferred rather than
  // shipping unverified Windows-specific SID-parsing security logic with zero
  // ability to prove it correct; real Windows access is required to develop and
  // verify it safely. Stays PENDING_CI.
  if (!isPosix && process.env.RUNTIME_CONSULTATION_ACL_PROBE === 'unverifiable') {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root ACL confinement is indeterminate (RUNTIME_CONSULTATION_ACL_PROBE=unverifiable)');
  }
  // Confinement is proven via a `git` subprocess call (assertRootConfinedToWorktree),
  // a measurably slower step than the pure in-process checks above -- widening the
  // TOCTOU window for a same-uid attacker to swap the path out from under this
  // validate call. Stable-identity re-check: re-lstat AFTER confinement and require
  // the exact same inode/mode/owner as the first snapshot, mirroring
  // classifyDurableRead's own before/after drift rejection for content artifacts.
  assertRootConfinedToWorktree(coordRoot);
  let stat2;
  try {
    stat2 = fs.lstatSync(coordRoot, { bigint: true });
  } catch (err) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root vanished during validation: ' + coordRoot);
  }
  if (stat2.isSymbolicLink() || stat2.dev !== stat.dev || stat2.ino !== stat.ino || stat2.mode !== stat.mode || stat2.uid !== stat.uid || stat2.gid !== stat.gid) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'coordination root identity changed during validation (swap/tamper): ' + coordRoot);
  }
  return { artifact_ref: coordRoot };
}
COMMANDS['root-validate'] = cmdRootValidate;

// ─────────────────────────────────────────────────────────────────────────────
// stdout envelope + top-level dispatch (Frozen CLI ABI, PLAN.md ~L779-781)
// ─────────────────────────────────────────────────────────────────────────────

function printResultAndExit(command, statusName, detailCode, extra) {
  const rc = RC_FOR_STATUS[statusName] !== undefined ? RC_FOR_STATUS[statusName] : RC_FOR_STATUS.INTERNAL;
  const e = extra || {};
  const result = {
    schema: CLI_RESULT_SCHEMA,
    command: command || null,
    ok: statusName === 'SUCCESS',
    status: statusName,
    code: rc,
    request_id: e.request_id || null,
    artifact_ref: e.artifact_ref || null,
    detail_code: detailCode || 'NONE',
    content_ref: e.content_ref || null,
    activation_action: e.activation_action || null,
  };
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(rc);
}

// Portable argv cap (Frozen CLI ABI, PLAN.md ~L754): the complete post-hook argv
// is at most 131072 UTF-8 bytes on POSIX, or 28672 UTF-16 code units on Windows,
// checked before decode/allocation -- i.e. before even a per-flag path-token
// check, independent of subcommand.
const MAX_TOTAL_ARGV_BYTES = 131072;
const MAX_TOTAL_ARGV_UTF16_UNITS_WINDOWS = 28672;

/**
 * Effective platform for the total-argv-cap branch (Gap#1, PLAN.md ~L754).
 * `RUNTIME_CONSULTATION_FORCE_PLATFORM` is honored ONLY when the harness test
 * capability is active (`isTestCapability()`: NODE_ENV=test +
 * RUNTIME_CONSULTATION_TEST_CAPABILITY) -- mirrors resolveFixedClockState's own
 * isTestCapability()-gated env-var override. Production (no capability) always
 * observes the real `process.platform`; the override can NEVER be honored
 * outside the test capability, by construction.
 */
function resolveEffectivePlatform() {
  if (isTestCapability()) {
    const overrideEnv = process.env.RUNTIME_CONSULTATION_FORCE_PLATFORM;
    if (typeof overrideEnv === 'string' && overrideEnv.length > 0) return overrideEnv;
  }
  return process.platform;
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  try {
    const isWindowsArgvCap = resolveEffectivePlatform() === 'win32';
    if (isWindowsArgvCap) {
      const totalArgvUtf16Units = argv.reduce((sum, tok) => sum + String(tok).length, 0);
      if (totalArgvUtf16Units > MAX_TOTAL_ARGV_UTF16_UNITS_WINDOWS) {
        throw new CliError('INVALID', 'INVALID_ARGUMENT', 'post-hook argv exceeds the 28672-UTF-16-unit total budget');
      }
    } else {
      const totalArgvBytes = argv.reduce((sum, tok) => sum + Buffer.byteLength(String(tok), 'utf8'), 0);
      if (totalArgvBytes > MAX_TOTAL_ARGV_BYTES) {
        throw new CliError('INVALID', 'INVALID_ARGUMENT', 'post-hook argv exceeds the 131072-byte total budget');
      }
    }
    if (!command) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing subcommand');
    }
    const handler = COMMANDS[command];
    if (!handler) {
      throw new CliError('USAGE_ERROR', 'UNKNOWN_COMMAND', 'unknown subcommand: ' + command);
    }
    const flags = parseFlags(argv.slice(1), command);
    // Fixed-ids/fixed-clock test-mode activation (WP2 fake-clock/fixed-ids
    // seam): resolved ONCE per process, immediately after parseFlags succeeds
    // and before any handler runs. parseFlags already throws before this
    // point if fixed-ids/fixed-clock is set without the test capability
    // (see the '--fixed-ids/--fixed-clock require the test capability' check
    // above) -- the isTestCapability() re-check here is defensive-but-
    // harmless, not load-bearing.
    FIXED_IDS_ACTIVE = isTestCapability() && Boolean(flags['fixed-ids']);
    resolveFixedClockState(flags);
    const extra = handler(flags) || {};
    printResultAndExit(command, 'SUCCESS', 'NONE', extra);
  } catch (err) {
    if (err instanceof CliError) {
      printResultAndExit(command, err.status, err.detailCode, err.extra);
    } else {
      process.stderr.write('runtime-consultation internal error: ' + (err && err.stack ? err.stack : String(err)) + '\n');
      printResultAndExit(command, 'INTERNAL', 'INTERNAL_ERROR', {});
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// `publish-request` (PLAN.md ~L761, Ordered Runtime Loop steps 1-5 ~L798-808)
// ─────────────────────────────────────────────────────────────────────────────

// WP3 fix: this used to be an in-memory FABRICATED placeholder
// ({schema,profile:'wp1-default'}) wholly disconnected from the real
// scripts/lib/runtime-routing.json file on disk -- every request's
// routing_policy_digest was a digest of that fake stub, never the real routing
// table. PLAN.md's own Routing Registry section: "Every request uses its
// immutable content-addressed snapshot" -- ROUTING_POLICY_CONTENT is now the
// REAL file's exact on-disk bytes (read once at module load; `runtime-routing.json`
// is a toolkit file loaded alongside this one, never request-controlled), and
// ROUTING_POLICY_DIGEST is the raw SHA-256 of those exact bytes (no canonical
// re-serialization -- a byte-for-byte hash, matching this file's own
// raw-file-digest-equals-canonical-serialization-digest invariant elsewhere).
const ROUTING_POLICY_VERSION = 'runtime-routing/v1';
const ROUTING_POLICY_CONTENT = fs.readFileSync(path.join(__dirname, 'runtime-routing.json'));
const ROUTING_POLICY_DIGEST = sha256Buffer(ROUTING_POLICY_CONTENT);
const ROUTING_POLICY_TABLE = JSON.parse(ROUTING_POLICY_CONTENT.toString('utf8'));
if (ROUTING_POLICY_TABLE.schema !== ROUTING_POLICY_VERSION || !ROUTING_POLICY_TABLE.routes || typeof ROUTING_POLICY_TABLE.routes !== 'object') {
  // Fail fast at module load, not at first dispatch -- a malformed toolkit
  // routing.json is a harness integrity defect, never a per-request condition.
  throw new Error('scripts/lib/runtime-routing.json is malformed: schema must be ' + ROUTING_POLICY_VERSION + ' with a routes object');
}
const TARGET_ROLE_PROFILE_VERSION = '1.0.0';

function targetRoleProfileDigestFor(role) {
  return sha256String('runtime-consultation/wp1-target-role-profile:' + role);
}

const INTENT_FIELDS = {
  target_role: { check: isNonEmptyString },
  question: { check: (v) => isNonEmptyString(v) && utf8ByteLength(v) <= 8192 },
  content_ref: { required: false, check: isContentRefHandle },
  expected_result_kind: { check: isNonEmptyString },
  expiry: { check: isIsoTimestamp },
  parent_request_id: { required: false, check: isHexId },
};

/** Decodes+validates the base64url `--intent` payload against its OWN closed shape. */
function decodeIntentOrThrow(intentB64) {
  const buf = decodeBase64Url(intentB64);
  let obj;
  try {
    obj = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'intent is not valid JSON');
  }
  assertClosedShape(obj, INTENT_FIELDS);
  return obj;
}

/**
 * `subject-bundle-manifest/v1` -- minimal closed shape (PLAN.md ~L647, ~L804).
 * `entries` carries the caller's manifested subject-scope entries. The manifest
 * must NOT itself carry `subject_scope_digest` -- that value is always DERIVED (hash
 * of this exact validated manifest), never caller-supplied, so a caller cannot forge
 * a digest that does not match its own manifest bytes.
 */
const SUBJECT_BUNDLE_MANIFEST_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/subject-bundle-manifest/v1' },
  entries: { check: (v) => Array.isArray(v) },
};

/**
 * Safe RELATIVE entry-path predicate (distinct from `assertSafeSegment`, which
 * forbids ANY separator and is used for single-component filenames like request
 * IDs). A manifest entry path may be nested (`src/Foo.kt`) but must never be
 * absolute, traverse (`..`), contain a NUL byte or any other control character,
 * name a `.git` segment (categorical Git-metadata rejection, PLAN.md ~L777), or
 * embed a backslash ANYWHERE (WP2 BLOB-AUTH PATH-04 correction).
 *
 * The backslash rejection is unconditional, not merely an addition to the
 * segment denylist below: every consumer of an already-grammar-validated entry
 * path (this file's own `BLOB_DENYLISTED_SEGMENTS` categorical check and
 * `cmdPublishBlob`'s own per-component confinement walk) splits the value on
 * `/` ONLY. A value like `innocuous\.ssh\config` contains zero `/` characters,
 * so without a grammar-level `\` rejection it sails through both of those
 * downstream `/`-only splits as one long, non-matching "segment" and is never
 * compared piecewise against anything they categorically forbid. Rejecting `\`
 * HERE -- before either downstream split ever runs -- is what keeps that
 * split-on-`/` convention sound, instead of requiring every current and future
 * caller to separately remember to split on both separators.
 */
function isSafeRelativeEntryPath(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) return false;
  for (let i = 0; i < v.length; i += 1) {
    const code = v.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false; // control chars, NUL (0x00) included
  }
  if (v.includes('\\')) return false;
  if (path.isAbsolute(v)) return false;
  const segments = v.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..' || seg === '.git') return false;
  }
  return true;
}

/**
 * Per-entry closed shape for `publish-blob`'s "exact manifested subject entry"
 * (PLAN.md ~L760, ~L777): the manifest author's own pre-declared expected
 * size/digest, revalidated against the fd-bound real file at `publish-blob` time
 * -- never trusted alone. `size`/`digest` are optional at the manifest-shape
 * level -- an entry may exist in the subject bundle purely to influence
 * `subject_scope_digest` (e.g. `runtime-consultation-protocol.bats` RCP-publish-4's
 * `{"path":"fixture-a.txt"}`-only fixtures) without ever being `publish-blob`-eligible;
 * `cmdPublishBlob` itself requires both to be present on the MATCHED entry before
 * treating it as a valid blob source (SCHEMA_INVALID otherwise).
 */
const SUBJECT_BUNDLE_ENTRY_FIELDS = {
  path: { check: isSafeRelativeEntryPath },
  size: { required: false, check: isNonNegativeInteger },
  digest: { required: false, check: isHex64 },
};

/**
 * Reads+parses+validates the `--subject-bundle` manifest file against its OWN closed
 * shape, plus each entry's own closed shape (additive: an empty `entries` array --
 * every WP1 fixture -- trivially satisfies this with nothing to iterate). Unlike
 * `decodeIntentOrThrow` (base64url argv payload), this is a path to a caller-prepared
 * file on disk (Frozen CLI ABI `publish-request`/`publish-blob` rows, PLAN.md ~L760-761).
 */
function decodeSubjectBundleManifestOrThrow(manifestPath) {
  const bytes = readArtifactBytes(manifestPath);
  const obj = parseJsonOrSchemaInvalid(bytes);
  assertClosedShape(obj, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
  for (const entry of obj.entries) {
    assertClosedShape(entry, SUBJECT_BUNDLE_ENTRY_FIELDS);
  }
  return obj;
}

function materializePlanRef(planRoot, planPath) {
  const bytes = fs.readFileSync(planPath);
  return publishNoClobber(path.join(planRoot, 'plan_ref'), bytes, { allowIdenticalIdempotent: true });
}

function materializeRoutingPolicy(planRoot) {
  const dest = path.join(planRoot, 'routing-policies', ROUTING_POLICY_DIGEST + '.json');
  return publishNoClobber(dest, ROUTING_POLICY_CONTENT, { allowIdenticalIdempotent: true });
}

/**
 * Materializes the caller-supplied (validated) subject-bundle manifest at its
 * content-addressed path, keyed by the manifest's own `subject_scope_digest`
 * (PLAN.md ~L632, ~L804: "one bundle per subject", "if not already present for this
 * exact `subject_scope_digest`"). Writes the SAME canonical bytes the digest was
 * computed over, so a later re-hash of the on-disk file reproduces
 * `subject_scope_digest` exactly -- matching this file's raw-file-digest-equals-
 * canonical-digest-by-construction convention (PLAN.md ~L646) used for every other
 * writer-produced record.
 */
function materializeSubjectBundle(planRoot, subjectScopeDigest, manifestObj) {
  const dest = path.join(planRoot, 'subject-bundles', subjectScopeDigest, 'manifest.json');
  const bytes = Buffer.from(canonicalJSONStringify(manifestObj), 'utf8');
  return publishNoClobber(dest, bytes, { allowIdenticalIdempotent: true });
}

function cmdPublishRequest(flags) {
  requireFlags(flags, ['coordination-root', 'plan', 'subject-bundle', 'intent']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const planPath = resolveAbsolute(flags.plan);
  const intent = decodeIntentOrThrow(flags.intent);
  const subjectBundlePath = resolveAbsolute(flags['subject-bundle']);
  const subjectBundleManifest = decodeSubjectBundleManifestOrThrow(subjectBundlePath);

  const planDigest = sha256File(planPath);
  const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
  const repoId = computeRepoId(coordRoot);
  const worktreeId = computeWorktreeId(coordRoot);
  const coordRootId = computeCoordRootId(coordRoot);
  const subjectHead = computeSubjectHead(coordRoot);
  // subject_scope_digest = sha256 of the caller's OWN validated manifest content
  // (canonicalized) -- not a HEAD-only placeholder. Two textually-different
  // manifests at the identical HEAD now produce two different digests (Finding #3).
  // Full git-scope-scanning (tracked/modified/untracked/deleted/renamed entries,
  // PLAN.md ~L647) remains WP2/WP3; this is the WP1-realizable subset.
  const subjectScopeDigest = sha256String(canonicalJSONStringify(subjectBundleManifest));

  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);

  // Codex NO-GO round 3 (blocker 2): the FULL parent validation must complete BEFORE
  // the FIRST write. This block moved ahead of planRoot's own materialization
  // (mkdirSync/plan_ref/routing-policy/subject-bundle below) -- neither `planRoot`
  // (a pure path computation) nor reading an EXISTING parent's request.json (if the
  // parent was ever genuinely published, its own txnDir already exists from THAT
  // call) requires planRoot to be created by US first. A schema-invalid/absent/
  // depth-exceeding parent must never let this call grow the persistent inventory
  // even though the overall publish ultimately fails (Codex repro: parent
  // schema-invalid -> rc3/SCHEMA_INVALID, but the inventory still grew from 3 to 9
  // entries under the prior write-before-validate order).
  let parentRequestId = null;
  let depth = 0;
  let rootRequestId;
  if (intent.parent_request_id) {
    parentRequestId = intent.parent_request_id;
    // Codex NO-GO round 4: the parent is now validated via the FULL canonical
    // pipeline (`validateConsultV2` -- durability + identity + closed shape + the
    // COMPLETE ancestry graph walk, now itself hardened this same round to check
    // every edge and the walk's terminal root -- + role-policy + content_ref), not
    // merely durability+shape+identity. A parent that is itself durable/shape-valid/
    // canonically-identified but has an INVALID ancestry somewhere up its OWN chain
    // (e.g. a corrupted terminal root) must not be trusted to derive this nested
    // request's depth/root_request_id from -- reproduced: a parent with
    // parent_request_id:null/depth:0 but root_request_id!=request_id previously let
    // BOTH this call and a subsequent `validate --kind consult-v2` on the resulting
    // child return SUCCESS.
    const parentPath = requestPathFor(planRoot, parentRequestId);
    let parentObj;
    try {
      parentObj = validateConsultV2(parentPath, coordRoot);
    } catch (err) {
      // A genuinely ABSENT parent stays CORRELATION_INVALID, this call site's own
      // pre-existing contract (`validateConsultV2` itself defaults absence to
      // SCHEMA_INVALID, correct for its OTHER caller, direct `validate` on an
      // arbitrary --artifact path). Every OTHER validateConsultV2 failure (shape,
      // graph/ancestry, role-policy, content_ref) propagates with its own correct
      // detail_code exactly as thrown, never silently downgraded or re-labeled.
      if (err && err.durableAbsent) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id does not resolve to an existing request');
      }
      throw err;
    }
    depth = parentObj.depth + 1;
    rootRequestId = parentObj.root_request_id;
    // Codex NO-GO round 5: was `parentObj.max_depth || 2` -- a parent that passed
    // validateConsultV2 with max_depth:0 (0 is falsy in JS) had its real ceiling
    // silently replaced by the default 2, permitting nesting the record itself
    // forbade. `parentObj.max_depth` is now compared directly: CONSULT_V2_FIELDS
    // guarantees it is exactly MAX_DEPTH_LIMIT already (validateConsultV2 would have
    // thrown SCHEMA_INVALID otherwise), so no fallback is needed or safe to have.
    if (depth > parentObj.max_depth) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested request would exceed max_depth');
    }
  }

  fs.mkdirSync(planRoot, { recursive: true });
  materializePlanRef(planRoot, planPath);
  materializeRoutingPolicy(planRoot);
  materializeSubjectBundle(planRoot, subjectScopeDigest, subjectBundleManifest);

  const sourceRole = process.env.RUNTIME_CONSULTATION_SOURCE_ROLE || 'cli-requester';
  assertRolePolicy(sourceRole, intent.target_role);

  const requestId = genId();
  if (!parentRequestId) rootRequestId = requestId;

  const requestObj = {
    schema: 'coordination/consult/v2',
    request_id: requestId,
    root_request_id: rootRequestId,
    parent_request_id: parentRequestId,
    depth,
    max_depth: MAX_DEPTH_LIMIT,
    source_role: sourceRole,
    target_role: intent.target_role,
    target_role_profile_version: TARGET_ROLE_PROFILE_VERSION,
    target_role_profile_digest: targetRoleProfileDigestFor(intent.target_role),
    requester_worktree_id: worktreeId,
    requester_instance_id: genId(),
    repo_id: repoId,
    wave_slug: waveSlug,
    protocol_profile: 'runtime-consultation/v1',
    coordination_root_id: coordRootId,
    plan_digest: planDigest,
    subject_repo_id: repoId,
    subject_worktree_id: worktreeId,
    subject_head: subjectHead,
    subject_scope_digest: subjectScopeDigest,
    created_at: nowIso(),
    question: intent.question,
    expected_result_kind: intent.expected_result_kind,
    expiry: intent.expiry,
    recovery_budget: 1,
    routing_policy_version: ROUTING_POLICY_VERSION,
    routing_policy_digest: ROUTING_POLICY_DIGEST,
    initial_attempt_id: genId(),
    initial_lease_epoch: 0,
  };
  if (intent.content_ref) requestObj.content_ref = intent.content_ref;

  // Gap#2 (WP2 conformance, PLAN.md ~L761): "content_ref must equal a freshly
  // revalidated publish-blob handle" -- a shape-valid-but-fabricated content_ref
  // (blob != digest, or no real backing file) must be rejected HERE, at publish
  // time, not only by a later optional `validate` call. Mirrors
  // validateConsultV2's own `if (obj.content_ref) resolveContentRefOrThrow(...)`
  // pattern (~L893-895), applied here to the not-yet-published request object.
  if (intent.content_ref) resolveContentRefOrThrow(planRoot, intent.content_ref);

  // Fail closed on any internal inconsistency rather than publishing a record
  // `validate --kind consult-v2` would later reject.
  assertClosedShape(requestObj, CONSULT_V2_FIELDS);

  const requestPath = requestPathFor(planRoot, requestId);
  publishNoClobber(requestPath, Buffer.from(canonicalJSONStringify(requestObj), 'utf8'), { allowIdenticalIdempotent: true });

  return { request_id: requestId, artifact_ref: requestPath };
}
COMMANDS['publish-request'] = cmdPublishRequest;

function minIso(a, b) {
  return isoToMs(a) <= isoToMs(b) ? a : b;
}

// ─────────────────────────────────────────────────────────────────────────────
// `claim` (PLAN.md ~L764) -- win claim/v1, then publish the initial active-lease
// ─────────────────────────────────────────────────────────────────────────────

function cmdClaim(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'role']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);

  // claim/v1 remains the no-clobber ELECTION, outside .lock (PLAN-frozen first-writer-
  // wins semantics -- the lock is not needed to WIN the claim, only to safely publish
  // what follows it).
  const claimObj = {
    schema: 'coordination/claim/v1',
    request_id: reqObj.request_id,
    attempt_id: auth.attemptId,
    lease_epoch: auth.leaseEpoch,
    claimant_role: flags.role,
    claimant_worktree_id: computeWorktreeId(coordRoot),
    claimant_instance_id: genId(),
    worker_session_id: flags['worker-session'] || null,
    target_role_profile_digest: reqObj.target_role_profile_digest,
    driver: 'noop',
    created_at: nowIso(),
  };
  const claimPath = claimPathFor(txnDir, auth.attemptId);
  publishNoClobber(claimPath, Buffer.from(canonicalJSONStringify(claimObj), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });

  // Section 4: the initial active-lease publish moves INSIDE the transition lock -- a
  // takeover racing between the claim election above and lock acquisition must be
  // re-checked under the SAME durable lock a heartbeat/takeover itself uses, never
  // assumed still current just because we won the election.
  testRendezvous(txnDir, 'claim-pre-lock');
  return withLock(txnDir, () => {
    // Re-read/revalidate the request and CURRENT attempt/epoch UNDER the lock -- a
    // takeover could have committed between the election above and lock acquisition.
    const reqObj2 = readRequestForTxnOrCorrelationInvalid(txnDir);
    const auth2 = resolveAuthoritativeAttempt(reqObj2, txnDir);
    if (auth2.attemptId !== auth.attemptId || auth2.leaseEpoch !== auth.leaseEpoch) {
      // A takeover committed before lock acquisition: our claim was for the NOW-
      // superseded attempt. Reject -- never publish an initial lease for it.
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a takeover superseded this attempt before the initial lease could be published');
    }
    // Re-read the exact canonical claim just published, fd-bound-durable + closed-shape,
    // under the lock -- the lease's claim_digest is recomputed from THESE accredited
    // bytes, never the in-memory bytes from before the lock (DUR-J item 6 discipline,
    // extended across the lock boundary).
    const claimRec = readClosedRecord(claimPath, CLAIM_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'the just-published claim does not resolve',
    });
    if (claimRec.obj.attempt_id !== auth2.attemptId || claimRec.obj.lease_epoch !== auth2.leaseEpoch) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim attempt/epoch is not the current authoritative pair');
    }

    const now = nowIso();
    const leaseObj = {
      schema: 'coordination/active-lease/v1',
      attempt_id: auth2.attemptId,
      lease_epoch: auth2.leaseEpoch,
      holder_role: flags.role,
      claimant_instance_id: claimRec.obj.claimant_instance_id,
      worker_session_id: claimRec.obj.worker_session_id,
      claim_digest: claimRec.digest,
      ttl_seconds: 300,
      heartbeat_interval_seconds: 60,
      last_heartbeat_at: now,
      lease_expiry: minIso(isoPlusSeconds(now, 300), reqObj2.expiry),
      created_at: now,
    };
    const leasePath = activeLeasePathFor(txnDir, auth2.attemptId);
    publishNoClobber(leasePath, Buffer.from(canonicalJSONStringify(leaseObj), 'utf8'), { allowIdenticalIdempotent: true });

    return { request_id: reqObj2.request_id, artifact_ref: claimPath };
  });
}
COMMANDS.claim = cmdClaim;

// ─────────────────────────────────────────────────────────────────────────────
// `lease-heartbeat` (PLAN.md ~L765) -- durable current-attempt lease refresh
// ─────────────────────────────────────────────────────────────────────────────

function cmdLeaseHeartbeat(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'claim']);
  // Outside the lock: parse argv and derive canonical paths ONLY (Section 4). Every
  // durable read, the authority resolution, and the expiry decision happen INSIDE the
  // one withLock below -- a heartbeat is a REFRESH transaction, not a lock-free lookup.
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const claimPath = resolveAbsolute(flags.claim);

  testRendezvous(txnDir, 'heartbeat-pre-lock');
  return withLock(txnDir, (lockToken) => {
    const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);

    // DUR-J + Section 4: fd-bound durable read, closed-shape enforced, under the lock,
    // from wherever the caller points.
    const claimRec = readClosedRecord(claimPath, CLAIM_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'claim file does not resolve',
    });
    // Self-consistency/confinement: the claim must be stored at ITS OWN canonical path
    // for the attempt it names -- never a claim for attempt X read back from some other,
    // non-canonical location (PATH-07 confinement discipline).
    if (path.resolve(claimPath) !== path.resolve(claimPathFor(txnDir, claimRec.obj.attempt_id))) {
      throw new CliError('INVALID', 'SECURITY_INVALID', '--claim is not stored at its own canonical path for its attempt_id');
    }
    // AUTHORITY: the claim's attempt/epoch must be the CURRENT authoritative pair -- a
    // self-consistent claim for a NOW-superseded attempt is an authority problem, not a
    // correlation/path problem.
    if (claimRec.obj.attempt_id !== auth.attemptId || claimRec.obj.lease_epoch !== auth.leaseEpoch) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim is not the current authoritative attempt/epoch');
    }

    // Section 4: heartbeat REQUIRES an existing lease -- it must never create a missing
    // initial lease (that is solely cmdClaim's job, published under ITS OWN lock).
    // immutablePath:false is the mutable-lease exception (DUR-J item 3), valid only
    // because the authentic lockToken for this txnDir is threaded through (item 6
    // reentrancy -- no second acquire).
    const leasePath = activeLeasePathFor(txnDir, auth.attemptId);
    const existingRec = readClosedRecordOptional(leasePath, ACTIVE_LEASE_V1_FIELDS, { immutablePath: false, lockToken: lockToken });
    if (existingRec === null) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'no existing active-lease to refresh for the current attempt');
    }
    const existing = existingRec.obj;

    // Never revive a superseded or foreign lease: the existing lease must itself match
    // the current attempt/epoch AND the presenting claim's own identity fields.
    if (
      existing.attempt_id !== auth.attemptId
      || existing.lease_epoch !== auth.leaseEpoch
      || existing.holder_role !== claimRec.obj.claimant_role
      || existing.claimant_instance_id !== claimRec.obj.claimant_instance_id
      || (existing.worker_session_id || null) !== (claimRec.obj.worker_session_id || null)
      || existing.claim_digest !== claimRec.digest
    ) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'existing active-lease does not match the current attempt/claimant -- refusing to refresh a stale or foreign lease');
    }

    // Section 4: now < lease_expiry AND now < request expiry, STRICT -- now==lease_expiry
    // is already expired. Never revive an expired lease.
    const now = nowIso();
    const nowMs = isoToMs(now);
    if (!(nowMs < isoToMs(existing.lease_expiry)) || !(nowMs < isoToMs(reqObj.expiry))) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'active-lease or request has already expired; heartbeat rejected');
    }

    const merged = Object.assign({}, existing, {
      last_heartbeat_at: now,
      lease_expiry: minIso(isoPlusSeconds(now, existing.ttl_seconds), reqObj.expiry),
    });
    publishReplace(leasePath, Buffer.from(canonicalJSONStringify(merged), 'utf8'));
    return { request_id: reqObj.request_id, artifact_ref: leasePath };
  });
}
COMMANDS['lease-heartbeat'] = cmdLeaseHeartbeat;

// ─────────────────────────────────────────────────────────────────────────────
// `takeover` eligibility (PLAN.md ~L700-704, ~L821, Takeover Eligibility ~L765-833)
// ─────────────────────────────────────────────────────────────────────────────

const ACTIVATION_LIVENESS_WINDOW_S = 300;
const REQUEST_EXPIRY_MARGIN_S = 60;
const CLAIM_NO_LEASE_WINDOW_S = 10;

function activationLivenessDeadline(reqObj) {
  return minIso(
    isoPlusSeconds(reqObj.created_at, ACTIVATION_LIVENESS_WINDOW_S),
    isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S),
  );
}

function currentValidResultExists(txnDir, auth) {
  const resultPath = resultPathFor(txnDir, auth.attemptId);
  // DUR-J: a genuinely absent result (null) is "no valid result"; an nlink==2 /
  // symlink / foreign-owner / malformed / wrong-RESULT_V2-shape result STOPs
  // (readJsonDurableOptional throws) rather than being silently counted as "no result"
  // -- a non-durable or malformed in-flight result must not silently unblock a takeover.
  const obj = readJsonDurableOptional(resultPath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
  return obj !== null && obj.status === 'ANSWERED';
}

function confirmedFailedDelivery(txnDir, attemptId, claimDigestOrNull) {
  // DUR-J + Section 4: a genuinely absent delivery (null) is "no confirmed failure"; an
  // nlink==2 / symlink / malformed / wrong-shape delivery STOPs rather than silently
  // establishing (or failing to establish) eligibility off a non-durable or unvalidated
  // record.
  const rec = readClosedRecordOptional(deliveryPathFor(txnDir, attemptId), DELIVERY_V1_FIELDS);
  if (rec === null) return false;
  const d = rec.obj;
  if (d.delivered !== false || d.outcome !== 'confirmed-failed-before-commit') return false;
  if (claimDigestOrNull !== null && d.claim_digest !== claimDigestOrNull) return false;
  return true;
}

/** Returns `{eligibilityKind, reason, deadline}` or throws CliError(INVALID, AUTHORITY_INVALID, ...). */
function computeTakeoverEligibility(reqObj, txnDir, nowMs, lockToken) {
  // DUR-J: a durably-committed takeover blocks a second takeover; a genuinely absent
  // one (null) does not block; an nlink==2 / symlink / malformed takeover STOPs
  // (readJsonDurableOptional throws) rather than being coarsely counted as "present".
  if (readJsonDurableOptional(takeoverPathFor(txnDir)) !== null) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a takeover has already committed for this request');
  }
  const initialAttempt = reqObj.initial_attempt_id;
  const auth = { attemptId: initialAttempt, leaseEpoch: reqObj.initial_lease_epoch };
  if (currentValidResultExists(txnDir, auth)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a valid current result already exists; takeover is blocked');
  }

  // DUR-J + Section 4: fd-bound durable read + closed-shape enforcement -- a genuinely
  // absent claim (null) takes the no-claim branch; an nlink==2 / symlink / foreign-
  // owner / malformed / wrong-shape claim STOPs (never mis-read as absent). The digest
  // is taken from the exact durable bytes, not a second sha256File re-read.
  const claimPath = claimPathFor(txnDir, initialAttempt);
  const claimRec = readClosedRecordOptional(claimPath, CLAIM_V1_FIELDS);
  if (claimRec === null) {
    if (confirmedFailedDelivery(txnDir, initialAttempt, null)) {
      return { eligibilityKind: 'confirmed-failed-before-commit', reason: 'confirmed-failed-before-commit', deadline: null };
    }
    const deadline = activationLivenessDeadline(reqObj);
    if (nowMs >= isoToMs(deadline)) {
      return { eligibilityKind: 'activation-liveness-expired', reason: 'lease-expired', deadline };
    }
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'activation liveness has not yet expired');
  }

  const claimObj = claimRec.obj;
  const claimDigest = claimRec.digest;
  if (confirmedFailedDelivery(txnDir, initialAttempt, claimDigest)) {
    return { eligibilityKind: 'confirmed-failed-before-commit', reason: 'confirmed-failed-before-commit', deadline: null };
  }

  // DUR-J + Section 4: same fd-bound durable read + closed-shape enforcement for the
  // active-lease -- a genuinely absent lease (null) takes the no-lease branch; an
  // nlink==2 / symlink / malformed / wrong-shape lease STOPs, never mis-read as absent.
  const leasePath = activeLeasePathFor(txnDir, initialAttempt);
  // DUR-J item 6: the mutable-lease read is valid only under the authentic threaded token.
  const leaseRec = readClosedRecordOptional(leasePath, ACTIVE_LEASE_V1_FIELDS, { immutablePath: false, lockToken: lockToken });
  if (leaseRec === null) {
    const deadline = minIso(
      isoPlusSeconds(claimObj.created_at, CLAIM_NO_LEASE_WINDOW_S),
      minIso(activationLivenessDeadline(reqObj), isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S)),
    );
    if (nowMs >= isoToMs(deadline)) {
      return { eligibilityKind: 'claim-no-lease-expired', reason: 'lease-expired', deadline };
    }
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim-without-lease effective deadline has not yet passed');
  }
  const leaseObj = leaseRec.obj;

  if (nowMs >= isoToMs(leaseObj.lease_expiry)) {
    return { eligibilityKind: 'active-lease-expired', reason: 'lease-expired', deadline: leaseObj.lease_expiry };
  }
  throw new CliError('INVALID', 'AUTHORITY_INVALID', 'active-lease has not yet expired');
}

function cmdTakeover(flags) {
  requireFlags(flags, ['coordination-root', 'request']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);

  return withLock(txnDir, (lockToken) => {
    // DUR-J item 6/Takeover: the lease read used for eligibility AND the takeover
    // transition below occur under the SAME durable exclusion -- the authentic lockToken
    // is threaded into computeTakeoverEligibility so its immutablePath:false lease read is
    // valid without a second acquire (which would deadlock).
    const eligibility = computeTakeoverEligibility(reqObj, txnDir, Date.now(), lockToken);
    const nowStr = nowIso();
    const takeoverObj = {
      schema: 'coordination/takeover/v1',
      request_id: reqObj.request_id,
      new_attempt_id: genId(),
      new_lease_epoch: reqObj.initial_lease_epoch + 1,
      superseded_attempt_id: reqObj.initial_attempt_id,
      reason: eligibility.reason,
      eligibility_kind: eligibility.eligibilityKind,
      eligibility_snapshot: { eligibility_kind: eligibility.eligibilityKind },
      eligibility_deadline: eligibility.deadline || null,
      eligibility_observed_at: nowStr,
      takeover_at: nowStr,
    };
    const takeoverPath = takeoverPathFor(txnDir);
    publishNoClobber(takeoverPath, Buffer.from(canonicalJSONStringify(takeoverObj), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
    return { request_id: reqObj.request_id, artifact_ref: takeoverPath };
  });
}
COMMANDS.takeover = cmdTakeover;

// ─────────────────────────────────────────────────────────────────────────────
// `cancel` (PLAN.md ~L771) -- under lock, publish cancel.json (+ conflict diagnostic)
// ─────────────────────────────────────────────────────────────────────────────

const CANCEL_REASON_ENUM = ['expired', 'explicit', 'invalid-takeover-exhaustion', 'conflict'];

/**
 * Section 8: ENOENT (the results/ directory genuinely does not exist yet) is
 * harmlessly empty; EACCES/EIO/ENOTDIR/any other enumeration failure STOPs -- it is
 * never silently folded into "no results", which would mask a real I/O problem as
 * a legitimate empty-transaction state.
 *
 * Codex gap #2 / NO-GO round 2 blocker 4 (PLAN.md ~L698): `MAX_ENUM_HARD_CAP`/
 * `MAX_ENUM_KEPT_ENTRIES` bound this scan via a TRUE streaming `opendirSync`/
 * `readSync` cutoff -- a directory with an implausible number of raw entries fails
 * closed DURABILITY_UNPROVEN WITHOUT ever materializing more than
 * `MAX_ENUM_HARD_CAP` dirents at once (the prior `readdirSync()` fully materialized
 * the directory into memory BEFORE checking its length, which bounded downstream
 * processing but not the scan/allocation itself), and the sorted `.json` candidate
 * set kept is capped so a caller never processes an unbounded list.
 */
function listResultFiles(txnDir) {
  const resultsDir = path.join(txnDir, 'results');
  let dirHandle;
  try {
    dirHandle = fs.opendirSync(resultsDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'results directory could not be enumerated (' + (err && err.code) + '): ' + resultsDir);
  }
  const kept = []; // ascending-sorted [name, null] pairs, bounded to MAX_ENUM_KEPT_ENTRIES
  let totalSeen = 0;
  try {
    let entry = dirHandle.readSync();
    while (entry !== null) {
      totalSeen += 1;
      if (totalSeen > MAX_ENUM_HARD_CAP) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'results directory exceeds the max scanned-entry bound (>' + MAX_ENUM_HARD_CAP + '): ' + resultsDir);
      }
      if (entry.name.endsWith('.json')) insertBoundedCandidate(kept, entry.name, null, MAX_ENUM_KEPT_ENTRIES);
      entry = dirHandle.readSync();
    }
  } finally {
    try { dirHandle.closeSync(); } catch (e) { /* best-effort close */ }
  }
  return kept.map(([name]) => name);
}

function writeConflictDiagnosticIfApplicable(txnDir) {
  let entries;
  try {
    entries = listResultFiles(txnDir);
  } catch (err) {
    return; // diagnostic only -- never blocks the terminal cancel (mirrors the publish catch below)
  }
  if (entries.length < 2) return;
  const a = path.basename(entries[0], '.json');
  const b = path.basename(entries[1], '.json');
  const conflictObj = { schema: 'coordination/conflict/v1', attempt_id: a, other_attempt_id: b, detected_at: nowIso() };
  try {
    publishNoClobber(
      path.join(txnDir, 'conflict', a + '-' + b + '.json'),
      Buffer.from(canonicalJSONStringify(conflictObj), 'utf8'),
      { allowIdenticalIdempotent: true },
    );
  } catch (err) { /* diagnostic only -- never blocks the terminal cancel */ }
}

function cmdCancel(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'reason']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  if (!CANCEL_REASON_ENUM.includes(flags.reason)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --reason: ' + flags.reason);
  }
  return withLock(txnDir, () => {
    // Terminal mutual exclusion (PLAN.md ~L474/~L690): accepted-result.json and
    // cancel.json are mutually exclusive terminal records. `cmdAcceptResult` already
    // rejects when a cancel exists (symmetric check); this is the other half.
    // DUR-J: each terminal is read fd-bound-durable -- a durable one blocks as before;
    // a genuinely absent one lets the cancel proceed; an nlink==2 / symlink / malformed
    // terminal STOPs (readJsonDurableOptional throws) rather than being counted by mere
    // existsSync presence.
    if (readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) }) !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    if (readJsonDurableOptional(cancelPathFor(txnDir), { shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) }) !== null) {
      // A second cancel (matching or different --reason) observes the SAME
      // terminal CANCELLED disposition as accept-result-after-cancel (PLAN.md
      // ~L781 rc6 rule) -- not RESULT_CONFLICT (reserved for differing RESULT
      // candidates, record #10 ~L476-484), and not a generic AUTHORITY_INVALID.
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }
    const cancelObj = {
      schema: 'coordination/cancel/v1',
      request_id: reqObj.request_id,
      reason: flags.reason,
      cancelled_at: nowIso(),
      cancelled_by: flags.reason === 'expired' ? 'timeout-authority' : genId(),
    };
    const cancelPath = cancelPathFor(txnDir);
    publishNoClobber(cancelPath, Buffer.from(canonicalJSONStringify(cancelObj), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
    if (flags.reason === 'conflict') {
      writeConflictDiagnosticIfApplicable(txnDir);
    }
    return { request_id: reqObj.request_id, artifact_ref: cancelPath };
  });
}
COMMANDS.cancel = cmdCancel;

// ─────────────────────────────────────────────────────────────────────────────
// `transaction-ack` (PLAN.md ~L770) -- publish exact immutable ack.json
// ─────────────────────────────────────────────────────────────────────────────

function findResultWithStatus(txnDir, status) {
  const resultsDir = path.join(txnDir, 'results');
  let sawPending = false;
  for (const entry of listResultFiles(txnDir)) {
    const candidatePath = path.join(resultsDir, entry);
    // DUR-J (Gap 1) + Section 8: classify each candidate EXPLICITLY. A durable,
    // shape-valid PRESENT result whose status matches is returned immediately. A
    // PRESENT non-match keeps scanning. ANY INVALID candidate -- symlink, wrong
    // owner/mode, oversize, malformed JSON, wrong RESULT_V2 shape, identity drift,
    // path rebound -- THROWS (STOP), never silently skipped. A PENDING candidate
    // (the recognized nlink==2 in-flight window) is NOT treated as absent: it is a
    // relevant candidate that could become ANY status once durable, so if the scan
    // finishes with no matching PRESENT while a PENDING was seen, we CANNOT
    // truthfully answer "no <status> result exists" -- fail closed with
    // DURABILITY_UNPROVEN. An ABSENT entry here was JUST enumerated by
    // listResultFiles above -- a subsequent ENOENT is a genuine vanish-between-
    // list-and-read, never a harmless "wasn't there" (Section 8).
    const r = classifyDurableRead(candidatePath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
    if (r.state === DURABLE_ABSENT) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'result candidate was enumerated then vanished before it could be read: ' + candidatePath);
    }
    if (r.state === DURABLE_PENDING) { sawPending = true; continue; }
    if (r.obj.status === status) return candidatePath;
  }
  if (sawPending) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'a result candidate is still in the nlink==2 in-flight window; cannot prove no ' + status + ' result exists yet');
  }
  return null;
}

function cmdTransactionAck(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'disposition']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  const disposition = flags.disposition;
  if (!['accepted', 'blocked'].includes(disposition)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --disposition: ' + disposition);
  }
  if (disposition === 'blocked') {
    // Section 8: the BLOCKED disposition must acknowledge the CURRENT authoritative
    // attempt's OWN canonical result -- never any shape-valid BLOCKED result that
    // happens to exist from a superseded attempt (findResultWithStatus's free scan
    // is deliberately NOT used here).
    const canonicalResultPath = resultPathFor(txnDir, auth.attemptId);
    const r = classifyDurableRead(canonicalResultPath, { shape: (o) => assertClosedShape(o, RESULT_V2_FIELDS) });
    if (r.state === DURABLE_PENDING) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'the current attempt\'s result is still in the nlink==2 in-flight window');
    }
    if (r.state !== DURABLE_PRESENT || r.obj.status !== 'BLOCKED') {
      throw new CliError('INVALID', 'RESULT_BLOCKED', 'no BLOCKED result exists for the current authoritative attempt to acknowledge');
    }
  }
  // DUR-J: the ack-accepted requirement reads the accepted-result fd-bound-durable --
  // a genuinely absent one stays CORRELATION_INVALID; an nlink==2 / symlink / foreign /
  // malformed accepted-result STOPs rather than being counted "present" by existsSync.
  // AUTH-06/07 correction (surface 2 of 2 -- await-result's DURABLE_PRESENT branch was
  // surface 1): shape+durability alone is not authority. A fabricated-but-shape-valid
  // accepted-result.json must not let a caller mint a legitimate-looking, durably
  // published ack.json. Full correlation re-check BEFORE acknowledging, reusing the
  // exact same validator await-result already requires -- one authority contract,
  // enforced identically at every surface that treats accepted-result as authoritative.
  if (disposition === 'accepted') {
    const acceptedObj = readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
    if (acceptedObj === null) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'no accepted-result.json exists to acknowledge');
    }
    assertAcceptedResultCorrelates(acceptedObj, txnDir, reqObj, coordRoot);
  }
  const ackObj = {
    schema: 'coordination/ack/v1',
    disposition,
    in_reply_to_attempt_id: auth.attemptId,
    acked_at: nowIso(),
  };
  const ackPath = ackPathFor(txnDir);
  publishNoClobber(ackPath, Buffer.from(canonicalJSONStringify(ackObj), 'utf8'), { allowIdenticalIdempotent: true });
  return { request_id: reqObj.request_id, artifact_ref: ackPath };
}
COMMANDS['transaction-ack'] = cmdTransactionAck;

// ─────────────────────────────────────────────────────────────────────────────
// `accept-result` (PLAN.md ~L769) -- under lock, requester-only accepted-result.json
// ─────────────────────────────────────────────────────────────────────────────

function cmdAcceptResult(flags) {
  requireFlags(flags, ['coordination-root', 'request']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  // DUR-J item 6: read the request fd-bound-durable ONCE -> reuse its accredited digest for
  // accepted-result.request_digest (never re-hash the request by path).
  // Codex NO-GO round 3 (blocker 1): routed through readCanonicalRequestRecord -- the
  // request's OWN embedded request_id must equal `path.basename(txnDir)`.
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), { absentDetail: 'CORRELATION_INVALID', absentMessage: 'referenced request.json does not resolve' });
  const reqObj = reqRec.obj;

  return withLock(txnDir, () => {
    // DUR-J: terminal mutual exclusion reads each terminal fd-bound-durable -- a durable
    // accepted-result/cancel blocks as before; a genuinely absent one lets accept
    // proceed; an nlink==2 / symlink / malformed terminal STOPs rather than being
    // counted by mere existsSync presence.
    if (readJsonDurableOptional(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) }) !== null) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    if (readJsonDurableOptional(cancelPathFor(txnDir), { shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) }) !== null) {
      // CLI-RESULT-07: a terminal cancelled outcome maps to the frozen CANCELLED/rc6
      // status (PLAN.md ~L781: "rc6-> the observed terminal BLOCKED|CANCELLED|CONFLICT"),
      // not INVALID/rc3 -- detail_code stays TRANSACTION_CANCELLED.
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }
    const entries = listResultFiles(txnDir);
    if (entries.length === 0) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'no candidate result exists yet');
    }
    const candidatePath = path.join(txnDir, 'results', entries[0]);
    // Full shape/correlation/authority/durability pipeline -- propagates the exact
    // detail_code a direct `validate --kind result-v2` would produce (RESULT-TO-02
    // pins AUTHORITY_INVALID here specifically for a superseded-attempt candidate).
    const { obj: resultObj, digest: resultDigest } = validateResultV2(candidatePath, coordRoot);

    // SC-10 (PLAN.md ~L647/~L1711): the full subject_scope_digest re-scan (fresh
    // git-scope-scan of tracked/modified/untracked/deleted/renamed entries) is
    // WP2/WP3 -- not built here. This WP1-realizable subset recomputes and compares
    // subject_head only, catching the case where the subject worktree has moved to a
    // new commit between request and accept.
    const currentSubjectHead = computeSubjectHead(coordRoot);
    if (currentSubjectHead !== reqObj.subject_head) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'subject HEAD changed between request and accept');
    }

    if (resultObj.status !== 'ANSWERED') {
      // Finding #1 (arch-platform-wp2-cli-mapping-cross-verify.md): a protocol-valid
      // BLOCKED candidate is a terminal state (PLAN.md ~L781 rc6 rule), the same
      // latent gap as Q1's CANCELLED case in this same function -- not INVALID/rc3.
      // detail_code stays RESULT_BLOCKED.
      throw new CliError('BLOCKED', 'RESULT_BLOCKED', 'candidate result is not ANSWERED (never accepted as an answer)');
    }

    const acceptedObj = {
      schema: 'coordination/accepted-result/v1',
      request_digest: reqRec.digest,
      candidate_result_path: 'results/' + path.basename(candidatePath),
      result_digest: resultDigest,
      accepted_attempt_id: resultObj.attempt_id,
      accepted_lease_epoch: resultObj.lease_epoch,
      routing_policy_digest: reqObj.routing_policy_digest,
      requester_instance_id: genId(),
      accepted_at: nowIso(),
      schema_version: 1,
    };
    const acceptedPath = acceptedResultPathFor(txnDir);
    // A double-accept no-clobber race lost here is a RACE (another accept won
    // first), not a cancellation -- matches cmdClaim's own claim-race labeling
    // (AUTHORITY_INVALID), not the unrelated TRANSACTION_CANCELLED detail code.
    publishNoClobber(acceptedPath, Buffer.from(canonicalJSONStringify(acceptedObj), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
    return { request_id: reqObj.request_id, artifact_ref: acceptedPath };
  });
}
COMMANDS['accept-result'] = cmdAcceptResult;

// ─────────────────────────────────────────────────────────────────────────────
// `cleanup` (PLAN.md ~L774) -- remove only eligible non-terminal scratch
// ─────────────────────────────────────────────────────────────────────────────

function cmdCleanup(flags) {
  requireFlags(flags, ['coordination-root', 'request']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  // Reconciles leftover no-clobber/refresh temp siblings only -- terminal records
  // (accepted-result.json, cancel.json, ack.json, takeover.json) and any current
  // candidate never match the temp naming pattern, so they are never at risk
  // (`TERMINAL-NO-DELETE-01`).
  //
  // Codex P1-3: reconcileTempArtifacts now returns an explicit {ok, results} outcome
  // per subdirectory -- ambiguity, drift, or a failed recovery step in ANY of them
  // means this cleanup pass could NOT fully account for the directory, and must
  // propagate DURABILITY_UNPROVEN rather than always reporting SUCCESS regardless of
  // what reconciliation actually found.
  let anyReconcileFailure = false;
  for (const sub of ['results', 'claims', 'active-leases', 'delivery']) {
    const outcome = reconcileTempArtifacts(path.join(txnDir, sub));
    if (!outcome.ok) anyReconcileFailure = true;
  }
  if (anyReconcileFailure) {
    throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'cleanup could not accredit every no-clobber temp sibling as genuinely not-ours or safely reconciled (a genuine stray/crash-cut pair identified but not auto-deleted, ambiguity, drift, or an anomalous I/O error)');
  }
  // DUR-J: the request_id here is a DISPLAY value for cleanup's response envelope, not
  // an authority decision -- the reconcile work above already ran and this can never
  // change that outcome. Codex NO-GO round 4: previously read via `readJsonDurableOptional`
  // (durability + parse only) -- a request.json stored at THIS transaction's own path
  // but internally embedding a DIFFERENT request_id (the same confused-deputy shape as
  // the round-3 blocker 1 finding) would have been echoed back verbatim, a non-
  // authoritative id in cleanup's own response. Now reuses the SAME canonical
  // durability+shape+identity validation every other authoritative reader uses; on ANY
  // failure (absent, non-durable, malformed, or a content/path identity mismatch) the
  // response simply omits the id (`null`) rather than displaying an unearned one --
  // reconciliation semantics above are completely unaffected either way.
  let requestId = null;
  try {
    const rec = readCanonicalRequestRecord(requestPath, path.basename(txnDir), {});
    requestId = rec.obj.request_id;
  } catch (err) { /* best effort -- display only */ }
  return { request_id: requestId, artifact_ref: txnDir };
}
COMMANDS.cleanup = cmdCleanup;

// ─────────────────────────────────────────────────────────────────────────────
// `await-result` (PLAN.md ~L768) -- bounded poll, never hangs/fabricates success
// ─────────────────────────────────────────────────────────────────────────────

// Section 8: the FROZEN allowlist of result-candidate validation outcomes that let
// await-result keep polling instead of STOPping shrinks to ONE principled member --
// AUTHORITY_INVALID, proof (via resolveAuthoritativeAttempt) that the candidate's own
// attempt has genuinely been superseded, which can occur in a narrow race between
// resolving the current attempt and validating its result. CORRELATION_INVALID is
// REMOVED: a stale/wrong-digest/wrong-role/wrong-root/wrong-depth candidate is an
// honest correlation failure that must STOP immediately, never be laundered into a
// generic TIMEOUT by broad pollability. Any other failure (SECURITY_INVALID /
// SCHEMA_INVALID / DURABILITY_UNPROVEN / identity / I/O) propagates and STOPs, as
// before. Tested by DUR-J-Gap2-await-* + XACT-07..10.
const AWAIT_POLLABLE_CANDIDATE_DETAILS = new Set(['AUTHORITY_INVALID']);
function isAwaitPollableCandidateError(err) {
  return err instanceof CliError && err.status === 'INVALID' && AWAIT_POLLABLE_CANDIDATE_DETAILS.has(err.detailCode);
}

function cmdAwaitResult(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'timeout']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const timeoutSeconds = Number.parseInt(flags.timeout, 10);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', '--timeout must be an integer in 1..3600');
  }
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  // W06 fixed-clock deadline seam: the deadline ANCHOR is computed from the
  // UNADVANCED base while the live loop check (below) reads the ADVANCED
  // value -- these are deliberately DIFFERENT quantities under fixed-clock
  // mode, so RUNTIME_CONSULTATION_FAKE_CLOCK_ADVANCE_MS can force an
  // immediate deadline-exceeded on iteration 1 with zero real sleep. Outside
  // fixed-clock mode both resolve to real, independently-advancing
  // Date.now() values -- unchanged production behavior.
  const deadlineBaseMs = FIXED_CLOCK_ACTIVE ? FIXED_CLOCK_BASE_MS : Date.now();
  const deadlineMs = deadlineBaseMs + timeoutSeconds * 1000;
  // Section 8: tracks whether the RESULT candidate (not accepted-result/cancel, which
  // have their own pendingObservedThisPass-only tracking, unchanged) was EVER seen
  // PENDING across iterations. If it is later observed ABSENT, that is a genuine
  // vanish-from-the-in-flight-window, not a fresh pre-publish absence -- STOP.
  let resultEverPending = false;

  for (;;) {
    // DUR-J: await completes/cancels only on a DURABLY-committed, shape-valid terminal.
    // Each terminal is classified EXPLICITLY -- PRESENT completes; PENDING (the one
    // recognized nlink==2 in-flight window) keeps waiting; ABSENT keeps waiting; ANY
    // INVALID (symlink / wrong owner-mode / oversize / malformed / wrong closed-shape /
    // identity drift / path rebound) THROWS (STOP), never silently skipped. The
    // accepted-result CORRELATION check (AUTH-06/07) stays in the AUTH area; DUR-J
    // requires the terminal be durable AND a valid closed shape here.
    let pendingObservedThisPass = false;
    const acc = classifyDurableRead(acceptedResultPathFor(txnDir), { shape: (o) => assertClosedShape(o, ACCEPTED_RESULT_V1_FIELDS) });
    if (acc.state === DURABLE_PRESENT) {
      // AUTH-06/07: shape+durability alone (above) is not authority -- a hand-written,
      // shape-valid, durable-but-uncorrelated accepted-result.json must not complete a
      // real transaction. Re-derive and re-check the full correlation chain before
      // trusting mere presence.
      assertAcceptedResultCorrelates(acc.obj, txnDir, reqObj, coordRoot);
      return { request_id: reqObj.request_id, artifact_ref: acceptedResultPathFor(txnDir) };
    }
    if (acc.state === DURABLE_PENDING) pendingObservedThisPass = true;
    const can = classifyDurableRead(cancelPathFor(txnDir), { shape: (o) => assertClosedShape(o, CANCEL_V1_FIELDS) });
    if (can.state === DURABLE_PRESENT) {
      // rc6 terminal (PLAN.md ~L781), mirroring cmdCancel's/cmdAcceptResult's own
      // CANCELLED/TRANSACTION_CANCELLED terminal-cancel status -- not INVALID/rc3.
      throw new CliError('CANCELLED', 'TRANSACTION_CANCELLED', 'transaction was cancelled');
    }
    if (can.state === DURABLE_PENDING) pendingObservedThisPass = true;

    // Section 8: the result candidate is ALWAYS the CURRENT authoritative attempt's
    // OWN canonical path, re-resolved fresh THIS iteration (a takeover can commit
    // between iterations) -- never a directory-listing entries[0], which could pick a
    // superseded attempt's leftover result and never even reach the current one.
    const currentAuth = resolveAuthoritativeAttempt(reqObj, txnDir);
    const candidatePath = resultPathFor(txnDir, currentAuth.attemptId);
    const resClassify = classifyDurableRead(candidatePath);
    if (resClassify.state === DURABLE_PENDING) {
      pendingObservedThisPass = true;
      resultEverPending = true;
    } else if (resClassify.state === DURABLE_ABSENT) {
      if (resultEverPending) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'result candidate transitioned from the in-flight window to absent: ' + candidatePath);
      }
      // Genuinely, never-before-pending absence: the authoritative attempt simply has
      // not published a result yet -- fine, keep waiting.
    } else {
      // DURABLE_PRESENT -- run the full shape/correlation/authority pipeline. A result
      // sitting at the CURRENT attempt's OWN canonical path can still fail
      // AUTHORITY_INVALID in a narrow race (a takeover committed between the
      // currentAuth resolution above and this validation) -- the ONE principled
      // pollable reason to keep waiting; a superseded result is ignored only because
      // attempt authority proves it is old, never because an error class is broadly
      // pollable.
      let validated = null;
      try {
        validated = validateResultV2(candidatePath, coordRoot);
      } catch (err) {
        if (!isAwaitPollableCandidateError(err)) throw err;
      }
      if (validated) {
        if (validated.obj.status === 'BLOCKED') {
          // CLI-RESULT-06: a protocol-valid BLOCKED candidate is a terminal state
          // (PLAN.md ~L768: "or terminal state"; ~L781 rc6), never silent success.
          throw new CliError('BLOCKED', 'RESULT_BLOCKED', 'await-result observed a protocol-valid BLOCKED candidate', { request_id: reqObj.request_id, artifact_ref: candidatePath });
        }
        return { request_id: reqObj.request_id, artifact_ref: candidatePath };
      }
    }

    if (currentClockMs() >= deadlineMs) {
      if (pendingObservedThisPass) {
        // DUR-J + Section 8: a terminal was still in the recognized nlink==2 in-flight
        // window at the deadline -- report the durability truth (DURABILITY_UNPROVEN),
        // NOT a generic timeout, so a persistently-unproven publish is never laundered
        // as "timed out".
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'await-result deadline reached with a terminal still in the nlink==2 in-flight window');
      }
      // CLI-RESULT-05: NONE is legal only with success (PLAN.md ~L781); a TIMEOUT
      // failure names the specific literal DEADLINE_EXCEEDED.
      throw new CliError('TIMEOUT', 'DEADLINE_EXCEEDED', 'await-result timed out with no valid current candidate');
    }
    sleepSync(100);
  }
}
COMMANDS['await-result'] = cmdAwaitResult;

// ─────────────────────────────────────────────────────────────────────────────
// `publish-blob` (PLAN.md ~L760, ~L777) -- sole content-ref materializer. Deep
// per-entry `BLOB-AUTH-01..08` adversarial validation (outside-root, host-auth/
// config/home, coordination/evidence, traversal, symlink/hard-link/reparse,
// post-open mutation, >10MiB), reusing the exact fd-bind / O_NOFOLLOW / fstat /
// re-fstat-identity pattern already established by `resolveContentRefOrThrow`.
//
// CORRECTION PASS (WP2 BLOB-AUTH, post NO-GO audit): the original shipped
// version's staging-root confinement was LEXICAL ONLY (`path.resolve`/
// `path.join` never touch the filesystem) and its `fs.lstatSync`/
// `fs.openSync(..., O_NOFOLLOW)` pair inspected only the FINAL path component,
// so a symlinked PARENT directory anywhere earlier in `entry.path` was
// transparently followed by the OS with no error at all (RCR-blob-parent-
// symlink / RCR-blob-outside-abs, PATH-01/PATH-06). Separately, the
// categorical denylist and `isSafeRelativeEntryPath` itself both split
// candidate segments on `/` only, so a segment embedding a denylisted name
// behind an internal `\` was never caught (RCR-blob-backslash, PATH-04). This
// pass fixes all three: `isSafeRelativeEntryPath` now rejects `\` and control
// chars unconditionally (see its own doc comment); `--entry`'s grammar is
// checked BEFORE the subject-bundle manifest is decoded (so an unsafe --entry
// always surfaces THIS verb's own SECURITY_INVALID, never the manifest
// decode's generic SCHEMA_INVALID for the identical string); and the staging-
// root confinement below is now a per-component symlink-rejecting walk, not a
// single lexical string comparison.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BLOB_BYTES = 10485760;

// Best-effort categorical host-auth/config/home denylist (PLAN.md ~L777) -- this
// file's own reasonable inference of the segment denylist, since no PLAN range
// read for this task enumerates literal segment names. `.planning` covers this
// repo's own coordination/evidence convention as an additional segment-level
// belt to the resolved-path coordination-root check below. Safe to split on
// `/` alone: `isSafeRelativeEntryPath` (the sole gate every entry path here has
// already passed) categorically rejects `\` anywhere, so a `/`-only split can
// no longer be smuggled past by a backslash-joined lookalike segment.
const BLOB_DENYLISTED_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.netrc', '.planning']);

function cmdPublishBlob(flags) {
  requireFlags(flags, ['coordination-root', 'plan', 'subject-bundle', 'entry']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const planPath = resolveAbsolute(flags.plan);
  const subjectBundlePath = resolveAbsolute(flags['subject-bundle']);

  // --entry's OWN grammar is checked BEFORE the subject-bundle manifest is ever
  // decoded (WP2 BLOB-AUTH correction, ordering fix, RCR-blob-backslash): this
  // flag's raw value and every manifest entry's own `path` field are validated
  // by the SAME isSafeRelativeEntryPath predicate (SUBJECT_BUNDLE_ENTRY_FIELDS.path,
  // enforced inside decodeSubjectBundleManifestOrThrow immediately below). The
  // expected, legitimate case has --entry appear byte-for-byte as a manifest
  // entry's own path too -- checking it here, first, means an unsafe --entry
  // always surfaces this verb's own specific SECURITY_INVALID, rather than
  // being masked by the manifest decode's generic SCHEMA_INVALID for the
  // identical string.
  if (!isSafeRelativeEntryPath(flags.entry)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', '--entry is not a safe relative path');
  }

  const manifest = decodeSubjectBundleManifestOrThrow(subjectBundlePath);
  const entry = manifest.entries.find((e) => e.path === flags.entry);
  if (!entry || !Number.isInteger(entry.size) || typeof entry.digest !== 'string') {
    throw new CliError('INVALID', 'SCHEMA_INVALID', '--entry is not a blob-eligible manifested subject entry');
  }
  const entrySegments = entry.path.split('/');
  for (const seg of entrySegments) {
    if (BLOB_DENYLISTED_SEGMENTS.has(seg)) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'entry references a categorically denylisted path segment');
    }
  }

  const planDigest = sha256File(planPath);
  const waveSlug = path.basename(path.dirname(planPath)).replace(/^wave-/, '');
  const repoId = computeRepoId(coordRoot);
  const planRoot = planRootPath(coordRoot, repoId, waveSlug, planDigest);

  // Staging root: the same git worktree toplevel every other identity field in
  // this file is already derived from (computeWorktreeId's own gitRevParse call)
  // -- no new manifest field is required to carry it (BLOB-AUTH-02/outside-root).
  // Realpath'd up front so the per-component walk below starts from a base
  // that is already known to be symlink-free.
  const stagingRoot = realpathOrSelf(gitRevParse(coordRoot, ['rev-parse', '--show-toplevel']));
  const resolvedStagingRoot = path.resolve(stagingRoot);

  // Coarse lexical pre-check (defense-in-depth, BLOB-AUTH-05 traversal): with
  // the hardened isSafeRelativeEntryPath grammar above (no '..' segment, never
  // absolute, never '\'), entry.path can never lexically resolve outside
  // resolvedStagingRoot -- this can in practice never itself fire post-grammar,
  // but costs nothing to assert explicitly rather than relying on the grammar
  // alone.
  const lexicalCandidate = path.resolve(path.join(resolvedStagingRoot, entry.path));
  if (lexicalCandidate !== resolvedStagingRoot && !lexicalCandidate.startsWith(resolvedStagingRoot + path.sep)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'entry resolves outside the staging root (BLOB-AUTH-05 traversal)');
  }

  // Per-component symlink-confinement walk (WP2 BLOB-AUTH correction, fixes
  // PATH-01/PATH-06 -- RCR-blob-parent-symlink/RCR-blob-outside-abs): the
  // lexical check above is a pure string operation that never touches the
  // filesystem, so it cannot see a symlinked PATH COMPONENT (top-level or
  // nested) whose real target sits outside the staging root. Walk from the
  // already-realpath'd staging root one segment at a time; lstat EVERY
  // component -- including intermediates, not just the final/leaf component --
  // and reject the FIRST symlink found before ever descending into or opening
  // it. A real (non-symlink), '.'/'..' -free child name joined onto an
  // already-real parent is itself already that prefix's own realpath by
  // construction, so no repeated fs.realpathSync call (and therefore no extra
  // TOCTOU window) is needed per component.
  //
  // Windows junction/reparse note (verification gap, documented rather than
  // assumed): the rejection test below is `fs.lstatSync(...).isSymbolicLink()`
  // -- the same Node API call regardless of platform, since Node exposes no
  // separate cross-platform "is this a reparse point" primitive. Whether this
  // reliably reports `true` for a Windows junction (not only a Windows
  // symlink) could not be verified via context7/WebFetch in this pass (tool
  // unavailable this session) or via a live architect (unreachable, NO-TEAM
  // mode this session) -- flagged rather than assumed. Neither
  // runtime-consultation-windows.bats nor runtime-consultation-windows.ps1
  // currently exercises a real junction against this guard. Until the
  // windows.ps1 CI leg adds that case and confirms rejection, treat Windows-
  // junction coverage here as UNVERIFIED even though the POSIX-symlink case
  // this walk targets is fully covered and tested.
  const walkedDevIno = [];
  let walked = resolvedStagingRoot;
  for (let i = 0; i < entrySegments.length; i += 1) {
    const seg = entrySegments[i];
    const isLeaf = i === entrySegments.length - 1;
    const candidate = path.join(walked, seg);
    let lst;
    try {
      lst = fs.lstatSync(candidate);
    } catch (err) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry not found on disk: ' + entry.path);
    }
    if (lst.isSymbolicLink()) {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'manifested entry path component is a symlink (rejected, BLOB-AUTH-06/PATH-01/PATH-06)');
    }
    if (isLeaf) {
      if (!lst.isFile()) {
        throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry is not a regular file');
      }
    } else if (!lst.isDirectory()) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry path component is not a directory: ' + seg);
    }
    walkedDevIno.push({ dev: lst.dev, ino: lst.ino });
    walked = candidate;
  }
  const resolvedCandidate = walked;

  // Real-target confinement (belt-and-suspenders): the walk above is built by
  // repeated path.join off resolvedStagingRoot itself, so resolvedCandidate is
  // already guaranteed to sit inside it by construction -- this assertion can
  // never itself fire, but is kept as an explicit, independent, cheap check
  // rather than relying on that construction alone.
  if (resolvedCandidate !== resolvedStagingRoot && !resolvedCandidate.startsWith(resolvedStagingRoot + path.sep)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'entry resolves outside the staging root (BLOB-AUTH-05 traversal)');
  }

  // Categorical coordination/evidence rejection (PLAN.md ~L777): never blob the
  // coordination root's own internal state, even if it happens to sit inside the
  // staging root.
  const resolvedCoordRoot = path.resolve(coordRoot);
  if (resolvedCandidate === resolvedCoordRoot || resolvedCandidate.startsWith(resolvedCoordRoot + path.sep)) {
    throw new CliError('INVALID', 'SECURITY_INVALID', 'entry resolves inside coordination/evidence state');
  }

  let fd;
  try {
    fd = fs.openSync(resolvedCandidate, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err && err.code === 'ELOOP') {
      throw new CliError('INVALID', 'SECURITY_INVALID', 'manifested entry path is a symlink (rejected at open time)');
    }
    throw err;
  }
  try {
    const fstat = fs.fstatSync(fd);
    if (!fstat.isFile() || fstat.nlink !== 1) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry durability unproven (hard-linked, BLOB-AUTH-06)');
    }
    if (fstat.size !== entry.size || fstat.size > MAX_BLOB_BYTES) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry size mismatch/overflow (BLOB-AUTH-08)');
    }
    const bytes = fs.readFileSync(fd);
    const digest = sha256Buffer(bytes);
    if (digest !== entry.digest) {
      throw new CliError('INVALID', 'SCHEMA_INVALID', 'manifested entry digest mismatch (tampered content)');
    }
    const fstat2 = fs.fstatSync(fd);
    if (fstat2.dev !== fstat.dev || fstat2.ino !== fstat.ino || fstat2.size !== fstat.size) {
      throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry identity changed during read (BLOB-AUTH-07 post-open mutation)');
    }

    // Chain re-validation (WP2 BLOB-AUTH correction, best-effort substitution
    // detection -- PATH-02): pure Node has no openat/RESOLVE_NO_SYMLINKS
    // primitive that would make the walk-then-open sequence above a single
    // atomic operation, so a parent directory component could in principle
    // still be swapped for a symlink strictly between this walk's lstat of it
    // and the leaf's own open() call re-resolving the full path internally.
    // Re-lstat every walked component now (leaf included) and compare dev/ino
    // against what the walk itself recorded; any mismatch (or a component that
    // is now itself a symlink) is treated exactly like this file's existing
    // "identity changed during read" class of rejection just above. This is
    // the SAME documented, accepted residual as RCR-blob-9 (skipped): fd/
    // lstat-bound checks close the window for everything a single-process,
    // syscall-level observation CAN see, but cannot deterministically win a
    // race against a second process acting at the exact syscall boundary --
    // that residual is named here rather than silently assumed away.
    let revalidatePath = resolvedStagingRoot;
    for (let i = 0; i < entrySegments.length; i += 1) {
      revalidatePath = path.join(revalidatePath, entrySegments[i]);
      let relst;
      try {
        relst = fs.lstatSync(revalidatePath);
      } catch (err) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry path component vanished during read (BLOB-AUTH-07 post-open mutation)');
      }
      const recorded = walkedDevIno[i];
      if (relst.isSymbolicLink() || relst.dev !== recorded.dev || relst.ino !== recorded.ino) {
        throw new CliError('INVALID', 'DURABILITY_UNPROVEN', 'manifested entry path component identity changed during read (BLOB-AUTH-07 post-open mutation)');
      }
    }

    const blobPath = blobPathFor(planRoot, digest);
    publishNoClobber(blobPath, bytes, { allowIdenticalIdempotent: true });
    return {
      artifact_ref: blobPath,
      content_ref: { blob: digest, digest, size: fstat.size },
    };
  } finally {
    fs.closeSync(fd);
  }
}
COMMANDS['publish-blob'] = cmdPublishBlob;

// ─────────────────────────────────────────────────────────────────────────────
// `dispatch` (PLAN.md ~L762, ~L798-810) -- validate capability/routing, publish
// `activation/v1`, publish the requester-owned intent WAL when applicable,
// publish `inbox-ref`, return one non-authoritative `ActivationAction`. Real
// driver selection/routing (the per-role `runtime-routing.json` route table) and
// the five non-noop driver branches (SendMessage/Agent/bridge argv) are WP3 --
// this WP2 pass implements the ONE driver it can honestly execute end-to-end
// without fabricating a peer/bridge -- `noop` -- plus the full
// activation/WAL/inbox-ref ordering and closed ActivationAction shape.
// ─────────────────────────────────────────────────────────────────────────────

function cmdDispatch(flags) {
  requireFlags(flags, ['coordination-root', 'request']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  // DUR-J item 6: read the request fd-bound-durable ONCE; reuse its accredited digest below.
  // Codex NO-GO round 3 (blocker 1): routed through readCanonicalRequestRecord -- the
  // request's OWN embedded request_id must equal `path.basename(txnDir)`.
  const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), { absentDetail: 'CORRELATION_INVALID', absentMessage: 'referenced request.json does not resolve' });
  const reqObj = reqRec.obj;
  const planRoot = planRootFromArtifact(coordRoot, requestPath);

  // Routing policy must already be materialized at this EXACT immutable snapshot
  // (Ordered Runtime Loop step 2, PLAN.md ~L803) before any driver can be
  // selected; its absence is a genuine "no available driver" signal (CLI-RESULT-04),
  // not a fabricated one -- real per-role route-table selection is WP3.
  const routingPolicyPath = path.join(planRoot, 'routing-policies', reqObj.routing_policy_digest + '.json');
  // DUR-J: the routing policy is a no-clobber-materialized record. A genuinely absent
  // one is the legitimate "no driver available" signal (UNAVAILABLE/CLI-RESULT-04); an
  // nlink==2 / symlink / foreign-owner / malformed policy STOPs (readDurableBytesOptional
  // throws) instead of being mistaken for "absent" -- an in-flight or tampered policy
  // must never read as "no driver".
  const routingPolicyBytes = readDurableBytesOptional(routingPolicyPath);
  if (routingPolicyBytes === null) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'no routing policy materialized for this plan-root; no driver available');
  }
  // WP3 fix: real per-role route-table selection (PLAN.md Routing Registry:
  // "runtime-routing.json chooses a connector for one consultation attempt").
  // Uses the request's OWN pinned, content-addressed snapshot -- never the live
  // scripts/lib/runtime-routing.json -- so a routing.json edit after publish
  // can never silently change an in-flight request's route table. Full
  // capability-based selection among the five non-noop drivers (a reachable
  // retained Claude peer, Codex app-server, etc.) requires the
  // RoleLifecycleController/runtime-bridge-codex.cjs capability-detection
  // machinery that does not exist yet (WP3-in-progress) -- `noop` remains the
  // only driver this dispatch can honestly select end-to-end, but it is now a
  // REAL lookup against the pinned table (rejecting if the role is unknown to
  // it or `noop` is not one of its allowed drivers), not an unconditional
  // hardcode regardless of what the table says.
  let routingPolicyObj;
  try {
    routingPolicyObj = JSON.parse(routingPolicyBytes.toString('utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'materialized routing policy is not valid JSON: ' + routingPolicyPath);
  }
  const allowedDrivers = routingPolicyObj && routingPolicyObj.routes ? routingPolicyObj.routes[reqObj.target_role] : undefined;
  if (!Array.isArray(allowedDrivers) || !allowedDrivers.includes('noop')) {
    throw new CliError('UNAVAILABLE', 'DRIVER_UNAVAILABLE', 'no honestly-selectable driver for target_role ' + reqObj.target_role + ' in the pinned routing policy');
  }
  const selectedDriver = 'noop';

  const attemptId = reqObj.initial_attempt_id;
  const leaseEpoch = reqObj.initial_lease_epoch;
  const activationPath = activationPathFor(txnDir, attemptId);
  const now = nowIso();
  const activationObj = {
    schema: 'coordination/activation/v1',
    version: 1,
    request_id: reqObj.request_id,
    request_digest: reqRec.digest,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    target_role_profile_digest: reqObj.target_role_profile_digest,
    routing_policy_version: reqObj.routing_policy_version,
    routing_policy_digest: reqObj.routing_policy_digest,
    selected_driver: selectedDriver,
    native_target_binding_id: null,
    native_spawn_action_id: null,
    created_at: now,
    activation_liveness_expiry: activationLivenessDeadline(reqObj),
  };
  assertClosedShape(activationObj, ACTIVATION_V1_FIELDS);
  publishNoClobber(activationPath, Buffer.from(canonicalJSONStringify(activationObj), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });

  // `noop` is not a requester-owned accelerator (claude-sendmessage/claude-agent/
  // runtime-spawn) -- no intent WAL is written; the core itself writes the noop
  // delivery record directly (Activation Drivers table, PLAN.md ~L848: "Receipt
  // writer: delivery/<attempt_id>.json records driver:'noop' explicitly").
  const deliveryObj = {
    schema: 'coordination/delivery/v1',
    request_id: reqObj.request_id,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    driver: 'noop',
    claim_digest: null,
    commit_point: null,
    commit_point_at: null,
    created_at: now,
    delivered: false,
    outcome: null,
    detail_code: 'NONE',
  };
  assertClosedShape(deliveryObj, DELIVERY_V1_FIELDS);
  publishNoClobber(
    deliveryPathFor(txnDir, attemptId),
    Buffer.from(canonicalJSONStringify(deliveryObj), 'utf8'),
    { allowIdenticalIdempotent: true },
  );

  const inboxRefObj = {
    schema: 'coordination/inbox-ref/v1',
    request_id: reqObj.request_id,
    request_digest: reqRec.digest,
    kind: 'consult',
    target_role: reqObj.target_role,
    created_at: now,
  };
  assertClosedShape(inboxRefObj, INBOX_REF_V1_FIELDS);
  publishNoClobber(
    inboxPathFor(planRoot, reqObj.target_role, reqObj.request_id),
    Buffer.from(canonicalJSONStringify(inboxRefObj), 'utf8'),
    { allowIdenticalIdempotent: true },
  );

  // noop requires no caller execution -- activation_action stays null (ABI:
  // "codex-app-server/noop adds no payload keys and therefore returns no action").
  return { request_id: reqObj.request_id, artifact_ref: activationPath, activation_action: null };
}
COMMANDS.dispatch = cmdDispatch;

// ─────────────────────────────────────────────────────────────────────────────
// `record-delivery` (PLAN.md ~L763, ~L870-881) -- publish the branch-owned
// `delivery/v1` record; enforce the driver/commit-point/outcome compatibility
// table. Rejected for either Codex branch or `noop` (PLAN.md ~L779): only
// requester-owned accelerators may call this CLI themselves.
// ─────────────────────────────────────────────────────────────────────────────

const REQUESTER_OWNED_DRIVERS = new Set(['claude-sendmessage', 'claude-agent', 'runtime-spawn']);

/** Driver -> its own "crossed the commit point" token (PLAN.md ~L872-881). */
const DRIVER_CROSSED_COMMIT_POINT = {
  'claude-sendmessage': 'sendmessage-returned',
  'claude-agent': 'agent-start-observed',
  'codex-app-server': 'turn-start-accepted',
  'codex-mcp': 'turn-start-accepted',
  'runtime-spawn': 'wake-helper-returned',
};

const COMMIT_POINT_ENUM = [
  'sendmessage-returned', 'agent-start-observed', 'turn-start-accepted', 'wake-helper-returned', 'none',
];
// The CLI token `noop` is legal argv shape only for the noop driver (PLAN.md
// ~L881) -- which is itself rejected below before this enum's 'noop' member
// could ever reach the compatibility-table mapping.
const RECORD_DELIVERY_OUTCOME_ENUM = ['possibly-delivered', 'confirmed-failed-before-commit', 'noop'];

function cmdRecordDelivery(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'attempt', 'epoch', 'driver', 'outcome', 'commit-point']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);

  if (!DRIVER_ENUM.includes(flags.driver)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --driver: ' + flags.driver);
  }
  if (!RECORD_DELIVERY_OUTCOME_ENUM.includes(flags.outcome)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --outcome: ' + flags.outcome);
  }
  if (!COMMIT_POINT_ENUM.includes(flags['commit-point'])) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --commit-point: ' + flags['commit-point']);
  }
  const epoch = Number.parseInt(flags.epoch, 10);
  if (!Number.isInteger(epoch) || epoch < 0 || String(epoch) !== flags.epoch) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', '--epoch must be a non-negative integer');
  }
  assertHexId(flags.attempt, '--attempt');

  // Requester `record-delivery` is rejected for either Codex branch or noop
  // (PLAN.md ~L779) -- only requester-owned accelerators may call this CLI
  // themselves; the trusted bridge/core write those branches' own delivery.
  if (!REQUESTER_OWNED_DRIVERS.has(flags.driver)) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', 'record-delivery is rejected for driver: ' + flags.driver);
  }

  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  if (flags.attempt !== auth.attemptId || epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'record-delivery attempt/epoch is not the current authoritative pair');
  }

  const crossedToken = DRIVER_CROSSED_COMMIT_POINT[flags.driver];
  const commitPointCli = flags['commit-point'];
  const outcomeCli = flags.outcome;
  let commitPointJson;
  let outcomeJson;
  let delivered;
  if (commitPointCli === crossedToken) {
    if (outcomeCli !== 'possibly-delivered') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'driver/commit-point/outcome tuple does not match the frozen compatibility table');
    }
    commitPointJson = crossedToken;
    outcomeJson = 'possibly-delivered';
    delivered = true;
  } else if (commitPointCli === 'none') {
    if (outcomeCli !== 'possibly-delivered' && outcomeCli !== 'confirmed-failed-before-commit') {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'driver/commit-point/outcome tuple does not match the frozen compatibility table');
    }
    commitPointJson = null;
    outcomeJson = outcomeCli;
    delivered = false;
  } else {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'commit-point is not valid for driver: ' + flags.driver);
  }

  // detail_code inference (no PLAN range read for this task pins this field's
  // exact CLI-argv mapping): confirmed-failure carries its own named diagnostic;
  // an uncrossed ("none") possibly-delivered outcome is the ambiguous-before-
  // commit case; a cleanly-crossed possibly-delivered outcome carries no
  // diagnostic (NONE).
  let deliveryDetailCode;
  if (outcomeJson === 'confirmed-failed-before-commit') {
    deliveryDetailCode = 'CONFIRMED_PRECOMMIT_FAILURE';
  } else if (outcomeJson === 'possibly-delivered' && commitPointJson === null) {
    deliveryDetailCode = 'AMBIGUOUS_BEFORE_COMMIT';
  } else {
    deliveryDetailCode = 'NONE';
  }

  const now = nowIso();
  const deliveryObj = {
    schema: 'coordination/delivery/v1',
    request_id: reqObj.request_id,
    attempt_id: flags.attempt,
    lease_epoch: epoch,
    driver: flags.driver,
    claim_digest: null,
    commit_point: commitPointJson,
    commit_point_at: commitPointJson === null ? null : now,
    created_at: now,
    delivered,
    outcome: outcomeJson,
    detail_code: deliveryDetailCode,
  };
  assertClosedShape(deliveryObj, DELIVERY_V1_FIELDS);
  const deliveryPath = deliveryPathFor(txnDir, flags.attempt);
  publishNoClobber(deliveryPath, Buffer.from(canonicalJSONStringify(deliveryObj), 'utf8'), { allowIdenticalIdempotent: true });
  return { request_id: reqObj.request_id, artifact_ref: deliveryPath };
}
COMMANDS['record-delivery'] = cmdRecordDelivery;

// ─────────────────────────────────────────────────────────────────────────────
// `worker-stop` (PLAN.md ~L772, record #12 `stop/v2` field table ~L506-519) --
// mint a new stop_id and publish exact stop correlation.
// ─────────────────────────────────────────────────────────────────────────────

function cmdWorkerStop(flags) {
  requireFlags(flags, ['coordination-root', 'role', 'worker-session', 'kind']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const kind = flags.kind;
  if (kind !== 'transaction' && kind !== 'session-shutdown') {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --kind: ' + kind);
  }
  if (kind === 'transaction' && !('request' in flags)) {
    throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', '--request is required for --kind transaction');
  }
  if (kind === 'session-shutdown' && ('request' in flags)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', '--request is not valid for --kind session-shutdown');
  }
  assertSafeSegment(flags.role, '--role');
  assertSafeSegment(flags['worker-session'], '--worker-session');

  const now = nowIso();
  const stopId = genId128();
  let base;
  let requestId = null;
  let attemptId = null;
  let leaseEpoch = null;

  if (kind === 'transaction') {
    const requestPath = resolveAbsolute(flags.request);
    const txnDir = path.dirname(requestPath);
    const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
    base = planRootFromArtifact(coordRoot, requestPath);
    requestId = reqObj.request_id;
    attemptId = auth.attemptId;
    leaseEpoch = auth.leaseEpoch;
  } else {
    // session-shutdown carries no request reference at all (Frozen CLI ABI:
    // "--request <path> only for transaction") -- there is no argv-supplied plan
    // identity to derive a plan-root from, and the ABI forbids inventing a new
    // flag ("no WP2 naming latitude"). A session shutdown is not scoped to one
    // plan/wave, so its stop tree lives directly under coordination_root instead
    // of a specific plan-root -- a considered inference, not a literal PLAN quote.
    base = coordRoot;
  }

  const stopObj = {
    schema: 'coordination/stop/v2',
    stop_id: stopId,
    kind,
    target_role: flags.role,
    worker_session_id: flags['worker-session'],
    request_id: requestId,
    attempt_id: attemptId,
    lease_epoch: leaseEpoch,
    expiry: isoPlusSeconds(now, 300),
    requested_at: now,
  };
  assertClosedShape(stopObj, STOP_V2_FIELDS);
  assertStopCorrelationTriple(stopObj);
  const stopPath = stopPathFor(base, flags.role, flags['worker-session'], stopId);
  publishNoClobber(stopPath, Buffer.from(canonicalJSONStringify(stopObj), 'utf8'));
  return { request_id: requestId, artifact_ref: stopPath };
}
COMMANDS['worker-stop'] = cmdWorkerStop;

// ─────────────────────────────────────────────────────────────────────────────
// `worker-stop-ack` (PLAN.md ~L773, record #12's ack sibling ~L519) -- publish
// one per-stop immutable acknowledgement.
// ─────────────────────────────────────────────────────────────────────────────

const STOP_ACK_DISPOSITION_ENUM = ['exact-transaction', 'stale', 'unrelated', 'session-shutdown'];

function cmdWorkerStopAck(flags) {
  requireFlags(flags, ['coordination-root', 'stop', 'disposition']);
  if (!STOP_ACK_DISPOSITION_ENUM.includes(flags.disposition)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --disposition: ' + flags.disposition);
  }
  const stopPath = resolveAbsolute(flags.stop);
  const stopObj = validateStopV2(stopPath);

  const ackObj = {
    schema: 'coordination/stop-ack/v1',
    stop_id: stopObj.stop_id,
    worker_session_id: stopObj.worker_session_id,
    disposition: flags.disposition,
    acked_at: nowIso(),
  };
  assertClosedShape(ackObj, STOP_ACK_V1_FIELDS);
  const ackPath = stopAckPathFor(stopPath, stopObj.stop_id);
  publishNoClobber(ackPath, Buffer.from(canonicalJSONStringify(ackObj), 'utf8'));
  return { request_id: stopObj.request_id, artifact_ref: ackPath };
}
COMMANDS['worker-stop-ack'] = cmdWorkerStopAck;

// ─────────────────────────────────────────────────────────────────────────────
// `publish-result` (PLAN.md ~L767, ~L1129-1136) -- the two native-target XOR
// forms (--content / --blocked-reason); core derives all authority fields from
// request+claim. (Real Codex-bridge result publication is WP3.)
// ─────────────────────────────────────────────────────────────────────────────

const NATIVE_CONTENT_MAX_B64URL_CHARS = 16384;
const NATIVE_CONTENT_MAX_DECODED_BYTES = 12288;
const BLOCKED_REASON_ENUM = [
  'CONTENT_TOO_LARGE', 'INSUFFICIENT_CONTEXT', 'UNSUPPORTED_REQUEST', 'CONSULTATION_FAILED', 'POLICY_DENIED',
];

function cmdPublishResult(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'claim']);
  const hasContent = 'content' in flags;
  const hasBlockedReason = 'blocked-reason' in flags;
  if (hasContent === hasBlockedReason) {
    throw new CliError(
      'USAGE_ERROR',
      hasContent ? 'INVALID_ARGUMENT' : 'MISSING_ARGUMENT',
      'exactly one of --content/--blocked-reason is required',
    );
  }

  const coordRoot = resolveAbsolute(flags['coordination-root']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const claimPath = resolveAbsolute(flags.claim);

  // Section 4: decode the BOUNDED caller content/reason outside the lock -- pure
  // caller-input validation, no durable read depends on it.
  let status;
  let content;
  let reason;
  if (hasContent) {
    if (flags.content.length > NATIVE_CONTENT_MAX_B64URL_CHARS) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', '--content exceeds the 16384-character native base64url ceiling');
    }
    const decoded = decodeBase64Url(flags.content);
    if (decoded.length > NATIVE_CONTENT_MAX_DECODED_BYTES) {
      throw new CliError('INVALID', 'INVALID_ARGUMENT', '--content decoded payload exceeds the 12288-byte native ceiling');
    }
    status = 'ANSWERED';
    content = decoded.toString('utf8');
    reason = null;
  } else {
    if (!BLOCKED_REASON_ENUM.includes(flags['blocked-reason'])) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --blocked-reason: ' + flags['blocked-reason']);
    }
    status = 'BLOCKED';
    reason = flags['blocked-reason'];
  }

  testRendezvous(txnDir, 'publish-result-pre-lock');
  return withLock(txnDir, () => {
    // Section 4: re-read/revalidate the request and CURRENT authority INSIDE the lock
    // -- a takeover racing before lock acquisition must be observed here, never
    // trusted from a pre-lock snapshot. Codex NO-GO round 3 (blocker 1): routed
    // through readCanonicalRequestRecord -- the request's OWN embedded request_id
    // must equal `path.basename(txnDir)`.
    const reqRec = readCanonicalRequestRecord(path.join(txnDir, 'request.json'), path.basename(txnDir), {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'referenced request.json does not resolve',
    });
    const reqObj = reqRec.obj;
    const auth = resolveAuthoritativeAttempt(reqObj, txnDir);

    // The canonical claim for the CURRENT authoritative attempt: self-consistency
    // (own canonical path for its own attempt_id) then authority (current
    // attempt/epoch) -- mirrors cmdLeaseHeartbeat's discipline exactly.
    const claimRec = readClosedRecord(claimPath, CLAIM_V1_FIELDS, {
      absentDetail: 'CORRELATION_INVALID',
      absentMessage: 'claim file does not resolve',
    });
    if (path.resolve(claimPath) !== path.resolve(claimPathFor(txnDir, claimRec.obj.attempt_id))) {
      throw new CliError('INVALID', 'SECURITY_INVALID', '--claim is not stored at its own canonical path for its attempt_id');
    }
    if (claimRec.obj.attempt_id !== auth.attemptId || claimRec.obj.lease_epoch !== auth.leaseEpoch) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim is not the current authoritative attempt/epoch');
    }

    // Section 4: every authority field and digest below is constructed from THESE
    // inside-lock records -- never the pre-lock decode above (which carries no
    // authority fields) nor any snapshot taken before this point.
    const now = nowIso();
    const resultObj = {
      schema: 'coordination/result/v2',
      in_reply_to: reqObj.request_id,
      request_digest: reqRec.digest,
      plan_digest: reqObj.plan_digest,
      repo_id: reqObj.repo_id,
      wave_slug: reqObj.wave_slug,
      protocol_profile: reqObj.protocol_profile,
      max_depth: reqObj.max_depth,
      routing_policy_version: reqObj.routing_policy_version,
      routing_policy_digest: reqObj.routing_policy_digest,
      root_request_id: reqObj.root_request_id,
      parent_request_id: reqObj.parent_request_id,
      depth: reqObj.depth,
      attempt_id: auth.attemptId,
      lease_epoch: auth.leaseEpoch,
      driver: claimRec.obj.driver,
      claimant_instance_id: claimRec.obj.claimant_instance_id,
      worker_session_id: claimRec.obj.worker_session_id || null,
      claim_digest: claimRec.digest,
      target_role_profile_version: reqObj.target_role_profile_version,
      target_role_profile_digest: reqObj.target_role_profile_digest,
      from_role: reqObj.target_role,
      to_role: reqObj.source_role,
      result_kind: status === 'BLOCKED' ? 'BLOCKED' : reqObj.expected_result_kind,
      status,
      reason,
      subject_repo_id: reqObj.subject_repo_id,
      subject_worktree_id: reqObj.subject_worktree_id,
      subject_head: reqObj.subject_head,
      subject_scope_digest: reqObj.subject_scope_digest,
      consultation_dependencies: [],
      producer_worktree_id: computeWorktreeId(coordRoot),
      producer_head: computeSubjectHead(coordRoot),
      created_at: now,
    };
    if (status === 'ANSWERED') resultObj.content = content;

    // Fail closed on any internal inconsistency rather than publishing a record
    // `validate --kind result-v2` would later reject (mirrors cmdPublishRequest's
    // own "fail closed" convention).
    assertClosedShape(resultObj, RESULT_V2_FIELDS);
    assertResultContentXor(resultObj);

    // Section 4: publish only after the final inside-lock authority check above --
    // a takeover that won before lock acquisition was already rejected there, so
    // this publish is never reached for a superseded attempt.
    const resultPath = resultPathFor(txnDir, auth.attemptId);
    publishNoClobber(resultPath, Buffer.from(canonicalJSONStringify(resultObj), 'utf8'), { raceDetailCode: 'AUTHORITY_INVALID' });
    return { request_id: reqObj.request_id, artifact_ref: resultPath };
  });
}
COMMANDS['publish-result'] = cmdPublishResult;

if (require.main === module) {
  main();
}

module.exports = {
  canonicalJSONStringify, sha256Buffer, sha256String, sha256File, writeAllSync, classifyDurableRead,
  isValidLockTokenFor, acquireLock, releaseLock, listResultFiles, findResultWithStatus, reconcileOneNoClobberTemp,
  // WP3: reused by runtime-role-lifecycle.cjs's host-private registry (same fd-bound
  // durability primitives, never a second reimplementation of this security-critical logic).
  DURABLE_ABSENT, DURABLE_PENDING, DURABLE_PRESENT, publishNoClobber, gitRevParse, realpathOrSelf,
};

