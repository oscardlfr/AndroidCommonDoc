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

/** Core-generated identifier: >=128 bits via crypto.randomBytes, lowercase hex. */
function genId() {
  return crypto.randomBytes(32).toString('hex');
}

/** ISO-8601 UTC with a trailing 'Z' and no sub-second component. */
function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
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

/** Parses `--flag value` pairs (plus known boolean flags) after the subcommand token. */
function parseFlags(argv) {
  const out = {};
  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];
    if (typeof tok !== 'string' || !tok.startsWith('--')) {
      throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'unexpected argument: ' + tok);
    }
    const name = tok.slice(2);
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
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      throw new CliError('USAGE_ERROR', 'DUPLICATE_ARGUMENT', 'duplicate --' + name);
    }
    out[name] = val;
    i += 2;
  }
  if (('fixed-ids' in out || 'fixed-clock' in out) && !isTestCapability()) {
    throw new CliError('INVALID', 'INVALID_ARGUMENT', '--fixed-ids/--fixed-clock require the test capability');
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

function transactionsDir(planRoot) {
  return path.join(planRoot, 'transactions');
}

function transactionDir(planRoot, requestId) {
  return path.join(transactionsDir(planRoot), requestId);
}

function requestPathFor(planRoot, requestId) {
  return path.join(transactionDir(planRoot, requestId), 'request.json');
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

/** Opens+fsyncs+closes a directory fd -- the portable "flush directory barrier". */
function fsyncDir(dirPath) {
  let fd;
  try {
    fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
  } catch (err) {
    // Directory fsync is best-effort on platforms/filesystems that reject O_RDONLY
    // directory descriptors; the file-level fsync + linkSync ordering below is the
    // load-bearing durability step for this WP1 pass.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (err) { /* already closed */ }
    }
  }
}

/**
 * ONE canonical publish primitive (PLAN.md ~L679): owner-tagged same-dir temp ->
 * write+fsync temp -> linkSync(temp,target) first-writer-wins -> directory barrier 1
 * -> unlink temp -> directory barrier 2. Throws CliError(INVALID, AUTHORITY_INVALID)
 * on an EEXIST no-clobber race loss (some callers remap this to a more specific
 * detail_code). Idempotent-if-byte-identical for content-addressed targets when
 * `allowIdenticalIdempotent` is true.
 */
function publishNoClobber(targetPath, bytes, opts) {
  const options = opts || {};
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + process.pid + '.' + genId().slice(0, 16) + '.tmp-owner');
  fs.writeFileSync(tempPath, bytes);
  const fd = fs.openSync(tempPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(tempPath, targetPath);
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (cleanupErr) { /* best effort */ }
    if (err.code === 'EEXIST') {
      if (options.allowIdenticalIdempotent) {
        const existing = fs.readFileSync(targetPath);
        if (Buffer.compare(existing, Buffer.from(bytes)) === 0) return targetPath;
      }
      throw new CliError('INVALID', options.raceDetailCode || 'AUTHORITY_INVALID', 'no-clobber race lost for ' + targetPath);
    }
    throw err;
  }
  fsyncDir(dir); // barrier 1: target link durable while nlink==2
  try {
    fs.unlinkSync(tempPath);
  } catch (err) { /* best effort */ }
  fsyncDir(dir); // barrier 2: cleanup durable
  return targetPath;
}

/**
 * Durable replace (active-lease/presence heartbeat ONLY -- everything else uses
 * `publishNoClobber`): same-directory owner-tagged exclusive temp -> canonical
 * write+fsync -> atomic rename over target -> directory fsync.
 */
function publishReplace(targetPath, bytes) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, '.' + path.basename(targetPath) + '.' + process.pid + '.' + genId().slice(0, 16) + '.refresh-tmp-owner');
  fs.writeFileSync(tempPath, bytes);
  const fd = fs.openSync(tempPath, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, targetPath);
  fsyncDir(dir);
  return targetPath;
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

/**
 * Reconciles leftover no-clobber/refresh temp siblings in one directory: a temp
 * still hard-linked to its target (crash between barrier 1 and unlink) completes
 * the unlink; a stray non-hardlinked temp (crash after unlink, before barrier 2
 * observed) is simply removed. Never touches non-temp files (so terminal records
 * are never at risk -- `TERMINAL-NO-DELETE-01`).
 */
function reconcileTempArtifacts(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch (err) {
    return;
  }
  const tempRe = /^\.(.+)\.(tmp-owner|refresh-tmp-owner)$/;
  for (const entry of entries) {
    const m = tempRe.exec(entry);
    if (!m) continue;
    const tempPath = path.join(dirPath, entry);
    try {
      fs.unlinkSync(tempPath);
    } catch (err) { /* best effort */ }
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

/**
 * Exclusive `mkdir` of `.lock/`; bounded wait; never age-reclaimed (an orphaned
 * lock is never unblocked by its age alone -- `LOCK-ORPHAN-01`). Times out with
 * `CliError('TIMEOUT', ...)` rather than hanging or inferring staleness.
 */
function acquireLock(txnDir) {
  const lockDir = path.join(txnDir, '.lock');
  fs.mkdirSync(txnDir, { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      return lockDir;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start >= LOCK_MAX_WAIT_MS) {
        throw new CliError('TIMEOUT', 'NONE', 'transition lock acquisition timed out: ' + lockDir);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
}

function releaseLock(lockDir) {
  try {
    fs.rmdirSync(lockDir);
  } catch (err) { /* best effort */ }
}

function withLock(txnDir, fn) {
  const lockDir = acquireLock(txnDir);
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
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

const CONSULT_V2_FIELDS = {
  schema: { check: (v) => v === 'coordination/consult/v2' },
  request_id: { check: isHexId },
  root_request_id: { check: isHexId },
  parent_request_id: { check: orNull(isHexId) },
  depth: { check: isNonNegativeInteger },
  max_depth: { check: isNonNegativeInteger },
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

/** Full `validate --kind consult-v2` pipeline: shape -> durability -> graph -> role-policy -> content_ref. */
function validateConsultV2(artifactPath, coordRoot) {
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, CONSULT_V2_FIELDS);
  assertDurable(artifactPath);
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

/** Root/parent/depth validation table (PLAN.md ~L659-671): root shape, nesting, cycles, cross-root. */
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
  let isImmediateParent = true;
  let hops = 0;
  while (curId !== null) {
    if (visited.has(curId)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id cycle detected');
    }
    visited.add(curId);
    let parentObj;
    try {
      parentObj = JSON.parse(fs.readFileSync(requestPathFor(planRoot, curId), 'utf8'));
    } catch (err) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id does not resolve: ' + curId);
    }
    if (isImmediateParent) {
      if (parentObj.depth + 1 !== obj.depth) {
        throw new CliError('INVALID', 'CORRELATION_INVALID', 'depth != parent.depth + 1');
      }
      isImmediateParent = false;
    }
    if (parentObj.root_request_id !== obj.root_request_id) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'cross-root parent linkage');
    }
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, INBOX_REF_V1_FIELDS);
  assertDurable(artifactPath);
  const planRoot = planRootFromArtifact(coordRoot, artifactPath);
  const reqPath = requestPathFor(planRoot, obj.request_id);
  let reqBytes;
  try {
    reqBytes = fs.readFileSync(reqPath);
  } catch (err) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref request_id does not resolve to a request');
  }
  if (sha256Buffer(reqBytes) !== obj.request_digest) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref request_digest does not match request.json bytes');
  }
  const reqObj = JSON.parse(reqBytes.toString('utf8'));
  if (reqObj.target_role !== obj.target_role) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'inbox-ref target_role does not match request.target_role');
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attempt Authority resolution (PLAN.md ~L700-704) -- shared by validate + state ops
// ─────────────────────────────────────────────────────────────────────────────

function readRequestForTxnOrCorrelationInvalid(txnDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(txnDir, 'request.json'), 'utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'referenced request.json does not resolve');
  }
}

function readTakeoverIfValid(txnDir) {
  const takeoverPath = takeoverPathFor(txnDir);
  let raw;
  try {
    raw = fs.readFileSync(takeoverPath, 'utf8');
  } catch (err) {
    return null;
  }
  try {
    const to = JSON.parse(raw);
    if (
      to && to.schema === 'coordination/takeover/v1'
      && isHexId(to.new_attempt_id) && Number.isInteger(to.new_lease_epoch)
    ) {
      return to;
    }
  } catch (err) { /* fall through */ }
  return null;
}

/**
 * Authoritative-attempt resolution, exact rule (PLAN.md ~L702): if a schema-valid
 * `takeover.json` exists for this transaction, its `new_attempt_id`/`new_lease_epoch`
 * are authoritative; otherwise the request's frozen `initial_attempt_id`/
 * `initial_lease_epoch` are authoritative.
 */
function resolveAuthoritativeAttempt(reqObj, txnDir) {
  const to = readTakeoverIfValid(txnDir);
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, CLAIM_V1_FIELDS);
  assertDurable(artifactPath);
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

function validateActiveLeaseV1(artifactPath) {
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, ACTIVE_LEASE_V1_FIELDS);
  assertDurable(artifactPath);
  return obj;
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, RESULT_V2_FIELDS);
  assertResultContentXor(obj);
  assertDurable(artifactPath);

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

  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  let reqBytes;
  try {
    reqBytes = fs.readFileSync(path.join(txnDir, 'request.json'));
  } catch (err) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'referenced request.json does not resolve');
  }
  if (sha256Buffer(reqBytes) !== obj.request_digest) {
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

  return { obj, reqObj, txnDir, planRoot, requestId };
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, ACCEPTED_RESULT_V1_FIELDS);
  assertDurable(artifactPath);
  return obj;
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, ACK_V1_FIELDS);
  assertDurable(artifactPath);
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, CANCEL_V1_FIELDS);
  assertDurable(artifactPath);
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
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, CONFLICT_V1_FIELDS);
  assertDurable(artifactPath);
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

function validateTakeoverV1(artifactPath) {
  const obj = parseJsonOrSchemaInvalid(readArtifactBytes(artifactPath));
  assertClosedShape(obj, TAKEOVER_V1_FIELDS);
  assertDurable(artifactPath);
  const txnDir = path.dirname(artifactPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  if (obj.request_id !== path.basename(txnDir)) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'takeover request_id does not match containing transaction');
  }
  if (obj.new_attempt_id === obj.superseded_attempt_id) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'new_attempt_id must differ from superseded_attempt_id');
  }
  // Epoch strictly increases from the request-frozen initial_lease_epoch (there is
  // exactly one permitted takeover, so the request's own frozen epoch is always the
  // correct "superseded epoch" baseline -- PLAN.md ~L492-493, SCHEMA-TAKEOVER-01).
  if (!(obj.new_lease_epoch > reqObj.initial_lease_epoch)) {
    throw new CliError('INVALID', 'SCHEMA_INVALID', 'new_lease_epoch must be strictly greater than the superseded epoch');
  }
  return obj;
}

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
  fs.mkdirSync(coordRoot, { recursive: true });
  try {
    fs.chmodSync(coordRoot, 0o700);
  } catch (err) { /* best effort -- Windows ACL init is a later WP */ }
  return { artifact_ref: coordRoot };
}
COMMANDS['root-init'] = cmdRootInit;

function cmdRootValidate(flags) {
  requireFlags(flags, ['coordination-root']);
  const coordRoot = resolveAbsolute(flags['coordination-root']);
  let stat;
  try {
    stat = fs.statSync(coordRoot);
  } catch (err) {
    throw new CliError('UNAVAILABLE', 'NONE', 'coordination root does not exist: ' + coordRoot);
  }
  if (!stat.isDirectory()) {
    throw new CliError('UNAVAILABLE', 'NONE', 'coordination root is not a directory: ' + coordRoot);
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

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  try {
    if (!command) {
      throw new CliError('USAGE_ERROR', 'MISSING_ARGUMENT', 'missing subcommand');
    }
    const handler = COMMANDS[command];
    if (!handler) {
      throw new CliError('USAGE_ERROR', 'UNKNOWN_COMMAND', 'unknown subcommand: ' + command);
    }
    const flags = parseFlags(argv.slice(1));
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

const ROUTING_POLICY_VERSION = 'runtime-routing/v1';
const ROUTING_POLICY_CONTENT = Buffer.from(
  canonicalJSONStringify({ schema: 'runtime-routing/v1', profile: 'wp1-default' }) + '\n',
  'utf8',
);
const ROUTING_POLICY_DIGEST = sha256Buffer(ROUTING_POLICY_CONTENT);
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
 * `subject-bundle-manifest/v1` -- minimal WP1 closed shape (PLAN.md ~L647, ~L804).
 * `entries` carries the caller's manifested subject-scope entries; per-entry deep
 * adversarial validation (symlink/traversal/hard-link -- `publish-blob`'s own
 * `BLOB-AUTH-01..08` matrix) is WP2/WP3 and intentionally NOT done here. The manifest
 * must NOT itself carry `subject_scope_digest` -- that value is always DERIVED (hash
 * of this exact validated manifest), never caller-supplied, so a caller cannot forge
 * a digest that does not match its own manifest bytes.
 */
const SUBJECT_BUNDLE_MANIFEST_V1_FIELDS = {
  schema: { check: (v) => v === 'coordination/subject-bundle-manifest/v1' },
  entries: { check: (v) => Array.isArray(v) },
};

/**
 * Reads+parses+validates the `--subject-bundle` manifest file against its OWN closed
 * shape. Unlike `decodeIntentOrThrow` (base64url argv payload), this is a path to a
 * caller-prepared file on disk (Frozen CLI ABI `publish-request` row, PLAN.md ~L761).
 */
function decodeSubjectBundleManifestOrThrow(manifestPath) {
  const bytes = readArtifactBytes(manifestPath);
  const obj = parseJsonOrSchemaInvalid(bytes);
  assertClosedShape(obj, SUBJECT_BUNDLE_MANIFEST_V1_FIELDS);
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
  fs.mkdirSync(planRoot, { recursive: true });
  materializePlanRef(planRoot, planPath);
  materializeRoutingPolicy(planRoot);
  materializeSubjectBundle(planRoot, subjectScopeDigest, subjectBundleManifest);

  let parentRequestId = null;
  let depth = 0;
  let rootRequestId;
  if (intent.parent_request_id) {
    parentRequestId = intent.parent_request_id;
    let parentObj;
    try {
      parentObj = JSON.parse(fs.readFileSync(requestPathFor(planRoot, parentRequestId), 'utf8'));
    } catch (err) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'parent_request_id does not resolve to an existing request');
    }
    depth = parentObj.depth + 1;
    rootRequestId = parentObj.root_request_id;
    if (depth > (parentObj.max_depth || 2)) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'nested request would exceed max_depth');
    }
  }

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
    max_depth: 2,
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

  // Fail closed on any internal inconsistency rather than publishing a record
  // `validate --kind consult-v2` would later reject.
  assertClosedShape(requestObj, CONSULT_V2_FIELDS);

  const requestPath = requestPathFor(planRoot, requestId);
  publishNoClobber(requestPath, Buffer.from(canonicalJSONStringify(requestObj), 'utf8'));

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

  // Immediately after winning claim, durably publish the initial active-lease
  // before WAL/role work (record #4 writer note, PLAN.md ~L373).
  const claimDigest = sha256File(claimPath);
  const now = nowIso();
  const leaseObj = {
    schema: 'coordination/active-lease/v1',
    attempt_id: auth.attemptId,
    lease_epoch: auth.leaseEpoch,
    holder_role: flags.role,
    claimant_instance_id: claimObj.claimant_instance_id,
    worker_session_id: claimObj.worker_session_id,
    claim_digest: claimDigest,
    ttl_seconds: 300,
    heartbeat_interval_seconds: 60,
    last_heartbeat_at: now,
    lease_expiry: minIso(isoPlusSeconds(now, 300), reqObj.expiry),
    created_at: now,
  };
  const leasePath = activeLeasePathFor(txnDir, auth.attemptId);
  publishNoClobber(leasePath, Buffer.from(canonicalJSONStringify(leaseObj), 'utf8'), { allowIdenticalIdempotent: true });

  return { request_id: reqObj.request_id, artifact_ref: claimPath };
}
COMMANDS.claim = cmdClaim;

// ─────────────────────────────────────────────────────────────────────────────
// `lease-heartbeat` (PLAN.md ~L765) -- durable current-attempt lease refresh
// ─────────────────────────────────────────────────────────────────────────────

function cmdLeaseHeartbeat(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'claim']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);

  const claimPath = resolveAbsolute(flags.claim);
  let claimObj;
  try {
    claimObj = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
  } catch (err) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'claim file does not resolve');
  }
  if (claimObj.attempt_id !== auth.attemptId || claimObj.lease_epoch !== auth.leaseEpoch) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim is not the current authoritative attempt/epoch');
  }

  return withLock(txnDir, () => {
    const now = nowIso();
    const leasePath = activeLeasePathFor(txnDir, auth.attemptId);
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    } catch (err) { /* first publish -- no existing lease */ }
    const claimDigest = sha256File(claimPath);
    const merged = Object.assign({}, existing, {
      schema: 'coordination/active-lease/v1',
      attempt_id: auth.attemptId,
      lease_epoch: auth.leaseEpoch,
      holder_role: claimObj.claimant_role,
      claimant_instance_id: claimObj.claimant_instance_id,
      worker_session_id: claimObj.worker_session_id || null,
      claim_digest: claimDigest,
      ttl_seconds: (existing && existing.ttl_seconds) || 300,
      heartbeat_interval_seconds: (existing && existing.heartbeat_interval_seconds) || 60,
      last_heartbeat_at: now,
      lease_expiry: minIso(isoPlusSeconds(now, (existing && existing.ttl_seconds) || 300), reqObj.expiry),
      created_at: (existing && existing.created_at) || now,
    });
    if (existing) {
      publishReplace(leasePath, Buffer.from(canonicalJSONStringify(merged), 'utf8'));
    } else {
      publishNoClobber(leasePath, Buffer.from(canonicalJSONStringify(merged), 'utf8'), { allowIdenticalIdempotent: true });
    }
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
  try {
    const obj = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    return Boolean(obj) && obj.status === 'ANSWERED';
  } catch (err) {
    return false;
  }
}

function confirmedFailedDelivery(txnDir, attemptId, claimDigestOrNull) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(deliveryPathFor(txnDir, attemptId), 'utf8'));
  } catch (err) {
    return false;
  }
  if (!d || d.delivered !== false || d.outcome !== 'confirmed-failed-before-commit') return false;
  if (claimDigestOrNull !== null && d.claim_digest !== claimDigestOrNull) return false;
  return true;
}

/** Returns `{eligibilityKind, reason, deadline}` or throws CliError(INVALID, AUTHORITY_INVALID, ...). */
function computeTakeoverEligibility(reqObj, txnDir, nowMs) {
  if (fs.existsSync(takeoverPathFor(txnDir))) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a takeover has already committed for this request');
  }
  const initialAttempt = reqObj.initial_attempt_id;
  const auth = { attemptId: initialAttempt, leaseEpoch: reqObj.initial_lease_epoch };
  if (currentValidResultExists(txnDir, auth)) {
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'a valid current result already exists; takeover is blocked');
  }

  const claimPath = claimPathFor(txnDir, initialAttempt);
  if (!fs.existsSync(claimPath)) {
    if (confirmedFailedDelivery(txnDir, initialAttempt, null)) {
      return { eligibilityKind: 'confirmed-failed-before-commit', reason: 'confirmed-failed-before-commit', deadline: null };
    }
    const deadline = activationLivenessDeadline(reqObj);
    if (nowMs >= isoToMs(deadline)) {
      return { eligibilityKind: 'activation-liveness-expired', reason: 'lease-expired', deadline };
    }
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'activation liveness has not yet expired');
  }

  const claimObj = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
  const claimDigest = sha256File(claimPath);
  if (confirmedFailedDelivery(txnDir, initialAttempt, claimDigest)) {
    return { eligibilityKind: 'confirmed-failed-before-commit', reason: 'confirmed-failed-before-commit', deadline: null };
  }

  const leasePath = activeLeasePathFor(txnDir, initialAttempt);
  if (!fs.existsSync(leasePath)) {
    const deadline = minIso(
      isoPlusSeconds(claimObj.created_at, CLAIM_NO_LEASE_WINDOW_S),
      minIso(activationLivenessDeadline(reqObj), isoPlusSeconds(reqObj.expiry, -REQUEST_EXPIRY_MARGIN_S)),
    );
    if (nowMs >= isoToMs(deadline)) {
      return { eligibilityKind: 'claim-no-lease-expired', reason: 'lease-expired', deadline };
    }
    throw new CliError('INVALID', 'AUTHORITY_INVALID', 'claim-without-lease effective deadline has not yet passed');
  }

  const leaseObj = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
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

  return withLock(txnDir, () => {
    const eligibility = computeTakeoverEligibility(reqObj, txnDir, Date.now());
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

function listResultFiles(txnDir) {
  try {
    return fs.readdirSync(path.join(txnDir, 'results')).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    return [];
  }
}

function writeConflictDiagnosticIfApplicable(txnDir) {
  const entries = listResultFiles(txnDir);
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
    if (fs.existsSync(acceptedResultPathFor(txnDir))) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
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
  for (const entry of listResultFiles(txnDir)) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(resultsDir, entry), 'utf8'));
      if (obj && obj.status === status) return path.join(resultsDir, entry);
    } catch (err) { /* skip unparsable candidate */ }
  }
  return null;
}

function cmdTransactionAck(flags) {
  requireFlags(flags, ['coordination-root', 'request', 'disposition']);
  const requestPath = resolveAbsolute(flags.request);
  const txnDir = path.dirname(requestPath);
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);
  const auth = resolveAuthoritativeAttempt(reqObj, txnDir);
  const disposition = flags.disposition;
  if (!['accepted', 'blocked'].includes(disposition)) {
    throw new CliError('USAGE_ERROR', 'INVALID_ARGUMENT', 'invalid --disposition: ' + disposition);
  }
  if (disposition === 'blocked' && !findResultWithStatus(txnDir, 'BLOCKED')) {
    throw new CliError('INVALID', 'RESULT_BLOCKED', 'no BLOCKED result exists to acknowledge');
  }
  if (disposition === 'accepted' && !fs.existsSync(acceptedResultPathFor(txnDir))) {
    throw new CliError('INVALID', 'CORRELATION_INVALID', 'no accepted-result.json exists to acknowledge');
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
  const reqObj = readRequestForTxnOrCorrelationInvalid(txnDir);

  return withLock(txnDir, () => {
    if (fs.existsSync(acceptedResultPathFor(txnDir))) {
      throw new CliError('INVALID', 'AUTHORITY_INVALID', 'transaction already has an accepted-result.json');
    }
    if (fs.existsSync(cancelPathFor(txnDir))) {
      throw new CliError('INVALID', 'TRANSACTION_CANCELLED', 'transaction was already cancelled');
    }
    const entries = listResultFiles(txnDir);
    if (entries.length === 0) {
      throw new CliError('INVALID', 'CORRELATION_INVALID', 'no candidate result exists yet');
    }
    const candidatePath = path.join(txnDir, 'results', entries[0]);
    // Full shape/correlation/authority/durability pipeline -- propagates the exact
    // detail_code a direct `validate --kind result-v2` would produce (RESULT-TO-02
    // pins AUTHORITY_INVALID here specifically for a superseded-attempt candidate).
    const { obj: resultObj } = validateResultV2(candidatePath, coordRoot);

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
      throw new CliError('INVALID', 'RESULT_BLOCKED', 'candidate result is not ANSWERED (never accepted as an answer)');
    }

    const acceptedObj = {
      schema: 'coordination/accepted-result/v1',
      request_digest: sha256File(requestPath),
      candidate_result_path: 'results/' + path.basename(candidatePath),
      result_digest: sha256File(candidatePath),
      accepted_attempt_id: resultObj.attempt_id,
      accepted_lease_epoch: resultObj.lease_epoch,
      routing_policy_digest: reqObj.routing_policy_digest,
      requester_instance_id: genId(),
      accepted_at: nowIso(),
      schema_version: 1,
    };
    const acceptedPath = acceptedResultPathFor(txnDir);
    publishNoClobber(acceptedPath, Buffer.from(canonicalJSONStringify(acceptedObj), 'utf8'), { raceDetailCode: 'TRANSACTION_CANCELLED' });
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
  for (const sub of ['results', 'claims', 'active-leases', 'delivery']) {
    reconcileTempArtifacts(path.join(txnDir, sub));
  }
  let requestId = null;
  try {
    requestId = JSON.parse(fs.readFileSync(requestPath, 'utf8')).request_id;
  } catch (err) { /* best effort */ }
  return { request_id: requestId, artifact_ref: txnDir };
}
COMMANDS.cleanup = cmdCleanup;

// ─────────────────────────────────────────────────────────────────────────────
// `await-result` (PLAN.md ~L768) -- bounded poll, never hangs/fabricates success
// ─────────────────────────────────────────────────────────────────────────────

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
  const deadlineMs = Date.now() + timeoutSeconds * 1000;

  for (;;) {
    if (fs.existsSync(acceptedResultPathFor(txnDir))) {
      return { request_id: reqObj.request_id, artifact_ref: acceptedResultPathFor(txnDir) };
    }
    if (fs.existsSync(cancelPathFor(txnDir))) {
      throw new CliError('INVALID', 'TRANSACTION_CANCELLED', 'transaction was cancelled');
    }
    const entries = listResultFiles(txnDir);
    if (entries.length > 0) {
      const candidatePath = path.join(txnDir, 'results', entries[0]);
      try {
        validateResultV2(candidatePath, coordRoot);
        return { request_id: reqObj.request_id, artifact_ref: candidatePath };
      } catch (err) {
        // an invalid/stale/not-yet-authoritative candidate does not itself satisfy
        // await-result -- keep polling until the deadline.
      }
    }
    if (Date.now() >= deadlineMs) {
      throw new CliError('TIMEOUT', 'NONE', 'await-result timed out with no valid current candidate');
    }
    sleepSync(100);
  }
}
COMMANDS['await-result'] = cmdAwaitResult;

if (require.main === module) {
  main();
}

module.exports = { canonicalJSONStringify, sha256Buffer, sha256String, sha256File };

